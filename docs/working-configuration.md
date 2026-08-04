# Working Configuration — Outbound AI Calling (VoiceLink)

**Active provider:** 🟢 **Retell** (the web UI runs entirely on Retell).
**Prior provider:** ElevenLabs — retained for CLI use, but outbound is blocked by a
carrier-side SIP 603 on the non-DLT DID (see [voicelink-support-request.md](./voicelink-support-request.md)).

VoiceLink support advised switching the trunk to a different provider for outbound;
the VoiceLink trunk BOT Provider is now **RETELL**, and Retell reaches the carrier
where ElevenLabs was declined (`dial_no_answer` instead of `603 Declined`).

---

## Active provider — Retell

| Item | Value |
|---|---|
| Web UI provider | **Retell** (all `/api/*` endpoints) |
| API base URL | `https://api.retellai.com` |
| API key | `.env` → `RETELL_API_KEY` (secret) |
| Agent | `agent_7853768ed7429bf3ab3f590249` ("VoiceLink-Outbound-Retell") |
| **LLM model** | **`gpt-4o-mini`** ($0.006/min) — active; configurable in UI Settings. (Was `gpt-4.1`; switched to cut cost ~87% on the LLM with no quality loss on reminder/offer calls.) |
| **Language** | **`multi` (Hinglish)** — auto-switches Hindi/English; configurable in UI Settings. (No Telugu — Retell has no Telugu voice.) |
| Agent voice | `11labs-*` Indian voices (en-IN, ElevenLabs multilingual v2 ~$0.06/min) — configurable in UI Settings |
| From number (DID) | `+919429391391`, imported into Retell via SIP trunking |
| Termination URI | `app.voicelink.co.in:3300`, Transport **TCP** |
| VoiceLink trunk | `RETELL.nanda kishore`, BOT Provider **RETELL**, Tech Prefix `45454` |
| Dialing | plain E.164 confirmed reaching the carrier; set `RETELL_TECH_PREFIX=45454` if routing to the handset needs the prefix |

**Retell setup was done entirely via API:** `retell:agent` (create agent) →
`retell:import` (import DID + bind outbound agent) → `retell:dial` (place call).

### Active per-minute cost — MEASURED from real billing (not estimated)
Derived from actual Retell call costs (Jul 15, 2026):

| Config | Example call | $/min (measured) |
|---|---|---|
| gpt-4.1 + ElevenLabs (old) | call_7a777c / call_287d24 | ~$0.15/min |
| **gpt-4o-mini + ElevenLabs (current)** | call_3f9701 / call_27913 | **~$0.11/min** |
| gpt-4o-mini + platform voice | call_4a7055 | ~$0.099/min |

**Active config ≈ $0.11/min (~₹9.4/min Retell) + ~₹1/min VoiceLink ≈ ₹10.4/min all-in.**
Per 1,000 calls (~2-min avg) ≈ **₹20,700 all-in** (vs ~₹27k on old gpt-4.1).

**Key learnings from the real data:**
- The **model switch (gpt-4.1 → gpt-4o-mini) was the real lever**: ~$0.04/min (~27%) saved.
- The **platform voice saves only ~$0.015–0.025/min** *and* loses the Indian accent — not worth it.
- Voice Engine ($0.055/min) is Retell's fixed core fee — identical for every voice and the
  single biggest component; no voice choice goes below ~$0.061/min (engine + LLM).

**Cost optimizations applied (Indian voice kept):**
1. **LLM**: `gpt-4.1` → `gpt-4o-mini` ($0.045 → $0.006/min).
2. **Post-call analysis model**: `gpt-4.1` → `gpt-4o-mini` ($0.015 → ~$0.002 **per call**, flat
   saving every call; biggest % on short calls). Sentiment/summary still produced.
   Set via agent field `post_call_analysis_model`.

The UI Settings tab exposes **model, language, and voice** as live dropdowns.
Full rate breakdown: [retell-rate-card.md](./retell-rate-card.md).

---

## Prior provider — ElevenLabs (reference / CLI only)

## The unlock (what made it work)
Switching the **VoiceLink trunk's BOT Provider from `ElevenLabs-IN` to global `ElevenLabs`** was the fix. That aligned VoiceLink's routing/IP expectations with our **global** ElevenLabs account, and calls began completing. No India-residency / Enterprise account was needed.

Before the switch, symptoms were: SIP `404` (India provider + plain number), SIP `404`/timeout (with `45454` tech prefix), and `accepted-but-no-ring`. After the switch, plain E.164 completed.

---

## ElevenLabs account
| Item | Value |
|---|---|
| Account type | Standard / **global** (not India-residency) |
| API base URL | `https://api.elevenlabs.io/v1` |
| API key | in `.env` as `ELEVENLABS_API_KEY` (secret — not committed) |
| Agent | `agent_1801kx9bh8vdeyyt0pm5e89hgs2v` ("VoiceLink-Outbound") |
| Phone number id | `phnum_8801kx7xx7xfefnr13m0wrzyfj05` (+919429391391) |

