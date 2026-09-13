import "dotenv/config";
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  newProspectId,
  normalisePhone,
  today,
  type CrmEvent,
  type Prospect,
} from "./schema.js";

/**
 * DynamoDB access for the CRM. The single write path — both the frontend (via
 * /api/crm/*) and Sara (via the watcher) go through these functions, so rows
 * are identical in shape whoever created them.
 *
 * Single-table design:
 *   pk = "P#<prospectId>"   sk = "PROFILE" | "EVT#<ISO timestamp>"
 *
 * prospectId is generated rather than the phone number: prospects arrive from
 * Instagram scraping with no number, and numbers get corrected. Phone is a
 * GSI instead.
 */

const TABLE = process.env.CRM_TABLE?.trim() || "nine-square-crm";
const REGION = process.env.AWS_REGION?.trim() || "us-east-1";

/** Sara resolves an incoming number to a prospect on every call. */
const PHONE_INDEX = "phone-index";
/** "Who do I call today" is the main daily question — one query, not a scan. */
const FOLLOWUP_INDEX = "followup-index";
/** Constant partition for the follow-up index, so dates sort within it. */
const ALL = "PROSPECT";

let _doc: DynamoDBDocumentClient | null = null;

function doc(): DynamoDBDocumentClient {
  if (_doc) return _doc;
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error(
      "CRM needs AWS credentials. Add AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY " +
        "and AWS_REGION to .env (same values as the youtube-summarizer project).",
    );
  }
  const client = new DynamoDBClient({ region: REGION });
  // removeUndefinedValues: optional fields (phone, instagramUrl) are frequently
  // absent, and DynamoDB rejects explicit undefined.
  _doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return _doc;
}

export function isConfigured(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

const pk = (id: string) => `P#${id}`;
const PROFILE = "PROFILE";
const evtSk = (at: string) => `EVT#${at}`;

/** Create the table and its indexes if absent. Safe to run repeatedly. */
export async function ensureTable(): Promise<"created" | "exists"> {
  const client = new DynamoDBClient({ region: REGION });
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE }));
    return "exists";
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }

  await client.send(
    new CreateTableCommand({
      TableName: TABLE,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
        { AttributeName: "phone", AttributeType: "S" },
        { AttributeName: "gsiAll", AttributeType: "S" },
        { AttributeName: "followUpDue", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: PHONE_INDEX,
          KeySchema: [{ AttributeName: "phone", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
        },
        {
          IndexName: FOLLOWUP_INDEX,
          KeySchema: [
            { AttributeName: "gsiAll", KeyType: "HASH" },
            { AttributeName: "followUpDue", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: TABLE });
  return "created";
}

/** Create or update a prospect. Returns the stored record. */
export async function upsertProspect(
  input: Partial<Prospect> & { businessName: string },
): Promise<Prospect> {
  const now = new Date().toISOString();
  const phone = input.phone ? normalisePhone(input.phone) : undefined;

  // Reuse an existing record when the number already belongs to someone, so a
  // second call to the same person never creates a duplicate prospect.
  const existing = input.prospectId
    ? await getProspect(input.prospectId)
    : phone
      ? await findByPhone(phone)
      : null;

  const record: Prospect = {
    ...existing,
    ...input,
    phone,
    prospectId: existing?.prospectId ?? input.prospectId ?? newProspectId(),
    businessName: input.businessName || existing?.businessName || "Unknown",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await doc().send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: pk(record.prospectId),
        sk: PROFILE,
        ...record,
        // Only indexed when a follow-up is actually set — prospects with none
        // stay out of the index rather than cluttering the daily query.
        ...(record.followUpDue ? { gsiAll: ALL } : {}),
      },
    }),
  );
  return record;
}

export async function getProspect(prospectId: string): Promise<Prospect | null> {
  const r = await doc().send(
    new GetCommand({ TableName: TABLE, Key: { pk: pk(prospectId), sk: PROFILE } }),
  );
  return (r.Item as Prospect | undefined) ?? null;
}

/** Resolve a phone number to a prospect. Used by Sara on every call. */
export async function findByPhone(phone: string): Promise<Prospect | null> {
  const r = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: PHONE_INDEX,
      KeyConditionExpression: "phone = :p",
      ExpressionAttributeValues: { ":p": normalisePhone(phone) },
      Limit: 5,
    }),
  );
  const profile = (r.Items ?? []).find((i) => i.sk === PROFILE);
  return (profile as Prospect | undefined) ?? null;
}

/** Every prospect. Small dataset by design — see docs/crm-plan.md on indexes. */
export async function listProspects(): Promise<Prospect[]> {
  const r = await doc().send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: "sk = :s",
      ExpressionAttributeValues: { ":s": PROFILE },
    }),
  );
  return ((r.Items ?? []) as Prospect[]).sort((a, b) =>
    (a.followUpDue ?? "9999").localeCompare(b.followUpDue ?? "9999"),
  );
}

/** Prospects whose follow-up is due on or before `date` (default today). */
export async function dueBy(date = today()): Promise<Prospect[]> {
  const r = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: FOLLOWUP_INDEX,
      KeyConditionExpression: "gsiAll = :a AND followUpDue <= :d",
      ExpressionAttributeValues: { ":a": ALL, ":d": date },
    }),
  );
  return ((r.Items ?? []) as Prospect[]).filter((p) => p.followUpDue);
}

/**
 * Append an event and move the prospect's follow-up on.
 *
 * Both writers land here, so a hand-logged call and one Sara wrote differ only
 * in `by`.
 */
export async function addEvent(
  event: Omit<CrmEvent, "at"> & { at?: string; followUpDue?: string | null },
): Promise<CrmEvent> {
  const at = event.at ?? new Date().toISOString();
  const { followUpDue, ...rest } = event;
  const stored: CrmEvent = { ...rest, at };

  await doc().send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: pk(event.prospectId), sk: evtSk(at), ...stored },
    }),
  );

  // Keep the profile's follow-up and last-contacted in step, so the list view
  // never disagrees with the timeline.
  const sets = ["lastContactedAt = :t", "updatedAt = :t"];
  const values: Record<string, unknown> = { ":t": at };
  if (followUpDue !== undefined) {
    sets.push("followUpDue = :f", "gsiAll = :g");
    values[":f"] = followUpDue ?? null;
    // Dropping out of the index when a follow-up is cleared keeps the daily
    // query honest — closed prospects shouldn't appear as due.
    values[":g"] = followUpDue ? ALL : null;
  }
  await doc().send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: pk(event.prospectId), sk: PROFILE },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeValues: values,
    }),
  );
  return stored;
}

/** A prospect's timeline, newest first. */
export async function listEvents(prospectId: string): Promise<CrmEvent[]> {
  const r = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :p AND begins_with(sk, :e)",
      ExpressionAttributeValues: { ":p": pk(prospectId), ":e": "EVT#" },
      ScanIndexForward: false,
    }),
  );
  return (r.Items ?? []) as CrmEvent[];
}
