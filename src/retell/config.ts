import "dotenv/config";

/**
 * Retell config loader — parallel to the ElevenLabs config, fully isolated.
 *
 * This exists so we can route outbound calls through a **Retell** SIP trunk
 * instead of ElevenLabs, without touching the existing ElevenLabs modules.
 * Only the Retell-specific env vars live here.
 */
export interface RetellConfig {
  apiKey: string;
  /** Retell API base URL (no trailing slash). */
  baseUrl: string;
  /** Retell agent id used for outbound calls (override_agent_id). */
  agentId: string;
  /** The VoiceLink DID imported into Retell, E.164 — the call's from_number. */
  fromNumber: string;
  /** Optional SIP tech prefix prepended to the dialed number. Empty = plain. */
  techPrefix: string;
}

const DEFAULT_BASE_URL = "https://api.retellai.com";

function required(name: string, purpose: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `Missing required env var ${name} (${purpose}). ` +
        `Set it in .env — see .env.example for the Retell section.`,
    );
  }
  return v;
}

/** API key only — used by the auth-check before agent/number are known. */
export function getRetellApiKey(): string {
  return required("RETELL_API_KEY", "Retell API key");
}

/** Base URL, always available (defaulted). */
export function getRetellBaseUrl(): string {
  return (process.env.RETELL_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** Full config for placing calls (requires agent id + from number). */
export function getRetellConfig(): RetellConfig {
  return {
    apiKey: getRetellApiKey(),
    baseUrl: getRetellBaseUrl(),
    agentId: required("RETELL_AGENT_ID", "Retell outbound agent id"),
    fromNumber: required("RETELL_FROM_NUMBER", "VoiceLink DID imported into Retell, E.164"),
    techPrefix: process.env.RETELL_TECH_PREFIX?.trim() ?? "",
  };
}

/** Optional inbound agent id (used for calls that come IN to the DID). */
export function getRetellInboundAgentId(): string | undefined {
  return process.env.RETELL_INBOUND_AGENT_ID?.trim() || undefined;
}

/**
 * All agent ids that UI settings (voice/model/language/limits) should sync to:
 * the outbound agent, plus the inbound agent if configured.
 */
export function getRetellAgentIds(): string[] {
  const ids = [required("RETELL_AGENT_ID", "Retell outbound agent id")];
  const inbound = getRetellInboundAgentId();
  if (inbound && inbound !== ids[0]) ids.push(inbound);
  return ids;
}

/** Mask a secret for safe logging. */
export function mask(secret: string): string {
  if (secret.length <= 6) return "****";
  return `${secret.slice(0, 6)}…${"*".repeat(4)}`;
}

// Run directly (`npm run retell:config`) to validate the Retell environment.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const c = getRetellConfig();
    console.log("✅ Retell config loaded:");
    console.log(`  RETELL_API_KEY     = ${mask(c.apiKey)}`);
    console.log(`  RETELL_BASE_URL    = ${c.baseUrl}`);
    console.log(`  RETELL_AGENT_ID    = ${c.agentId}`);
    console.log(`  RETELL_FROM_NUMBER = ${c.fromNumber}`);
    console.log(`  RETELL_TECH_PREFIX = ${c.techPrefix || "(none)"}`);
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
