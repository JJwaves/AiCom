import { GOOGLE_ADS } from "@/config/google-ads";
import { listSessionsByIds, sessionIdsWithEvents, type SessionRowLite } from "@/lib/data/intelligence-service";
import { listSessionsStartedBetween } from "@/lib/data/business-intelligence-service";
import { listOrdersCreatedBetween } from "@/lib/data/intelligence-service";
import type { OrderRow } from "@/lib/data/order-service";
import { isCountedOrder } from "@/modules/business-intelligence/revenue";
import { ratio, type Ratio } from "@/modules/business-intelligence/availability";
import type { ConversationCorpus } from "@/modules/customer-intelligence/aggregate";
import type { Period } from "@/modules/customer-intelligence/period";
import { CampaignMatcher, isGoogleAdsSession, hasClickId, type CampaignIdentity } from "./attribution";
import type { MatchQuality } from "./types";

/**
 * The FIRST-PARTY lens on Google Ads traffic (Session 13 spec §15, §31–§33).
 *
 * Everything here is BagDirect's own data: our sessions, our funnel events,
 * our conversations, our orders, our revenue. Not one number in this file
 * comes from Google, and no field is named `conversions` or
 * `conversionValue` — those words belong to the other lens (spec §14, §34).
 *
 * The two lenses are never merged, never averaged, and never used to
 * "correct" each other. They are displayed side by side, and where they
 * disagree the disagreement is itself the finding (spec §55).
 *
 * REUSE, NOT A SECOND SOURCE OF TRUTH: every read here is an existing
 * bounded Session-08/09 query. This module adds no new table scan, so
 * "how many orders were there?" has exactly one implementation.
 */

export type GoogleAdsFunnel = {
  /** Sessions started in the period that arrived from a Google Ads click. */
  sessions: number;
  /** Of those, how many carried a click id (hard proof) vs utm convention. */
  sessionsWithClickId: number;
  sessionsFromUtmOnly: number;
  /** Sessions that reached each stage. Denominator is always `sessions`. */
  productViewSessions: number;
  priceViewSessions: number;
  cartSessions: number;
  checkoutSessions: number;
  /** Conversations started by a Google Ads session. */
  conversations: number;
  /** Of those, the S08 qualified-conversation rule. */
  qualifiedConversations: number;
  /** Orders attributed to Google Ads (their session was Google Ads traffic). */
  orders: number;
  /** Revenue from those orders, integer cents. NEVER Google conversion value. */
  revenueCents: number;
  /** Currencies present on those orders — the currency gate's input. */
  revenueCurrencies: string[];
  /** Orders the AI Sales agent materially assisted (S07 semantics). */
  aiAssistedOrders: number;
  /**
   * Contribution profit BEFORE paid media for the attributed orders that
   * carry one, integer cents. `null` when NO attributed order has it —
   * never 0, because "we don't know the costs" is not "we made nothing".
   * Read together with `ordersWithContribution`, which is the denominator
   * POAS coverage is judged on (Session 13.5 §18–§19, §35).
   */
  contributionBeforePaidMediaCents: number | null;
  ordersWithContribution: number;

  /* Rates, with the documented denominator attached. */
  sessionToCart: Ratio;
  sessionToCheckout: Ratio;
  sessionToOrder: Ratio;
  qualifiedConversationRate: Ratio;
};

export type CampaignFirstParty = {
  campaignId: string;
  matchQuality: MatchQuality;
  sessions: number;
  cartSessions: number;
  checkoutSessions: number;
  conversations: number;
  qualifiedConversations: number;
  orders: number;
  revenueCents: number;
  revenueCurrencies: string[];
  /** See GoogleAdsFunnel — same semantics, scoped to this campaign. */
  contributionBeforePaidMediaCents: number | null;
  ordersWithContribution: number;
};

export type FirstPartyGoogleAds = {
  overall: GoogleAdsFunnel;
  byCampaign: Map<string, CampaignFirstParty>;
  /** Google Ads sessions that matched no campaign. Their revenue still counts. */
  unmatched: CampaignFirstParty;
  /** Match-quality tallies for the coverage report. */
  matchCounts: Record<MatchQuality, number>;
  /** Sessions considered, for the coverage denominators. */
  googleAdsSessionIds: Set<string>;
  ambiguousCampaignNames: number;
};

const EVENT_STAGES = {
  productView: ["product_viewed"],
  priceView: ["price_viewed"],
  cart: ["add_to_cart"],
  checkout: ["checkout_started"],
} as const;

/**
 * Build the first-party view for a period.
 *
 * Session selection is by SESSION START, matching S09's attribution
 * breakdown. Orders are attributed through their linked session — which may
 * have started before the period, so those sessions are fetched too. An
 * order with no session row cannot be attributed to advertising at all and
 * is simply absent (never assigned to a campaign by guesswork).
 */
