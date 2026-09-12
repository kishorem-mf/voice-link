import { listProfiles } from "./profiles.js";
import { updateAgentModel, updatePostCallModel, getAgentModel } from "./manage.js";
import { DEFAULT_MODEL, DEFAULT_POST_CALL_MODEL } from "./agent.js";

/**
 * Put every client's agents on the cost-optimised models.
 *
 * Agents created before agent.ts set these inherited Retell's defaults
 * (gpt-4.1 for both), roughly 45% more per minute than the measured
 * configuration in docs/working-configuration.md. The overspend is invisible
 * until the bill arrives, so this exists to check and correct it in one go.
 *
 *   npm run retell:models         -- apply the cost defaults everywhere
 *   npm run retell:models -- show -- report what each agent is on
 */
const show = process.argv[2] === "show";

for (const p of listProfiles()) {
  console.log(`\n${p.businessName || p.name}`);
  for (const agentId of [p.outboundAgentId, p.inboundAgentId]) {
    if (!agentId) continue;
    const { model } = await getAgentModel(agentId);
    if (show) {
      const mark = model === DEFAULT_MODEL ? "✅" : "⚠️ ";
      console.log(`   ${mark} ${agentId} → ${model}`);
      continue;
    }
    if (model !== DEFAULT_MODEL) await updateAgentModel(agentId, DEFAULT_MODEL);
    await updatePostCallModel(agentId, DEFAULT_POST_CALL_MODEL);
    console.log(`   ${agentId} → ${DEFAULT_MODEL} (was ${model})`);
  }
}
