# Outbound AI Calling Agent — Setup Status & Handoff

**Owner**: Nanda Kishore
**Date**: July 11, 2026
**Purpose**: Status snapshot for continuing prototype/integration work in Claude Code (VS Code)

---

## 1. Stack Overview

| Layer | Provider | Status |
|---|---|---|
| Telephony / SIP trunk (India, TRAI-compliant) | **VoiceLink** (Elision) | ✅ DID purchased, trunk created |
| Voice AI agent platform | **ElevenLabs Conversational AI** (ElevenAgents) | 🔧 SIP trunk import in progress |
| LLM backend | Configured within ElevenLabs agent (not yet finalized) | ⏳ Pending |
| Compliance | DLT 140/160 series (promotional/transactional) | ⏳ Not yet requested — currently on a standard mobile DID |

**Reseller account**: Nanda Kishore is set up as a Reseller on VoiceLink, with Client = `nanda kishore (kishorem.mf@gmail.com)`. Plan: Trial Pack.

---

## 2. VoiceLink Configuration (Done)

- **DID Number**: Purchased under India (+91), Mobile type, from the standard `919429391xxx` block (₹299/month rate card) — *not yet on a DLT 140/160 regulated series*.
- **Channels**: 1 channel currently allocated to this client (= 1 concurrent call). Reseller has 0 unassigned channels left in inventory — more must be purchased to scale concurrency.
- **Allocated CPS**: 1 (1 outbound call attempt initiated per second — a scaling bottleneck at volume).
- **SIP Trunk created** — Trunk name: `ELEVENLABS-IN.nanda kishore`
  - **BOT Provider**: ElevenLabs-IN
  - **Status**: Active
  - **Peer Monitoring**: Disabled (no periodic OPTIONS pings configured)
  - **Whitelist Configuration**:
    - IP Address: `160.30.71.89`
    - Port: `3300`
    - URI: `160.30.71.89:3300`
  - **Tech Prefix**: `45454`
  - **Example SIP dial string**: `SIP/45454xxxxxxxxxxx@trunk`
- **Call Routing Configuration**: Not yet completed — DID has not yet been mapped to this trunk.

### Open items on VoiceLink side
- [ ] Confirm whether port `3300` expects **TLS or TCP** signaling (non-standard port — not the usual 5060/5061 defaults, so this must be confirmed with VoiceLink support, not assumed).
- [ ] Confirm whether **Tech Prefix `45454`** is auto-applied by VoiceLink based on trunk/account identity, or must be explicitly sent from ElevenLabs (e.g., via custom SIP header or prefixed dialed number).
- [ ] Request **DLT 140 series** DID (promotional/outbound telemarketing) before running real cold-call volume — current DID is a standard mobile number and is not TRAI-compliant for bulk outbound.
- [ ] Purchase additional channels before scaling beyond 1 concurrent call.
- [ ] Complete **Call Routing Configuration**: map the purchased DID to the `ELEVENLABS-IN.nanda kishore` trunk.

---

## 3. ElevenLabs Configuration (In Progress)

**Path in ElevenLabs dashboard**: Conversational AI → Phone Numbers (`elevenlabs.io/app/agents/phone-numbers`) → "Import a phone number from SIP trunk"

### Values entered / recommended so far:

| Field | Value | Confidence |
|---|---|---|
| Label | `VoiceLink-Outbound` (suggested) | — |
| Phone Number (E.164) | VoiceLink DID, e.g. `+9191xxxxxxx` | To be filled once DID is finalized |
| **Outbound Address** | `160.30.71.89:3300` | Confirmed correct field format |
| **Transport Type** | Currently set to **TLS** — flagged as **unconfirmed**; recommend testing **TCP** first unless VoiceLink explicitly confirms TLS support on port 3300 | ⚠️ Needs VoiceLink confirmation |
| **Media Encryption** | `Disabled` | Medium-high confidence (no cert/SRTP info surfaced anywhere in VoiceLink's UI) |
| **Enabled Codecs** | `G.722`, `PCMU`, `PCMA` (all enabled) | Safe default |
| **Custom Headers** | None added yet | Only needed if VoiceLink confirms tech prefix must travel as a header |
| **SIP Trunk Username / Password** | Left blank (ACL-based auth assumed — no username/password field surfaced anywhere in VoiceLink's trunk screen, only IP allowlisting) | Medium-high confidence |

### Not yet done on ElevenLabs side
- [ ] Create/finalize the actual **Conversational AI Agent** (prompt, voice, LLM, call flow) — this has not been built yet, only the telephony bridge is being configured.
- [ ] Publish the agent (must be live before it can handle calls).
- [ ] Complete SIP trunk import (click "Import").
- [ ] Assign the published agent to the imported phone number (Phone Numbers → select number → Assign Agent).
- [ ] Test outbound call once both VoiceLink open items (transport type, tech prefix handling) are resolved.

---

## 4. Known Unknowns / Risks (flag before going live)

1. **Transport protocol mismatch risk** — TLS on a non-standard port (3300) is unverified; if VoiceLink's side doesn't actually terminate TLS there, calls will fail silently (no clear error, just no audio/no connect).
2. **Tech prefix routing** — unclear whether VoiceLink auto-routes by source IP/account or requires explicit prefix injection. Needs direct confirmation from VoiceLink support.
3. **Compliance gap** — current DID is not on a DLT-regulated series; cannot legally run outbound cold-calling campaigns at volume until DLT 140 registration is approved.
4. **Concurrency ceiling** — 1 channel / 1 CPS currently allocated; fine for testing, will bottleneck any real campaign volume.

---

## 5. Suggested Next Steps for Claude Code / Prototype Build

Once the above VoiceLink questions are resolved and the SIP trunk import + agent assignment are complete in ElevenLabs, the prototype work in Claude Code would likely involve:

1. **Outbound call trigger logic** — script/service to programmatically initiate calls via ElevenLabs' Outbound Call API (SIP trunk variant), passing destination number + agent ID.
2. **Lead list ingestion** — CSV/Sheet or CRM pull of numbers to call, with basic dedup/DND-scrub logic.
3. **Call scheduling / rate limiting** — respect the CPS=1 constraint (and update as channels scale) plus TRAI calling-hour restrictions.
4. **Webhook/event handling** — capture call outcome (connected, no-answer, voicemail, disposition) via ElevenLabs post-call webhooks for logging into a CRM/sheet.
5. **Test harness** — small batch (5–10 numbers) to validate the trunk once VoiceLink's transport/prefix questions are answered.

---

*This file reflects the state of setup as of the conversation on July 11, 2026. Update as VoiceLink support responses come in.*
