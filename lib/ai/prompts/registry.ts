import { AiError } from "../errors";

/**
 * Versioned prompt registry — repository-based and version-controlled, not
 * a prompt-management SaaS. Prompts never live inline in components or API
 * routes; every runtime call carries its prompt's id+version into the
 * AiUsage row, so any output can be traced to the exact prompt+model that
 * produced it.
 *
 * Versioning rule: any semantic change to `template` bumps `version`
 * (semver string). Session 04 ships only the minimal infra prompts; the
 * real sales persona is Session 05 and will be registered here.
 *
 * Templates use {{variable}} placeholders; rendering is STRICT — a missing
 * variable throws, an unknown variable throws (no silent drift between
 * template and call sites). Variable values are plain strings; callers are
 * responsible for not exceeding sane sizes.
 */

export type PromptDefinition = {
  id: string;
  /** Bump on ANY semantic template change. */
  version: string;
  purpose: string;
  template: string;
  /** Names the zod schema (in lib/ai/schemas or callers) the output must satisfy, if structured. */
  expectedOutputSchema?: string;
};

const PROMPTS = [
  {
    id: "runtime_smoke_test",
    version: "1.0.0",
    purpose: "Infrastructure-only prompt used by tests/dev scripts to exercise the runtime end-to-end. Never customer-facing.",
    template:
      "You are the BagDirect AI runtime smoke test. Reply to the user in one short sentence. Context tag: {{tag}}.",
  },
  {
    id: "structured_output_retry",
    version: "1.0.0",
    purpose: "Corrective nudge appended when a structured response failed schema validation, before the conservative retry.",
    template:
      "Your previous response was not valid against the required JSON schema. Errors: {{errors}}. " +
      "Respond again with ONLY a JSON object that satisfies the schema — no prose, no markdown fences.",
  },
] as const satisfies readonly PromptDefinition[];

export type PromptId = (typeof PROMPTS)[number]["id"];

const REGISTRY: ReadonlyMap<string, PromptDefinition> = new Map(PROMPTS.map((p) => [p.id, p]));

export function getPrompt(id: PromptId): PromptDefinition {
  const def = REGISTRY.get(id);
  if (!def) throw new AiError("AI_CONFIGURATION_ERROR", `unknown prompt id "${id}"`);
  return def;
}

export function listPrompts(): PromptDefinition[] {
  return [...REGISTRY.values()];
}

/** Strict {{var}} interpolation — every placeholder filled, every var used. */
export function renderPrompt(def: PromptDefinition, vars: Record<string, string> = {}): string {
  const used = new Set<string>();
  const rendered = def.template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (!(name in vars)) {
      throw new AiError("AI_CONFIGURATION_ERROR", `prompt "${def.id}" v${def.version} is missing variable "${name}"`);
    }
    used.add(name);
    return vars[name];
  });
  for (const name of Object.keys(vars)) {
    if (!used.has(name)) {
      throw new AiError("AI_CONFIGURATION_ERROR", `prompt "${def.id}" v${def.version} does not use variable "${name}"`);
    }
  }
  return rendered;
}
