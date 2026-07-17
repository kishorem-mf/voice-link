import { getConfig, mask } from "./config.js";

/**
 * Provisioning — bind the agent to the phone number (step 1) and switch the
 * SIP transport to TCP (step 3), both via the ElevenLabs API so you don't have
 * to touch the dashboard. (Step 2, VoiceLink call routing, is portal-only.)
 *
 * Uses `GET /v1/convai/phone-numbers/:id` to read the current config, then
 * `PATCH` to apply the changes.
 */

interface TrunkConfig {
  address: string;
  transport: string;
  media_encryption: string;
  enabled_codecs: string[];
  [k: string]: unknown;
}

interface PhoneNumber {
  phone_number: string;
  assigned_agent: { agent_id: string } | null;
  outbound_trunk?: TrunkConfig;
  provider_config?: TrunkConfig;
  [k: string]: unknown;
}

async function api<T>(
  method: "GET" | "PATCH",
  path: string,
  apiKey: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${getConfig().baseUrl}${path}`, {
    method,
    headers: {
      "xi-api-key": apiKey,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const hint = res.status === 401 ? " — API key rejected." : "";
    throw new Error(`ElevenLabs ${res.status} on ${method} ${path}${hint} ${text}`.trim());
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export interface ProvisionResult {
  assignedAgentId: string | null;
  transport: string;
}

/**
 * Assign the configured agent to the configured phone number and set outbound
 * SIP transport to `transport` (default "tcp"). Returns the resulting state.
 */
export async function provisionNumber(
  transport: string = "tcp",
): Promise<ProvisionResult> {
  const { elevenLabsApiKey, agentId, phoneNumberId } = getConfig();

  // Read current config so we only change what we mean to.
  const current = await api<PhoneNumber>(
    "GET",
    `/convai/phone-numbers/${phoneNumberId}`,
    elevenLabsApiKey,
  );

  const trunk = current.outbound_trunk ?? current.provider_config;
  if (!trunk) {
    throw new Error("Phone number has no SIP trunk config — is it a sip_trunk number?");
  }

  // The writable field is `outbound_trunk_config` (the read model calls it
  // `outbound_trunk`). Sending `outbound_trunk`/`provider_config` is silently
  // ignored — the endpoint returns 200 but keeps the old transport.
  const patch = {
    agent_id: agentId,
    outbound_trunk_config: {
      address: trunk.address,
      transport,
      media_encryption: trunk.media_encryption,
      enabled_codecs: trunk.enabled_codecs,
    },
  };

  const updated = await api<PhoneNumber>(
    "PATCH",
    `/convai/phone-numbers/${phoneNumberId}`,
    elevenLabsApiKey,
    patch,
  );

  return {
    assignedAgentId: updated.assigned_agent?.agent_id ?? null,
    transport: (updated.outbound_trunk ?? updated.provider_config)?.transport ?? "unknown",
  };
}

// Run directly (`npm run provision`) to apply steps 1 and 3.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { elevenLabsApiKey, agentId, phoneNumberId } = getConfig();
    console.log(`🔑 API key ${mask(elevenLabsApiKey)}`);
    console.log(`☎️  Phone number ${phoneNumberId}`);
    console.log(`📇 Assigning agent ${agentId} and setting transport=tcp…`);
    const result = await provisionNumber("tcp");
    console.log("✅ Provisioned:");
    console.log(`   assigned agent = ${result.assignedAgentId ?? "(none)"}`);
    console.log(`   transport      = ${result.transport}`);
    const ok = result.assignedAgentId === agentId && result.transport === "tcp";
    if (!ok) {
      console.error("⚠️  Result did not match expected agent/transport — check above.");
      process.exit(1);
    }
    console.log("\nRemaining manual step: VoiceLink call routing (DID → trunk).");
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
