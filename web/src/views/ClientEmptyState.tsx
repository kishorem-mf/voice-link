import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * The active client's trading name, for views that show that client's data.
 *
 * Every call list is filtered to the selected client's agents, so a freshly
 * added client legitimately has nothing to show. Without naming them, an empty
 * screen reads as "the data is gone" rather than "this client has no calls
 * yet" — which is exactly how it was misread in practice.
 */
export function useActiveClient(): { name: string; isDemo: boolean } | null {
  const [client, setClient] = useState<{ name: string; isDemo: boolean } | null>(null);
  useEffect(() => {
    api
      .config()
      .then((c) => setClient({ name: c.businessName || c.profileName || "this client", isDemo: Boolean(c.isDemo) }))
      .catch(() => setClient(null));
  }, []);
  return client;
}

/**
 * Shown instead of a blank panel or a wall of zeros. Says whose data is being
 * shown, that nothing is lost, and where another client's calls went.
 */
export function ClientEmptyState({
  what = "calls",
  hint,
}: {
  /** What's missing, e.g. "calls", "completed calls", "logged outcomes". */
  what?: string;
  hint?: string;
}) {
  const client = useActiveClient();
  const name = client?.name;

  return (
    <div className="panel" style={{ textAlign: "center", padding: "34px 20px" }}>
      <div style={{ fontSize: 30, marginBottom: 10 }}>📭</div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        {name ? `No ${what} yet for ${name}` : `No ${what} yet`}
      </div>
      <div className="hint" style={{ maxWidth: 460, margin: "0 auto" }}>
        {hint ??
          "Nothing has been lost — every tab shows only the client selected in Settings. " +
            "Another client's calls are still there; switch to them in Settings → Client."}
      </div>
    </div>
  );
}

/** A small line naming whose data is on screen. */
export function ClientBadge() {
  const client = useActiveClient();
  if (!client) return null;
  return (
    <div className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
      Showing {client.isDemo ? "🎯 " : ""}
      <b>{client.name}</b> — switch client in Settings.
    </div>
  );
}
