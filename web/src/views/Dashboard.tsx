import { useEffect, useState } from "react";
import { api, type Stats } from "../api";
import { fmtDuration } from "../format";

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="panel error">Failed to load stats: {error}</div>;
  if (!stats) return <div className="panel spinner">Loading stats…</div>;

  const tiles = [
    { label: "Total calls", value: String(stats.totalConversations) },
    { label: "Completed", value: String(stats.completed) },
    { label: "Success rate", value: `${stats.successRate}%` },
    { label: "Avg duration", value: fmtDuration(stats.avgDurationSecs) },
    { label: "Calls today", value: String(stats.callsToday) },
    { label: "Logged outcomes", value: String(stats.loggedOutcomes) },
  ];

  return (
    <div>
      <div className="stats">
        {tiles.map((t) => (
          <div className="stat" key={t.label}>
            <div className="value">{t.value}</div>
            <div className="label">{t.label}</div>
          </div>
        ))}
      </div>
      <p className="hint">
        Totals are computed from the last 100 Retell calls plus the local
        outcomes log. Success rate = completed ÷ total.
      </p>
    </div>
  );
}
