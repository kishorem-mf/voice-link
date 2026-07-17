import { useEffect, useMemo, useState } from "react";
import { api, type LoggedOutcome } from "../api";
import { fmtDuration, fmtTimeISOToIST, statusKind } from "../format";

export function CallLogs() {
  const [logs, setLogs] = useState<LoggedOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");

  useEffect(() => {
    api.logs().then(setLogs).catch((e) => setError(e.message));
  }, []);

  const statuses = useMemo(() => {
    const set = new Set((logs ?? []).map((l) => l.status));
    return ["all", ...Array.from(set)];
  }, [logs]);

  const filtered = useMemo(() => {
    return (logs ?? []).filter((l) => {
      const matchesQuery =
        !query ||
        (l.toNumber ?? "").includes(query) ||
        (l.conversationId ?? "").includes(query) ||
        (l.disposition ?? "").toLowerCase().includes(query.toLowerCase());
      const matchesStatus = status === "all" || l.status === status;
      return matchesQuery && matchesStatus;
    });
  }, [logs, query, status]);

  if (error) return <div className="panel error">Failed to load logs: {error}</div>;

  return (
    <div className="panel">
      <h2>Call logs ({filtered.length})</h2>
      <div className="row" style={{ marginBottom: 14 }}>
        <input
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Search number, id, or disposition…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {!logs ? (
        <div className="spinner">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="muted">
          No logged outcomes yet. These arrive via the post-call webhook
          (<code>POST /webhook/call</code>).
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time (IST)</th>
                <th>Number</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Disposition</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l, i) => (
                <tr key={i}>
                  <td>{fmtTimeISOToIST(l.loggedAt)}</td>
                  <td>{l.toNumber ?? "—"}</td>
                  <td><span className={`badge ${statusKind(l.status)}`}>{l.status}</span></td>
                  <td>{fmtDuration(l.durationSecs)}</td>
                  <td>{l.disposition ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
