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
  TransactWriteCommand,
  type TransactWriteCommandInput,
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
 * Prospects grouped by tray (new/open/won/lost), each tray pre-ranked.
 *
 * One index answers four questions: which scraped lead is best, who do I call
 * today (open, due <= today), show me every live prospect, and how many are
 * at each stage. Keying on the status is what stops a won customer appearing
 * in tomorrow's call list. What the sort key holds depends on the tray — see
 * traySort.
 */
const STATUS_INDEX = "status-index";
/** Every call in a time-ordered list, so "what did I do this week" is a query. */
const ACTIVITY_INDEX = "activity-index";

/**
 * Activity partition, sharded by month.
 *
 * A single constant partition would funnel every call ever written to one
 * physical partition — capped at 1,000 writes/sec and a permanent hot spot.
 * Keying by month spreads the writes while keeping recent reads cheap: "last
 * 7 days" touches one partition, or two across a month boundary.
 */
const eventShard = (iso: string) => `EVT#${iso.slice(0, 7)}`;

/** Months covering a range, newest first — the shards a lookback must read. */
function shardsSince(sinceIso: string, until = new Date().toISOString()): string[] {
  const out: string[] = [];
  const d = new Date(`${sinceIso.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${until.slice(0, 7)}-01T00:00:00Z`);
  while (d <= end) {
    out.push(`EVT#${d.toISOString().slice(0, 7)}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out.reverse();
}

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
 * Sort value for a follow-up date.
 *
 * A prospect with no follow-up date still belongs in the index — otherwise
 * "show me every live prospect" would silently omit them. They sort last,
 * under a far-future sentinel, so they never appear as due.
 */
const NO_FOLLOW_UP = "9999-12-31";
const followUpSort = (due?: string | null) => due || NO_FOLLOW_UP;

/** Highest score the `new` tray's four-digit sort key can order. */
const MAX_SORTABLE_SCORE = 9999;

/**
 * Sort value for the status index, per tray.
 *
 *   new         inverted score, zero-padded (1073 -> "8926"): best lead first
 *   open / ...  the follow-up date: most urgent first
 *
 * So each tray reads back already ordered, with no sorting on every page
 * load. The score is inverted because the index sorts ascending, and padded
 * because "8926" < "974" as strings. Scores are 86-1073 (score.ts), so four
 * digits never overflow and none is negative.
 *
 * The attribute is still called followUpSort: it is the index's sort key, and
 * DynamoDB cannot rename an index key without deleting and rebuilding the
 * index on a live table. Only what it holds changed.
 */
export function traySort(p: Pick<Prospect, "status" | "score" | "followUpDue">): string {
  if (p.status === "new") {
    const score = Math.max(0, Math.min(MAX_SORTABLE_SCORE, Math.round(p.score ?? 0)));
    return String(MAX_SORTABLE_SCORE - score).padStart(4, "0");
  }
  return followUpSort(p.followUpDue);
}

const phonePk = (phone: string) => `PHONE#${normalisePhone(phone)}`;
const igPk = (url: string) => `IG#${normaliseInstagram(url)}`;
const POINTER = "POINTER";

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

  // Profile and pointers go in one transaction.
  //
  // Written separately, a failure between them left a prospect with no lookup
  // card — which silently breaks the dedupe guarantee that justified pointers
  // over an index in the first place. Importing hundreds of scraped leads is
  // hundreds of chances to half-write one, and the damage only surfaces later
  // as a duplicate.
  //
  // Stale pointers are also removed here: changing someone's phone number
  // would otherwise leave the old number pointing at them forever.
  const writes: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
    {
      Put: {
        TableName: TABLE,
        Item: {
          pk: pk(record.prospectId),
          sk: PROFILE,
          ...record,
          followUpSort: traySort(record),
        },
      },
    },
  ];

  if (record.phone) {
    writes.push({
      Put: { TableName: TABLE, Item: { pk: phonePk(record.phone), sk: POINTER, prospectId: record.prospectId } },
    });
  }
  if (record.instagramUrl) {
    writes.push({
      Put: { TableName: TABLE, Item: { pk: igPk(record.instagramUrl), sk: POINTER, prospectId: record.prospectId } },
    });
  }
  if (existing?.phone && existing.phone !== record.phone) {
    writes.push({ Delete: { TableName: TABLE, Key: { pk: phonePk(existing.phone), sk: POINTER } } });
  }
  if (existing?.instagramUrl && igPk(existing.instagramUrl) !== igPk(record.instagramUrl ?? "")) {
    writes.push({ Delete: { TableName: TABLE, Key: { pk: igPk(existing.instagramUrl), sk: POINTER } } });
  }

  await doc().send(new TransactWriteCommand({ TransactItems: writes }));
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
 * Prospects in one tray, in the tray's own order: best score first for
 * `new`, soonest follow-up first for the rest.
 *
 * A query on the status index, not a scan: the old version read every row in
 * the table — including every call — on each page load.
 */
export async function listProspects(
  status: ProspectStatus = "open",
  limit = 100,
): Promise<Prospect[]> {
  const r = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: STATUS_INDEX,
      KeyConditionExpression: "#s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": status },
      Limit: limit,
    }),
  );
  return (r.Items ?? []) as Prospect[];
}

