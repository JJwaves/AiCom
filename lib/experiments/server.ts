import { cookies, headers } from "next/headers";
import { isFlagEnabled } from "@/config/flags";
import { recordServerEvent } from "@/lib/data/event-service";
import {
  findRunningExperimentForTarget,
  getAssignment,
  markExposed,
  recordAssignment,
  validateStoredExperiment,
  allocationOf,
  variantKeyOfRow,
  type ExperimentRow,
} from "@/lib/data/experiment-service";
import { getSession, SESSION_COOKIE } from "@/lib/data/session-service";
import {
  assignVariant,
  audienceSchema,
  ctaCopyVariantSchema,
  heroCopyVariantSchema,
  shippingMessageVariantSchema,
  classifyDevice,
  CONTROL_VARIANT_KEY,
  DEFAULT_AUDIENCE,
  isAdminPath,
  isBotUserAgent,
  isEligible,
  targetRendersOnPath,
  type CtaCopyVariant,
  type HeroCopyVariant,
  type ShippingMessageVariant,
  type VariantConfig,
} from "@/modules/experiments";

/**
 * Server-side experiment resolution (Session 11 spec §28–§30).
 *
 * WHY SERVER-SIDE (spec §29, decision recorded in docs/ARCHITECTURE.md):
 * assignment happens during the server render of the page that hosts the
 * surface, so the HTML the browser receives already contains the right
 * arm. There is no client-side swap, so there is no flicker, no layout
 * shift, and no hydration mismatch — the alternative (assign in the
 * browser) would show control first and then rewrite the headline, which
 * both looks broken and biases the very metric being measured.
 *
 * COST OF THAT CHOICE, stated plainly: reading the session cookie makes the
 * hosting page dynamically rendered. The engine therefore reads NOTHING
 * when `EXPERIMENT_ENGINE` is off — with the flag off, pages render exactly
 * as they did before Session 11 (static where they were static), no
 * assignment happens, and no exposure is recorded.
 *
 * ENROLMENT REQUIRES AN EXISTING FIRST-PARTY SESSION. Session rows are
 * minted by persisting API routes (`/api/events` and friends), not by page
 * renders, and a Server Component cannot set a cookie. A brand-new
 * browser's very FIRST render therefore sees control and is not enrolled;
 * from the next navigation onward (the analytics beacon has run) it is
 * eligible. This costs sample, not validity: non-enrolment happens strictly
 * BEFORE any arm is chosen, so it cannot differ between control and
 * variant.
 */

export type ResolvedTarget =
  | { enrolled: false; reason: string; override: null; experimentId: null; variantKey: null }
  | {
      enrolled: true;
      experimentId: string;
      variantKey: string;
      isControl: boolean;
      /** null for control — the control arm renders the normal UI, unchanged. */
      override: VariantConfig | null;
    };

const notEnrolled = (reason: string): ResolvedTarget => ({
  enrolled: false,
  reason,
  override: null,
  experimentId: null,
  variantKey: null,
});

/**
 * Resolve one experiment target for the current request.
 *
 * `path` is supplied by the calling page (it knows its own route) so this
 * function never has to guess where it is rendering.
 */
