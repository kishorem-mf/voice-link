import { useEffect, useState } from "react";
import { api, type VoiceLinkProfile, type BusinessTypeOption } from "../api";
import { DemoAlertTarget } from "./DemoAlertTarget";

/**
 * Switch which VoiceLink account/DID the app operates on, or register a new
 * one. Useful when a VoiceLink account's trial/balance runs out and you move
 * to a fresh account — the Retell agents (voice/persona/model) stay the same,
 * only the phone number and SIP termination change.
 */
export function VoiceLinkProfilePanel({ onChanged }: { onChanged?: () => void }) {
  const [profiles, setProfiles] = useState<VoiceLinkProfile[]>([]);
  const [active, setActive] = useState<string>("");
  const [selected, setSelected] = useState<string>("");
  const [switching, setSwitching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [newTermination, setNewTermination] = useState("");
  const [newBizType, setNewBizType] = useState("general");
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);

  // Business identity of the SELECTED profile.
  const [types, setTypes] = useState<BusinessTypeOption[]>([]);
  const [bizName, setBizName] = useState("");
  const [bizType, setBizType] = useState("");
  const [savingBiz, setSavingBiz] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [bizMsg, setBizMsg] = useState<string | null>(null);

  // This client's Telegram bot. The token is write-only from the browser's
  // point of view — the server never sends it back.
  const [tgToken, setTgToken] = useState("");
  const [tgChat, setTgChat] = useState("");
  const [savingTg, setSavingTg] = useState(false);
  const [testingTg, setTestingTg] = useState(false);
  const [tgMsg, setTgMsg] = useState<string | null>(null);

  function load(keepSelection?: string) {
    api
      .profiles()
      .then((r) => {
        setProfiles(r.profiles);
        setActive(r.active);
        setSelected((prev) => keepSelection ?? prev ?? r.active);
        if (!keepSelection) setSelected(r.active);
      })
      .catch((e) => setMsg(`❌ ${(e as Error).message}`));
  }

  useEffect(() => {
    load();
    api.businessTypes().then(setTypes).catch(() => setTypes([]));
  }, []);

  // Track the selected profile's identity fields.
  useEffect(() => {
    const p = profiles.find((x) => x.id === selected);
    setBizName(p?.businessName ?? "");
    setBizType(p?.businessType ?? "general");
    setBizMsg(null);
    setTgToken("");
    setTgChat(p?.telegramChatId ?? "");
    setTgMsg(null);
  }, [selected, profiles]);

  async function switchProfile() {
    setSwitching(true);
    setMsg(null);
    try {
      const r = await api.setActiveProfile(selected);
      setActive(r.active);
      const who = r.profile.businessName || r.profile.name;
      setMsg(
        r.claimed
          ? `Switched to ${who}. ${r.profile.fromNumber} now answers as ${who}.`
          : r.claimError
            ? `Switched to ${who}, but the number could not be re-pointed: ${r.claimError}`
            : `Switched to ${who} (${r.profile.fromNumber}).`,
      );
      load(selected);
      onChanged?.();
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setSwitching(false);
    }
  }

  async function importActive() {
    setImporting(true);
    setMsg(null);
    try {
      await api.importProfile(selected);
      setMsg(
        "Connection re-synced — the number points at this client's agents. " +
          "If inbound calls still don't arrive, add this number to the VoiceLink trunk's Inbound Call — DIDs.",
      );
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  }

  async function submitAdd() {
    setAdding(true);
    setAddMsg(null);
    try {
      const p = await api.addProfile({
        name: newName.trim(),
        fromNumber: newNumber.trim(),
        terminationUri: newTermination.trim(),
        businessName: newName.trim(),
        businessType: newBizType,
      });
      setNewName("");
      setNewNumber("");
      setNewTermination("");
      setNewBizType("general");
      setShowAdd(false);
      setAddMsg(null);
      load();
      setMsg(`Added "${p.name}". Select it above, then create its agents.`);
    } catch (e) {
      setAddMsg(`❌ ${(e as Error).message}`);
    } finally {
      setAdding(false);
    }
  }

  async function saveBusiness() {
    setSavingBiz(true);
    setBizMsg(null);
    try {
      await api.updateProfile(selected, { businessName: bizName, businessType: bizType });
      load(selected);
      setBizMsg("Saved. Rebuild the agents below to apply the new persona.");
    } catch (e) {
      setBizMsg(`❌ ${(e as Error).message}`);
    } finally {
      setSavingBiz(false);
    }
  }

  async function provision(force: boolean) {
    setProvisioning(true);
    setBizMsg(null);
    try {
      const r = await api.provisionProfile(selected, force);
      load(selected);
      if (!r.created) {
        setBizMsg("This client already has its own agents — use Rebuild to apply a new persona.");
      } else {
        setBizMsg(
          r.numberBound
            ? "Agents created and the number now answers with this client's persona."
            : `Agents created, but the number could not be re-pointed: ${r.bindError}`,
        );
      }
    } catch (e) {
      setBizMsg(`❌ ${(e as Error).message}`);
    } finally {
      setProvisioning(false);
    }
  }

  async function saveTelegram() {
    setSavingTg(true);
    setTgMsg(null);
    try {
      const patch: { botToken?: string; chatId?: string } = {};
      if (tgToken.trim()) patch.botToken = tgToken.trim();
      if (tgChat.trim()) patch.chatId = tgChat.trim();
      const r = await api.setProfileTelegram(selected, patch);
      setTgToken("");
      load(selected);
      setTgMsg(r.ok ? `Bot verified: @${r.botUsername}` : `❌ ${r.error ?? "could not verify"}`);
    } catch (e) {
      setTgMsg(`❌ ${(e as Error).message}`);
    } finally {
      setSavingTg(false);
    }
  }

  async function testTelegram() {
    setTestingTg(true);
    setTgMsg(null);
    try {
      const r = await api.testProfileTelegram(selected);
      setTgMsg(r.ok ? "Test message sent — check Telegram." : `❌ ${r.error}`);
    } catch (e) {
      setTgMsg(`❌ ${(e as Error).message}`);
    } finally {
      setTestingTg(false);
    }
  }

  const selectedProfile = profiles.find((p) => p.id === selected);
  const provisioned = Boolean(selectedProfile?.outboundAgentId && selectedProfile?.inboundAgentId);
  const bizDirty =
    bizName !== (selectedProfile?.businessName ?? "") ||
    bizType !== (selectedProfile?.businessType ?? "general");

  return (
    <div className="panel">
      <h2>Client (VoiceLink account)</h2>
      <div className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
        One profile = one client: their number, their business, and their own agents.
        Switching here points the app — outbound calls, settings and persona edits —
        at that client. Inbound calls always answer as whichever client owns the
        number, regardless of what's selected.
      </div>

      <div className="row">
        <select style={{ minWidth: 320 }} value={selected} onChange={(e) => setSelected(e.target.value)}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.isDemo ? "🎯 " : ""}
              {p.name} — {p.fromNumber}
              {p.id === active ? " (active)" : ""}
            </option>
          ))}
        </select>
        <button className="primary" onClick={switchProfile} disabled={switching || selected === active}>
          {switching ? "Switching…" : "Switch"}
        </button>
        <button className="primary" onClick={importActive} disabled={importing || !selected}>
          {importing ? "Re-syncing…" : "Re-sync connection"}
        </button>
      </div>

      {selectedProfile && (
        <div className="hint">
          termination: <code>{selectedProfile.terminationUri}</code> ({selectedProfile.transport || "TCP"})
          {selectedProfile.techPrefix ? <> &middot; tech prefix <code>{selectedProfile.techPrefix}</code></> : null}
        </div>
      )}

      {msg && (
        <div className="hint" style={{ color: msg.startsWith("❌") ? "var(--bad)" : "var(--ok)" }}>
          {msg.startsWith("❌") ? msg : `✅ ${msg}`}
        </div>
      )}

      {/* ---- Business identity: what this client does, and its own agents ---- */}
      {selectedProfile && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="lbl">This client's business</div>
          <div className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
            Each client gets its own agents, so its number answers with its own persona.
            A wedding studio and a clinic never share a script.
          </div>

          <div className="row" style={{ marginBottom: 8 }}>
            <input
              placeholder="Business name, e.g. Dreamframe Studios"
              value={bizName}
              onChange={(e) => setBizName(e.target.value)}
              style={{ minWidth: 260 }}
            />
            <select value={bizType} onChange={(e) => setBizType(e.target.value)} style={{ minWidth: 280 }}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="row">
            <button className="primary" onClick={saveBusiness} disabled={savingBiz || !bizDirty}>
              {savingBiz ? "Saving…" : "Save"}
            </button>
            <button
              className="primary"
              onClick={() => provision(provisioned)}
              disabled={provisioning || !bizName.trim()}
            >
              {provisioning
                ? provisioned
                  ? "Resetting…"
                  : "Setting up…"
                : provisioned
                  ? "Reset scripts to template"
                  : "Set up this client's agents"}
            </button>
          </div>

          <div className="hint">
            {provisioned ? (
              <>
                Own agents: <code>{selectedProfile.outboundAgentId}</code> (outbound) ·{" "}
                <code>{selectedProfile.inboundAgentId}</code> (inbound)
              </>
            ) : (
              <>⚠️ Not provisioned — this number still shares the default agents from <code>.env</code>.</>
            )}
          </div>

          {bizMsg && (
            <div className="hint" style={{ color: bizMsg.startsWith("❌") ? "var(--bad)" : "var(--ok)" }}>
              {bizMsg.startsWith("❌") ? bizMsg : `✅ ${bizMsg}`}
            </div>
          )}

          <div className="hint">
            Resetting rewrites both scripts from the {" "}
            <b>{types.find((t) => t.id === bizType)?.label ?? "selected"}</b> template and
            discards any edits made in “What Sara says”. To change wording without
            losing it, edit it there instead.
          </div>

          {/* ---- This client's Telegram alerts ---- */}
          <div className="lbl" style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid var(--line, #2a3346)" }}>
            Call alerts (Telegram)
          </div>
          <div className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
            This client's own bot. Alerts route by the agent that handled the call, so
            each client only ever sees their own leads — regardless of which client is
            selected here.
          </div>

          <div className="row" style={{ marginBottom: 8 }}>
            <input
              type="password"
              placeholder={
                selectedProfile.hasTelegramBot ? "Bot token saved — type to replace" : "Bot token from @BotFather"
              }
              value={tgToken}
              onChange={(e) => setTgToken(e.target.value)}
              style={{ minWidth: 260 }}
            />
            <input
              placeholder="Chat or group id, e.g. -1001234567890"
              value={tgChat}
              onChange={(e) => setTgChat(e.target.value)}
              style={{ minWidth: 220 }}
            />
          </div>

          <div className="row">
            <button
              className="primary"
              onClick={saveTelegram}
              disabled={savingTg || (!tgToken.trim() && !tgChat.trim())}
            >
              {savingTg ? "Saving…" : "Save bot"}
            </button>
            <button className="primary" onClick={testTelegram} disabled={testingTg}>
              {testingTg ? "Sending…" : "Send test message"}
            </button>
          </div>

          <div className="hint">
            {selectedProfile.hasTelegramBot ? (
              <>✅ Own bot configured · chat <code>{selectedProfile.telegramChatId}</code></>
            ) : (
              <>Using the default bot from <code>.env</code>. Add a bot here to brand alerts for this client.</>
            )}
          </div>

          {tgMsg && (
            <div className="hint" style={{ color: tgMsg.startsWith("❌") ? "var(--bad)" : "var(--ok)" }}>
              {tgMsg.startsWith("❌") ? tgMsg : `✅ ${tgMsg}`}
            </div>
          )}

          <DemoAlertTarget
            profileId={selected}
            businessName={selectedProfile.businessName || selectedProfile.name}
            isDemo={selectedProfile.isDemo}
            onBound={() => load(selected)}
          />
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {!showAdd ? (
          <button className="primary" onClick={() => setShowAdd(true)}>
            + Add a VoiceLink account
          </button>
        ) : (
          <div className="card" style={{ marginTop: 4 }}>
            <div className="lbl">New VoiceLink account</div>
            <div className="row" style={{ marginBottom: 8 }}>
              <input
                placeholder="Client name, e.g. Dreamframe Studios"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ minWidth: 240 }}
              />
              <select value={newBizType} onChange={(e) => setNewBizType(e.target.value)} style={{ minWidth: 260 }}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="row" style={{ marginBottom: 8 }}>
              <input
                placeholder="DID, e.g. +919429397398"
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
                style={{ minWidth: 220 }}
              />
              <input
                placeholder="Termination URI, e.g. sip.voicelink.co.in:3300"
                value={newTermination}
                onChange={(e) => setNewTermination(e.target.value)}
                style={{ minWidth: 260 }}
              />
            </div>
            <div className="row">
              <button
                className="primary"
                onClick={submitAdd}
                disabled={adding || !newName.trim() || !newNumber.trim() || !newTermination.trim()}
              >
                {adding ? "Adding…" : "Add account"}
              </button>
              <button className="primary" onClick={() => setShowAdd(false)} style={{ background: "var(--panel-2)" }}>
                Cancel
              </button>
            </div>
            {addMsg && <div className="hint" style={{ color: "var(--bad)" }}>{addMsg}</div>}
            <div className="hint">
              Find the termination URI in VoiceLink &rarr; SIP Trunk Management &rarr;
              Whitelist Configuration &rarr; URI (SIP Signaling).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
