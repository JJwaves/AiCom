import { CUSTOMER_INTELLIGENCE, volumeGroupFor, type VolumeGroupId } from "@/config/customer-intelligence";
import type { ConversationRow } from "@/lib/data/conversation-service";
import type { NeedProfileRow } from "@/lib/data/customer-need-service";
import {
  countEventsByName,
  countOrdersBetween,
  listClassificationsForConversationIds,
  listConfigurationsUpdatedBetween,
  listConversationsStartedBetween,
  listNeedProfilesForSessionIds,
  listNeedProfilesUpdatedBetween,
  listOrderLinesForOrderIds,
  listOrdersCreatedBetween,
  listSessionsByIds,
  sessionIdsWithEvents,
  type ClassificationRow,
  type SessionRowLite,
} from "@/lib/data/intelligence-service";
import type { Period } from "./period";
import { isQualifiedConversation, QUALIFYING_EVENT_NAMES } from "./qualified";
import type { ObjectionType, OutcomeGroup, QuestionTheme } from "./taxonomy";

/**
 * DETERMINISTIC aggregation over real rows (Session 08 spec §8, §12, §14).
 *
 * Every number in this module is a count over database rows fetched
 * through lib/data — no model is ever consulted, and classification rows
 * only contribute the labels a past (validated) classification stored.
 *
 * Deduplication semantics (spec §8): the default unit is the CONVERSATION.
 * A customer asking about shipping four times in one conversation is ONE
 * conversation with a shipping question (mention count 4 is tracked
 * separately and never used as the headline metric).
 */

export type ConversationFacts = {
  conversation: ConversationRow;
  classification: ClassificationRow | null;
  session: SessionRowLite | null;
  needProfile: NeedProfileRow | null;
  qualified: boolean;
  outcomeGroup: OutcomeGroup;
  purchased: boolean;
};

export type ConversationCorpus = {
  period: Period;
  facts: ConversationFacts[];
  /** Conversations in period (all / qualified / classified / qualified∧classified / failed classification). */
  totals: {
    conversations: number;
    qualified: number;
    classified: number;
    qualifiedClassified: number;
    failedClassifications: number;
  };
};

function outcomeGroupFor(conversation: ConversationRow, sessionRecommended: boolean, qualified: boolean): OutcomeGroup {
  switch (conversation.outcome) {
    case "purchased":
      return "purchased";
    case "checkout_started":
      return "checkout_started";
    case "cart_added":
      return "cart_added";
    case "quote_started":
      return "quote_started";
  }
  if (conversation.status === "escalated" || conversation.outcome === "escalated") return "human_handoff";
  if (sessionRecommended) return "product_recommended";
  if (qualified) return "engaged_no_purchase";
  return "conversation_only";
}

