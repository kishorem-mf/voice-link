/**
 * Instagram handle display.
 *
 * Stored as a full URL, shown as "@handle" — the compact form is what is
 * recognisable at a glance, while the link is what you want before a call.
 */
export function handleOf(url: unknown): string | null {
  if (!url) return null;
  const h = String(url)
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/^@/, "");
  return h ? `@${h}` : null;
}

/** A full profile URL, whether a handle or a URL was stored. */
export function profileUrl(url: unknown): string | null {
  const h = handleOf(url);
  return h ? `https://instagram.com/${h.slice(1)}` : null;
}
