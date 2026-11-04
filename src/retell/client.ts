import { getRetellApiKey, mask } from "./config.js";
import { listAgents, listPhoneNumbers } from "./lists.js";

/**
 * Retell client + auth check (parallel to the ElevenLabs client).
 *
 * `ping()` validates the API key and lists agents + phone numbers so you can
 * discover the ids/numbers needed for outbound calls. Uses built-in `fetch`.
 */

export interface RetellAgentSummary {
  agentId: string;
  name: string;
}

export interface RetellPhoneSummary {
  phoneNumber: string;
  outboundAgentId?: string;
  inboundAgentId?: string;
}

export interface RetellPingResult {
  agents: RetellAgentSummary[];
  phoneNumbers: RetellPhoneSummary[];
}

/** Validate the key and list agents + phone numbers. */
export async function ping(): Promise<RetellPingResult> {
  const [agentsRaw, phonesRaw] = await Promise.all([
    listAgents<any>(),
    listPhoneNumbers<any>(),
  ]);

  const agents: RetellAgentSummary[] = agentsRaw.map((a) => ({
    agentId: a.agent_id,
    name: a.agent_name ?? "",
  }));
  // A number carries WEIGHTED LISTS of agents, not one id each — Retell
  // supports splitting traffic across agents. Every profile here binds
  // exactly one, so the first entry is the binding; reading the long-gone
  // `inbound_agent_id` is what made this print "(unset)" for every number.
  const firstAgent = (list: unknown): string | undefined =>
    (Array.isArray(list) ? list[0]?.agent_id : undefined) || undefined;
  const phoneNumbers: RetellPhoneSummary[] = phonesRaw.map((p) => ({
    phoneNumber: p.phone_number,
    outboundAgentId: firstAgent(p.outbound_agents) ?? p.outbound_agent_id ?? undefined,
    inboundAgentId: firstAgent(p.inbound_agents) ?? p.inbound_agent_id ?? undefined,
  }));

  return { agents, phoneNumbers };
}

// Run directly (`npm run retell:auth`) to validate the key and list ids.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const apiKey = getRetellApiKey();
    console.log(`🔑 Using Retell key ${mask(apiKey)} — contacting Retell…`);
    const { agents, phoneNumbers } = await ping();
    console.log("✅ Auth OK.\n");

    console.log(`Agents (${agents.length}):`);
    if (agents.length === 0) console.log("  (none — create one with retell:agent)");
    for (const a of agents) console.log(`  • ${a.agentId}  "${a.name}"`);

    console.log(`\nPhone numbers (${phoneNumbers.length}):`);
    if (phoneNumbers.length === 0)
      console.log("  (none — import the VoiceLink DID via SIP trunking in the Retell dashboard)");
    for (const p of phoneNumbers)
      console.log(
        `  • ${p.phoneNumber}  outbound=${p.outboundAgentId ?? "(unset)"}  inbound=${p.inboundAgentId ?? "(unset)"}`,
      );
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