export async function loadFirstPartyGoogleAds(
  period: Period,
  campaigns: CampaignIdentity[],
  corpus: ConversationCorpus,
): Promise<FirstPartyGoogleAds> {
  const matcher = new CampaignMatcher(campaigns);

  const periodSessions = await listSessionsStartedBetween(period.start, period.end);
  const adSessions = periodSessions.filter(isGoogleAdsSession);
  const adSessionIds = new Set(adSessions.map((s) => s.id));

  /* Stage membership — one bounded query per stage over the ad sessions. */
  const ids = [...adSessionIds];
  const [productViewIds, priceViewIds, cartIds, checkoutIds] = await Promise.all([
    sessionIdsWithEvents(ids, EVENT_STAGES.productView),
    sessionIdsWithEvents(ids, EVENT_STAGES.priceView),
    sessionIdsWithEvents(ids, EVENT_STAGES.cart),
    sessionIdsWithEvents(ids, EVENT_STAGES.checkout),
  ]);

  /* Orders: created in the period, counted per S09's rules (cancelled and
   * refunded excluded), attributed via their linked session. */
  const orders = (await listOrdersCreatedBetween(period.start, period.end)) as OrderRow[];
  const counted = orders.filter(isCountedOrder);
  const sessionById = new Map<string, SessionRowLite>(periodSessions.map((s) => [s.id, s]));
  const missingSessionIds = [
    ...new Set(counted.map((o) => o.sessionId).filter((id): id is string => id !== null && !sessionById.has(id))),
  ];
  for (const s of await listSessionsByIds(missingSessionIds)) sessionById.set(s.id, s);

  /* ---- Per-campaign accumulation ---- */
  const byCampaign = new Map<string, CampaignFirstParty>();
  const unmatched = emptyCampaign("(unmatched)", "UNMATCHED");
  const matchCounts: Record<MatchQuality, number> = { EXACT: 0, MAPPED: 0, UNMATCHED: 0 };
  const campaignOfSession = new Map<string, { campaignId: string | null; quality: MatchQuality }>();

  const bucketFor = (campaignId: string | null, quality: MatchQuality): CampaignFirstParty => {
    if (!campaignId) return unmatched;
    const existing = byCampaign.get(campaignId);
    if (existing) {
      // A campaign matched EXACTly by one session and by NAME by another is
      // reported at its WEAKEST quality — the honest summary of how it was
      // identified overall.
      if (existing.matchQuality === "EXACT" && quality === "MAPPED") existing.matchQuality = "MAPPED";
      return existing;
    }
    const created = emptyCampaign(campaignId, quality);
    byCampaign.set(campaignId, created);
    return created;
  };

  let sessionsWithClickId = 0;
  for (const session of adSessions) {
    const match = matcher.match(session);
    campaignOfSession.set(session.id, match);
    matchCounts[match.quality] += 1;
    if (hasClickId(session)) sessionsWithClickId += 1;

    const bucket = bucketFor(match.campaignId, match.quality);
    bucket.sessions += 1;
    if (cartIds.has(session.id)) bucket.cartSessions += 1;
    if (checkoutIds.has(session.id)) bucket.checkoutSessions += 1;
  }

  /* Conversations: attributed through their session, using the S08
   * qualified rule exactly as computed by customer intelligence — this
   * module never re-derives "qualified" (spec §32). */
  let conversations = 0;
  let qualifiedConversations = 0;
  for (const fact of corpus.facts) {
    const sessionId = fact.session?.id;
    if (!sessionId || !adSessionIds.has(sessionId)) continue;
    conversations += 1;
    if (fact.qualified) qualifiedConversations += 1;
    const match = campaignOfSession.get(sessionId);
    const bucket = bucketFor(match?.campaignId ?? null, match?.quality ?? "UNMATCHED");
    bucket.conversations += 1;
    if (fact.qualified) bucket.qualifiedConversations += 1;
  }

  /* Orders and revenue. */
  let orderCount = 0;
  let revenueCents = 0;
  let aiAssistedOrders = 0;
  let contributionCents = 0;
  let ordersWithContribution = 0;
  const revenueCurrencies = new Set<string>();
  for (const order of counted) {
    const session = order.sessionId ? sessionById.get(order.sessionId) : undefined;
    if (!session || !isGoogleAdsSession(session)) continue;
    orderCount += 1;
    revenueCents += order.totalCents;
    revenueCurrencies.add(order.currency);
    if (order.aiAssisted) aiAssistedOrders += 1;

    // The order's session may have started before the period, so it may not
    // be in `campaignOfSession` — match it now rather than dropping it.
    const match = campaignOfSession.get(session.id) ?? matcher.match(session);
    const bucket = bucketFor(match.campaignId, match.quality);
    bucket.orders += 1;
    bucket.revenueCents += order.totalCents;
    if (!bucket.revenueCurrencies.includes(order.currency)) bucket.revenueCurrencies.push(order.currency);

    /* Contribution comes from the order's OWN cost snapshot — the costs
     * that applied when it was placed. An order without one contributes
     * nothing to the numerator AND nothing to its denominator, so POAS
     * reports partial coverage instead of understating profit. */
    const contribution = order.costSnapshotJson?.contributionBeforePaidMediaCents ?? null;
    if (contribution !== null) {
      contributionCents += contribution;
      ordersWithContribution += 1;
      bucket.contributionBeforePaidMediaCents = (bucket.contributionBeforePaidMediaCents ?? 0) + contribution;
      bucket.ordersWithContribution += 1;
    }
  }

  const sessions = adSessions.length;
  const overall: GoogleAdsFunnel = {
    sessions,
    sessionsWithClickId,
    sessionsFromUtmOnly: sessions - sessionsWithClickId,
    productViewSessions: countIn(productViewIds, adSessionIds),
    priceViewSessions: countIn(priceViewIds, adSessionIds),
    cartSessions: countIn(cartIds, adSessionIds),
    checkoutSessions: countIn(checkoutIds, adSessionIds),
    conversations,
    qualifiedConversations,
    orders: orderCount,
    revenueCents,
    revenueCurrencies: [...revenueCurrencies],
    aiAssistedOrders,
    contributionBeforePaidMediaCents: ordersWithContribution > 0 ? contributionCents : null,
    ordersWithContribution,
    sessionToCart: ratio(countIn(cartIds, adSessionIds), sessions),
    sessionToCheckout: ratio(countIn(checkoutIds, adSessionIds), sessions),
    sessionToOrder: ratio(orderCount, sessions),
    qualifiedConversationRate: ratio(qualifiedConversations, conversations),
  };

  return {
    overall,
    byCampaign,
    unmatched,
    matchCounts,
    googleAdsSessionIds: adSessionIds,
    ambiguousCampaignNames: matcher.ambiguousNameCount,
  };
}

