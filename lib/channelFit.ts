/* Is this DISPO even for the channel the loader picked?

   On 4 Aug 2026 a MAKRO DISPO was loaded into MASSBUILD and nothing complained.
   Its 169 rows then reported as Massbuild for a month: 24 of that report's 223
   Margin RISK lines, 98 of 761 OPPORTUNITY, 1,359 units of SOH.

   Two checks both said yes. The vendor check is CLIENT-wide — 12908 is one of
   Tramontina's vendor numbers, and channel-to-vendor was never modelled. And
   the Excel-mangled site-code repair, scoped to the channel the loader picked,
   rewrote 24 of the file's 26 Makro store codes into Massbuild ones, because
   normalizeSiteKey folds "M01" and "M001" onto the same key. Every site then
   matched, missingSites came back empty, and the load logged a clean success.

   THE ORDER WAS THE WHOLE DEFECT: the tolerant match ran first and destroyed the
   evidence the guard needed. So this runs on the RAW codes, before any repair.

   What separates the two cases is EXACT membership of a store master, measured
   on the real files:

                                    MAKRO group   MASSBUILD group
       the Makro file, 26 sites      26 exact       0 exact
       the Massbuild file, 149       0 exact      133 exact

   Note what is NOT the signal. Prefixes look like one and are not: Massbuild
   store codes run B I S R M T W D C and Makro M W U, so M and W overlap and
   "only M codes means Makro" would misfire. Nor is "few exact matches" on its
   own — that is exactly what a genuinely Excel-mangled file looks like, which
   is why the repair exists in the first place.

   So the verdict is COMPARATIVE, and only ever fires when some OTHER channel
   claims the file almost completely while the selected one claims almost none
   of it. A mangled file scores near zero everywhere and loads as before. */

import { buildChannelGroup } from "./channelGroup";
import type { Channel, StoreRecord } from "./types";

/* Below this many distinct sites a file is too small to argue with: a handful
   of DC lines can sit in one channel's master by coincidence. */
const MIN_SITES = 5;

/* The rival has to claim nearly the whole file... */
const RIVAL_MIN_SHARE = 0.8;
/* ...and the selected channel has to be nowhere near it. Both, so that an
   ordinary file with some stores missing from its master still loads. */
const SELECTED_MAX_SHARE_OF_RIVAL = 0.2;

export interface ChannelScore {
  mainChannelId: string;
  label: string;
  /** Distinct file sites present VERBATIM in this channel group's store master. */
  exact: number;
}

export interface ChannelFitVerdict {
  /** False when there was not enough to form an opinion — never blocks. */
  ruled: boolean;
  /** Why not, when ruled is false. */
  reason: string;
  siteCount: number;
  selected: ChannelScore;
  /** Best-scoring channel group OTHER than the selected one. */
  rival: ChannelScore | null;
  wrongChannel: boolean;
  scores: ChannelScore[];
}

const code = (raw: unknown): string => String(raw ?? "").trim().toLowerCase();

export function judgeChannelFit(
  fileSites: unknown[],
  selectedMainChannelId: string,
  allChannels: Channel[],
  stores: StoreRecord[],
): ChannelFitVerdict {
  const distinct = [...new Set(fileSites.map(code).filter(Boolean))];

  const mains = allChannels.filter((c) => !c.parentId);
  const byName = new Map<string, Channel>();
  for (const c of allChannels) byName.set(c.name.trim().toUpperCase(), c);

  /* The merged store master names its channel as a string, so resolve it to a
     channel record and then to that record's MAIN channel. */
  const codesByMain = new Map<string, Set<string>>();
  for (const s of stores) {
    const ch = byName.get(String(s.channel ?? "").trim().toUpperCase());
    const site = code(s.siteNum);
    if (!ch || !site) continue;
    const mainId = ch.parentId ?? ch.id;
    let set = codesByMain.get(mainId);
    if (!set) { set = new Set(); codesByMain.set(mainId, set); }
    set.add(site);
  }

  /* Score the GROUP, not the single channel: a Makro export legitimately
     carries Walmart stores, and the report side reads the same group. */
  const scoreOf = (mainId: string): ChannelScore => {
    const group = buildChannelGroup(mainId, allChannels);
    const codes = new Set<string>();
    for (const member of group) {
      for (const c of codesByMain.get(member.id) ?? []) codes.add(c);
    }
    return {
      mainChannelId: mainId,
      label: group.map((g) => g.name).join(" + "),
      exact: distinct.filter((d) => codes.has(d)).length,
    };
  };

  const scores = mains.map((m) => scoreOf(m.id));
  const selected =
    scores.find((s) => s.mainChannelId === selectedMainChannelId) ?? scoreOf(selectedMainChannelId);

  /* A GROUP-MATE is not a rival. Makro and Walmart name each other as
     companions, so they are scored on the same union and land within a point or
     two of each other on any Makro file. Left in, the "rival" reported to the
     loader would be a channel that holds the same stores, and the advice would
     be nonsense. It can never trigger a refusal either — a group-mate scoring
     high means the SELECTED channel scored high too — so this is about the
     message being right, not about the verdict. */
  const selectedGroup = new Set(
    buildChannelGroup(selected.mainChannelId, allChannels).map((g) => g.id),
  );
  const rivals = scores
    .filter((s) => s.mainChannelId !== selected.mainChannelId)
    .filter((s) => !selectedGroup.has(s.mainChannelId))
    .filter((s) => !buildChannelGroup(s.mainChannelId, allChannels)
      .some((g) => g.id === selected.mainChannelId))
    .sort((a, b) => b.exact - a.exact);
  const rival = rivals[0] ?? null;

  const base = { siteCount: distinct.length, selected, rival, scores };

  if (distinct.length < MIN_SITES) {
    return { ...base, ruled: false, reason: `only ${distinct.length} distinct site(s) in the file`, wrongChannel: false };
  }
  /* No store master for the selected channel means no opinion, not a failure —
     GAME has no stores loaded, and blocking those would be a new outage. */
  if (!(codesByMain.get(selected.mainChannelId)?.size)) {
    const group = buildChannelGroup(selected.mainChannelId, allChannels);
    const anyInGroup = group.some((g) => codesByMain.get(g.id)?.size);
    if (!anyInGroup) {
      return { ...base, ruled: false, reason: "no store master loaded for the selected channel", wrongChannel: false };
    }
  }
  if (!rival || rival.exact === 0) {
    return { ...base, ruled: true, reason: "no other channel claims these stores", wrongChannel: false };
  }

  const wrongChannel =
    rival.exact >= Math.ceil(RIVAL_MIN_SHARE * distinct.length) &&
    selected.exact <= SELECTED_MAX_SHARE_OF_RIVAL * rival.exact;

  return { ...base, ruled: true, reason: "", wrongChannel };
}

/** What the loader reads when the upload is refused. No jargon, and it says what to do. */
export function wrongChannelMessage(v: ChannelFitVerdict, selectedName: string): string {
  const rival = v.rival!;
  return (
    `This looks like a ${rival.label} DISPO, not a ${selectedName} one. ` +
    `${rival.exact} of its ${v.siteCount} store codes are ${rival.label} stores, and ` +
    `${v.selected.exact} of them are ${selectedName} stores. Nothing has been loaded. ` +
    `Change the channel to ${rival.label}, or upload the ${selectedName} file for this vendor. ` +
    `If this really is a ${selectedName} file, then its store codes are not in the ${selectedName} ` +
    `store master and that needs fixing before it can be loaded.`
  );
}
