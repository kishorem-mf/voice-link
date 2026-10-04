import { Fragment, useEffect, useState } from "react";
import { api, type TableShape } from "../api";

/**
 * A window onto the raw CRM table — one data grid with a toolbar, the shape a
 * database client takes.
 *
 * This is a diagnostic view, not a customer-facing screen. It grew a section
 * per concept while the single-table design was being learned; those are gone
 * now that the model is understood. What remains is what a production tool
 * keeps: the data, the controls, and which index answered the query.
 */

type Field = "none" | "text" | "tray" | "date" | "days";

const QUERIES: { id: string; label: string; field: Field; placeholder?: string }[] = [
  { id: "browse", label: "All rows", field: "none" },
  { id: "tray", label: "Prospects by tray", field: "tray" },
  { id: "due", label: "Due for follow-up", field: "date" },
  { id: "activity", label: "Recent activity", field: "days", placeholder: "7" },
  { id: "by_phone", label: "Find by phone", field: "text", placeholder: "7842160862" },
  { id: "by_instagram", label: "Find by Instagram", field: "text", placeholder: "@handle" },
  { id: "history", label: "Prospect history", field: "text", placeholder: "prospectId" },
  { id: "pipeline", label: "Pipeline counts", field: "none" },
];

/** Row type, from the key prefix — shown as a chip rather than a separate table. */
function rowType(r: Record<string, unknown>) {
  const pk = String(r.pk ?? "");
  const sk = String(r.sk ?? "");
  if (sk === "POINTER")
    return pk.startsWith("PHONE#")
      ? { label: "phone", tone: "var(--warn)" }
      : { label: "instagram", tone: "var(--warn)" };
  if (sk === "PROFILE") return { label: "prospect", tone: "var(--accent)" };
  if (sk.startsWith("EVT#")) return { label: "call", tone: "var(--ok)" };
  return { label: "row", tone: "var(--muted)" };
}

/** Columns worth a place, in a stable order. Noise stays in the row detail. */
function columnsFor(rows: Record<string, unknown>[]): string[] {
  const present = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) present.add(k);
  // Order matters: score sits next to the followers it was derived from, so
  // an odd ranking can be read off the row rather than guessed at.
  const preferred = [
    "pk", "sk", "businessName", "score", "followers", "phone", "city",
    "status", "followUpDue", "at", "by", "outcome", "notes", "prospectId",
    "open", "won", "lost",
  ];
  const ordered = preferred.filter((k) => present.has(k));
  const rest = [...present].filter(
    (k) =>
      !preferred.includes(k) &&
      !["gsiEvt", "followUpSort", "createdAt", "updatedAt", "instagramUrl"].includes(k),
  );
  return [...ordered, ...rest].slice(0, 10);
}

