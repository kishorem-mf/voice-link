import { getRetellApiKey, getRetellBaseUrl, mask } from "./config.js";

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

async function get<T>(path: string, apiKey: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${getRetellBaseUrl()}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    throw new Error(`Network error reaching Retell (${path}): ${(err as Error).message}`);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const hint = res.status === 401 ? " — API key rejected. Check RETELL_API_KEY." : "";
    throw new Error(`Retell ${res.status} on ${path}${hint} ${text}`.trim());
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Validate the key and list agents + phone numbers. */
export async function ping(apiKey: string = getRetellApiKey()): Promise<RetellPingResult> {
  const [agentsRaw, phonesRaw] = await Promise.all([
    get<any[]>("/list-agents", apiKey),
    get<any[]>("/list-phone-numbers", apiKey),
  ]);

  const agents: RetellAgentSummary[] = (agentsRaw ?? []).map((a) => ({
    agentId: a.agent_id,
    name: a.agent_name ?? "",
  }));
  const phoneNumbers: RetellPhoneSummary[] = (phonesRaw ?? []).map((p) => ({
    phoneNumber: p.phone_number,
    outboundAgentId: p.outbound_agent_id ?? undefined,
    inboundAgentId: p.inbound_agent_id ?? undefined,
  }));

  return { agents, phoneNumbers };
}

// Run directly (`npm run retell:auth`) to validate the key and list ids.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const apiKey = getRetellApiKey();
    console.log(`🔑 Using Retell key ${mask(apiKey)} — contacting Retell…`);
    const { agents, phoneNumbers } = await ping(apiKey);
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
