import { NextRequest } from "next/server";
import { getUserByEmail, setUserPassword } from "@/lib/userData";
import { validateResetToken, markTokenUsed } from "@/lib/passwordReset";
import { noCacheHeaders } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json();
    if (!token || !password) return Response.json({ error: "Token and password are required" }, { status: 400, headers: noCacheHeaders() });
    const entry = await validateResetToken(token);
    if (!entry) return Response.json({ error: "Invalid or expired reset token" }, { status: 400, headers: noCacheHeaders() });
    const user = await getUserByEmail(entry.email);
    if (!user) return Response.json({ error: "User not found" }, { status: 404, headers: noCacheHeaders() });
    await setUserPassword(user.id, password);
    await markTokenUsed(token);
    return Response.json({ success: true }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error("Reset password error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500, headers: noCacheHeaders() });
  }
}
