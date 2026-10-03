import { getRetellApiKey, getRetellBaseUrl, mask } from "./config.js";

/**
 * Retell agent management — list voices and get/update the agent's voice.
 * Backs the UI's configurable voice setting.
 */

export interface Voice {
  voiceId: string;
  name: string;
  provider: string;
  accent?: string;
  gender?: string;
  previewUrl?: string;
}

async function call<T>(method: "GET" | "PATCH", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getRetellBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getRetellApiKey()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const hint = res.status === 401 ? " — API key rejected." : "";
    throw new Error(`Retell ${res.status} on ${method} ${path}${hint} ${text}`.trim());
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** List all voices. Pass `accent` to filter (e.g. "Indian"). */
export async function listVoices(accent?: string): Promise<Voice[]> {
  const raw = await call<any[]>("GET", "/list-voices");
  const voices: Voice[] = (raw ?? []).map((v) => ({
    voiceId: v.voice_id,
    name: v.voice_name,
    provider: v.provider,
    accent: v.accent,
    gender: v.gender,
    previewUrl: v.preview_audio_url,
  }));
  if (!accent) return voices;
  const a = accent.toLowerCase();
  return voices.filter((v) => (v.accent ?? "").toLowerCase() === a);
}

/** Get the agent's current voice id, language, post-call model, and name. */
export async function getAgentVoice(
  agentId: string,
): Promise<{
  voiceId: string;
  language?: string;
  postCallModel?: string;
  agentName?: string;
}> {
  const a = await call<any>("GET", `/get-agent/${agentId}`);
  return {
    voiceId: a.voice_id,
    language: a.language,
    postCallModel: a.post_call_analysis_model,
    agentName: a.agent_name,
  };
}

/** Update the agent's post-call analysis model. */
export async function updatePostCallModel(agentId: string, model: string): Promise<string> {
  const a = await call<any>("PATCH", `/update-agent/${agentId}`, {
    post_call_analysis_model: model,
  });
  return a.post_call_analysis_model ?? model;
}

/**
 * The persona lives on the agent's Retell LLM: `general_prompt` (system prompt)
 * and `begin_message` (first line the agent speaks). Read/update via the LLM,
 * reusing the agent → response_engine.llm_id hop.
 */
export async function getAgentPrompt(
  agentId: string,
): Promise<{ prompt: string; firstMessage: string }> {
  const a = await call<any>("GET", `/get-agent/${agentId}`);
  const llmId = a.response_engine?.llm_id;
  if (!llmId) return { prompt: "", firstMessage: "" };
  const llm = await call<any>("GET", `/get-retell-llm/${llmId}`);
  return { prompt: llm.general_prompt ?? "", firstMessage: llm.begin_message ?? "" };
}

/** Update the agent's persona (system prompt + first message). */
export async function updateAgentPrompt(
  agentId: string,
  prompt: string,
  firstMessage: string,
): Promise<{ prompt: string; firstMessage: string }> {
  const a = await call<any>("GET", `/get-agent/${agentId}`);
  const llmId = a.response_engine?.llm_id;
  if (!llmId) throw new Error("Agent has no Retell LLM to update.");
  const llm = await call<any>("PATCH", `/update-retell-llm/${llmId}`, {
    general_prompt: prompt,
    begin_message: firstMessage,
  });
  return {
    prompt: llm.general_prompt ?? prompt,
    firstMessage: llm.begin_message ?? firstMessage,
  };
}

/**
 * Call limits (billing safety). `maxDurationMs` force-ends any call at N ms
 * (Retell allows 60000–7200000). `silenceMs` ends the call N ms after the user
 * goes silent following agent speech. These cap runaway calls where the other
 * party forgets to hang up.
 */
export interface CallLimits {
  maxDurationMs: number;
  silenceMs: number;
}

export async function getCallLimits(agentId: string): Promise<CallLimits> {
  const a = await call<any>("GET", `/get-agent/${agentId}`);
  return {
    maxDurationMs: a.max_call_duration_ms ?? 0,
    silenceMs: a.end_call_after_silence_ms ?? 0,
  };
}

export async function updateCallLimits(
  agentId: string,
  maxDurationMs: number,
  silenceMs: number,
): Promise<CallLimits> {
  const a = await call<any>("PATCH", `/update-agent/${agentId}`, {
    max_call_duration_ms: maxDurationMs,
    end_call_after_silence_ms: silenceMs,
  });
  return {
    maxDurationMs: a.max_call_duration_ms ?? maxDurationMs,
    silenceMs: a.end_call_after_silence_ms ?? silenceMs,
  };
}

/**
 * Ready-made persona templates for common Indian/Hinglish outbound use cases.
 * Selecting one in the UI fills the prompt + first-message fields (still
 * editable before saving). Purely server-side data.
 */

/** Update the agent's voice. */
export async function updateAgentVoice(agentId: string, voiceId: string): Promise<string> {
  const a = await call<any>("PATCH", `/update-agent/${agentId}`, { voice_id: voiceId });
  return a.voice_id ?? voiceId;
}

/** Update the agent's language (Retell code, e.g. "multi", "hi-IN"). */
export async function updateAgentLanguage(agentId: string, language: string): Promise<string> {
  const a = await call<any>("PATCH", `/update-agent/${agentId}`, { language });
  return a.language ?? language;
}

/**
 * The LLM model lives on the agent's Retell LLM (response_engine.llm_id), not
 * the agent itself — so read/update goes via /get-retell-llm and
 * /update-retell-llm.
 */
export async function getAgentModel(
  agentId: string,
): Promise<{ model?: string; llmId?: string }> {
  const a = await call<any>("GET", `/get-agent/${agentId}`);
  const llmId = a.response_engine?.llm_id;
  if (!llmId) return {};
  const llm = await call<any>("GET", `/get-retell-llm/${llmId}`);
  return { model: llm.model, llmId };
}

/** Update the agent's LLM model. */
export async function updateAgentModel(agentId: string, model: string): Promise<string> {
  const { llmId } = await getAgentModel(agentId);
  if (!llmId) throw new Error("Agent has no Retell LLM to update.");
  const llm = await call<any>("PATCH", `/update-retell-llm/${llmId}`, { model });
  return llm.model ?? model;
}

/**
 * Curated LLM options for the UI, with per-minute price ($/min) from the Retell
 * rate card (see docs/retell-rate-card.md). Ordered cheapest first.
 */
export interface ModelOption {
  model: string;
  label: string;
  pricePerMin: number;
}

export const MODELS: ModelOption[] = [
  { model: "gpt-4.1-nano", label: "GPT-4.1 nano", pricePerMin: 0.004 },
  { model: "gpt-4o-mini", label: "GPT-4o mini", pricePerMin: 0.006 },
  { model: "gemini-2.0-flash", label: "Gemini 2.0 Flash", pricePerMin: 0.006 },
  { model: "gpt-5-mini", label: "GPT-5 mini", pricePerMin: 0.012 },
  { model: "gpt-4.1-mini", label: "GPT-4.1 mini", pricePerMin: 0.016 },
  { model: "claude-4.5-haiku", label: "Claude 4.5 Haiku", pricePerMin: 0.025 },
  { model: "gemini-2.5-flash", label: "Gemini 2.5 Flash", pricePerMin: 0.035 },
  { model: "gpt-5", label: "GPT-5", pricePerMin: 0.04 },
  { model: "gpt-4.1", label: "GPT-4.1", pricePerMin: 0.045 },
  { model: "gpt-4o", label: "GPT-4o", pricePerMin: 0.05 },
];

/**
 * Curated post-call-analysis model options. Runs once per call (billed per call,
 * not per minute) — so pick a cheap model unless you need rich summaries.
 * Prices are $/call from the rate card's "Post Call Analysis LLM Charges".
 */
export interface PostCallModelOption {
  model: string;
  label: string;
  pricePerCall: number;
}

export const POST_CALL_MODELS: PostCallModelOption[] = [
  { model: "gpt-5-nano", label: "GPT-5 nano", pricePerCall: 0.001 },
  { model: "gpt-4o-mini", label: "GPT-4o mini", pricePerCall: 0.002 },
  { model: "gpt-4.1-nano", label: "GPT-4.1 nano", pricePerCall: 0.002 },
  { model: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", pricePerCall: 0.003 },
  { model: "gpt-4.1-mini", label: "GPT-4.1 mini", pricePerCall: 0.006 },
  { model: "gpt-4.1", label: "GPT-4.1", pricePerCall: 0.015 },
];

/**
 * Curated language options for the UI. `code` is Retell's agent `language`
 * value. "Hinglish" maps to `multi` (Hindi + English code-switching); Retell
 * has no dedicated Hinglish code. Telugu is intentionally absent — Retell has
 * no Telugu voice, so the agent cannot speak it.
 */
export interface LanguageOption {
  code: string;
  label: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: "multi", label: "Hinglish (Hindi + English)" },
  { code: "hi-IN", label: "Hindi" },
  { code: "en-IN", label: "English (India)" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "ta-IN", label: "Tamil" },
  { code: "mr-IN", label: "Marathi" },
  { code: "kn-IN", label: "Kannada" },
  { code: "ur-IN", label: "Urdu" },
  { code: "ar-SA", label: "Arabic" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr-FR", label: "French" },
];

// Run directly (`npm run retell:voice -- <voiceId>`) to set the agent's voice,
// or with no arg to list Indian-accent voices + show the current one.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const agentId = process.env.RETELL_AGENT_ID?.trim();
    if (!agentId) throw new Error("RETELL_AGENT_ID not set in .env");
    console.log(`🔑 Retell key ${mask(getRetellApiKey())}`);
    const target = process.argv[2];
    if (target) {
      const set = await updateAgentVoice(agentId, target);
      console.log(`✅ Agent ${agentId} voice set to: ${set}`);
    } else {
      const current = await getAgentVoice(agentId);
      console.log(`Current voice: ${current.voiceId}\n`);
      const indian = await listVoices("Indian");
      console.log(`Indian-accent voices (${indian.length}):`);
      for (const v of indian)
        console.log(`  • ${v.voiceId.padEnd(22)} ${v.name}  (${v.gender}, ${v.provider})`);
    }
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
