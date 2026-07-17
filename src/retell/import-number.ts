import { getRetellApiKey, getRetellBaseUrl, mask } from "./config.js";

/**
 * Import the VoiceLink DID into Retell via SIP trunking and bind the outbound
 * agent — the API equivalent of the dashboard "Connect your number via SIP
 * trunking" flow. Uses `POST /import-phone-number`.
 *
 * Termination URI + transport come from VoiceLink's Retell integration doc:
 *   Termination URL: app.voicelink.co.in:3300, Protocol: TCP.
 */
const TERMINATION_URI = "app.voicelink.co.in:3300";
const TRANSPORT = "TCP";

export interface ImportResult {
  phoneNumber: string;
  outboundAgents: unknown;
  termination: unknown;
}

/** Import `phoneNumber` (E.164) and set `agentId` as its outbound agent. */
export async function importNumber(
  phoneNumber: string,
  agentId: string,
  apiKey: string = getRetellApiKey(),
): Promise<ImportResult> {
  const body = {
    phone_number: phoneNumber,
    termination_uri: TERMINATION_URI,
    transport: TRANSPORT,
    outbound_agents: [{ agent_id: agentId, weight: 1 }],
    nickname: "VoiceLink-Outbound",
    ignore_e164_validation: true,
  };

  const res = await fetch(`${getRetellBaseUrl()}/import-phone-number`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const hint = res.status === 401 ? " — API key rejected." : "";
    throw new Error(`Retell ${res.status} on import-phone-number${hint} ${text}`.trim());
  }
  const json = text ? JSON.parse(text) : {};
  return {
    phoneNumber: json.phone_number ?? phoneNumber,
    outboundAgents: json.outbound_agents ?? json.outbound_agent_id ?? null,
    termination: json.sip_outbound_trunk_config ?? null,
  };
}

// Run directly (`npm run retell:import`). Args: [phoneNumber] [agentId]
// (both default to RETELL_FROM_NUMBER / RETELL_AGENT_ID from .env).
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const apiKey = getRetellApiKey();
    const phoneNumber = process.argv[2] || process.env.RETELL_FROM_NUMBER?.trim();
    const agentId = process.argv[3] || process.env.RETELL_AGENT_ID?.trim();
    if (!phoneNumber || !agentId) {
      console.error("Need RETELL_FROM_NUMBER and RETELL_AGENT_ID (in .env) or pass as args.");
      process.exit(1);
    }
    console.log(`🔑 Retell key ${mask(apiKey)}`);
    console.log(`📥 Importing ${phoneNumber} → termination ${TERMINATION_URI} (${TRANSPORT})`);
    console.log(`📇 Outbound agent ${agentId}`);
    const r = await importNumber(phoneNumber, agentId, apiKey);
    console.log("✅ Imported:");
    console.log(`   phone_number    = ${r.phoneNumber}`);
    console.log(`   outbound_agents = ${JSON.stringify(r.outboundAgents)}`);
    console.log(`   termination     = ${JSON.stringify(r.termination)}`);
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
