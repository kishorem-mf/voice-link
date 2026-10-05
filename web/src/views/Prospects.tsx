import { useEffect, useState } from "react";
import { api } from "../api";
import { age, exact, dueAge } from "../age";
import { ProspectPanel } from "./ProspectPanel";

/**
 * The Prospects tab — the screen the CRM is actually worked through.
 *
 * Two views over the same data, because a calling queue and a pipeline answer
 * different questions. "To call" wants to know who is worth ringing next, so
 * it shows reach and score. "In progress" wants to know what is going stale,
 * so it shows ages and what is overdue. One column set would serve neither.
 *
 * Part 2a: read-only. Opening a prospect and logging a call is 2b.
 */

type Prospect = Record<string, any>;
type View = "new" | "open" | "won" | "lost";

const VIEWS: { id: View; label: string }[] = [
  { id: "new", label: "To call" },
  { id: "open", label: "In progress" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

export function Prospects() {
  const [view, setView] = useState<View>("new");
  const [rows, setRows] = useState<Prospect[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newInstagram, setNewInstagram] = useState("");
  const [addMsg, setAddMsg] = useState<string | null>(null);

  async function addProspect() {
    if (!newName.trim()) return;
    setAddMsg(null);
    try {
      // Straight into the panel: someone who just rang you is being spoken to
      // now, and the next thing you want is the log form, not a list.
      const p = await api.crmAddProspect({
        businessName: newName.trim(),
        phone: newPhone.trim() || undefined,
        instagramUrl: newInstagram.trim() || undefined,
      });
      setNewName(""); setNewPhone(""); setNewInstagram(""); setAdding(false);
      setOpenId(p.prospectId);
    } catch (e) {
      setAddMsg(`❌ ${(e as Error).message}`);
    }
  }

  function load(v: View) {
    setRows(null);
    setError(null);
    api
      .crmQuery("tray", v, 200)
      .then((r) => setRows(r.rows))
      .catch((e) => setError((e as Error).message));
  }

  useEffect(() => load(view), [view]);
  useEffect(() => {
    api.crmPipeline().then(setCounts).catch(() => setCounts({}));
  }, [rows]);

  // One prospect takes over the tab: on a phone there is no room for both,
  // and the list is only there to get you here.
  if (openId)
    return (
      <ProspectPanel
        prospectId={openId}
        onClose={() => { setOpenId(null); load(view); }}
        onChanged={() => load(view)}
      />
    );

  if (error)
    return (
      <div className="panel error">
        Couldn’t load prospects: {error}
      </div>
    );

  const callable = (rows ?? []).filter((r) => r.phone).length;

  // Filters the loaded view rather than querying — the trays are small enough
  // that a round trip per keystroke would be slower, not faster.
  // The handle is displayed as "@name" but stored as a full URL, and a phone
  // is displayed with its country code but often typed without — so both sides
  // are reduced to their bare form before comparing. Searching for what is on
  // screen has to work.
  const bare = (v: string) =>
    v
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
      .replace(/[@\s/+()-]/g, "");

  const needle = bare(search.trim());
  const shown = needle
    ? (rows ?? []).filter((r) => {
        const hay = [r.businessName, r.phone, r.instagramUrl, r.city]
          .filter(Boolean)
          .map((v: any) => bare(String(v)))
          .join(" ");
        return hay.includes(needle);
      })
    : rows ?? [];

  return (
    <div className="panel">
      <div className="row" style={{ gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`tab ${view === v.id ? "active" : ""}`}
            onClick={() => setView(v.id)}
          >
            {v.label}
            {counts[v.id] !== undefined && (
              <span className="hint" style={{ marginLeft: 6 }}>{counts[v.id]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <input
          placeholder="Search name, phone or handle…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: "1 1 220px", minWidth: 180 }}
        />
        <button className="primary" onClick={() => setAdding((a) => !a)}>
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>

      {adding && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="lbl">New prospect</div>
          <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
            <input
              placeholder="Business name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addProspect()}
              autoFocus
              style={{ minWidth: 190 }}
            />
            <input
              placeholder="Phone (optional)"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addProspect()}
              style={{ minWidth: 150 }}
            />
            <input
              placeholder="@instagram (optional)"
              value={newInstagram}
              onChange={(e) => setNewInstagram(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addProspect()}
              style={{ minWidth: 150 }}
            />
            <button className="primary" onClick={addProspect} disabled={!newName.trim()}>
              Add &amp; open
            </button>
          </div>
          {addMsg && <div className="hint" style={{ color: "var(--bad)" }}>{addMsg}</div>}
          <div className="hint">
            Only the name is required — a caller you have no other details for still belongs here.
          </div>
        </div>
      )}

      {view === "new" && rows && !needle && (
        <div className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Best first. {callable} of {rows.length} have a phone number — the rest need
          one before they can be called.
        </div>
      )}

      {!rows && <div className="spinner">Loading…</div>}

      {rows && shown.length === 0 && (
        <div className="hint" style={{ padding: "20px 0" }}>
          {needle
            ? `Nothing matching “${search.trim()}” in ${VIEWS.find((v) => v.id === view)!.label.toLowerCase()}.`
            : `Nothing in ${VIEWS.find((v) => v.id === view)!.label.toLowerCase()}.`}
        </div>
      )}

      {rows && shown.length > 0 && (
        <div className="table-wrap prospect-list">
          <table>
            <thead>
              {view === "new" ? (
                <tr>
                  <th>business</th>
                  <th style={{ textAlign: "right" }}>score</th>
                  <th style={{ textAlign: "right" }}>followers</th>
                  <th>phone</th>
                  <th>city</th>
                </tr>
              ) : (
                <tr>
                  <th>business</th>
                  <th>first contact</th>
                  <th>last contact</th>
                  <th>due</th>
                  <th>phone</th>
                </tr>
              )}
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr
                  key={p.prospectId}
                  onClick={() => setOpenId(p.prospectId)}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <div>{p.businessName}</div>
                    {p.instagramUrl && (
                      <div className="hint" style={{ marginTop: 2 }}>
                        {String(p.instagramUrl)
                          .replace(/^https?:\/\/(www\.)?instagram\.com\//, "@")
                          .replace(/\/$/, "")}
                      </div>
                    )}
                  </td>

                  {view === "new" ? (
                    <>
                      <td data-label="score" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {typeof p.score === "number" ? p.score.toLocaleString("en-IN") : "—"}
                      </td>
                      <td data-label="followers" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {typeof p.followers === "number" ? p.followers.toLocaleString("en-IN") : "—"}
                      </td>
                      <td data-label="phone">
                        {p.phone ? (
                          <code>{p.phone}</code>
                        ) : (
                          <span className="hint">no number</span>
                        )}
                      </td>
                      <td data-label="city">{p.city ?? "—"}</td>
                    </>
                  ) : (
                    <>
                      <td data-label="first contact" title={exact(p.openedAt)} style={{ whiteSpace: "nowrap" }}>
                        {age(p.openedAt)}
                      </td>
                      <td data-label="last contact" title={exact(p.lastContactedAt)} style={{ whiteSpace: "nowrap" }}>
                        {/* "never" rather than a dash: a prospect in the live tray
                            who has never been called is worth noticing. */}
                        {p.lastContactedAt ? age(p.lastContactedAt) : <span className="hint">never</span>}
                      </td>
                      <td data-label="due" title={p.followUpDue ? String(p.followUpDue) : undefined} style={{ whiteSpace: "nowrap" }}>
                        {(() => {
                          const d = dueAge(p.followUpDue);
                          return (
                            <span
                              className={d.text === "—" ? "hint" : undefined}
                              style={d.overdue ? { color: "var(--bad)" } : undefined}
                            >
                              {d.text}
                            </span>
                          );
                        })()}
                      </td>
                      <td data-label="phone">{p.phone ? <code>{p.phone}</code> : <span className="hint">—</span>}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
