import { useEffect, useRef, useState } from "react";
import { api, type ConversationDetail } from "../api";
import { fmtDuration, statusKind } from "../format";

type Phase = "idle" | "placing" | "live" | "ended" | "error";

export function MakeCall() {
  const [number, setNumber] = useState("+91");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string>("");
  const [convId, setConvId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const active = phase === "placing" || phase === "live";
  const validE164 = /^\+[1-9]\d{7,14}$/.test(number.trim());

  // Poll the conversation while a call is live.
  useEffect(() => {
    if (phase !== "live" || !convId) return;
    poll.current = setInterval(async () => {
      try {
        const d = await api.conversation(convId);
        setDetail(d);
        if (d.status === "done" || d.status === "failed") {
          setPhase("ended");
        }
      } catch {
        /* keep polling; transient */
      }
    }, 3000);
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [phase, convId]);

  async function submit() {
    setPhase("placing");
    setMessage("");
    setDetail(null);
    setConvId(null);
    try {
      const res = await api.call(number.trim());
      setMessage(res.message || "Call accepted");
      if (res.conversationId) {
        setConvId(res.conversationId);
        setPhase("live");
      } else {
        setPhase("ended");
      }
    } catch (e) {
      setMessage((e as Error).message);
      setPhase("error");
    }
  }

  return (
    <div className="panel">
      <h2>Place an outbound call</h2>
      <div className="row">
        <div style={{ flex: 1, minWidth: 220 }}>
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="+917842160862"
            disabled={active}
          />
        </div>
        <button className="primary" onClick={submit} disabled={active || !validE164}>
          {active ? "Calling…" : "Call"}
        </button>
      </div>
      <div className="hint">
        Enter an E.164 number (e.g. <code>+917842160862</code>). Only one call at a
        time — the trunk has a single channel.
      </div>

      {phase !== "idle" && (
        <div style={{ marginTop: 18 }}>
          {phase === "error" && <div className="error">❌ {message}</div>}
          {phase === "placing" && <div className="spinner">Placing call…</div>}
          {(phase === "live" || phase === "ended") && (
            <div>
              <div className="row">
                <span
                  className={`badge ${statusKind(detail?.status ?? (phase === "live" ? "in-progress" : "unknown"))}`}
                >
                  {detail?.status ?? "in-progress"}
                </span>
                {detail && detail.durationSecs > 0 && (
                  <span className="muted">{fmtDuration(detail.durationSecs)}</span>
                )}
                {convId && <span className="muted">· {convId}</span>}
              </div>
              {message && <div className="hint">{message}</div>}
              {phase === "live" && (
                <div className="hint">Live — refreshing status every 3s…</div>
              )}
              {phase === "ended" && detail && detail.transcript.length > 0 && (
                <div className="transcript">
                  {detail.transcript.map((t, i) => (
                    <div key={i} className={`turn ${t.role === "user" ? "user" : "agent"}`}>
                      <div className="role">{t.role}</div>
                      {t.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
