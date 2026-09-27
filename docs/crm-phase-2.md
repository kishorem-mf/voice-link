# CRM Phase 2 — the Prospects tab

Everything built so far is plumbing: a DynamoDB table, an API, and a Database
tab for inspecting it. None of it is usable after a phone call. Phase 2 is the
screen you actually work in.

**The premise that shapes every decision here:** most first calls are made by a
person, from their own phone, outside this system. Sara handles follow-ups. So
manual entry is the primary path, and it has to be faster than the excuse not
to do it.

---

## A Tuesday morning with it

### 9:10 — open the Prospects tab

```
⚠ OVERDUE   Bella Weddings        due 22 Sep    last called 15 Sep
● TODAY     Dreamframe Studios    due 27 Sep    demo booked
            Glow Studio Salon     no follow-up  from Instagram, no phone yet
            Sunrise Caterers      due 3 Oct     interested

Live 4   ·   Won 1   ·   Lost 2
```

Sorted by follow-up date, soonest first. Bella is red because you promised the
22nd and didn't call. That is your morning, in order, without deciding
anything.

Prospects with no follow-up sort last rather than vanishing — Glow Studio came
from an Instagram scrape and has no phone number yet, which is a normal state,
not an error.

### 9:12 — call Bella Weddings

Tapping the name opens their page: details at the top, every call beneath in
date order.

```
15 Sep   you    Interested       "Wants Feb dates, budget unclear"
 8 Sep   Sara   No answer
 8 Sep   you    Call back later  "Shooting, asked to try Monday"
```

Each line says who made the call. That distinction is the point of the `by`
field: the timeline should show where the human touch went, not blur your
conversations into Sara's automated ones.

A **Call** button dials through the active client's number.

### 9:18 — hang up and log it

The quick form is already on the page, not behind a menu:

```
What happened   [ Demo booked ▾ ]
Call back       [ In 3 days  ▾ ]
Notes           Booked Thursday 4pm. Wants the drone package.
                                                    [ Save ]
```

Bella turns green, moves down the list, and reappears on Friday.

**This step decides whether the whole thing works.** If logging a call takes
longer than about ten seconds, it gets postponed and then never happens. Hence:
form on the page, dropdowns not free text, and a layout that works one-handed
on a phone — because you will be doing this outside a client's office, not back
at a desk.

### 9:30 — an unknown number rings

Type it into the search box. Nothing found, so tap **Add**, enter the business
name, log the call. They exist in the system before the kettle boils.

### Friday — "what did I do this week?"

```
Tue 9:18   Bella Weddings      Demo booked     (you)
Tue 9:31   Kiran Photography   Interested      (you)
Wed 6:15   Sunrise Caterers    No answer       (Sara)
Thu 16:00  Bella Weddings      Closed won      (you)
```

Your calls and Sara's side by side, across every prospect.

Bella has already left the live list, because "Closed won" closes the prospect
automatically. Nobody has to remember to change a status — relying on that is
how CRMs rot.

---

## What gets built

| Piece | Notes |
|---|---|
| **Prospects list** | Overdue red, today next, rest after. Tray counts at the top. |
| **Search** | Business name, phone, Instagram handle. Filters the loaded tray client-side. |
| **Prospect page** | Details editable in place, full timeline, Call button. |
| **Quick log form** | Outcome → follow-up → notes → Save. On the page, not behind a menu. |
| **Add prospect** | Business name required; phone and Instagram optional. |
| **Activity view** | "This week", across all prospects. |
| **Mobile layout** | Single column, large tap targets. |

### Nothing new is needed underneath

Every query this screen makes already exists and is tested:

| Screen action | API | How it's answered |
|---|---|---|
| Prospects list | `GET /api/crm/prospects?status=open` | `status-index` |
| Tray counts | `GET /api/crm/pipeline` | `status-index`, counted |
| Prospect page | `GET /api/crm/prospects/:id` | all rows under `P#<id>` |
| Save a call | `POST /api/crm/prospects/:id/events` | writes event + updates profile |
| Add prospect | `POST /api/crm/prospects` | writes profile + pointer rows |
| Search by number | `GET /api/crm/lookup?phone=` | direct read of `PHONE#…` |
| This week | `GET /api/crm/activity?days=7` | `activity-index` |

Phase 2 is the interface only. Roughly **90 minutes**.

---

## Decisions already made, worth not relitigating

**Follow-ups store a real date, not the label.** "Next week" cannot be sorted
or queried. The dropdown is only how the date gets chosen.

**Outcomes marked `closes` move the prospect's tray themselves.** Won and lost
prospects leave the daily list without human intervention.

**Timestamps are stored UTC and must be rendered in local time.** A call logged
at 01:53 IST stores as the previous day in UTC; showing that raw would be
confusing and wrong.

**Dates are computed from local time, not `toISOString()`.** That bug already
bit once: between midnight and 05:30 IST, follow-ups landed a day early.

---

## Phase 3, for context

Sara writes her own calls into the same timeline (`by: "sara"`), an unknown
caller auto-creates a stub prospect, and the outcome is inferred from the tags
she already extracts. Small — roughly 45 minutes — but it should come after
Phase 2 has survived a week of real use, so the shape of a prospect is settled
before anything writes to it automatically.
