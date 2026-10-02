/**
 * Lead score — can you phone them, then how big are they.
 *
 * Deliberately pure arithmetic: no network, no AI. Computed once at import and
 * stored, so "best prospect" is reading the top of a sorted list rather than
 * waiting on a model.
 *
 * Contact details are a TIER, not a bonus. A lead you can phone today is worth
 * more than any number of followers you have no way to reach — so every
 * contactable lead outranks every uncontactable one, and follower count only
 * breaks ties within a tier. Email is a weak second tier: a reply is much less
 * likely than a picked-up call.
 *
 * Within a tier, service businesses rank above product ones. A service
 * business takes bookings by phone — enquiries, dates, appointments — which is
 * the job Sara does; a boutique takes orders through DMs or a website. A
 * missed call costs a photographer a wedding and costs a shop one sale.
 * Product leads are demoted rather than filtered out, so they stay reachable
 * if the focus ever widens.
 */

export interface ScoreInput {
  followers?: number;
  phone?: string;
  email?: string;
  /**
   * Whether the business sells a service (bookings by phone) or a product.
   * "unknown" is treated as a service, so an unclassified lead is never
   * silently buried.
   */
  model?: BusinessModel;
}

export type BusinessModel = "service" | "product" | "unknown";

export interface ScoreParts {
  score: number;
  tier: "phone" | "email" | "none";
  reach: number;
  /** Points deducted for being a product business. */
  modelPenalty: number;
}

/**
 * Demotion for a product business.
 *
 * Larger than the full reach range (0-100), so every service lead in a tier
 * outranks every product lead in it — but smaller than the gap between tiers,
 * so a callable boutique still beats an unreachable photographer.
 */
export const PRODUCT_PENALTY = 120;

/** Tier floors. Wide enough that reach and the penalty cannot cross one. */
export const TIER_PHONE = 1000;
export const TIER_EMAIL = 500;
export const TIER_NONE = 0;

/**
 * Followers on a log scale, 0-100.
 *
 * Linear would be useless: real leads span ~300 to ~140,000, so a handful of
 * large accounts would score 100 and everything else ~0. On a log scale each
 * 10x of reach is a fixed step, which is how follower counts actually behave.
 */
export function reachPoints(followers = 0): number {
  if (followers <= 0) return 0;
  const LOW = Math.log10(500);
  const HIGH = Math.log10(500_000);
  const t = (Math.log10(followers) - LOW) / (HIGH - LOW);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

export function scoreLead(input: ScoreInput): ScoreParts {
  const reach = reachPoints(input.followers);
  const tier = input.phone ? "phone" : input.email ? "email" : "none";
  const floor =
    tier === "phone" ? TIER_PHONE : tier === "email" ? TIER_EMAIL : TIER_NONE;
  const modelPenalty = input.model === "product" ? PRODUCT_PENALTY : 0;
  return { score: floor + reach - modelPenalty, tier, reach, modelPenalty };
}
