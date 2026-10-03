# CRM Phase 1.5 — import and rank scraped leads

Get real leads into the CRM, ranked, **before** building the Prospects tab.

Building a list UI against two toy rows hides most of its problems — sorting,
long names, missing phones, emoji, how 54 rows scroll. Importing first means
Phase 2 is built against something real. And the import needs no UI to verify:
the Database tab already queries, filters and shows raw JSON.

Source for now: `instagram-influencer-scraping/outputs/all_leads.xlsx` — 54
leads, 10 columns.

**Status:** steps 1–4 are built (import, `new` tray, ranking, rollback).
Step 5, the AI pass, is not.

```bash
npm run crm:import -- path/to/all_leads.xlsx            # dry run: preview + ranking
npm run crm:import -- path/to/all_leads.xlsx --apply    # write, prints the batchId
npm run crm:unimport -- <batchId>                       # dry run: what would go
npm run crm:unimport -- <batchId> --apply               # roll back
```

---

## What the data actually looks like

| Column | Filled | Use |
|---|---|---|
| `Name` | 54/54 | → businessName |
| `Handle`, `Profile URL` | 54/54 | → instagramUrl |
| `Contact` | **17/54** | → phone **or** email — the column mixes both |
| `Category` | 54/54 | `wedding photography` 34, `fashion` 20 |
| `Followers` | 54/54 | → score |
| `City` | 54/54 | stored, not scored |
| `Bio` | 54/54 | → the AI pass |
| `Website` | **0/54** | ignore |

Two thirds have **no phone number**. That is not a failure case — it is the
normal state of an Instagram-first pipeline, and the reason `prospectId` was
never keyed on a phone.

---

## Scoring — already built and validated

[`src/crm/score.ts`](../src/crm/score.ts), checked against all 54 leads with
asserted invariants rather than eyeballing.

Three rules, in order:

1. **Can you phone them.** A tier, not a bonus: every callable lead outranks
   every uncontactable one. Email is a weak second tier — a reply is far less
   likely than a picked-up call.
2. **Service over product.** A service business takes bookings by phone, which
   is the job Sara does; a boutique takes orders through DMs. Demoted by 120
   points, not filtered — widening the focus later is one constant, not a
   re-import.
3. **Followers**, log-scaled, as the tiebreak within a group.

```
 1   1073  =  1000 +  73    77,194 followers   Thiru Wedding Photographer
 9   1000  =  1000 +   0       282 followers   Rollers Production
10    961  =  1000 + 81-120  136,328 followers Pastels Boutique  (product)
18    274  =   200 +  74    85,201 followers   Zero Gravity      (no phone)
```

Result on the real file: **9 callable photographers · 6 callable boutiques ·
2 email-only · 37 unreachable.**

---

## Step 1 — `src/crm/import.ts` ✅

Reads the spreadsheet (`.xlsx`, or `.csv` with the same headers) and writes
prospects. The row mapping lives in [`src/crm/lead-map.ts`](../src/crm/lead-map.ts)
and touches no network, so a dry run checks it even without AWS credentials.
Per row:

1. **Map** — `Name` → businessName, `Handle`/`Profile URL` → instagramUrl,
   `Contact` → phone or email.
2. **Split the Contact column.** It holds both. `swarawomenethnic@gmail.com`
   must not become `PHONE#swarawomenethnic@gmail.com` — a junk lookup row that
   would never match anything.
3. **Normalise** via the existing `normalisePhone` / `normaliseInstagram`, so
   `+91 78270 37954` and `0 78270 37954` resolve to one prospect.
4. **Score** via `scoreLead`.
5. **Write** via `upsertProspect`, which already dedupes on the `IG#…` pointer
   rows and writes profile + pointers in one transaction.

Every row is tagged `source: "all_leads.xlsx"` and a `batchId`, so an import
can be identified and undone.

Re-running is safe: existing prospects are **skipped, not overwritten** — a
later scrape only adds what is new, and never clobbers a note you have since
written.

```bash
npm run crm:import -- path/to/all_leads.xlsx          # dry run, prints a preview
npm run crm:import -- path/to/all_leads.xlsx --apply  # writes
```