export function Database() {
  const [q, setQ] = useState("tray");
  const [value, setValue] = useState("new");
  const [limit, setLimit] = useState(50);
  const [filter, setFilter] = useState("");
  const [using, setUsing] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [table, setTable] = useState<TableShape | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = QUERIES.find((x) => x.id === q)!;

  async function run(overrides?: { q?: string; value?: string; limit?: number }) {
    const qq = overrides?.q ?? q;
    const vv = overrides?.value ?? value;
    const ll = overrides?.limit ?? limit;
    setBusy(true);
    setError(null);
    try {
      const r = await api.crmQuery(qq, vv, ll);
      setUsing(r.using);
      setRows(r.rows);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void run();
  }, []);

  // Schema is reference material — fetched only when someone opens it.
  useEffect(() => {
    if (schemaOpen && !table) api.crmTable(1).then(setTable).catch(() => {});
  }, [schemaOpen]);

  function pickQuery(id: string) {
    const next = QUERIES.find((x) => x.id === id)!;
    const v = next.field === "tray" ? "new" : "";
    setQ(id);
    setValue(v);
    setRows([]);
    setUsing("");
    if (next.field === "none" || next.field === "tray") void run({ q: id, value: v });
  }

  const shown = filter.trim()
    ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(filter.trim().toLowerCase()))
    : rows;
  const cols = columnsFor(shown);

  const cell = (v: unknown) =>
    v === undefined || v === null || v === "" ? "—" : String(v);

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
      {/* ---- schema, collapsed by default ---- */}
      <div style={{ borderBottom: "1px solid var(--border)", padding: "10px 16px" }}>
        <button
          onClick={() => setSchemaOpen((s) => !s)}
          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, fontSize: 13 }}
        >
          {schemaOpen ? "▾" : "▸"} Schema
        </button>
        <span className="hint" style={{ marginLeft: 12 }}>
          <code>nine-square-crm-v2</code>
        </span>
        {schemaOpen && table && (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr><th>Index</th><th>Partition key</th><th>Sort key</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>(base table)</td>
                  <td><code>{table.partitionKey}</code></td>
                  <td><code>{table.sortKey}</code></td>
                </tr>
                {table.indexes.map((i) => (
                  <tr key={i.name}>
                    <td><code>{i.name}</code></td>
                    <td><code>{i.partitionKey}</code></td>
                    <td>{i.sortKey ? <code>{i.sortKey}</code> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- one toolbar ---- */}
      <div
        className="row"
        style={{ padding: "12px 16px", gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--border)" }}
      >
        <select value={q} onChange={(e) => pickQuery(e.target.value)} style={{ minWidth: 190 }}>
          {QUERIES.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>

        {query.field === "text" && (
          <input
            placeholder={query.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            style={{ minWidth: 170 }}
          />
        )}
        {query.field === "tray" && (
          <select value={value || "new"} onChange={(e) => { setValue(e.target.value); void run({ value: e.target.value }); }}>
            <option value="new">New</option>
            <option value="open">Live</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
        )}
        {query.field === "date" && (
          <input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
        )}
        {query.field === "days" && (
          <input type="number" placeholder="7" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 80 }} />
        )}

        <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); void run({ limit: Number(e.target.value) }); }}>
          {[20, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>

        <button className="primary" onClick={() => run()} disabled={busy}>
          {busy ? "…" : "Run"}
        </button>

        <input
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ minWidth: 150, marginLeft: "auto" }}
        />
      </div>

      {/* ---- result summary: count, and which index answered ---- */}
      <div
        className="hint"
        style={{ padding: "6px 16px", margin: 0, display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}
      >
        <span>
          {shown.length}
          {shown.length !== rows.length && ` of ${rows.length}`} row{shown.length === 1 ? "" : "s"}
          {rows.length >= limit && " · limit reached"}
        </span>
        {using && <code style={{ fontSize: 11 }}>{using}</code>}
      </div>

      {error && <div className="hint" style={{ padding: "0 16px 12px", color: "var(--bad)" }}>❌ {error}</div>}

      {!error && !shown.length && !busy && (
        <div className="hint" style={{ padding: "24px 16px" }}>
          No rows{query.field === "text" ? " — enter a value and press Run." : "."}
        </div>
      )}

      {/* ---- the data ---- */}
      {shown.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 86 }}>type</th>
                {cols.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const t = rowType(r);
                return (
                  <tr
                    key={`${r.pk}|${r.sk}|${i}`}
                    onClick={() => setDetail(r)}
                    style={{ cursor: "pointer" }}
                    title="Show stored JSON"
                  >
                    <td>
                      <span style={{ color: t.tone, fontSize: 11, whiteSpace: "nowrap" }}>● {t.label}</span>
                    </td>
                    {cols.map((c) => {
                      const raw = r[c];
                      const text = cell(raw);
                      const mono = ["pk", "sk", "phone", "prospectId"].includes(c);
                      // Numbers right-align so magnitudes line up down the column.
                      const numeric = typeof raw === "number";
                      return (
                        <td
                          key={c}
                          title={text.length > 36 ? text : undefined}
                          style={numeric ? { textAlign: "right", fontVariantNumeric: "tabular-nums" } : undefined}
                        >
                          {mono ? (
                            <code>{text}</code>
                          ) : numeric ? (
                            (raw as number).toLocaleString("en-IN")
                          ) : text.length > 48 ? (
                            text.slice(0, 48) + "…"
                          ) : (
                            text
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- row detail, as a drawer so the list never shifts ---- */}
      {detail && (
        <Fragment>
          <div
            onClick={() => setDetail(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 40 }}
          />
          <aside
            style={{
              position: "fixed", top: 0, right: 0, bottom: 0, width: "min(460px, 92vw)",
              background: "var(--panel)", borderLeft: "1px solid var(--border)",
              zIndex: 41, padding: 18, overflowY: "auto",
            }}
          >
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <b>{String(detail.businessName ?? detail.sk ?? "Row")}</b>
              <button
                onClick={() => setDetail(null)}
                style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 18 }}
              >
                ✕
              </button>
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              Stored as separate named attributes, not one JSON blob.
            </div>
            <pre style={{ marginTop: 12, fontSize: 12, lineHeight: 1.55, overflowX: "auto" }}>
              <code>{JSON.stringify(detail, null, 2)}</code>
            </pre>
          </aside>
        </Fragment>
      )}
    </div>
  );
}
