import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, isAbsolute } from "node:path";

/**
 * Borrow AWS credentials from the youtube-summarizer project's .env.
 *
 * Both projects talk to the same AWS account, and duplicating the keys means
 * two places to rotate and one to forget. So this reads them from that file
 * instead — the same file its app.py loads with load_dotenv().
 *
 * Two deliberate limits:
 *   - Only AWS_* and DYNAMO_* names are taken. That file also holds Apify,
 *     YouTube and Anthropic keys which this project has no business loading.
 *   - Anything already set in this project's own .env wins, so a local
 *     override never gets clobbered by the shared file.
 *
 * Override the location with AWS_ENV_FILE if the repo moves.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Sibling checkout, newest first. src/crm/ -> ../../.. is the Projects dir. */
const DEFAULT_CANDIDATES = [
  "../../../youtube-summarizer-v2/.env",
  "../../../youtube-summarizer/.env",
];

/** Only these names cross the repo boundary. */
const ALLOWED = /^(AWS_[A-Z0-9_]+|DYNAMO_[A-Z0-9_]+)$/;

let loaded: string | null | undefined;

/** Where the credentials were read from, for diagnostics. */
export function credentialSource(): string | null {
  if (loaded === undefined) loadSharedAwsEnv();
  return loaded ?? null;
}

/** Minimal .env parser — enough for KEY=value with optional quotes. */
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Populate AWS_* from the shared file, if this project doesn't define them.
 * Returns the path used, or null when nothing was found. Never throws — a
 * missing sibling repo should degrade to "CRM not configured", not a crash.
 */
export function loadSharedAwsEnv(): string | null {
  if (loaded !== undefined) return loaded;
  loaded = null;

  const override = process.env.AWS_ENV_FILE?.trim();
  const candidates = override
    ? [isAbsolute(override) ? override : resolve(process.cwd(), override)]
    : DEFAULT_CANDIDATES.map((p) => resolve(__dirname, p));

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const vars = parseEnv(readFileSync(path, "utf8"));
      let took = 0;
      for (const [k, v] of Object.entries(vars)) {
        if (!ALLOWED.test(k) || !v) continue;
        // A value set locally always wins.
        if (process.env[k]) continue;
        process.env[k] = v;
        took++;
      }
      if (took) {
        loaded = path;
        return loaded;
      }
    } catch {
      // Unreadable shared file is not fatal; fall through to the next one.
    }
  }
  return loaded;
}
