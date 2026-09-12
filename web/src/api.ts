// Thin client over the Express JSON API. Same-origin in production; proxied in dev.

export interface AppConfig {
  agentId: string;
  phoneNumberId: string;
  baseUrl: string;
  techPrefix: string | null;
  profileId?: string;
  profileName?: string;
  businessName?: string;
  isDemo?: boolean;
}

export interface VoiceLinkProfile {
  id: string;
  name: string;
  fromNumber: string;
  terminationUri: string;
  transport?: string;
  techPrefix?: string;
  businessName?: string;
  businessType?: string;
  /** Set once the profile has its own agents; until then it falls back to .env. */
  outboundAgentId?: string;
  inboundAgentId?: string;
  /** Whether this client has its own bot. The token itself never leaves the server. */
  hasTelegramBot?: boolean;
  telegramChatId?: string;
  /** Throwaway profile for sales demos — safe to re-point alerts on. */
  isDemo?: boolean;
}

export interface BusinessTypeOption {
  id: string;
  label: string;
  description: string;
}

export interface ProvisionResult {
  outboundAgentId: string;
  inboundAgentId: string;
  created: boolean;
  numberBound: boolean;
  bindError?: string;
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
  direction?: string;
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

export interface PersonaTemplate {
  id: string;
  name: string;
  /** "Recommended" (this trade) or "Other" (generic). */
  group: string;
  prompt: string;
  firstMessage: string;
}

export interface Persona {
  prompt: string;
  firstMessage: string;
}

export interface CallLimits {
  maxDurationMs: number;
  silenceMs: number;
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
  templates: (direction: "outbound" | "inbound" = "outbound") =>
    fetch(`/api/retell/templates?direction=${direction}`).then(json<PersonaTemplate[]>),
  directions: () =>
    fetch("/api/retell/directions").then(json<{ outbound: boolean; inbound: boolean }>),
  getPrompt: (direction: "outbound" | "inbound" = "outbound") =>
    fetch(`/api/retell/agent/prompt?direction=${direction}`).then(json<Persona>),
  setPrompt: (prompt: string, firstMessage: string, direction: "outbound" | "inbound" = "outbound") =>
    fetch("/api/retell/agent/prompt", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, firstMessage, direction }),
    }).then(json<Persona>),
  getLimits: () => fetch("/api/retell/agent/limits").then(json<CallLimits>),
  setLimits: (maxDurationMs: number, silenceMs: number) =>
    fetch("/api/retell/agent/limits", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxDurationMs, silenceMs }),
    }).then(json<CallLimits>),
  profiles: () =>
    fetch("/api/profiles").then(json<{ active: string; profiles: VoiceLinkProfile[] }>),
  setActiveProfile: (id: string) =>
    fetch("/api/profiles/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).then(
      json<{
        active: string;
        profile: VoiceLinkProfile;
        /** True when a shared DID was re-pointed at this client's agents. */
        claimed?: boolean;
        claimError?: string;
      }>,
    ),
  claimNumber: (id: string) =>
    fetch(`/api/profiles/${id}/claim`, { method: "POST" }).then(
      json<{ profile: VoiceLinkProfile; sharedWith: string[] }>,
    ),
  addProfile: (p: Omit<VoiceLinkProfile, "id">) =>
    fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    }).then(json<VoiceLinkProfile>),
  businessTypes: () => fetch("/api/business-types").then(json<BusinessTypeOption[]>),
  updateProfile: (id: string, patch: { businessName?: string; businessType?: string }) =>
    fetch(`/api/profiles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<VoiceLinkProfile>),
  setProfileTelegram: (id: string, patch: { botToken?: string; chatId?: string }) =>
    fetch(`/api/profiles/${id}/telegram`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<{ ok: boolean; botUsername?: string; error?: string }>),
  telegramChats: (id: string) =>
    fetch(`/api/profiles/${id}/telegram/chats`).then(
      json<{
        botUsername?: string;
        botLink: string | null;
        currentChatId?: string;
        chats: { chatId: string; name: string; type: string }[];
        error?: string;
      }>,
    ),
  testProfileTelegram: (id: string) =>
    fetch(`/api/profiles/${id}/telegram/test`, { method: "POST" }).then(
      json<{ ok: boolean; error?: string }>,
    ),
  provisionProfile: (id: string, force = false) =>
    fetch(`/api/profiles/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    }).then(json<ProvisionResult>),
  importProfile: (id: string) =>
    fetch(`/api/profiles/${id}/import`, { method: "POST" }).then(json<unknown>),
};
