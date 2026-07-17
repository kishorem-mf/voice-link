import { getRetellConfig, mask } from "./config.js";

/**
 * Retell outbound call trigger (parallel to the ElevenLabs call module).
 *
 * Places a call via `POST /v2/create-phone-call`. Retell routes the SIP INVITE
 * to the trunk configured on the imported phone number (VoiceLink termination
 * URL). Outcomes are visible in the Retell dashboard / call APIs.
 */

export interface RetellCallResult {
  callId?: string;
  callStatus?: string;
  agentId?: string;
  direction?: string;
}

/** Basic E.164 check: "+" followed by 8-15 digits, first digit non-zero. */
export function isE164(number: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(number);
}

/** Apply the optional tech prefix (prefix + E.164 digits without "+"). */
export function formatDialNumber(e164: string, techPrefix: string): string {
  if (!techPrefix) return e164;
  return `${techPrefix}${e164.replace(/^\+/, "")}`;
}

/** Place one outbound call to `toNumber` (E.164). */
export async function placeCall(toNumber: string): Promise<RetellCallResult> {
  if (!isE164(toNumber)) {
    throw new Error(`Invalid destination "${toNumber}" — must be E.164, e.g. +919429391391.`);
  }

  const { apiKey, baseUrl, agentId, fromNumber, techPrefix } = getRetellConfig();
  const dialNumber = formatDialNumber(toNumber, techPrefix);
  const body: Record<string, unknown> = {
    from_number: fromNumber,
    to_number: dialNumber,
    override_agent_id: agentId,
  };
  // If a tech prefix reshapes the number into a non-E.164 string, Retell would
  // otherwise reject it — bypass its validation in that case.
  if (techPrefix) body.ignore_e164_validation = true;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v2/create-phone-call`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Network error reaching Retell: ${(err as Error).message}`);
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const hint = res.status === 401 ? " — API key rejected." : "";
    throw new Error(`Retell ${res.status} on create-phone-call${hint} ${text}`.trim());
  }
  const json = text ? JSON.parse(text) : {};
  return {
    callId: json.call_id,
    callStatus: json.call_status,
    agentId: json.agent_id,
    direction: json.direction,
  };
}

// Run directly (`npm run retell:dial -- +91XXXXXXXXXX`) to place one call.
if (import.meta.url === `file://${process.argv[1]}`) {
  const toNumber = process.argv[2];
  if (!toNumber) {
    console.error("Usage: npm run retell:dial -- +91XXXXXXXXXX");
    process.exit(1);
  }
  try {
    const { apiKey, baseUrl, agentId, fromNumber, techPrefix } = getRetellConfig();
    console.log(`🔑 Retell key ${mask(apiKey)}`);
    console.log(`🌏 Endpoint ${baseUrl}`);
    console.log(`📇 Agent ${agentId}`);
    console.log(
      `☎️  From ${fromNumber}  →  To ${toNumber}` +
        (techPrefix ? `  (dialed as ${formatDialNumber(toNumber, techPrefix)})` : ""),
    );
    console.log("Placing call…");
    const r = await placeCall(toNumber);
    console.log("✅ Call created by Retell:");
    console.log(`   callId     = ${r.callId ?? "(none)"}`);
    console.log(`   callStatus = ${r.callStatus ?? "(none)"}`);
    console.log(`   direction  = ${r.direction ?? "(none)"}`);
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
