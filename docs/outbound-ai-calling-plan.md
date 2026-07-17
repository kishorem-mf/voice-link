# Outbound AI Calling — Implementation Plan (Module-First)

**Owner**: Nanda Kishore
**Date**: July 11, 2026
**Related**: [outbound-ai-calling-setup.md](./outbound-ai-calling-setup.md)

## Context
The VoiceLink SIP trunk + ElevenLabs bridge is nearly configured (see setup doc). Before building the full campaign pipeline, we build a minimal **test harness** to fire one outbound call through the trunk and confirm the connection/audio path works. Approach: split into small, **independently-testable modules**, validate each in isolation, then integrate. Runtime: **Node.js / TypeScript**. Repo is greenfield.

## Modules (build & test in this order)

### 1. Config loader — `src/config.ts` *(build first)*
Loads/validates env vars (API key, agent ID, phone number ID); fails fast with a clear message if any are missing.
- **Test in isolation:** run directly → prints resolved config (key masked) or throws on missing var. No network.

### 2. ElevenLabs client + auth check — `src/client.ts` *(highest-value early win)*
Thin SDK wrapper exposing `ping()` that hits a **read-only** endpoint (list agents / list phone numbers).
- **Test in isolation:** run `ping()` → confirms the API key works and agent/phone-number IDs exist, before risking a real call.

### 3. Outcome logger — `src/logger.ts` *(independent, no deps)*
Takes a call-outcome object, appends to a local JSON file + console.
- **Test in isolation:** feed a fake outcome object → check the JSON file. Pure, no network.

### 4. Webhook receiver — `src/webhook.ts` *(test before any real call)*
Express endpoint parsing ElevenLabs' post-call payload, handing it to the logger.
- **Test in isolation:** `curl` a sample payload at `localhost` → confirm parse + log. No live call.

### 5. Outbound call trigger — `src/call.ts` *(build last; needs #1 + #2)*
One function: dial destination + agent ID via the Outbound Call (SIP trunk) API. CLI entry `src/index.ts`.
- **Test in isolation:** dial one number. Only module blocked on external VoiceLink unknowns.

## Build first (foundation)
Start with **#1 Config loader** and **#2 auth-check client** — together they prove credentials + IDs are valid and depend on nothing external. **#3 logger** and **#4 webhook** are then fully testable offline with mock payloads. The **only** piece gated on VoiceLink support is **#5 call trigger**.

## Integration & Verification
- Wire modules: config → client → call trigger; webhook → logger.
- `npm run build` compiles clean.
- Start webhook server; expose via ngrok; register URL in ElevenLabs.
- Run `npm run dial -- +91XXXXXXXXXX` on one test number; confirm connect + webhook logs an outcome.
- **Blocked-on (external):** VoiceLink transport (TLS vs TCP on :3300) + tech-prefix handling must be resolved for #5 to connect.

## Files
- `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`, `README.md`
- `src/config.ts`, `src/client.ts`, `src/logger.ts`, `src/webhook.ts`, `src/call.ts`, `src/index.ts`