const TRAYS: ProspectStatus[] = ["new", "open", "won", "lost"];

/** Every prospect across all trays, for search and export. */
export async function listAllProspects(): Promise<Prospect[]> {
  const trays = await Promise.all(TRAYS.map((s) => listProspects(s)));
  return trays.flat();
}

/** How many prospects sit in each tray. */
export async function pipeline(): Promise<Record<ProspectStatus, number>> {
  const [fresh, open, won, lost] = await Promise.all(TRAYS.map((s) => listProspects(s)));
  return { new: fresh.length, open: open.length, won: won.length, lost: lost.length };
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
  // Read before writing: a call against a `new` lead moves it to `open`, and
  // its sort key has to change from score to follow-up date with it.
  const before = await getProspect(event.prospectId);

  await doc().send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: pk(event.prospectId),
        sk: evtSk(at),
        ...stored,
        // Files the call into its month's activity shard, so it can be read
        // across prospects rather than one at a time.
        gsiEvt: eventShard(at),
      },
    }),
  );

  // Keep the profile in step with the timeline, so the list view never
  // disagrees with the history.
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ":t": at };
  const sets = ["lastContactedAt = :t", "updatedAt = :t"];

  // "Closed won" should take them out of tomorrow's call list by itself —
  // relying on someone remembering to change the status is how CRMs rot.
  // Likewise the first call to a scraped lead makes it a live prospect: it is
  // no longer someone nobody has spoken to.
  const closed = statusForOutcome(event.outcome);
  const status = closed ?? (before?.status === "new" ? "open" : null);
  if (status) {
    sets.push("#s = :st");
    names["#s"] = "status";
    values[":st"] = status;
  }

  // Stamp when a prospect first became live.
  //
  // createdAt cannot stand in for this: for an imported lead it records the
  // import, so a prospect scraped in September and first called today would
  // read as a month old. The transition happens once and cannot be
  // reconstructed afterwards, so it is recorded as it happens.
  if (status === "open" && !before?.openedAt) {
    sets.push("openedAt = :oa");
    values[":oa"] = at;
  }

  // Leaving `new` re-keys the prospect even without a follow-up, or it would
  // sit in its new tray under a score that now reads as a date.
  if (followUpDue !== undefined || before?.status === "new") {
    const due = followUpDue !== undefined ? followUpDue : before?.followUpDue;
    sets.push("followUpSort = :fs");
    values[":fs"] = followUpSort(due);
    if (followUpDue !== undefined) {
      sets.push("followUpDue = :f");
      values[":f"] = followUpDue ?? null;
    }
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

/**
 * A prospect's timeline, newest first.
 *
 * Capped: a long-running prospect can accumulate hundreds of calls, and a
 * detail page only ever shows the recent ones.
 */
export async function listEvents(prospectId: string, limit = 50): Promise<CrmEvent[]> {
  const r = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :p AND begins_with(sk, :e)",
      ExpressionAttributeValues: { ":p": pk(prospectId), ":e": "EVT#" },
      ScanIndexForward: false,
      Limit: limit,
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
  // Walk month shards newest-first and stop once the limit is met, so a short
  // lookback reads one partition rather than every month on record.
  const out: CrmEvent[] = [];
  for (const shard of shardsSince(sinceIso)) {
    if (out.length >= limit) break;
    const r = await doc().send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: ACTIVITY_INDEX,
        // "at" is a DynamoDB reserved word, so it has to be aliased.
        KeyConditionExpression: "gsiEvt = :e AND #at >= :s",
        ExpressionAttributeNames: { "#at": "at" },
        ExpressionAttributeValues: { ":e": shard, ":s": sinceIso },
        ScanIndexForward: false,
        Limit: limit - out.length,
      }),
    );
    out.push(...((r.Items ?? []) as CrmEvent[]));
  }
  return out.slice(0, limit);
}

