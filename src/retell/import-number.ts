import { getRetellApiKey, getRetellBaseUrl, getRetellInboundAgentId, mask } from "./config.js";
import { getActiveProfile } from "./profiles.js";

/**
 * Import a VoiceLink DID into Retell via SIP trunking and bind the outbound +
 * inbound agents — the API equivalent of the dashboard "Connect your number
 * via SIP trunking" flow. Uses `POST /import-phone-number`.
 *
 * Termination URI + transport differ **per VoiceLink account** (see
 * profiles.ts) — e.g. the primary account uses `app.voicelink.co.in:3300`,
 * a newer account may use `sip.voicelink.co.in:3300`. Always pass the active
 * profile's values rather than hardcoding one.
 */
export interface ImportResult {
  phoneNumber: string;
  outboundAgents: unknown;
  inboundAgents: unknown;
  termination: unknown;
}

/** Import `phoneNumber` (E.164) via `terminationUri`, binding both agents. */
export async function importNumber(
  phoneNumber: string,
  outboundAgentId: string,
  terminationUri: string,
  transport = "TCP",
  inboundAgentId?: string,
  apiKey: string = getRetellApiKey(),
): Promise<ImportResult> {
  const body: Record<string, unknown> = {
    phone_number: phoneNumber,
    termination_uri: terminationUri,
    transport,
    outbound_agents: [{ agent_id: outboundAgentId, weight: 1 }],
    nickname: "VoiceLink",
    ignore_e164_validation: true,
  };
  if (inboundAgentId) body.inbound_agents = [{ agent_id: inboundAgentId, weight: 1 }];

  let res = await fetch(`${getRetellBaseUrl()}/import-phone-number`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let text = await res.text().catch(() => "");

  // A number already in Retell can't be re-imported — it has to be updated.
  // This is the normal path when re-pointing a DID at a new agent pair (e.g.
  // after re-provisioning a profile), so it is a fallback, not an error.
  if (!res.ok && /already exists/i.test(text)) {
    const { phone_number: _pn, ignore_e164_validation: _ig, ...patch } = body;
    res = await fetch(`${getRetellBaseUrl()}/update-phone-number/${encodeURIComponent(phoneNumber)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    text = await res.text().catch(() => "");
  }

  if (!res.ok) {
    const hint = res.status === 401 ? " — API key rejected." : "";
    throw new Error(`Retell ${res.status} on import/update-phone-number${hint} ${text}`.trim());
  }
  const json = text ? JSON.parse(text) : {};
  return {
    phoneNumber: json.phone_number ?? phoneNumber,
    outboundAgents: json.outbound_agents ?? null,
    inboundAgents: json.inbound_agents ?? null,
    termination: json.sip_outbound_trunk_config ?? null,
  };
}

// Run directly (`npm run retell:import`) to import the ACTIVE profile's DID.
// Optional args override the active profile: [phoneNumber] [terminationUri] [transport]
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const apiKey = getRetellApiKey();
    const profile = getActiveProfile();
    const phoneNumber = process.argv[2] || profile.fromNumber;
    const terminationUri = process.argv[3] || profile.terminationUri;
    const transport = process.argv[4] || profile.transport || "TCP";
    const outboundAgentId = process.env.RETELL_AGENT_ID?.trim();
    const inboundAgentId = getRetellInboundAgentId();
    if (!outboundAgentId) throw new Error("RETELL_AGENT_ID not set in .env");

    console.log(`🔑 Retell key ${mask(apiKey)}`);
    console.log(`📂 Profile: ${profile.name}`);
    console.log(`📥 Importing ${phoneNumber} → termination ${terminationUri} (${transport})`);
    console.log(`📇 Outbound agent ${outboundAgentId}` + (inboundAgentId ? `, inbound agent ${inboundAgentId}` : ""));
    const r = await importNumber(phoneNumber, outboundAgentId, terminationUri, transport, inboundAgentId, apiKey);
    console.log("✅ Imported:");
    console.log(`   phone_number    = ${r.phoneNumber}`);
    console.log(`   outbound_agents = ${JSON.stringify(r.outboundAgents)}`);
    console.log(`   inbound_agents  = ${JSON.stringify(r.inboundAgents)}`);
    console.log(`   termination     = ${JSON.stringify(r.termination)}`);
    console.log(
      `\n⚠️  Also required in the VoiceLink portal: add ${phoneNumber} to the RETELL ` +
        `trunk's "Inbound Call — DIDs" (Call Routing Configuration). This API call only ` +
        `configures the Retell side.`,
    );
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
