# CRM plan — call and prospect tracking on DynamoDB

A lightweight CRM inside this app, so every prospect has one record and one
timeline regardless of who made the call.

**The key premise:** most first calls are made by a person, from their own
phone, outside this system. Sara handles follow-ups and appointment
confirmations. So manual entry is the primary path and Sara's auto-logging is
an enrichment layer — a prospect who never touches VoiceLink must work
perfectly.

---

## Shape

One write path, two callers:

```
Frontend (Prospects tab) ──► POST/PATCH /api/crm/* ──┐
                                                     ├──► src/crm/store.ts ──► DynamoDB
Sara (watcher, on call end) ─────────────────────────┘
```

Both go through the same store module, so a row written by Sara and a row
written by hand are identical in shape — only the `by` field differs. Sara
calls the store directly rather than looping back through HTTP: it is the same
process, and an internal call cannot fail on a network hop mid-call.

---

## Data model

Single table **`nine-square-crm`**, region `us-east-1` — the same AWS account
as the youtube-summarizer project, whose `storage.py` is the reference for
creating tables and GSIs from code.

### Keys

| | Attribute | Value |
|---|---|---|
| PK | `pk` | `P#<prospectId>`, `PHONE#<e164>`, or `IG#<handle>` |
| SK | `sk` | `PROFILE`, `EVT#<ISO timestamp>`, or `POINTER` |

Three row types, told apart by the `pk` prefix: a prospect's profile, a call
on that prospect, and a lookup row pointing a phone or handle at a prospect.

`prospectId` is generated, **not** the phone number. Prospects often arrive
from Instagram scraping with no phone yet, and phone numbers get corrected —
neither can be a primary key.

### Profile item (`sk = PROFILE`)

`prospectId` · `businessName` · `phone` (E.164, optional) · `instagramUrl`
(optional) · `businessType` (reuses the six trades already in
`business-types.ts`) · `status` · `followUpDue` (ISO date) · `lastContactedAt`
· `createdAt` · `notes`

### Event item (`sk = EVT#<timestamp>`)

`by` — **`me`** or **`sara`**. This is the field that matters: a prospect's
timeline should read *you* called on the 3rd, *Sara* confirmed on the 10th,
*you* closed on the 12th. It shows where the human touch went and stops Sara's
calls from being mistaken for your relationship.

Also: `direction` · `outcome` · `notes` · and, when Sara wrote it, `callId` ·
`durationSecs` · `recordingUrl` · `summary` · `tags` (the six she already
extracts).

### Lookups: POINTER rows, not an index

`PHONE#…` and `IG#…` rows hold nothing but a `prospectId`. Reading one is a
direct, strongly consistent fetch; an index is a copy that lags. Importing a
scraped list twice would otherwise create duplicates by checking a copy that
had not caught up — and the pointer makes uniqueness structural rather than
hoped-for.

### Indexes

- **`status-index`** (PK `status`, SK `followUpSort`) — answers three
  questions with one index: who to call today (`open`, due ≤ today), every
  live prospect, and the count per tray. Keying on status is what stops a won
  customer reappearing in tomorrow's call list — an outcome marked `closes`
  moves them automatically, rather than relying on anyone remembering.
  A prospect with no follow-up sorts under a `9999-12-31` sentinel so they
  still appear in the tray without ever looking due.
- **`activity-index`** (PK `EVT#<YYYY-MM>`, SK `at`) — every call in a
  time-ordered list. Events were previously reachable only one prospect at a
  time, so "what did I do this week" was impossible.

  **Sharded by month on purpose.** A single constant partition would funnel
  every call ever written to one physical partition — capped at 1,000
  writes/sec and a permanent hot spot. Keying by month spreads the writes
  while keeping recent reads cheap: a 7-day lookback touches one partition, or
  two across a month boundary. `recentActivity` walks shards newest-first and
  stops once the limit is met.

### Writes are transactional

A prospect's profile and its POINTER rows are written in one
`TransactWriteItems`. Written separately, a failure between them left a
prospect with no lookup card — silently breaking the dedupe guarantee that
justified pointers over an index. Importing hundreds of scraped leads is
hundreds of chances to half-write one, and the damage only surfaces later as a
duplicate. The same transaction retires stale pointers, so changing a phone
number does not leave the old one pointing at the prospect forever.

`businessName` is filtered client-side over the loaded tray. At a few hundred
prospects that is cheaper than another index; revisit past ~5,000.

### Table name

`nine-square-crm-v2`. DynamoDB cannot change a key schema in place, so the
refined shape is a new table. The original `nine-square-crm` is untouched and
can be deleted once this has proved itself.

### Dropdowns

**What happened:** Interested · Not interested · Call back later · Demo booked
· Wrong number · No answer · Closed won · Closed lost

**Next follow-up:** Tomorrow · In 3 days · Next week · In 2 weeks · Next month
· None — stored as a **real date**, not a label, so it can be sorted and
chased. The label is only how it is picked.

---

## Phase 1 — Store and API ✅ done

- `src/crm/schema.ts` — item types, outcome and follow-up enums, date maths
- `src/crm/store.ts` — create table + GSIs if absent (idempotent, mirroring
  `storage.py`), then: `upsertProspect`, `getProspect`, `listProspects`,
  `findByPhone`, `addEvent`, `listEvents`, `dueToday`
- Routes in `webhook.ts` under `/api/crm/`:
  `GET|POST /prospects` · `GET|PATCH /prospects/:id` ·
  `POST /prospects/:id/events` · `GET /lookup?phone=`
