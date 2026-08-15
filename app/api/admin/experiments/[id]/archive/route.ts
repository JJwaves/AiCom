import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { guardAdminWrite, readJsonBody } from "@/lib/admin/write-guard";
import { archiveExperiment } from "@/lib/data/experiment-service";

/**
 * Archive an experiment (Session 11 spec §31). Archiving hides a finished
 * experiment from the working lists; it deletes no assignment, no exposure
 * and no result, and a RUNNING experiment must be stopped first.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ expectedStateVersion: z.number().int().min(1).max(1_000_000) }).strict();

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
    const result = await archiveExperiment({
      experimentId: id,
      actor: `admin:${guard.admin}`,
      expectedStateVersion: parsed.data.expectedStateVersion,
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
    return NextResponse.json({ ok: true, id: result.experiment.id, status: result.experiment.status });
  } catch (err) {
    console.error("[admin/experiments] archive failed", err);
    return NextResponse.json({ ok: false, code: "ARCHIVE_FAILED" }, { status: 500 });
  }
}
