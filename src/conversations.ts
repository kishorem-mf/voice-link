import { getConfig } from "./config.js";

/**
 * ElevenLabs conversation reads — list, detail, and audio.
 *
 * Wraps the endpoints we previously hit via curl so the web API can reuse them.
 * Uses `getConfig()` for base URL + key; the key never leaves the server.
 */

export interface ConversationSummary {
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

export interface ConversationDetail extends ConversationSummary {
  toNumber?: string;
  direction?: string;
  transcript: TranscriptTurn[];
}

async function el(path: string): Promise<Response> {
  const { baseUrl, elevenLabsApiKey } = getConfig();
  return fetch(`${baseUrl}${path}`, { headers: { "xi-api-key": elevenLabsApiKey } });
}

function asError(status: number, body: string): Error {
  const hint = status === 401 ? " — API key rejected." : "";
  return new Error(`ElevenLabs ${status}${hint} ${body}`.trim());
}

/** List recent conversations for the configured agent, newest first. */
export async function listConversations(pageSize = 30): Promise<ConversationSummary[]> {
  const { agentId } = getConfig();
  const res = await el(
    `/convai/conversations?agent_id=${encodeURIComponent(agentId)}&page_size=${pageSize}`,
  );
  const text = await res.text().catch(() => "");
  if (!res.ok) throw asError(res.status, text);
  const json = text ? JSON.parse(text) : {};
  return (json.conversations ?? []).map((c: any) => ({
    conversationId: c.conversation_id,
    status: c.status ?? "unknown",
    durationSecs: c.call_duration_secs ?? 0,
    messageCount: c.message_count ?? 0,
    startUnix: c.start_time_unix_secs ?? 0,
  }));
}

/** Fetch one conversation's detail incl. transcript. */
export async function getConversation(id: string): Promise<ConversationDetail> {
  const res = await el(`/convai/conversations/${encodeURIComponent(id)}`);
  const text = await res.text().catch(() => "");
  if (!res.ok) throw asError(res.status, text);
  const d = text ? JSON.parse(text) : {};
  const meta = d.metadata ?? {};
  const phone = meta.phone_call ?? {};
  return {
    conversationId: d.conversation_id ?? id,
    status: d.status ?? "unknown",
    durationSecs: meta.call_duration_secs ?? 0,
    messageCount: (d.transcript ?? []).length,
    startUnix: meta.start_time_unix_secs ?? 0,
    toNumber: phone.external_number ?? phone.to_number,
    direction: phone.direction,
    transcript: (d.transcript ?? [])
      .filter((t: any) => (t.message ?? "").trim() !== "")
      .map((t: any) => ({ role: t.role, message: t.message })),
  };
}

/**
 * Fetch the call recording. Returns the raw upstream Response so the caller can
 * stream the mp3 through without buffering the whole file.
 */
export async function getConversationAudio(id: string): Promise<Response> {
  const res = await el(`/convai/conversations/${encodeURIComponent(id)}/audio`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw asError(res.status, text);
  }
  return res;
}
