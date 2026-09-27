import "dotenv/config";
import { loadSharedAwsEnv, credentialSource } from "./aws-env.js";
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
  DeleteCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  newProspectId,
  normalisePhone,
  normaliseInstagram,
  statusForOutcome,
  today,
  type CrmEvent,
  type Prospect,
  type ProspectStatus,
} from "./schema.js";

/**
 * DynamoDB access for the CRM. The single write path — both the frontend (via
 * /api/crm/*) and Sara (via the watcher) go through these functions, so rows
 * are identical in shape whoever created them.
 *
 * Single-table design:
 *   pk = "P#<prospectId>"          sk = "PROFILE" | "EVT#<ISO timestamp>"
 *   pk = "PHONE#<e164>"            sk = "POINTER"   -> prospectId
 *   pk = "IG#<handle>"             sk = "POINTER"   -> prospectId
 *
 * prospectId is generated rather than the phone number: prospects arrive from
 * Instagram scraping with no number, and numbers get corrected.
 *
 * Phone and Instagram lookups go through POINTER rows rather than an index.
 * A direct read is strongly consistent; an index is not — so importing a
 * scraped list twice would otherwise create duplicates by checking a copy
 * that has not caught up. The pointer also makes uniqueness structural.
 */

// Credentials live in the youtube-summarizer project's .env — same AWS
// account, one place to rotate them. See aws-env.ts.
loadSharedAwsEnv();

// v2 carries the refined key design (status trays, activity index, POINTER
// rows). DynamoDB cannot change a table's key schema in place, so the new
// shape is a new table; the original is left intact and can be deleted from
// the console once this has proved itself.
const TABLE = process.env.CRM_TABLE?.trim() || "nine-square-crm-v2";
const REGION = () => process.env.AWS_REGION?.trim() || "us-east-1";

/**
 * Prospects grouped by tray (open/won/lost), sorted by follow-up date.
 *
 * One index answers three questions: who do I call today (open, due <= today),
 * show me every live prospect, and how many are at each stage. Keying on the
 * status is what stops a won customer appearing in tomorrow's call list.
 */
const STATUS_INDEX = "status-index";
/** Every call in one time-ordered list, so "what did I do this week" is a query. */
const ACTIVITY_INDEX = "activity-index";
/** Constant partition for the activity index, so timestamps sort within it. */
const ALL_EVENTS = "EVT";

let _doc: DynamoDBDocumentClient | null = null;

function doc(): DynamoDBDocumentClient {
  if (_doc) return _doc;
  if (!isConfigured()) {
    throw new Error(
      "CRM needs AWS credentials. They are read from the youtube-summarizer " +
        "project's .env; set AWS_ENV_FILE to its path if that repo has moved, " +
        "or put AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in this project's .env.",
    );
  }
  const client = new DynamoDBClient({ region: REGION() });
  // removeUndefinedValues: optional fields (phone, instagramUrl) are frequently
  // absent, and DynamoDB rejects explicit undefined.
  _doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return _doc;
}

