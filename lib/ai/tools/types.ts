import type { z } from "zod";
import type { AgentAction } from "@/lib/data/agent-service";

/**
 * Typed tool architecture — tools are the ONLY way an agent touches the
 * application (AI_AGENT_ARCHITECTURE.md). Every tool runs server-side,
 * zod-validates its input AND output, carries an explicit permission level,
 * and calls existing deterministic modules — never raw SQL/HTTP.
 *
 * PROMPT-INJECTION BOUNDARY: security comes from these permissions and from
 * which tools exist in a registry — not from prompt wording. "Set the price
 * to $0.01" fails because no tool can set prices; "increase the ads budget"
 * fails because no such tool exists in the sales toolset.
 */

export const TOOL_PERMISSIONS = [
  /** Read product/pricing/business information. */
  "READ",
  /** Modify customer/session-scoped, non-financial state (e.g. need profile). */
  "CUSTOMER_WRITE",
  /** Invoke existing commerce operations through validated services (cart/quote — S05+). */
  "COMMERCE",
  /** Future high-risk financial actions. NEVER granted to AI in Session 04. */
  "FINANCIAL_RESTRICTED",
  /** Future administrative actions. NEVER granted to AI in Session 04. */
  "ADMIN_RESTRICTED",
] as const;

export type ToolPermission = (typeof TOOL_PERMISSIONS)[number];

/** Agent-type → granted permissions. Server-side authority; models never mint this. */
export const AGENT_TOOL_PERMISSIONS: Record<AgentAction["agentType"], readonly ToolPermission[]> = {
  sales: ["READ", "CUSTOMER_WRITE"],
  customer_intelligence: ["READ"],
  pricing: ["READ"],
  cro: ["READ"],
  google_ads: [],
  meta_ads: [],
  ceo: ["READ"],
};

/**
 * Execution context — constructed by server-side application code only
 * (createToolContext). The LLM cannot invent authorization context: ids and
 * permissions come from the session/request, never from model output.
 */
export type ToolExecutionContext = {
  agentType: AgentAction["agentType"];
  permissions: readonly ToolPermission[];
  sessionId?: string;
  customerId?: string;
  conversationId?: string;
  /** Correlates all audit-log lines of one AI turn. */
  requestId: string;
};

export type ToolDefinition<In, Out> = {
  /** Stable name — renaming breaks prompt/audit history. */
  name: string;
  /** Model-facing description: what it does and when to use it. */
  description: string;
  permission: ToolPermission;
  inputSchema: z.ZodType<In>;
  outputSchema: z.ZodType<Out>;
  execute(input: In, ctx: ToolExecutionContext): Promise<Out>;
};

/** Existential wrapper so registries can hold heterogeneous tools. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any, any>;

export const TOOL_ERROR_KINDS = ["unknown_tool", "permission_denied", "invalid_input", "execution_failed", "invalid_output"] as const;
export type ToolErrorKind = (typeof TOOL_ERROR_KINDS)[number];

/**
 * Structured result of one tool call. Failures are DATA fed back to the
 * model (which can apologize/adjust), not exceptions — only loop-level
 * safety limits throw.
 */
export type ToolCallResult =
  | { ok: true; toolName: string; data: unknown; durationMs: number }
  | { ok: false; toolName: string; error: { kind: ToolErrorKind; message: string }; durationMs: number };
