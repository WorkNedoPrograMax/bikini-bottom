// Checks the lane's "don't waste Maksym's time" guards against REAL data from
// 25 Aug 2026 — the 33 ask_maksym calls Patrick made that day, and the CLI's
// usage-limit messages. Run after `npm run build`:  node scripts/check-guards.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { isAckOnly, parseLimitText, normalizeResetsAt, fmtClock, foldFuel, fuelWord, fuelWarnDue, fuelStale, fmtWhen } = require("../dist/main/adapters/guards.js");

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

// ───────────── Reserve light (Orca plan, Job 1) — replayed from the REAL log ─────────────
// 9 Sep 2026, Squidward's five-hour tank: 0.90 → 0.96 → rejected → allowed with a
// NEW reset time (7 min later, long before the old reset time), plus two plain
// `allowed` lines mid-window (no util) and the weekly window from 31 Aug.
console.log("foldFuel — 9 Sep 2026 replay (bikini.log):");
const LOG_LINES = [
  // ts, status, type, util, resetsAt (unix s) — verbatim from bikini.log
  ["2026-08-31T06:13:09.134Z", "allowed_warning", "seven_day", 0.75, 1788188400],
  ["2026-08-31T13:58:37.995Z", "allowed_warning", "seven_day", 0.9, 1788188400],
  ["2026-09-09T07:35:54.545Z", "allowed", "five_hour", undefined, 1788956400],
  ["2026-09-09T10:08:02.907Z", "allowed", "five_hour", undefined, 1788956400],
  ["2026-09-09T10:38:10.501Z", "allowed_warning", "five_hour", 0.9, 1788956400],
  ["2026-09-09T10:39:20.985Z", "allowed_warning", "five_hour", 0.91, 1788956400],
  ["2026-09-09T10:39:49.561Z", "allowed_warning", "five_hour", 0.92, 1788956400],
  ["2026-09-09T10:41:16.247Z", "allowed_warning", "five_hour", 0.93, 1788956400],
  ["2026-09-09T10:44:05.996Z", "allowed_warning", "five_hour", 0.94, 1788956400],
  ["2026-09-09T10:46:40.574Z", "allowed_warning", "five_hour", 0.95, 1788956400],
  ["2026-09-09T10:50:17.283Z", "allowed_warning", "five_hour", 0.96, 1788956400],
  ["2026-09-09T11:15:36.800Z", "rejected", "five_hour", undefined, 1788956400],
  ["2026-09-09T11:22:10.625Z", "allowed", "five_hour", undefined, 1788970800],
];
const EMPTY = { fiveHour: null, sevenDay: null };
let fuel = EMPTY, warnedFor = 0, warnings = 0;
const replay = (n) => {
  const [ts, status, type, util, resetsAt] = LOG_LINES[n];
  const at = Date.parse(ts);
  const next = foldFuel(fuel, { type, status, util, resetsAt, at }, at);
  if (fuelWarnDue(fuel, next, warnedFor)) { warnings++; warnedFor = next.fiveHour.resetsAt; }
  fuel = next;
  return at;
};
// 31 Aug — the weekly window lights up on its own, the 5-hour stays dark.
replay(0);
ok(fuel.sevenDay && fuel.sevenDay.level === "amber" && fuel.sevenDay.util === 0.75, "weekly 0.75 → amber (the lowest level Claude ever reports)");
ok(fuel.fiveHour === null, "…and the 5-hour tank is untouched (separate gauge)");
ok(warnings === 0, "no phone warning for the weekly window (the heads-up is about the 5-hour tank)");
let t = replay(1);
ok(fuel.sevenDay.level === "red" && fuel.sevenDay.util === 0.9, "weekly 0.90 → red");
ok(/^Weekly reserve · 90% used · resets /.test(fuelWord(fuel.sevenDay, t, "Weekly reserve")), `weekly word: ${fuelWord(fuel.sevenDay, t, "Weekly reserve")}`);
// 9 Sep 07:35 — a plain `allowed` opens the day: dark, but we know the window.
t = replay(2);
ok(fuel.fiveHour && fuel.fiveHour.level === "dark" && fuel.fiveHour.util === null, "first `allowed` → dark gauge (util unknown)");
ok(fuel.fiveHour.resetsAt === 1788956400 * 1000, "…with the window's reset time (unix s → ms)");
ok(fuelWord(fuel.fiveHour, t) === null, "dark → no words (sign hidden)");
// 10:08 — another `allowed` mid-window: nothing to learn, same object back.
const before = fuel; replay(3);
ok(fuel === before, "mid-window `allowed` (no util) changes nothing — same Fuel object");
// 10:38 — 0.90: straight to red (≥ 0.9), and the ONE phone warning.
t = replay(4);
ok(fuel.fiveHour.level === "red" && fuel.fiveHour.util === 0.9, "0.90 → red");
ok(warnings === 1, "first reading lights the sign → exactly one warning");
ok(fuelWord(fuel.fiveHour, t) === `Reserve · 90% used · resets ${fmtWhen(1788956400 * 1000, t)}`, `word: ${fuelWord(fuel.fiveHour, t)}`);
// 10:39 → 10:50 — 0.91 … 0.96: still red, still one warning.
for (let n = 5; n <= 10; n++) t = replay(n);
ok(fuel.fiveHour.level === "red" && fuel.fiveHour.util === 0.96, "0.96 → red");
ok(warnings === 1, "…and NO repeat warnings while the same window climbs");
ok(!fuelStale(fuel.fiveHour, t), "fresh reading → not stale");
ok(/· as of 12 min ago$/.test(fuelWord(fuel.fiveHour, t + 12 * 60_000)), `12 min later: ${fuelWord(fuel.fiveHour, t + 12 * 60_000)}`);
ok(fuelStale(fuel.fiveHour, t + 12 * 60_000), "12 min later → stale");
// 11:15 — rejected: empty.
t = replay(11);
ok(fuel.fiveHour.level === "empty" && fuel.fiveHour.util === 1, "rejected → empty, util 1");
ok(fuelWord(fuel.fiveHour, t) === `Empty · back at ${fmtWhen(1788956400 * 1000, t)}`, `word: ${fuelWord(fuel.fiveHour, t)}`);
ok(warnings === 1, "an empty tank after a red one is not a new warning");
// 11:22 — `allowed` with a LATER reset time = a fresh window → dark again,
// even though the old reset time (12:20Z) hasn't passed yet.
t = replay(12);
ok(fuel.fiveHour.level === "dark" && fuel.fiveHour.util === null, "`allowed` with a later resetsAt → fresh window → dark");
ok(fuel.fiveHour.resetsAt === 1788970800 * 1000, "…carrying the NEW reset time");
ok(fuelWord(fuel.fiveHour, t) === null, "dark again → sign hidden");
ok(fuel.sevenDay.level === "red", "the weekly gauge kept its own reading throughout");
// Edge cases.
const late = foldFuel(fuel, { type: "five_hour", status: "allowed_warning", util: 0.93, resetsAt: 1788956400, at: Date.parse("2026-09-09T10:41:16.247Z") }, t);
ok(late === fuel, "an OLD event arriving late is ignored");
const passed = { fiveHour: { util: 0.93, resetsAt: 1788956400 * 1000, at: t, level: "red" }, sevenDay: null };
ok(fuelWord(passed.fiveHour, 1788956400 * 1000 + 60_000) === null, "a lit gauge whose reset time has passed goes dark by itself (no event needed)");
const fresh = foldFuel(passed, { type: "five_hour", status: "allowed", resetsAt: 1788956400, at: 1788956400 * 1000 + 60_000 }, 1788956400 * 1000 + 60_000);
ok(fresh.fiveHour.level === "dark", "`allowed` after the reset time passed (same resetsAt) → fresh window → dark");
const pctIn = foldFuel(EMPTY, { type: "five_hour", status: "allowed_warning", util: 82, resetsAt: 1788956400, at: t }, t);
ok(pctIn.fiveHour.util === 0.82 && pctIn.fiveHour.level === "amber", "a 0–100 utilization is normalised → 0.82 amber");
ok(foldFuel(EMPTY, { type: "monthly", status: "rejected", resetsAt: 1 }) === EMPTY, "an unknown window type is ignored");
ok(fuelWarnDue(EMPTY, pctIn, 1788956400 * 1000) === false, "already warned for this window (persisted) → quiet after a restart");
ok(fuelWarnDue(EMPTY, pctIn, 0) === true, "…but a window we never warned about → warn");

console.log(fails ? `\n${fails} CHECK(S) FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
