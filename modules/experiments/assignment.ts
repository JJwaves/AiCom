import { normalizeAllocation, type Allocation } from "./allocation";
import { CONTROL_VARIANT_KEY } from "./types";

/**
 * Deterministic variant assignment (Session 11 spec §9).
 *
 * Assignment is a PURE FUNCTION of (experimentId, salt, sessionId) — there
 * is no randomness anywhere, so the same session always lands in the same
 * arm even before a row is persisted. Two consequences that matter:
 *
 *  - No flicker and no re-randomisation per page view: a server render and
 *    a later render agree by construction, not by luck.
 *  - The persisted `experiment_assignments` row is a RECORD of the
 *    assignment, not its source of truth, so a lost write cannot move a
 *    customer between arms mid-experiment.
 *
 * The per-experiment `salt` keeps arms independent across experiments: the
 * same session is not systematically "always the variant session".
 */

const BUCKETS = 10_000;

/** FNV-1a (32-bit) — small, dependency-free, and stable across runtimes. */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i) & 0xff;
    // hash *= 16777619, in 32-bit arithmetic
    hash = Math.imul(hash, 0x01000193) >>> 0;
    // Mix the high byte of multi-byte code points too.
    const high = input.charCodeAt(i) >>> 8;
    if (high !== 0) {
      hash ^= high;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash >>> 0;
}

/** Stable bucket in [0, 10000) for one session in one experiment. */
export function assignmentBucket(experimentId: string, salt: string, sessionId: string): number {
  return fnv1a32(`${experimentId}|${salt}|${sessionId}`) % BUCKETS;
}

/**
 * Which arm owns a bucket. Arms are laid out in a normalized (control-first,
 * then alphabetical) order so the mapping never depends on how the
 * allocation array happened to be written.
 */
export function variantForBucket(bucket: number, allocation: Allocation): string {
  const ordered = normalizeAllocation(allocation);
  let cursor = 0;
  for (const arm of ordered) {
    cursor += arm.pct * (BUCKETS / 100);
    if (bucket < cursor) return arm.variant;
  }
  // Unreachable for a validated allocation (they total 100%); control is the
  // only safe fallback if one ever slips through.
  return CONTROL_VARIANT_KEY;
}

/** The arm this session belongs to. Pure, deterministic, no I/O. */
export function assignVariant(input: {
  experimentId: string;
  salt: string;
  sessionId: string;
  allocation: Allocation;
}): string {
  return variantForBucket(assignmentBucket(input.experimentId, input.salt, input.sessionId), input.allocation);
}

/** A per-experiment salt derived from its identity — stable, not random. */
export function defaultSaltFor(experimentId: string, name: string): string {
  return `s11:${fnv1a32(`${experimentId}:${name}`).toString(16)}`;
}
