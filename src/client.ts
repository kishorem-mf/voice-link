import { getApiKey, getConfig, mask } from "./config.js";

/**
 * Module 2 — ElevenLabs client + auth check.
 *
 * A thin wrapper over the ElevenLabs Conversational AI REST API. Its main job
 * at this stage is `ping()`: hit read-only endpoints to prove the API key works
 * and to *list* the agent and phone-number ids you'll need for later modules.
 *
 * Uses the built-in global `fetch` (Node 18+) — no SDK dependency required.
 */

export interface AgentSummary {
  agentId: string;
  name: string;
}

export interface PhoneNumberSummary {
  phoneNumberId: string;
  label: string;
  phoneNumber: string;
  provider: string;
}

export interface PingResult {
  agents: AgentSummary[];
  phoneNumbers: PhoneNumberSummary[];
}

class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

/** GET a read-only endpoint, returning parsed JSON or throwing a clear error. */
async function get<T>(path: string, apiKey: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${getConfig().baseUrl}${path}`, {
      headers: { "xi-api-key": apiKey },
    });
  } catch (err) {
    // Network-level failure (DNS, offline, TLS) — distinct from an API error.
    throw new ElevenLabsError(
      `Network error reaching ElevenLabs (${path}): ${(err as Error).message}`,
      0,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint =
      res.status === 401
        ? " — API key rejected. Check ELEVENLABS_API_KEY."
        : "";
    throw new ElevenLabsError(
      `ElevenLabs ${res.status} on ${path}${hint} ${body}`.trim(),
      res.status,
    );
  }
  return res.json() as Promise<T>;
}

/**
 * Validate the API key and discover the account's agents + phone numbers.
 * Throws ElevenLabsError on auth/network failure.
 */
export async function ping(apiKey: string = getApiKey()): Promise<PingResult> {
  const [agentsRes, phoneRes] = await Promise.all([
    get<{ agents?: Array<{ agent_id: string; name: string }> }>(
      "/convai/agents",
      apiKey,
    ),
    get<{
      // The phone-numbers list endpoint returns a bare array.
      [k: number]: unknown;
    }>("/convai/phone-numbers", apiKey),
  ]);

  const agents: AgentSummary[] = (agentsRes.agents ?? []).map((a) => ({
    agentId: a.agent_id,
    name: a.name,
  }));

  const phoneNumbers: PhoneNumberSummary[] = (
    Array.isArray(phoneRes) ? phoneRes : []
  ).map((p: any) => ({
    phoneNumberId: p.phone_number_id,
    label: p.label ?? "",
    phoneNumber: p.phone_number ?? "",
    provider: p.provider ?? "",
  }));

  return { agents, phoneNumbers };
}

// Run directly (`npm run auth:check`) to validate the key in isolation and
// print the agent / phone-number ids to copy into .env.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const apiKey = getApiKey();
    console.log(`🔑 Using API key ${mask(apiKey)} — contacting ElevenLabs…`);
    const { agents, phoneNumbers } = await ping(apiKey);
    console.log("✅ Auth OK.\n");

    console.log(`Agents (${agents.length}):`);
    if (agents.length === 0) console.log("  (none — create one in the dashboard)");
    for (const a of agents) console.log(`  • ${a.agentId}  "${a.name}"`);

    console.log(`\nPhone numbers (${phoneNumbers.length}):`);
    if (phoneNumbers.length === 0)
      console.log("  (none imported yet — finish the SIP trunk import)");
    for (const p of phoneNumbers)
      console.log(
        `  • ${p.phoneNumberId}  ${p.phoneNumber} "${p.label}" [${p.provider}]`,
      );
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
