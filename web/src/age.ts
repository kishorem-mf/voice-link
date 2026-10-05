/**
 * Dates read as ages.
 *
 * "20d" answers the question actually being asked — is this going stale? — at
 * a glance, where a date has to be subtracted from today first. The exact
 * moment stays available on hover, via exact().
 *
 * Shared by the Database tab and the Prospects tab so the two never drift:
 * the same prospect must not read "7d" on one screen and "6d" on the other.
 */

export function age(iso: unknown): string {
  if (iso === undefined || iso === null || iso === "") return "—";
  const t = Date.parse(String(iso));
  if (Number.isNaN(t)) return "—";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

/** Full timestamp for a hover, in local time — stored values are UTC. */
export function exact(iso: unknown): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(String(iso));
  return Number.isNaN(t) ? undefined : new Date(t).toLocaleString();
}

/** A follow-up date as an age, so it sits in the same units as everything else. */
export function dueAge(iso: unknown): { text: string; overdue: boolean } {
  if (!iso) return { text: "—", overdue: false };
  const t = Date.parse(`${String(iso)}T00:00:00`);
  if (Number.isNaN(t)) return { text: String(iso), overdue: false };
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days > 0) return { text: `${days}d ago`, overdue: true };
  if (days === 0) return { text: "today", overdue: true };
  return { text: `in ${Math.abs(days)}d`, overdue: false };
}
