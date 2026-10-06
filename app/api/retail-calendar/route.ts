import { NextRequest } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";
import { parseMassmartCalendarText, retailCalendarProblems, monthEndWeeksOf } from "@/lib/retailCalendar";
import {
  getRetailCalendarYears,
  saveRetailCalendarYear,
  deleteRetailCalendarYear,
} from "@/lib/retailCalendarData";

/* Massmart retail calendar.

   GET    — every loaded year (any logged-in user: the week pickers need it).
   POST   — multipart { file: PDF, year }: READ ONLY. Returns the weeks per
            month found in the PDF plus any problems, for the admin to check.
   PUT    — JSON { year, weeks, fileName, printedJan1Weekday }:
            saves a year after the admin has seen the preview. Re-validated
            here, so the preview step can't be skipped into a bad save.
   DELETE — ?year=2027: drop a loaded year (falls back to built-in / 4-5-4). */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    requireLogin(req);
    return Response.json({ years: await getRetailCalendarYears() }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission(req, "manage_channels");
    const form = await req.formData();
    const file = form.get("file");
    const year = Number(form.get("year"));
    if (!(file instanceof File)) {
      return Response.json({ error: "Choose the calendar PDF." }, { status: 400, headers: noCacheHeaders() });
    }
    if (!/\.pdf$/i.test(file.name)) {
      return Response.json({ error: `"${file.name}" is not a PDF.` }, { status: 400, headers: noCacheHeaders() });
    }

    let text: string;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      text = (await extractText(pdf, { mergePages: true })).text;
    } catch (e) {
      return Response.json(
        { error: `Couldn't read "${file.name}" as a PDF: ${e instanceof Error ? e.message : String(e)}` },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    try {
      const parsed = parseMassmartCalendarText(text);
      return Response.json(
        { fileName: file.name, year, ...parsed, problems: retailCalendarProblems(year, parsed.weeks, parsed.jan1Weekday) },
        { headers: noCacheHeaders() },
      );
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : String(e), fileName: file.name },
        { status: 422, headers: noCacheHeaders() },
      );
    }
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_channels");
    const body = await req.json();
    const year = Number(body.year);
    const weeks: number[] = Array.isArray(body.weeks) ? body.weeks.map(Number) : [];
    const printed = body.printedJan1Weekday == null ? null : Number(body.printedJan1Weekday);
    const fileName = String(body.fileName || "").trim();
    if (!fileName) {
      return Response.json({ error: "Load the PDF first." }, { status: 400, headers: noCacheHeaders() });
    }

    const problems = retailCalendarProblems(year, weeks, printed);
    if (problems.length) {
      return Response.json({ error: problems.join(" "), problems }, { status: 400, headers: noCacheHeaders() });
    }

    await saveRetailCalendarYear({
      year,
      weeks,
      monthEndWeeks: monthEndWeeksOf(weeks), // derived, never taken from the request
      fileName,
      loadedAt: new Date().toISOString(),
      loadedBy: session.name,
    });
    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "load_retail_calendar",
      details: `Loaded Massmart retail calendar ${year} from "${fileName}": weeks per month ${weeks.join("-")}.`,
      status: "success",
    });
    return Response.json({ success: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_channels");
    const year = Number(new URL(req.url).searchParams.get("year"));
    if (!(await deleteRetailCalendarYear(year))) {
      return Response.json({ error: `No calendar loaded for ${year}.` }, { status: 404, headers: noCacheHeaders() });
    }
    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "delete_retail_calendar",
      details: `Removed the loaded Massmart retail calendar for ${year}.`,
      status: "success",
    });
    return Response.json({ success: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
