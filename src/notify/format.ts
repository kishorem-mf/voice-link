import { escapeHtml } from "./telegram.js";

/**
 * Turns a finished Retell call into the message a business owner actually
 * wants on their phone. Pure function, no I/O — so the wording can be changed
 * and tested without placing calls, and swapped per vertical (clinic vs
 * photographer) later.
 *
 * The shape here mirrors Retell's real /v2/get-call payload, not a guess:
 * `call_analysis` already supplies summary/sentiment/voicemail detection, and
 * `custom_analysis_data` holds the vertical-specific fields we configure in
 * analysis.ts.
 */

/** Subset of Retell's call payload we render. Extra fields are ignored. */
export interface RetellCallPayload {
  call_id?: string;
  /** Identifies which client owns the call — see notify/routing.ts. */
  agent_id?: string;
  direction?: string;
  from_number?: string;
  to_number?: string;
  call_status?: string;
  disconnection_reason?: string;
  duration_ms?: number;
  start_timestamp?: number;
  recording_url?: string;
  transcript?: string;
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: string;
    call_successful?: boolean;
    in_voicemail?: boolean;
    custom_analysis_data?: Record<string, unknown>;
  };
}

/** "1m 12s" / "47s" — humans read duration faster than 72000ms. */
export function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return "0s";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** +919429397398 -> +91 94293 97398, so it's readable at a glance. */
export function formatNumber(n?: string): string {
  if (!n) return "unknown";
  const m = n.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : n;
}

/**
 * The headline. A missed/unanswered call matters as much as a connected one —
 * for a photographer, an unanswered enquiry IS the lost booking — so failure
 * modes get their own clear line rather than being lumped into "call ended".
 */
function headline(call: RetellCallPayload): string {
  const inbound = call.direction === "inbound";
  const reason = call.disconnection_reason ?? "";

  if (call.call_analysis?.in_voicemail) return "📭 Reached voicemail";
  if (call.call_status === "not_connected" || reason === "dial_no_answer") {
    return inbound ? "⚠️ Missed call — nobody connected" : "📵 No answer";
  }
  if (reason === "user_declined") return "🚫 Call declined";
  if (reason.startsWith("error")) return "❗ Call failed";
  return inbound ? "📞 Incoming call handled" : "📤 Outbound call completed";
}

/** Human labels for the custom fields configured in analysis.ts. */
const FIELD_LABELS: Record<string, string> = {
  caller_name: "Name",
  event_date: "Date",
  event_type: "Event",
  budget_mentioned: "Budget",
  callback_needed: "Callback",
  lead_quality: "Lead",
};

const LEAD_ICONS: Record<string, string> = {
  hot: "🔥",
  warm: "🌤",
  cold: "❄️",
};

/** Render one custom analysis field, or null when it carries no signal. */
function renderField(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  // The analysis model returns "unknown"/"n/a" when the call never covered it.
  if (typeof value === "string" && /^(unknown|n\/?a|none|not mentioned)$/i.test(value.trim())) {
    return null;
  }
  const label = FIELD_LABELS[key] ?? key.replace(/_/g, " ");

  if (typeof value === "boolean") {
    // A false boolean ("no callback needed") is noise; only surface the true case.
    return value ? `<b>${escapeHtml(label)}</b>` : null;
  }
  const text = String(value).trim();
  if (key === "lead_quality") {
    const icon = LEAD_ICONS[text.toLowerCase()] ?? "";
    return `${icon} <b>${escapeHtml(text.toUpperCase())}</b> lead`.trim();
  }
  return `${escapeHtml(label)}: <b>${escapeHtml(text)}</b>`;
}

/**
 * Build the Telegram message for a completed call.
 *
 * Ordering is deliberate — owners read the first two lines on a lock screen
 * and decide whether to open it: outcome, who, then the detail.
 */
export function formatCallMessage(call: RetellCallPayload, businessName?: string): string {
  const inbound = call.direction === "inbound";
  const analysis = call.call_analysis ?? {};
  const lines: string[] = [];

  // 1. Outcome + direction + duration. The business name is included only
  //    when known, so a single-client setup stays uncluttered.
  lines.push(`<b>${headline(call)}</b>`);
  if (businessName) lines.push(`<i>${escapeHtml(businessName)}</i>`);

  // 2. Who — for inbound the caller is from_number; for outbound it's to_number.
  const counterparty = inbound ? call.from_number : call.to_number;
  const durationPart = call.duration_ms ? ` · ${formatDuration(call.duration_ms)}` : "";
  lines.push(`${inbound ? "From" : "To"} <code>${escapeHtml(formatNumber(counterparty))}</code>${durationPart}`);

  // 3. Tags from custom analysis — the at-a-glance triage line.
  const custom = analysis.custom_analysis_data ?? {};
  const tags = Object.entries(custom)
    .map(([k, v]) => renderField(k, v))
    .filter((x): x is string => Boolean(x));
  if (tags.length) lines.push("", tags.join(" · "));

  // 4. What was actually said.
  if (analysis.call_summary) lines.push("", `<i>${escapeHtml(analysis.call_summary)}</i>`);

  // 5. Sentiment only when negative — a warning worth acting on. Positive and
  //    neutral add a line without adding information.
  if (analysis.user_sentiment === "Negative") lines.push("", "⚠️ Caller sounded unhappy");

  // 6. Recording, last — useful but never the point of the alert.
  if (call.recording_url) lines.push("", `<a href="${escapeHtml(call.recording_url)}">▶️ Recording</a>`);

  return lines.join("\n");
}
