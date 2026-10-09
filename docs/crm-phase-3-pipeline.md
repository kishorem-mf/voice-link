# Lead pipeline — from "accounts I follow" to a ranked prospect

Status: **plan only, not built.** Awaiting approval.

Today leads arrive as a spreadsheet someone produced by hand, and
`npm run crm:import` is the only way in. This replaces that with a repeatable
pipeline: follow photographers on Instagram, and they turn up in the `new`
tray with a phone number, ranked and ready to call.

## What already exists

`../scrape_doctors` is a working version of most of this — 442 profiles
scraped, and an enrichment pass that finds real phone numbers. Three skills:

| Skill | Does | Needs |
|---|---|---|
| `/follow-instagram` | Follows handles via Instagram's web API | Logged-in Chrome |
| `/follow-and-scrape` | Profile details via `web_profile_info`, Apify fallback on HTTP 400 | Logged-in Chrome |
| `/enrich-profiles` | Verified phone/website/location via Google Maps | Apify only |

`/enrich-profiles` is the valuable one. The CRM ranks on contactability —
a lead with a phone outranks everything without one — and today 38 of 54
imported leads have no phone at all, because bios rarely carry them.
Maps does.

## The stages, and where each can run

| # | Stage | Runs where | UI-triggerable |
|---|---|---|---|
| A | Read the accounts you follow | Logged-in Chrome | **No** |
| B | Scrape each profile | Logged-in Chrome (Apify fallback) | **No** |
| C | Enrich: verified phone via Maps | Server, Apify HTTP API | Yes |
| D | Map + score + load to DynamoDB | Server | Yes |

### Stage A — what the API actually returns

Verified live on 2026-10-05 against a logged-in account:
`GET /api/v1/friendships/<your_id>/following/?count=N` → HTTP 200, with
`users`, `big_list`, `page_size`, `next_max_id`, `has_more`, `status`.

Each entry in `users[]` carries **exactly** these fields:

```
account_badges, fbid_v2, full_name, has_anonymous_profile_picture, id,
is_favorite, is_private, is_verified, latest_reel_media, pk, pk_id,
profile_pic_id, profile_pic_url, strong_id__, third_party_downloads_enabled,
username
```

Note what is **absent**: no follower count, no biography, no category, no
external URL. Every field the CRM scores on is missing, so **stage B is not
optional** — stage A yields a spine of handles, nothing that can be ranked.

Two things it does hand over free:

- **`pk`** — the numeric user id. The follow flow currently spends a
  `web_profile_info` request per handle purely to resolve this before
  `friendships/create`; reading the following list removes that lookup.
- **`is_private`** — a private account is a dead lead, since its bio cannot be
  read. Dropping them in stage A means never paying to scrape or enrich them.

Pagination is `next_max_id` with `has_more`, so a few hundred follows is a
handful of requests — unlike the follow endpoint, nowhere near a rate limit.

### The constraint worth stating plainly

**A and B cannot be a button.** Both read Instagram as *you*, from your
logged-in browser session. An Express route has no such session. The only way
to make them server-side is to store your `sessionid` cookie on the server and
drive Instagram with it — which breaks Instagram's terms, and risks a
checkpoint on the very account your whole lead pipeline depends on.
`scrape_doctors` has already hit that wall once: its follow step has been
disabled since 2026-08-21 behind exactly such a challenge.

Not worth it. A and B stay a browser step you run from a Claude session,
roughly as often as you add photographers — which is a manual act anyway.

### What the button does

The UI owns **C and D**, which is where the slow, repeatable, costly work is.
Stage B ends by POSTing scraped profiles to a new endpoint rather than writing
a CSV someone has to move, so there is no file shuffling between the two
halves — the browser step hands off over HTTP and the pipeline takes it from
there.

## Pipeline run model

A run is a record, so the UI can show progress and a run can be resumed:

```
pk = "RUN#<runId>"   sk = "STATUS"            overall state, counts, cost
pk = "RUN#<runId>"   sk = "STAGE#<n>#<name>"  per-stage state and errors
```

- Stages are **idempotent**. `/enrich-profiles` already caches raw API
  responses per handle, so a re-run never re-pays for a row it has done.
