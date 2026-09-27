import { useEffect, useState } from "react";
import { api, type TableShape } from "../api";
import { DatabaseQuery } from "./DatabaseQuery";

/**
 * A window onto the raw DynamoDB table.
 *
 * Exists to make the single-table design legible: three row types share one
 * table and are told apart by the `pk` prefix, which is hard to picture from
 * a schema description alone. Not part of the CRM workflow — it reads every
 * row, including the POINTER rows no ordinary query returns.
 */

/** Classify a row by its key prefix — the same way the store does. */
function rowKind(pk: string, sk: string) {
  if (sk === "POINTER")
    return { label: pk.startsWith("PHONE#") ? "phone card" : "instagram card", tone: "#f0b429" };
  if (sk === "PROFILE") return { label: "prospect", tone: "#4c9aff" };
  if (sk.startsWith("EVT#")) return { label: "call", tone: "#57d9a3" };
  return { label: "other", tone: "#8993a4" };
}

/** Show a row's meaningful fields without dumping raw JSON at the reader. */
function summarise(r: Record<string, unknown>): string {
  const sk = String(r.sk ?? "");
  if (sk === "POINTER") return `→ ${r.prospectId}`;
  if (sk === "PROFILE")
    return [
      r.businessName,
      r.phone ? `☎ ${r.phone}` : null,
      r.instagramUrl ? `ig ${r.instagramUrl}` : null,
      `status=${r.status ?? "—"}`,
      r.followUpDue ? `due ${r.followUpDue}` : null,
    ]
      .filter(Boolean)
      .join("  ·  ");
  return [r.outcome, r.by ? `by ${r.by}` : null, r.notes ? `“${r.notes}”` : null]
    .filter(Boolean)
    .join("  ·  ");
}

export function Database() {
  const [table, setTable] = useState<TableShape | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [limit, setLimit] = useState(20);

  function load(n = limit) {
    setError(null);
    api.crmTable(n).then(setTable).catch((e) => setError(e.message));
  }
  useEffect(() => load(limit), [limit]);

  if (error)
    return (
      <div className="panel error">
        Couldn’t read the table: {error}
      </div>
    );
  if (!table) return <div className="panel spinner">Reading DynamoDB…</div>;

  const groups = [
    { key: "prospect", title: "Prospects", hint: "one row per business" },
    { key: "call", title: "Calls", hint: "filed under the prospect they belong to" },
    { key: "phone card", title: "Phone cards", hint: "phone number → which prospect" },
    { key: "instagram card", title: "Instagram cards", hint: "handle → which prospect" },
  ];

  return (
    <div>
      <div className="panel">
        <h2>Database</h2>
        <div className="hint" style={{ marginTop: 0 }}>
          The live CRM table. Everything lives in one table — three kinds of row,
          told apart by how the first column starts.
        </div>

        <div className="row" style={{ gap: 28, marginTop: 14, flexWrap: "wrap" }}>
          <div>
            <div className="lbl">Table</div>
            <code>{table.name}</code> <span className="hint">({table.region})</span>
          </div>
          <div>
            <div className="lbl">Column 1 — which folder</div>
            <code>{table.partitionKey}</code>
          </div>
          <div>
            <div className="lbl">Column 2 — what’s in it</div>
            <code>{table.sortKey}</code>
          </div>
          <div>
            <div className="lbl">Rows shown</div>
            <b>{table.itemCount}</b>{" "}
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              style={{ marginLeft: 6 }}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>last {n}</option>
              ))}
            </select>
            {table.truncated && (
              <div className="hint" style={{ marginTop: 4 }}>more rows exist</div>
            )}
          </div>
        </div>

        <div className="lbl" style={{ marginTop: 20 }}>Lookup copies (indexes)</div>
        <div className="hint" style={{ marginTop: 0 }}>
          Extra orderings DynamoDB keeps for you, so common questions don’t need
          to read the whole table.
        </div>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr><th>Index</th><th>Grouped by</th><th>Sorted by</th><th>Answers</th></tr>
            </thead>
            <tbody>
              {table.indexes.map((i) => (
                <tr key={i.name}>
                  <td><code>{i.name}</code></td>
                  <td><code>{i.partitionKey}</code></td>
                  <td>{i.sortKey ? <code>{i.sortKey}</code> : "—"}</td>
                  <td className="hint">
                    {i.name.startsWith("status")
                      ? "who to call today · all live prospects · count per stage"
                      : "what did I do this week"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <DatabaseQuery />

      {groups.map((g) => {
        const rows = table.rows.filter(
          (r) => rowKind(String(r.pk), String(r.sk)).label === g.key,
        );
        if (!rows.length) return null;
        return (
          <div className="panel" key={g.key}>
            <h2>
              {g.title} <span className="hint" style={{ fontWeight: 400 }}>· {rows.length}</span>
            </h2>
            <div className="hint" style={{ marginTop: 0, marginBottom: 10 }}>{g.hint}</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "26%" }}>Column 1 ({table.partitionKey})</th>
                    <th style={{ width: "24%" }}>Column 2 ({table.sortKey})</th>
                    <th>Contents</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const kind = rowKind(String(r.pk), String(r.sk));
                    return (
                      <tr key={`${r.pk}|${r.sk}`}>
                        <td>
                          <code style={{ color: kind.tone }}>{String(r.pk)}</code>
                        </td>
                        <td><code>{String(r.sk)}</code></td>
                        <td>{summarise(r)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div className="panel">
        <div className="hint" style={{ marginTop: 0 }}>
          Notice the prospect rows and their calls share the same Column 1 — that’s
          what lets one request fetch a business and its whole history together.
          The cards use a different Column 1 (the phone number or handle) and hold
          nothing but which prospect they point at.
        </div>
        <button className="primary" style={{ marginTop: 10 }} onClick={() => load()}>
          Refresh
        </button>
      </div>
    </div>
  );
}