The dry run reports before anything is written, then lists every new lead
in the order the `new` tray will return them:

```
54 rows · 54 new · 0 already known · 0 repeated in file · 0 unnamed · 1 contact dropped (not a phone)
17 callable · 2 email-only · 37 no contact
```

A number without a country code is read as Indian and must come out as +91
and ten digits; anything else is reported as dropped rather than stored as a
plausible-looking foreign number. Category is read as a trade and a model
(`wedding photography` → service, `fashion` → product; unrecognised →
`unknown`, scored as a service).

Followers, city, category, bio, score, source and batchId are stored on the
prospect, so a ranking can be explained — and re-scored — without the file.

## Step 2 — the `new` tray ✅

Scraped leads land in `new`, ahead of `open` / `won` / `lost`. They are not
prospects you have spoken to; calling one moves it to `open`.

Uses the existing status index — no new infrastructure. Logging the first
call (by you or Sara) moves the lead to `open`, or straight to `lost`/`won` if
the outcome closes it.

## Step 3 — pre-ranked storage (`traySort`) ✅

The index's sort key carries different things per tray, computed by
`traySort()` in `store.ts`:

| Tray | `traySort` holds | So the tray reads back as |
|---|---|---|
| `new` | inverted score, zero-padded (`1073` → `8926`) | best lead first |
| `open` | the follow-up date | most urgent first |

One index returns each tray already ordered — no sorting in the browser on
every page load. When a lead leaves `new`, its key is rewritten from score to
follow-up date in the same update.

The stored attribute keeps its name, `followUpSort`: it is the index's sort
key, and DynamoDB cannot rename an index key without deleting and rebuilding
the index on the live table. Only the function that fills it was renamed.

The inversion is why the score range matters: a negative score has a minus
sign, which does not sort. Validation caught 13 negative scores and the
no-contact floor was raised to 200; the range is now 86…1073, inside four
digits.

## Step 4 — `crm:unimport <batchId>` ✅

Deletes every prospect and pointer from one import. **This is what makes going
before the UI reasonable rather than reckless** — if the mapping or scoring is
wrong, roll back and re-run instead of hand-fixing 54 rows with no screen.

Refuses to delete a prospect that has calls logged against it, so a rollback
can never destroy work done after the import. Like the import, it previews
first and only deletes with `--apply`.

## Step 5 — `src/crm/enrich.ts` (the AI pass, built second) — not built yet

Deliberately **not** on the critical path: the scraper's `Category` already
gives service vs product for this file, so the import works without any AI.

Its real value is the 37 unreachable leads. Some put their number in the bio
and the scraper did not parse it — Dknott's reads `Enquiry: 9110708…`. One
call per lead over the Bio does three things:

- **Extract phone numbers** the Contact column missed. Each one found moves a
  lead from unreachable (≈274) to callable (≈1050) — by far the biggest
  single improvement available.
- **Classify** service vs product, and pick a trade from the six, with `other`
  allowed so a missing trade shows up as evidence rather than a guess.
- **Judge fit** — a 775-follower photographer with "DM booking" in the bio is
  a better prospect than an 85k studio with an agency behind it.

Runs as a separate re-runnable pass over already-imported leads, using the
Anthropic key already in the youtube-summarizer `.env`. `unknown` counts as a
service, so a lead it cannot read keeps full value rather than being quietly
buried.

---

## Verification, before Phase 2 exists

All through the **Database tab**: Q4 → New shows the `new` tray in rank order, the
raw-JSON toggle shows what was actually stored, and the filter finds a
specific lead. No new UI needed.

## Order and effort

| | |
|---|---|
| Steps 1–4 — import, tray, ranking, rollback | ~75 min |
| Step 5 — AI enrichment pass | ~45 min |

Nothing blocking. Fashion is answered by the product demotion; the AI pass is
off the critical path.

## Explicitly not in this phase

- Uploading a file through the browser — the path is given on the command line
- Reading from S3 — local files are where the scrapers write today
- Column mapping UI — this one spreadsheet's shape is known and hardcoded;
  generalise when a second format actually appears
