import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { loadSharedAwsEnv } from "./aws-env.js";
import { tableName } from "./store.js";

/**
 * Move events written before the activity index was sharded onto their month's
 * shard.
 *
 * Events created under the old constant `gsiEvt = "EVT"` are invisible to the
 * sharded query, so history silently disappears from "what did I do this
 * week". Idempotent — rows already on a month shard are skipped.
 *
 *   npm run crm:backfill          -- report what would change
 *   npm run crm:backfill -- apply -- write the changes
 */
loadSharedAwsEnv();
const apply = process.argv[2] === "apply";
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const TABLE = tableName();

const r = await doc.send(new ScanCommand({ TableName: TABLE }));
const stale = (r.Items ?? []).filter(
  (i) => String(i.sk ?? "").startsWith("EVT#") && i.gsiEvt === "EVT",
);

console.log(`${stale.length} event(s) on the unsharded partition`);
for (const i of stale) {
  const shard = `EVT#${String(i.at).slice(0, 7)}`;
  console.log(`   ${String(i.at).slice(0, 16)}  EVT -> ${shard}`);
  if (apply) {
    await doc.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk: i.pk, sk: i.sk },
        UpdateExpression: "SET gsiEvt = :g",
        ExpressionAttributeValues: { ":g": shard },
      }),
    );
  }
}
console.log(apply ? "\n✅ applied" : "\n(dry run — re-run with `-- apply` to write)");
