import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * VoiceLink profiles — lets the app hold several VoiceLink accounts/DIDs
 * (e.g. when one account's trial/balance runs out and you switch to a new
 * one) and pick which is "active" without touching code or .env.
 *
 * A profile is just the VoiceLink-side identity: the DID, the SIP
 * termination URI for that account's trunk, and an optional tech prefix.
 * The Retell agents (voice/persona/model) are shared across all profiles —
 * switching profiles changes *which phone number* Sara operates on, not
 * which agent she is.
 */
export interface VoiceLinkProfile {
  id: string;
  name: string;
  /** The DID, E.164 (e.g. +919429391391). This becomes RETELL_FROM_NUMBER. */
  fromNumber: string;
  /** VoiceLink SIP termination URI for this account's trunk, e.g. "app.voicelink.co.in:3300". */
  terminationUri: string;
  transport?: string; // default "TCP"
  techPrefix?: string;

  // ---- Client identity -----------------------------------------------------
  /** The client's trading name, e.g. "Dreamframe Studios" — spoken by the agent. */
  businessName?: string;
  /** Business type id from business-types.ts — supplies the starting persona. */
  businessType?: string;

  // ---- Dedicated Retell agents --------------------------------------------
  /**
   * Each profile owns its OWN agent pair, so every DID answers with its own
   * persona. This is not a convenience — it is required for correctness.
   *
   * Retell routes an INBOUND call by the DID's own `inbound_agents` binding;
   * the app is never consulted and has no idea which profile is "active". So
   * two DIDs sharing one agent would answer with the same persona no matter
   * what the app is set to — a wedding studio's callers would hear a clinic
   * receptionist. Per-profile agents are what make the personas independent.
   *
   * Undefined on legacy profiles, which fall back to the .env agent ids until
   * provisioned (`npm run profiles -- provision <id>`).
   */
  outboundAgentId?: string;
  inboundAgentId?: string;

  // ---- Alerting ------------------------------------------------------------
  /**
   * This client's own Telegram bot. Each client gets their own bot so alerts
   * are branded to their business and a leaked token exposes one client, not
   * every client. Falls back to TELEGRAM_* in .env when unset.
   *
   * Never send the token to the browser — the API masks it (see webhook.ts).
   */
  telegramBotToken?: string;
  /** Chat or group id the alerts are delivered to. Negative ids are groups. */
  telegramChatId?: string;

  /**
   * Marks a throwaway profile used for sales demos.
   *
   * Demo mode temporarily re-points a profile's alerts at a prospect's phone.
   * Doing that on a paying client would send their real leads to a stranger
   * until someone remembers to undo it, so the UI warns before allowing it on
   * any profile not flagged here.
   */
  isDemo?: boolean;
}

