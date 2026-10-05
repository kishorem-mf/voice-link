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
  getRetellOutboundAgentId,
} from "./retell/config.js";
import { placeCall } from "./retell/call.js";
import {
  listProfiles,
  getActiveProfileId,
  setActiveProfile,
  addProfile,
  updateProfile,
} from "./retell/profiles.js";
import { importNumber } from "./retell/import-number.js";
import { startWatcher } from "./notify/watcher.js";
import { BUSINESS_TYPES, templatesFor, renderText } from "./retell/business-types.js";
import {
  provisionProfileAgents,
  claimNumber,
  profilesSharingNumber,
} from "./retell/provision-profile.js";
import {
  sendTelegram,
  checkTelegram,
  getTelegramCredentials,
  listRecentChats,
} from "./notify/telegram.js";
import { profileCredentials } from "./notify/routing.js";
import {
  listProspects,
  listAllProspects,
  pipeline,
  recentActivity,
  findByInstagram,
  describeTable,
  getProspect,
  upsertProspect,
  addEvent,
  listEvents,
  findByPhone,
  dueBy,
  isConfigured as crmConfigured,
} from "./crm/store.js";
import {
  OUTCOMES,
  FOLLOW_UPS,
  STATUSES,
  followUpDate,
  normalisePhone,
  normaliseInstagram,
  type ProspectStatus,
} from "./crm/schema.js";
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

/**
 * Resolve the agent id for a persona direction (defaults to outbound).
 * Both come from the ACTIVE profile, so editing a persona only ever touches
 * the client currently selected — never another client's agents.
 */
function personaAgentId(direction?: unknown): string | undefined {
  if (direction === "inbound") return getRetellInboundAgentId();
  return getRetellOutboundAgentId();
}


/**
 * Find a prospect from whatever the operator has to hand — the generated id,
 * a phone number, an Instagram handle, or part of the business name.
 *
 * Ids are what the table stores but not what a person remembers; the lookup
 * order runs cheapest-first so the exact paths cost one read each and the
 * name search is the fallback.
 */
async function resolveProspect(
  value: string,
): Promise<{ prospect: Awaited<ReturnType<typeof getProspect>>; how: string }> {
  const v = value.trim();

  const byId = await getProspect(v).catch(() => null);
  if (byId) return { prospect: byId, how: "by id" };

  if (/\d{6,}/.test(v)) {
    const byPhone = await findByPhone(v).catch(() => null);
    if (byPhone) return { prospect: byPhone, how: `PHONE#${normalisePhone(v)}` };
  }

  const byIg = await findByInstagram(v).catch(() => null);
  if (byIg) return { prospect: byIg, how: `IG#${normaliseInstagram(v)}` };

  // Name search last: it is the only one that has to read a tray.
  const needle = v.toLowerCase();
  for (const status of ["new", "open", "won", "lost"] as const) {
    const hit = (await listProspects(status, 500)).find((p) =>
      (p.businessName ?? "").toLowerCase().includes(needle),
    );
    if (hit) return { prospect: hit, how: `name match in ${status}` };
  }
  return { prospect: null, how: "not found" };
}

