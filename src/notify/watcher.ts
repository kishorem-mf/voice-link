import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getRetellApiKey, getRetellBaseUrl } from "../retell/config.js";
import { formatCallMessage, type RetellCallPayload } from "./format.js";
import { sendTelegram, getTelegramCredentials } from "./telegram.js";
import { credentialsForAgent, profileCredentials } from "./routing.js";
import { listProfiles } from "../retell/profiles.js";

/**
 * Call watcher — decides WHEN an alert is sent.
 *
 * Polls Retell rather than receiving webhooks. A webhook would need a public
 * URL, which on a laptop means a tunnel whose address changes on every
 * restart — meaning re-registering it in Retell mid-demo. Polling works from
 * anywhere, covers inbound and outbound identically, and the send path
 * (notifyCall) is shared, so a webhook can be layered on later without
 * touching the notifier.
 *
 * The three things that make this safe in practice:
 *
 *  1. SEEDING. On its very first run the store is empty, so every historical
 *     call looks "new". Without seeding, turning the feature on would fire a
 *     message for all 25 past calls. First run therefore records what already
 *     exists and sends nothing.
 *
 *  2. WAITING FOR ANALYSIS. Retell finishes a call and runs post-call
 *     analysis a few seconds LATER. Alerting the instant a call ends would
 *     ship a message with no summary and no tags. So a completed call is held
 *     until its analysis lands — with a timeout, because analysis can fail and
 *     a late alert beats none.
 *
 *  3. DEDUPE THAT SURVIVES RESTART. Ids are persisted, so restarting the
 *     server mid-poll doesn't re-send what was already delivered.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
/** <repo>/notified-calls.json (src/notify/ -> ../../) */
const STORE_PATH = resolve(__dirname, "../../notified-calls.json");

/** How often to ask Retell for recent calls. */
const POLL_MS = 20_000;
/** How long to wait for post-call analysis before alerting without it. */
const ANALYSIS_GRACE_MS = 120_000;
/** Ids retained; well past what any poll window can surface. */
const MAX_REMEMBERED = 500;

interface Store {
  notified: string[];
  seededAt?: string;
}

function loadStore(): Store {
  if (!existsSync(STORE_PATH)) return { notified: [] };
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf8")) as Store;
  } catch {
    // A corrupt store must not crash the server. Worst case is a duplicate
    // alert, which is far better than a failed boot.
    console.warn("⚠️  notified-calls.json unreadable — starting fresh.");
    return { notified: [] };
  }
}

function saveStore(store: Store): void {
  store.notified = store.notified.slice(-MAX_REMEMBERED);
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + "\n");
}

