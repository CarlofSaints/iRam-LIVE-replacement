/* The Sync Settings allow-list is the ONE switch for a channel with no data
   (Game, Sep 2026). Taking a channel out must switch it off; a channel nobody
   has named yet must never be hidden just because it is missing from the list. */
import { channelSwitchedOff, DEFAULT_CHANNELS } from "../lib/storeReportSync";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got !== want) { failures++; console.log(`FAIL  ${name}\n        got  ${got}\n        want ${want}`); }
  else console.log(`ok    ${name}`);
}

const withoutGame = DEFAULT_CHANNELS.filter((c) => c !== "Game");

check("Game is ON with the default list", channelSwitchedOff("Game", DEFAULT_CHANNELS), false);
check("Game is OFF once removed from the list", channelSwitchedOff("Game", withoutGame), true);
check("...whatever the case (store-master sub-channel GAME)", channelSwitchedOff("GAME", withoutGame), true);
check("Makro stays ON when only Game is removed", channelSwitchedOff("Makro", withoutGame), false);
check("separator-insensitive: 'Makro Liquor' vs Makro-Liquor", channelSwitchedOff("Makro Liquor", DEFAULT_CHANNELS), false);
check("Unknown is never hidden", channelSwitchedOff("Unknown", withoutGame), false);
check("SS (not a list name) is never hidden", channelSwitchedOff("SS", withoutGame), false);
check("an unnamed new banner is never hidden", channelSwitchedOff("DionWired", withoutGame), false);
check("an empty channel is never hidden", channelSwitchedOff("", withoutGame), false);
check("an empty allow-list switches every known channel off", channelSwitchedOff("BWH", []), true);

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log("\nall passed");
