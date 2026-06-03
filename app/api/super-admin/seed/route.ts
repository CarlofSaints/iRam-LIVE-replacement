import { NextRequest } from "next/server";
import { getUserByEmail, createUser, setUserPassword } from "@/lib/userData";
import { noCacheHeaders } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-seed-secret");
  if (!secret || secret !== process.env.SUPER_ADMIN_SEED_SECRET) {
    return Response.json({ error: "Invalid seed secret" }, { status: 403, headers: noCacheHeaders() });
  }
  try {
    const { email, name, password } = await req.json();
    if (!email || !name || !password) {
      return Response.json({ error: "email, name, and password are required" }, { status: 400, headers: noCacheHeaders() });
    }
    const existing = await getUserByEmail(email);
    if (existing) {
      await setUserPassword(existing.id, password);
      return Response.json({ success: true, id: existing.id, reset: true }, { status: 200, headers: noCacheHeaders() });
    }
    const user = await createUser({ name, email, password, role: "super_admin", forcePasswordChange: true });
    return Response.json({ success: true, id: user.id, reset: false }, { status: 201, headers: noCacheHeaders() });
  } catch (err) {
    console.error("Seed error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500, headers: noCacheHeaders() });
  }
}
