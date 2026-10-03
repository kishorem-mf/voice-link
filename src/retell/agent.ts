import { getRetellApiKey, getRetellBaseUrl, mask } from "./config.js";

/**
 * Retell agent provisioning (parallel to the ElevenLabs agent module).
 *
 * A Retell agent needs a response engine. So this does two API calls:
 *   1. POST /create-retell-llm  → llm_id (holds the prompt + first message)
 *   2. POST /create-agent       → agent_id (binds the LLM + a voice)
 */

export interface CreateRetellAgentOptions {
  name: string;
  /** System prompt describing the agent's behaviour. */
  prompt: string;
  /** First line the agent speaks when the call connects. */
  firstMessage: string;
  /** Retell voice id, e.g. "11labs-Adrian" / "retell-Cimo". */
  voiceId?: string;
  /** BCP-47 language, defaults to en-US. */
  language?: string;
  /** Conversation LLM. Defaults to the cost-optimised model, not Retell's. */
  model?: string;
  /** Model used once per call for the summary/analysis. */
  postCallModel?: string;
}

/**
 * Cost defaults, applied to every agent we create.
 *
 * Retell's own defaults are gpt-4.1 for both, which is 7.5x the per-minute LLM
 * cost and ~7x the per-call analysis cost of these — roughly $0.16/min instead
 * of $0.11/min all-in. Measured, not estimated: see docs/retell-rate-card.md.
 * Set here rather than left to a follow-up step, because the overspend is
 * silent and only shows up on the bill.
 */
export const DEFAULT_MODEL = "gpt-4o-mini";
export const DEFAULT_POST_CALL_MODEL = "gpt-4o-mini";

/** Sensible starter config for a VoiceLink outbound calling agent. */
export const DEFAULT_RETELL_AGENT: CreateRetellAgentOptions = {
  name: "VoiceLink-Outbound-Retell",
  prompt:
    "You are a polite outbound calling assistant for VoiceLink. Greet the " +
    "person, briefly state why you are calling, listen, and answer concisely. " +
    "Respect if they are busy or ask to be removed, and end the call courteously.",
  firstMessage:
    "Hi, this is the VoiceLink assistant calling. Do you have a quick moment?",
  voiceId: "11labs-Adrian",
  language: "en-US",
};

async function post<T>(path: string, body: unknown, apiKey: string): Promise<T> {
  const res = await fetch(`${getRetellBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const hint = res.status === 401 ? " — API key rejected." : "";
    throw new Error(`Retell ${res.status} on ${path}${hint} ${text}`.trim());
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Create an LLM + agent; returns the new agent id. */
export async function createAgent(
  opts: CreateRetellAgentOptions,
  apiKey: string = getRetellApiKey(),
): Promise<{ agentId: string; llmId: string }> {
  const llm = await post<{ llm_id?: string }>(
    "/create-retell-llm",
    {
      general_prompt: opts.prompt,
      begin_message: opts.firstMessage,
      model: opts.model ?? DEFAULT_MODEL,
    },
    apiKey,
  );
  if (!llm.llm_id) throw new Error(`No llm_id returned: ${JSON.stringify(llm)}`);

  const agent = await post<{ agent_id?: string }>(
    "/create-agent",
    {
      response_engine: { type: "retell-llm", llm_id: llm.llm_id },
      voice_id: opts.voiceId ?? "11labs-Adrian",
      agent_name: opts.name,
      language: opts.language ?? "en-US",
      post_call_analysis_model: opts.postCallModel ?? DEFAULT_POST_CALL_MODEL,
      // Billing safety: cap runaway calls (Retell defaults are 60min max /
      // 10min silence). See docs/working-configuration.md.
      max_call_duration_ms: 300000, // 5 min hard cap
      end_call_after_silence_ms: 30000, // end 30s after the user goes silent
      reminder_trigger_ms: 8000, // nudge "are you there?" after 8s silence
      reminder_max_count: 2,
    },
    apiKey,
  );
  if (!agent.agent_id) throw new Error(`No agent_id returned: ${JSON.stringify(agent)}`);

  return { agentId: agent.agent_id, llmId: llm.llm_id };
}

// Run directly (`npm run retell:agent`) to create the default outbound agent.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const apiKey = getRetellApiKey();
    console.log(`🔑 Retell key ${mask(apiKey)} — creating "${DEFAULT_RETELL_AGENT.name}"…`);
    const { agentId, llmId } = await createAgent(DEFAULT_RETELL_AGENT, apiKey);
    console.log(`✅ Created LLM ${llmId}`);
    console.log(`✅ Created agent ${agentId}`);
    console.log(`\nAdd to .env:\n  RETELL_AGENT_ID=${agentId}`);
    console.log("Then assign this agent as the OUTBOUND agent on your DID in the Retell dashboard.");
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
