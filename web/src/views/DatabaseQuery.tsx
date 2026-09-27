import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * Query picker over the CRM table, modelled on the youtube-summarizer's
 * dynamo explorer.
 *
 * Every option reports which key or index answered it, because the point of
 * this view is to make the table's shape legible — seeing that a phone lookup
 * needs no index, while "who do I call today" uses status-index, explains the
 * design better than a schema diagram.
 */

type Field = "none" | "text" | "tray" | "date" | "days";

const QUERIES: { id: string; label: string; field: Field; placeholder?: string; hint: string }[] = [
  { id: "browse", label: "Q0 — Browse every row", field: "none", hint: "Reads the whole table, pointer rows included." },
  { id: "by_phone", label: "Q1 — Find by phone number", field: "text", placeholder: "7842160862", hint: "What Sara does on every incoming call." },
  { id: "by_instagram", label: "Q2 — Find by Instagram handle", field: "text", placeholder: "@glowstudio", hint: "Used to dedupe a scraped import." },
  { id: "history", label: "Q3 — A prospect + full history", field: "text", placeholder: "MU09GBVONWWFIE", hint: "Profile and every call, in one request." },
  { id: "tray", label: "Q4 — Prospects by tray", field: "tray", hint: "Live / won / lost." },
  { id: "due", label: "Q5 — Due for follow-up", field: "date", hint: "Who to call, on or before a date." },
  { id: "activity", label: "Q6 — Activity across all prospects", field: "days", placeholder: "7", hint: "What did I do this week." },
  { id: "pipeline", label: "Q7 — Pipeline counts", field: "none", hint: "How many at each stage." },
];

/** Columns worth showing, by what kind of row came back. */
function columnsFor(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
  const preferred = [
    "pk", "sk", "businessName", "phone", "instagramUrl", "status", "followUpDue",
    "prospectId", "at", "by", "outcome", "notes", "open", "won", "lost",
  ];
  const ordered = preferred.filter((k) => keys.has(k));
  const rest = [...keys].filter((k) => !preferred.includes(k) && !k.startsWith("gsi") && k !== "followUpSort");
  return [...ordered, ...rest];
}

export function DatabaseQuery() {
  const [q, setQ] = useState("browse");
  const [value, setValue] = useState("");
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(20);
  const [using, setUsing] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = QUERIES.find((x) => x.id === q)!;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.crmQuery(q, value, limit);
      setUsing(r.using);
      setRows(r.rows);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    } finally {
      setBusy(false);
    }
  }

  // Re-run when the query changes; fields that need a value wait for Run.
  useEffect(() => {
    setValue("");
    if (QUERIES.find((x) => x.id === q)!.field === "none") void run();
    else setRows([]);
  }, [q]);

  // Changing the limit re-runs a query that needs no input.
  useEffect(() => {
    if (query.field === "none" && rows.length) void run();
  }, [limit]);

  // Free-text filter applied to whatever came back, so it works for any query.
  const shown = filter.trim()
    ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(filter.trim().toLowerCase()))
    : rows;
  const cols = columnsFor(shown);

  return (
    <div className="panel">
      <h2>Query the table</h2>
      <div className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
        Each query reports which key or index answered it.
      </div>

      <div className="row" style={{ marginBottom: 8, flexWrap: "wrap" }}>
        <select value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 300 }}>
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
            style={{ minWidth: 220 }}
          />
        )}
        {query.field === "tray" && (
          <select value={value || "open"} onChange={(e) => setValue(e.target.value)}>
            <option value="open">Live</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
        )}
        {query.field === "date" && (
          <input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
        )}
        {query.field === "days" && (
          <input
            type="number"
            placeholder="7"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{ width: 90 }}
          />
        )}

        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} title="Row limit">
          {[10, 20, 50, 100].map((n) => (
            <option key={n} value={n}>last {n}</option>
          ))}
        </select>

        <button className="primary" onClick={run} disabled={busy}>
          {busy ? "Running…" : "Run"}
        </button>
      </div>

      <div className="hint" style={{ marginTop: 0 }}>{query.hint}</div>

      {using && (
        <div className="hint" style={{ marginTop: 10 }}>
          <b>How it was answered:</b> <code>{using}</code>
        </div>
      )}

      <div className="row" style={{ marginTop: 14, marginBottom: 8 }}>
        <input
          placeholder="Filter these results…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <span className="hint">
          {shown.length} of {rows.length} row{rows.length === 1 ? "" : "s"}
          {rows.length >= limit && " — limit reached, raise it to see more"}
        </span>
      </div>

      {error && <div className="hint" style={{ color: "var(--bad)" }}>❌ {error}</div>}

      {shown.length === 0 && !error && !busy && (
        <div className="hint">No rows. {query.field !== "none" && "Enter a value and press Run."}</div>
      )}

      {shown.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={String(r.pk ?? "") + String(r.sk ?? "") + i}>
                  {cols.map((c) => {
                    const v = r[c];
                    const text = v === undefined || v === null ? "—" : String(v);
                    const mono = c === "pk" || c === "sk" || c === "prospectId" || c === "phone";
                    return (
                      <td key={c} title={text.length > 40 ? text : undefined}>
                        {mono ? <code>{text}</code> : text.length > 60 ? text.slice(0, 60) + "…" : text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
