import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { guardAdminWrite, readJsonBody } from "@/lib/admin/write-guard";
import { createExperimentDraft } from "@/lib/data/experiment-service";

/**
 * Human-authored DRAFT experiment (Session 11 spec §31, §49).
 *
 * The owner does not need the CRO agent to run an experiment: this route
 * accepts a design directly. It is not a loophole — the design goes through
 * the SAME validation as an AI proposal (closed target registry, strict
 * variant schema, closed metric lists, allocation totalling 100 under the
 * effective traffic ceiling), and it creates a DRAFT, which enrols nobody.
 * Launching remains a separate explicit action.
 */

export const runtime = "nodejs";

const bodySchema = z
  .object({
    name: z.string().min(3).max(120),
    hypothesis: z.string().min(1).max(4000),
    /** Validated by modules/experiments — never trusted as sent. */
    design: z.unknown(),
  })
  .strict();

export async function POST(req: Request) {
  const guard = guardAdminWrite(req);
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });
  if (!isFlagEnabled("EXPERIMENT_ENGINE")) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  const body = await readJsonBody(req, 16_000);
  if (!body.ok) return NextResponse.json({ ok: false, code: body.code }, { status: body.status });
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });

  try {
    const created = await createExperimentDraft({
      name: parsed.data.name,
      hypothesis: parsed.data.hypothesis,
      design: parsed.data.design,
      // Server-derived author — never from the request body.
      createdBy: `admin:${guard.admin}`,
    });
    if (!created.ok) {
      return NextResponse.json({ ok: false, code: created.code, reason: created.reason }, { status: 422 });
    }
    return NextResponse.json({ ok: true, id: created.experiment.id, status: created.experiment.status });
  } catch (err) {
    console.error("[admin/experiments] create failed", err);
    return NextResponse.json({ ok: false, code: "CREATE_FAILED" }, { status: 500 });
  }
}