export interface TableShape {
  name: string;
  region: string;
  /** Rows returned (never more than the requested limit). */
  itemCount: number;
  /** True when the table holds more rows than were returned. */
  truncated: boolean;
  limit: number;
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
export async function describeTable(limit = 20): Promise<TableShape> {
  const client = new DynamoDBClient({ region: REGION() });
  const d = await client.send(new DescribeTableCommand({ TableName: TABLE }));
  const t = d.Table!;
  const key = (schema: { AttributeName?: string; KeyType?: string }[] = []) => ({
    partitionKey: schema.find((k) => k.KeyType === "HASH")?.AttributeName ?? "",
    sortKey: schema.find((k) => k.KeyType === "RANGE")?.AttributeName,
  });

  // Ask for one more than needed: if it comes back, there are further rows.
  // Cheaper and more honest than a count, which would read the whole table.
  const scan = await doc().send(new ScanCommand({ TableName: TABLE, Limit: limit + 1 }));
  const all = (scan.Items ?? []) as Record<string, unknown>[];
  const truncated = all.length > limit || Boolean(scan.LastEvaluatedKey);
  const rows = all
    .slice(0, limit)
    .sort((a, b) => `${a.pk}${a.sk}`.localeCompare(`${b.pk}${b.sk}`));

  const main = key(t.KeySchema);
  return {
    name: TABLE,
    region: REGION(),
    itemCount: rows.length,
    truncated,
    limit,
    partitionKey: main.partitionKey,
    sortKey: main.sortKey ?? "",
    indexes: (t.GlobalSecondaryIndexes ?? []).map((g) => ({
      name: g.IndexName!,
      ...key(g.KeySchema),
    })),
    rows,
  };
}

/**
 * Every prospect written by one import run.
 *
 * A Scan with a filter: a rollback runs rarely, by hand, and has to find the
 * batch's prospects in whatever tray they have since moved to — no one index
 * covers that. Paginated, because a Scan page stops at 1 MB.
 */
export async function listByBatch(batchId: string): Promise<Prospect[]> {
  const out: Prospect[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await doc().send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: "sk = :p AND batchId = :b",
        ExpressionAttributeValues: { ":p": PROFILE, ":b": batchId },
        ExclusiveStartKey: start,
      }),
    );
    out.push(...((r.Items ?? []) as Prospect[]));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

/** Whether any call has been logged against a prospect. */
export async function hasEvents(prospectId: string): Promise<boolean> {
  const r = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :p AND begins_with(sk, :e)",
      ExpressionAttributeValues: { ":p": pk(prospectId), ":e": "EVT#" },
      Limit: 1,
    }),
  );
  return (r.Items ?? []).length > 0;
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
