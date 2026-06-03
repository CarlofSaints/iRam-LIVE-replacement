import { NextRequest } from "next/server";
import { getMergedStores } from "@/lib/storeFileData";
import { requireLogin, noCacheHeaders, handleAuthError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    requireLogin(req);
    return Response.json(await getMergedStores(), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