async function fetchRecentCalls(limit = 20): Promise<RetellCallPayload[]> {
  const res = await fetch(`${getRetellBaseUrl()}/v2/list-calls`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getRetellApiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ limit, sort_order: "descending" }),
  });
  if (!res.ok) throw new Error(`list-calls failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as RetellCallPayload[];
}

/** A call still in progress must never be alerted on. */
function isFinished(call: RetellCallPayload): boolean {
  return call.call_status === "ended" || call.call_status === "not_connected" || call.call_status === "error";
}

/**
 * Is this call ready to alert on?
 *
 * "ready" is not the same as "finished": a call that ended two seconds ago
 * probably has no analysis yet, and a summary is most of the value.
 */
export function isReadyToNotify(call: RetellCallPayload, now = Date.now()): boolean {
  if (!isFinished(call)) return false;

  // Calls that never connected get no analysis at all — nothing to wait for,
  // and a missed enquiry is the most urgent alert there is.
  if (call.call_status !== "ended") return true;

  if (call.call_analysis?.call_summary) return true;

  // Analysis pending — hold, but not forever.
  const started = call.start_timestamp ?? 0;
  const ended = started + (call.duration_ms ?? 0);
  return now - ended > ANALYSIS_GRACE_MS;
}

/**
 * Format and deliver one call. Shared by the poller and any future webhook.
 *
 * The bot is chosen from the call's own agent (see routing.ts), so each
 * client's alerts go to that client's Telegram — never to whoever happens to
 * be the active profile at the time.
 */
export async function notifyCall(call: RetellCallPayload): Promise<boolean> {
  const { creds, profile } = credentialsForAgent(call.agent_id);
  const businessName = profile?.businessName || profile?.name;
  const result = await sendTelegram(formatCallMessage(call, businessName), creds);
  if (!result.ok && !result.skipped) {
    console.warn(`⚠️  Alert for ${call.call_id} not delivered: ${result.error}`);
  }
  return result.ok;
}

/**
 * One poll cycle. Returns how many alerts were sent.
 * Never throws — a Retell hiccup should skip a cycle, not kill the server.
 */
export async function pollOnce(): Promise<number> {
  const store = loadStore();
  let sent = 0;

  try {
    const calls = await fetchRecentCalls();

    // First ever run: remember what already exists, alert on none of it.
    if (!store.seededAt) {
      store.seededAt = new Date().toISOString();
      store.notified = calls.map((c) => c.call_id).filter((id): id is string => Boolean(id));
      saveStore(store);
      console.log(`🔔 Call watcher seeded with ${store.notified.length} existing call(s) — alerts start from the next call.`);
      return 0;
    }

    const known = new Set(store.notified);
    // Oldest first, so a burst of calls arrives in the order they happened.
    for (const call of [...calls].reverse()) {
      const id = call.call_id;
      if (!id || known.has(id)) continue;
      if (!isReadyToNotify(call)) continue; // retry on a later cycle

      await notifyCall(call);
      // Record regardless of delivery success: retrying forever against a
      // revoked token would mean an alert storm the moment it's fixed.
      store.notified.push(id);
      known.add(id);
      sent++;
    }

    if (sent) saveStore(store);
  } catch (err) {
    console.warn(`⚠️  Call watcher cycle failed: ${(err as Error).message}`);
  }

  return sent;
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start polling. No-op when Telegram isn't configured, so the app runs
 * unchanged for anyone who hasn't set a bot up.
 */
export function startWatcher(intervalMs = POLL_MS): boolean {
  if (timer) return true;
  // Any configured bot is reason enough to poll: the .env fallback, or a bot
  // on any single client. Checking only .env would leave a per-client-only
  // setup silently un-watched.
  const perClient = listProfiles().filter((p) => profileCredentials(p)).length;
  if (!getTelegramCredentials() && perClient === 0) {
    console.log("🔕 Call alerts off (no Telegram bot configured in .env or on any client).");
    return false;
  }
  console.log(
    `🔔 Call alerts on — polling Retell every ${Math.round(intervalMs / 1000)}s` +
      `${perClient ? ` (${perClient} client bot(s) configured)` : ""}.`,
  );
  void pollOnce();
  timer = setInterval(() => void pollOnce(), intervalMs);
  // Don't hold the process open on shutdown.
  timer.unref?.();
  return true;
}

export function stopWatcher(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

// Run directly (`npm run notify:watch`) to poll without the web server.
//   npm run notify:watch          -- poll continuously
//   npm run notify:watch -- once  -- run a single cycle and exit
//   npm run notify:watch -- reset -- forget what's been alerted (re-seeds)
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg === "reset") {
    if (existsSync(STORE_PATH)) writeFileSync(STORE_PATH, JSON.stringify({ notified: [] }, null, 2) + "\n");
    console.log("✅ Watcher state cleared — the next run re-seeds and stays quiet.");
  } else if (arg === "once") {
    const n = await pollOnce();
    console.log(`Done — ${n} alert(s) sent.`);
  } else {
    if (!startWatcher()) process.exit(1);
    // Keep the process alive.
    setInterval(() => {}, 1 << 30);
  }
}
