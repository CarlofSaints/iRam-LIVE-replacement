import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getStatusScenarios, createStatusScenario } from "@/lib/statusScenarioData";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "view_dashboard");
    const scenarios = await getStatusScenarios();
    return Response.json(scenarios, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission(req, "manage_statuses");
    const body = await req.json();
    const { statusCode, channelId, conditions, classification, description } = body;

    if (!statusCode || !channelId || !classification) {
      return Response.json(
        { error: "statusCode, channelId and classification are required" },
        { status: 400, headers: noCacheHeaders() }
      );
    }

    if (classification !== "POSITIVE" && classification !== "NEGATIVE") {
      return Response.json(
        { error: "classification must be POSITIVE or NEGATIVE" },
        { status: 400, headers: noCacheHeaders() }
      );
    }

    const scenario = await createStatusScenario({
      statusCode,
      channelId,
      conditions: conditions ?? {},
      classification,
      description,
    });

    return Response.json(scenario, { status: 201, headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