const emptyCampaign = (campaignId: string, matchQuality: MatchQuality): CampaignFirstParty => ({
  campaignId,
  matchQuality,
  sessions: 0,
  cartSessions: 0,
  checkoutSessions: 0,
  conversations: 0,
  qualifiedConversations: 0,
  orders: 0,
  revenueCents: 0,
  revenueCurrencies: [],
  contributionBeforePaidMediaCents: null,
  ordersWithContribution: 0,
});

const countIn = (haystack: Set<string>, allowed: Set<string>): number => {
  let n = 0;
  for (const id of haystack) if (allowed.has(id)) n += 1;
  return n;
};

/**
 * Customer signals from Google-attributed conversations (spec §32).
 *
 * This deliberately FILTERS the Session-08 classification output rather than
 * re-classifying anything: the taxonomy, the qualified rule and the
 * conversation-deduplication all stay in `modules/customer-intelligence`,
 * and this module only asks "…and how many of those came from Google Ads?".
 */
export type GoogleAdsCustomerSignals = {
  qualifiedConversations: number;
  topQuestions: { theme: string; conversations: number }[];
  topObjections: { type: string; conversations: number }[];
  /** Conversations that asked about the minimum order quantity. */
  moqQuestionConversations: number;
  /** Conversations that said the minimum was too high. */
  moqObjectionConversations: number;
};

export function buildCustomerSignals(
  corpus: ConversationCorpus,
  googleAdsSessionIds: Set<string>,
): GoogleAdsCustomerSignals {
  const questions = new Map<string, number>();
  const objections = new Map<string, number>();
  let qualified = 0;
  let moqQuestion = 0;
  let moqObjection = 0;

  for (const fact of corpus.facts) {
    const sessionId = fact.session?.id;
    if (!sessionId || !googleAdsSessionIds.has(sessionId)) continue;
    if (!fact.qualified) continue;
    qualified += 1;
    const classification = fact.classification;
    if (!classification) continue;

    // Deduplicated per conversation: asking four times is one conversation
    // with that question (S08 §8).
    for (const theme of new Set(classification.questionsJson.map((q) => q.theme))) {
      questions.set(theme, (questions.get(theme) ?? 0) + 1);
      if (theme === "MOQ") moqQuestion += 1;
    }
    for (const type of new Set(classification.objectionsJson.map((o) => o.type))) {
      objections.set(type, (objections.get(type) ?? 0) + 1);
      if (type === "MOQ_TOO_HIGH") moqObjection += 1;
    }
  }

  return {
    qualifiedConversations: qualified,
    topQuestions: topOf(questions).map(([theme, conversations]) => ({ theme, conversations })),
    topObjections: topOf(objections).map(([type, conversations]) => ({ type, conversations })),
    moqQuestionConversations: moqQuestion,
    moqObjectionConversations: moqObjection,
  };
}

const topOf = (m: Map<string, number>): [string, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, GOOGLE_ADS.MAX_BREAKDOWN_ROWS);
