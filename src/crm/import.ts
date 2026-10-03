import { basename } from "node:path";
import { existsSync } from "node:fs";
import ExcelJS from "exceljs";
import { mapLead, type LeadRow, type MappedLead } from "./lead-map.js";
import { findByInstagram, findByPhone, isConfigured, tableName, upsertProspect } from "./store.js";
import { normaliseInstagram } from "./schema.js";

/**
 * Import scraped leads into the `new` tray, ranked.
 *
 *   npm run crm:import -- path/to/all_leads.xlsx           dry run: preview, writes nothing
 *   npm run crm:import -- path/to/all_leads.xlsx --apply   write
 *
 * Re-running is safe: a lead already in the CRM (same phone or Instagram
 * handle) is skipped, never overwritten, so a later scrape only adds what is
 * new and never clobbers a note written since. Every prospect written is
 * tagged with this run's batchId, which `crm:unimport` rolls back.
 *
 * See docs/crm-phase-1.5.md.
 */

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file = args.find((a) => !a.startsWith("--"));

if (!file) {
  console.error("Usage: npm run crm:import -- <leads.xlsx|leads.csv> [--apply]");
  process.exit(1);
}
if (!existsSync(file)) {
  console.error(`❌ No such file: ${file}`);
  process.exit(1);
}

/** First worksheet as header-keyed rows. Handles .xlsx and .csv. */
async function readRows(path: string): Promise<LeadRow[]> {
  const wb = new ExcelJS.Workbook();
  const ws = path.toLowerCase().endsWith(".csv")
    ? await wb.csv.readFile(path)
    : (await wb.xlsx.readFile(path), wb.worksheets[0]);
  if (!ws) return [];

  // cell.text flattens hyperlinks and rich text, which is how the scraper
  // writes Profile URL.
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = cell.text.trim();
  });

  const rows: LeadRow[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const out: LeadRow = {};
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (headers[col]) out[headers[col]] = cell.text;
    });
    if (Object.values(out).some((v) => v.trim())) rows.push(out);
  });
  return rows;
}

/** e.g. import-20261003-1412 — sortable, and readable in the Database tab. */
function newBatchId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `import-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

type Verdict = "new" | "known" | "duplicate" | "skipped";

const raw = await readRows(file);
const source = basename(file);
const batchId = newBatchId();

// Without credentials a dry run still checks the mapping; it just cannot say
// which leads are already known.
const canCheck = isConfigured();
if (!canCheck && apply) {
  console.error("❌ AWS credentials missing — cannot write. Dry-run works without them.");
  process.exit(1);
}

/** Already in the CRM under this phone or Instagram handle. */
async function isKnown(lead: MappedLead): Promise<boolean> {
  try {
    return Boolean(
      (lead.phone && (await findByPhone(lead.phone))) ||
        (lead.instagramUrl && (await findByInstagram(lead.instagramUrl))),
    );
  } catch (err) {
    console.error(`❌ Could not read ${tableName()}: ${(err as Error).message}`);
    console.error("   Check the AWS credentials and region. Nothing was written.");
    process.exit(1);
  }
}

const results: { lead: MappedLead | null; verdict: Verdict }[] = [];
const seenPhone = new Set<string>();
const seenIg = new Set<string>();

for (const row of raw) {
  const lead = mapLead(row);
  if (!lead) {
    results.push({ lead, verdict: "skipped" });
    continue;
  }
  // The same lead twice in one file would otherwise pass the CRM check twice,
  // since neither copy is written until --apply.
  const ig = lead.instagramUrl ? normaliseInstagram(lead.instagramUrl) : "";
  if ((lead.phone && seenPhone.has(lead.phone)) || (ig && seenIg.has(ig))) {
    results.push({ lead, verdict: "duplicate" });
    continue;
  }
  if (lead.phone) seenPhone.add(lead.phone);
  if (ig) seenIg.add(ig);

  results.push({ lead, verdict: canCheck && (await isKnown(lead)) ? "known" : "new" });
}

const fresh = results.filter((r) => r.verdict === "new").map((r) => r.lead!);
const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
const dropped = results.filter((r) => r.lead?.droppedContact);
const tier = (t: MappedLead["tier"]) => fresh.filter((l) => l.tier === t).length;

console.log(`📄 ${source} → ${canCheck ? tableName() : "(no AWS credentials: mapping only)"}\n`);
console.log(
  `${raw.length} rows · ${fresh.length} new · ` +
    `${canCheck ? count("known") : "?"} already known · ` +
    `${count("duplicate")} repeated in file · ${count("skipped")} unnamed · ` +
    `${dropped.length} contact dropped (not a phone)`,
);
console.log(`${tier("phone")} callable · ${tier("email")} email-only · ${tier("none")} no contact\n`);

for (const r of dropped) {
  console.log(`   ⚠️  ${r.lead!.businessName}: dropped contact "${r.lead!.droppedContact}"`);
}
if (dropped.length) console.log("");

// The ranking as the `new` tray will read back.
const ranked = [...fresh].sort((a, b) => b.score - a.score);
console.log(" #  score  followers  contact          model    name");
ranked.forEach((l, i) => {
  const contact = l.phone ?? (l.email ? "email" : "—");
  console.log(
    `${String(i + 1).padStart(2)}  ${String(l.score).padStart(5)}  ` +
      `${String(l.followers ?? "—").padStart(9)}  ${contact.padEnd(15)}  ` +
      `${l.businessModel.padEnd(7)}  ${l.businessName}`,
  );
});

if (!apply) {
  console.log(`\n(dry run — nothing written. Re-run with --apply to import ${fresh.length} lead(s).)`);
  process.exit(0);
}

let written = 0;
try {
  for (const l of fresh) {
    const { tier: _t, droppedContact: _d, ...fields } = l;
    await upsertProspect({ ...fields, status: "new", source, batchId });
    written++;
  }
} catch (err) {
  // Partial imports are still tagged, so the same rollback cleans them up.
  console.error(`\n❌ Stopped after ${written} of ${fresh.length}: ${(err as Error).message}`);
  console.error(`   Roll back with: npm run crm:unimport -- ${batchId} --apply`);
  process.exit(1);
}

console.log(`\n✅ Imported ${written} lead(s) into the new tray as batch ${batchId}`);
console.log(`   Check:  Database tab → Q4 → New`);
console.log(`   Undo:   npm run crm:unimport -- ${batchId} --apply`);
