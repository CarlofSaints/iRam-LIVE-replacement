/* Verifies the rule that wedged production on 6 Aug 2026: an EXPIRED lock
   coming back from the read-after-write must never be treated as a live
   holder. Run: npx tsx scripts/test-upload-lock.ts */
import { classifyVerify, classifyRelease, isExpired, UploadLock } from "../lib/uploadLock";

const NOW = new Date("2026-08-06T10:00:00.000Z").getTime();
const TTL_MIN = 6;

const lock = (id: string, minutesAgo: number, userName = "Someone"): UploadLock => ({
  id,
  userId: "u-" + id,
  userName,
  clientName: "CLIENT",
  fileName: "f.xlsx",
  startedAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
});

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${actual}, want ${expected})`}`);
}

// ── expiry ──
check("a 3-minute-old lock is live", isExpired(lock("a", 3), NOW), false);
check(`a ${TTL_MIN + 3}-minute-old lock is expired`, isExpired(lock("a", TTL_MIN + 3), NOW), true);

// ── the production case, exactly as screenshotted ──
// Sihle's lock was 9 minutes old (TTL is 6). The old code read it back after
// our own write and reported it as the live holder, forever.
check(
  "THE BUG: a 9-minute-old lock read back after our write does not beat us",
  classifyVerify(lock("sihle", 9, "Sihle"), "carl", NOW),
  "retry",
);

// ── normal outcomes ──
check("our own id read back = we won", classifyVerify(lock("carl", 0), "carl", NOW), "won");
check(
  "a different, still-running lock = we lost",
  classifyVerify(lock("sihle", 2, "Sihle"), "carl", NOW),
  "lost",
);
check("nothing stored yet = keep looking", classifyVerify(null, "carl", NOW), "retry");
check(
  "a lock exactly at the TTL boundary still counts as live",
  classifyVerify(lock("sihle", TTL_MIN - 0.01), "carl", NOW),
  "lost",
);
check(
  "a stale read of an already-released lock does not beat us",
  classifyVerify(lock("old", TTL_MIN + 30), "carl", NOW),
  "retry",
);

// ── the wedge itself: repeated attempts must eventually get through ──
// Simulate the loop against a store whose reads never catch up and keep
// returning the same dead lock. Old behaviour: blocked on attempt 1, forever.
const VERIFY_ATTEMPTS = 4;
let verdicts: string[] = [];
for (let i = 0; i < VERIFY_ATTEMPTS; i++) {
  verdicts.push(classifyVerify(lock("sihle", 9 + i, "Sihle"), "carl", NOW));
}
check(
  "a permanently-lagging read never blocks: no attempt says lost",
  verdicts.includes("lost"),
  false,
);
// ...and the loop falls through to "we hold it" once attempts run out.
check("all attempts inconclusive", verdicts.every((v) => v === "retry"), true);

// ── RELEASING: the 25 Aug 2026 case ──
// A load that finished at 14:32 still read as busy at 14:38:30 — its startedAt
// plus exactly the TTL. The release had read the lock back, seen a stale value
// that was not its own id, concluded "not mine to clear", and written nothing.
// Every DISPO was blocking the next one for six minutes.
check(
  "THE BUG: a stale read of an OLDER lock must not stop us clearing ours",
  classifyRelease(lock("previous", 8), "ours", lock("ours", 5).startedAt),
  "clear",
);
check("our own id reads back = clear", classifyRelease(lock("ours", 2), "ours", lock("ours", 2).startedAt), "clear");
check("nothing there = clear", classifyRelease(null, "ours", lock("ours", 2).startedAt), "clear");
// The guard still has to work: a genuine successor took the lock after we did.
check(
  "a NEWER lock is a real successor — leave it",
  classifyRelease(lock("successor", 1), "ours", lock("ours", 5).startedAt),
  "leave",
);
// Same instant is not a successor: it cannot have started after us.
check(
  "an identical timestamp is not a successor",
  classifyRelease(lock("other", 5), "ours", lock("ours", 5).startedAt),
  "clear",
);
// Called with only an id (no clock), we cannot tell the two apart — leave it,
// because freeing a live lock loses data and the TTL still bounds ours.
check(
  "no clock to compare = leave the other lock alone",
  classifyRelease(lock("other", 8), "ours", null),
  "leave",
);
check(
  "an unparseable timestamp is treated the same way",
  classifyRelease({ ...lock("other", 8), startedAt: "not a date" }, "ours", lock("ours", 5).startedAt),
  "leave",
);

console.log(failed === 0 ? "\nAll upload-lock checks passed." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
