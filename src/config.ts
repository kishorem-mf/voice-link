import "dotenv/config";

/**
 * Module 1 — Config loader.
 *
 * Loads and validates all environment variables the harness needs, failing
 * fast with a clear message if any required value is missing. Every other
 * module imports `config` from here rather than reading `process.env` directly.
 */
export interface Config {
  elevenLabsApiKey: string;
  agentId: string;
  phoneNumberId: string;
  webhookPort: number;
  /**
   * ElevenLabs API base URL (no trailing slash). Configurable via
   * ELEVENLABS_BASE_URL; defaults to the global endpoint.
   */
  baseUrl: string;
  /**
   * Optional SIP tech prefix prepended to the dialed number. Empty = dial the
   * plain number. Configurable via TECH_PREFIX.
   */
  techPrefix: string;
}

/** Default global endpoint; override with ELEVENLABS_BASE_URL. */
const DEFAULT_BASE_URL = "https://api.elevenlabs.io/v1";

/** Required string env vars -> the human-readable purpose used in errors. */
const REQUIRED = {
  ELEVENLABS_API_KEY: "ElevenLabs API key",
  ELEVENLABS_AGENT_ID: "Conversational AI agent id",
  ELEVENLABS_PHONE_NUMBER_ID: "Imported SIP-trunk phone number id",
} as const;

function readRequired(name: keyof typeof REQUIRED): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required env var ${name} (${REQUIRED[name]}). ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function readPort(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${name}="${raw}" — must be an integer 1-65535.`);
  }
  return port;
}

/** Build a validated Config, throwing if anything required is missing. */
export function loadConfig(): Config {
  return {
    elevenLabsApiKey: readRequired("ELEVENLABS_API_KEY"),
    agentId: readRequired("ELEVENLABS_AGENT_ID"),
    phoneNumberId: readRequired("ELEVENLABS_PHONE_NUMBER_ID"),
    webhookPort: readPort("WEBHOOK_PORT", 3000),
    baseUrl: (process.env.ELEVENLABS_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    techPrefix: process.env.TECH_PREFIX?.trim() ?? "",
  };
}

/**
 * Return just the validated API key. Used by the auth-check (module 2), which
 * needs to talk to ElevenLabs *before* the agent / phone-number ids are known
 * (listing them is how you discover those ids in the first place).
 */
export function getApiKey(): string {
  return readRequired("ELEVENLABS_API_KEY");
}

/** Mask a secret for safe logging: keep a short prefix, hide the rest. */
export function mask(secret: string): string {
  if (secret.length <= 6) return "****";
  return `${secret.slice(0, 6)}…${"*".repeat(4)}`;
}

let cached: Config | undefined;

/**
 * Memoized accessor for the rest of the app. Validates on first call and
 * reuses the result afterwards. Modules should call `getConfig()` at the point
 * they actually need config, so a missing var surfaces as a clean error rather
 * than an import-time stack trace.
 */
export function getConfig(): Config {
  return (cached ??= loadConfig());
}

// Run directly (`npm run config:check`) to validate the environment in
// isolation: prints the resolved config with the API key masked, or exits
// non-zero with a clear error.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const c = loadConfig();
    console.log("✅ Config loaded successfully:");
    console.log(`  ELEVENLABS_API_KEY        = ${mask(c.elevenLabsApiKey)}`);
    console.log(`  ELEVENLABS_AGENT_ID        = ${c.agentId}`);
    console.log(`  ELEVENLABS_PHONE_NUMBER_ID = ${c.phoneNumberId}`);
    console.log(`  ELEVENLABS_BASE_URL        = ${c.baseUrl}`);
    console.log(`  TECH_PREFIX                = ${c.techPrefix || "(none)"}`);
    console.log(`  WEBHOOK_PORT               = ${c.webhookPort}`);
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
