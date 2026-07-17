import { useEffect, useState } from "react";
import { api, type AppConfig } from "./api";
import { Dashboard } from "./views/Dashboard";
import { MakeCall } from "./views/MakeCall";
import { CallLogs } from "./views/CallLogs";
import { CompletedCalls } from "./views/CompletedCalls";
import { Settings } from "./views/Settings";

type Tab = "dashboard" | "call" | "logs" | "completed" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "call", label: "Make a Call" },
  { id: "logs", label: "Call Logs" },
  { id: "completed", label: "Completed Calls" },
  { id: "settings", label: "Settings" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    api.config().then(setConfig).catch(() => setConfig(null));
  }, []);

  return (
    <div className="app">
      <div className="header">
        <div>
          <h1>📞 VoiceLink — Outbound AI Calling</h1>
          <div className="sub">Console for the Retell + VoiceLink calling harness</div>
        </div>
        {config && (
          <div className="meta">
            <div>Agent: <code>{config.agentId}</code></div>
            <div>Number: <code>{config.phoneNumberId}</code></div>
            <div>Endpoint: <code>{config.baseUrl.replace("https://", "")}</code></div>
          </div>
        )}
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <Dashboard />}
      {tab === "call" && <MakeCall />}
      {tab === "logs" && <CallLogs />}
      {tab === "completed" && <CompletedCalls />}
      {tab === "settings" && <Settings />}
    </div>
  );
}
