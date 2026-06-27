import { Resend } from "resend";

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set");
  return new Resend(key);
}

const FROM = "iRam LIVE <noreply@outerjoin.co.za>";

function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

export async function sendWelcomeEmail(params: {
  to: string;
  name: string;
  email: string;
  password: string;
  forcePasswordChange: boolean;
}): Promise<void> {
  const resend = getResend();
  const siteUrl = getSiteUrl();
  const loginUrl = `${siteUrl}/login`;

  const pwNote = params.forcePasswordChange
    ? `<p style="margin:12px 0;padding:10px 14px;background:#FFF5F5;border-left:4px solid #E04E2A;border-radius:4px;font-size:13px;color:#C53030;">
        You will be prompted to change your password on first login.
      </p>`
    : "";

  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: "Welcome to iRam LIVE",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
        <div style="background:#7CC042;padding:28px 32px;text-align:center;border-radius:8px 8px 0 0;">
          <h1 style="color:#ffffff;font-size:22px;margin:0;font-weight:700;">iRam LIVE</h1>
          <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:8px 0 0;">OuterJoin</p>
        </div>
        <div style="padding:32px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">
          <p style="font-size:15px;color:#2D3748;margin:0 0 16px;">Hi ${params.name},</p>
          <p style="font-size:14px;color:#4A5568;margin:0 0 24px;line-height:1.6;">
            Your account has been created on the iRam LIVE portal.
          </p>
          <div style="background:#F7FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:20px;margin-bottom:24px;">
            <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#718096;margin:0 0 12px;font-weight:600;">Your Login Details</p>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:6px 0;font-size:13px;color:#718096;width:80px;">Email</td><td style="padding:6px 0;font-size:14px;color:#2D3748;font-weight:600;">${params.email}</td></tr>
              <tr><td style="padding:6px 0;font-size:13px;color:#718096;">Password</td><td style="padding:6px 0;font-size:14px;color:#2D3748;font-family:monospace;font-weight:600;">${params.password}</td></tr>
            </table>
          </div>
          ${pwNote}
          <div style="text-align:center;margin:28px 0;">
            <a href="${loginUrl}" style="display:inline-block;padding:14px 36px;background:#7CC042;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">Log In</a>
            <p style="margin:10px 0 0;font-size:12px;color:#A0AEC0;">${loginUrl}</p>
          </div>
          <div style="margin-top:32px;padding-top:20px;border-top:1px solid #E2E8F0;text-align:center;">
            <p style="font-size:12px;color:#A0AEC0;margin:0;">Powered by <strong style="color:#718096;">OuterJoin</strong></p>
          </div>
        </div>
      </div>
    `,
  });
}

export async function sendCredentialsEmail(params: {
  to: string;
  name: string;
  email: string;
  password: string;
  forcePasswordChange: boolean;
}): Promise<void> {
  const resend = getResend();
  const siteUrl = getSiteUrl();
  // Direct (non-Hub) login form, so client accounts aren't bounced to Hub SSO.
  const loginUrl = `${siteUrl}/login?local=true`;

  const pwNote = params.forcePasswordChange
    ? `<p style="margin:12px 0;padding:10px 14px;background:#FFF5F5;border-left:4px solid #E04E2A;border-radius:4px;font-size:13px;color:#C53030;">
        For your security, you will be prompted to set a new password on your next login.
      </p>`
    : "";

  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: "Your iRam LIVE login details",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
        <div style="background:#7CC042;padding:28px 32px;text-align:center;border-radius:8px 8px 0 0;">
          <h1 style="color:#ffffff;font-size:22px;margin:0;font-weight:700;">iRam LIVE</h1>
          <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:8px 0 0;">OuterJoin</p>
        </div>
        <div style="padding:32px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">
          <p style="font-size:15px;color:#2D3748;margin:0 0 16px;">Hi ${params.name},</p>
          <p style="font-size:14px;color:#4A5568;margin:0 0 24px;line-height:1.6;">
            Here are your login details for the iRam LIVE portal. Your password has been reset to the temporary one below.
          </p>
          <div style="background:#F7FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:20px;margin-bottom:24px;">
            <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#718096;margin:0 0 12px;font-weight:600;">Your Login Details</p>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:6px 0;font-size:13px;color:#718096;width:80px;">Email</td><td style="padding:6px 0;font-size:14px;color:#2D3748;font-weight:600;">${params.email}</td></tr>
              <tr><td style="padding:6px 0;font-size:13px;color:#718096;">Password</td><td style="padding:6px 0;font-size:14px;color:#2D3748;font-family:monospace;font-weight:600;">${params.password}</td></tr>
            </table>
          </div>
          ${pwNote}
          <div style="text-align:center;margin:28px 0;">
            <a href="${loginUrl}" style="display:inline-block;padding:14px 36px;background:#7CC042;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">Log In</a>
            <p style="margin:10px 0 0;font-size:12px;color:#A0AEC0;">${loginUrl}</p>
          </div>
          <div style="margin-top:32px;padding-top:20px;border-top:1px solid #E2E8F0;text-align:center;">
            <p style="font-size:12px;color:#A0AEC0;margin:0;">Powered by <strong style="color:#718096;">OuterJoin</strong></p>
          </div>
        </div>
      </div>
    `,
  });
}

