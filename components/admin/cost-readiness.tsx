import type { CostReadiness } from "@/modules/pricing";

/**
 * COST READINESS PANEL (Session 13.5 §37, §38).
 *
 * READ-ONLY by design. `config/costs.ts` stays the single source of cost
 * configuration; this panel shows the owner what is Configured / Missing /
 * Invalid and what each gap blocks. There is deliberately NO editor — a
 * second config source is exactly what §37 warns against.
 *
 * Shared by /admin/business-intelligence and /admin/pricing-intelligence so
 * the two surfaces can never disagree about what is configured.
 */

const CATEGORY_LABEL: Record<CostReadiness["categories"][number]["state"], string> = {
  CONFIGURED: "Configured",
  PARTIAL: "Partly configured",
  MISSING: "Missing",
  INVALID: "Invalid",
};

const CAPABILITY_LABEL: Record<CostReadiness["capabilities"][number]["state"], string> = {
  READY: "Ready",
  PARTIAL: "Partial",
  UNAVAILABLE: "Unavailable",
};

function StateChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className="label-mono text-xs"
      style={{ color: ok ? "var(--color-ink)" : "var(--color-ink-3)" }}
      data-state={label}
    >
      {label}
    </span>
  );
}

export function CostReadinessPanel({ readiness }: { readiness: CostReadiness }) {
  return (
    <section aria-labelledby="cost-readiness-heading">
      <h2 id="cost-readiness-heading" className="mt-10 mb-3 text-xl text-ink" style={{ fontWeight: 600 }}>
        Cost and margin readiness
      </h2>
      <p className="max-w-3xl text-sm text-ink-2">{readiness.summary}</p>
      <p className="mt-1 text-xs text-ink-3">
        Cost model version <span className="font-mono">{readiness.costModelVersion}</span>. These values live in{" "}
        <span className="font-mono">config/costs.ts</span> — this page only reports them. Nothing here is estimated:
        a missing cost is reported as missing, never as zero.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">Cost and margin inputs and whether each is configured</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="label-mono p-3 text-left">
                Input
              </th>
              <th scope="col" className="label-mono p-3 text-left">
                Status
              </th>
              <th scope="col" className="label-mono p-3 text-left">
                Needed for
              </th>
            </tr>
          </thead>
          <tbody>
            {readiness.categories.map((c) => (
              <tr key={c.key} className="border-b border-line">
                <td className="p-3 text-ink">{c.label}</td>
                <td className="p-3">
                  <StateChip label={CATEGORY_LABEL[c.state]} ok={c.state === "CONFIGURED"} />
                </td>
                <td className="p-3 text-ink-3">{c.neededFor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-6 mb-2 text-base text-ink" style={{ fontWeight: 600 }}>
        What this unlocks
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">Capabilities and whether the current configuration supports them</caption>
          <tbody>
            {readiness.capabilities.map((c) => (
              <tr key={c.key} className="border-b border-line">
                <td className="p-3 text-ink">{c.label}</td>
                <td className="p-3">
                  <StateChip label={CAPABILITY_LABEL[c.state]} ok={c.state === "READY"} />
                </td>
                <td className="p-3 text-ink-3">{c.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {readiness.validation.errors.length > 0 ? (
        <details className="surface mt-4 p-4 text-sm text-ink-2">
          <summary className="cursor-pointer">
            Invalid configuration ({readiness.validation.errors.length}) — must be corrected
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {readiness.validation.errors.map((e) => (
              <li key={`${e.path}-${e.message}`} className="font-mono">
                {e.path}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {readiness.missingConfiguration.length > 0 ? (
        <details className="surface mt-4 p-4 text-sm text-ink-2">
          <summary className="cursor-pointer">
            What exactly is missing ({readiness.missingConfiguration.length})
          </summary>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {readiness.missingConfiguration.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">
            Fill these in <span className="font-mono">config/costs.ts</span>. The template to collect them from your
            factory and payment processor is in <span className="font-mono">BUSINESS_CONFIG_TODO.md</span>. Missing
            costs do not affect the storefront: customers can price, cart and check out exactly as before.
          </p>
        </details>
      ) : null}
    </section>
  );
}
