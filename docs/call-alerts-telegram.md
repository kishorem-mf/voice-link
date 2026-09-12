# Call alerts (Telegram)

Every finished call sends a summary to the business owner's phone within about
a minute — inbound and outbound, answered and missed.

```
📞 Incoming call handled
Dreamframe Studios
From +91 78421 60862 · 1m 5s

🔥 HOT lead · Event: Wedding · Budget · Callback

Priya asked about full-day wedding coverage including drone for
14 Feb 2027. Wants a callback this evening.

▶️ Recording
```

---

## Setup

Add to `.env` (the default bot, used when a client has none of their own):

```
TELEGRAM_BOT_TOKEN=...      # @BotFather → /newbot
TELEGRAM_CHAT_ID=...        # message the bot, then GET /bot<TOKEN>/getUpdates
```

Per-client bots are set in Settings → Client → *Call alerts*. See
[multi-client-setup.md](multi-client-setup.md).

```bash
npm run notify:test       # prove the bot works without placing a call
npm run notify:analysis   # apply the tag fields to both agents
npm run notify:preview    # render real past calls (add `-- send` to deliver)
npm run notify:watch      # poll without the web server (`-- once`, `-- reset`)
```

The watcher starts automatically with `npm run serve`, and stays off entirely
if no bot is configured anywhere.

---

## How it works

Four modules, deliberately separated so a failure is attributable:

| File | Job |
|---|---|
| `notify/telegram.ts` | Delivery only. Knows nothing about calls. |
| `notify/format.ts` | Call → message text. Pure function, no I/O. |
| `notify/analysis.ts` | The tag fields Retell extracts per call. |
| `notify/routing.ts` | **Which client** an alert belongs to. |
| `notify/watcher.ts` | **When** to send. |

Zero npm dependencies — Node's built-in `fetch`.

### Polling, not webhooks

A Retell webhook needs a public URL. On a laptop that means a tunnel whose
address changes on every restart, i.e. re-registering it in Retell mid-demo.
The watcher polls `/v2/list-calls` every 20s instead: works from anywhere,
covers both directions, no infrastructure.

`notifyCall()` is the shared send path, so a webhook can be layered on later
without touching the notifier.

### Routing: by agent, never by active profile

Alerts route on the call's `agent_id`, because every agent belongs to exactly
one profile. Routing by *active profile* would be a privacy breach: inbound
calls arrive for any client at any time, while the app happens to have one
profile selected — so one client's leads would land in another's Telegram.

Falls back to the `.env` bot when a client has none.

### Three safeguards in the watcher

1. **Seeding.** First run records existing calls and sends nothing. Without it,
   switching the feature on would fire an alert for every historical call.
2. **Waiting for analysis.** Retell finishes a call, then runs analysis a few
   seconds later. Completed calls are held until the summary lands, with a
   2-minute timeout so a failed analysis still alerts. Unanswered calls skip the
   wait — no analysis is coming, and a missed enquiry is the most urgent alert.
3. **Dedupe that survives restart.** Sent ids persist in `notified-calls.json`
   (gitignored). An id is recorded even when delivery fails, so a revoked token
   can't queue an alert storm for when it's fixed.

### Failure is always silent

`sendTelegram()` never throws. A Telegram outage, a revoked token or a wrong
chat id degrades to a logged warning. A messaging problem must never drop a
call.

---

## The tags

Configured on both agents via `npm run notify:analysis`, landing in
`call_analysis.custom_analysis_data`:

`caller_name` · `event_date` · `event_type` · `budget_mentioned` ·
`callback_needed` · `lead_quality` (hot/warm/cold)

Retell supplies `call_summary`, `user_sentiment` and voicemail detection for
free, so only these six cost analysis tokens.

**Tags apply to the next call only** — Retell runs analysis once, at hangup.
Past calls keep whatever they had.

Noise is suppressed on purpose: fields the call never covered come back
`"unknown"` and are dropped, `false` booleans produce no line, and sentiment
appears only when negative. Without this, every alert would carry six empty
rows. A clinic variant (`CLINIC_FIELDS`) is also available.

Keep the list short — six is about the ceiling before the alert stops being
scannable on a lock screen.

---

## Demo mode

Settings → Client → **🎯 Demo mode** points a profile's alerts at a prospect's
phone, so the pitch lands on *their* device.

1. Prospect scans the QR → opens the bot → taps **Start**
2. Their name appears in the list on its own (polls every 4s)
3. Click **Send alerts here** — a test message lands immediately
4. Run the call demo; the summary arrives on their phone
5. Click **↩️ Send alerts back to me**

Telegram forbids a bot messaging first, so contact from their side is
unavoidable — the QR just makes it a two-second scan.

**Only run this on a profile flagged `isDemo`.** On a live client it would send
their real leads to a stranger until undone. The UI warns in red on any other
profile.

---

## Why Telegram rather than SMS or WhatsApp

The alert goes to **one person — the owner**, not to customers. That sidesteps
the expensive paths:

- **SMS to Indian numbers** needs DLT registration: sender id and every
  template pre-registered with TRAI, plus a provider. Weeks of setup to message
  one person.
- **WhatsApp** is what owners actually want, but needs Meta Business
  verification and template approval *per client*.
- **Telegram** needs a bot token and one message from the recipient. Free,
  instant, no verification, no per-client compliance.

WhatsApp is the natural upgrade once a client is paying.
