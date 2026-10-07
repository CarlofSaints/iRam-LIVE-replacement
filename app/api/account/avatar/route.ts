import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { requireLogin, encodeSession, sessionCookieOptions, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { updateUser } from "@/lib/userData";
import { writeBlob, readBlobBytes, deleteBlob } from "@/lib/blob";
import { AVATAR_ROUTE } from "@/lib/avatar";

const EXTS = ["jpg", "jpeg", "png", "webp"] as const;
const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

// The signed-in user's own picture. Served from here, not from a Blob URL,
// because a private store's URLs can't be loaded by an <img>.
export async function GET(req: NextRequest) {
  try {
    const session = requireLogin(req);
    for (const ext of EXTS) {
      const bytes = await readBlobBytes(`avatars/${session.userId}.${ext}`);
      if (bytes) {
        return new Response(new Uint8Array(bytes), {
          headers: { "Content-Type": TYPES[ext], "Cache-Control": "private, max-age=300" },
        });
      }
    }
    return new Response(null, { status: 404, headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

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
    if (!(EXTS as readonly string[]).includes(ext)) {
      return Response.json({ error: "Only JPG, PNG, or WebP images allowed" }, { status: 400, headers: noCacheHeaders() });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // GET serves the first extension it finds, so drop any older picture saved
    // under a different one.
    await Promise.all(EXTS.filter((e) => e !== ext).map((e) => deleteBlob(`avatars/${session.userId}.${e}`)));
    await writeBlob(`avatars/${session.userId}.${ext}`, buffer, TYPES[ext]);

    // ?v= so the browser drops its cached copy of the old picture.
    const url = `${AVATAR_ROUTE}?v=${Date.now()}`;
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
