import "dotenv/config";

/**
 * Telegram notifier — the "mouth" of the alerting feature.
 *
 * Deliberately knows NOTHING about calls: hand it text, it delivers it to a
 * Telegram chat. Call-specific wording lives in format.ts, and the decision of
 * *when* to send lives in the watcher. Keeping those apart means a delivery
 * failure is always distinguishable from a call-handling bug.
 *
 * Two rules this module must never break:
 *   1. It never throws into the call path. A Telegram outage, a revoked token
 *      or a wrong chat id must degrade to a logged warning — never a failed or
 *      dropped call. Every public function returns a result object instead.
 *   2. It needs no npm dependency. Node 18+ has fetch built in.
 *
 * Credentials resolve per-client later (Phase 4 moves them onto the VoiceLink
 * profile). For now they come from .env, and callers may override explicitly.
 */

/** Telegram rejects messages over 4096 chars; leave room for the ellipsis. */
const MAX_LEN = 4000;
const API_ROOT = "https://api.telegram.org";
/** Give up rather than let a hung request stall the caller. */
const TIMEOUT_MS = 10_000;

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
}

export interface SendResult {
  ok: boolean;
  /** Present when ok=false — safe to log, never contains the token. */
  error?: string;
  /** Telegram's message id, when the send succeeded. */
  messageId?: number;
  /** True when no credentials were configured, so nothing was attempted. */
  skipped?: boolean;
}

/**
 * Read credentials from .env. Returns null (not an error) when unset — the
 * feature is optional, and an unconfigured app must still place calls.
 */
export function getTelegramCredentials(): TelegramCredentials | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

/**
 * Escape the three characters Telegram's HTML parse mode treats as markup.
 * Without this, a caller name like "Priya & Co <Photography>" makes the whole
 * send fail with a 400 — so every piece of interpolated text must go through
 * here before being wrapped in tags.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Trim to Telegram's limit on a line boundary where possible. */
export function truncate(text: string, max = MAX_LEN): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastBreak = cut.lastIndexOf("\n");
  // Only break on a newline if it isn't throwing away most of the message.
  const body = lastBreak > max * 0.6 ? cut.slice(0, lastBreak) : cut;
  return `${body}\n…(truncated)`;
}

/** Redact a bot token so it can never reach logs or an API response. */
export function maskToken(token: string): string {
  const [id] = token.split(":");
  return `${id}:***`;
}

/**
 * Send one message. Never throws.
 *
 * `text` may contain Telegram HTML tags (<b>, <i>, <code>, <a>); any dynamic
 * value inside it must already have been through escapeHtml().
 */
export async function sendTelegram(
  text: string,
  creds: TelegramCredentials | null = getTelegramCredentials(),
): Promise<SendResult> {
  if (!creds) {
    return { ok: false, skipped: true, error: "Telegram not configured (no token/chat id)." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_ROOT}/bot${creds.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: creds.chatId,
        text: truncate(text),
        parse_mode: "HTML",
        // Alerts reference phone numbers, not URLs — previews are just noise.
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };

    if (!res.ok || !body.ok) {
      const error = body.description || `HTTP ${res.status}`;
      console.warn(`⚠️  Telegram send failed (${maskToken(creds.botToken)}): ${error}`);
      return { ok: false, error };
    }
    return { ok: true, messageId: body.result?.message_id };
  } catch (err) {
    // Includes the abort on timeout. Warn and carry on — never rethrow.
    const error = (err as Error).name === "AbortError" ? `timed out after ${TIMEOUT_MS}ms` : (err as Error).message;
    console.warn(`⚠️  Telegram send failed: ${error}`);
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify credentials without sending anything, via Telegram's getMe.
 * Used by the Settings UI to show whether a client's bot is wired up.
 */
export async function checkTelegram(
  creds: TelegramCredentials | null = getTelegramCredentials(),
): Promise<{ ok: boolean; botUsername?: string; error?: string }> {
  if (!creds) return { ok: false, error: "Telegram not configured (no token/chat id)." };
  try {
    const res = await fetch(`${API_ROOT}/bot${creds.botToken}/getMe`);
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { username?: string };
    };
    if (!body.ok) return { ok: false, error: body.description || `HTTP ${res.status}` };
    return { ok: true, botUsername: body.result?.username };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface TelegramChat {
  chatId: string;
  /** Person's name, or the group title. */
  name: string;
  /** "private" for a person, "group"/"supergroup" for a team chat. */
  type: string;
}

/**
 * Recent chats that have messaged this bot.
 *
 * Telegram never lets a bot message someone first, so a prospect has to make
 * contact before an alert can reach them. In a live demo that means: they tap
 * the bot link and press Start, and this call surfaces their chat so it can be
 * bound to the client in one click — no copying ids out of a raw API response.
 *
 * Telegram retains undelivered updates for roughly 24 hours, so this shows
 * recent contact only. Newest first.
 */
export async function listRecentChats(
  creds: TelegramCredentials | null = getTelegramCredentials(),
): Promise<{ ok: boolean; chats: TelegramChat[]; error?: string }> {
  if (!creds) return { ok: false, chats: [], error: "Telegram not configured." };
  try {
    const res = await fetch(`${API_ROOT}/bot${creds.botToken}/getUpdates`);
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: Array<Record<string, any>>;
    };
    if (!body.ok) return { ok: false, chats: [], error: body.description || `HTTP ${res.status}` };

    const seen = new Map<string, TelegramChat>();
    for (const update of body.result ?? []) {
      // A bot added to a group sees my_chat_member rather than a message.
      const chat =
        update.message?.chat ?? update.my_chat_member?.chat ?? update.channel_post?.chat;
      if (!chat?.id) continue;
      seen.set(String(chat.id), {
        chatId: String(chat.id),
        name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || "Unknown",
        type: chat.type ?? "private",
      });
    }
    return { ok: true, chats: [...seen.values()].reverse() };
  } catch (err) {
    return { ok: false, chats: [], error: (err as Error).message };
  }
}

// Run directly (`npm run notify:test`) to prove the bot works without placing
// a call. Optional argument overrides the message text.
if (import.meta.url === `file://${process.argv[1]}`) {
  const creds = getTelegramCredentials();
  if (!creds) {
    console.error(
      "❌ Telegram is not configured.\n" +
        "   Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to .env, then re-run.",
    );
    process.exit(1);
  }

  const who = await checkTelegram(creds);
  if (!who.ok) {
    console.error(`❌ Credential check failed: ${who.error}`);
    process.exit(1);
  }
  console.log(`Bot     : @${who.botUsername} (${maskToken(creds.botToken)})`);
  console.log(`Chat id : ${creds.chatId}`);

  const text =
    process.argv.slice(2).join(" ") ||
    [
      "🔔 <b>Test alert</b>",
      "",
      "Your VoiceLink notifier is wired up correctly.",
      "Real call summaries will arrive here once the watcher is live.",
    ].join("\n");

  const result = await sendTelegram(text, creds);
  if (result.ok) {
    console.log(`✅ Sent (message id ${result.messageId}). Check Telegram.`);
  } else {
    console.error(`❌ Send failed: ${result.error}`);
    process.exit(1);
  }
}
