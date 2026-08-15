import { EXPERIMENTS, resolveTrafficCap } from "@/config/experiments";
import type { BusinessHealthSnapshot } from "@/modules/business-intelligence/snapshot";
import type { FunnelDropOff } from "@/modules/business-intelligence/dropoff";
import { EXPERIMENT_TARGETS, PROTECTED_SURFACES } from "@/modules/experiments";
import type { ExperimentSummary } from "@/lib/experiments/readout";

/**
 * CRO agent context (Session 11 spec §20, §22–§23).
 *
 * The ONLY quantitative input the model sees: a bounded, PII-FREE text
 * rendering of deterministic numbers — the S09 BusinessHealthSnapshot, the
 * S11 funnel drop-off, and the readouts of real experiments — plus the
 * CLOSED list of targets it may propose against.
 *
 * Two whitelists are built while printing, and the agent's output is
 * filtered against exactly them afterwards:
 *   validMetricRefs   — every [key] printed here
 *   validEvidenceRefs — every insight / opportunity / experiment id printed
 *
 * Nothing else exists to cite, so "18 of 64 sessions asked about delivery"
 * can only appear in a proposal if this context actually said so.
 */

export type CroContext = {
  text: string;
  validMetricRefs: Set<string>;
  validEvidenceRefs: Set<string>;
};

const ratioLine = (r: { numerator: number; denominator: number; percentage: number | null }): string =>
  r.percentage === null
    ? `${r.numerator} of ${r.denominator} (sample too small for a %)`
    : `${r.numerator} of ${r.denominator} (${r.percentage}%)`;

