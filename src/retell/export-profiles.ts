import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { listProfiles, getActiveProfileId, type VoiceLinkProfile } from "./profiles.js";

/**
 * Write a committable copy of voicelink-profiles.json with secrets stripped.
 *
 * The live file is gitignored because it holds bot tokens — but it is also the
 * only record of which client owns which number and which agents. Lose it and
 * the Retell agents still exist while nothing knows whose they are. This keeps
 * that mapping in version control without the secrets.
 *
 * Bot tokens are replaced with a placeholder rather than dropped, so restoring
 * is obvious: copy the file, paste each client's token back in.
 *
 *   npm run profiles:export
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../../voicelink-profiles.example.json");

const TOKEN_PLACEHOLDER = "<bot-token — paste from @BotFather>";

/** Strip anything secret. Chat ids are kept: they're not credentials. */
export function redact(profile: VoiceLinkProfile): VoiceLinkProfile {
  const copy: VoiceLinkProfile = { ...profile };
  if (copy.telegramBotToken) copy.telegramBotToken = TOKEN_PLACEHOLDER;
  return copy;
}

export function exportProfiles(): string {
  const data = {
    _comment:
      "Redacted copy of voicelink-profiles.json, safe to commit. Bot tokens are " +
      "placeholders — restore by copying this to voicelink-profiles.json and " +
      "pasting each client's real token. Regenerate with: npm run profiles:export",
    active: getActiveProfileId(),
    profiles: listProfiles().map(redact),
  };
  writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n");
  return OUT;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = exportProfiles();
  const withTokens = listProfiles().filter((p) => p.telegramBotToken).length;
  console.log(`✅ Wrote ${file}`);
  console.log(`   ${listProfiles().length} profile(s); ${withTokens} bot token(s) redacted.`);
  console.log(`   Commit this file so the client→number→agent mapping survives.`);
}
