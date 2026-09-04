/* A DISPO must not load into a channel that is not its own.

   Built from the real 4 Aug 2026 incident: the Tramontina MAKRO file loaded into
   MASSBUILD. The site codes below are the real ones (Makro writes M01, Massbuild
   writes M001), which is the whole reason the mangled-code repair folded one onto
   the other and let the load through.

   The test that matters most is the LAST group: the check must NOT fire on a
   genuinely Excel-mangled file, because that is the case the repair exists for
   and blocking it would be a new outage. A guard that fires on everything is the
   same as no guard.

   Pure functions, no storage. Run: npx tsx scripts/test-channel-fit.ts          */

import { judgeChannelFit, wrongChannelMessage } from "../lib/channelFit";
import type { Channel, StoreRecord } from "../lib/types";

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? "  — " + d : ""}`); } };
const eq = (l: string, a: unknown, b: unknown) =>
  ok(l, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);

/* The live channel shape: Walmart is a MAIN channel and Makro's companion, so a
   Makro export legitimately carries Walmart stores and the two score together.
   Game has no store master at all. */
const ch = (id: string, name: string, parentId?: string, companionChannelIds?: string[]) =>
  ({ id, name, parentId, companionChannelIds } as unknown as Channel);

const CHANNELS: Channel[] = [
  ch("makro", "MAKRO", undefined, ["walmart"]),
  ch("walmart", "WALMART"),
  ch("massbuild", "MASSBUILD"),
  ch("game", "GAME"),
  ch("bex", "BEX", "massbuild"),
];

const store = (siteNum: string, channel: string) => ({ siteNum, channel, storeName: siteNum, subChannel: "", status: "ACTIVE" } as StoreRecord);

/* Real code shapes. Makro pads to two digits, Massbuild to three — that single
   difference is what normalizeSiteKey folds together. */
const MAKRO_CODES = ["M01", "M04", "M06", "M07", "M08", "M09", "M10", "M14", "M15", "M16", "M17", "M18", "M19", "M20", "M21", "M22", "M23", "M24", "M25", "M26", "M27", "M28", "M31", "M904", "M906", "W01", "W02"];
const MASSBUILD_CODES = ["M001", "M004", "M006", "M007", "M008", "M009", "M010", "M014", "M015", "M016", "M017", "M018", "M019", "M020", "M021", "M022", "M023", "M024", "M025", "M026", "M027", "M028", "M031", "B001", "B002", "B003", "S001", "S002", "I001", "R001", "R002", "D102"];
const WALMART_CODES = ["A01", "A02", "A03", "N01"];

const STORES: StoreRecord[] = [
  ...MAKRO_CODES.map((c) => store(c, "MAKRO")),
  ...MASSBUILD_CODES.map((c) => store(c, "MASSBUILD")),
  ...WALMART_CODES.map((c) => store(c, "WALMART")),
];

/* The two real files. */
const MAKRO_FILE = ["M01", "M04", "M06", "M07", "M08", "M09", "M10", "M14", "M15", "M16", "M17", "M18", "M19", "M20", "M21", "M22", "M23", "M24", "M25", "M26", "M27", "M28", "M31", "M904", "M906", "W01"];
const MASSBUILD_FILE = ["M001", "M009", "M015", "M022", "M026", "B001", "B002", "S001", "S002", "I001", "D102"];

const judge = (sites: string[], into: string) => judgeChannelFit(sites, into, CHANNELS, STORES);

function main() {
  console.log("\nThe incident: the MAKRO file, loaded into MASSBUILD");
  const bad = judge(MAKRO_FILE, "massbuild");
  ok("is refused", bad.wrongChannel);
  eq("...on 0 exact Massbuild matches", bad.selected.exact, 0);
  eq("...against 26 exact Makro ones", bad.rival?.exact, 26);
  ok("...and the message names the channel it should have gone to",
    wrongChannelMessage(bad, "MASSBUILD").includes("MAKRO"));
  ok("...and says nothing was loaded",
    wrongChannelMessage(bad, "MASSBUILD").includes("Nothing has been loaded"));

  console.log("\nThe same two files, loaded correctly");
  ok("the Makro file into MAKRO loads", !judge(MAKRO_FILE, "makro").wrongChannel);
  ok("the Massbuild file into MASSBUILD loads", !judge(MASSBUILD_FILE, "massbuild").wrongChannel);
  ok("and the Massbuild file into MAKRO is refused", judge(MASSBUILD_FILE, "makro").wrongChannel);

  console.log("\nA Makro export carrying its companion's stores is still a Makro export");
  const withWalmart = judge([...MAKRO_FILE, "A01", "A02", "A03"], "makro");
  ok("Walmart sites in a Makro file do not make it a Walmart file", !withWalmart.wrongChannel);
  eq("...because the group is scored together", withWalmart.selected.exact, 29);

  console.log("\nWhat must NOT fire — these are ordinary loads");
  /* Excel eats the leading zeros off the WHOLE file, so M001 arrives as M1 and
     B001 as B1. That is a file whose own channel no longer recognises a single
     code — the exact shape this guard could wrongly block, and the exact shape
     the site repair was written to rescue. */
  const mangled = MASSBUILD_FILE.map((c) => c.replace(/^([A-Z]+)0*(\d+)$/, "$1$2"));
  const m = judge(mangled, "massbuild");
  eq("a mangled file loses almost every match in its own channel", m.selected.exact, 1);
  /* And it drifts the WRONG WAY: stripping the zeros off M001/M015/M022 mints
     M1/M15/M22, and M15/M22/M26 are real MAKRO codes. So mangling does not just
     lose matches, it hands some to the rival. A guard that fired on "the rival
     leads" would block this file. It has to be a near-total claim. */
  eq("...and hands a few to the rival by accident", m.rival?.exact, 3);
  ok("...but 3 of 11 is nowhere near a claim on the file, so it loads", !m.wrongChannel);

  const newStores = judge(["M001", "M009", "B001", "ZZ1", "ZZ2", "ZZ3", "ZZ4", "ZZ5"], "massbuild");
  ok("a file with stores missing from the master still loads", !newStores.wrongChannel);

  const game = judge(["G01", "G02", "G03", "G04", "G05", "G06"], "game");
  ok("a channel with no store master is never blocked", !game.wrongChannel);
  eq("...and says so rather than pretending to have judged", game.ruled, false);

  const tiny = judge(["M01", "M04"], "massbuild");
  ok("a two-site file is too small to argue with", !tiny.wrongChannel);
  eq("...and says so", tiny.ruled, false);

  console.log("\nA partial overlap must not be enough on its own");
  /* Half the file in the rival's master and half in the selected one's is an
     argument, not a verdict. Only a near-total claim by the rival fires. */
  const half = judge(["M01", "M04", "M06", "M07", "M001", "M004", "M006", "M007"], "massbuild");
  ok("a 50/50 split loads rather than blocking", !half.wrongChannel,
    `selected ${half.selected.exact}, rival ${half.rival?.exact}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
