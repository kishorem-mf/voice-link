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
- **`activity-index`** (PK `EVT`, SK `at`) — every call in one time-ordered
  list. Events were previously reachable only one prospect at a time, so
  "what did I do this week" was impossible.

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
