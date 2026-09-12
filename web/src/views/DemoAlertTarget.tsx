import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "../api";

/**
 * Demo mode — point this client's alerts at the prospect's own phone.
 *
 * The whole pitch lands when THEIR phone buzzes, not yours. Telegram won't let
 * a bot message someone who hasn't contacted it first, so the prospect has to
 * make first contact — the QR makes that a two-second scan instead of a
 * fumble, and binding their chat is then one click.
 *
 * Deliberately reversible: "Send alerts back to me" restores the original chat
 * so the next demo starts clean and you don't leave a prospect wired up to a
 * live client's leads.
 */
export function DemoAlertTarget({
  profileId,
  businessName,
  isDemo,
  onBound,
}: {
  profileId: string;
  businessName: string;
  /** Only a throwaway demo profile is safe to re-point without warning. */
  isDemo?: boolean;
  onBound?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [botLink, setBotLink] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [chats, setChats] = useState<{ chatId: string; name: string; type: string }[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | undefined>();
  const [originalChatId, setOriginalChatId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh(quiet = false) {
    setBusy(true);
    if (!quiet) setMsg(null);
    try {
      const r = await api.telegramChats(profileId);
      setBotLink(r.botLink);
      setChats(r.chats);
      setCurrentChatId(r.currentChatId);
      // Remember where alerts pointed before the demo, so it can be undone.
      setOriginalChatId((prev) => prev ?? r.currentChatId);
      if (r.botLink) setQr(await QRCode.toDataURL(r.botLink, { margin: 1, width: 220 }));
      if (r.error) setMsg(`❌ ${r.error}`);
      else if (!quiet && !r.chats.length) {
        setMsg("Nobody has messaged the bot yet — have them scan the code and tap Start.");
      }
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void refresh();

    // Re-check every few seconds while open, so the prospect appears on their
    // own without anyone reaching for the keyboard mid-demo.
    //
    // Bounded on purpose. Each tick calls Telegram's getUpdates, and an
    // unbounded interval left open in a forgotten tab made hundreds of
    // pointless calls. Five minutes is longer than any real demo needs, and
    // "Refresh" starts it again.
    //
    // Deliberately NOT gated on document.hidden: some embedded browsers report
    // the page as hidden even while it is on screen, which would leave the
    // prospect's name never appearing — a silent failure right in the middle
    // of a demo. A bounded poll is the safer trade.
    let ticks = 0;
    const MAX_TICKS = 75; // 75 x 4s = 5 minutes
    const t = setInterval(() => {
      if (++ticks > MAX_TICKS) {
        clearInterval(t);
        setMsg("Stopped checking after 5 minutes — press Refresh to look again.");
        return;
      }
      void refresh(true);
    }, 4000);

    return () => clearInterval(t);
  }, [open, profileId]);

  async function bind(chatId: string, label: string) {
    setBusy(true);
    setMsg(null);
    try {
      await api.setProfileTelegram(profileId, { chatId });
      setCurrentChatId(chatId);
      await api.testProfileTelegram(profileId);
      setMsg(`Alerts now go to ${label} — a test message just landed on their phone.`);
      onBound?.();
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="primary" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
        🎯 Demo mode — buzz the prospect's phone
      </button>
    );
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="lbl">Demo mode — {businessName}</div>
      {!isDemo && (
        <div
          className="hint"
          style={{ color: "var(--bad)", border: "1px solid var(--bad)", borderRadius: 6, padding: 8, marginTop: 6 }}
        >
          ⚠️ <b>This is not a demo profile.</b> Re-pointing alerts here sends {businessName}'s
          real leads to the prospect's phone until you undo it. Use your demo line instead.
        </div>
      )}
      <div className="hint" style={{ marginTop: 0 }}>
        Have the prospect scan this, tap <b>Start</b>, then pick them below. The next
        call's alert lands on their phone instead of yours.
      </div>

      <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap", marginTop: 12 }}>
        {qr && (
          <img
            src={qr}
            alt="Scan to open the Telegram bot"
            style={{ width: 180, height: 180, borderRadius: 8, background: "#fff", padding: 6 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 240 }}>
          {botLink && (
            <div className="hint" style={{ marginTop: 0 }}>
              or send them: <code>{botLink}</code>
            </div>
          )}

          <div className="lbl" style={{ marginTop: 10 }}>
            Who's messaged the bot {busy ? "· checking…" : ""}
          </div>
          {chats.length === 0 && <div className="hint">Waiting for someone to tap Start…</div>}
          {chats.map((c) => (
            <div key={c.chatId} className="row" style={{ marginBottom: 6, alignItems: "center" }}>
              <button
                className="primary"
                disabled={busy || c.chatId === currentChatId}
                onClick={() => bind(c.chatId, c.name)}
              >
                {c.chatId === currentChatId ? "✓ Receiving" : "Send alerts here"}
              </button>
              <span>
                {c.name} <span className="hint">({c.type})</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {msg && (
        <div className="hint" style={{ color: msg.startsWith("❌") ? "var(--bad)" : "var(--ok)" }}>
          {msg.startsWith("❌") ? msg : `✅ ${msg}`}
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={() => void refresh()} disabled={busy}>
          Refresh
        </button>
        {originalChatId && originalChatId !== currentChatId && (
          <button className="primary" onClick={() => bind(originalChatId, "you")} disabled={busy}>
            ↩️ Send alerts back to me
          </button>
        )}
        <button className="primary" style={{ background: "var(--panel-2)" }} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      <div className="hint">
        Remember to switch alerts back after the demo — otherwise this client's real
        leads keep going to the prospect's phone.
      </div>
    </div>
  );
}