- `npm run crm:init` to create the table, and `npm run crm:seed` for a couple
  of throwaway rows

Verified end-to-end with curl before any UI exists.

**Adds the project's first runtime dependency** (`@aws-sdk/client-dynamodb` and
`@aws-sdk/lib-dynamodb`).

**Credentials are not copied.** They are read from the youtube-summarizer
project's `.env` — the same file its `app.py` loads — so there is one place to
rotate them rather than two, and one to forget. Only `AWS_*` and `DYNAMO_*`
names cross the repo boundary; that file also holds Apify, YouTube and
Anthropic keys this project has no business loading. Anything set in this
project's own `.env` wins. `AWS_ENV_FILE` overrides the path if the repo
moves. See `src/crm/aws-env.ts`.

## Phase 2 — Prospects tab (~90 min)

- **List**: sorted by follow-up due, overdue in red, today next, then the rest.
  Search box filtering on name, phone and Instagram URL. Counts at the top.
- **Detail**: profile fields editable in place, full timeline newest-first with
  a clear marker for who made each call, and a **Call** button that dials
  through the active client.
- **Quick log** — the critical path, because it is used seconds after hanging
  up: phone → outcome → follow-up → notes → Save. Business name and Instagram
  URL are asked only on first contact, then remembered.
- Mobile-friendly layout: the same laptop screen is unusable one-handed, and
  logging that waits until you are back at a desk does not happen.

## Phase 3 — Sara writes to it (~45 min)

- `notifyCall()` in the watcher also calls `addEvent` with `by: "sara"`, after
  the Telegram alert so a CRM failure can never cost an alert
- Unknown numbers auto-create a stub prospect rather than dropping the call —
  an inbound enquiry from a stranger is the most valuable row there is
- Outcome inferred from the tags Sara already extracts (hot lead → Interested,
  no answer → No answer), left editable rather than treated as final
- The Telegram alert gains a line: *"New prospect — no CRM record yet"*, so an
  unknown caller is visible immediately

---

## Deliberately not in scope yet

- **Instagram bulk import** from the scraping repos. Valuable, and the natural
  Phase 4 — but it should wait until the shape of a prospect has survived real
  use for a week.
- **Follow-up reminders to Telegram.** Cheap to add once `followup-index`
  exists; awkward to retrofit if the due date is stored as a label. Hence the
  real-date decision above.
- **Multi-user.** Every row is the one operator's. Adding an `owner` field now
  costs nothing and avoids a migration later, so it is in the profile item.

---

## Scaling: what to change, and when

Measured 2026-10-05 at 173 prospects.

### Where it stands

| | |
|---|---|
| Rows in the `new` tray | 173 |
| Payload per list call | 31 KB (was 108 KB before the projection) |
| Read cost per page load | ~27 RRU ≈ $0.0000034 |
| At 200 page loads/day | **~25¢ a year** |

The list fetches a whole tray and the browser draws a page of it (50 by
default, adjustable). Search filters that in-memory set.

### The cost is not the constraint — the payload is

| rows | payload/load | $/load | feel |
|---|---|---|---|
| 173 | 31 KB | $0.000003 | instant |
| 1,000 | 180 KB | $0.00002 | fine |
| 10,000 | 1.8 MB | $0.0002 | **breaks** |
| 1,000,000 | 180 MB | $0.02 | never loads |

Even at a million rows the bill is a few dollars a day. The page, however,
stops loading about **100× earlier**. Judge this design by load time, not by
the AWS invoice.

### Three gaps, in the order they bite

**1. Tray counts are O(n).** `pipeline()` → `countTray()` uses
`Select: "COUNT"`, which does *not* count cheaply: DynamoDB bills for every
byte scanned to produce the number, so counting a tray costs the same reads as
fetching it. At scale the fix is a maintained counter — an atomic `ADD` on a
counters item at each status transition — not a better query. Not worth the
write-path complexity yet: a missed increment is permanently wrong counts, a
correctness risk traded for a cosmetic gain.

**2. The list fetches the whole tray.** The fix is cursor pagination, and
DynamoDB hands it to you: `LastEvaluatedKey` *is* the cursor. Return N rows
plus an opaque cursor; "Load more" sends it back.

**3. Search is client-side**, which only works because the client holds
everything.

### The trap: 2 and 3 must ship together

Paginating the fetch while search still filters in the browser silently
rebuilds the bug fixed on 2026-10-05, when `listProspects` capped at 100 and
hid 73 prospects: search finds only what has been loaded, so a prospect on
page 4 looks like they were never imported. The failure is invisible and you
meet it mid-dial.

Server-side search is the harder half. Exact lookups are already solved — the
`PHONE#` and `IG#` pointers are O(1). Name search needs a GSI on a normalised
name queried with `begins_with`. Anything fuzzier is an OpenSearch
conversation, and nothing here justifies one.

### Trigger points

- **A tray passes ~2,000** → cursor pagination *and* server-side name search,
  together, never one alone.
- **The dashboard feels slow** → maintained tray counters.
- **Fuzzy or multi-field search is genuinely needed** → only then, a search
  service.

Until then this is the right shape. Leads arrive from Instagram accounts
followed by hand, and one caller places perhaps 20 calls a day — roughly 5,000
a year. The million-row design solves a problem this business cannot generate.

### Already done

`LIST_FIELDS` in `src/crm/store.ts` projects the list query down to what the
Prospects tab draws and searches. The Instagram bio alone was 37% of the
payload and is never shown; the projection cut the response by **71%**.
Callers that need the full row — the bio backfill, the Database tab, the
CLI — simply don't pass it.
