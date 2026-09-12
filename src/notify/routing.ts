import { listProfiles, type VoiceLinkProfile } from "../retell/profiles.js";
import { getTelegramCredentials, type TelegramCredentials } from "./telegram.js";

/**
 * Works out WHICH client an alert belongs to, and therefore which Telegram bot
 * it should be sent with.
 *
 * The routing key is the call's `agent_id`, NOT the active profile. Those are
 * different things and confusing them is the bug this module exists to
 * prevent: inbound calls arrive whenever a caller dials, for any client, while
 * the app happens to have one profile selected. Routing by active profile
 * would deliver one client's leads to another client's Telegram — a privacy
 * breach, not just a wrong label.
 *
 * Every call carries the agent that handled it, and every agent belongs to
 * exactly one profile, so the agent id identifies the owner unambiguously.
 */

/** Find the profile that owns a given Retell agent. */
export function profileForAgent(agentId?: string): VoiceLinkProfile | null {
  if (!agentId) return null;
  return (
    listProfiles().find((p) => p.outboundAgentId === agentId || p.inboundAgentId === agentId) ??
    null
  );
}

/**
 * Telegram credentials for a call, by the agent that handled it.
 *
 * Falls back to the .env bot when the profile has none — which keeps a
 * single-client setup (yours today) working with no per-profile config, and
 * means an unprovisioned legacy profile still alerts somewhere rather than
 * going silent.
 */
export function credentialsForAgent(agentId?: string): {
  creds: TelegramCredentials | null;
  profile: VoiceLinkProfile | null;
  usedFallback: boolean;
} {
  const profile = profileForAgent(agentId);
  const token = profile?.telegramBotToken?.trim();
  const chatId = profile?.telegramChatId?.trim();

  if (token && chatId) {
    return { creds: { botToken: token, chatId }, profile, usedFallback: false };
  }
  return { creds: getTelegramCredentials(), profile, usedFallback: true };
}

/** Credentials configured directly on a profile, ignoring the .env fallback. */
export function profileCredentials(profile: VoiceLinkProfile): TelegramCredentials | null {
  const botToken = profile.telegramBotToken?.trim();
  const chatId = profile.telegramChatId?.trim();
  return botToken && chatId ? { botToken, chatId } : null;
}
