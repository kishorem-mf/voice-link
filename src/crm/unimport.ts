import { deleteProspect, hasEvents, isConfigured, listByBatch, tableName } from "./store.js";

/**
 * Roll back one import run.
 *
 *   npm run crm:unimport -- <batchId>           dry run: list what would go
 *   npm run crm:unimport -- <batchId> --apply   delete
 *
 * Removes every prospect the batch wrote, with its pointer rows. A prospect
 * with any call logged against it is kept: a rollback must never destroy
 * work done after the import. This is what makes importing before the
 * Prospects tab exists reasonable — a wrong mapping is undone and re-run,
 * not hand-fixed. See docs/crm-phase-1.5.md.
 */

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const batchId = args.find((a) => !a.startsWith("--"));

if (!batchId) {
  console.error("Usage: npm run crm:unimport -- <batchId> [--apply]");
  console.error("   The batchId is printed by crm:import, and stored on every imported prospect.");
  process.exit(1);
}
if (!isConfigured()) {
  console.error("❌ AWS credentials missing.");
  process.exit(1);
}

try {
  const prospects = await listByBatch(batchId);
  console.log(`🗄️  ${tableName()} · batch ${batchId} · ${prospects.length} prospect(s)\n`);

  let removed = 0;
  let kept = 0;
  for (const p of prospects) {
    if (await hasEvents(p.prospectId)) {
      kept++;
      console.log(`   keep    ${p.businessName} — has calls logged`);
      continue;
    }
    if (apply) await deleteProspect(p.prospectId);
    removed++;
    console.log(`   ${apply ? "deleted" : "delete "} ${p.businessName}`);
  }

  console.log(
    `\n${apply ? "✅ Deleted" : "Would delete"} ${removed} · kept ${kept} with calls logged` +
      (apply ? "" : "\n(dry run — re-run with --apply to delete)"),
  );
} catch (err) {
  console.error(`❌ ${(err as Error).message}`);
  process.exit(1);
}
