import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { sendNewClientRequestEmail } from "@/lib/email";
import { addLog } from "@/lib/activityLog";
import { getUserById } from "@/lib/userData";
import { readChecklist, checklistSummary } from "@/lib/clientRequestChecklist";

/* "The client I need is not on the list."

   Client names come from SQL Server now, so a client that is not there cannot
   be created in the app at all. This is the way out: it mails OuterJoin with
   what the requester knows, so the client can be added at the source.

   It also writes an activity-log entry. A request that leaves no trace is the
   same problem as a refused upload that left no trace — three days later
   nobody can tell whether it was ever asked for. */

export const REQUEST_RECIPIENT = "mark@outerjoin.co.za";

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_clients");
    const body = await req.json().catch(() => ({}));

    const clientName = String(body.clientName ?? "").trim();
    if (!clientName) {
      return Response.json(
        { error: "A client name is required — it is the whole point of the request." },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    const vendorNumbers = String(body.vendorNumbers ?? "").trim();
    const channels = String(body.channels ?? "").trim();
    const notes = String(body.notes ?? "").trim();

    /* PMF / Links / Ranging. Read here rather than trusted from the form, and
       only a literal true counts — the request is allowed through with any of
       them unticked, because refusing to send would just teach people to tick
       all three. What the request carries is the honest answer. */
    const checklist = readChecklist(body);

    /* The session carries the email, but read the user record too: an SSO
       session can be minted without one, and a reply-to that is not a real
       mailbox turns Mark's reply into a bounce he has to chase. */
    const user = await getUserById(session.userId).catch(() => null);
    const replyTo = (user?.email || session.email || "").trim();
    if (!replyTo) {
      return Response.json(
        { error: "Your account has no email address on it, so there would be nowhere to reply. Ask an admin to add one." },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    try {
      await sendNewClientRequestEmail({
        to: REQUEST_RECIPIENT,
        clientName, vendorNumbers, channels, notes, checklist,
        requestedByName: session.name,
        requestedByEmail: replyTo,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await addLog({
        userId: session.userId, userName: session.name,
        action: "client_request_failed",
        details: `Could not email the request for "${clientName}" to ${REQUEST_RECIPIENT}: ${reason}`,
        status: "error",
      });
      return Response.json(
        { error: `The request could not be sent: ${reason}` },
        { status: 502, headers: noCacheHeaders() },
      );
    }

    await addLog({
      userId: session.userId, userName: session.name,
      action: "client_requested",
      details:
        `Asked ${REQUEST_RECIPIENT} to add client "${clientName}"` +
        (vendorNumbers ? `, vendor(s) ${vendorNumbers}` : "") +
        (channels ? `, channel(s) ${channels}` : "") +
        ` [${checklistSummary(checklist)}]` +
        (notes ? ` — ${notes}` : ""),
      status: "success",
    });

    return Response.json(
      { sent: true, to: REQUEST_RECIPIENT },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