/** Load every fact needed to aggregate a period's conversations — one pass, bounded queries. */
export async function loadConversationCorpus(period: Period): Promise<ConversationCorpus> {
  const conversations = await listConversationsStartedBetween(period.start, period.end);
  const conversationIds = conversations.map((c) => c.id);
  const sessionIds = [...new Set(conversations.map((c) => c.sessionId))];

  const [classifications, sessions, profiles, qualifyingSessions, recommendedSessions] = await Promise.all([
    listClassificationsForConversationIds(conversationIds),
    listSessionsByIds(sessionIds),
    listNeedProfilesForSessionIds(sessionIds),
    sessionIdsWithEvents(sessionIds, QUALIFYING_EVENT_NAMES),
    sessionIdsWithEvents(sessionIds, ["ai_product_recommended"]),
  ]);

  const classByConv = new Map(classifications.map((c) => [c.conversationId, c]));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const profileBySession = new Map(profiles.map((p) => [p.sessionId, p]));

  const facts: ConversationFacts[] = conversations.map((conversation) => {
    const needProfile = profileBySession.get(conversation.sessionId) ?? null;
    const qualified = isQualifiedConversation({
      conversation,
      sessionHasQualifyingEvent: qualifyingSessions.has(conversation.sessionId),
      needProfile,
    });
    const classification = classByConv.get(conversation.id) ?? null;
    return {
      conversation,
      classification: classification?.status === "classified" ? classification : null,
      session: sessionById.get(conversation.sessionId) ?? null,
      needProfile,
      qualified,
      outcomeGroup: outcomeGroupFor(conversation, recommendedSessions.has(conversation.sessionId), qualified),
      purchased: conversation.outcome === "purchased",
    };
  });

  const classified = facts.filter((f) => f.classification !== null);
  return {
    period,
    facts,
    totals: {
      conversations: facts.length,
      qualified: facts.filter((f) => f.qualified).length,
      classified: classified.length,
      qualifiedClassified: classified.filter((f) => f.qualified).length,
      failedClassifications: classifications.filter((c) => c.status === "failed").length,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Questions & objections (conversation-deduplicated)                  */
/* ------------------------------------------------------------------ */

export type QuestionAggregate = {
  theme: QuestionTheme;
  /** Distinct classified conversations with ≥1 mention (the headline count). */
  conversations: number;
  /** … of which qualified (drives percentages and insights). */
  qualifiedConversations: number;
  /** Raw message-level mentions — reported separately, never the headline. */
  mentions: number;
  /** Purchased outcomes among qualified conversations with this theme. */
  qualifiedPurchased: number;
  conversationIds: string[];
};

export function aggregateQuestions(corpus: ConversationCorpus): QuestionAggregate[] {
  const byTheme = new Map<string, QuestionAggregate>();
  for (const f of corpus.facts) {
    if (!f.classification) continue;
    const themes = new Map<string, number>();
    for (const q of f.classification.questionsJson) {
      themes.set(q.theme, (themes.get(q.theme) ?? 0) + 1);
    }
    for (const [theme, mentions] of themes) {
      const agg =
        byTheme.get(theme) ??
        ({ theme: theme as QuestionTheme, conversations: 0, qualifiedConversations: 0, mentions: 0, qualifiedPurchased: 0, conversationIds: [] } satisfies QuestionAggregate);
      agg.conversations += 1;
      agg.mentions += mentions;
      if (f.qualified) {
        agg.qualifiedConversations += 1;
        if (f.purchased) agg.qualifiedPurchased += 1;
      }
      if (agg.conversationIds.length < CUSTOMER_INTELLIGENCE.MAX_SOURCE_REFS) {
        agg.conversationIds.push(f.conversation.id);
      }
      byTheme.set(theme, agg);
    }
  }
  return [...byTheme.values()].sort((a, b) => b.conversations - a.conversations);
}

export type ObjectionAggregate = {
  type: ObjectionType;
  conversations: number;
  qualifiedConversations: number;
  mentions: number;
  /** Purchases among conversations carrying this objection — descriptive, never causal. */
  purchased: number;
  conversationIds: string[];
};

export function aggregateObjections(corpus: ConversationCorpus): ObjectionAggregate[] {
  const byType = new Map<string, ObjectionAggregate>();
  for (const f of corpus.facts) {
    if (!f.classification) continue;
    const types = new Map<string, number>();
    for (const o of f.classification.objectionsJson) {
      types.set(o.type, (types.get(o.type) ?? 0) + 1);
    }
    for (const [type, mentions] of types) {
      const agg =
        byType.get(type) ??
        ({ type: type as ObjectionType, conversations: 0, qualifiedConversations: 0, mentions: 0, purchased: 0, conversationIds: [] } satisfies ObjectionAggregate);
      agg.conversations += 1;
      agg.mentions += mentions;
      if (f.qualified) agg.qualifiedConversations += 1;
      if (f.purchased) agg.purchased += 1;
      if (agg.conversationIds.length < CUSTOMER_INTELLIGENCE.MAX_SOURCE_REFS) {
        agg.conversationIds.push(f.conversation.id);
      }
      byType.set(type, agg);
    }
  }
  return [...byType.values()].sort((a, b) => b.conversations - a.conversations);
}

/* ------------------------------------------------------------------ */
/* Unsupported requests / product gaps                                 */
/* ------------------------------------------------------------------ */

export type RequestAggregate = {
  normalized: string;
  kind: string;
  /** "unsupported" feeds product gaps; "custom_quote_path" is demand routed to quotes. */
  support: string;
  conversations: number;
  qualifiedConversations: number;
  mentions: number;
  conversationIds: string[];
  messageIds: string[];
};

export function aggregateRequests(corpus: ConversationCorpus): RequestAggregate[] {
  const byKey = new Map<string, RequestAggregate>();
  for (const f of corpus.facts) {
    if (!f.classification) continue;
    const seenInConversation = new Set<string>();
    for (const r of f.classification.unsupportedRequestsJson) {
      const key = `${r.support}:${r.kind}:${r.normalized}`;
      const agg =
        byKey.get(key) ??
        ({ normalized: r.normalized, kind: r.kind, support: r.support, conversations: 0, qualifiedConversations: 0, mentions: 0, conversationIds: [], messageIds: [] } satisfies RequestAggregate);
      agg.mentions += 1;
      if (!seenInConversation.has(key)) {
        seenInConversation.add(key);
        agg.conversations += 1;
        if (f.qualified) agg.qualifiedConversations += 1;
        if (agg.conversationIds.length < CUSTOMER_INTELLIGENCE.MAX_SOURCE_REFS) {
          agg.conversationIds.push(f.conversation.id);
        }
      }
      if (agg.messageIds.length < CUSTOMER_INTELLIGENCE.MAX_SOURCE_REFS) {
        agg.messageIds.push(r.messageId);
      }
      byKey.set(key, agg);
    }
  }
  return [...byKey.values()].sort((a, b) => b.conversations - a.conversations);
}

export const productGaps = (requests: RequestAggregate[]): RequestAggregate[] =>
  requests.filter((r) => r.support === "unsupported");

/* ------------------------------------------------------------------ */
/* Outcome funnel & conversion associations                            */
/* ------------------------------------------------------------------ */

export function outcomeFunnel(corpus: ConversationCorpus): Record<OutcomeGroup, number> {
  const out = {
    purchased: 0,
    checkout_started: 0,
    cart_added: 0,
    quote_started: 0,
    human_handoff: 0,
    product_recommended: 0,
    engaged_no_purchase: 0,
    conversation_only: 0,
  } satisfies Record<OutcomeGroup, number>;
  for (const f of corpus.facts) out[f.outcomeGroup] += 1;
  return out;
}

export type ConversionAssociation = {
  dimension: "question" | "objection";
  key: string;
  /** Qualified conversations WITH the label. */
  with: { conversations: number; purchased: number };
  /** Qualified classified conversations WITHOUT it. */
  without: { conversations: number; purchased: number };
};

/**
 * Descriptive purchase-rate comparison among QUALIFIED, CLASSIFIED
 * conversations (spec §24). Observational only — reported as "observed
 * purchase rate", never as causation. Only computed when both cells reach
 * MIN_SEGMENT_SAMPLE.
 */
export function conversionAssociations(corpus: ConversationCorpus): ConversionAssociation[] {
  const eligible = corpus.facts.filter((f) => f.qualified && f.classification);
  const out: ConversionAssociation[] = [];

  const collect = (dimension: "question" | "objection") => {
    const keys = new Set<string>();
    for (const f of eligible) {
      const labels = dimension === "question" ? f.classification!.questionsJson.map((q) => q.theme) : f.classification!.objectionsJson.map((o) => o.type);
      for (const label of labels) keys.add(label);
    }
    for (const key of keys) {
      const withCell = { conversations: 0, purchased: 0 };
      const withoutCell = { conversations: 0, purchased: 0 };
      for (const f of eligible) {
        const labels = dimension === "question" ? f.classification!.questionsJson.map((q) => q.theme) : f.classification!.objectionsJson.map((o) => o.type);
        const cell = labels.includes(key) ? withCell : withoutCell;
        cell.conversations += 1;
        if (f.purchased) cell.purchased += 1;
      }
      if (
        withCell.conversations >= CUSTOMER_INTELLIGENCE.MIN_SEGMENT_SAMPLE &&
        withoutCell.conversations >= CUSTOMER_INTELLIGENCE.MIN_SEGMENT_SAMPLE
      ) {
        out.push({ dimension, key, with: withCell, without: withoutCell });
      }
    }
  };
  collect("question");
  collect("objection");
  return out;
}

/* ------------------------------------------------------------------ */
/* Segments & attribution                                              */
/* ------------------------------------------------------------------ */

export type SegmentCount = { key: string; conversations: number; purchased: number };

/** Business-type segmentation over qualified conversations (need-profile businessType — never sensitive attributes). */
export function businessTypeSegments(corpus: ConversationCorpus): SegmentCount[] {
  const byType = new Map<string, SegmentCount>();
  for (const f of corpus.facts) {
    if (!f.qualified) continue;
    const key = (f.needProfile?.businessType ?? "unknown").toLowerCase().slice(0, 60);
    const seg = byType.get(key) ?? { key, conversations: 0, purchased: 0 };
    seg.conversations += 1;
    if (f.purchased) seg.purchased += 1;
    byType.set(key, seg);
  }
  return [...byType.values()]
    .filter((s) => s.conversations >= CUSTOMER_INTELLIGENCE.MIN_SEGMENT_SAMPLE || s.key === "unknown")
    .sort((a, b) => b.conversations - a.conversations);
}

export type AttributionSegment = {
  /** "google / cpc" style — utm_source / utm_medium of the session's FIRST touch. Click ids are never surfaced. */
  key: string;
  conversations: number;
  purchased: number;
  moqQuestionConversations: number;
};

export function attributionSegments(corpus: ConversationCorpus): AttributionSegment[] {
  const bySource = new Map<string, AttributionSegment>();
  for (const f of corpus.facts) {
    if (!f.qualified) continue;
    const params = f.session?.firstTouchJson?.params ?? {};
    const source = (params.utm_source ?? "direct/none").slice(0, 60);
    const medium = params.utm_medium ? ` / ${params.utm_medium.slice(0, 40)}` : "";
    const key = `${source}${medium}`;
    const seg = bySource.get(key) ?? { key, conversations: 0, purchased: 0, moqQuestionConversations: 0 };
    seg.conversations += 1;
    if (f.purchased) seg.purchased += 1;
    if (f.classification?.questionsJson.some((q) => q.theme === "MOQ")) seg.moqQuestionConversations += 1;
    bySource.set(key, seg);
  }
  return [...bySource.values()]
    .filter((s) => s.conversations >= CUSTOMER_INTELLIGENCE.MIN_SEGMENT_SAMPLE)
    .sort((a, b) => b.conversations - a.conversations);
}

/* ------------------------------------------------------------------ */
/* Demand signals — requested vs configured vs purchased (spec §6)     */
/* ------------------------------------------------------------------ */

export type ValueCount = {
  value: string;
  /** High-confidence lane: USER_STATED provenance. */
  stated: number;
  /** AI_INFERRED provenance — reported separately, never merged (spec §7). */
  inferred: number;
  refs: { table: string; id: string }[];
};

export type DemandSignals = {
  period: Period;
  /** What prospects SAY they want (need profiles; provenance-split). */
  requested: {
    volumeGroups: ValueCount[];
    colors: ValueCount[];
    materials: ValueCount[];
    printing: ValueCount[];
    businessTypes: ValueCount[];
    productInterests: ValueCount[];
    capacities: ValueCount[];
    /** Stated/inferred quantities below the catalog MOQ. */
    belowMoq: { stated: number; inferred: number; refs: { table: string; id: string }[] };
    profiles: number;
  };
  /** What users actually CONFIGURE (live configurator rows in period). */
  configured: {
    volumeGroups: { value: string; count: number }[];
    sizes: { value: string; count: number }[];
    colors: { value: string; count: number }[];
    printing: { value: string; count: number }[];
    belowMoqCount: number;
    configurations: number;
  };
  /** What customers BUY (immutable order-line snapshots in period). */
  purchased: {
    volumeGroups: { value: string; count: number }[];
    sizes: { value: string; count: number }[];
    colors: { value: string; count: number }[];
    printing: { value: string; count: number }[];
    orders: number;
    lines: number;
  };
};

const needSource = (p: NeedProfileRow, field: string): string | null => p.fieldSourcesJson?.[field]?.source ?? null;

function pushValueCount(map: Map<string, ValueCount>, value: string, source: string, ref: { table: string; id: string }) {
  const key = value.toLowerCase().trim().slice(0, 60);
  if (key.length === 0) return;
  const vc = map.get(key) ?? { value: key, stated: 0, inferred: 0, refs: [] };
  if (source === "USER_STATED") vc.stated += 1;
  else if (source === "AI_INFERRED") vc.inferred += 1;
  else return; // CONFIGURATOR/ORDER_DATA belong to the configured/purchased lanes.
  if (vc.refs.length < CUSTOMER_INTELLIGENCE.MAX_SOURCE_REFS) vc.refs.push(ref);
  map.set(key, vc);
}

const sortedValues = (map: Map<string, ValueCount>) =>
  [...map.values()].sort((a, b) => b.stated + b.inferred - (a.stated + a.inferred));

export async function loadDemandSignals(period: Period, moqFloor = 500): Promise<DemandSignals> {
  const profiles = await listNeedProfilesUpdatedBetween(period.start, period.end);
  const requested = {
    volumeGroups: new Map<string, ValueCount>(),
    colors: new Map<string, ValueCount>(),
    materials: new Map<string, ValueCount>(),
    printing: new Map<string, ValueCount>(),
    businessTypes: new Map<string, ValueCount>(),
    productInterests: new Map<string, ValueCount>(),
    capacities: new Map<string, ValueCount>(),
  };
  const belowMoq = { stated: 0, inferred: 0, refs: [] as { table: string; id: string }[] };

  for (const p of profiles) {
    const ref = { table: "customer_need_profiles", id: p.id };
    if (p.quantity !== null) {
      const src = needSource(p, "quantity");
      if (src === "USER_STATED" || src === "AI_INFERRED") {
        pushValueCount(requested.volumeGroups, volumeGroupFor(p.quantity) as VolumeGroupId, src, ref);
        if (p.quantity < moqFloor) {
          if (src === "USER_STATED") belowMoq.stated += 1;
          else belowMoq.inferred += 1;
          if (belowMoq.refs.length < CUSTOMER_INTELLIGENCE.MAX_SOURCE_REFS) belowMoq.refs.push(ref);
        }
      }
    }
    const fields: [keyof typeof requested, string | null, string][] = [
      ["colors", p.colorPreference, "colorPreference"],
      ["materials", p.materialPreference, "materialPreference"],
      ["printing", p.printingRequirement, "printingRequirement"],
      ["businessTypes", p.businessType, "businessType"],
      ["productInterests", p.productInterest, "productInterest"],
      ["capacities", p.desiredCapacity, "desiredCapacity"],
    ];
    for (const [bucket, value, field] of fields) {
      if (value === null) continue;
      const src = needSource(p, field);
      if (src === "USER_STATED" || src === "AI_INFERRED") pushValueCount(requested[bucket], value, src, ref);
    }
  }

  const configurations = await listConfigurationsUpdatedBetween(period.start, period.end);
  const cfg = {
    volumeGroups: new Map<string, number>(),
    sizes: new Map<string, number>(),
    colors: new Map<string, number>(),
    printing: new Map<string, number>(),
  };
  let cfgBelowMoq = 0;
  for (const c of configurations) {
    const conf = c.configJson;
    if (!conf) continue;
    cfg.volumeGroups.set(volumeGroupFor(conf.quantity), (cfg.volumeGroups.get(volumeGroupFor(conf.quantity)) ?? 0) + 1);
    cfg.sizes.set(conf.sizeId, (cfg.sizes.get(conf.sizeId) ?? 0) + 1);
    cfg.colors.set(conf.colorId, (cfg.colors.get(conf.colorId) ?? 0) + 1);
    cfg.printing.set(conf.printOptionId, (cfg.printing.get(conf.printOptionId) ?? 0) + 1);
    if (conf.quantity < moqFloor) cfgBelowMoq += 1;
  }

  const orders = await listOrdersCreatedBetween(period.start, period.end);
  const lines = await listOrderLinesForOrderIds(orders.map((o) => o.id));
  const bought = {
    volumeGroups: new Map<string, number>(),
    sizes: new Map<string, number>(),
    colors: new Map<string, number>(),
    printing: new Map<string, number>(),
  };
  for (const l of lines) {
    const conf = l.configJson;
    bought.volumeGroups.set(volumeGroupFor(l.quantity), (bought.volumeGroups.get(volumeGroupFor(l.quantity)) ?? 0) + 1);
    if (conf) {
      bought.sizes.set(conf.sizeId, (bought.sizes.get(conf.sizeId) ?? 0) + 1);
      bought.colors.set(conf.colorId, (bought.colors.get(conf.colorId) ?? 0) + 1);
      bought.printing.set(conf.printOptionId, (bought.printing.get(conf.printOptionId) ?? 0) + 1);
    }
  }

  const toCounts = (m: Map<string, number>) =>
    [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);

  return {
    period,
    requested: {
      volumeGroups: sortedValues(requested.volumeGroups),
      colors: sortedValues(requested.colors),
      materials: sortedValues(requested.materials),
      printing: sortedValues(requested.printing),
      businessTypes: sortedValues(requested.businessTypes),
      productInterests: sortedValues(requested.productInterests),
      capacities: sortedValues(requested.capacities),
      belowMoq,
      profiles: profiles.length,
    },
    configured: {
      volumeGroups: toCounts(cfg.volumeGroups),
      sizes: toCounts(cfg.sizes),
      colors: toCounts(cfg.colors),
      printing: toCounts(cfg.printing),
      belowMoqCount: cfgBelowMoq,
      configurations: configurations.length,
    },
    purchased: {
      volumeGroups: toCounts(bought.volumeGroups),
      sizes: toCounts(bought.sizes),
      colors: toCounts(bought.colors),
      printing: toCounts(bought.printing),
      orders: orders.length,
      lines: lines.length,
    },
  };
}

/* ------------------------------------------------------------------ */
/* AI-assisted funnel (deterministic event/order counts, spec §25)     */
/* ------------------------------------------------------------------ */

export type FunnelMetrics = {
  period: Period;
  /** Distinct sessions per stage — conservative unit; raw event counts kept alongside. */
  stages: { name: string; label: string; sessions: number; events: number }[];
  purchases: { total: number; aiAssisted: number };
};

const FUNNEL_STAGES: { name: string; label: string }[] = [
  { name: "ai_chat_started", label: "AI chats started" },
  { name: "ai_product_recommended", label: "Product recommendations" },
  { name: "ai_configuration_updated", label: "AI configurator updates" },
  { name: "ai_add_to_cart_proposed", label: "AI add-to-cart proposed" },
  { name: "ai_add_to_cart_requested", label: "AI add-to-cart requested" },
  { name: "ai_checkout_requested", label: "AI checkout requested" },
  { name: "human_handoff_requested", label: "Human handoffs" },
];

export async function loadFunnelMetrics(period: Period): Promise<FunnelMetrics> {
  const [counts, purchases] = await Promise.all([
    countEventsByName(period.start, period.end),
    countOrdersBetween(period.start, period.end),
  ]);
  const byName = new Map(counts.map((c) => [c.name, c]));
  return {
    period,
    stages: FUNNEL_STAGES.map((s) => ({
      ...s,
      sessions: byName.get(s.name)?.sessions ?? 0,
      events: byName.get(s.name)?.events ?? 0,
    })),
    purchases,
  };
}
