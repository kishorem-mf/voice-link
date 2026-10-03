import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getRetellApiKey, getRetellBaseUrl } from "./config.js";

/**
 * Snapshot every Retell agent (and the prompt behind it) to a JSON file.
 *
 * Agents live in Retell's cloud, not in this repo, so deleting one is
 * irreversible and git protects nothing. Run this before any destructive
 * change — the snapshot holds everything needed to recreate an agent by hand:
 * its prompt, first message, voice, language and call limits.
 *
 *   npm run retell:export
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../../backups");

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${getRetellBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${getRetellApiKey()}` },
  });
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
}

export async function exportAgents(): Promise<string> {
  const agents = await get<any[]>("/list-agents");
  const numbers = await get<any[]>("/list-phone-numbers");

  // Which agents are actually reachable — the difference between "live" and
  // "orphaned" is exactly this binding.
  const bound = new Set<string>();
  for (const n of numbers) {
    for (const key of ["inbound_agents", "outbound_agents"]) {
      for (const a of n[key] ?? []) bound.add(a.agent_id);
    }
  }

  const detailed = [];
  for (const a of agents) {
    const agent = await get<any>(`/get-agent/${a.agent_id}`);
    let llm: unknown = null;
    const llmId = agent.response_engine?.llm_id;
    if (llmId) {
      // The prompt lives on the LLM, not the agent — without it the snapshot
      // can't actually recreate the agent's behaviour.
      llm = await get<unknown>(`/get-retell-llm/${llmId}`).catch(() => null);
    }
    detailed.push({ boundToNumber: bound.has(a.agent_id), agent, llm });
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = resolve(OUT_DIR, `retell-agents-${stamp}.json`);
  writeFileSync(
    file,
    JSON.stringify({ exportedAt: new Date().toISOString(), phoneNumbers: numbers, agents: detailed }, null, 2) + "\n",
  );
  return file;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const file = await exportAgents();
    console.log(`✅ Snapshot written to ${file}`);
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