export async function resolveExperimentTarget(targetKey: string, path: string): Promise<ResolvedTarget> {
  // 1. Feature flag FIRST: with the engine off nothing is read at all, so
  //    the storefront behaves — and renders — exactly as before.
  if (!isFlagEnabled("EXPERIMENT_ENGINE")) return notEnrolled("experiment_engine_disabled");
  if (isAdminPath(path)) return notEnrolled("admin_traffic_excluded");
  if (!targetRendersOnPath(targetKey, path)) return notEnrolled("target_not_on_this_route");

  /* 2. Read the request BEFORE anything else, and OUTSIDE the try/catch.
   *    Both details matter, and both were bugs first:
   *
   *    ORDER — `cookies()`/`headers()` are what make the hosting page
   *    dynamically rendered, and Next decides that at BUILD time by
   *    observing which APIs a render actually uses. Querying the database
   *    first would short-circuit ("no running experiment") during the
   *    build, the page would be prerendered as static, and a later launch
   *    would silently never reach a customer.
   *
   *    SCOPE — Next signals "this route is dynamic" by THROWING from these
   *    APIs during a static render. Catching that would suppress the
   *    signal and prerender the page anyway, so these calls sit outside the
   *    defensive catch below. Every other failure still degrades to
   *    control. */
  const cookieStore = await cookies();
  const headerList = await headers();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value ?? null;
  const userAgent = headerList.get("user-agent");

  try {
    const experiment = await findRunningExperimentForTarget(targetKey);
    if (!experiment) return notEnrolled("no_running_experiment");

    const config = validateStoredExperiment(experiment);
    const variantKey = variantKeyOfRow(experiment);
    if (!config.ok || !config.allocation || !variantKey) {
      // A running experiment whose config no longer validates must not
      // enrol anyone. Control is the safe answer, always.
      console.error("[experiments] running experiment failed validation", experiment.id, config.issues);
      return notEnrolled("experiment_configuration_invalid");
    }

    if (!sessionId) return notEnrolled("no_first_party_session_yet");
    const session = await getSession(sessionId);
    if (!session) return notEnrolled("session_not_found");
    if (isBotUserAgent(userAgent)) return notEnrolled("automated_traffic_excluded");

    const audience = audienceSchema.safeParse(experiment.audienceJson ?? {});
    const eligibility = isEligible(audience.success ? audience.data : DEFAULT_AUDIENCE, {
      path,
      firstTouchSourceMedium: firstTouchSourceMedium(session),
      campaign: campaignOf(session),
      device: classifyDevice(userAgent),
      visitor: null, // deterministically unknown today — see docs/EXPERIMENTATION.md
      isAdminPath: false,
      isBot: false,
    });
    if (!eligibility.eligible) return notEnrolled(eligibility.reason);

    // 2. Assignment is a PURE function; the row is a record of it, which is
    //    why a lost write can never move a customer between arms.
    const existing = await getAssignment(experiment.id, session.id);
    const variant =
      existing?.variant ??
      assignVariant({
        experimentId: experiment.id,
        salt: experiment.assignmentSalt ?? experiment.id,
        sessionId: session.id,
        allocation: config.allocation,
      });
    if (!existing) await recordAssignment(experiment.id, session.id, variant);

    // 3. Exposure: the surface is being rendered for this session NOW.
    //    Stamped once, so repeat page views never inflate the denominator.
    if (!existing?.exposedAt) {
      const first = await markExposed(experiment.id, session.id);
      if (first) {
        await recordServerEvent({
          sessionId: session.id,
          name: "experiment_exposed",
          experimentId: experiment.id,
          page: path,
          props: { experiment: experiment.name.slice(0, 120), variant, target: targetKey },
        });
      }
    }

    const isControl = variant === CONTROL_VARIANT_KEY;
    return {
      enrolled: true,
      experimentId: experiment.id,
      variantKey: variant,
      isControl,
      override: isControl ? null : ((config.variantConfig ?? null) as VariantConfig | null),
    };
  } catch (err) {
    // Experiments are ADDITIVE to the storefront: a failure here renders the
    // normal page (same posture as first-party event persistence).
    console.error("[experiments] resolution failed (rendering control)", targetKey, err);
    return notEnrolled("resolution_failed");
  }
}

function firstTouchSourceMedium(session: { firstTouchJson: unknown }): string | null {
  const params = touchParams(session.firstTouchJson);
  if (!params) return null;
  const source = typeof params.utm_source === "string" ? params.utm_source : null;
  const medium = typeof params.utm_medium === "string" ? params.utm_medium : null;
  if (!source && !medium) return null;
  return `${source ?? "(direct)"} / ${medium ?? "(none)"}`;
}

function campaignOf(session: { firstTouchJson: unknown }): string | null {
  const params = touchParams(session.firstTouchJson);
  const campaign = params && typeof params.utm_campaign === "string" ? params.utm_campaign : null;
  return campaign && campaign.length > 0 ? campaign : null;
}

function touchParams(touch: unknown): Record<string, unknown> | null {
  if (!touch || typeof touch !== "object") return null;
  const params = (touch as { params?: unknown }).params;
  return params && typeof params === "object" ? (params as Record<string, unknown>) : null;
}

export type { ExperimentRow };
export { allocationOf };

/* ------------------------------------------------------------------ */
/* Typed per-target resolvers                                          */
/* ------------------------------------------------------------------ */

/**
 * One resolver per registered target. Each re-validates the override with
 * the target's own schema before handing it to a component — defence in
 * depth, and the reason pages never cast an experiment value.
 */
export type TargetResult<T> = { experimentId: string | null; variantKey: string | null; override: T | null };

async function typedResolve<T>(
  targetKey: string,
  path: string,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } },
): Promise<TargetResult<T>> {
  const resolved = await resolveExperimentTarget(targetKey, path);
  if (!resolved.enrolled) return { experimentId: null, variantKey: null, override: null };
  if (!resolved.override) {
    return { experimentId: resolved.experimentId, variantKey: resolved.variantKey, override: null };
  }
  const parsed = schema.safeParse(resolved.override);
  return {
    experimentId: resolved.experimentId,
    variantKey: resolved.variantKey,
    override: parsed.success ? ((parsed.data ?? null) as T) : null,
  };
}

export const resolveProductShippingMessage = (path: string) =>
  typedResolve<ShippingMessageVariant>("product.shipping_message", path, shippingMessageVariantSchema);

export const resolveProductPrimaryCta = (path: string) =>
  typedResolve<CtaCopyVariant>("product.primary_cta", path, ctaCopyVariantSchema);

export const resolveHomepageHero = (path: string) =>
  typedResolve<HeroCopyVariant>("homepage.hero", path, heroCopyVariantSchema);
