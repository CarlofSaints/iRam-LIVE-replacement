/* The Dropbox client, driven with a stubbed transport.

   What matters here is not "can it call Dropbox" but the two properties the
   whole integration exists for:
     1. a write REPLACES the one file — it never creates a second copy;
     2. a write that cannot prove which version it started from is REFUSED.
   The credentials are shared between people, so Dropbox sees a single user
   and cannot tell two editors apart. The rev is the only thing that can.
*/

process.env.DROPBOX_APP_KEY = "test-key";
process.env.DROPBOX_APP_SECRET = "test-secret";
process.env.DROPBOX_REFRESH_TOKEN = "test-refresh";
process.env.DROPBOX_CONTROL_ROOT = "/Clients/CONTROL FILES";

import {
  isDropboxConfigured, dropboxConfigGaps, dropboxPath,
  listFolder, downloadFile, replaceFile, getMetadata,
  probeDropbox, resetDropboxTokenCache, DropboxConflictError,
} from "../lib/dropbox";

let pass = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log("  ok   " + name); }
  else {
    fails.push(name + (extra ? " — " + extra : ""));
    console.log("  FAIL " + name + (extra ? " — " + extra : ""));
  }
}

const ROOT = "/Clients/CONTROL FILES";
interface Call { url: string; headers: Record<string, string>; body: unknown }
const calls: Call[] = [];
let tokenCalls = 0;
let uploadReply = {
  status: 200,
  body: JSON.stringify({ ".tag": "file", name: "PMF.xlsx", path_display: ROOT + "/PMF.xlsx", rev: "REV2", size: 40 }),
};

globalThis.fetch = (async (input: unknown, init: { headers?: Record<string, string>; body?: unknown } = {}) => {
  const url = String(input);
  calls.push({ url, headers: (init.headers ?? {}) as Record<string, string>, body: init.body });

  if (url.includes("oauth2/token")) {
    tokenCalls++;
    return new Response(JSON.stringify({ access_token: "tok-" + tokenCalls, expires_in: 14400 }), { status: 200 });
  }
  if (url.includes("users/get_current_account")) {
    return new Response(JSON.stringify({ email: "carl@outerjoin.co.za" }), { status: 200 });
  }
  if (url.includes("files/list_folder/continue")) {
    return new Response(JSON.stringify({
      entries: [{ ".tag": "file", name: "RANGING.xlsx", path_display: ROOT + "/RANGING.xlsx", rev: "REVR", size: 3 }],
      cursor: "", has_more: false,
    }), { status: 200 });
  }
  if (url.includes("files/list_folder")) {
    return new Response(JSON.stringify({
      entries: [
        { ".tag": "file", name: "PMF.xlsx", path_display: ROOT + "/PMF.xlsx", rev: "REV1", size: 10 },
        { ".tag": "folder", name: "ARCHIVE", path_display: ROOT + "/ARCHIVE" },
      ],
      cursor: "CUR", has_more: true,
    }), { status: 200 });
  }
  if (url.includes("files/get_metadata")) {
    return new Response(JSON.stringify({ ".tag": "file", name: "PMF.xlsx", path_display: ROOT + "/PMF.xlsx", rev: "REV1", size: 10 }), { status: 200 });
  }
  if (url.includes("files/download")) {
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "dropbox-api-result": JSON.stringify({ ".tag": "file", name: "PMF.xlsx", path_display: ROOT + "/PMF.xlsx", rev: "REV1", size: 4 }) },
    });
  }
  if (url.includes("files/upload")) {
    return new Response(uploadReply.body, { status: uploadReply.status });
  }
  return new Response("unexpected", { status: 500 });
}) as typeof fetch;

