import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { updateStatusScenario, deleteStatusScenario } from "@/lib/statusScenarioData";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePermission(req, "manage_statuses");
    const { id } = await params;
    const body = await req.json();
    const updated = await updateStatusScenario(id, body);
    return Response.json(updated, { headers: noCacheHeaders() });
  } catch (err) {
    if (err instanceof Error && err.message === "Status scenario not found") {
      return Response.json(
        { error: "Scenario not found" },
        { status: 404, headers: noCacheHeaders() }
      );
    }
    return handleAuthError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePermission(req, "manage_statuses");
    const { id } = await params;
    await deleteStatusScenario(id);
    return Response.json({ ok: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
