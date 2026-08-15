import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { guardAdminWrite, readJsonBody } from "@/lib/admin/write-guard";
import { getExperiment, stopExperiment } from "@/lib/data/experiment-service";
import { buildExperimentSummary, freezeReadout } from "@/lib/experiments/readout";

/**
 * Stop a running experiment (Session 11 spec §33, §43).
 *
 * Stopping prevents new assignment and exposure. It DELETES NOTHING:
 * assignments, exposure events and conversions are preserved, and the
 * deterministic readout at stop time is frozen onto the row so later
 * configuration changes cannot rewrite what was concluded.
 *
 * Idempotent: stopping a stopped experiment succeeds and writes nothing.
 */

export const runtime = "nodejs";

const bodySchema = z
  .object({
    expectedStateVersion: z.number().int().min(1).max(1_000_000),
    reason: z.string().max(1000).optional(),
  })
  .strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = guardAdminWrite(req);
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });
  if (!isFlagEnabled("EXPERIMENT_ENGINE")) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ ok: false, code: body.code }, { status: body.status });
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });

  const { id } = await params;
  try {
    const existing = await getExperiment(id);
    if (!existing) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    // Freeze the readout AS STOPPED so the audit record never claims the
    // experiment is still collecting data.
    const summary = await buildExperimentSummary(existing, { statusOverride: "stopped" });

    const result = await stopExperiment({
      experimentId: id,
      actor: `admin:${guard.admin}`,
      reason: parsed.data.reason,
      expectedStateVersion: parsed.data.expectedStateVersion,
      finalReadout: freezeReadout(summary.readout),
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
      return NextResponse.json(
        {
          ok: false,
          code: "CONFLICT",
          reason: result.reason,
          currentStatus: result.currentStatus,
          currentStateVersion: result.currentStateVersion,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      id: result.experiment.id,
      status: result.experiment.status,
      alreadyStopped: result.alreadyStopped,
      resultState: summary.readout.state,
      stateVersion: result.experiment.stateVersion,
    });
  } catch (err) {
    console.error("[admin/experiments] stop failed", err);
    return NextResponse.json({ ok: false, code: "STOP_FAILED" }, { status: 500 });
  }
}
