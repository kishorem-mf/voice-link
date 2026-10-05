import { normaliseInstagram, normalisePhone } from "./schema.js";
import { scoreLead, type BusinessModel } from "./score.js";

/**
 * Turn one row of a scraped-leads spreadsheet into a prospect.
 *
 * Pure: no file and no network, so the mapping can be checked row by row
 * before anything is written. The shape is the scraper's all_leads.xlsx —
 * hardcoded on purpose until a second format actually appears
 * (docs/crm-phase-1.5.md).
 */

/** One spreadsheet row, keyed by its header text. */
export type LeadRow = Record<string, string>;

export interface MappedLead {
  businessName: string;
  instagramUrl?: string;
  phone?: string;
  email?: string;
  followers?: number;
  city?: string;
  category?: string;
  bio?: string;
  businessType?: string;
  businessModel: BusinessModel;
  score: number;
  tier: "phone" | "email" | "none";
  /** True when the phone was recovered from the bio rather than the Contact column. */
  contactFromBio?: boolean;
  /** Contact text that was neither a usable phone nor an email. */
  droppedContact?: string;
}

/** Case- and spacing-insensitive header lookup: "Profile URL" = "profile url". */
function field(row: LeadRow, name: string): string {
  const want = name.toLowerCase().replace(/\s+/g, "");
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase().replace(/\s+/g, "") === want) return (v ?? "").trim();
  }
  return "";
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/**
 * A dialable number as E.164, or undefined.
 *
 * Without a country code a number is read as Indian, and must then come out
 * as +91 and ten digits — normalisePhone alone would turn a short or garbled
 * local number into a plausible-looking foreign one. With an explicit "+" any
 * 8-15 digit number is accepted as written.
 */
function asPhone(raw: string): string | undefined {
  if (!/\d/.test(raw)) return undefined;
  const e164 = normalisePhone(raw);
  if (raw.trim().startsWith("+")) return /^\+\d{8,15}$/.test(e164) ? e164 : undefined;
  return /^\+91[1-9]\d{9}$/.test(e164) ? e164 : undefined;
}

/**
 * Split the Contact column, which holds phones and emails alike.
 *
 * An email must never be stored as a phone: `swarawomenethnic@gmail.com`
 * would become a PHONE# pointer that can never match a call.
 */
export function splitContact(raw: string): { phone?: string; email?: string; dropped?: string } {
  const text = raw.trim();
  if (!text) return {};
  const email = text.match(EMAIL)?.[0]?.toLowerCase();
  const rest = email ? text.replace(EMAIL, " ") : text;
  // Several numbers can share a cell ("98480 12345 / 040 2345678"); the first
  // dialable one wins.
  for (const part of rest.split(/[,/;|]|\s{2,}|\bor\b/i)) {
    const phone = asPhone(part);
    if (phone) return { phone, email };
  }
  // Report what could not be used: digits that were not a valid number, or a
  // cell with neither number nor email in it ("DM for bookings").
  const leftover = rest.replace(/[\s,/;|-]+/g, " ").trim();
  if (/\d/.test(leftover)) return { email, dropped: leftover };
  return email ? { email } : { dropped: text };
}

/**
 * Pull a phone or email out of a bio.
 *
 * Businesses often put their contact in the bio rather than the contact field
 * — "DM booking 7019592008", "Enquiry: 9110708256". Anything found here is a
 * fallback only: a value in the Contact column is the one the scraper was
 * confident about, so it always wins.
 */
export function fromBio(bio?: string): { phone?: string; email?: string } {
  const text = (bio ?? "").trim();
  if (!text) return {};

  const email = text.match(EMAIL)?.[0]?.toLowerCase();

  // Indian mobiles only, and only when they stand apart from other digits —
  // a bio is full of numbers that are not phone numbers (prices, years,
  // follower counts, "2024 weddings shot").
  const phone = text
    .replace(EMAIL, " ")
    .match(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g)
    ?.map((m) => asPhone(m))
    .find(Boolean);

  return { ...(phone ? { phone } : {}), ...(email ? { email } : {}) };
}

/** "77,194", "77.2K", "1.4M" and plain numbers alike. */
export function parseFollowers(raw: string): number | undefined {
  const m = raw.replace(/,/g, "").trim().match(/^(\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (!m) return undefined;
  const mult = m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1;
  return Math.round(Number(m[1]) * mult);
}

/**
 * The scraper's Category, read as a trade and a business model.
 *
 * Model decides the ranking (service over product); the trade picks which
 * Sara script fits. Anything unrecognised is `unknown`, which scores as a
 * service — a lead it cannot read keeps full value rather than being buried.
 */
const CATEGORIES: { match: RegExp; model: BusinessModel; businessType?: string }[] = [
  { match: /photo|video|film|wedding/i, model: "service", businessType: "wedding-photography" },
  { match: /salon|spa|beauty|makeup|bridal|hair|nail/i, model: "service", businessType: "salon" },
  { match: /clinic|doctor|dental|derma|health|hospital|ivf|fertility/i, model: "service", businessType: "clinic" },
  { match: /cater|food|chef|bak/i, model: "service", businessType: "catering" },
  { match: /real ?estate|property|realty/i, model: "service", businessType: "real-estate" },
  { match: /fashion|boutique|cloth|apparel|wear|saree|jewel|store|shop/i, model: "product" },
];

export function classify(category: string): { model: BusinessModel; businessType?: string } {
  const hit = CATEGORIES.find((c) => c.match.test(category));
  return hit ? { model: hit.model, businessType: hit.businessType } : { model: "unknown" };
}

/** Handle or profile URL -> canonical profile URL. */
function instagramUrlOf(row: LeadRow): string | undefined {
  const raw = field(row, "Profile URL") || field(row, "Handle");
  const handle = raw ? normaliseInstagram(raw) : "";
  return handle ? `https://instagram.com/${handle}` : undefined;
}

/** Map one row. Returns null for a row with no name and no handle. */
export function mapLead(row: LeadRow): MappedLead | null {
  const instagramUrl = instagramUrlOf(row);
  const businessName = field(row, "Name") || (instagramUrl ? normaliseInstagram(instagramUrl) : "");
  if (!businessName) return null;

  const contact = splitContact(field(row, "Contact"));
  const bio = field(row, "Bio") || undefined;

  // The Contact column is what the scraper was confident about, so it wins.
  // The bio is a fallback for businesses that put "DM booking 7019592008"
  // there instead — which turns an uncontactable lead into a callable one.
  const inBio = fromBio(bio);
  const phone = contact.phone ?? inBio.phone;
  const email = contact.email ?? inBio.email;

  const category = field(row, "Category") || undefined;
  const { model, businessType } = classify(category ?? "");
  const followers = parseFollowers(field(row, "Followers"));
  const s = scoreLead({ followers, phone, email, model });

  return {
    businessName,
    instagramUrl,
    phone,
    email,
    /** Where the contact came from, since a bio match is a weaker signal. */
    contactFromBio: !contact.phone && Boolean(inBio.phone),
    followers,
    city: field(row, "City") || undefined,
    category,
    bio,
    businessType,
    businessModel: model,
    score: s.score,
    tier: s.tier,
    droppedContact: contact.dropped,
  };
}