## ElevenLabs phone-number / SIP trunk settings
| Field | Value |
|---|---|
| Provider | `sip_trunk` |
| Outbound address | `160.30.71.89:3300` |
| Transport | **TCP** |
| Media encryption | Disabled |
| Enabled codecs | `G722/8000`, `PCMU/8000`, `PCMA/8000` |
| Auth | None (IP/ACL based; username/password blank) |
| Assigned agent | `agent_1801kx9bh8vdeyyt0pm5e89hgs2v` |

## VoiceLink side
| Field | Value |
|---|---|
| Trunk | `ELEVENLABS-IN.nanda kishore` |
| **BOT Provider** | **ElevenLabs** (global) — *this is the load-bearing setting* |
| DID | +919429391391 |
| Whitelist | `160.30.71.89:3300` |
| Channels / CPS | **1 / 1** (single concurrent call) |
| DID routing | DID → trunk, active for outbound |

## Dialing format
- **Dial plain E.164** (e.g. `+917842160862`). **No tech prefix** with the global provider.
- The `45454` tech prefix was only relevant to the `ElevenLabs-IN` provider and now causes a timeout — leave `TECH_PREFIX` empty.

## `.env` (working values; key redacted)
```env
ELEVENLABS_API_KEY=af5cf8…            # secret, do not commit
ELEVENLABS_AGENT_ID=agent_1801kx9bh8vdeyyt0pm5e89hgs2v
ELEVENLABS_PHONE_NUMBER_ID=phnum_8801kx7xx7xfefnr13m0wrzyfj05
ELEVENLABS_BASE_URL=https://api.elevenlabs.io/v1
TECH_PREFIX=
WEBHOOK_PORT=3000
```

---

## Inbound + outbound agents (two agents, synced)

The DID runs **two Retell agents**, both assigned on the phone number:

| Direction | Agent | Persona | .env |
|---|---|---|---|
| **Outbound** (calls you make) | `agent_7853768…` (VoiceLink-Outbound-Retell) | Sales — "Meera from Prakto", books demos | `RETELL_AGENT_ID` |
| **Inbound** (calls to the DID) | `agent_8ef75006…` (VoiceLink-Inbound-Retell) | Receptionist — greets patients, books, no medical advice | `RETELL_INBOUND_AGENT_ID` |

- **Setup:** `npm run retell:setup-inbound` creates the inbound agent mirroring outbound's
  voice/model/language/limits, then assigns it to the DID's `inbound_agents` (array form —
  the single `inbound_agent_id` field is deprecated as of 2026-03-31).
- **Shared settings are synced:** changing **voice, LLM model, language, post-call model, or
  call limits** in the UI applies to **both** agents (via `syncAgents` over `getRetellAgentIds()`),
  so they never drift.
- **Personas are per-direction** (not synced) — Settings → Agent persona has an
  **Editing: Outbound / Inbound** toggle. Preset "Clinic Receptionist (Inbound)" seeds inbound.
- Why two agents: inbound patients must hear a *receptionist*, not the outbound sales pitch.

## Call limits — billing safeguard (runaway-call protection)

If the person on the other end forgets to hang up, the call (and billing on both
Retell and VoiceLink) keeps running. Retell's defaults are dangerously loose
(**60-min** max duration, **10-min** silence). Two agent-level settings cap this:

| Setting (Retell field) | Our value | Retell default | Purpose |
|---|---|---|---|
| Max call duration (`max_call_duration_ms`) | **300000 (5 min)** | 3600000 (60 min) | Hard cap — force-ends any call at N ms |
| End after silence (`end_call_after_silence_ms`) | **30000 (30 s)** | ~600000 (10 min) | Ends the call N ms after the user goes silent |
| Reminder (`reminder_trigger_ms` / `reminder_max_count`) | 8000 / 2 | — | Agent nudges "are you there?" twice before the silence timeout ends the call |

Effect: worst-case billing per stuck call drops from **~60 min → 5 min**, and a
silent/abandoned call ends in ~30 s. Retell allows max duration **1–120 min**.

- **Configurable** in the UI: Settings → **Call limits (billing safety)**.
- **New agents** get these automatically (`createAgent` in [src/retell/agent.ts](src/retell/agent.ts)).
- Retell terminating the call also ends the VoiceLink trunk leg (it sends SIP BYE),
  so this one control protects billing on both sides. If VoiceLink also offers an
  account-level max-call-duration, set it as a backstop.

## Known constraints
1. **Concurrency = 1 channel / 1 CPS.** Only one call at a time. A second simultaneous dial fails (timeout / SIP 603 "declined") because the channel is busy — this is expected, not a bug. Purchase more channels to scale.
2. **Compliance.** The DID is a standard mobile number, **not** on a DLT 140/160 series. Do not run bulk cold-calling at volume until DLT registration is approved.
3. **Agent is a starter.** Default LLM/voice and a generic prompt. Refine before production.
