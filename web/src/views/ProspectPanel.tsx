import { useEffect, useState } from "react";
import { api } from "../api";
import { age, exact, dueAge } from "../age";

/**
 * One prospect: who they are, every call so far, and the form for logging the
 * one that just happened.
 *
 * The form is the reason this screen exists. If recording a call takes longer
 * than about ten seconds it gets postponed and then never happens, so it sits
 * open on the page rather than behind a button, uses dropdowns rather than
 * free text, and defaults to the common case.
 */

type Row = Record<string, any>;

/**
 * When the call happened. Usually "just now", but a call gets logged walking
 * back to the car — and lastContactedAt feeds the age the pipeline is read by,
 * so a silently-wrong timestamp corrupts the number being acted on.
 */
const WHEN = [
  { id: "now", label: "just now", minutesAgo: 0 },
  { id: "30m", label: "half an hour ago", minutesAgo: 30 },
  { id: "2h", label: "a couple of hours ago", minutesAgo: 120 },
  { id: "yesterday", label: "yesterday", minutesAgo: 60 * 24 },
];

export function ProspectPanel({
  prospectId,
  onClose,
  onChanged,
}: {
  prospectId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [prospect, setProspect] = useState<Row | null>(null);
  const [events, setEvents] = useState<Row[]>([]);
  const [options, setOptions] = useState<{ outcomes: any[]; followUps: any[] }>({
    outcomes: [],
    followUps: [],
  });

  const [outcome, setOutcome] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [when, setWhen] = useState("now");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [showNumber, setShowNumber] = useState(false);

  function load() {
    api
      .crmProspect(prospectId)
      .then((d) => {
        setProspect(d.prospect);
        setEvents(d.events);
      })
      .catch((e) => setMsg(`❌ ${(e as Error).message}`));
  }

  useEffect(load, [prospectId]);
  useEffect(() => {
    api.crmOptions().then(setOptions).catch(() => {});
  }, []);

  async function save() {
    if (!outcome) {
      setMsg("❌ Pick what happened first.");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const mins = WHEN.find((w) => w.id === when)?.minutesAgo ?? 0;
      await api.crmLogCall(prospectId, {
        outcome,
        notes: notes.trim() || undefined,
        // Omitted entirely when left blank, so saving a call never silently
        // clears a follow-up that was already set.
        ...(followUp ? { followUp } : {}),
        at: new Date(Date.now() - mins * 60000).toISOString(),
        direction: "outbound",
      });
      setOutcome("");
      setFollowUp("");
      setNotes("");
      setWhen("now");
      setMsg("Logged.");
      load();
      onChanged();
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function saraCalls() {
    if (!prospect?.phone) return;
    setCalling(true);
    setMsg(null);
    try {
      await api.call(prospect.phone);
      setMsg(
        "Sara is calling. Her outcome will be written here automatically once phase 3 is in; log it yourself until then.",
      );
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setCalling(false);
    }
  }

  if (!prospect) return <div className="panel spinner">Loading…</div>;

  const due = dueAge(prospect.followUpDue);
  const handle = prospect.instagramUrl
    ? String(prospect.instagramUrl).replace(/^https?:\/\/(www\.)?instagram\.com\//, "@").replace(/\/$/, "")
    : null;

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{prospect.businessName}</h2>
          <div className="hint" style={{ marginTop: 0 }}>
            {prospect.phone ? <code>{prospect.phone}</code> : "no phone number yet"}
            {handle && <> · {handle}</>}
            {prospect.city && <> · {prospect.city}</>}
            {typeof prospect.followers === "number" && (
              <> · {prospect.followers.toLocaleString("en-IN")} followers</>
            )}
          </div>
          <div className="hint">
            {prospect.status === "new" ? (
              "not contacted yet"
            ) : (
              <>
                first contact <b title={exact(prospect.openedAt)}>{age(prospect.openedAt)}</b> · last
                contact{" "}
                <b title={exact(prospect.lastContactedAt)}>
                  {prospect.lastContactedAt ? age(prospect.lastContactedAt) : "never"}
                </b>
                {prospect.followUpDue && (
                  <>
                    {" "}· due{" "}
                    <b style={due.overdue ? { color: "var(--bad)" } : undefined}>{due.text}</b>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <button className="primary" style={{ background: "var(--panel-2)" }} onClick={onClose}>
          ← Back
        </button>
      </div>

      {/* ---- calling ---- */}
      <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
        <button
          className="primary"
          onClick={() => setShowNumber((s) => !s)}
          disabled={!prospect.phone}
          title={prospect.phone ? "Dial this yourself" : "No number on file"}
        >
          📱 Call myself
        </button>
        <button
          className="primary"
          onClick={saraCalls}
          disabled={!prospect.phone || calling}
          title={prospect.phone ? "Place the call through VoiceLink" : "No number on file"}
        >
          {calling ? "Dialling…" : "🤖 Sara calls them"}
        </button>
      </div>

      {showNumber && prospect.phone && (
        <div style={{ marginTop: 10 }}>
          <a href={`tel:${prospect.phone}`} style={{ fontSize: 26, letterSpacing: 1 }}>
            {prospect.phone}
          </a>
          <div className="hint">Dial this, then log the call below.</div>
        </div>
      )}

      {/* ---- the log form ---- */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="lbl">Log a call</div>
        <div className="row" style={{ marginTop: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ minWidth: 170 }}>
            <option value="">What happened…</option>
            {options.outcomes.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <select value={followUp} onChange={(e) => setFollowUp(e.target.value)} style={{ minWidth: 150 }}>
            <option value="">Call back…</option>
            {options.followUps.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          <select value={when} onChange={(e) => setWhen(e.target.value)} style={{ minWidth: 150 }}>
            {WHEN.map((w) => (
              <option key={w.id} value={w.id}>{w.label}</option>
            ))}
          </select>
        </div>
        <input
          placeholder="What was said…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          style={{ width: "100%", marginBottom: 8 }}
        />
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && (
          <div className="hint" style={{ color: msg.startsWith("❌") ? "var(--bad)" : "var(--ok)" }}>
            {msg.startsWith("❌") ? msg : `✅ ${msg}`}
          </div>
        )}
      </div>

      {/* ---- history ---- */}
      <div className="lbl" style={{ marginTop: 20 }}>
        History {events.length > 0 && <span className="hint">· {events.length}</span>}
      </div>
      {events.length === 0 && <div className="hint">No calls logged yet.</div>}
      {events.map((e) => (
        <div key={e.at} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13 }}>
            <b>{options.outcomes.find((o) => o.id === e.outcome)?.label ?? e.outcome ?? "—"}</b>
            <span className="hint" style={{ marginLeft: 8 }} title={exact(e.at)}>
              {age(e.at)} ·{" "}
              {/* Who made the call is the point of the timeline, not a detail. */}
              <b style={{ color: e.by === "sara" ? "var(--accent)" : "var(--ok)" }}>
                {e.by === "sara" ? "Sara" : "you"}
              </b>
            </span>
          </div>
          {e.notes && <div className="hint" style={{ marginTop: 2 }}>{e.notes}</div>}
        </div>
      ))}
    </div>
  );
}