interface ProfilesFile {
  active: string;
  profiles: VoiceLinkProfile[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
/** <repo>/voicelink-profiles.json (src/retell/ -> ../../) */
const FILE_PATH = resolve(__dirname, "../../voicelink-profiles.json");

function seed(): ProfilesFile {
  return {
    active: "primary",
    profiles: [
      {
        id: "primary",
        name: "VoiceLink — Primary",
        fromNumber: process.env.RETELL_FROM_NUMBER?.trim() || "+919429391391",
        terminationUri: "app.voicelink.co.in:3300",
        transport: "TCP",
        techPrefix: process.env.RETELL_TECH_PREFIX?.trim() ?? "",
      },
    ],
  };
}

function load(): ProfilesFile {
  if (!existsSync(FILE_PATH)) {
    const data = seed();
    save(data);
    return data;
  }
  return JSON.parse(readFileSync(FILE_PATH, "utf8"));
}

function save(data: ProfilesFile): void {
  writeFileSync(FILE_PATH, JSON.stringify(data, null, 2) + "\n");
}

export function listProfiles(): VoiceLinkProfile[] {
  return load().profiles;
}

export function getActiveProfileId(): string {
  return load().active;
}

export function getActiveProfile(): VoiceLinkProfile {
  const data = load();
  const p = data.profiles.find((x) => x.id === data.active);
  if (!p) throw new Error(`Active profile "${data.active}" not found.`);
  return p;
}

/** Look one profile up by id. Throws if it doesn't exist. */
export function getProfile(id: string): VoiceLinkProfile {
  const p = load().profiles.find((x) => x.id === id);
  if (!p) throw new Error(`No profile with id "${id}".`);
  return p;
}

export function setActiveProfile(id: string): VoiceLinkProfile {
  const data = load();
  const p = data.profiles.find((x) => x.id === id);
  if (!p) throw new Error(`No profile with id "${id}".`);
  data.active = id;
  save(data);
  return p;
}

/** Add a new profile. `id` is slugified from `name` if not given. */
export function addProfile(input: Omit<VoiceLinkProfile, "id"> & { id?: string }): VoiceLinkProfile {
  const data = load();
  const id =
    input.id?.trim() ||
    input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") ||
    `profile-${data.profiles.length + 1}`;
  if (data.profiles.some((p) => p.id === id)) {
    throw new Error(`A profile with id "${id}" already exists.`);
  }
  const profile: VoiceLinkProfile = {
    id,
    name: input.name,
    fromNumber: input.fromNumber,
    terminationUri: input.terminationUri,
    transport: input.transport || "TCP",
    techPrefix: input.techPrefix ?? "",
    businessName: input.businessName ?? input.name,
    businessType: input.businessType ?? "general",
    outboundAgentId: input.outboundAgentId,
    inboundAgentId: input.inboundAgentId,
  };
  data.profiles.push(profile);
  save(data);
  return profile;
}

/** Merge fields into one profile (used to attach agent ids after provisioning). */
export function updateProfile(
  id: string,
  patch: Partial<Omit<VoiceLinkProfile, "id">>,
): VoiceLinkProfile {
  const data = load();
  const p = data.profiles.find((x) => x.id === id);
  if (!p) throw new Error(`No profile with id "${id}".`);
  Object.assign(p, patch);
  save(data);
  return p;
}

export function removeProfile(id: string): void {
  const data = load();
  if (data.profiles.length <= 1) throw new Error("Can't remove the last remaining profile.");
  if (data.active === id) throw new Error("Can't remove the active profile — switch first.");
  data.profiles = data.profiles.filter((p) => p.id !== id);
  save(data);
}

function printAll() {
  const data = load();
  console.log(`Active: ${data.active}\n`);
  for (const p of data.profiles) {
    const mark = p.id === data.active ? "●" : "○";
    console.log(`${mark} ${p.id} — ${p.name}`);
    console.log(`    from: ${p.fromNumber}  termination: ${p.terminationUri} (${p.transport})`);
    console.log(`    business: ${p.businessName || "(unset)"} [${p.businessType || "unset"}]`);
    console.log(
      `    agents: ${p.outboundAgentId ?? "(not provisioned — using .env)"}` +
        `${p.inboundAgentId ? ` / ${p.inboundAgentId}` : ""}`,
    );
    if (p.techPrefix) console.log(`    techPrefix: ${p.techPrefix}`);
  }
}

// Run directly (`npm run profiles`) — list, or manage with a subcommand:
//   npm run profiles                                          -- list
//   npm run profiles -- use <id>                               -- switch active
//   npm run profiles -- add <name> <fromNumber> <terminationUri> [transport] [techPrefix]
//   npm run profiles -- remove <id>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (!cmd) {
      printAll();
    } else if (cmd === "use") {
      const p = setActiveProfile(args[0]);
      console.log(`✅ Active profile is now: ${p.name} (${p.fromNumber})`);
    } else if (cmd === "add") {
      const [name, fromNumber, terminationUri, transport, techPrefix] = args;
      if (!name || !fromNumber || !terminationUri) {
        throw new Error("Usage: profiles add <name> <fromNumber> <terminationUri> [transport] [techPrefix]");
      }
      const p = addProfile({ name, fromNumber, terminationUri, transport, techPrefix });
      console.log(`✅ Added profile "${p.id}" — ${p.name} (${p.fromNumber})`);
      console.log(`   Run "npm run profiles -- use ${p.id}" to make it active.`);
    } else if (cmd === "remove") {
      removeProfile(args[0]);
      console.log(`✅ Removed profile "${args[0]}"`);
    } else if (cmd === "set") {
      // profiles set <id> <field> <value>  — e.g. set primary businessType clinic
      const [id, field, ...rest] = args;
      const allowed = ["businessName", "businessType", "name", "fromNumber", "terminationUri", "isDemo"];
      if (!id || !field || !rest.length) {
        throw new Error(`Usage: profiles set <id> <${allowed.join("|")}> <value>`);
      }
      if (!allowed.includes(field)) {
        throw new Error(`Field "${field}" is not settable. Use one of: ${allowed.join(", ")}`);
      }
      const raw = rest.join(" ");
      const value = field === "isDemo" ? raw === "true" : raw;
      const p = updateProfile(id, { [field]: value } as Partial<VoiceLinkProfile>);
      console.log(`✅ ${p.id}.${field} = ${rest.join(" ")}`);
      if (field === "businessType") {
        console.log(`   Run "npm run profiles -- provision ${id} --force" to rebuild its persona.`);
      }
    } else if (cmd === "provision") {
      // provision-profile.ts imports this module, so importing it back here
      // would deadlock the ES module graph. It has its own CLI entry instead.
      throw new Error(`Run: npm run profiles:provision -- ${args.join(" ") || "<id> [--force]"}`);
    } else {
      throw new Error(
        `Unknown command "${cmd}". Use: use | add | remove | set (or no args to list). ` +
          `To provision agents: npm run profiles:provision -- <id>`,
      );
    }
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