- A run that dies mid-way resumes from the first incomplete stage.
- `runId` doubles as the import `batchId`, so `crm:unimport` already rolls a
  bad run back.

New API routes: `POST /api/pipeline/runs` (start), `GET /api/pipeline/runs/:id`
(poll), `GET /api/pipeline/runs` (history). A new **Pipeline** tab shows the
stages, counts, cost so far, and what landed.

## Vertical config — photographers, not doctors

The enrichment helper carries healthcare vocabulary in about ten places. Rather
than fork it per trade, lift that into one config and pick a vertical:

| Thing | Doctors | Photographers |
|---|---|---|
| Institution words | hospital, clinic, diagnostics | studio, films, productions, media, frames |
| Honorifics | dr, prof — stripped | none; "Dr" in a handle is a red flag, not a title |
| Category match | doctor, dentist, health | photographer, videographer, wedding photography |
| Maps query | `<name> clinic <city>` | `<name> wedding photographer <city>` |

This belongs in **Voicelink**, not in `scrape_doctors` — the CRM is here, and
the business-type list already anticipates salons, clinics and caterers. Leave
`scrape_doctors` untouched; it holds 442 rows of real data and a working state.

## Mapping into the CRM

`profiles_enriched.csv` → the `LeadRow` shape `mapLead` already reads:

| Enriched column | LeadRow | Note |
|---|---|---|
| `full_name` / `handle` | Name | handle is the fallback |
| `Instagram URL` | Profile URL | |
| `followers` | Followers | drives the reach score |
| `category` | Category | picks trade and service/product |
| `verified_phone` → `Phone Number` | Contact | **verified wins** |
| `bio` | Bio | still mined as a last resort |
| `verified_city` / `Location` | City | |

Everything downstream is reused unchanged: `splitContact`, `fromBio`,
`scoreLead`, phone/handle dedupe, `batchId`, `crm:unimport`.

**`verified_phone` wins over the bio-derived number.** Maps-confirmed beats a
regex guess. But a bio number you have already dialled is worth more than
either, so: never overwrite a number on a prospect that has a logged call.
Record the losing number as `altPhone` so a disagreement stays visible rather
than being silently resolved.

## Cost

| Stage | Per profile | 100 profiles |
|---|---|---|
| B — free scrape | $0 | $0 |
| B — Apify fallback (business accts) | $0.0027 | ~$0.05 |
| C — Maps enrichment | ~$0.006 | ~$0.60 |

Under a dollar a run. Cost is not the constraint; the Maps match rate is.

## The risk worth measuring first

I said last week that enrichment should move a large share of leads into the
phone tier. That holds for clinics — a clinic has premises, so it has a Maps
listing. **It may not hold for photographers.** Many wedding photographers are
individuals working from home with no Google Business listing at all. If the
match rate is low, stage C earns much less than it does in `scrape_doctors`.

So: **pilot stage C on 25 existing leads before building the UI around it.**
That is one afternoon and about fifteen cents, and it tells us whether this
pipeline is worth the rest of the work. If the match rate is poor, the better
answer is a different enrichment source, not a nicer button.

## Build order

1. **Pilot** — run the existing `/enrich-profiles` against 25 of the 54 leads
   already in the CRM, with photographer vocabulary. Measure phone match rate.
   *Go/no-go for the rest.*
2. **Stage A** — new `/scrape-following` skill: read the accounts you follow
   via `friendships/<id>/following/`, paginated, from the logged-in tab.
3. **Vertical config** — lift healthcare vocabulary out of the helper; add the
   photographer vertical.
4. **Stages C+D server-side** — Apify over HTTP, run records, resumable.
5. **Pipeline tab** — trigger, progress, history.
6. **Handoff** — stage B POSTs to the API instead of writing a CSV.

## Open decisions

- Stage A assumes a **dedicated photographer Instagram account**, so everything
  it follows is a lead and no vertical filtering is needed. The doctor-following
  accounts stay out of this pipeline entirely.
- Should a run auto-start stage D, or hold enriched rows for review before they
  reach the `new` tray?
