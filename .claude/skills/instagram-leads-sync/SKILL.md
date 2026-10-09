---
name: instagram-leads-sync
description: Pull the photographers you follow on Instagram into the Voicelink CRM — read the following list from the logged-in browser, scrape each profile through Apify, then score and import them as prospects. Use whenever the user wants to sync, refresh, import or load new followers, new prospects or new leads into the CRM or DynamoDB; phrasings like "load my new follows", "sync Instagram leads", "I followed some more photographers", "refresh the prospect list", or just "run the lead pipeline". Re-running is safe and only picks up accounts followed since last time.
---

# Instagram leads → CRM

Three steps. You follow photographers by hand; this turns them into ranked,
callable prospects in the `new` tray.

```
[1] following list   Chrome, logged in      free
[2] profile details  Apify                  $0.0026/profile
[3] map + import     local                  free
```

Repos: scraping lives in `../koel-leads`, the CRM in this one. Full design in
`../koel-leads/docs/plan.md`.

## Before starting

- **Claude in Chrome connected**, logged into the **photographer** account.
- **Voicelink API running** (`npm run serve`) — step 1.5 needs it to skip
  handles already in the CRM, which is what keeps a re-run cheap.
- Apify credit on the key that owns the runs (see step 2).

---

## Step 1 — read the following list

Open Instagram in a Chrome tab, then **verify which account is logged in before
anything else**. There are at least three Instagram accounts across these
projects and only one holds photographers; a wrong account pours clinics into a
calling CRM.

```js
const id=(document.cookie.match(/ds_user_id=(\d+)/)||[])[1];
'user_id='+id+' // '+(document.querySelector('img[alt$="profile picture"]')?.alt||'?')
```

Show the user the account and the first few handles it follows. **Stop if they
are not photographers.**

Then page the whole list. Start it without awaiting, then poll — see Gotchas.

```js
const id=(document.cookie.match(/ds_user_id=(\d+)/)||[])[1];
window.__all=[]; let cursor=null, pages=0;
while(pages<40){
  const u=`/api/v1/friendships/${id}/following/?count=100`+(cursor?`&max_id=${encodeURIComponent(cursor)}`:'');
  const res=await fetch(u,{headers:{'x-ig-app-id':'936619743392459'},credentials:'include'});
  if(!res.ok){ window.__err='status '+res.status+' on page '+pages; break; }
  const j=await res.json();
  window.__all.push(...(j.users||[]));
  pages++;
  if(!j.has_more||!j.next_max_id) break;
  cursor=j.next_max_id;
  await new Promise(r=>setTimeout(r,800+Math.random()*700));
}
'total= '+window.__all.length+' // pages= '+pages+' // err= '+(window.__err||'none')
```

Export by download — the tool output guard truncates bulk JSON:

```js
const esc=s=>{s=(s==null?'':String(s));return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
const cols=['username','full_name','pk','is_private','is_verified'];
const csv=cols.join(',')+'\n'+window.__all.map(u=>cols.map(c=>esc(u[c])).join(',')).join('\n')+'\n';
const b=new Blob([csv],{type:'text/csv'}),url=URL.createObjectURL(b),a=document.createElement('a');
a.href=url;a.download='following_export.csv';document.body.appendChild(a);a.click();a.remove();
'wrote '+window.__all.length
```

```bash
mv ~/Downloads/following_export.csv ../koel-leads/data/following_export.csv
```

The response carries **no followers, bio or category** — only handles and
names. That is why step 2 exists.

## Step 1.5 — keep the re-run cheap

```bash
cd ../koel-leads && python3 scripts/filter_new.py
```

Prints `N followed · N already in CRM · N new` and writes `data/new_handles.json`.
**If nothing is new, stop and say so** — do not run step 2 for zero handles.
Report the estimated cost and let the user confirm before spending.

## Step 2 — scrape profiles (Apify, costs money)

Actor `apify/instagram-profile-scraper` (`dSCLg0C3YEZ83HzYX`), input
`{"usernames": [...from new_handles.json...], "includeAboutSection": false}`.
`waitSecs` is capped at **45**. Runs take ~30s for 130 profiles.

Fetch the dataset to disk rather than through context — the raw run is ~17 MB:

```bash
cd ../koel-leads && bash -c '
set -a; . ../youtube-summarizer-v2/.env; set +a
TOK="$APIFY_API_KEY_NKINBOX"    # APIFY_API_KEY itself returns 403
curl -sS "https://api.apify.com/v2/datasets/<DATASET_ID>/items?token=$TOK&format=json&clean=true&fields=username,fullName,followersCount,followsCount,postsCount,businessCategoryName,biography,externalUrl,private,verified,isBusinessAccount,url" \
  -o data/profiles_raw.json'
python3 -c "import json;d=json.load(open('data/profiles_raw.json'));print(len(d),'profiles')"
```

Keep `profiles_raw.json`. Re-parsing later must never mean re-scraping.

## Step 3 — map, review, import

```bash
cd ../koel-leads && python3 scripts/to_leadrow.py
cd ../Voicelink && npm run crm:import -- ../koel-leads/outputs/following_leads.csv
```

The dry run writes nothing. Show the user the summary line and the top ranked
rows, then apply:

```bash
npm run crm:import -- ../koel-leads/outputs/following_leads.csv --apply
```

Report the `batchId` and that `npm run crm:unimport -- <batchId> --apply` undoes it.

## Gotchas — all of these have bitten before

- **`web_profile_info` is rate-limited to death** on the photographer account
  (HTTP 429 on the first call). Never scrape profiles from the browser; that is
  what step 2 is for. If a 429 appears, stop immediately — repeated hits
  escalate to a checkpoint block, which has already happened to one account.
- **The output guard returns `{}`** for raw JSON or long output. Return short
  plain strings, or export via a Blob download.
- **An `async` IIFE returns `{}`.** Use top-level `await`, which works.
- **CDP times out at 45s per call.** Never `await` a long sleep in-page. Kick
  work off into a `window.__` global without awaiting, then poll with instant
  calls.
- **A running in-page loop cannot be stopped from outside** — reassigning the
  array it iterates does nothing. Navigate the tab to destroy the context.
- **`/api/v1/users/<id>/info/` is not served on www.instagram.com.**
- **`x-ig-app-id: 936619743392459`** is required on every call.
- **Private accounts are dropped** by `to_leadrow.py`: an unreadable bio can
  never yield a phone number.
- **Never set `Contact` in the mapper.** Voicelink's `fromBio` and
  `normalisePhone` own the `PHONE#` pointer format; a second normaliser creates
  duplicate prospects, which means calling someone twice.

## Report at the end

- Followed / already known / newly scraped, and what Apify cost.
- Imported count, batchId, undo command.
- How many of the new prospects have a phone — the rest cannot be called yet.
- New pipeline totals.
