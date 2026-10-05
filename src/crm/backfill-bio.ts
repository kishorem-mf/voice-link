import { listProspects, upsertProspect } from "./store.js";
import { fromBio } from "./lead-map.js";
import { scoreLead } from "./score.js";

/**
 * Recover contacts from the bios of leads already imported.
 *
 * Leads imported before the bio fallback existed only have what the Contact
 * column gave. A business that put "DM booking 7019592008" in its bio is
 * uncontactable in the table while being perfectly reachable in reality — and
 * finding a phone moves it from the bottom tier to the top.
 *
 *   npm run crm:backfill-bio          report what would change
 *   npm run crm:backfill-bio -- apply write it
 */
const apply = process.argv[2] === "apply";
const leads = [...(await listProspects("new", 500)), ...(await listProspects("open", 500))] as any[];

let changed = 0;
for (const p of leads) {
  const found = fromBio(p.bio);
  const phone = p.phone ?? found.phone;
  const email = p.email ?? found.email;
  if (phone === p.phone && email === p.email) continue;

  // A recovered phone changes the tier, so the score has to be recomputed.
  const score = scoreLead({
    followers: p.followers,
    phone,
    email,
    model: p.businessModel,
  }).score;

  changed++;
  console.log(
    `  ${String(p.businessName).slice(0, 36).padEnd(38)}` +
      `${p.phone ? "" : found.phone ? `phone ${found.phone}  ` : ""}` +
      `${p.email ? "" : found.email ? `email ${found.email}  ` : ""}` +
      `score ${p.score} → ${score}`,
  );
  if (apply) {
    await upsertProspect({
      prospectId: p.prospectId,
      businessName: p.businessName,
      phone,
      email,
      score,
      contactFromBio: true,
    } as any);
  }
}

console.log(
  changed
    ? `\n${changed} lead(s) ${apply ? "updated" : "would change"}${apply ? "" : " — re-run with `-- apply`"}`
    : "\nNothing to recover: every bio contact is already stored.",
);
