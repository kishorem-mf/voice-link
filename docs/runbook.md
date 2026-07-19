# Runbook — Outbound AI Calling Harness

Operational guide for running, verifying, and troubleshooting the VoiceLink
outbound calling harness. **Active provider: Retell** (the web UI runs on Retell).
ElevenLabs remains available via CLI. For the confirmed-good settings see
[working-configuration.md](./working-configuration.md).

---

## 0. Retell — active provider (quick reference)

The web UI (`npm run serve`) is powered by Retell. Retell commands:

```bash
npm run retell:config    # validate Retell env vars
npm run retell:auth      # validate key; list agents + phone numbers
npm run retell:agent     # create LLM + agent (prints RETELL_AGENT_ID)
npm run retell:import    # import the DID via SIP trunking + bind outbound agent
npm run retell:voice     # list Indian voices / set agent voice (also in UI Settings)
npm run retell:dial -- +91XXXXXXXXXX   # place an outbound call
```

Required `.env`: `RETELL_API_KEY`, `RETELL_AGENT_ID`, `RETELL_FROM_NUMBER`
(the DID `+919429391391`), optional `RETELL_TECH_PREFIX`. Retell setup (agent +
number import) is fully API-driven — no dashboard steps needed.

The sections below (ElevenLabs) are retained for reference / CLI fallback.

---

## 1. Prerequisites
- Node.js 18+ (uses built-in `fetch`)
- `.env` filled in with working values (see working-configuration.md)
- VoiceLink trunk BOT Provider = **RETELL** (active), DID routed to the trunk

## 2. First-time setup
```bash
npm install
cp .env.example .env     # then fill in real values (or restore known-good .env)
npm run build            # type-check; should exit clean
```

## 3. Daily / pre-call health checks (all safe, no calls placed)
Run these before a calling session — each is offline or read-only:
```bash
npm run config:check     # env vars load & validate
npm run auth:check       # API key valid; lists agent + phone number
```
Expected `auth:check` output:
```
✅ Auth OK.
Agents (1):        • agent_1801kx9bh8vdeyyt0pm5e89hgs2v  "VoiceLink-Outbound"
Phone numbers (1): • phnum_8801kx7xx7xfefnr13m0wrzyfj05  +919429391391 [sip_trunk]
```

## 4. Place a call
```bash
# Optional: start the webhook first to capture the outcome (see section 5)
npm run dial -- +917842160862      # plain E.164, no prefix
```
Success looks like: `✅ Call accepted by ElevenLabs` with a `conversationId`.
**Only one call at a time** — wait for the previous call to end (1-channel limit).

## 5. Capture call outcomes (optional but recommended)
```bash
npm run webhook                    # starts server on WEBHOOK_PORT (3000)
```
To let ElevenLabs reach it, expose it and register the URL as the agent's
post-call webhook in the ElevenLabs dashboard:
```bash
ngrok http 3000                    # then use the https URL + /webhook/call
```
Outcomes append to `call-outcomes.json` (JSON Lines).

## 6. Verify a call after the fact
List recent conversations and inspect one:
```bash
# recent calls for the agent
curl -s "https://api.elevenlabs.io/v1/convai/conversations?agent_id=agent_1801kx9bh8vdeyyt0pm5e89hgs2v&page_size=5" \
  -H "xi-api-key: $ELEVENLABS_API_KEY"

# one conversation's status / duration / transcript
curl -s "https://api.elevenlabs.io/v1/convai/conversations/<conversation_id>" \
  -H "xi-api-key: $ELEVENLABS_API_KEY"
```
A healthy call: `status=done`, `call_duration_secs > 0`, non-empty transcript.

## 7. Re-provisioning (only if agent/number changes)
```bash
npm run agent:create               # creates a new agent, prints its id -> put in .env
npm run provision                  # assigns agent to number + sets transport=TCP
```
Note: `provision` writes to the phone number via the API field
`outbound_trunk_config` (the read model calls it `outbound_trunk`; sending the
read-model name is silently ignored).

---

## 8. Troubleshooting matrix

**Retell (active provider)**

| Symptom | Likely cause | Action |
|---|---|---|
| `401` on Retell endpoints | Wrong/expired key | Check `RETELL_API_KEY` (`npm run retell:auth`) |
| Call status `not_connected` / `dial_no_answer` | Rang out with no answer, **or** not reaching the handset | If it didn't ring at all, set `RETELL_TECH_PREFIX=45454`; otherwise just answer/retry |
| Call runs long / caller forgot to hang up | Retell defaults are 60-min max / 10-min silence | Settings → **Call limits**: we cap at 5-min max + 30-s silence auto-end. Lower if needed (Retell min 1 min / 10 s) |
| `create-phone-call` rejects the number | `from_number` not imported into Retell | Run `npm run retell:import` to import the DID + bind the outbound agent |
| UI shows no calls / recording missing | Recording not ready yet, or agent id mismatch | Recording appears once the call ends; confirm `RETELL_AGENT_ID` matches the number's outbound agent |

**ElevenLabs (reference / CLI fallback)**

| Symptom | Likely cause | Action |
|---|---|---|
| `401 Invalid API key` | Wrong key, or base URL points at a residency endpoint the key isn't for | Check `ELEVENLABS_API_KEY`; ensure `ELEVENLABS_BASE_URL=https://api.elevenlabs.io/v1` |
| SIP `404 Not Found` | Wrong dial format, or VoiceLink BOT Provider mismatch | Confirm provider = global **ElevenLabs**; dial plain E.164 (no prefix) |
| `sip request timed out` | VoiceLink not responding — often a tech prefix that doesn't match the provider | Set `TECH_PREFIX=` (empty) |
| SIP `603 Declined` | Call actively rejected — **often the 1-channel limit (line busy)**, or balance/DND/compliance | Ensure no other call is active; check VoiceLink balance & DID/DLT status |
| Phone rings, drops on answer | SIP session didn't fully establish (media/routing) | Verify provider + format; check transport = TCP |
| Second concurrent call fails | Only 1 channel / 1 CPS allocated | Serialize calls, or buy more channels |
| `status=done` but `duration=0` | Call failed before media | Re-check SIP result from the `dial` output |

## 9. Escalate to VoiceLink support when
- Persistent SIP `603`/`404` with a single call and correct config
- Balance, DID routing, DLT series, or channel/CPS changes needed
- Use the template in [voicelink-support-request.md](./voicelink-support-request.md)

## 10. Safety notes
- Every `dial` places a **real call** and may incur charges — test against numbers you control.
- Do not run bulk/cold-call volume until DLT compliance is approved (DID is not on a DLT 140/160 series).
- `.env` holds a live API key — never commit it (already in `.gitignore`).
