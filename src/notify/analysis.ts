import { getRetellApiKey, getRetellBaseUrl, getRetellAgentIds } from "../retell/config.js";
import { listProfiles } from "../retell/profiles.js";

/**
 * Post-call analysis fields — what Retell should extract from every call.
 *
 * Retell already returns a summary and sentiment for free. This adds the
 * *structured* bits an owner triages on: who called, what date they need, and
 * whether it's worth ringing back. Those land in
 * `call_analysis.custom_analysis_data` and are rendered by format.ts.
 *
 * Keep this list SHORT. Every field is another question the analysis model
 * answers per call, which costs tokens and adds latency after hangup — and a
 * field the agent never discussed comes back "unknown", which format.ts then
 * has to hide. Six is about the ceiling before the alert stops being scannable
 * on a lock screen.
 */

export interface AnalysisField {
  type: "string" | "enum" | "boolean" | "number";
  name: string;
  description: string;
  choices?: string[];
}

/**
 * Wedding/event vendors — the vertical being sold to first.
 * `description` is the prompt the analysis model follows, so it must say what
 * to do when the call never covered the topic, or the model invents a value.
 */
export const EVENT_VENDOR_FIELDS: AnalysisField[] = [
  {
    type: "string",
    name: "caller_name",
    description:
      "The caller's name if they gave it. Return 'unknown' if they did not say their name.",
  },
  {
    type: "string",
    name: "event_date",
    description:
      "The date of the event or shoot they asked about, as stated (e.g. '14 Feb 2027', 'next November'). Return 'unknown' if no date was discussed.",
  },
  {
    type: "string",
    name: "event_type",
    description:
      "What kind of event or service they asked about (e.g. wedding, engagement, pre-wedding shoot, corporate). Return 'unknown' if not discussed.",
  },
  {
    type: "boolean",
    name: "budget_mentioned",
    description: "True only if pricing, packages or budget were actually discussed on the call.",
  },
  {
    type: "boolean",
    name: "callback_needed",
    description:
      "True if the caller asked to be called back, asked a question the agent could not answer, or the matter is clearly unresolved.",
  },
  {
    type: "enum",
    name: "lead_quality",
    description:
      "How strong a sales lead this is. 'hot' = specific date or budget discussed and clear intent to book. 'warm' = genuine interest but vague. 'cold' = no real interest, wrong number, or a sales/spam call.",
    choices: ["hot", "warm", "cold"],
  },
];

/** Clinic variant — same idea, different questions. Used by inbound clinics. */
export const CLINIC_FIELDS: AnalysisField[] = [
  {
    type: "string",
    name: "caller_name",
    description: "The caller's name if given, otherwise 'unknown'.",
  },
  {
    type: "string",
    name: "event_date",
    description:
      "The appointment date/time the caller asked for, as stated. Return 'unknown' if not discussed.",
  },
  {
    type: "boolean",
    name: "callback_needed",
    description:
      "True if the caller needs a call back or asked something the agent could not answer.",
  },
  {
    type: "enum",
    name: "lead_quality",
    description:
      "'hot' = wants to book an appointment now. 'warm' = enquiring for later. 'cold' = not a patient enquiry.",
    choices: ["hot", "warm", "cold"],
  },
];

/**
 * Apply the field set to ONE agent. Retell's PATCH replaces the whole array,
 * so callers pass the complete list rather than a delta.
 */
export async function updatePostCallAnalysis(
  agentId: string,
  fields: AnalysisField[],
  apiKey = getRetellApiKey(),
): Promise<AnalysisField[]> {
  const res = await fetch(`${getRetellBaseUrl()}/update-agent/${agentId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ post_call_analysis_data: fields }),
  });
  if (!res.ok) {
    throw new Error(`Retell update-agent failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { post_call_analysis_data?: AnalysisField[] };
  return body.post_call_analysis_data ?? [];
}

/** Read back what an agent currently has configured. */
export async function getPostCallAnalysis(
  agentId: string,
  apiKey = getRetellApiKey(),
): Promise<AnalysisField[]> {
  const res = await fetch(`${getRetellBaseUrl()}/get-agent/${agentId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Retell get-agent failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { post_call_analysis_data?: AnalysisField[] };
  return body.post_call_analysis_data ?? [];
}

/**
 * The right field set for a business type.
 *
 * A clinic shouldn't be asked "what's the event date and budget" — it wants
 * appointment details. Everything else starts from the event-vendor set.
 */
export function fieldsForBusinessType(businessType?: string): AnalysisField[] {
  return businessType === "clinic" ? CLINIC_FIELDS : EVENT_VENDOR_FIELDS;
}

/**
 * Apply to every agent (outbound + inbound) so the two never drift — the same
 * guarantee syncAgents() gives voice/model/limits in webhook.ts.
 */
export async function syncPostCallAnalysis(
  fields: AnalysisField[] = EVENT_VENDOR_FIELDS,
): Promise<{ agentId: string; fields: AnalysisField[] }[]> {
  const out: { agentId: string; fields: AnalysisField[] }[] = [];
  for (const agentId of getRetellAgentIds()) {
    out.push({ agentId, fields: await updatePostCallAnalysis(agentId, fields) });
  }
  return out;
}

/**
 * Every agent across EVERY client, with the field set matching each client's
 * business type.
 *
 * Deliberately not scoped to the active profile: analysis config is something
 * you fix once for everyone, and per-profile scoping is exactly how the tags
 * went missing after per-client agents were introduced.
 */
export async function syncAllProfiles(): Promise<
  { profile: string; agentId: string; count: number }[]
> {
  const out: { profile: string; agentId: string; count: number }[] = [];
  for (const p of listProfiles()) {
    const fields = fieldsForBusinessType(p.businessType);
    for (const agentId of [p.outboundAgentId, p.inboundAgentId]) {
      if (!agentId) continue;
      const applied = await updatePostCallAnalysis(agentId, fields);
      out.push({ profile: p.businessName || p.name, agentId, count: applied.length });
    }
  }
  return out;
}

// Run directly (`npm run notify:analysis`):
//   npm run notify:analysis          -- apply to every client's agents
//   npm run notify:analysis -- show  -- print what's configured now
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  try {
    if (arg === "show") {
      for (const p of listProfiles()) {
        for (const agentId of [p.outboundAgentId, p.inboundAgentId]) {
          if (!agentId) continue;
          const fields = await getPostCallAnalysis(agentId);
          const mark = fields.length ? "✅" : "⚠️ ";
          console.log(`${mark} ${(p.businessName || p.name).padEnd(20)} ${agentId} → ${fields.length} field(s)`);
        }
      }
    } else {
      const results = await syncAllProfiles();
      console.log(`✅ Applied analysis fields to ${results.length} agent(s):`);
      for (const r of results) console.log(`   ${r.profile.padEnd(20)} ${r.agentId} → ${r.count} field(s)`);
      console.log("\nApplies to the NEXT call — existing calls keep their old analysis.");
    }
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
