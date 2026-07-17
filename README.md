# VoiceLink Outbound — AI Calling Test Harness

A module-first prototype for placing outbound AI calls through a **VoiceLink SIP
trunk**. **Active voice-AI provider: Retell** (powers the web UI). An earlier
**ElevenLabs** integration remains available via CLI — its outbound is blocked by
a carrier-side SIP 603 on the non-DLT DID, which is why the project moved to Retell
(VoiceLink support's recommendation).

See [docs/working-configuration.md](docs/working-configuration.md) for the active
config and [docs/runbook.md](docs/runbook.md) for operations.

## Web UI (runs on Retell)

A React console (in `web/`) — make calls, browse logs, review completed calls with
transcript + recording, and pick the agent's voice (Indian accents included).

```bash
# Terminal A — backend API + webhook (port 3000)
npm run serve

# Terminal B — frontend dev server (port 5173, proxies /api to :3000)
npm run web:dev        # open http://localhost:5173
```
For a single-process production build: `npm run web:build` then `npm run serve`
(the server serves `web/dist` at http://localhost:3000).

**Views:** Dashboard (totals, success rate, avg duration) · Make a Call (live
status) · Call Logs (search/filter) · Completed Calls (transcript + audio player) ·
Settings (agent voice). The provider API key stays server-side; recordings are
proxied through the API.

**Retell setup (all via API, no dashboard):**
```bash
npm run retell:auth      # validate key, list agents/numbers
npm run retell:agent     # create agent -> RETELL_AGENT_ID
npm run retell:import    # import DID via SIP trunking + bind outbound agent
npm run retell:dial -- +91XXXXXXXXXX
```

## Prerequisites

- Node.js 18+ (uses built-in `fetch`)
- An ElevenLabs account + API key
- A phone number imported from a SIP trunk in ElevenLabs

## Setup

```bash
npm install
cp .env.example .env   # then fill in your values
```

`.env` variables:

| Var | Purpose |
|---|---|
| `ELEVENLABS_API_KEY` | ElevenLabs API key |
| `ELEVENLABS_AGENT_ID` | Conversational AI agent that handles the call |
| `ELEVENLABS_PHONE_NUMBER_ID` | Imported SIP-trunk phone number id |
| `WEBHOOK_PORT` | Local webhook port (default 3000) |

Don't know your agent / phone-number ids? Run `npm run auth:check` (module 2) to
list them, or `npm run agent:create` to create a starter agent via the API.

## Modules & commands

| # | Module | File | Command | Network |
|---|---|---|---|---|
| 1 | Config loader | `src/config.ts` | `npm run config:check` | offline |
| 2 | Auth-check client | `src/client.ts` | `npm run auth:check` | live (read-only) |
| — | Agent provisioning | `src/agent.ts` | `npm run agent:create` | live (write) |
| — | Number provisioning | `src/provision.ts` | `npm run provision` | live (write) |
| 3 | Outcome logger | `src/logger.ts` | `npm run log:test` | offline |
| 4 | Webhook receiver | `src/webhook.ts` | `npm run webhook` | local server |
| 5 | Call trigger | `src/call.ts` | `npm run dial -- +91XXXXXXXXXX` | live (places a call) |

Type-check everything with `npm run build`.

### 1. Config loader
Loads & validates env vars, failing fast with a clear message. Exposes
`getConfig()` (memoized) and `getApiKey()` for the other modules.

### 2. Auth-check client
Thin ElevenLabs REST wrapper. `ping()` validates the API key and lists your
agents + phone numbers so you can fill in `.env`.

### 3. Outcome logger
Appends call outcomes to `call-outcomes.json` (JSON Lines) and prints a summary.
Pure and offline.

### 4. Webhook receiver
Express server exposing `POST /webhook/call` (ElevenLabs post-call events) and
`GET /health`. Normalizes the payload and hands it to the logger. Test it
offline by `curl`-ing a sample payload.

### 5. Call trigger
Places one outbound call via `POST /v1/convai/sip-trunk/outbound-call`.
Validates the destination is E.164 before calling.

## Provisioning before the first call

Three things must be true before a call can connect:

1. **Agent assigned to the number** — `npm run provision` (via API)
2. **VoiceLink call routing** — map the DID to the trunk in the VoiceLink
   portal (manual, no API)
3. **SIP transport = TCP** — `npm run provision` (via API)

`npm run provision` does steps 1 and 3 in one shot: it assigns
`ELEVENLABS_AGENT_ID` to `ELEVENLABS_PHONE_NUMBER_ID` and switches the outbound
SIP transport to TCP. (Note: the writable API field is `outbound_trunk_config`;
sending `outbound_trunk`/`provider_config` returns 200 but is silently ignored.)
Step 2 is portal-only.

## End-to-end test

1. **Start the webhook** (captures the call outcome):
   ```bash
   npm run webhook
   ```
   To let ElevenLabs reach it, expose the port (e.g. `ngrok http 3000`) and
   register the public URL as the agent's post-call webhook in the ElevenLabs
   dashboard.

2. **Place the call**:
   ```bash
   npm run dial -- +91XXXXXXXXXX
   ```
   On success you get a `conversationId`; the post-call outcome lands in
   `call-outcomes.json` via the webhook.

## Known blockers (external — not code)

A `dial` request is accepted by ElevenLabs, but whether the phone actually rings
depends on VoiceLink-side setup still open in the setup doc:

- SIP **transport**: TLS vs TCP on non-standard port `3300` (unconfirmed)
- **Tech-prefix** (`45454`) handling — auto-applied vs. explicitly sent
- **DID routing**: the purchased number mapped to the `ELEVENLABS-IN` trunk
- **Compliance**: current DID is not on a DLT 140/160 series
- **Concurrency**: 1 channel / 1 CPS allocated

If a call silently fails to connect, check these with VoiceLink support first.

## Project layout

```
src/
  config.ts    # module 1 — env config
  client.ts    # module 2 — auth-check / discovery
  agent.ts     # agent provisioning
  logger.ts    # module 3 — outcome logging
  webhook.ts   # module 4 — post-call webhook receiver
  call.ts      # module 5 — outbound call trigger
docs/          # plan + setup status
```
