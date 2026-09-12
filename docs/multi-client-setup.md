# Multi-client setup (one profile per client)

How to run this app for several businesses at once — each with their own phone
number, their own persona, and their own alerts.

Onboarding a client is **configuration only**. No code changes are needed.

---

## The model

One **profile** = one client. A profile owns:

| Field | What it is |
|---|---|
| `fromNumber` | Their DID (the phone number callers dial) |
| `terminationUri` | Their VoiceLink account's SIP endpoint |
| `businessName` | Their trading name — the agent says this out loud |
| `businessType` | Which persona template they start from |
| `outboundAgentId` / `inboundAgentId` | **Their own Retell agents** |
| `telegramBotToken` / `telegramChatId` | **Their own alert bot** |
| `isDemo` | Marks a throwaway profile used for sales demos |

Stored in `voicelink-profiles.json` (gitignored — it holds bot tokens).

## Why each client needs its own agents

This is the part that is easy to get wrong.

**Retell decides which agent answers an inbound call from the DID's own
`inbound_agents` binding. The app is never consulted.**

So "which profile is active" means nothing to an incoming call. If two DIDs
point at one agent pair, both answer with the same persona no matter what the
app is set to — a wedding studio's callers would hear a clinic receptionist.
That was a real bug, not a hypothetical.

Per-client agents are therefore required for correctness, not convenience.
Switching the active profile changes what *you* operate on (outbound calls,
settings edits); inbound always answers as whoever owns the number.

---

## Adding a client

### In the app — Settings → Client

1. **+ Add a VoiceLink account** — client name, DID, termination URI, business type
2. **Create this client's agents** — builds their persona and points their DID at it
3. **Bot token + chat id** → *Save bot* → *Send test message*

### Outside the app — two manual steps, neither has an API

4. **VoiceLink portal** → SIP Trunk Management → the RETELL trunk → Call Routing
   Configuration → add the DID to **Inbound Call — DIDs**.
   Skip this and inbound calls never reach Retell at all — they don't even show
   up as failed calls, because the INVITE is never sent.
5. **@BotFather** → `/newbot` → copy the token. The client must then **message
   the bot once** (or add it to their group) before it can message them —
   Telegram blocks bots from messaging strangers.

Roughly 5 minutes per client.

### Finding the termination URI

VoiceLink portal → SIP Trunk Management → Whitelist Configuration → URI (SIP
Signaling). It differs per account — e.g. `app.voicelink.co.in:3300` on one
account and `sip.voicelink.co.in:3300` on another.

---

## Business types

Six presets ship in [`src/retell/business-types.ts`](../src/retell/business-types.ts):
wedding photography, clinic, catering, salon/spa, real estate, general. Each
supplies an outbound **and** inbound persona, with `{business}` substituted for
the client's trading name.

If a client's trade isn't listed, pick **General** and edit the wording in
*Agent persona* — still no code. Only add a new preset when you'll sell to that
trade repeatedly.

Changing a client's business type does **not** rewrite their persona on its own.
Click **Rebuild agents** to apply the new template — which discards any manual
persona edits.

---

## CLI equivalents

```bash
npm run profiles                                   # list every client
npm run profiles -- use <id>                       # switch the active client
npm run profiles -- set <id> businessName "Name"   # rename
npm run profiles -- set <id> businessType clinic   # change trade
npm run profiles -- set <id> isDemo true           # mark as a demo line
npm run profiles:provision -- <id> [--force]       # create/rebuild their agents
```

---

## Demo lines

Demo mode temporarily re-points a profile's alerts at a prospect's phone. On a
paying client that would send their real leads to a stranger until someone
undoes it, so keep a dedicated profile flagged `isDemo` and run demos only
there. The UI shows a red warning on any profile not flagged, and demo profiles
are marked 🎯 in the dropdown.

A DID binds to only one inbound agent, so a demo profile needs its **own**
number — it can't share one with a live client.

See [call-alerts-telegram.md](call-alerts-telegram.md) for the demo flow.

---

## Gotchas

- **Re-pointing an existing DID** uses `update-phone-number`, not
  `import-phone-number` — the latter fails with *"Phone number already exists"*.
  Handled automatically in `import-number.ts`.
- **Settings are client-scoped.** Voice, model, language, limits and persona
  apply to the *active* profile's agents only.
- **New agents are created as `en-IN`.** Older agents carrying Retell's
  multi-language auto-detect list can mis-hear Indian-accented English and
  reply in another language. Check the language setting on any agent that
  predates per-client provisioning.
