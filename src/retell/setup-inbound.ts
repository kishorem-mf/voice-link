import { getRetellApiKey, getRetellBaseUrl, mask } from "./config.js";
import { PERSONA_PRESETS } from "./manage.js";

/**
 * One-time setup: create an INBOUND receptionist agent that mirrors the outbound
 * agent's voice/model/language/limits, then assign it as the DID's inbound agent.
 *
 * Run once: `npm run retell:setup-inbound`. Copy the printed id into .env as
 * RETELL_INBOUND_AGENT_ID. Re-running creates another agent — only run once.
 */
async function api<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getRetellBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getRetellApiKey()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Retell ${res.status} on ${method} ${path} ${text}`.trim());
  return (text ? JSON.parse(text) : {}) as T;
}

async function main() {
  const outboundId = process.env.RETELL_AGENT_ID?.trim();
  const fromNumber = process.env.RETELL_FROM_NUMBER?.trim();
  if (!outboundId || !fromNumber) throw new Error("RETELL_AGENT_ID and RETELL_FROM_NUMBER must be set.");

  console.log(`🔑 Retell key ${mask(getRetellApiKey())}`);
  console.log(`📇 Mirroring outbound agent ${outboundId}…`);

  // 1. Read the outbound agent to copy its voice/model/language/limits.
  const ob = await api<any>("GET", `/get-agent/${outboundId}`);
  const obLlm = await api<any>("GET", `/get-retell-llm/${ob.response_engine?.llm_id}`);

  const preset = PERSONA_PRESETS.find((p) => p.name.startsWith("Clinic Receptionist"))!;

  // 2. Create the inbound LLM (receptionist persona, same model as outbound).
  const llm = await api<any>("POST", "/create-retell-llm", {
    general_prompt: preset.prompt,
    begin_message: preset.firstMessage,
    model: obLlm.model,
  });
  console.log(`✅ Created inbound LLM ${llm.llm_id} (model ${obLlm.model})`);

  // 3. Create the inbound agent mirroring outbound settings.
  const agent = await api<any>("POST", "/create-agent", {
    response_engine: { type: "retell-llm", llm_id: llm.llm_id },
    agent_name: "VoiceLink-Inbound-Retell",
    voice_id: ob.voice_id,
    voice_model: ob.voice_model ?? undefined,
    language: ob.language,
    post_call_analysis_model: ob.post_call_analysis_model,
    max_call_duration_ms: ob.max_call_duration_ms,
    end_call_after_silence_ms: ob.end_call_after_silence_ms,
    reminder_trigger_ms: ob.reminder_trigger_ms,
    reminder_max_count: ob.reminder_max_count,
  });
  console.log(`✅ Created inbound agent ${agent.agent_id} (voice ${ob.voice_id}, lang ${ob.language})`);

  // 4. Assign as the DID's inbound agent (array form; single-field is deprecated).
  //    outbound_agents is left untouched.
  await api("PATCH", `/update-phone-number/${encodeURIComponent(fromNumber)}`, {
    inbound_agents: [{ agent_id: agent.agent_id, weight: 1 }],
  });
  console.log(`✅ Assigned inbound agent to ${fromNumber}`);

  console.log(`\nAdd to .env:\n  RETELL_INBOUND_AGENT_ID=${agent.agent_id}`);
}

main().catch((err) => {
  console.error(`❌ ${(err as Error).message}`);
  process.exit(1);
});
