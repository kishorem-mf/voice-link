import { getConfig } from "./config.js";

/**
 * Tech-prefix trial runner. VoiceLink returns SIP 404 unless the dialed number
 * is in the exact format its outbound route expects. This tries a set of
 * candidate formats for one base number and reports the SIP status of each,
 * stopping at the first that gets past a 404.
 *
 * Each attempt is a REAL call to the given number. Use only against a number
 * you control and are actively watching.
 */

interface Attempt {
  label: string;
  toNumber: string;
}

/** Build ordered candidate formats for a +<cc><national> E.164 number. */
function candidates(prefix: string, cc: string, national: string): Attempt[] {
  return [
    { label: "prefix + national w/ 0", toNumber: `${prefix}0${national}` },
    { label: "prefix + E.164 (no +)", toNumber: `${prefix}${cc}${national}` },
    { label: "prefix + bare national", toNumber: `${prefix}${national}` },
  ];
}

/** Poll a conversation until it establishes (duration>0) or the window ends. */
async function pollConversation(
  cid: string,
  key: string,
  windowMs = 24000,
): Promise<{ status: string; duration: number }> {
  const deadline = Date.now() + windowMs;
  let last = { status: "unknown", duration: 0 };
  while (Date.now() < deadline) {
    await sleep(4000);
    try {
      const res = await fetch(`${getConfig().baseUrl}/convai/conversations/${cid}`, {
        headers: { "xi-api-key": key },
      });
      const d: any = await res.json();
      last = {
        status: d.status ?? "unknown",
        duration: d.metadata?.call_duration_secs ?? 0,
      };
      if (last.duration > 0 || (d.transcript?.length ?? 0) > 0) return last;
      if (last.status === "failed" || last.status === "done") return last;
    } catch {
      /* keep polling */
    }
  }
  return last;
}

async function attempt(a: Attempt, key: string, agent: string, pid: string) {
  const res = await fetch(`${getConfig().baseUrl}/convai/sip-trunk/outbound-call`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: agent,
      agent_phone_number_id: pid,
      to_number: a.toNumber,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  return {
    success: json.success as boolean | undefined,
    message: (json.message as string) ?? "",
    sipCallId: (json.sip_call_id as string) ?? "",
    conversationId: (json.conversation_id as string) ?? "",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (import.meta.url === `file://${process.argv[1]}`) {
  const { elevenLabsApiKey, agentId, phoneNumberId } = getConfig();
  // Args: prefix cc national
  const [prefix, cc, national] = process.argv.slice(2);
  if (!prefix || !cc || !national) {
    console.error("Usage: npm run dial:trials -- <prefix> <countryCode> <nationalNumber>");
    process.exit(1);
  }

  const attempts = candidates(prefix, cc, national);
  console.log(`Trying ${attempts.length} formats against +${cc}${national}. Watch the phone.\n`);

  for (const a of attempts) {
    console.log(`\n• ${a.label}  →  to_number=${a.toNumber}`);
    try {
      const r = await attempt(a, elevenLabsApiKey, agentId, phoneNumberId);
      const is404 = /404/.test(r.message);
      console.log(`  INVITE: ${is404 ? "❌ 404" : "✅ accepted"} — ${r.message || "(no message)"}`);
      if (is404) continue;
      console.log(`  conversationId=${r.conversationId}  polling for a real connection…`);
      const outcome = await pollConversation(r.conversationId, elevenLabsApiKey);
      console.log(`  → status=${outcome.status}  duration=${outcome.duration}s`);
      if (outcome.duration > 0) {
        console.log(`\n🎉 WINNER: "${a.toNumber}" (${a.label}) — call established (${outcome.duration}s).`);
        process.exit(0);
      }
      console.log("  (accepted but no media/answer — trying next format)");
    } catch (err) {
      console.log(`  error: ${(err as Error).message}`);
    }
  }
  console.log("\nNo format produced a connected call. Confirm the exact dial format with VoiceLink.");
}
