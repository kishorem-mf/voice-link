import { appendFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";

/**
 * Module 3 — Outcome logger.
 *
 * Records the result of a call to an append-only JSON Lines file and echoes a
 * one-line summary to the console. Pure and offline: the webhook receiver
 * (module 4) hands parsed events here, but it can be tested on its own by
 * feeding it plain objects.
 *
 * JSON Lines (one JSON object per line) is used so concurrent/successive
 * appends never corrupt earlier records and the file is trivially tailable.
 */
const DEFAULT_LOG_PATH = "call-outcomes.json";

/** Normalized outcome of a single call. */
export interface CallOutcome {
  /** ElevenLabs conversation id, when known. */
  conversationId?: string;
  /** Number that was dialed, E.164. */
  toNumber?: string;
  /** connected | no-answer | voicemail | failed | ... */
  status: string;
  /** Optional free-form disposition / summary. */
  disposition?: string;
  /** Call duration in seconds, when known. */
  durationSecs?: number;
}

/** A logged record = the outcome plus the time it was recorded. */
export interface LoggedOutcome extends CallOutcome {
  loggedAt: string;
}

/**
 * Append one outcome to the log file (default `call-outcomes.json`) and print a
 * summary. Returns the record that was written.
 */
export function logOutcome(
  outcome: CallOutcome,
  logPath: string = DEFAULT_LOG_PATH,
): LoggedOutcome {
  const record: LoggedOutcome = { ...outcome, loggedAt: new Date().toISOString() };
  appendFileSync(logPath, JSON.stringify(record) + "\n");

  const parts = [
    `📞 ${record.status.toUpperCase()}`,
    record.toNumber && `to ${record.toNumber}`,
    record.durationSecs != null && `${record.durationSecs}s`,
    record.disposition && `— ${record.disposition}`,
  ].filter(Boolean);
  console.log(parts.join(" "));

  return record;
}

/** Read back all logged outcomes (parses the JSON Lines file). */
export function readOutcomes(logPath: string = DEFAULT_LOG_PATH): LoggedOutcome[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as LoggedOutcome);
}

// Run directly (`npm run log:test`) to exercise the logger in isolation with a
// couple of fake outcomes, then read them back.
if (import.meta.url === `file://${process.argv[1]}`) {
  const testPath = "call-outcomes.test.json";
  // Start clean so the demo is deterministic.
  if (existsSync(testPath)) unlinkSync(testPath);

  console.log("Writing two fake outcomes to", testPath, "…");
  logOutcome(
    { conversationId: "conv_demo1", toNumber: "+919429391391", status: "connected", durationSecs: 42, disposition: "interested" },
    testPath,
  );
  logOutcome(
    { conversationId: "conv_demo2", toNumber: "+919000000000", status: "no-answer" },
    testPath,
  );

  const all = readOutcomes(testPath);
  console.log(`\nRead back ${all.length} record(s):`);
  console.log(JSON.stringify(all, null, 2));
}
