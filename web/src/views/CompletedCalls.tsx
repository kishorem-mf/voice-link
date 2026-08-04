import { useEffect, useMemo, useState } from "react";
import { api, type ConversationSummary, type ConversationDetail } from "../api";
import { fmtDuration, fmtTimeIST, statusKind } from "../format";

export function CompletedCalls() {
  const [list, setList] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api.conversations().then(setList).catch((e) => setError(e.message));
  }, []);

  const statuses = useMemo(() => {
    const set = new Set((list ?? []).map((c) => c.status));
    return ["all", ...Array.from(set)];
  }, [list]);

  const filtered = useMemo(
    () =>
      (list ?? []).filter((c) => {
        const q = !query || c.conversationId.includes(query);
        const s = status === "all" || c.status === status;
        return q && s;
      }),
    [list, query, status],
  );

  if (error) return <div className="panel error">Failed to load conversations: {error}</div>;
  if (selected) return <Detail id={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="panel">
      <h2>Completed calls ({filtered.length})</h2>
      <div className="row" style={{ marginBottom: 14 }}>
        <input
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Search conversation id…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {!list ? (
        <div className="spinner">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="muted">No conversations found.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Started (IST)</th>
                <th>Direction</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Messages</th>
                <th>Conversation</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.conversationId}
                  className="clickable"
                  onClick={() => setSelected(c.conversationId)}
                >
                  <td>{fmtTimeIST(c.startUnix)}</td>
                  <td>
                    <span className="badge neutral">
                      {c.direction === "inbound" ? "📥 Inbound" : c.direction === "outbound" ? "📤 Outbound" : "—"}
                    </span>
                  </td>
                  <td><span className={`badge ${statusKind(c.status)}`}>{c.status}</span></td>
                  <td>{fmtDuration(c.durationSecs)}</td>
                  <td>{c.messageCount || "—"}</td>
                  <td className="muted">{c.conversationId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.conversation(id).then(setDetail).catch((e) => setError(e.message));
  }, [id]);

  return (
    <div className="panel">
      <button className="back" onClick={onBack}>← Back to list</button>
      {error && <div className="error">Failed to load: {error}</div>}
      {!detail ? (
        <div className="spinner">Loading conversation…</div>
      ) : (
        <div>
          <h2>Conversation</h2>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className={`badge ${statusKind(detail.status)}`}>{detail.status}</span>
            <span className="muted">{fmtDuration(detail.durationSecs)}</span>
            {detail.direction && <span className="muted">· {detail.direction}</span>}
            {detail.toNumber && <span className="muted">· {detail.toNumber}</span>}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>{detail.conversationId}</div>

          {detail.durationSecs > 0 && (
            <audio controls preload="none" src={api.audioUrl(detail.conversationId)} />
          )}

          {detail.transcript.length > 0 ? (
            <div className="transcript">
              {detail.transcript.map((t, i) => (
                <div key={i} className={`turn ${t.role === "user" ? "user" : "agent"}`}>
                  <div className="role">{t.role}</div>
                  {t.message}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 14 }}>
              No transcript (call did not connect).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
