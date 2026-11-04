import { getRetellApiKey, getRetellBaseUrl } from "./config.js";

/**
 * Retell's paginated list endpoints — in ONE place.
 *
 * Retell retired the legacy list endpoints in two waves (calls on 2026-06-15,
 * agents on 2026-07-31) and every one of them now answers 400. The breakage
 * hit five files at once because each had hand-rolled the same fetch, so the
 * fix is centralised here: when a version is retired next time, there is a
 * single line to change.
 *
 * Two things are true of every versioned list endpoint and are handled once,
 * below:
 *
 *  1. The body is an OBJECT, not an array — results live under `items`.
 *  2. Paging is `pagination_key` + `has_more`, not an offset.
 *
 * What the list payloads omit: `transcript` and `transcript_object` are gone
 * (verified — absent on every item), so a turn count or transcript needs
 * `GET /v2/get-call/{id}`. Retell also DOCUMENTS `recording_url` as omitted
 * while still sending it; treat it as a field that may vanish without notice
 * rather than one to depend on.
 */

interface Page<T> {
  items?: T[];
  pagination_key?: string;
  has_more?: boolean;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${getRetellBaseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${getRetellApiKey()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Distinguishable from an API rejection: this is the auth check's most
    // common real failure — no network, or the base url misconfigured.
    throw new Error(`Network error reaching Retell (${path}): ${(err as Error).message}`);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const hint =
      res.status === 401
        ? " — API key rejected. Check RETELL_API_KEY."
        : text.includes("Deprecated API usage")
          ? " — Retell retired this endpoint; see src/retell/lists.ts."
          : "";
    throw new Error(`Retell ${res.status} on ${path}${hint} ${text}`.trim());
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Walk `pagination_key` until `want` items are in hand, or the pages run out.
 * `want = Infinity` drains the whole list.
 */
async function drain<T>(
  method: "GET" | "POST",
  path: string,
  want: number,
  body: Record<string, unknown> | undefined,
): Promise<T[]> {
  const out: T[] = [];
  let key: string | undefined;
  do {
    // Retell caps a page at 1000 regardless of what is asked for.
    const pageSize = Math.min(want === Infinity ? 1000 : want - out.length, 1000);
    const payload = body
      ? { ...body, limit: pageSize, ...(key ? { pagination_key: key } : {}) }
      : undefined;
    const page = await request<Page<T>>(method, path, payload);
    out.push(...(page.items ?? []));
    key = page.has_more ? page.pagination_key : undefined;
  } while (key && out.length < want);
  return want === Infinity ? out : out.slice(0, want);
}

/**
 * Recent calls, newest first. `agentIds` keeps a client's calls to itself.
 *
 * No transcript and no recording url — see the module note.
 */
export async function listCalls<T>(opts: { limit?: number; agentIds?: string[] } = {}): Promise<T[]> {
  const { limit = 50, agentIds = [] } = opts;
  return drain<T>("POST", "/v3/list-calls", limit, {
    sort_order: "descending",
    // v3 takes a list of agent objects; the old `{ agent_id: [...] }` shape
    // is undocumented here and must not be relied on again.
    ...(agentIds.length ? { filter_criteria: { agent: agentIds.map((id) => ({ agent_id: id })) } } : {}),
  });
}

/** Every agent on the account. Voice only by default — chat agents are not dialled. */
export async function listAgents<T>(channel: "voice" | "chat" | "all" = "voice"): Promise<T[]> {
  return drain<T>("POST", "/v2/list-agents", Infinity, {
    ...(channel === "all"
      ? {}
      : { filter_criteria: { channel: { type: "string", op: "eq", value: channel } } }),
  });
}

/** Every phone number on the account, with its agent bindings. */
export async function listPhoneNumbers<T>(): Promise<T[]> {
  // This one is a GET with no body, so it cannot be paged or filtered.
  const page = await request<Page<T>>("GET", "/v2/list-phone-numbers");
  return page.items ?? [];
}