export function createApp() {
  const app = express();
  app.use(express.json());

  /**
   * Never let the browser cache an API response.
   *
   * Express sends an ETag on JSON by default, so two components fetching
   * /api/config moments apart could get different answers — one fresh, one
   * from cache. That surfaced as the dashboard naming one client while the
   * header named another, which is precisely the confusion client-scoping is
   * meant to remove. None of this data is cacheable anyway: it changes the
   * moment a profile is switched.
   */
  app.use("/api", (_req: Request, res: Response, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

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
      const active = listProfiles().find((p) => p.id === getActiveProfileId());
      res.json({
        provider: "retell",
        agentId: c.agentId,
        phoneNumberId: c.fromNumber,
        baseUrl: c.baseUrl,
        techPrefix: c.techPrefix || null,
        profileId: active?.id,
        profileName: active?.name,
        // The trading name — what the agent says and what the UI should show
        // when explaining whose data is on screen.
        businessName: active?.businessName || active?.name,
        isDemo: Boolean(active?.isDemo),
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /**
   * List VoiceLink profiles + which is active.
   *
   * Bot tokens are stripped and replaced with a boolean — a token grants full
   * control of a client's bot, so it must never be shipped to the browser.
   */
  app.get("/api/profiles", (_req: Request, res: Response) => {
    try {
      const profiles = listProfiles().map(({ telegramBotToken, ...rest }) => ({
        ...rest,
        hasTelegramBot: Boolean(telegramBotToken),
      }));
      res.json({ active: getActiveProfileId(), profiles });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** Set (or clear) a client's own Telegram bot. Body: { botToken?, chatId? }. */
  app.patch("/api/profiles/:id/telegram", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const { botToken, chatId } = req.body ?? {};
    const patch: Record<string, string> = {};
    if (typeof botToken === "string") patch.telegramBotToken = botToken.trim();
    if (typeof chatId === "string") patch.telegramChatId = chatId.trim();
    if (!Object.keys(patch).length) return res.status(400).json({ error: "nothing to update" });
    try {
      const p = updateProfile(id, patch);
      const creds = profileCredentials(p);
      // Verify immediately so a typo surfaces here rather than as a silently
      // missing alert after a real call.
      const check = creds ? await checkTelegram(creds) : { ok: false, error: "incomplete" };
      res.json({ ok: check.ok, botUsername: check.botUsername, error: check.error });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /**
   * Who has recently messaged this client's bot, plus the bot's own link.
   *
   * Powers the demo flow: a prospect taps the link and presses Start, this
   * lists them, and one click binds their chat so the next call's alert lands
   * on THEIR phone. Telegram forbids a bot messaging first, so contact from
   * their side is unavoidable — this just makes it one tap instead of copying
   * chat ids out of a raw API response.
   */
  app.get("/api/profiles/:id/telegram/chats", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    try {
      const profile = listProfiles().find((p) => p.id === id);
      if (!profile) return res.status(404).json({ error: `No profile "${id}"` });
      const creds = profileCredentials(profile) ?? getTelegramCredentials();
      if (!creds) return res.status(400).json({ error: "No bot configured for this client." });
      const [who, chats] = await Promise.all([checkTelegram(creds), listRecentChats(creds)]);
      res.json({
        botUsername: who.botUsername,
        botLink: who.botUsername ? `https://t.me/${who.botUsername}` : null,
        currentChatId: creds.chatId,
        chats: chats.chats,
        error: chats.error,
      });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Send a test alert using this client's bot. */
  app.post("/api/profiles/:id/telegram/test", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    try {
      const profile = listProfiles().find((p) => p.id === id);
      if (!profile) return res.status(404).json({ error: `No profile "${id}"` });
      const creds = profileCredentials(profile) ?? getTelegramCredentials();
      if (!creds) return res.status(400).json({ error: "No bot configured for this client." });
      const name = profile.businessName || profile.name;
      const r = await sendTelegram(
        `🔔 <b>Test alert</b>\n<i>${name.replace(/[&<>]/g, "")}</i>\n\n` +
          `Alerts for this client will arrive here.`,
        creds,
      );
      res.json(r);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /**
   * Switch the active VoiceLink profile. Body: { id }.
   *
   * When several profiles share a DID (demo setups), switching also re-points
   * that number at this profile's agents — a number routes to exactly one
   * agent pair, so the business being demoed has to claim it. In production
   * each client owns their own DID and this step is skipped entirely.
   */
  app.post("/api/profiles/active", async (req: Request, res: Response) => {
    const id = (req.body?.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "id required" });
    try {
      const p = setActiveProfile(id);
      let claimed = false;
      let claimError: string | undefined;
      if (profilesSharingNumber(p.id).length && p.outboundAgentId && p.inboundAgentId) {
        try {
          await claimNumber(p.id);
          claimed = true;
        } catch (err) {
          // Switching still succeeded; only the rebinding failed.
          claimError = (err as Error).message;
        }
      }
      res.json({ active: p.id, profile: p, claimed, claimError });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /** Explicitly point this profile's DID at its own agents. */
  app.post("/api/profiles/:id/claim", async (req: Request, res: Response) => {
    try {
      res.json(await claimNumber(String(req.params.id)));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Add a new VoiceLink profile (one client). */
  app.post("/api/profiles", (req: Request, res: Response) => {
    const { name, fromNumber, terminationUri, transport, techPrefix, businessName, businessType } =
      req.body ?? {};
    if (!name?.trim() || !fromNumber?.trim() || !terminationUri?.trim()) {
      return res.status(400).json({ error: "name, fromNumber, and terminationUri are required" });
    }
    try {
      const p = addProfile({
        name: name.trim(),
        fromNumber: fromNumber.trim(),
        terminationUri: terminationUri.trim(),
        transport: transport?.trim(),
        techPrefix: techPrefix?.trim(),
        businessName: businessName?.trim() || name.trim(),
        businessType: businessType?.trim() || "general",
      });
      res.json(p);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /** The business types a profile can be set to. */
  app.get("/api/business-types", (_req: Request, res: Response) => {
    res.json(BUSINESS_TYPES.map(({ id, label, description }) => ({ id, label, description })));
  });

  /** Edit a profile's client identity. Body: { businessName?, businessType? }. */
  app.patch("/api/profiles/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const { businessName, businessType } = req.body ?? {};
    const patch: Record<string, string> = {};
    if (typeof businessName === "string") patch.businessName = businessName.trim();
    if (typeof businessType === "string") patch.businessType = businessType.trim();
    if (!Object.keys(patch).length) return res.status(400).json({ error: "nothing to update" });
    try {
      res.json(updateProfile(id, patch));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /**
   * Give this profile its own Retell agents, built from its business type, and
   * point its DID at them. This is what makes each client's persona
   * independent — see the note on VoiceLinkProfile.outboundAgentId.
   */
  app.post("/api/profiles/:id/provision", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const force = Boolean(req.body?.force);
    try {
      res.json(await provisionProfileAgents(id, { force }));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /**
   * Import a profile's DID into Retell (bind current outbound/inbound agents,
   * set its termination URI) — the Retell-side half of "point the app at this
   * profile." The VoiceLink-portal half (adding the DID to the trunk's
   * inbound-call routing) still has to be done by hand.
   */
  app.post("/api/profiles/:id/import", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const profile = listProfiles().find((p) => p.id === id);
    if (!profile) return res.status(404).json({ error: `No profile "${id}"` });
    const outboundAgentId = profile.outboundAgentId;
    if (!outboundAgentId) {
      return res.status(400).json({
        error: `"${profile.name}" has no agents yet — create this client's agents first.`,
      });
    }
    try {
      const r = await importNumber(
        profile.fromNumber,
        outboundAgentId,
        profile.terminationUri,
        profile.transport || "TCP",
        profile.inboundAgentId,
      );
      res.json(r);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });


  // ---- CRM (see docs/crm-plan.md) -----------------------------------------
  // The same store the watcher writes to, so a row logged here and one Sara
  // wrote are identical apart from `by`.

  /** Dropdown values, so the UI never hardcodes them. */
  app.get("/api/crm/options", (_req: Request, res: Response) => {
    res.json({
      outcomes: OUTCOMES,
      followUps: FOLLOW_UPS,
      statuses: STATUSES,
      configured: crmConfigured(),
    });
  });

  /**
   * Prospects in one tray (default: live), in the tray's own order.
   * ?status=new|won|lost for the other trays, ?status=all for everything.
   */
  app.get("/api/crm/prospects", async (req: Request, res: Response) => {
    const status = typeof req.query.status === "string" ? req.query.status : "open";
    try {
      res.json(
        status === "all"
          ? await listAllProspects()
          : await listProspects(status as ProspectStatus),
      );
    } catch (err) {
      res.status(crmConfigured() ? 502 : 400).json({ error: (err as Error).message });
    }
  });

  /** Prospects whose follow-up is due today or overdue. */
  app.get("/api/crm/due", async (req: Request, res: Response) => {
    try {
      res.json(await dueBy(typeof req.query.date === "string" ? req.query.date : undefined));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Create or update a prospect. */
  app.post("/api/crm/prospects", async (req: Request, res: Response) => {
    const { businessName } = req.body ?? {};
    if (!businessName?.trim()) return res.status(400).json({ error: "businessName is required" });
    try {
      res.json(await upsertProspect(req.body));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** One prospect with its timeline. */
  app.get("/api/crm/prospects/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    try {
      const prospect = await getProspect(id);
      if (!prospect) return res.status(404).json({ error: `No prospect "${id}"` });
      res.json({ prospect, events: await listEvents(id) });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  app.patch("/api/crm/prospects/:id", async (req: Request, res: Response) => {
    try {
      const existing = await getProspect(String(req.params.id));
      if (!existing) return res.status(404).json({ error: "No such prospect" });
      res.json(await upsertProspect({ ...existing, ...req.body, prospectId: existing.prospectId }));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /**
   * Log a call. Body: { by?, outcome?, notes?, direction?, followUp? }.
   * `followUp` is a dropdown id; it is resolved to a real date here so the
   * follow-up index can be queried and sorted.
   */
  app.post("/api/crm/prospects/:id/events", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const { by, outcome, notes, direction, followUp, followUpDate: onDate, at } =
      req.body ?? {};
    try {
      if (!(await getProspect(id))) return res.status(404).json({ error: "No such prospect" });
      const event = await addEvent({
        prospectId: id,
        by: by === "sara" ? "sara" : "me",
        outcome,
        notes,
        direction,
        // A call is usually logged some minutes after it ends. lastContactedAt
        // feeds the age the pipeline is read by, so a silently-wrong timestamp
        // corrupts the number being acted on — the caller may set it.
        ...(typeof at === "string" && !Number.isNaN(Date.parse(at)) ? { at } : {}),
        // An explicit date wins over the quick picks: "call me on the 14th"
        // is a real answer a bucket cannot express.
        ...(typeof onDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(onDate)
          ? { followUpDue: onDate }
          : followUp === undefined
            ? {}
            : { followUpDue: followUpDate(followUp) }),
      });
      res.json(event);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Table shape + every row — powers the Database tab. */
  app.get("/api/crm/table", async (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 200);
    try {
      res.json(await describeTable(limit));
    } catch (err) {
      res.status(crmConfigured() ? 502 : 400).json({ error: (err as Error).message });
    }
  });

  /**
   * Run one named query against the CRM table — powers the Database tab's
   * query picker. Each option names the key or index it uses, so the tab
   * doubles as a way to see *how* the table answers a question, not just what
   * it returns.
   */
  app.get("/api/crm/query", async (req: Request, res: Response) => {
    const q = String(req.query.q ?? "browse");
    const value = String(req.query.value ?? "").trim();
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 500);
    try {
      switch (q) {
        case "by_phone": {
          const p = value ? await findByPhone(value) : null;
          // Report the key actually read, not what was typed — the point of
          // this view is showing how the lookup works.
          return res.json({
            using: `direct read of PHONE#${normalisePhone(value)} (no index)`,
            rows: p ? [p] : [],
          });
        }
        case "by_instagram": {
          const p = value ? await findByInstagram(value) : null;
          return res.json({
            using: `direct read of IG#${normaliseInstagram(value)} (no index)`,
            rows: p ? [p] : [],
          });
        }
        case "history": {
          if (!value) return res.json({ using: "—", rows: [] });
          // Accept whatever the operator actually knows. Requiring the
          // generated id meant running another query, copying it out and
          // pasting it back — nobody does that twice.
          const found = await resolveProspect(value);
          if (!found.prospect) {
            return res.json({ using: `no prospect matching "${value}"`, rows: [] });
          }
          const id = found.prospect.prospectId;
          const events = await listEvents(id, limit);
          return res.json({
            using: `${found.how} → all rows where pk = P#${id}`,
            rows: [found.prospect, ...events],
          });
        }
        case "tray": {
          const tray = (value || "open") as ProspectStatus;
          return res.json({
            using:
              `status-index, status = ${tray}, ` +
              (tray === "new" ? "best score first (inverted score)" : "soonest follow-up first"),
            rows: await listProspects(tray, limit),
          });
        }
        case "due":
          return res.json({
            using: `status-index, status = open AND followUpSort <= ${value || "today"}`,
            rows: (await dueBy(value || undefined)).slice(0, limit),
            note: "due reads the whole open tray, then filters by date",
          });
        case "activity": {
          const days = Number(value || 7) || 7;
          const events = await recentActivity(
            new Date(Date.now() - days * 86400000).toISOString(),
            limit,
          );
          // A call log that cannot say who was called is not a call log. Event
          // rows only carry prospectId, so the business is attached here —
          // one lookup per distinct prospect, not per event.
          const names = new Map<string, { businessName?: string; phone?: string }>();
          for (const id of new Set(events.map((e) => e.prospectId))) {
            const p = await getProspect(id).catch(() => null);
            if (p) names.set(id, { businessName: p.businessName, phone: p.phone });
          }
          return res.json({
            using: `activity-index, last ${days} day(s)`,
            rows: events.map((e) => ({ ...names.get(e.prospectId), ...e })),
          });
        }
        case "pipeline":
          return res.json({ using: "status-index, counted per tray", rows: [await pipeline()] });
        default: {
          const t = await describeTable(limit);
          return res.json({
            using: `table scan, first ${limit} row(s)${t.truncated ? " — more exist" : ""}`,
            rows: t.rows,
          });
        }
      }
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** How many prospects sit in each tray. */
  app.get("/api/crm/pipeline", async (_req: Request, res: Response) => {
    try {
      res.json(await pipeline());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Every call across every prospect — "what did I do this week". */
  app.get("/api/crm/activity", async (req: Request, res: Response) => {
    const days = Number(req.query.days ?? 7);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    try {
      res.json(await recentActivity(since));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** Resolve a phone number to a prospect — what Sara uses on every call. */
  app.get("/api/crm/lookup", async (req: Request, res: Response) => {
    const phone = typeof req.query.phone === "string" ? req.query.phone : "";
    const instagram = typeof req.query.instagram === "string" ? req.query.instagram : "";
    if (!phone && !instagram) return res.status(400).json({ error: "phone or instagram required" });
    try {
      res.json({
        prospect: phone ? await findByPhone(phone) : await findByInstagram(instagram),
      });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
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
    // Active profile's agent — not .env, which is only a legacy fallback.
    let agentId: string;
    try {
      agentId = getRetellOutboundAgentId();
    } catch {
      return res.status(400).json({
        error:
          "This client has no agents yet — open Settings → Client and create them.",
      });
    }
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
  /**
   * Scripts available for the ACTIVE client and one direction.
   *
   * Replaces the old /api/retell/personas, which returned one global list
   * regardless of trade — a wedding studio was offered a clinic receptionist
   * script, and that list competed with the business-type template for the
   * same field.
   */
  app.get("/api/retell/templates", (req: Request, res: Response) => {
    try {
      const direction = req.query.direction === "inbound" ? "inbound" : "outbound";
      const active = listProfiles().find((p) => p.id === getActiveProfileId());
      const name = active?.businessName || active?.name || "";
      // Templates carry a {business} placeholder that provisioning substitutes.
      // Applying one straight from the dropdown skips that step, so a picked
      // script would otherwise open with a literal "calling from {business}".
      res.json(
        templatesFor(active?.businessType, direction).map((t) => ({
          ...t,
          prompt: renderText(t.prompt, name),
          firstMessage: renderText(t.firstMessage, name),
        })),
      );
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
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
    // Active profile's agent — not .env, which is only a legacy fallback.
    let agentId: string;
    try {
      agentId = getRetellOutboundAgentId();
    } catch {
      return res.status(400).json({
        error:
          "This client has no agents yet — open Settings → Client and create them.",
      });
    }
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
    // Telegram alerts for completed calls. No-ops when no bot is configured.
    startWatcher();
  });
}