export async function sendMissingProductsEmail(params: {
  to: string[];
  clientName: string;
  channelName: string;
  missingArticles: string[];
  uploaderName: string;
}): Promise<void> {
  if (params.to.length === 0 || params.missingArticles.length === 0) return;
  const resend = getResend();
  const max = 50;
  const shown = params.missingArticles.slice(0, max);
  const remaining = params.missingArticles.length - max;
  const list = shown.map((a) => `<li style="padding:2px 0;font-size:13px;color:#2D3748;">${a}</li>`).join("");
  const moreNote = remaining > 0 ? `<p style="font-size:13px;color:#718096;margin:8px 0 0;">+ ${remaining} more</p>` : "";

  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: `Missing Products \u2014 ${params.clientName} DISPO Upload`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
        <div style="background:#7CC042;padding:28px 32px;text-align:center;border-radius:8px 8px 0 0;">
          <h1 style="color:#ffffff;font-size:22px;margin:0;font-weight:700;">iRam LIVE</h1>
          <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:8px 0 0;">Missing Products Alert</p>
        </div>
        <div style="padding:32px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">
          <p style="font-size:14px;color:#4A5568;margin:0 0 16px;line-height:1.6;">
            <strong>${params.uploaderName}</strong> attempted to upload a DISPO for
            <strong>${params.clientName}</strong> / <strong>${params.channelName}</strong>.
          </p>
          <p style="font-size:14px;color:#C53030;margin:0 0 12px;font-weight:600;">
            The following ${params.missingArticles.length} article(s) in the DISPO are not in the LINKS file:
          </p>
          <div style="background:#FFF5F5;border:1px solid #FED7D7;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
            <ul style="margin:0;padding-left:18px;list-style:disc;">${list}</ul>
            ${moreNote}
          </div>
          <p style="font-size:13px;color:#718096;margin:0;">
            The upload was blocked. Please update the LINKS file and try again.
          </p>
          <div style="margin-top:32px;padding-top:20px;border-top:1px solid #E2E8F0;text-align:center;">
            <p style="font-size:12px;color:#A0AEC0;margin:0;">Powered by <strong style="color:#718096;">OuterJoin</strong></p>
          </div>
        </div>
      </div>
    `,
  });
}

export async function sendMissingStoresEmail(params: {
  to: string[];
  clientName: string;
  channelName: string;
  missingSites: string[];
  uploaderName: string;
}): Promise<void> {
  if (params.to.length === 0 || params.missingSites.length === 0) return;
  const resend = getResend();
  const max = 50;
  const shown = params.missingSites.slice(0, max);
  const remaining = params.missingSites.length - max;
  const list = shown.map((s) => `<li style="padding:2px 0;font-size:13px;color:#2D3748;">${s}</li>`).join("");
  const moreNote = remaining > 0 ? `<p style="font-size:13px;color:#718096;margin:8px 0 0;">+ ${remaining} more</p>` : "";

  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: `Missing Stores \u2014 ${params.clientName} DISPO Upload`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
        <div style="background:#7CC042;padding:28px 32px;text-align:center;border-radius:8px 8px 0 0;">
          <h1 style="color:#ffffff;font-size:22px;margin:0;font-weight:700;">iRam LIVE</h1>
          <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:8px 0 0;">Missing Stores Alert</p>
        </div>
        <div style="padding:32px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">
          <p style="font-size:14px;color:#4A5568;margin:0 0 16px;line-height:1.6;">
            <strong>${params.uploaderName}</strong> attempted to upload a DISPO for
            <strong>${params.clientName}</strong> / <strong>${params.channelName}</strong>.
          </p>
          <p style="font-size:14px;color:#C53030;margin:0 0 12px;font-weight:600;">
            The following ${params.missingSites.length} site(s) in the DISPO are not in the store master:
          </p>
          <div style="background:#FFF5F5;border:1px solid #FED7D7;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
            <ul style="margin:0;padding-left:18px;list-style:disc;">${list}</ul>
            ${moreNote}
          </div>
          <p style="font-size:13px;color:#718096;margin:0;">
            The upload was blocked. Please update the store master and try again.
          </p>
          <div style="margin-top:32px;padding-top:20px;border-top:1px solid #E2E8F0;text-align:center;">
            <p style="font-size:12px;color:#A0AEC0;margin:0;">Powered by <strong style="color:#718096;">OuterJoin</strong></p>
          </div>
        </div>
      </div>
    `,
  });
}

