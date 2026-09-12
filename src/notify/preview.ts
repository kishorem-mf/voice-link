import { getRetellApiKey, getRetellBaseUrl } from "../retell/config.js";
import { formatCallMessage, type RetellCallPayload } from "./format.js";
import { sendTelegram } from "./telegram.js";

/**
 * Render a REAL past call through the formatter — the fastest way to see what
 * an alert will look like without waiting for a new call to happen.
 *
 *   npm run notify:preview             -- render the most recent call
 *   npm run notify:preview -- <callId> -- render one specific call
 *   npm run notify:preview -- send     -- also deliver it to Telegram
 */

async function fetchCall(callId: string): Promise<RetellCallPayload> {
  const res = await fetch(`${getRetellBaseUrl()}/v2/get-call/${callId}`, {
    headers: { Authorization: `Bearer ${getRetellApiKey()}` },
  });
  if (!res.ok) throw new Error(`get-call failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as RetellCallPayload;
}

async function fetchRecentCalls(limit = 5): Promise<RetellCallPayload[]> {
  const res = await fetch(`${getRetellBaseUrl()}/v2/list-calls`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getRetellApiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ limit, sort_order: "descending" }),
  });
  if (!res.ok) throw new Error(`list-calls failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as RetellCallPayload[];
}

/** Strip Telegram's HTML so the terminal preview is readable. */
function plain(text: string): string {
  return text
    .replace(/<a href="[^"]*">([^<]*)<\/a>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const args = process.argv.slice(2);
const shouldSend = args.includes("send");
const callId = args.find((a) => a.startsWith("call_"));

try {
  const calls = callId ? [await fetchCall(callId)] : await fetchRecentCalls(3);
  if (!calls.length) {
    console.log("No calls found yet.");
    process.exit(0);
  }

  for (const call of calls) {
    const message = formatCallMessage(call);
    console.log("─".repeat(52));
    console.log(plain(message));
    console.log("─".repeat(52));
    console.log(
      `  (${call.call_id} · ${call.direction} · ${call.call_status}` +
        `${call.call_analysis?.custom_analysis_data && Object.keys(call.call_analysis.custom_analysis_data).length ? "" : " · no custom tags yet"})\n`,
    );

    if (shouldSend) {
      const r = await sendTelegram(message);
      console.log(r.ok ? `  ✅ Sent to Telegram (id ${r.messageId})\n` : `  ❌ ${r.error}\n`);
    }
  }

  if (!shouldSend) console.log('Add "-- send" to deliver these to Telegram.');
} catch (err) {
  console.error(`❌ ${(err as Error).message}`);
  process.exit(1);
}
