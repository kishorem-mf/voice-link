import { useEffect, useMemo, useState } from "react";
import {
  api,
  type Voice,
  type LanguageOption,
  type ModelOption,
  type PostCallModelOption,
  type PersonaPreset,
} from "../api";

export function Settings() {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [current, setCurrent] = useState<string>("");
  const [selected, setSelected] = useState<string>("");
  const [accent, setAccent] = useState<string>("Indian");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Language state
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [curLang, setCurLang] = useState<string>("");
  const [selLang, setSelLang] = useState<string>("");
  const [savingLang, setSavingLang] = useState(false);
  const [langMsg, setLangMsg] = useState<string | null>(null);

  // Model state
  const [models, setModels] = useState<ModelOption[]>([]);
  const [curModel, setCurModel] = useState<string>("");
  const [selModel, setSelModel] = useState<string>("");
  const [savingModel, setSavingModel] = useState(false);
  const [modelMsg, setModelMsg] = useState<string | null>(null);

  // Post-call analysis model state
  const [pcModels, setPcModels] = useState<PostCallModelOption[]>([]);
  const [curPc, setCurPc] = useState<string>("");
  const [selPc, setSelPc] = useState<string>("");
  const [savingPc, setSavingPc] = useState(false);
  const [pcMsg, setPcMsg] = useState<string | null>(null);

  // Persona state
  const [presets, setPresets] = useState<PersonaPreset[]>([]);
  const [curPrompt, setCurPrompt] = useState<string>("");
  const [curFirst, setCurFirst] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");
  const [firstMsg, setFirstMsg] = useState<string>("");
  const [savingPersona, setSavingPersona] = useState(false);
  const [personaMsg, setPersonaMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.voices(),
      api.agentVoice(),
      api.languages(),
      api.models(),
      api.postCallModels(),
      api.personas(),
      api.getPrompt(),
    ])
      .then(([vs, agent, langs, mdls, pcs, prs, persona]) => {
        setVoices(vs);
        setCurrent(agent.voiceId);
        setSelected(agent.voiceId);
        setLanguages(langs);
        setCurLang(agent.language ?? "");
        setSelLang(agent.language ?? "");
        setModels(mdls);
        setCurModel(agent.model ?? "");
        setSelModel(agent.model ?? "");
        setPcModels(pcs);
        setCurPc(agent.postCallModel ?? "");
        setSelPc(agent.postCallModel ?? "");
        setPresets(prs);
        setCurPrompt(persona.prompt);
        setCurFirst(persona.firstMessage);
        setPrompt(persona.prompt);
        setFirstMsg(persona.firstMessage);
      })
      .catch((e) => setError(e.message));
  }, []);

  function applyPreset(name: string) {
    const p = presets.find((x) => x.name === name);
    if (p) {
      setPrompt(p.prompt);
      setFirstMsg(p.firstMessage);
    }
  }

  async function savePersona() {
    setSavingPersona(true);
    setPersonaMsg(null);
    try {
      const saved = await api.setPrompt(prompt, firstMsg);
      setCurPrompt(saved.prompt);
      setCurFirst(saved.firstMessage);
      setPersonaMsg("Persona updated. New calls will use it.");
    } catch (e) {
      setPersonaMsg(`❌ ${(e as Error).message}`);
    } finally {
      setSavingPersona(false);
    }
  }

  async function saveModel() {
    setSavingModel(true);
    setModelMsg(null);
    try {
      const { model } = await api.setModel(selModel);
      setCurModel(model);
      setModelMsg(`Model updated to ${model}. New calls will use it.`);
    } catch (e) {
      setModelMsg(`❌ ${(e as Error).message}`);
    } finally {
      setSavingModel(false);
    }
  }

  async function savePc() {
    setSavingPc(true);
    setPcMsg(null);
    try {
      const { model } = await api.setPostCallModel(selPc);
      setCurPc(model);
      setPcMsg(`Post-call model updated to ${model}. New calls will use it.`);
    } catch (e) {
      setPcMsg(`❌ ${(e as Error).message}`);
    } finally {
      setSavingPc(false);
    }
  }

  async function saveLang() {
    setSavingLang(true);
    setLangMsg(null);
    try {
      const { language } = await api.setLanguage(selLang);
      setCurLang(language);
      setLangMsg(`Language updated to ${labelFor(language)}. New calls will use it.`);
    } catch (e) {
      setLangMsg(`❌ ${(e as Error).message}`);
    } finally {
      setSavingLang(false);
    }
  }

  function labelFor(code: string): string {
    return languages.find((l) => l.code === code)?.label ?? code;
  }

  const accents = useMemo(() => {
    const set = new Set((voices ?? []).map((v) => v.accent).filter(Boolean) as string[]);
    return ["All", ...Array.from(set).sort()];
  }, [voices]);

  const filtered = useMemo(() => {
    const list = voices ?? [];
    return accent === "All" ? list : list.filter((v) => v.accent === accent);
  }, [voices, accent]);

  const selectedVoice = voices?.find((v) => v.voiceId === selected);

  async function save() {
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const { voiceId } = await api.setVoice(selected);
      setCurrent(voiceId);
      setMsg(`Voice updated to ${voiceId}. New calls will use it.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (error && !voices) return <div className="panel error">Failed to load settings: {error}</div>;

  const selModelOpt = models.find((m) => m.model === selModel);

  const personaDirty = prompt.trim() !== curPrompt.trim() || firstMsg.trim() !== curFirst.trim();

  return (
    <>
    <div className="panel">
      <h2>Agent persona</h2>
      <div className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
        Defines how the agent behaves and what it says first. Pick a template to start,
        then edit. Applies to the live agent on the next call.
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <label className="muted" style={{ fontSize: 13 }}>Template</label>
        <select defaultValue="" onChange={(e) => applyPreset(e.target.value)} style={{ minWidth: 240 }}>
          <option value="" disabled>Choose a preset…</option>
          {presets.map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
      </div>
      <label className="muted" style={{ fontSize: 13, display: "block", marginBottom: 4 }}>
        First message (what the agent says when the call connects)
      </label>
      <input
        style={{ width: "100%", marginBottom: 12 }}
        value={firstMsg}
        onChange={(e) => setFirstMsg(e.target.value)}
        placeholder="Hi, this is …"
      />
      <label className="muted" style={{ fontSize: 13, display: "block", marginBottom: 4 }}>
        System prompt (persona & behavior)
      </label>
      <textarea
        style={{
          width: "100%",
          minHeight: 140,
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          borderRadius: 8,
          padding: "10px 12px",
          fontSize: 14,
          fontFamily: "inherit",
          resize: "vertical",
        }}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="You are a polite outbound calling assistant…"
      />
      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="primary"
          onClick={savePersona}
          disabled={savingPersona || !personaDirty || !prompt.trim() || !firstMsg.trim()}
        >
          {savingPersona ? "Saving…" : "Save persona"}
        </button>
        {!personaDirty && <span className="muted">No unsaved changes.</span>}
      </div>
      {personaMsg && (
        <div className="hint" style={{ color: personaMsg.startsWith("❌") ? "var(--bad)" : "var(--ok)" }}>
          {personaMsg.startsWith("❌") ? personaMsg : `✅ ${personaMsg}`}
        </div>
      )}
    </div>

    <div className="panel">
      <h2>LLM model</h2>
      <div className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
        Current model: <code>{curModel || "…"}</code>. The model drives most of the
        per-minute cost. Cheaper models suit reminder/confirmation calls.
      </div>
      <div className="row">
        <select
          style={{ minWidth: 300 }}
          value={selModel}
          onChange={(e) => setSelModel(e.target.value)}
        >
          {models.map((m) => (
            <option key={m.model} value={m.model}>
              {m.label} — ${m.pricePerMin.toFixed(3)}/min
            </option>
          ))}
        </select>
        <button
          className="primary"
          onClick={saveModel}
          disabled={savingModel || selModel === curModel || !selModel}
        >
          {savingModel ? "Saving…" : "Save model"}
        </button>
        {selModel === curModel && <span className="muted">Current model.</span>}
      </div>
      {selModelOpt && (
        <div className="hint">
          Est. total ≈ ${(0.055 + selModelOpt.pricePerMin + 0.06).toFixed(3)}/min
          (Voice Engine $0.055 + model ${selModelOpt.pricePerMin.toFixed(3)} + voice ~$0.06),
          excluding VoiceLink telephony.
        </div>
      )}
      {modelMsg && (
        <div className="hint" style={{ color: modelMsg.startsWith("❌") ? "var(--bad)" : "var(--ok)" }}>
          {modelMsg.startsWith("❌") ? modelMsg : `✅ ${modelMsg}`}
        </div>
      )}
    </div>

    <div className="panel">
      <h2>Post-call analysis model</h2>
      <div className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
        Current: <code>{curPc || "…"}</code>. Runs once per call to produce the
        summary + sentiment — billed <em>per call</em>, so a cheap model saves a flat
        amount on every call.
      </div>
      <div className="row">
        <select
          style={{ minWidth: 300 }}
          value={selPc}
          onChange={(e) => setSelPc(e.target.value)}
        >
          {pcModels.map((m) => (
            <option key={m.model} value={m.model}>
              {m.label} — ${m.pricePerCall.toFixed(3)}/call
            </option>
          ))}
        </select>
        <button
          className="primary"
          onClick={savePc}
          disabled={savingPc || selPc === curPc || !selPc}
        >
          {savingPc ? "Saving…" : "Save post-call model"}
        </button>
        {selPc === curPc && <span className="muted">Current model.</span>}
      </div>
      {pcMsg && (
        <div className="hint" style={{ color: pcMsg.startsWith("❌") ? "var(--bad)" : "var(--ok)" }}>
          {pcMsg.startsWith("❌") ? pcMsg : `✅ ${pcMsg}`}
        </div>
      )}
    </div>

    <div className="panel">
      <h2>Agent language</h2>
      <div className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
        Current language: <code>{labelFor(curLang) || "…"}</code>. Applies to the
        Retell agent and takes effect on the next call.
      </div>
      <div className="row">
        <select
          style={{ minWidth: 260 }}
          value={selLang}
          onChange={(e) => setSelLang(e.target.value)}
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <button
          className="primary"
          onClick={saveLang}
          disabled={savingLang || selLang === curLang || !selLang}
        >
          {savingLang ? "Saving…" : "Save language"}
        </button>
        {selLang === curLang && <span className="muted">Current language.</span>}
      </div>
      {langMsg && (
        <div className="hint" style={{ color: langMsg.startsWith("❌") ? "var(--bad)" : "var(--ok)" }}>
          {langMsg.startsWith("❌") ? langMsg : `✅ ${langMsg}`}
        </div>
      )}
    </div>

    <div className="panel">
      <h2>Agent voice</h2>
      <div className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
        Current voice: <code>{current || "…"}</code>. Changes apply to the Retell
        outbound agent and take effect on the next call.
      </div>

      {!voices ? (
        <div className="spinner">Loading voices…</div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <label className="muted" style={{ fontSize: 13 }}>Accent</label>
            <select value={accent} onChange={(e) => setAccent(e.target.value)}>
              {accents.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <label className="muted" style={{ fontSize: 13 }}>Voice</label>
            <select
              style={{ minWidth: 260 }}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {filtered.map((v) => (
                <option key={v.voiceId} value={v.voiceId}>
                  {v.name} — {v.gender ?? "?"} · {v.provider}
                </option>
              ))}
            </select>
          </div>

          {selectedVoice?.previewUrl && (
            <audio controls preload="none" src={selectedVoice.previewUrl} />
          )}

          <div className="row" style={{ marginTop: 14 }}>
            <button
              className="primary"
              onClick={save}
              disabled={saving || selected === current || !selected}
            >
              {saving ? "Saving…" : "Save voice"}
            </button>
            {selected === current && <span className="muted">This is the current voice.</span>}
          </div>

          {msg && <div className="hint" style={{ color: "var(--ok)" }}>✅ {msg}</div>}
          {error && <div className="error" style={{ marginTop: 8 }}>❌ {error}</div>}
        </>
      )}
    </div>
    </>
  );
}
