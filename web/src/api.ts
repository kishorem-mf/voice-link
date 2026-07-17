// Thin client over the Express JSON API. Same-origin in production; proxied in dev.

export interface AppConfig {
  agentId: string;
  phoneNumberId: string;
  baseUrl: string;
  techPrefix: string | null;
}

export interface CallResult {
  success: boolean;
  message?: string;
  conversationId?: string;
  sipCallId?: string;
}

export interface LoggedOutcome {
  conversationId?: string;
  toNumber?: string;
  status: string;
  disposition?: string;
  durationSecs?: number;
  loggedAt: string;
}

export interface ConversationSummary {
  conversationId: string;
  status: string;
  durationSecs: number;
  messageCount: number;
  startUnix: number;
}

export interface TranscriptTurn {
  role: string;
  message: string;
}

export interface ConversationDetail extends ConversationSummary {
  toNumber?: string;
  direction?: string;
  transcript: TranscriptTurn[];
}

export interface Stats {
  totalConversations: number;
  completed: number;
  successRate: number;
  avgDurationSecs: number;
  callsToday: number;
  loggedOutcomes: number;
}

export interface Voice {
  voiceId: string;
  name: string;
  provider: string;
  accent?: string;
  gender?: string;
  previewUrl?: string;
}

export interface AgentVoice {
  agentId: string;
  voiceId: string;
  language?: string;
  model?: string;
  postCallModel?: string;
  agentName?: string;
}

export interface LanguageOption {
  code: string;
  label: string;
}

export interface ModelOption {
  model: string;
  label: string;
  pricePerMin: number;
}

export interface PostCallModelOption {
  model: string;
  label: string;
  pricePerCall: number;
}

export interface PersonaPreset {
  name: string;
  prompt: string;
  firstMessage: string;
}

export interface Persona {
  prompt: string;
  firstMessage: string;
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  config: () => fetch("/api/config").then(json<AppConfig>),
  stats: () => fetch("/api/stats").then(json<Stats>),
  logs: () => fetch("/api/logs").then(json<LoggedOutcome[]>),
  conversations: () => fetch("/api/conversations").then(json<ConversationSummary[]>),
  conversation: (id: string) =>
    fetch(`/api/conversations/${id}`).then(json<ConversationDetail>),
  audioUrl: (id: string) => `/api/conversations/${id}/audio`,
  call: (toNumber: string) =>
    fetch("/api/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toNumber }),
    }).then(json<CallResult>),
  voices: (accent?: string) =>
    fetch(`/api/retell/voices${accent ? `?accent=${encodeURIComponent(accent)}` : ""}`).then(
      json<Voice[]>,
    ),
  agentVoice: () => fetch("/api/retell/agent").then(json<AgentVoice>),
  setVoice: (voiceId: string) =>
    fetch("/api/retell/agent/voice", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voiceId }),
    }).then(json<{ voiceId: string }>),
  languages: () => fetch("/api/retell/languages").then(json<LanguageOption[]>),
  setLanguage: (language: string) =>
    fetch("/api/retell/agent/language", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language }),
    }).then(json<{ language: string }>),
  models: () => fetch("/api/retell/models").then(json<ModelOption[]>),
  setModel: (model: string) =>
    fetch("/api/retell/agent/model", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    }).then(json<{ model: string }>),
  postCallModels: () => fetch("/api/retell/postcall-models").then(json<PostCallModelOption[]>),
  setPostCallModel: (model: string) =>
    fetch("/api/retell/agent/post-call-model", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    }).then(json<{ model: string }>),
  personas: () => fetch("/api/retell/personas").then(json<PersonaPreset[]>),
  getPrompt: () => fetch("/api/retell/agent/prompt").then(json<Persona>),
  setPrompt: (prompt: string, firstMessage: string) =>
    fetch("/api/retell/agent/prompt", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, firstMessage }),
    }).then(json<Persona>),
};