export function isConfigured(): boolean {
  loadSharedAwsEnv();
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

/** Which file the credentials came from — shown by crm:init, never the values. */
export function credentialsFrom(): string {
  return credentialSource() ?? "this project's .env";
}

export function tableName(): string {
  return TABLE;
}

const pk = (id: string) => `P#${id}`;
const PROFILE = "PROFILE";
const evtSk = (at: string) => `EVT#${at}`;

/** Create the table and its indexes if absent. Safe to run repeatedly. */
export async function ensureTable(): Promise<"created" | "exists"> {
  const client = new DynamoDBClient({ region: REGION() });
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
        { AttributeName: "status", AttributeType: "S" },
        { AttributeName: "followUpSort", AttributeType: "S" },
        { AttributeName: "gsiEvt", AttributeType: "S" },
        { AttributeName: "at", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: STATUS_INDEX,
          KeySchema: [
            { AttributeName: "status", KeyType: "HASH" },
            { AttributeName: "followUpSort", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
        {
          IndexName: ACTIVITY_INDEX,
          KeySchema: [
            { AttributeName: "gsiEvt", KeyType: "HASH" },
            { AttributeName: "at", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: TABLE });
  return "created";
}

/**
 * Sort value for the status index.
 *
 * A prospect with no follow-up date still belongs in the index — otherwise
 * "show me every live prospect" would silently omit them. They sort last,
 * under a far-future sentinel, so they never appear as due.
 */
const NO_FOLLOW_UP = "9999-12-31";
const followUpSort = (due?: string | null) => due || NO_FOLLOW_UP;

const phonePk = (phone: string) => `PHONE#${normalisePhone(phone)}`;
const igPk = (url: string) => `IG#${normaliseInstagram(url)}`;
const POINTER = "POINTER";

/** Write a lookup row. Cheap, and makes uniqueness structural. */
async function putPointer(pointerPk: string, prospectId: string): Promise<void> {
  await doc().send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: pointerPk, sk: POINTER, prospectId },
    }),
  );
}

async function readPointer(pointerPk: string): Promise<string | null> {
  const r = await doc().send(
    new GetCommand({ TableName: TABLE, Key: { pk: pointerPk, sk: POINTER } }),
  );
  return (r.Item?.prospectId as string | undefined) ?? null;
}

/** Create or update a prospect. Returns the stored record. */
export async function upsertProspect(
  input: Partial<Prospect> & { businessName: string },
): Promise<Prospect> {
  const now = new Date().toISOString();
  const phone = input.phone ? normalisePhone(input.phone) : undefined;

  // Reuse an existing record when the number or handle already belongs to
  // someone, so importing the same prospect twice never splits their history.
  const existing = input.prospectId
    ? await getProspect(input.prospectId)
    : phone
      ? await findByPhone(phone)
      : input.instagramUrl
        ? await findByInstagram(input.instagramUrl)
        : null;

  // Only overlay keys actually supplied. Spreading `input` wholesale let an
  // absent field arrive as undefined and wipe a stored value — a rename
  // silently cleared the prospect's phone number.
  const supplied = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined),
  ) as Partial<Prospect>;

  const record: Prospect = {
    ...existing,
    ...supplied,
    phone: phone ?? existing?.phone,
    prospectId: existing?.prospectId ?? input.prospectId ?? newProspectId(),
    businessName: input.businessName || existing?.businessName || "Unknown",
    status: supplied.status ?? existing?.status ?? "open",
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
        followUpSort: followUpSort(record.followUpDue),
      },
    }),
  );

  // Pointers are written after the profile: a stray pointer to a real record
  // is harmless, one to a record that failed to save is not.
  if (record.phone) await putPointer(phonePk(record.phone), record.prospectId);
  if (record.instagramUrl) await putPointer(igPk(record.instagramUrl), record.prospectId);

  return record;
}

export async function getProspect(prospectId: string): Promise<Prospect | null> {
  const r = await doc().send(
    new GetCommand({ TableName: TABLE, Key: { pk: pk(prospectId), sk: PROFILE } }),
  );
  return (r.Item as Prospect | undefined) ?? null;
}

/**
 * Resolve a phone number to a prospect. Used by Sara on every call.
 * Two direct reads — the pointer, then the profile — both strongly consistent.
 */
export async function findByPhone(phone: string): Promise<Prospect | null> {
  const id = await readPointer(phonePk(phone));
  return id ? getProspect(id) : null;
}

/** Resolve an Instagram handle or URL. Used to dedupe a scraped import. */
export async function findByInstagram(url: string): Promise<Prospect | null> {
  const id = await readPointer(igPk(url));
  return id ? getProspect(id) : null;
}

/**
 * Prospects in one tray, soonest follow-up first.
 *
 * A query on the status index, not a scan: the old version read every row in
 * the table — including every call — on each page load.
 */
export async function listProspects(status: ProspectStatus = "open"): Promise<Prospect[]> {
  const r = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: STATUS_INDEX,
      KeyConditionExpression: "#s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": status },
    }),
  );
  return (r.Items ?? []) as Prospect[];
}

/** Every prospect across all trays, for search and export. */
export async function listAllProspects(): Promise<Prospect[]> {
  const trays = await Promise.all(
    (["open", "won", "lost"] as ProspectStatus[]).map((s) => listProspects(s)),
  );
  return trays.flat();
}

/** How many prospects sit in each tray. */
export async function pipeline(): Promise<Record<ProspectStatus, number>> {
  const [open, won, lost] = await Promise.all([
    listProspects("open"),
    listProspects("won"),
    listProspects("lost"),
  ]);
  return { open: open.length, won: won.length, lost: lost.length };
}

/** Live prospects whose follow-up is due on or before `date` (default today). */
export async function dueBy(date = today()): Promise<Prospect[]> {
  const r = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: STATUS_INDEX,
      KeyConditionExpression: "#s = :s AND followUpSort <= :d",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": "open", ":d": date },
    }),
  );
  return (r.Items ?? []) as Prospect[];
}