export function buildCroContext(input: {
  snapshot: BusinessHealthSnapshot;
  dropOff: FunnelDropOff;
  experiments: ExperimentSummary[];
}): CroContext {
  const { snapshot: s, dropOff, experiments } = input;
  const validMetricRefs = new Set<string>();
  const validEvidenceRefs = new Set<string>();
  const lines: string[] = [];

  const ref = (key: string, label: string, rendered: string) => {
    validMetricRefs.add(key);
    lines.push(`- [${key}] ${label}: ${rendered}`);
  };

  lines.push(`PERIOD: ${s.period.label} (${iso(s.period.start)} → ${iso(s.period.end)}).`);
  lines.push("");
  lines.push("== TRAFFIC & FUNNEL (distinct sessions per surface) ==");
  ref("funnel.sessionsStarted", "Sessions started", `${dropOff.sessionsStarted} (AVAILABLE)`);
  for (const surface of dropOff.surfaces) {
    ref(`funnel.surface.${surface.name}`, surface.label, `${surface.sessions} distinct sessions`);
  }

  lines.push("");
  lines.push("== DROP-OFF BETWEEN CONSECUTIVE SURFACES ==");
  lines.push(
    "  (Ordering is the site's funnel, not proof a session passed through the earlier step. Sessions can enter mid-funnel.)",
  );
  for (const step of dropOff.steps) {
    ref(
      `dropoff.${step.from}_to_${step.to}`,
      `${step.label} (denominator: ${step.denominatorDefinition})`,
      `${ratioLine(step.ratio)}; ${step.droppedSessions} sessions did not continue`,
    );
  }
  if (dropOff.largestDropStep) {
    lines.push(`  Largest absolute session loss: ${dropOff.largestDropStep}.`);
  }

  lines.push("");
  lines.push("== BUSINESS CONVERSION RATES (Session 09, denominator-honest) ==");
  for (const rate of s.commerce.funnel.rates) {
    ref(`rate.${rate.name}`, `${rate.label} (denominator: ${rate.denominatorDefinition})`, ratioLine(rate.ratio));
  }

  lines.push("");
  lines.push("== AI SALES FUNNEL ==");
  ref("aiSales.conversations", "AI conversations", `${s.aiSales.conversations}`);
  ref("aiSales.qualifiedConversations", "Qualified AI conversations", `${s.aiSales.qualifiedConversations}`);
  ref("aiSales.assistedCartAddSessions", "AI-assisted cart-add sessions", `${s.aiSales.assistedCartAddSessions}`);
  ref(
    "aiSales.assistedCheckoutSessions",
    "AI-assisted checkout-start sessions",
    `${s.aiSales.assistedCheckoutStartSessions}`,
  );
  ref("aiSales.conversationPurchaseRate", "Qualified conversation → purchase", ratioLine(s.aiSales.conversationPurchaseRate));

  lines.push("");
  lines.push("== CUSTOMER SIGNALS (Session 08 — what customers actually asked and objected to) ==");
  for (const q of s.customerSignals.topQuestions) {
    ref(
      `signal.question.${q.theme}`,
      `Question theme "${q.theme}"`,
      `${q.conversations} conversations (${q.qualifiedConversations} qualified)`,
    );
  }
  for (const o of s.customerSignals.topObjections) {
    ref(
      `signal.objection.${o.type}`,
      `Objection "${o.type}"`,
      `${o.conversations} conversations (${o.qualifiedConversations} qualified; ${o.purchased} purchased anyway)`,
    );
  }
  for (const g of s.customerSignals.productGaps) {
    ref(
      `signal.gap.${g.kind}:${g.normalized}`,
      `Unsupported request "${g.normalized}"`,
      `${g.conversations} conversations (${g.qualifiedConversations} qualified)`,
    );
  }

  lines.push("");
  lines.push("== ATTRIBUTION (first-party; no ad spend data exists) ==");
  for (const row of s.attribution.firstTouchSourceMedium) {
    ref(
      `attribution.firstTouch.${row.key}`,
      `First touch "${row.key}"`,
      `${row.sessions} sessions, ${row.orders} orders`,
    );
  }

  lines.push("");
  lines.push("== EVIDENCE: CUSTOMER INSIGHTS (cite by id in evidenceRefs) ==");
  if (s.customerSignals.insights.length === 0) lines.push("  (none)");
  for (const i of s.customerSignals.insights) {
    validEvidenceRefs.add(i.id);
    lines.push(`- id=${i.id} [${i.insightType}, status=${i.status}, evidence=${i.evidenceCount}] ${i.title}`);
  }

  lines.push("");
  lines.push("== EVIDENCE: PRODUCT OPPORTUNITIES (cite by id; ALL require human validation) ==");
  if (s.customerSignals.opportunities.length === 0) lines.push("  (none)");
  for (const o of s.customerSignals.opportunities) {
    validEvidenceRefs.add(o.id);
    lines.push(`- id=${o.id} [${o.opportunityType ?? "other"}, status=${o.status}] ${o.title}`);
  }

  lines.push("");
  lines.push("== EXPERIMENTS (results are computed deterministically — you may explain them, never restate them) ==");
  if (experiments.length === 0) lines.push("  (no experiments have been created yet)");
  for (const summary of experiments) {
    const e = summary.experiment;
    validEvidenceRefs.add(e.id);
    const arms = summary.arms
      .map((a) => `${a.variant} ${a.pct}% — ${a.exposedSessions} exposed sessions`)
      .join("; ");
    lines.push(
      `- id=${e.id} "${e.name}" [status=${e.status}, target=${e.targetKey ?? "?"}, metric=${e.primaryMetric}] ` +
        `RESULT=${summary.readout.state}: ${summary.readout.explanation} Arms: ${arms || "none yet"}.`,
    );
    ref(
      `experiment.${e.id}.result`,
      `Experiment "${e.name}" deterministic result state`,
      `${summary.readout.state} (minimum sample per arm: ${summary.readout.minimumSamplePerVariant})`,
    );
  }

  lines.push("");
  lines.push("== TARGETS YOU MAY PROPOSE AGAINST (closed registry — anything else is discarded) ==");
  for (const target of Object.values(EXPERIMENT_TARGETS)) {
    lines.push(
      `- targetKey=${target.key} · experimentType=${target.experimentType} · ${target.label}\n` +
        `    surface: ${target.surface}\n` +
        `    control today: ${target.describeControl().summary}\n` +
        `    variantConfig fields: ${variantFieldList(target.key)}`,
    );
  }

  const cap = resolveTrafficCap();
  lines.push("");
  lines.push("== RULES THE SERVER ENFORCES (stating them here saves you a rejected proposal) ==");
  lines.push(
    `- Traffic: ${cap.ok ? `variant share must be ≤ ${cap.capPct}%` : "no launch is possible until the owner configures the traffic limit"}.`,
  );
  lines.push(
    `- Minimum sample: at least ${EXPERIMENTS.DEFAULT_MINIMUM_SAMPLE_PER_VARIANT} exposed sessions PER ARM before any winner is declared. You may raise this number, never lower it.`,
  );
  lines.push("- Variant copy must be plain text: no HTML, no markup, no scripts, no braces, no URLs.");
  lines.push(`- These surfaces can never be experimented on: ${PROTECTED_SURFACES.join("; ")}.`);
  lines.push("- You cannot launch anything. Every proposal goes to a human in the AI Action Center.");
  lines.push(
    "- Metric references: every [key] above is a valid supportingMetricRef; ids are valid evidenceRefs. References outside these lists are discarded, and a proposal with no valid metric reference is dropped entirely.",
  );

  let text = lines.join("\n");
  if (text.length > EXPERIMENTS.CRO_CONTEXT_MAX_CHARS) {
    text = `${text.slice(0, EXPERIMENTS.CRO_CONTEXT_MAX_CHARS)}\n[context truncated at ${EXPERIMENTS.CRO_CONTEXT_MAX_CHARS} chars]`;
  }
  return { text, validMetricRefs, validEvidenceRefs };
}

/** Human-readable field list for a target's variant schema. */
function variantFieldList(targetKey: string): string {
  switch (targetKey) {
    case "product.shipping_message":
      return 'message (required, ≤200 chars), placement ("above_cta" | "below_cta")';
    case "product.primary_cta":
      return "ctaLabel (required, ≤40 chars), helperText (optional, ≤160 chars)";
    case "homepage.hero":
      return "headline (required, ≤120 chars), subheadline (optional, ≤300 chars), ctaLabel (optional, ≤40 chars)";
    default:
      return "see the target registry";
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
