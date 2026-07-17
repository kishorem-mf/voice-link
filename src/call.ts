import { getConfig, mask } from "./config.js";

/**
 * Module 5 — Outbound call trigger.
 *
 * Places a single outbound call through the ElevenLabs SIP-trunk endpoint:
 * `POST /v1/convai/sip-trunk/outbound-call`. The agent handles the conversation;
 * call outcomes arrive later at the webhook receiver (module 4).
 *
 * NOTE: whether the call actually connects depends on VoiceLink-side setup that
 * is external to this code — SIP transport, the DID being routed to the trunk,
 * and using the right regional endpoint (see docs/outbound-ai-calling-setup.md).
 */

export interface CallResult {
  success: boolean;
  message?: string;
  conversationId?: string;
  sipCallId?: string;
}

/** Basic E.164 check: "+" followed by 8-15 digits, first digit non-zero. */
export function isE164(number: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(number);
}

/**
 * Turn an E.164 number into the string the trunk expects: the optional tech
 * prefix followed by the E.164 digits without the leading "+". With an empty
 * prefix this just strips the "+".
 */
export function formatDialNumber(e164: string, techPrefix: string): string {
  return `${techPrefix}${e164.replace(/^\+/, "")}`;
}

/**
 * Place one outbound call to `toNumber` (E.164). Uses the configured agent,
 * SIP-trunk phone number, base URL, and tech prefix. Throws on validation,
 * network, or API error.
 */
export async function placeCall(toNumber: string): Promise<CallResult> {
  if (!isE164(toNumber)) {
    throw new Error(
      `Invalid destination "${toNumber}" — must be E.164, e.g. +919429391391.`,
    );
  }

  const { elevenLabsApiKey, agentId, phoneNumberId, baseUrl, techPrefix } = getConfig();
  const dialNumber = formatDialNumber(toNumber, techPrefix);
  const body = {
    agent_id: agentId,
    agent_phone_number_id: phoneNumberId,
    to_number: dialNumber,
  };

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/convai/sip-trunk/outbound-call`, {
      method: "POST",
      headers: {
        "xi-api-key": elevenLabsApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Network error reaching ElevenLabs: ${(err as Error).message}`,
    );
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const hint =
      res.status === 401 ? " — API key rejected. Check ELEVENLABS_API_KEY." : "";
    throw new Error(`ElevenLabs ${res.status} on outbound-call${hint} ${text}`.trim());
  }

  const json = text ? JSON.parse(text) : {};
  return {
    success: json.success ?? true,
    message: json.message,
    conversationId: json.conversation_id,
    sipCallId: json.sip_call_id,
  };
}

// Run directly (`npm run dial -- +91XXXXXXXXXX`) to place one call.
if (import.meta.url === `file://${process.argv[1]}`) {
  const toNumber = process.argv[2];
  if (!toNumber) {
    console.error("Usage: npm run dial -- +91XXXXXXXXXX");
    process.exit(1);
  }
  try {
    const { agentId, phoneNumberId, elevenLabsApiKey, baseUrl, techPrefix } = getConfig();
    console.log(`🔑 API key ${mask(elevenLabsApiKey)}`);
    console.log(`🌏 Endpoint ${baseUrl}`);
    console.log(`📇 Agent ${agentId}`);
    console.log(
      `☎️  From ${phoneNumberId}  →  To ${toNumber}` +
        (techPrefix ? `  (dialed as ${formatDialNumber(toNumber, techPrefix)})` : ""),
    );
    console.log("Placing call…");
    const result = await placeCall(toNumber);
    console.log("✅ Call accepted by ElevenLabs:");
    console.log(`   conversationId = ${result.conversationId ?? "(none)"}`);
    console.log(`   sipCallId      = ${result.sipCallId ?? "(none)"}`);
    if (result.message) console.log(`   message        = ${result.message}`);
    console.log(
      "\nWatch the webhook server (npm run webhook) for the post-call outcome.",
    );
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
