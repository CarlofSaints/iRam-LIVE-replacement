import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { requireLogin, encodeSession, sessionCookieOptions, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { updateUser } from "@/lib/userData";
import { writeBlob } from "@/lib/blob";

export async function POST(req: NextRequest) {
  try {
    const session = requireLogin(req);
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400, headers: noCacheHeaders() });
    }
    if (file.size > 2 * 1024 * 1024) {
      return Response.json({ error: "File too large (max 2MB)" }, { status: 400, headers: noCacheHeaders() });
    }
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    if (!["jpg", "jpeg", "png", "webp"].includes(ext)) {
      return Response.json({ error: "Only JPG, PNG, or WebP images allowed" }, { status: 400, headers: noCacheHeaders() });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const blobKey = `avatars/${session.userId}.${ext}`;
    const url = await writeBlob(blobKey, buffer, file.type);

    await updateUser(session.userId, { profilePicUrl: url });

    const updatedSession = { ...session, profilePicUrl: url };
    const cookieStore = await cookies();
    const { name, ...opts } = sessionCookieOptions();
    cookieStore.set(name, encodeSession(updatedSession), opts);

    return Response.json({ success: true, url, session: updatedSession }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
