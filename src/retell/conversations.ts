import { getRetellApiKey, getRetellBaseUrl, tryGetRetellAgentIds } from "./config.js";
import { listCalls } from "./lists.js";

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
  direction?: string;
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

/** Recent calls for ALL configured agents (outbound + inbound), newest first. */
export async function listConversations(limit = 50): Promise<CallSummary[]> {
  // Filter by every synced agent id so BOTH outbound and inbound calls show up.
  //
  // A client with no agents yet gets an EMPTY list, never an unfiltered one.
  // Listing unfiltered would put every other client's calls on this client's
  // screen — the cross-client leak routing.ts exists to prevent — and an
  // unprovisioned client genuinely has no calls of its own to show.
  const agentIds = tryGetRetellAgentIds();
  if (agentIds.length === 0) return [];
  const raw = await listCalls<any>({ limit, agentIds });
  return raw.map((c) => ({
    conversationId: c.call_id,
    status: normalizeStatus(c.call_status),
    durationSecs: Math.round((c.duration_ms ?? 0) / 1000),
    // Always 0 from a list: Retell stopped shipping transcripts in list
    // payloads. The real turn count arrives with the detail fetch when a row
    // is opened, so the column reads "—" until then rather than lying.
    messageCount: (c.transcript_object ?? []).length,
    startUnix: c.start_timestamp ? Math.round(c.start_timestamp / 1000) : 0,
    direction: c.direction,
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
