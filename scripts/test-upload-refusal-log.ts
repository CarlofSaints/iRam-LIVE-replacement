/* A REFUSED load must leave a record.

   Until now it left nothing. The upload INDEX holds successes only, and every
   early return in /api/uploads returned straight to the browser without
   writing anything down — so "it wouldn't let me load it" was unanswerable:
   no attempt, no reason, no file name, not even a timestamp. The loader's own
   screen keeps the message, but that screen is seen once by one person and is
   gone by the time anyone is asked about it.

   This drives the REAL route against a local data/ directory (no
   BLOB_READ_WRITE_TOKEN means lib/blob.ts reads and writes files, never the
   production store) and asserts, for each way a load can be turned away:

     1. the loader still gets the same message on screen,
     2. an activity-log entry exists that names the file, client, channel,
        period and WHY, and
     3. NOTHING was added to the upload index — a refused load must never make
        the DISPO checklist show that week as loaded.

   (3) is the one worth guarding: the index is what the checklist reads, so a
   "helpful" record of the attempt in the wrong place would be worse than no
   record at all.

   Run:
     npx tsx scripts/test-upload-refusal-log.ts      # seeds data/, tells you to start the server
     npm run dev
     npx tsx scripts/test-upload-refusal-log.ts      # runs the assertions
*/

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import * as XLSX from "xlsx";
import bcrypt from "bcryptjs";

const APP = process.env.IRAM_APP_URL ?? "http://localhost:3000";
const DATA = join(process.cwd(), "data");

const CLIENT_ID = "test-client-refusal-log";
const CLIENT_NAME = "REFUSAL LOG TEST CLIENT";
const VENDOR = "892";

/* A seeded local user, signed in through the app's own /api/auth. Deliberately
   NOT a hand-built session cookie: this repo is public, and a ready-made
   "here is how to mint a session" snippet does not belong in it. Logging in the
   ordinary way also means this test exercises the same path a person does. */
const TEST_EMAIL = "refusal-log-test@localhost";
const TEST_PASSWORD = "local-test-only";
let COOKIE = "";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

function xlsxBuffer(rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// A DISPO the parser is happy with: it finds a header row on "Vendor"/"Article"
// and reads "Aug26" as a monthly sales column.
const goodDispo = () =>
  xlsxBuffer([
    ["Vendor", "Article", "Site", "Aug26"],
    [VENDOR, "100001", "M001", 5],
    [VENDOR, "100002", "M002", 7],
  ]);

function seed(): void {
  mkdirSync(DATA, { recursive: true });

  /* One store, in the channel under test, whose code is nothing like the ones
     in the test files. Needed because missing-site detection is gated on
     `knownSites.size > 0` — with NO store master at all, every site counts as
     known and the confirmation dialog never appears. Seeding one unrelated
     store is what makes the dialog reachable. */
  mkdirSync(join(DATA, "store-files"), { recursive: true });
  writeFileSync(
    join(DATA, "store-files", "merged.json"),
    JSON.stringify([
      { siteNum: "Z999", storeName: "Refusal Log Test Store", channel: "MAKRO", subChannel: "", status: "Open" },
    ]),
  );

  const clients = [
    {
      id: CLIENT_ID,
      name: CLIENT_NAME,
      vendorNumbers: [VENDOR],
      active: true,
      createdAt: new Date().toISOString(),
      channelIds: [],
      linkedClientIds: [],
      controlFiles: { links: null, pmf: null },
    },
  ];
  writeFileSync(join(DATA, "clients.json"), JSON.stringify(clients));

  const users = [
    {
      id: "test-user-refusal-log",
      name: "Refusal Log Test",
      email: TEST_EMAIL,
      password: bcrypt.hashSync(TEST_PASSWORD, 10),
      role: "super_admin",
      forcePasswordChange: false,
      active: true,
      createdAt: new Date().toISOString(),
    },
  ];
  writeFileSync(join(DATA, "users.json"), JSON.stringify(users));

  console.log(
    `Seeded data/clients.json ("${CLIENT_NAME}", vendor ${VENDOR}), a one-store ` +
      `store master, and a local-only test user. data/ is gitignored and is never ` +
      `the production store — lib/blob.ts only talks to Blob when BLOB_READ_WRITE_TOKEN is set.`,
  );
}

async function login(): Promise<string> {
  const res = await fetch(`${APP}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Login failed (${res.status}). Delete data/users.json and re-seed.`);
  }
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("Login returned no session cookie.");
  return cookie.split(";")[0];
}

function readLog(): { action: string; details?: string; status?: string; clientName?: string }[] {
  const p = join(DATA, "activity-log.json");
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf-8"));
}

/* uploads/index.json, NOT uploads.json — the first version of this test read a
   path that never exists, so "nothing reached the upload index" passed without
   ever looking at the index. A negative assertion that cannot fail is worse
   than no assertion. */
function readUploadIndex(): unknown[] {
  const p = join(DATA, "uploads", "index.json");
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    return Array.isArray(raw) ? raw : Object.values(raw);
  } catch {
    return [];
  }
}

interface Attempt {
  label: string;
  file: Buffer;
  fileName: string;
  channelId: string;
  month: string;
  week: string;
  expectStatus: number;
  expectMessage: RegExp;
  expectAction: string;
  expectLogStatus: string;
  expectDetails: RegExp[];
}

