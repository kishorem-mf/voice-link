import { getRetellApiKey, getRetellBaseUrl } from "./config.js";

/**
 * Retell call reads — list, detail, and recording — normalized to the same
 * shapes the web UI already consumes (conversationId/status/duration/etc.),
 * so the frontend needs no change when the API switches to Retell.
 */

export interface CallSummary {
  conversationId: string;
  status: string;
  durationSecs: number;
  messageCount: number;
  startUnix: number;
}

export interface TranscriptTurn {
  role: string;
  message: string;
}

export interface CallDetail extends CallSummary {
  toNumber?: string;
  direction?: string;
  disconnectionReason?: string;
  transcript: TranscriptTurn[];
}

/** Map Retell call_status to the frontend's badge vocabulary. */
function normalizeStatus(s: string): string {
  switch (s) {
    case "ended":
      return "done";
    case "not_connected":
    case "error":
      return "failed";
    case "ongoing":
    case "registered":
      return "in-progress";
    default:
      return s || "unknown";
  }
}

async function retell<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getRetellBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getRetellApiKey()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const hint = res.status === 401 ? " — API key rejected." : "";
    throw new Error(`Retell ${res.status} on ${path}${hint} ${text}`.trim());
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Recent calls for the configured agent, newest first. */
export async function listConversations(limit = 50): Promise<CallSummary[]> {
  const agentId = process.env.RETELL_AGENT_ID?.trim();
  const raw = await retell<any[]>("POST", "/v2/list-calls", {
    filter_criteria: agentId ? { agent_id: [agentId] } : undefined,
    sort_order: "descending",
    limit,
  });
  return (raw ?? []).map((c) => ({
    conversationId: c.call_id,
    status: normalizeStatus(c.call_status),
    durationSecs: Math.round((c.duration_ms ?? 0) / 1000),
    messageCount: (c.transcript_object ?? []).length,
    startUnix: c.start_timestamp ? Math.round(c.start_timestamp / 1000) : 0,
  }));
}

/** One call's detail incl. transcript. */
export async function getConversation(id: string): Promise<CallDetail> {
  const c = await retell<any>("GET", `/v2/get-call/${encodeURIComponent(id)}`);
  return {
    conversationId: c.call_id ?? id,
    status: normalizeStatus(c.call_status),
    durationSecs: Math.round((c.duration_ms ?? 0) / 1000),
    messageCount: (c.transcript_object ?? []).length,
    startUnix: c.start_timestamp ? Math.round(c.start_timestamp / 1000) : 0,
    toNumber: c.to_number,
    direction: c.direction,
    disconnectionReason: c.disconnection_reason,
    transcript: (c.transcript_object ?? [])
      .filter((t: any) => (t.content ?? "").trim() !== "")
      .map((t: any) => ({ role: t.role, message: t.content })),
  };
}

/**
 * Fetch the call recording. Retell exposes a signed `recording_url` on the call
 * object; we fetch it server-side and return the upstream Response to stream.
 */
export async function getConversationAudio(id: string): Promise<Response> {
  const c = await retell<any>("GET", `/v2/get-call/${encodeURIComponent(id)}`);
  const url = c.recording_url;
  if (!url) throw new Error("No recording available for this call yet.");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Recording fetch failed: ${res.status}`);
  return res;
}
