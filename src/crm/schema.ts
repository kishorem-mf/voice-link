/**
 * CRM item shapes and the values the UI offers.
 *
 * One prospect = one record, with a timeline of events beneath it. Events come
 * from two places — logged by hand after a call the operator made personally,
 * or written by Sara when a VoiceLink call ends — and are identical in shape
 * apart from `by`. See docs/crm-plan.md.
 */

import type { BusinessModel } from "./score.js";

/** Who created an event. The distinction is the point, not a detail. */
export type EventBy = "me" | "sara";

/**
 * Which tray a prospect sits in.
 *
 * `new` holds scraped leads nobody has spoken to yet, ranked best-first; the
 * first call logged against one moves it to `open`. Only `open` prospects
 * appear in the daily call list — once a deal is won or lost they drop out
 * automatically, rather than being filtered by eye forever.
 */
export type ProspectStatus = "new" | "open" | "won" | "lost";

export const STATUSES: { id: ProspectStatus; label: string }[] = [
  { id: "new", label: "New" },
  { id: "open", label: "Live" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

export interface Prospect {
  prospectId: string;
  businessName: string;
  /** E.164. Optional: prospects often arrive from Instagram with no number. */
  phone?: string;
  instagramUrl?: string;
  /** One of the trades in business-types.ts, when known. */
  businessType?: string;
  status: ProspectStatus;
  /** ISO date (YYYY-MM-DD) the next follow-up is due. */
  followUpDue?: string;
  /**
   * When this prospect first became live — set once, on the `new` -> `open`
   * transition. Distinct from createdAt, which for an imported lead records
   * the import rather than first contact.
   */
  openedAt?: string;
  lastContactedAt?: string;
  notes?: string;
  /** Present when the only contact a lead gave is an email address. */
  email?: string;

  // Set by a scraped import (src/crm/import.ts). Kept on the record so the
  // ranking can be explained, and re-scored, without the source file.
  followers?: number;
  city?: string;
  /** The scraper's own label, e.g. "wedding photography". */
  category?: string;
  bio?: string;
  /** Lead score from score.ts; orders the `new` tray. */
  score?: number;
  businessModel?: BusinessModel;
  /** File the lead came from. */
  source?: string;
  /** One import run — what crm:unimport rolls back. */
  batchId?: string;

  createdAt: string;
  updatedAt: string;
}

export interface CrmEvent {
  prospectId: string;
  /** ISO timestamp; also the sort key, so events read newest-last in storage. */
  at: string;
  by: EventBy;
  outcome?: OutcomeId;
  notes?: string;
  direction?: "inbound" | "outbound";
  // Present only when Sara wrote the event.
  callId?: string;
  durationSecs?: number;
  recordingUrl?: string;
  summary?: string;
  tags?: Record<string, unknown>;
}

export interface Outcome {
  id: string;
  label: string;
  /**
   * The tray this outcome moves the prospect into. Omitted = stays `open`.
   * This is what keeps sold customers out of tomorrow's call list without
   * anyone having to remember to change their status by hand.
   */
  closes?: ProspectStatus;
}

export const OUTCOMES = [
  { id: "interested", label: "Interested" },
  { id: "call_back", label: "Call back later" },
  { id: "demo_booked", label: "Demo booked" },
  { id: "no_answer", label: "No answer" },
  { id: "wrong_number", label: "Wrong number", closes: "lost" },
  { id: "not_interested", label: "Not interested", closes: "lost" },
  { id: "closed_won", label: "Closed won", closes: "won" },
  { id: "closed_lost", label: "Closed lost", closes: "lost" },
] as const satisfies readonly Outcome[];

export type OutcomeId = (typeof OUTCOMES)[number]["id"];

/**
 * Follow-up choices, stored as a real date rather than the label.
 *
 * "Next week" cannot be sorted, queried or chased; a date can. The label is
 * only how it gets picked.
 */
export const FOLLOW_UPS = [
  { id: "tomorrow", label: "Tomorrow", days: 1 },
  { id: "3_days", label: "In 3 days", days: 3 },
  { id: "next_week", label: "Next week", days: 7 },
  { id: "2_weeks", label: "In 2 weeks", days: 14 },
  { id: "next_month", label: "Next month", days: 30 },
  { id: "none", label: "No follow-up", days: null },
] as const;

export type FollowUpId = (typeof FOLLOW_UPS)[number]["id"];

/**
 * YYYY-MM-DD in the machine's LOCAL timezone.
 *
 * Deliberately not toISOString(), which is UTC: at 01:00 IST that reports
 * yesterday's date, so a follow-up set overnight would land a day early and
 * "due today" would be wrong for the first 5.5 hours of every Indian day.
 */
function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Resolve a follow-up choice to a date. Returns null for "no follow-up". */
export function followUpDate(id: FollowUpId, from = new Date()): string | null {
  const opt = FOLLOW_UPS.find((f) => f.id === id);
  if (!opt || opt.days === null) return null;
  const d = new Date(from);
  d.setDate(d.getDate() + opt.days);
  return localDate(d);
}

/** Today as YYYY-MM-DD, for "what's due" comparisons. */
export function today(): string {
  return localDate();
}

/**
 * Normalise a number so the same prospect is found however it was typed.
 * Indian numbers are stored E.164; anything else is kept as given.
 */
export function normalisePhone(raw: string): string {
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  // A leading 0 is how Indian numbers are commonly written by hand; without
  // stripping it the same person would be stored as two prospects.
  d = d.replace(/^0+/, "");
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  return d ? `+${d}` : "";
}

/** The tray an outcome moves a prospect into, or null to leave it alone. */
export function statusForOutcome(id?: string): ProspectStatus | null {
  const o = OUTCOMES.find((x) => x.id === id);
  return (o && "closes" in o ? (o.closes as ProspectStatus) : null) ?? null;
}

/** Normalise an Instagram handle or URL to one comparable key. */
export function normaliseInstagram(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^instagram\.com\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^@/, "");
}

/** Short, sortable, collision-resistant id — no dependency needed. */
export function newProspectId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  ).toUpperCase();
}
