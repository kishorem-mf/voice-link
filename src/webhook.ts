import express, { type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { logOutcome, readOutcomes, type CallOutcome } from "./logger.js";
import { getConfig } from "./config.js";
// Web API runs on Retell (the working provider). ElevenLabs modules remain for
// CLI use; only the browser-facing API is switched here.
import {
  getRetellConfig,
  getRetellAgentIds,
  getRetellInboundAgentId,
} from "./retell/config.js";
import { placeCall } from "./retell/call.js";
import {
  listConversations,
  getConversation,
  getConversationAudio,
} from "./retell/conversations.js";
import {
  listVoices,
  getAgentVoice,
  updateAgentVoice,
  updateAgentLanguage,
  getAgentModel,
  updateAgentModel,
  updatePostCallModel,
  getAgentPrompt,
  updateAgentPrompt,
  getCallLimits,
  updateCallLimits,
  LANGUAGES,
  MODELS,
  POST_CALL_MODELS,
  PERSONA_PRESETS,
} from "./retell/manage.js";

/**
 * Module 4 — Webhook receiver + web API.
 *
 * An Express server that (a) receives ElevenLabs' post-call webhook at
 * POST /webhook/call and (b) exposes a small JSON API under /api for the web UI
 * (place a call, read logs, browse conversations, stats). The ElevenLabs API
 * key stays server-side; the recording is proxied so the browser never sees it.
 * In production it also serves the built React app from web/dist.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Built frontend lives at <repo>/web/dist (src/ -> ../web/dist). */
const WEB_DIST = resolve(__dirname, "../web/dist");

/**
 * Map ElevenLabs' post-call webhook body to our CallOutcome shape. Kept
 * defensive: the payload nests differently across event types, so every field
 * is optional-safe.
 */
export function parsePostCallWebhook(body: any): CallOutcome {
  const data = body?.data ?? body ?? {};
  const metadata = data.metadata ?? {};
  const analysis = data.analysis ?? {};
  const phone = metadata.phone_call ?? {};

  return {
    conversationId: data.conversation_id,
    toNumber: phone.external_number ?? phone.to_number,
    // ElevenLabs status is like "done"/"failed"; fall back to call_successful.
    status: data.status ?? analysis.call_successful ?? "unknown",
    disposition: analysis.transcript_summary,
    durationSecs: metadata.call_duration_secs,
  };
}

/** Build the Express app (exported so it can be unit-tested without listening). */
/**
 * Apply a per-agent update across ALL synced agents (outbound + inbound if set)
 * so shared settings — voice, model, language, post-call model, call limits —
 * never drift between them. Returns the last result (they're identical).
 */
async function syncAgents<T>(fn: (agentId: string) => Promise<T>): Promise<T> {
  let last: T | undefined;
  for (const id of getRetellAgentIds()) last = await fn(id);
  return last as T;
}

/** Resolve the agent id for a persona direction (defaults to outbound). */
function personaAgentId(direction?: unknown): string | undefined {
  if (direction === "inbound") return getRetellInboundAgentId();
  return process.env.RETELL_AGENT_ID?.trim();
}

export function createApp() {
  const app = express();
  app.use(express.json());

  // Liveness probe.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post("/webhook/call", (req: Request, res: Response) => {
    try {
      const outcome = parsePostCallWebhook(req.body);
      logOutcome(outcome);
      // Ack fast so ElevenLabs doesn't retry.
      res.status(200).json({ received: true, conversationId: outcome.conversationId });
    } catch (err) {
      console.error(`❌ Failed to handle webhook: ${(err as Error).message}`);
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ---- Web API (consumed by the React app) --------------------------------

  /** Safe config for the UI header — never exposes the API key. */
  app.get("/api/config", (_req: Request, res: Response) => {
    try {
      const c = getRetellConfig();
      res.json({
        provider: "retell",
        agentId: c.agentId,
        phoneNumberId: c.fromNumber,
        baseUrl: c.baseUrl,
        techPrefix: c.techPrefix || null,
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /** Place an outbound call. Body: { toNumber: "+91…" }. */
  app.post("/api/call", async (req: Request, res: Response) => {
    const toNumber = (req.body?.toNumber ?? "").trim();
    try {
      const r = await placeCall(toNumber);
      // Normalize to the shape the UI expects (conversationId drives polling).
      res.json({
        success: r.callStatus !== "error",
        conversationId: r.callId,
        message: r.callStatus,
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /** Logged call outcomes (from call-outcomes.json), newest first. */
  app.get("/api/logs", (_req: Request, res: Response) => {
    try {
      res.json(readOutcomes().reverse());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** Recent conversations for the configured agent. */
  app.get("/api/conversations", async (_req: Request, res: Response) => {
    try {
      res.json(await listConversations());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** One conversation's detail incl. transcript. */
  app.get("/api/conversations/:id", async (req: Request, res: Response) => {
    try {
      res.json(await getConversation(String(req.params.id)));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Proxy the call recording (mp3), streamed so the key stays server-side. */
  app.get("/api/conversations/:id/audio", async (req: Request, res: Response) => {
    try {
      const upstream = await getConversationAudio(String(req.params.id));
      res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "audio/mpeg");
      const len = upstream.headers.get("content-length");
      if (len) res.setHeader("Content-Length", len);
      if (upstream.body) Readable.fromWeb(upstream.body as any).pipe(res);
      else res.end();
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Dashboard aggregates from logs + live conversations. */
  app.get("/api/stats", async (_req: Request, res: Response) => {
    try {
      let convs: Awaited<ReturnType<typeof listConversations>> = [];
      try {
        convs = await listConversations(100);
      } catch {
        /* stats still work off logs if ElevenLabs is unreachable */
      }
      const done = convs.filter((c) => c.status === "done");
      const durations = done.map((c) => c.durationSecs).filter((d) => d > 0);
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const todayUnix = Math.floor(startOfDay.getTime() / 1000);
      res.json({
        totalConversations: convs.length,
        completed: done.length,
        successRate: convs.length ? Math.round((done.length / convs.length) * 100) : 0,
        avgDurationSecs: durations.length
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : 0,
        callsToday: convs.filter((c) => c.startUnix >= todayUnix).length,
        loggedOutcomes: readOutcomes().length,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---- Retell agent voice config ------------------------------------------

  /** List available Retell voices; ?accent=Indian to filter. */
  app.get("/api/retell/voices", async (req: Request, res: Response) => {
    try {
      const accent = req.query.accent ? String(req.query.accent) : undefined;
      res.json(await listVoices(accent));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Current agent + its voice, language, and model. */
  app.get("/api/retell/agent", async (_req: Request, res: Response) => {
    const agentId = process.env.RETELL_AGENT_ID?.trim();
    if (!agentId) return res.status(400).json({ error: "RETELL_AGENT_ID not set" });
    try {
      const [voice, model] = await Promise.all([
        getAgentVoice(agentId),
        getAgentModel(agentId),
      ]);
      res.json({ agentId, ...voice, model: model.model });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Update the voice on ALL synced agents. Body: { voiceId }. */
  app.patch("/api/retell/agent/voice", async (req: Request, res: Response) => {
    const voiceId = (req.body?.voiceId ?? "").trim();
    if (!voiceId) return res.status(400).json({ error: "voiceId required" });
    try {
      res.json({ voiceId: await syncAgents((id) => updateAgentVoice(id, voiceId)) });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Curated language options for the UI dropdown. */
  app.get("/api/retell/languages", (_req: Request, res: Response) => {
    res.json(LANGUAGES);
  });

  /** Update the language on ALL synced agents. Body: { language }. */
  app.patch("/api/retell/agent/language", async (req: Request, res: Response) => {
    const language = (req.body?.language ?? "").trim();
    if (!language) return res.status(400).json({ error: "language required" });
    try {
      res.json({ language: await syncAgents((id) => updateAgentLanguage(id, language)) });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Curated LLM model options (with per-minute price) for the UI dropdown. */
  app.get("/api/retell/models", (_req: Request, res: Response) => {
    res.json(MODELS);
  });

  /** Update the LLM model on ALL synced agents. Body: { model }. */
  app.patch("/api/retell/agent/model", async (req: Request, res: Response) => {
    const model = (req.body?.model ?? "").trim();
    if (!model) return res.status(400).json({ error: "model required" });
    try {
      res.json({ model: await syncAgents((id) => updateAgentModel(id, model)) });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Curated post-call-analysis model options (with per-call price). */
  app.get("/api/retell/postcall-models", (_req: Request, res: Response) => {
    res.json(POST_CALL_MODELS);
  });

  /** Update the post-call model on ALL synced agents. Body: { model }. */
  app.patch("/api/retell/agent/post-call-model", async (req: Request, res: Response) => {
    const model = (req.body?.model ?? "").trim();
    if (!model) return res.status(400).json({ error: "model required" });
    try {
      res.json({ model: await syncAgents((id) => updatePostCallModel(id, model)) });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Ready-made persona templates for the UI dropdown. */
  app.get("/api/retell/personas", (_req: Request, res: Response) => {
    res.json(PERSONA_PRESETS);
  });

  /**
   * Persona (system prompt + first message) for a direction. Personas differ
   * per direction (outbound = sales, inbound = receptionist), so they are NOT
   * synced. ?direction=outbound (default) | inbound.
   */
  app.get("/api/retell/agent/prompt", async (req: Request, res: Response) => {
    const agentId = personaAgentId(req.query.direction);
    if (!agentId) {
      return res.status(400).json({ error: "No agent for that direction (is RETELL_INBOUND_AGENT_ID set?)" });
    }
    try {
      res.json(await getAgentPrompt(agentId));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Update a direction's persona. Body: { prompt, firstMessage, direction? }. */
  app.patch("/api/retell/agent/prompt", async (req: Request, res: Response) => {
    const agentId = personaAgentId(req.body?.direction);
    if (!agentId) {
      return res.status(400).json({ error: "No agent for that direction (is RETELL_INBOUND_AGENT_ID set?)" });
    }
    const prompt = (req.body?.prompt ?? "").trim();
    const firstMessage = (req.body?.firstMessage ?? "").trim();
    if (!prompt || !firstMessage) {
      return res.status(400).json({ error: "prompt and firstMessage are required" });
    }
    try {
      res.json(await updateAgentPrompt(agentId, prompt, firstMessage));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Which directions are available (for the UI toggle). */
  app.get("/api/retell/directions", (_req: Request, res: Response) => {
    res.json({ outbound: true, inbound: !!getRetellInboundAgentId() });
  });

  /** Current call limits (billing safety). */
  app.get("/api/retell/agent/limits", async (_req: Request, res: Response) => {
    const agentId = process.env.RETELL_AGENT_ID?.trim();
    if (!agentId) return res.status(400).json({ error: "RETELL_AGENT_ID not set" });
    try {
      res.json(await getCallLimits(agentId));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Update call limits on ALL synced agents. Body: { maxDurationMs, silenceMs }. */
  app.patch("/api/retell/agent/limits", async (req: Request, res: Response) => {
    const maxDurationMs = Number(req.body?.maxDurationMs);
    const silenceMs = Number(req.body?.silenceMs);
    // Retell bounds: max duration 60s–7200s; silence >=10s.
    if (!Number.isFinite(maxDurationMs) || maxDurationMs < 60000 || maxDurationMs > 7200000) {
      return res.status(400).json({ error: "maxDurationMs must be 60000–7200000 (1–120 min)" });
    }
    if (!Number.isFinite(silenceMs) || silenceMs < 10000) {
      return res.status(400).json({ error: "silenceMs must be at least 10000 (10s)" });
    }
    try {
      res.json(await syncAgents((id) => updateCallLimits(id, maxDurationMs, silenceMs)));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // ---- Static frontend (production build) ---------------------------------
  if (existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    // SPA fallback: send index.html for non-API GET routes.
    app.get(/^(?!\/(api|webhook|health)).*/, (_req: Request, res: Response) => {
      res.sendFile(resolve(WEB_DIST, "index.html"));
    });
  }

  return app;
}

// Run directly (`npm run webhook`) to start the server on WEBHOOK_PORT.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = getConfig().webhookPort;
  createApp().listen(port, () => {
    console.log(`🌐 Webhook server listening on http://localhost:${port}`);
    console.log(`   POST /webhook/call   — receives ElevenLabs post-call events`);
    console.log(`   GET  /health         — liveness probe`);
  });
}
