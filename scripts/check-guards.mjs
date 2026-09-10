// Checks the lane's "don't waste Maksym's time" guards against REAL data from
// 25 Aug 2026 — the 33 ask_maksym calls Patrick made that day, and the CLI's
// usage-limit messages. Run after `npm run build`:  node scripts/check-guards.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { isAckOnly, parseLimitText, normalizeResetsAt, fmtClock } = require("../dist/main/adapters/guards.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };

console.log("isAckOnly — real DECISIONS must pass through:");
for (const opts of [
  ["Yes, no bonus for re-proving an already-known network", "No, still give some bonus (smaller) for re-testing", "Let me think about it / ask something else"],
  ["Code list is fine for now", "Want an admin-editable list from the start", "Let me think about it / ask something else"],
  ["Fix it now, same piece of work", "Keep it separate / later", "Let me think about it / ask something else"],
  ["Yes — take me to the filtered Plans list", "Something else — let me explain"],
  ["Yes, load the real plans in now", "No, leave staging's test plans as-is", "Let me think about it / ask something else"],
  ["Yes, restore it", "No, it's fine as is", "I'll re-add it myself"],
  ["Yes, fix the wording", "No, it's clear enough", "Show me an example first"],
  ["Yes, carry them over", "No, I'll redo them myself", "Not yet — decide later"],
  ["Yes, add it", "Not now", "Something different"],
  ["Block the claim upfront if their plan lacks pricing for that destination", "Warn them before they claim, but still allow it", "Leave as-is for now, revisit later"],
  ["Unclaimable for everyone — simplest, safest default", "Only block the different-plan case"],
  ["Close it now", "Note it and handle separately"],
  ["Fix it too", "Leave it for now"],
  ["Yes, just protect the current call — that's right", "No, exempt the whole current run until they stop"],
]) ok(!isAckOnly(opts), `passes: ${JSON.stringify(opts).slice(0, 90)}`);

console.log("isAckOnly — STATUS REPORTS must bounce:");
for (const opts of [
  ["I'll check it now", "Looks good, keep going", "Something else needs fixing first"],
  ["I'll check it now", "Looks good, keep going", "Something else needs attention"],
  ["Show me where to check", "OK, I trust it — move on", "Something's still not right"],
  ["I'll check it now", "OK, makes sense now", "Still want to look closer"],
  ["All good, nothing else", "Yes, one more thing"],
]) ok(isAckOnly(opts), `bounces: ${JSON.stringify(opts).slice(0, 90)}`);
ok(!isAckOnly([]), "empty options → not treated as ack-only");

console.log("parseLimitText — the CLI's real message:");
const now = new Date(2026, 7, 25, 13, 36).getTime(); // 25 Aug 2026 13:36 local
const p1 = parseLimitText("You've hit your session limit · resets 1:40pm (Europe/Kiev)", now);
ok(p1 && new Date(p1.resetsAt).getHours() === 13 && new Date(p1.resetsAt).getMinutes() === 40, `1:40pm → ${p1 && new Date(p1.resetsAt).toString()}`);
const p2 = parseLimitText("You've hit your session limit · resets 11:40pm (Europe/Kiev)", now);
ok(p2 && new Date(p2.resetsAt).getHours() === 23 && new Date(p2.resetsAt).getDate() === 25, `11:40pm same day → ${p2 && new Date(p2.resetsAt).toString()}`);
const p3 = parseLimitText("You've hit your session limit · resets 6:30pm (Europe/Kiev)", new Date(2026, 7, 25, 20, 0).getTime());
ok(p3 && new Date(p3.resetsAt).getDate() === 26, `6:30pm when it's already 20:00 → tomorrow: ${p3 && new Date(p3.resetsAt).toString()}`);
const p4 = parseLimitText("We hit a session limit mid-check last time — retrying the targeted confirmation pass now.", now);
ok(p4 === null, "a character merely TALKING about a past limit is not a limit signal");
ok(parseLimitText("Now let's implement the Categories.tsx badge", now) === null, "ordinary text → null");
const p5 = parseLimitText("You've hit your session limit", now);
ok(p5 && p5.resetsAt === 0, "limit text without a clock → resetsAt 0 (lane falls back to a 1h hold)");

console.log("normalizeResetsAt / fmtClock:");
ok(normalizeResetsAt(1787000000) === 1787000000 * 1000, "seconds → ms");
ok(normalizeResetsAt(1787000000000) === 1787000000000, "ms stays ms");
ok(normalizeResetsAt(undefined) === 0 && normalizeResetsAt("x") === 0, "missing/garbage → 0");
ok(/tomorrow/.test(fmtClock(new Date(2026, 7, 26, 1, 40).getTime(), now)), `past midnight says tomorrow: ${fmtClock(new Date(2026, 7, 26, 1, 40).getTime(), now)}`);
ok(!/tomorrow/.test(fmtClock(new Date(2026, 7, 25, 23, 40).getTime(), now)), `same day plain: ${fmtClock(new Date(2026, 7, 25, 23, 40).getTime(), now)}`);

console.log(fails ? `\n${fails} CHECK(S) FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
