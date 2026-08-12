import { newId } from "@/lib/data/id";
import type { AgentAction } from "@/lib/data/agent-service";
import { AiError } from "../errors";
import { aiLog, auditHash } from "../log";
import { toProviderJsonSchema } from "../schemas/structured";
import type { ProviderToolSpec } from "../providers/types";
import {
  AGENT_TOOL_PERMISSIONS,
  type AnyToolDefinition,
  type CartSnapshot,
  type ToolCallResult,
  type ToolErrorKind,
  type ToolExecutionContext,
} from "./types";

/**
 * Tool registry — holds a fixed set of tools and executes calls through the
 * full safety pipeline:
 *
 *   exists? → permitted for this context? → zod input parse → execute
 *   → zod output parse → audit log
 *
 * Failures come back as structured ToolCallResult errors (fed to the model),
 * never exceptions; arbitrary function execution is impossible because only
 * registered ToolDefinitions are reachable.
 *
 * Audit: every call logs tool name, agent, session/conversation/request ids,
 * outcome, duration, and a sha256 hash of the validated input — never the
 * input itself (PII) and never secrets. AgentDecision records are NOT
 * written for routine read tools (they are the financially-meaningful
 * decision audit, not a call log — structured logs are the S04 mechanism).
 */

export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  constructor(tools: AnyToolDefinition[]) {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new AiError("AI_CONFIGURATION_ERROR", `duplicate tool name "${tool.name}"`);
      }
      this.tools.set(tool.name, tool);
    }
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  get(name: string): AnyToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Tools this context may see/call — the model is never shown denied tools. */
  permittedTools(ctx: ToolExecutionContext): AnyToolDefinition[] {
    return [...this.tools.values()].filter((t) => ctx.permissions.includes(t.permission));
  }

  /** Wire specs (JSON Schema from zod) for the provider request. */
  providerSpecs(ctx: ToolExecutionContext): ProviderToolSpec[] {
    return this.permittedTools(ctx).map((t) => ({
      name: t.name,
      description: t.description,
      inputJsonSchema: toProviderJsonSchema(t.inputSchema),
    }));
  }

  async execute(name: string, rawInput: unknown, ctx: ToolExecutionContext): Promise<ToolCallResult> {
    const started = Date.now();
    const log = (outcome: string, extra: Record<string, string | number | boolean | undefined> = {}) =>
      aiLog("tool_call", {
        tool: name,
        agentType: ctx.agentType,
        requestId: ctx.requestId,
        sessionId: ctx.sessionId,
        conversationId: ctx.conversationId,
        inputHash: auditHash(rawInput),
        outcome,
        durationMs: Date.now() - started,
        ...extra,
      });

    const fail = (kind: ToolErrorKind, message: string): ToolCallResult => {
      log(kind);
      return { ok: false, toolName: name, error: { kind, message }, durationMs: Date.now() - started };
    };

    const tool = this.tools.get(name);
    if (!tool) return fail("unknown_tool", `no tool named "${name}" exists`);
    if (!ctx.permissions.includes(tool.permission)) {
      return fail("permission_denied", `agent "${ctx.agentType}" lacks the ${tool.permission} permission required by ${name}`);
    }

    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return fail("invalid_input", `invalid input: ${issues}`);
    }

    let output: unknown;
    try {
      output = await tool.execute(parsed.data, ctx);
    } catch (err) {
      // Internal detail stays in server logs; the model sees a generic failure.
      aiLog("tool_execution_error", {
        tool: name,
        requestId: ctx.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
      return fail("execution_failed", `tool "${name}" failed to execute`);
    }

    const validated = tool.outputSchema.safeParse(output);
    if (!validated.success) {
      // A tool returning schema-invalid output is OUR bug — surface loudly.
      aiLog("tool_output_invalid", { tool: name, requestId: ctx.requestId });
      return fail("invalid_output", `tool "${name}" produced invalid output`);
    }

    log("ok");
    return { ok: true, toolName: name, data: validated.data, durationMs: Date.now() - started };
  }
}

/**
 * Server-side context construction — the ONLY way to mint a
 * ToolExecutionContext. Permissions derive from the agent type via the
 * static server-side map; callers pass ids from the authenticated
 * session/request, never from model output.
 */
export function createToolContext(input: {
  agentType: AgentAction["agentType"];
  sessionId?: string;
  customerId?: string;
  conversationId?: string;
  /** Route-validated client cart snapshot (S07) — untrusted client state, bounded and typed. */
  cartSnapshot?: CartSnapshot;
}): ToolExecutionContext {
  return {
    agentType: input.agentType,
    permissions: AGENT_TOOL_PERMISSIONS[input.agentType],
    sessionId: input.sessionId,
    customerId: input.customerId,
    conversationId: input.conversationId,
    ...(input.cartSnapshot ? { cartSnapshot: input.cartSnapshot } : {}),
    requestId: newId("areq"),
  };
}
