/* The channel-fit guard, run against the REAL merged store master.

   The unit test beside this one uses a hand-made master. This one uses the
   actual codes, snapshotted from production on 4 Sep 2026, because the whole
   risk of this guard is a FALSE POSITIVE: blocking a DISPO that is in the right
   place would stop the business, which is far worse than the bug it prevents.

   The case that has to be proven safe is the Excel-mangled file. That is not
   hypothetical and it is not rare: 15 of the last 161 DISPO loads repaired
   mangled site codes, one of them across 5,726 rows. Those files DO score
   almost nothing against their own channel, which is exactly the shape the
   guard could wrongly fire on. It must not, and the reason it does not has to
   be measured rather than assumed: a mangled code has to land VERBATIM on
   another channel's real code to move that channel's score, and the two masters
   pad differently (Makro M01, Massbuild M001), so it almost never does.

   Snapshot, not live data. If the store masters change shape — say Massbuild
   re-pads to two digits — this test is where that shows up, and the thresholds
   in lib/channelFit.ts need re-checking.

   Run: npx tsx scripts/test-channel-fit-real-stores.ts                        */

import { judgeChannelFit } from "../lib/channelFit";
import type { Channel, StoreRecord } from "../lib/types";

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? "  — " + d : ""}`); } };

/* Production channel shape, 4 Sep 2026. Walmart is a main channel AND Makro's
   companion; every Massbuild sub-channel rolls up to massbuild; Game exists
   with no store master at all. */
const CHANNELS: Channel[] = ([
  { id: "makro", name: "MAKRO", companionChannelIds: ["walmart"] },
  { id: "walmart", name: "WALMART", companionChannelIds: [] },
  { id: "massbuild", name: "MASSBUILD", companionChannelIds: [] },
  { id: "game", name: "GAME", companionChannelIds: [] },
  { id: "bex", name: "BEX", parentId: "massbuild", companionChannelIds: [] },
  { id: "bwh", name: "BWH", parentId: "massbuild", companionChannelIds: [] },
] as unknown[]) as Channel[];

const MASSBUILD = "B01 B02 B08 B09 B14 B15 B17 B20 B200 B201 B202 B203 B204 B205 B206 B207 B208 B21 B23 B25 B27 B28 B30 B31 B32 B33 B34 B35 B36 B37 B38 B39 B40 B41 B42 B43 B44 B45 B46 B47 B48 B49 B50 B51 B98 B99 BRH C001 D100 D101 D102 D103 D104 D105 D106 D107 D108 D110 I001 I002 I003 I004 I005 I006 I007 I008 I009 I010 I011 I012 I013 I014 I015 I016 I017 I018 I019 I020 I021 I022 I023 I024 M001 M002 M003 M004 M005 M006 M007 M008 M009 M010 M011 M012 M013 M014 M015 M016 M017 M018 M019 M020 M021 M022 M023 M024 M025 M026 M027 M028 M029 M030 M031 M034 M035 M036 M037 M038 M039 M040 M041 M042 M043 M044 M045 M046 M047 M048 M049 M050 M051 M052 M053 M054 M055 M056 M500 M501 M502 R000 R001 R002 R003 R004 R005 R006 R007 R008 R009 R010 R011 R012 R013 R014 R015 R016 R017 R018 R019 R020 R021 R022 R023 S110 S111 S112 S113 S114 S115 S116 S117 S118 S119 S120 S121 S122 S123 S124 S125 S126 S127 S128 S130 S131 S132 S139 S140 S143 S145 S148 S149 S151 S153 S55 S56 S57 S58 S59 S60 S61 S62 S63 S64 S65 S66 S67 S68 S69 S70 S71 S72 S73 S74 S75 S76 S77 S78 S79 S80 S81 S82 S83 S85 S86 S87 S89 S90 S91 S92 S93 S94 T03 T05 T10 T12 T13 T18 T24 T26 T48 T49 W930 W941 W942 W945 W949 W951 W952 W953 W964 W965 W966 W969";

const MAKRO = "M01 M01L M01W M03 M03L M04 M04L M04W M06 M06L M06W M07 M07L M07W M08 M08L M08W M09 M09L M09W M10 M10L M10W M14 M14L M14W M15 M15L M15W M16 M16L M16W M17 M17L M17W M18 M18L M18W M19 M19L M19W M20 M20L M20W M21 M21L M21W M22 M22L M22W M23 M23L M23W M24 M24L M24W M25 M25L M25W M26 M26L M26W M27 M27L M27W M28 M28L M28W M29 M29L M29W M30L M30W M31 M31L M700 M800 M810 M850 M900 M901 M902 M903 M904 M905 M905_1 M906 M907 M910 M926 M928 M930 M932 M940 M990 ONLINE U01 U02L U03 U03L U04 U04L W01 W01L W02 W02L W03 W03L W04 W04L W05 W05L W06 W06L W07 W07L W08 W09L W10 W11 W11L W12 W13L W14 W14L W15 W16 W16L W17 W17L W18 W18L W19 W19L W20 W20L W21 W22 W22L W23 W23L W24 W24L W25 W25L W26 W26L W27 W27L W28 W28L W29 W29L W30 W30L W31 W31L W32 W32L W33 W33L W34 W34L W35 W35L W36 W36L W37 W37L W39L W40L W41L W42 W42L WO8";

const WALMART = "A01 A02 A03 A04 A05 A06 A07 A08 A09 A10 A11 N10 N01 N04 N24 N09 N16 N17";

/* The real Tramontina MAKRO file, the one loaded into MASSBUILD on 4 Aug. */
const MAKRO_FILE = "M22 M27 M01 M04 M06 M07 M08 M09 M10 M14 M15 M16 M17 M18 M19 M20 M21 M23 M24 M25 M26 M28 M31 M904 M906 M29".split(" ");

const codes = (s: string) => s.split(" ").filter(Boolean);
const STORES: StoreRecord[] = [
  ...codes(MASSBUILD).map((c) => ({ siteNum: c, channel: "MASSBUILD" } as StoreRecord)),
  ...codes(MAKRO).map((c) => ({ siteNum: c, channel: "MAKRO" } as StoreRecord)),
  ...codes(WALMART).map((c) => ({ siteNum: c, channel: "WALMART" } as StoreRecord)),
];

const judge = (sites: string[], into: string) => judgeChannelFit(sites, into, CHANNELS, STORES);

/* What Excel actually does to these codes: eats the leading zeros off an
   alpha-prefixed number, which is the whole reason normalizeSiteKey and the
   site repair exist. R001 arrives as R1, M001 as M1, B01 as B1. */
const mangle = (c: string) => c.replace(/^([A-Za-z]+)0+(\d+)$/, "$1$2");

function main() {
  console.log("\nThe incident, against the real store master");
  const bad = judge(MAKRO_FILE, "massbuild");
  ok("the Makro file is refused by MASSBUILD", bad.wrongChannel,
    `selected ${bad.selected.exact}, rival ${bad.rival?.label} ${bad.rival?.exact} of ${bad.siteCount}`);
  ok("...and the same file loads into MAKRO", !judge(MAKRO_FILE, "makro").wrongChannel);

  console.log("\nEvery channel's own stores load into their own channel");
  for (const [name, id, list] of [["Massbuild", "massbuild", MASSBUILD], ["Makro", "makro", MAKRO], ["Walmart", "walmart", WALMART]] as const) {
    const v = judge(codes(list), id);
    ok(`${name}'s own codes load into ${name}`, !v.wrongChannel,
      `selected ${v.selected.exact}, rival ${v.rival?.exact}`);
  }

  console.log("\nTHE ONE THAT MATTERS — an Excel-mangled file must still load");
  for (const [name, id, list] of [["Massbuild", "massbuild", MASSBUILD], ["Makro", "makro", MAKRO], ["Walmart", "walmart", WALMART]] as const) {
    const mangled = codes(list).map(mangle);
    const v = judge(mangled, id);
    const changed = codes(list).filter((c) => mangle(c) !== c).length;
    ok(`a mangled ${name} file (${changed} codes altered) is NOT blocked`, !v.wrongChannel,
      `selected ${v.selected.exact}, rival ${v.rival?.label} ${v.rival?.exact} of ${v.siteCount}`);
  }

  console.log("\nWhy that holds: mangling almost never lands on a rival's real code");
  for (const [name, id, list] of [["Massbuild", "massbuild", MASSBUILD], ["Makro", "makro", MAKRO]] as const) {
    const mangled = codes(list).map(mangle);
    const v = judge(mangled, id);
    const rivalShare = v.rival ? v.rival.exact / v.siteCount : 0;
    ok(`${name} mangled: the best rival claims ${(rivalShare * 100).toFixed(1)}%, well under the 80% needed`,
      rivalShare < 0.5, `${v.rival?.label} took ${v.rival?.exact} of ${v.siteCount}`);
  }

  console.log("\nA group-mate is not a rival");
  /* Makro and Walmart name each other as companions and hold the same stores,
     so whichever of the two is picked the other scores the same. Reporting it
     as the channel the file "should" have gone to would be nonsense. */
  const mk = judge(codes(MAKRO), "makro");
  ok("MAKRO's rival is not WALMART", mk.rival?.label !== "WALMART" && !/WALMART/.test(mk.rival?.label ?? ""),
    `rival was ${mk.rival?.label}`);
  ok("...it is MASSBUILD, which claims almost none of the file", (mk.rival?.exact ?? 0) < 10,
    `${mk.rival?.label} took ${mk.rival?.exact} of ${mk.siteCount}`);
  ok("and a Makro file loaded into WALMART is not blocked either",
    !judge(codes(MAKRO), "walmart").wrongChannel);

  console.log("\nA Makro DISPO carrying its Walmart companion stores is still Makro");
  const withCompanion = judge([...MAKRO_FILE, "A01", "A02", "A03", "N01"], "makro");
  ok("companion stores do not push it to WALMART", !withCompanion.wrongChannel);

  console.log("\nGame has no store master, so it is never judged");
  const game = judge(["M01", "M04", "M06", "M07", "M08", "M09"], "game");
  ok("a Game load is not blocked", !game.wrongChannel);
  ok("...and reports that it formed no opinion", !game.ruled);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