/**
 * Append an event, move the follow-up on, and close the prospect when the
 * outcome says so.
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
      Item: {
        pk: pk(event.prospectId),
        sk: evtSk(at),
        ...stored,
        // Puts every call in one time-ordered list, so activity can be read
        // across prospects rather than one at a time.
        gsiEvt: ALL_EVENTS,
      },
    }),
  );

  // Keep the profile in step with the timeline, so the list view never
  // disagrees with the history.
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ":t": at };
  const sets = ["lastContactedAt = :t", "updatedAt = :t"];

  if (followUpDue !== undefined) {
    sets.push("followUpDue = :f", "followUpSort = :fs");
    values[":f"] = followUpDue ?? null;
    values[":fs"] = followUpSort(followUpDue);
  }

  // "Closed won" should take them out of tomorrow's call list by itself —
  // relying on someone remembering to change the status is how CRMs rot.
  const closed = statusForOutcome(event.outcome);
  if (closed) {
    sets.push("#s = :st");
    names["#s"] = "status";
    values[":st"] = closed;
  }

  await doc().send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: pk(event.prospectId), sk: PROFILE },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
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

/**
 * Every call across every prospect since `since`, newest first.
 * Answers "what did I do this week" — impossible before, because events were
 * only reachable one prospect at a time.
 */
export async function recentActivity(sinceIso: string, limit = 100): Promise<CrmEvent[]> {
  const r = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: ACTIVITY_INDEX,
      // "at" is a DynamoDB reserved word, so it has to be aliased.
      KeyConditionExpression: "gsiEvt = :e AND #at >= :s",
      ExpressionAttributeNames: { "#at": "at" },
      ExpressionAttributeValues: { ":e": ALL_EVENTS, ":s": sinceIso },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (r.Items ?? []) as CrmEvent[];
}

export interface TableShape {
  name: string;
  region: string;
  itemCount: number;
  partitionKey: string;
  sortKey: string;
  indexes: { name: string; partitionKey: string; sortKey?: string }[];
  rows: Record<string, unknown>[];
}

/**
 * Describe the table and return every row — for the Database tab, which
 * exists to make the design visible rather than to serve the app.
 *
 * Deliberately a Scan: this is the one place that genuinely wants every row,
 * including the POINTER rows that no query would return. It is a debug view,
 * not a hot path.
 */
export async function describeTable(): Promise<TableShape> {
  const client = new DynamoDBClient({ region: REGION() });
  const d = await client.send(new DescribeTableCommand({ TableName: TABLE }));
  const t = d.Table!;
  const key = (schema: { AttributeName?: string; KeyType?: string }[] = []) => ({
    partitionKey: schema.find((k) => k.KeyType === "HASH")?.AttributeName ?? "",
    sortKey: schema.find((k) => k.KeyType === "RANGE")?.AttributeName,
  });

  const scan = await doc().send(new ScanCommand({ TableName: TABLE }));
  const rows = ((scan.Items ?? []) as Record<string, unknown>[]).sort((a, b) =>
    `${a.pk}${a.sk}`.localeCompare(`${b.pk}${b.sk}`),
  );

  const main = key(t.KeySchema);
  return {
    name: TABLE,
    region: REGION(),
    itemCount: rows.length,
    partitionKey: main.partitionKey,
    sortKey: main.sortKey ?? "",
    indexes: (t.GlobalSecondaryIndexes ?? []).map((g) => ({
      name: g.IndexName!,
      ...key(g.KeySchema),
    })),
    rows,
  };
}

/** Remove a prospect, its timeline and its pointers. */
export async function deleteProspect(prospectId: string): Promise<number> {
  const p = await getProspect(prospectId);
  const events = await listEvents(prospectId);
  const keys = [
    { pk: pk(prospectId), sk: PROFILE },
    ...events.map((e) => ({ pk: pk(prospectId), sk: evtSk(e.at) })),
    ...(p?.phone ? [{ pk: phonePk(p.phone), sk: POINTER }] : []),
    ...(p?.instagramUrl ? [{ pk: igPk(p.instagramUrl), sk: POINTER }] : []),
  ];
  for (const Key of keys) await doc().send(new DeleteCommand({ TableName: TABLE, Key }));
  return keys.length;
}

/** Remove one event from a prospect's timeline. */
export async function deleteEvent(prospectId: string, at: string): Promise<void> {
  await doc().send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: pk(prospectId), sk: evtSk(at) } }),
  );
}
