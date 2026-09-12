import { createAgent } from "./agent.js";
import { getBusinessType, renderPersona } from "./business-types.js";
import { getProfile, updateProfile, type VoiceLinkProfile } from "./profiles.js";
import { getRetellApiKey, getRetellBaseUrl } from "./config.js";
import { importNumber } from "./import-number.js";

/**
 * Give a profile its own Retell agents, so that client's DID answers with that
 * client's persona.
 *
 * Why a dedicated pair per profile rather than reusing shared agents: Retell
 * decides which agent answers an INBOUND call from the DID's own
 * `inbound_agents` binding. The app is not in that path and cannot influence
 * it, so the notion of an "active profile" means nothing to an incoming call.
 * Two DIDs pointed at one agent therefore answer identically — which is why a
 * wedding-photography number was answering as a clinic receptionist.
 *
 * Settings that are genuinely global (voice, model, language, call limits)
 * still sync across whichever agents belong to the active profile; only the
 * persona is per-client.
 */

/** Language pair that suits Indian English callers without false switching. */
const DEFAULT_LANGUAGE = "en-IN";
const DEFAULT_VOICE = "11labs-Monika";

export interface ProvisionResult {
  profile: VoiceLinkProfile;
  outboundAgentId: string;
  inboundAgentId: string;
  created: boolean;
  /** True when the DID was also re-pointed at the new agents. */
  numberBound: boolean;
  bindError?: string;
}

/**
 * Create (or re-create) the agent pair for a profile and bind its DID to them.
 *
 * `force` re-provisions even if agents already exist — used when the business
 * type changes and the personas need rebuilding from the new template.
 */
export async function provisionProfileAgents(
  profileId: string,
  opts: { force?: boolean; voiceId?: string; language?: string } = {},
): Promise<ProvisionResult> {
  const profile = getProfile(profileId);
  const businessName = profile.businessName || profile.name;
  const type = getBusinessType(profile.businessType);

  if (profile.outboundAgentId && profile.inboundAgentId && !opts.force) {
    return {
      profile,
      outboundAgentId: profile.outboundAgentId,
      inboundAgentId: profile.inboundAgentId,
      created: false,
      numberBound: false,
    };
  }

  const voiceId = opts.voiceId ?? DEFAULT_VOICE;
  const language = opts.language ?? DEFAULT_LANGUAGE;
  const outboundPersona = renderPersona(type.outbound, businessName);
  const inboundPersona = renderPersona(type.inbound, businessName);

  const outbound = await createAgent({
    name: `${businessName} — Outbound`,
    prompt: outboundPersona.prompt,
    firstMessage: outboundPersona.firstMessage,
    voiceId,
    language,
  });

  const inbound = await createAgent({
    name: `${businessName} — Inbound`,
    prompt: inboundPersona.prompt,
    firstMessage: inboundPersona.firstMessage,
    voiceId,
    language,
  });

  const updated = updateProfile(profileId, {
    outboundAgentId: outbound.agentId,
    inboundAgentId: inbound.agentId,
  });

  // Re-point the DID at the new agents. Without this the number keeps
  // answering with whatever it was bound to before, and the new inbound
  // persona would never be heard.
  let numberBound = false;
  let bindError: string | undefined;
  try {
    await importNumber(
      updated.fromNumber,
      outbound.agentId,
      updated.terminationUri,
      updated.transport ?? "TCP",
      inbound.agentId,
    );
    numberBound = true;
  } catch (err) {
    bindError = (err as Error).message;
  }

  return {
    profile: updated,
    outboundAgentId: outbound.agentId,
    inboundAgentId: inbound.agentId,
    created: true,
    numberBound,
    bindError,
  };
}

/** Delete an agent — used when re-provisioning, so orphans don't accumulate. */
export async function deleteAgent(agentId: string): Promise<void> {
  await fetch(`${getRetellBaseUrl()}/delete-agent/${agentId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getRetellApiKey()}` },
  });
}

// Run directly: npm run profiles -- provision <id> [--force]
if (import.meta.url === `file://${process.argv[1]}`) {
  const id = process.argv[2];
  const force = process.argv.includes("--force");
  if (!id) {
    console.error("Usage: tsx src/retell/provision-profile.ts <profileId> [--force]");
    process.exit(1);
  }
  try {
    const r = await provisionProfileAgents(id, { force });
    if (!r.created) {
      console.log(`Profile "${id}" already has agents. Use --force to rebuild them.`);
      console.log(`   outbound = ${r.outboundAgentId}`);
      console.log(`   inbound  = ${r.inboundAgentId}`);
    } else {
      console.log(`✅ Provisioned agents for "${r.profile.name}" (${getBusinessType(r.profile.businessType).label}):`);
      console.log(`   outbound = ${r.outboundAgentId}`);
      console.log(`   inbound  = ${r.inboundAgentId}`);
      console.log(
        r.numberBound
          ? `   ${r.profile.fromNumber} now routes to these agents.`
          : `   ⚠️  Could not bind ${r.profile.fromNumber}: ${r.bindError}`,
      );
    }
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
