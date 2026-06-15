import { NextRequest } from "next/server";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getClientLogo, saveClientLogo, deleteClientLogo, validateLogoDataUrl } from "@/lib/logoData";
import { addLog } from "@/lib/activityLog";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireLogin(req);
    const { id } = await params;
    const logo = await getClientLogo(id);
    return Response.json(logo, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission(req, "manage_clients");
    const { id } = await params;
    const body = await req.json();
    const dataUrl = validateLogoDataUrl(body?.dataUrl);
    if (!dataUrl) {
      return Response.json({ error: "Invalid image (PNG/JPG/GIF/WebP, max 1.5MB)" }, { status: 400, headers: noCacheHeaders() });
    }
    await saveClientLogo(id, { dataUrl, uploadedAt: new Date().toISOString(), uploadedBy: session.name });
    await addLog({ userId: session.userId, userName: session.name, action: "upload_client_logo", details: `Client ${id}`, status: "success" });
    return Response.json({ ok: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission(req, "manage_clients");
    const { id } = await params;
    await deleteClientLogo(id);
    await addLog({ userId: session.userId, userName: session.name, action: "delete_client_logo", details: `Client ${id}`, status: "success" });
    return Response.json({ ok: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
