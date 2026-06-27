import { NextRequest } from "next/server";
import { recordTrackingEvent, type TrackEvent } from "@/lib/storeReportTracking";

// PUBLIC tracking endpoint — hit by the email's 1×1 pixel and the hosted page's
// beacons (no auth). ?t=<token>&d=<YYYY-MM-DD>&e=open|view|card&c=<cardKey>
export const dynamic = "force-dynamic";

// 1×1 transparent GIF.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

function pixelResponse(): Response {
  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  });
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const token = (u.searchParams.get("t") || "").trim();
  const day = (u.searchParams.get("d") || "").trim();
  const e = (u.searchParams.get("e") || "open").trim() as TrackEvent;
  const card = u.searchParams.get("c") || undefined;

  // Best-effort; never block the pixel/beacon on a logging error.
  try {
    if (token && day && (e === "open" || e === "view" || e === "card")) {
      await recordTrackingEvent(day, token, e, card);
    }
  } catch (err) {
    console.error("tracking event failed", err);
  }

  // Email pixel expects an image; page beacons just need a 2xx.
  if (e === "open") return pixelResponse();
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
