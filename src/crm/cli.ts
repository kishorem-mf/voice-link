import { ensureTable, upsertProspect, addEvent, listProspects, isConfigured } from "./store.js";
import { followUpDate } from "./schema.js";

/**
 *   npm run crm:init   -- create the table + indexes (safe to re-run)
 *   npm run crm:seed   -- add two throwaway rows to prove reads/writes work
 *   npm run crm:list   -- print every prospect
 */
const cmd = process.argv[2] ?? "init";

if (!isConfigured()) {
  console.error(
    "❌ AWS credentials missing.\n" +
      "   Add AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION to .env\n" +
      "   (the same values as the youtube-summarizer project).",
  );
  process.exit(1);
}

try {
  if (cmd === "init") {
    const r = await ensureTable();
    console.log(r === "created" ? "✅ Table created with both indexes." : "✅ Table already exists.");
  } else if (cmd === "seed") {
    const a = await upsertProspect({
      businessName: "Dreamframe Studios",
      phone: "7842160862",
      instagramUrl: "https://instagram.com/dreamframe",
      businessType: "wedding-photography",
    });
    await addEvent({
      prospectId: a.prospectId,
      by: "me",
      outcome: "interested",
      notes: "Spoke to the owner. Shoots ~20 weddings a year, misses calls on shoot days.",
      direction: "outbound",
      followUpDue: followUpDate("3_days"),
    });
    const b = await upsertProspect({
      businessName: "Glow Studio Salon",
      instagramUrl: "https://instagram.com/glowstudio",
      businessType: "salon",
    });
    console.log(`✅ Seeded ${a.businessName} (${a.prospectId}) and ${b.businessName} (${b.prospectId}).`);
    console.log("   The second has no phone — that path has to work for scraped prospects.");
  } else if (cmd === "list") {
    for (const p of await listProspects()) {
      console.log(
        `  ${(p.businessName ?? "").padEnd(22)} ${(p.phone ?? "—").padEnd(15)} ` +
          `due=${p.followUpDue ?? "—"}  ${p.prospectId}`,
      );
    }
  } else {
    throw new Error(`Unknown command "${cmd}". Use: init | seed | list`);
  }
} catch (err) {
  console.error(`❌ ${(err as Error).message}`);
  process.exit(1);
}
