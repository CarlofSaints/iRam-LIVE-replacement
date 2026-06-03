import { NextRequest } from "next/server";
import { getUserByEmail } from "@/lib/userData";
import { createResetToken } from "@/lib/passwordReset";
import { sendPasswordResetEmail } from "@/lib/email";
import { noCacheHeaders } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) return Response.json({ error: "Email is required" }, { status: 400, headers: noCacheHeaders() });
    const user = await getUserByEmail(email);
    if (user && user.active) {
      const token = await createResetToken(email);
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
      const resetUrl = `${siteUrl}/reset-password?token=${token}`;
      await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl });
    }
    return Response.json({ success: true }, { headers: noCacheHeaders() });
  } catch {
    return Response.json({ success: true }, { headers: noCacheHeaders() });
  }
}