async function main() {
  console.log("\nconfig");
  check("configured when all vars set", isDropboxConfigured());
  check("no gaps reported", (await dropboxConfigGaps()).length === 0);

  console.log("\npaths");
  check("joins with a leading slash", dropboxPath("Clients", "CONTROL FILES", "PMF.xlsx") === ROOT + "/PMF.xlsx");
  check("tolerates stray slashes", dropboxPath("/Clients/", "/PMF.xlsx") === "/Clients/PMF.xlsx");
  check("does NOT percent-encode a space", !dropboxPath("A B", "C.xlsx").includes("%20"),
    "an encoded path writes fine and then cannot be read back");

  console.log("\nauth");
  resetDropboxTokenCache();
  calls.length = 0; tokenCalls = 0;
  await listFolder(ROOT);
  await listFolder(ROOT);
  check("exchanges the refresh token", tokenCalls >= 1);
  check("caches the access token instead of re-fetching per call", tokenCalls === 1, "got " + tokenCalls);
  check("uses the refresh_token grant", String(calls[0].body).includes("grant_type=refresh_token"));

  console.log("\nlist");
  const entries = await listFolder(ROOT);
  check("follows the cursor to the end", entries.length === 3, "got " + entries.length);
  check("marks folders as folders", entries.some((e) => e.isFolder && e.name === "ARCHIVE"));
  check("carries the rev", entries.find((e) => e.name === "PMF.xlsx")?.rev === "REV1");

  console.log("\ndownload");
  const { buffer, entry } = await downloadFile(ROOT + "/PMF.xlsx");
  check("returns the bytes", buffer.length === 4);
  check("returns the rev they were read at", entry.rev === "REV1",
    "without this the caller has nothing to write back against");
  check("path travels in a header, not the URL", !!calls[calls.length - 1].headers["Dropbox-API-Arg"]);

  console.log("\nreplace — the part that matters");
  calls.length = 0;
  await replaceFile(ROOT + "/PMF.xlsx", Buffer.from([9, 9]), "REV1");
  const arg = JSON.parse(calls[calls.length - 1].headers["Dropbox-API-Arg"]);
  check("mode is update, not add", arg.mode[".tag"] === "update");
  check("quotes the rev it read", arg.mode.update === "REV1");
  check("autorename is OFF", arg.autorename === false,
    "autorename is how Dropbox silently creates 'PMF (1).xlsx' — a second copy IS the silo");

  let refused = false;
  try { await replaceFile("/x/PMF.xlsx", Buffer.from([1]), ""); } catch { refused = true; }
  check("REFUSES a write with no rev", refused,
    "a blind write would overwrite whoever saved last, untraceably");

  uploadReply = { status: 409, body: JSON.stringify({ error_summary: "path/conflict/file/..." }) };
  let conflicted: unknown = null;
  try { await replaceFile(ROOT + "/PMF.xlsx", Buffer.from([1]), "REV1"); } catch (e) { conflicted = e; }
  check("a stale rev raises DropboxConflictError", conflicted instanceof DropboxConflictError);
  check("and the message says what to do next",
    String((conflicted as Error).message).includes("Download it again"));

  uploadReply = {
    status: 200,
    body: JSON.stringify({ ".tag": "file", name: "PMF (1).xlsx", path_display: ROOT + "/PMF (1).xlsx", rev: "REV9" }),
  };
  let caughtCopy = false;
  try { await replaceFile(ROOT + "/PMF.xlsx", Buffer.from([1]), "REV1"); }
  catch (e) { caughtCopy = String((e as Error).message).includes("second copy"); }
  check("catches Dropbox writing a COPY instead of replacing", caughtCopy,
    "belt and braces behind autorename:false — a renamed result is the silo appearing");

  uploadReply = { status: 200, body: JSON.stringify({ ".tag": "file", name: "PMF.xlsx", path_display: ROOT + "/PMF.xlsx", rev: "REV2" }) };

  console.log("\nmetadata + probe");
  check("metadata carries a rev", (await getMetadata(ROOT + "/PMF.xlsx")).rev === "REV1");
  const p = await probeDropbox();
  check("probe reports ok", p.ok === true);
  check("probe names the account", p.account === "carl@outerjoin.co.za");
  check("probe counts the root", p.rootEntries === 3, "got " + p.rootEntries);

  console.log("\nunconfigured");
  process.env.DROPBOX_APP_KEY = "";
  const fresh = await import("../lib/dropbox?x=" + Date.now()) as typeof import("../lib/dropbox");
  check("names the missing var", (await fresh.dropboxConfigGaps()).includes("DROPBOX_APP_KEY"));
  check("reports not configured", !fresh.isDropboxConfigured());
  const p2 = await fresh.probeDropbox();
  check("probe fails loudly rather than silently", p2.ok === false && !!p2.error);

  console.log("\n" + pass + " passed, " + fails.length + " failed");
  if (fails.length) { fails.forEach((f) => console.log("  - " + f)); process.exit(1); }
}

main();
