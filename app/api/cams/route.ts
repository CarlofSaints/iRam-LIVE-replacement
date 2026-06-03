import { NextRequest } from "next/server";
import { getCams, createCam, updateCam, deleteCam } from "@/lib/camData";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

export async function GET(req: NextRequest) {
  try {
    requireLogin(req);
    return Response.json(await getCams(), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_cams");
    const data = await req.json();
    const cam = await createCam(data);
    await addLog({ userId: session.userId, userName: session.name, action: "create_cam", details: `Created CAM ${cam.name} ${cam.surname}`, status: "success" });
    return Response.json(cam, { status: 201, headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_cams");
    const { id, ...updates } = await req.json();
    if (!id) return Response.json({ error: "ID required" }, { status: 400, headers: noCacheHeaders() });
    const cam = await updateCam(id, updates);
    await addLog({ userId: session.userId, userName: session.name, action: "update_cam", details: `Updated CAM ${cam.name}`, status: "success" });
    return Response.json(cam, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_cams");
    const { id } = await req.json();
    await deleteCam(id);
    await addLog({ userId: session.userId, userName: session.name, action: "delete_cam", details: `Deleted CAM ${id}`, status: "success" });
    return Response.json({ success: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
