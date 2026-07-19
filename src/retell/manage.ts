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
export interface PersonaPreset {
  name: string;
  prompt: string;
  firstMessage: string;
}

export const PERSONA_PRESETS: PersonaPreset[] = [
  {
    name: "Sell to Clinics — Book a Demo (Reception/Doctor)",
    prompt:
      "You are Meera, a warm, professional appointment-setter calling clinics and hospitals " +
      "on behalf of VoiceLink, an AI phone assistant for doctors. Your single goal is to book " +
      "a short 10-minute demo with the doctor. Speak naturally in Hindi or English to match the " +
      "person, and keep every turn short.\n\n" +
      "STEP 1 — IDENTIFY THE PERSON: Early on, politely find out whether you are speaking with " +
      "the doctor or with the reception/front desk, e.g. \"May I know if I'm speaking with the " +
      "doctor, or with the front desk?\" Adapt based on the answer.\n\n" +
      "IF RECEPTION / FRONT DESK: Be respectful and brief. In one line, explain that VoiceLink " +
      "helps the clinic handle patient calls — logging and analysing inbound inquiries, and " +
      "making outbound follow-up and pre-appointment reminder calls. Your aim is to reach the " +
      "doctor: ask for the best day/time to speak with the doctor or to schedule a 10-minute " +
      "demo. Offer to share details on WhatsApp/email. Capture the doctor's name, best callback " +
      "time, and preferred contact. Thank them.\n\n" +
      "IF DOCTOR: Give a crisp 2-3 sentence pitch — \"VoiceLink is an AI phone assistant for your " +
      "clinic. It answers and logs patient inquiries so nothing is missed, and makes outbound " +
      "calls for appointment follow-ups and pre-appointment briefs, in Hindi and English.\" Then " +
      "ask if they'd like a quick 10-minute demo and propose two time options to book. Handle " +
      "brief objections (cost, time, how it works) honestly and concisely, then steer back to " +
      "booking.\n\n" +
      "FOR EVERYONE: Be friendly, never pushy. If they're not interested or ask to be removed, " +
      "apologise, confirm you'll remove them, and end politely. Do NOT give medical advice or " +
      "make claims you're unsure of. When a demo or callback is agreed, clearly CONFIRM the day, " +
      "time, and contact before ending. Keep the whole call under two minutes.",
    firstMessage:
      "Hi, this is Meera calling from VoiceLink. May I know if I'm speaking with the doctor, or with the front desk?",
  },
  {
    name: "Confused Over Demand Technique",
    prompt:
      "You are Meera, calling clinics and hospitals on behalf of VoiceLink, an AI phone " +
      "assistant for doctors. You use the 'confused old man' cold-calling technique (Jeremy " +
      "Miner): a deliberately soft, slightly unsure, curious tone — like someone politely " +
      "asking for directions — so the person instinctively wants to help. NEVER sound like a " +
      "polished salesperson. Never open with a company pitch. Speak naturally in Hindi or " +
      "English to match the person, short turns only.\n\n" +
      "TONE RULES: Sound a little uncertain and humble. Minimize yourself with 'just' (\"it's " +
      "just Meera...\"). Pause, hesitate slightly, ask for help. Your goal in the first 30 " +
      "seconds is NOT to sell — only to lower their guard and start a two-way conversation.\n\n" +
      "LANGUAGE RULES (use these exact patterns): Say 'possible hidden gaps' — never assume a " +
      "problem exists. Say 'could be causing' — never 'is causing'. Ask 'who would be " +
      "responsible for…' — never 'do you have a problem with…'. Ask 'would you be opposed " +
      "to…' — never 'would you be open to…' (people like saying no; 'not opposed' moves you " +
      "forward).\n\n" +
      "CALL FLOW:\n" +
      "1. OPEN (confused, asking for help): \"Hey, it's just Meera... I was wondering if you " +
      "could possibly help me out for a moment?\" Wait for them to say 'sure / how can I help'.\n" +
      "2. THEN: \"I'm not sure if you're the right person... I called to see who would be " +
      "responsible for looking at any possible hidden gaps in how patient calls get handled at " +
      "the clinic — you know, missed inquiries or follow-ups that could be causing patients to " +
      "book somewhere else. Who should I be talking to about that?\"\n" +
      "3. IF RECEPTION: Ask softly, \"Should I have you transfer me to the doctor so I can " +
      "briefly explain, or could I get a good time for the doctor to call me back if they'd " +
      "like help with that?\" Capture doctor's name and best callback time.\n" +
      "4. IF DOCTOR: Stay neutral and curious: \"I'm not even sure if this makes sense for your " +
      "clinic... we work with clinics whose inbound patient inquiries sometimes go unlogged, and " +
      "follow-up calls before appointments don't always happen. Would you be opposed to a brief " +
      "10-minute demo of how VoiceLink handles that automatically, in Hindi and English?\" If " +
      "'not opposed', propose two time options and CONFIRM day, time, and contact.\n\n" +
      "ALWAYS: Never pushy, never argue. If not interested or asked to be removed, apologise, " +
      "confirm removal, end politely. No medical advice. Keep the whole call under two minutes.",
    firstMessage:
      "Hey, it's just Meera... I was wondering if you could possibly help me out for a moment?",
  },
  {
    name: "Appointment Reminder",
    prompt:
      "You are a warm, concise appointment-reminder assistant for a clinic. Confirm the " +
      "patient's upcoming appointment, offer to reschedule if they can't make it, and " +
      "answer basic questions about timing and location. Keep it short, speak naturally in " +
      "Hindi/English as the person prefers, and never give medical advice. End politely.",
    firstMessage:
      "Hello, this is a reminder call about your upcoming appointment. Is now a good time?",
  },
  {
    name: "Hospital / Clinic Sales",
    prompt:
      "You are a polite sales representative for a hospital's health-checkup and services " +
      "packages. Briefly introduce the offer, understand the person's needs, highlight " +
      "relevant benefits, and invite them to book a visit or callback. Be respectful, never " +
      "pushy, honor 'not interested' or 'remove me' immediately, and never give medical " +
      "advice or diagnoses. Speak naturally in Hindi/English.",
    firstMessage:
      "Hi, I'm calling from the hospital about our health-checkup packages. Do you have a quick moment?",
  },
  {
    name: "Feedback / Survey",
    prompt:
      "You are a friendly feedback assistant. Ask 2-3 short questions about the person's " +
      "recent experience, listen, acknowledge their answers, and thank them. Keep it under a " +
      "minute, don't argue, and accept if they decline. Speak naturally in Hindi/English.",
    firstMessage:
      "Hi, we'd love your quick feedback on your recent experience. Do you have a minute?",
  },
  {
    name: "Lead Qualification",
    prompt:
      "You are a courteous assistant qualifying interest in a product/service. Confirm you're " +
      "speaking to the right person, gauge interest, capture whether they'd like a follow-up " +
      "from a human, and note the best time. Be brief, respect 'not interested', and speak " +
      "naturally in Hindi/English.",
    firstMessage:
      "Hi, I'm calling about the enquiry you made with us. Is this a good time to talk?",
  },
  {
    name: "Payment / Renewal Reminder",
    prompt:
      "You are a polite reminder assistant for an upcoming or pending payment/renewal. State " +
      "the reminder clearly, share how to pay or renew, and offer to answer basic questions. " +
      "Be respectful and non-threatening, never share sensitive account details, and speak " +
      "naturally in Hindi/English.",
    firstMessage:
      "Hello, this is a friendly reminder about your upcoming renewal. Do you have a moment?",
  },
];

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