async function post(a: Attempt) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(a.file)]), a.fileName);
  form.append("clientId", CLIENT_ID);
  form.append("channelId", a.channelId);
  form.append("fileType", "dispo");
  form.append("reportYear", "2026");
  form.append("reportMonth", a.month);
  form.append("reportWeek", a.week);
  const res = await fetch(`${APP}/api/uploads`, {
    method: "POST",
    headers: { cookie: COOKIE },
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  if (
    !existsSync(join(DATA, "clients.json")) ||
    !existsSync(join(DATA, "users.json")) ||
    !existsSync(join(DATA, "store-files", "merged.json"))
  ) {
    seed();
    console.log("\nNow start the dev server (npm run dev) and run this script again.");
    return;
  }

  let channels: { id: string; name: string; parentId?: string; active: boolean }[];
  try {
    COOKIE = await login();
    const res = await fetch(`${APP}/api/channels`, { headers: { cookie: COOKIE } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    channels = await res.json();
  } catch (e) {
    console.error(
      `Could not reach ${APP} (${e instanceof Error ? e.message : String(e)}).\n` +
        "Start the dev server first: npm run dev",
    );
    process.exit(1);
  }

  const main1 = channels.find((c) => !c.parentId && c.active);
  if (!main1) {
    console.error("No main channel found — the app seeds these on first read, try again.");
    process.exit(1);
  }
  console.log(`App: ${APP}   Channel under test: ${main1.name}\n`);

  const attempts: Attempt[] = [
    {
      /* The one Sihle hit on 7 Sep 2026: a DISPO whose month column the parser
         could not read as September, stamped September. */
      label: "Selected month is not in the file",
      file: goodDispo(),
      fileName: "MONTH MISMATCH (892-W1) MB.xlsx",
      channelId: main1.id,
      month: "9",
      week: "1",
      expectStatus: 400,
      expectMessage: /that month is not in this DISPO/i,
      expectAction: "upload_refused",
      expectLogStatus: "error",
      expectDetails: [
        /MONTH MISMATCH \(892-W1\) MB\.xlsx/,
        new RegExp(CLIENT_NAME),
        /Wk1 Sep 2026/,
        /it found Aug 2026/,
      ],
    },
    {
      label: "Vendor in the file is not on the client",
      file: xlsxBuffer([
        ["Vendor", "Article", "Site", "Aug26"],
        ["99999", "100001", "M001", 5],
      ]),
      fileName: "WRONG VENDOR (99999-W1) MB.xlsx",
      channelId: main1.id,
      month: "8",
      week: "1",
      expectStatus: 400,
      expectMessage: /do not match client's vendor numbers/i,
      expectAction: "upload_refused",
      expectLogStatus: "error",
      expectDetails: [/WRONG VENDOR/, /vendor\(s\) 99999/],
    },
    {
      /* The previously WORST case: a thrown parse error. Only "Could not find
         header row" ever reached the loader intact; anything else became
         "Internal server error" with the cause left in the Vercel logs. */
      label: "Unparseable file (thrown error)",
      file: xlsxBuffer([["not", "a", "dispo"], ["just", "some", "junk"]]),
      fileName: "NOT A DISPO.xlsx",
      channelId: main1.id,
      month: "8",
      week: "1",
      expectStatus: 400,
      expectMessage: /Could not find header row/i,
      expectAction: "upload_failed",
      expectLogStatus: "error",
      expectDetails: [/NOT A DISPO\.xlsx/, /Could not find header row/],
    },
    {
      /* Not a refusal — a decision put to a person. With no store master
         seeded, every site is unknown, which is exactly what raises the
         confirmation dialog. Walking away from it used to leave no trace. */
      label: "Held at the confirmation dialog (unknown stores)",
      file: goodDispo(),
      fileName: "UNKNOWN STORES (892-W1) MB.xlsx",
      channelId: main1.id,
      month: "8",
      week: "1",
      expectStatus: 200,
      expectMessage: /unknown store/i,
      expectAction: "upload_warned",
      expectLogStatus: "warning",
      expectDetails: [/UNKNOWN STORES/, /Nothing was loaded/],
    },
  ];

  for (const a of attempts) {
    console.log(a.label);
    const before = readLog().length;
    const indexBefore = readUploadIndex().length;
    const { status, body } = await post(a);

    const shown = String(body.error ?? body.warning ?? "");
    check(`HTTP ${a.expectStatus}`, status === a.expectStatus, `got ${status}`);
    check("loader still sees the message", a.expectMessage.test(shown), `got: ${shown.slice(0, 160)}`);

    const log = readLog();
    check("an entry was written", log.length === before + 1, `${before} -> ${log.length}`);
    const entry = log[0];
    check(`action is ${a.expectAction}`, entry?.action === a.expectAction, `got ${entry?.action}`);
    check(`status is ${a.expectLogStatus}`, entry?.status === a.expectLogStatus, `got ${entry?.status}`);
    for (const re of a.expectDetails) {
      check(`details name ${re}`, re.test(entry?.details ?? ""), `got: ${entry?.details ?? "(none)"}`);
    }
    /* The property that matters most: none of these may reach the index the
       DISPO checklist reads. A refused load that showed the week as loaded
       would be a worse bug than the silence this change fixes. */
    const indexAfter = readUploadIndex().length;
    check("nothing reached the upload index", indexAfter === indexBefore, `${indexBefore} -> ${indexAfter}`);
    console.log("");
  }

  console.log(
    failures === 0
      ? "\nAll assertions passed."
      : `\n${failures} assertion(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
