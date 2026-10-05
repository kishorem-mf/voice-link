# CRM Phase 2 — the Prospects tab

The screen the CRM is actually used through. Everything built so far — the
table, the API, the importer, the Database tab — is plumbing that nobody would
open after a phone call.

Built in three parts, each usable before the next exists.

---

## The premise that shapes every decision

**First calls are made by a person, from their own phone, outside this system.
Sara handles the follow-ups.**

So there are two writers to every prospect's history:

| Writer | When | Recorded as |
|---|---|---|
| **You** | after a call you made yourself | `by: "me"` |
| **Sara** | automatically, when a VoiceLink call ends | `by: "sara"` |

Both go through the same `addEvent`, so the rows are identical in shape and
differ only in that field. A prospect's timeline should read *you* called on
the 3rd, *Sara* confirmed on the 10th, *you* closed on the 12th — showing where
the human contact went, rather than blurring your conversations into hers.

Manual entry is therefore the **primary** path, not a fallback. A prospect who
never touches VoiceLink has to work perfectly.

---

## Part 2a — the list (~30 min)

A **Prospects** tab with two views, toggled:

```
TO CALL (54)                           ← scraped leads, best first
  Thiru Wedding Photographer    1073    77,194   Hyderabad
  FocuzStudios                  1071    69,249   Bangalore

IN PROGRESS (2)                        ← spoken to, most urgent first
  Dreamframe Studios   first 20d   last 7d   due 13d ago ⚠
  Glow Studio Salon    first  —    never     no follow-up
```

- Columns follow the view, as in the Database tab: the calling queue shows
  score and reach, the pipeline shows ages.
- Overdue in red; ages with the exact date on hover.
- Counts from `GET /api/crm/pipeline`.

Read-only. Already usable — this is your calling queue with a notebook.

**Reuses:** `GET /api/crm/prospects?status=`, `/pipeline`, and the `age()` /
`dueAge()` helpers from the Database tab.

**Done when:** 54 ranked leads appear, and Dreamframe shows 13 days overdue.

---

## Part 2b — the prospect page and logging (~50 min)

The part that decides whether any of this gets used.

### The page

```
Dreamframe Studios                            [ Call myself ] [ Sara calls ]
+91 78421 60862 · @dreamframe · Bangalore
first contact 20d · last contact 7d · due 13d ago

History
  27 Sep   you    Demo booked     "Tuesday 11am"
  13 Sep   you    Interested      "Shoots ~20 weddings a year"
  13 Sep   Sara   No answer
```

Details editable in place. Every line says who made the call.

### The log form — always visible, never behind a menu

```
What happened   [ Demo booked ▾ ]
Call back       [ In 3 days  ▾ ]
When            [ just now   ▾ ]      ← see below
Notes           ______________________
                                 [ Save ]
```

**Why "when" exists.** You will usually log a call some minutes after it ends —
walking back to the car, between meetings. Defaulting silently to *now* is
mostly right, but the field has to be there, because `lastContactedAt` feeds
the "last contact 7d" age the whole pipeline view is read by. A wrong timestamp
quietly corrupts the number you act on. Options: *just now*, *earlier today*,
*yesterday*, *pick a date*.

### The two call buttons

- **Call myself** — reveals the number, large, tap-to-dial on a phone. The app
  is not placing the call; you are. Logging afterwards is manual.
- **Sara calls them** — places the call through VoiceLink for the active
  client, using the existing `placeCall()`.

**This button is the missing link in the current build.** Sara answers inbound
and you can dial manually from "Make a Call", but nothing says *ring this
prospect*. No new plumbing is needed: `placeCall()` exists, and the watcher
already matches a finished call back to a prospect **by phone number** through
the `PHONE#…` pointer row. The phone number is the link.

### What saving does

One `POST /api/crm/prospects/:id/events`, which already:

- appends the event with `by: "me"`
- moves `new → open` on first contact, stamping `openedAt`
- sets `followUpDue` from the dropdown, stored as a real date
- closes the prospect when the outcome is marked `closes` — a won customer
  leaves the daily list without anyone remembering to change a status

**Done when:** logging a call on a real lead moves it out of *to call*, and it
reappears in *in progress* on the right day.

---

## Part 2c — the edges (~20 min)

- **Search** across business name, phone and Instagram handle. Filters the
  loaded view client-side; `findByPhone` for an exact number.
- **Add prospect** — business name required, phone and Instagram optional. For
  the number that rings you unprompted.
- **Mobile layout** — single column, large tap targets. You will be logging
  calls outside someone's office, not at a desk.

---

## Phase 3 — Sara writes back (~45 min)

The second writer, built after 2a–2c have survived a week of real use, so the
shape of a prospect is settled before anything writes to it automatically.

In `notifyCall()`, after the Telegram alert — so a CRM failure can never cost
an alert:

1. Match the call's number to a prospect via the phone pointer.
2. **Insert** a stub prospect if there is no match. An inbound enquiry from a
   stranger is the most valuable row there is and must not be dropped.
3. **Append** the event with `by: "sara"`, carrying the recording URL, duration
   and the tags she already extracts.
4. **Set the outcome from those tags** — hot lead → *Interested*, no answer →
   *No answer* — and leave it editable. An unreviewed guess is more useful than
   an empty row nobody goes back to complete.

---

## What already exists

Nothing new is needed underneath. Every action maps to a tested function:

| Screen action | API | Answered by |
|---|---|---|
| To-call list | `GET /prospects?status=new` | `status-index` |
| In-progress list | `GET /prospects?status=open` | `status-index` |
| Counts | `GET /pipeline` | `status-index`, counted |
| Prospect page | `GET /prospects/:id` | all rows under `P#<id>` |
| Save a call | `POST /prospects/:id/events` | event + profile update |
| Add prospect | `POST /prospects` | profile + pointers, one transaction |
| Search by number | `GET /lookup?phone=` | `PHONE#…` direct read |
| Sara calls them | `POST /api/call` | existing `placeCall()` |

---

## Decisions already settled

- **Follow-ups store a real date**, not the dropdown label. "Next week" cannot
  be sorted or chased.
- **Outcomes marked `closes` move the prospect's tray themselves.**
- **Timestamps are stored UTC, rendered local.** A call logged at 01:53 IST
  stores as the previous day in UTC; showing that raw is wrong and confusing.
- **Ages, not dates**, with the exact moment on hover — `20d`, `7d`, `never`.

## The one thing that decides whether this works

The log form has to be fast. If recording a call takes longer than about ten
seconds, it gets postponed and then never happens, and the CRM quietly dies
with a month of missing history. Everything else here can be imperfect; that
cannot.