// Store-report summary email (the "stock action report" teaser). The HTML is
// pre-rendered by lib/storeReportEmail.ts; this just posts it via Resend.
export async function sendStoreReportEmail(params: {
  to: string | string[];
  subject: string;
  html: string;
}): Promise<void> {
  const resend = getResend();
  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
}

// Daily store-report engagement digest for managers.
export async function sendStoreReportDigestEmail(params: {
  to: string[];
  dayLabel: string;                 // e.g. "27 Jun 2026"
  totalSent: number;
  rows: { channel: string; sent: number; opened: number; used: number }[];
}): Promise<void> {
  if (params.to.length === 0) return;
  const resend = getResend();
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const body = params.rows.map((r) => `
    <tr>
      <td style="padding:8px 10px;font-size:13px;color:#2D3748;font-weight:600;border-bottom:1px solid #EDF2F7;">${r.channel}</td>
      <td style="padding:8px 10px;font-size:13px;color:#2D3748;text-align:center;border-bottom:1px solid #EDF2F7;">${r.sent}</td>
      <td style="padding:8px 10px;font-size:13px;color:#2D3748;text-align:center;border-bottom:1px solid #EDF2F7;">${r.opened} <span style="color:#A0AEC0;">(${pct(r.opened, r.sent)}%)</span></td>
      <td style="padding:8px 10px;font-size:13px;color:#2D3748;text-align:center;border-bottom:1px solid #EDF2F7;">${r.used} <span style="color:#A0AEC0;">(${pct(r.used, r.sent)}%)</span></td>
    </tr>`).join("");

  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: `Store Report Digest — ${params.dayLabel} — ${params.totalSent} sent`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
        <div style="background:#7CC042;padding:24px 32px;text-align:center;border-radius:8px 8px 0 0;">
          <h1 style="color:#ffffff;font-size:20px;margin:0;font-weight:700;">Store Report Digest</h1>
          <p style="color:rgba(255,255,255,0.9);font-size:13px;margin:6px 0 0;">${params.dayLabel}</p>
        </div>
        <div style="padding:28px 32px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">
          <p style="font-size:15px;color:#2D3748;margin:0 0 18px;">
            Today <strong>${params.totalSent}</strong> store report${params.totalSent === 1 ? " was" : "s were"} sent.
          </p>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#718096;text-align:left;border-bottom:2px solid #E2E8F0;">Channel</th>
                <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#718096;text-align:center;border-bottom:2px solid #E2E8F0;">Sent</th>
                <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#718096;text-align:center;border-bottom:2px solid #E2E8F0;">Opened</th>
                <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#718096;text-align:center;border-bottom:2px solid #E2E8F0;">Used</th>
              </tr>
            </thead>
            <tbody>${body || `<tr><td colspan="4" style="padding:14px;text-align:center;color:#A0AEC0;font-size:13px;">No reports sent today.</td></tr>`}</tbody>
          </table>
          <p style="font-size:12px;color:#A0AEC0;margin:18px 0 0;line-height:1.6;">
            <strong>Opened</strong> = the email was opened or the report page was viewed.
            <strong>Used</strong> = the rep clicked more than one KPI card on the report.
            Open tracking can over-count slightly (some mail apps pre-load images); &ldquo;used&rdquo; is the reliable engagement signal.
          </p>
          <div style="margin-top:24px;padding-top:18px;border-top:1px solid #E2E8F0;text-align:center;">
            <p style="font-size:12px;color:#A0AEC0;margin:0;">Powered by <strong style="color:#718096;">OuterJoin</strong></p>
          </div>
        </div>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  name: string;
  resetUrl: string;
}): Promise<void> {
  const resend = getResend();
  await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: "Password Reset \u2014 iRam LIVE",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#7CC042;">Password Reset</h2>
        <p>Hi ${params.name},</p>
        <p>You requested a password reset for your iRam LIVE account.</p>
        <p>
          <a href="${params.resetUrl}" style="display:inline-block;padding:12px 24px;background:#7CC042;color:#fff;text-decoration:none;border-radius:6px;">
            Reset Password
          </a>
        </p>
        <p style="color:#718096;font-size:13px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        <p style="margin-top:24px;color:#718096;font-size:13px;">Powered by OuterJoin</p>
      </div>
    `,
  });
}
