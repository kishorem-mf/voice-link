import { getApiKey, getConfig, mask } from "./config.js";

/**
 * Agent provisioning — create a Conversational AI agent via the ElevenLabs API.
 *
 * `POST /v1/convai/agents/create`. This gives us the ELEVENLABS_AGENT_ID that
 * the outbound call trigger (module 5) needs, without hand-building it in the
 * dashboard. Keeps the body minimal so ElevenLabs fills in sensible defaults
 * (LLM, voice) that can be refined later.
 */

export interface CreateAgentOptions {
  name: string;
  /** System prompt describing the agent's behaviour. */
  prompt: string;
  /** The first line the agent speaks when the call connects. */
  firstMessage: string;
  /** ISO language code, e.g. "en". */
  language?: string;
}

/** Sensible starter config for a VoiceLink outbound calling agent. */
export const DEFAULT_AGENT: CreateAgentOptions = {
  name: "VoiceLink-Outbound",
  prompt:
    "You are a polite outbound calling assistant for VoiceLink. Greet the " +
    "person, briefly state why you are calling, listen, and answer concisely. " +
    "Respect if they are busy or ask to be removed from the list, and end the " +
    "call courteously.",
  firstMessage:
    "Hi, this is the VoiceLink assistant calling. Do you have a quick moment?",
  language: "en",
};

/** Create an agent and return its new agent id. Throws on API/network error. */
export async function createAgent(
  opts: CreateAgentOptions,
  apiKey: string = getApiKey(),
): Promise<string> {
  const body = {
    name: opts.name,
    conversation_config: {
      agent: {
        prompt: { prompt: opts.prompt },
        first_message: opts.firstMessage,
        language: opts.language ?? "en",
      },
    },
  };

  let res: Response;
  try {
    res = await fetch(`${getConfig().baseUrl}/convai/agents/create`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Network error reaching ElevenLabs: ${(err as Error).message}`,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const hint =
      res.status === 401 ? " — API key rejected. Check ELEVENLABS_API_KEY." : "";
    throw new Error(`ElevenLabs ${res.status} on agent create${hint} ${text}`.trim());
  }

  const json = (await res.json()) as { agent_id?: string };
  if (!json.agent_id) {
    throw new Error(
      `Unexpected response — no agent_id returned: ${JSON.stringify(json)}`,
    );
  }
  return json.agent_id;
}

// Run directly (`npm run agent:create`) to create the default outbound agent
// and print the id to copy into .env as ELEVENLABS_AGENT_ID.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const apiKey = getApiKey();
    console.log(
      `🔑 Using API key ${mask(apiKey)} — creating agent "${DEFAULT_AGENT.name}"…`,
    );
    const agentId = await createAgent(DEFAULT_AGENT, apiKey);
    console.log(`✅ Agent created: ${agentId}`);
    console.log(`\nAdd this to your .env:\n  ELEVENLABS_AGENT_ID=${agentId}`);
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
