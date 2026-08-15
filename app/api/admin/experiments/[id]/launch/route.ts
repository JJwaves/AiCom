import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { guardAdminWrite, readJsonBody } from "@/lib/admin/write-guard";
import { launchExperiment } from "@/lib/data/experiment-service";

/**
 * EXPLICIT HUMAN LAUNCH (Session 11 spec §25–§27).
 *
 * This is the only way an experiment ever reaches live traffic, and it is
 * deliberately NOT an agent capability and NOT a guardrail executor: the
 * executor registry stays empty, and no AI code path can reach this route.
 *
 * The service applies, in order: configuration re-validation against the
 * target registry, the traffic ceiling (a missing business limit BLOCKS in
 * production — never read as 100%), a Guardrail Engine evaluation of the
 * launch whose verdict is snapshotted on the row, the one-running-
 * experiment-per-target rule (database unique index), and a
 * `stateVersion`-checked transition under a row lock.
 *
 * Idempotent: launching an already-running experiment succeeds and writes
 * nothing.
 */

export const runtime = "nodejs";

const bodySchema = z
  .object({ expectedStateVersion: z.number().int().min(1).max(1_000_000) })
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
    const result = await launchExperiment({
      experimentId: id,
      // Server-derived identity — never from the request body.
      actor: `admin:${guard.admin}`,
      expectedStateVersion: parsed.data.expectedStateVersion,
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
      if (result.code === "CONFLICT") {
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
      if (result.code === "TARGET_BUSY") {
        return NextResponse.json({ ok: false, code: "TARGET_BUSY", reason: result.reason }, { status: 409 });
      }
      return NextResponse.json(
        { ok: false, code: "INVALID", reason: result.reason, missingConfiguration: result.missingConfiguration ?? [] },
        { status: 422 },
      );
    }
    return NextResponse.json({
      ok: true,
      id: result.experiment.id,
      status: result.experiment.status,
      alreadyRunning: result.alreadyRunning,
      stateVersion: result.experiment.stateVersion,
    });
  } catch (err) {
    console.error("[admin/experiments] launch failed", err);
    return NextResponse.json({ ok: false, code: "LAUNCH_FAILED" }, { status: 500 });
  }
}
