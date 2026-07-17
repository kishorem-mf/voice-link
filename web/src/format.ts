/** Formatting helpers shared across views. */

export function fmtDuration(secs?: number): string {
  if (!secs || secs <= 0) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

export function fmtTimeIST(unixSecs?: number): string {
  if (!unixSecs) return "—";
  return new Date(unixSecs * 1000).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function fmtTimeISOToIST(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Map a call status to a badge kind for coloring. */
export function statusKind(status: string): "ok" | "bad" | "warn" | "neutral" {
  const s = status.toLowerCase();
  if (s === "done" || s === "connected" || s === "success") return "ok";
  if (s === "failed" || s === "declined") return "bad";
  if (s === "in-progress" || s === "processing" || s === "initiated") return "warn";
  return "neutral";
}
