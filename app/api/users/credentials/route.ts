import { NextRequest } from "next/server";
import crypto from "crypto";
import { getUserById, setUserPassword } from "@/lib/userData";
import { requireRole, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";
import {
  sendWelcomeEmail,
  sendCredentialsEmail,
  sendPasswordResetEmail,
} from "@/lib/email";
import { createResetToken } from "@/lib/passwordReset";

export const dynamic = "force-dynamic";

/**
 * Super-admin credential management for iRam LIVE local accounts.
 *
 *   set-password     — set an explicit password you type
 *   reset-password   — generate a random temp password
 *   reinvite         — fresh temp password + "Welcome" email
 *   send-credentials — fresh temp password + "Your login details" email
 *   send-reset-link  — email a self-service reset link (no password sent)
 *
 * NB: stored passwords are bcrypt hashes (one-way), so a user's CURRENT
 * password can never be retrieved or re-sent — every "send"/"re-invite"
 * mints a fresh temporary password and invalidates the previous one.
 */

// Unambiguous alphabet (no 0/O/1/l/I) for an easy-to-type temp password.
function generateTempPassword(len = 12): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const session = requireRole(req, "super_admin");
    const body = await req.json();
    const action: string | undefined = body.action;
    const userId: string | undefined = body.userId;

    if (!action || !userId) {
      return Response.json(
        { error: "action and userId are required" },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    const user = await getUserById(userId);
    if (!user) {
      return Response.json(
        { error: "User not found" },
        { status: 404, headers: noCacheHeaders() },
      );
    }

    // Attempt an email without ever losing the password change that already happened.
    const tryEmail = async (
      fn: () => Promise<void>,
    ): Promise<{ emailed: boolean; emailError?: string }> => {
      try {
        await fn();
        return { emailed: true };
      } catch (e) {
        console.error("Credential email failed:", e);
        return {
          emailed: false,
          emailError: e instanceof Error ? e.message : "Email failed",
        };
      }
    };

    switch (action) {
      case "set-password": {
        const password: unknown = body.password;
        const forceChange = !!body.forcePasswordChange;
        const sendEmail = !!body.sendEmail;
        if (typeof password !== "string" || password.length < 6) {
          return Response.json(
            { error: "Password must be at least 6 characters" },
            { status: 400, headers: noCacheHeaders() },
          );
        }
        await setUserPassword(user.id, password, forceChange);
        let emailRes: { emailed: boolean; emailError?: string } = {
          emailed: false,
        };
        if (sendEmail) {
          emailRes = await tryEmail(() =>
            sendCredentialsEmail({
              to: user.email,
              name: user.name,
              email: user.email,
              password,
              forcePasswordChange: forceChange,
            }),
          );
        }
        await addLog({
          userId: session.userId,
          userName: session.name,
          action: "set_password",
          details: `Set password for ${user.email}${
            sendEmail ? (emailRes.emailed ? " (emailed)" : " (email failed)") : ""
          }`,
          status: "success",
        });
        // Typed password is NOT echoed back.
        return Response.json(
          { ok: true, ...emailRes },
          { headers: noCacheHeaders() },
        );
      }

      case "reset-password":
      case "send-credentials":
      case "reinvite": {
        // reset-password lets the caller opt out of force-change / email;
        // the two "send" actions always force-change and always email.
        const forceChange =
          action === "reset-password" ? body.forcePasswordChange ?? true : true;
        const sendEmail =
          action === "reset-password" ? body.sendEmail ?? true : true;

        const tempPw = generateTempPassword();
        await setUserPassword(user.id, tempPw, !!forceChange);

        let emailRes: { emailed: boolean; emailError?: string } = {
          emailed: false,
        };
        if (sendEmail) {
          emailRes = await tryEmail(() =>
            action === "reinvite"
              ? sendWelcomeEmail({
                  to: user.email,
                  name: user.name,
                  email: user.email,
                  password: tempPw,
                  forcePasswordChange: !!forceChange,
                })
              : sendCredentialsEmail({
                  to: user.email,
                  name: user.name,
                  email: user.email,
                  password: tempPw,
                  forcePasswordChange: !!forceChange,
                }),
          );
        }

        const label =
          action === "reinvite"
            ? "Re-invited"
            : action === "send-credentials"
              ? "Sent credentials to"
              : "Reset password for";
        await addLog({
          userId: session.userId,
          userName: session.name,
          action: "reset_password",
          details: `${label} ${user.email}${
            emailRes.emailed ? " (emailed)" : " (email not sent)"
          }`,
          status: "success",
        });

        // The temp password IS returned so the super-admin can deliver it
        // manually (e.g. if the mailbox bounces). Response is no-store.
        return Response.json(
          { ok: true, password: tempPw, ...emailRes },
          { headers: noCacheHeaders() },
        );
      }

      case "send-reset-link": {
        const token = await createResetToken(user.email);
        const siteUrl =
          process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
        const resetUrl = `${siteUrl}/reset-password?token=${token}`;
        const emailRes = await tryEmail(() =>
          sendPasswordResetEmail({
            to: user.email,
            name: user.name,
            resetUrl,
          }),
        );
        await addLog({
          userId: session.userId,
          userName: session.name,
          action: "send_reset_link",
          details: `Sent reset link to ${user.email}${
            emailRes.emailed ? "" : " (email failed)"
          }`,
          status: "success",
        });
        return Response.json(
          { ok: true, ...emailRes },
          { headers: noCacheHeaders() },
        );
      }

      default:
        return Response.json(
          { error: `Unknown action: ${action}` },
          { status: 400, headers: noCacheHeaders() },
        );
    }
  } catch (err) {
    return handleAuthError(err);
  }
}
