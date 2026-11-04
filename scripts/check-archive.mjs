// Checks past-order retention (domain/archiveRetention.ts): a finished
// conversation lives 30 days after it was archived, an undated one from before
// 2026-11-04 gets its date at first load and is never dropped on a guess.
// Run after `npm run build`:  node scripts/check-archive.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { stampArchive, pruneArchive, ARCHIVE_KEEP_MS, ARCHIVE_KEEP_DAYS } = require("../dist/main/domain/archiveRetention.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0); // 2026-11-04 12:00Z
const conv = (title, endedAt) => ({ title, messages: [{ from: "you", text: title }], sdkSessionId: null, ...(endedAt == null ? {} : { endedAt }) });

console.log("the window:");
ok(ARCHIVE_KEEP_DAYS === 30 && ARCHIVE_KEEP_MS === 30 * DAY, "a past order is kept 30 days");
{
  const arch = [conv("old", NOW - 31 * DAY), conv("edge", NOW - 30 * DAY), conv("fresh", NOW - 1 * DAY), conv("today", NOW)];
  const r = pruneArchive(arch, NOW);
  ok(r.dropped === 1 && r.kept.map((s) => s.title).join(",") === "edge,fresh,today", "31 days old is dropped; exactly 30 days, 1 day and today stay");
  ok(arch.length === 4, "the input list is not touched (the caller swaps it in)");
}

console.log("undated conversations from before 2026-11-04:");
{
  const arch = [conv("legacy-1"), conv("legacy-2"), conv("dated", NOW - 40 * DAY)];
  ok(pruneArchive(arch, NOW).kept.length === 2 && pruneArchive(arch, NOW).kept.every((s) => s.title.startsWith("legacy")), "an undated one is never dropped, the dated 40-day-old one is");
  const n = stampArchive(arch, NOW);
  ok(n === 2 && arch[0].endedAt === NOW && arch[1].endedAt === NOW && arch[2].endedAt === NOW - 40 * DAY, "stamping dates only the undated ones, with today");
  ok(stampArchive(arch, NOW + DAY) === 0, "a second load stamps nothing");
  ok(pruneArchive(arch, NOW + 29 * DAY).dropped === 1, "29 days after the stamp the legacy ones still stand");
  ok(pruneArchive(arch, NOW + 31 * DAY).dropped === 3, "31 days after the stamp they go too");
}

console.log("robustness:");
{
  ok(pruneArchive([], NOW).kept.length === 0 && pruneArchive([], NOW).dropped === 0, "an empty archive stays empty");
  const bad = [conv("zero", 0), conv("neg", -5), conv("str", "2026-01-01")];
  ok(pruneArchive(bad, NOW).dropped === 0 && stampArchive(bad, NOW) === 3, "a zero, negative or string date counts as undated (stamped, not dropped)");
}

console.log(fails ? `\n${fails} check(s) failed` : "\nall past-order retention checks passed");
process.exit(fails ? 1 : 0);
