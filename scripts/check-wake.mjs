// Checks "Wake everyone" (2026-11-24): who counts as only waiting for a go, that
// limit holds go one first (the scout) and the rest follow only on its verdict,
// what the button says — and, on a real LaneManager, that a limit hold and a
// check-in pause are read as such and that a retry clears the hold at once.
// NOT covered here: the live stream setting "Claude answered" (needs a real
// session). Plain node, no Electron. Run after `npm run build`:
//   node scripts/check-wake.mjs
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { stuckLanes, wakePlan, scoutVerdict, wakeSign, SCOUT_PATIENCE_MS, SCOUT_START_GRACE_MS } = require("../dist/main/domain/wake.js");
const { LaneManager } = require("../dist/main/adapters/lane.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const lane = (town, id, o = {}) => ({ town, id, working: false, paused: false, burned: false, asking: false, limitedUntil: 0, ...o });
const HOLD = Date.now() + 3_600_000;

console.log("who only needs a go:");
{
  const s = stuckLanes([
    lane("A", "bob", { paused: true, limitedUntil: HOLD }),
    lane("A", "pat", { paused: true }),
    lane("A", "squid", { working: true }),
    lane("A", "sandy"),
    lane("B", "bob", { paused: true, limitedUntil: HOLD }),
    lane("B", "pat", { paused: true, asking: true }),
    lane("B", "squid", { burned: true }),
    lane("B", "sandy", { paused: true, burned: true }),
    lane("B", "karen", { paused: true, working: true }),
  ]);
  ok(s.length === 3, "three of nine: the two limit holds and the one check-in");
  ok(s[0].kind === "limit" && s[0].town === "A" && s[0].id === "bob", "parked on the limit → limit");
  ok(s[1].kind === "checkin" && s[1].id === "pat", "paused with no limit hold → check-in");
  ok(s[2].kind === "limit" && s[2].town === "B", "the same name in another town is its own entry");
  ok(!s.some((x) => x.town === "B" && x.id === "pat"), "a character with a question open is never woken (it needs an answer)");
  ok(!s.some((x) => x.id === "squid" || x.id === "sandy"), "working, idle and burned characters are left alone");
  ok(!s.some((x) => x.id === "karen"), "paused but already working again → left alone");
  ok(stuckLanes([]).length === 0, "no lanes → nobody");
}

console.log("one press:");
{
  const stuck = [{ town: "A", id: "bob", kind: "limit" }, { town: "A", id: "pat", kind: "checkin" }, { town: "B", id: "bob", kind: "limit" }, { town: "B", id: "squid", kind: "limit" }, { town: "B", id: "pat", kind: "checkin" }];
  const p = wakePlan(stuck);
  ok(p.go.length === 2 && p.go.every((s) => s.kind === "checkin"), "both check-ins go at once");
  ok(p.scout && p.scout.town === "A" && p.scout.id === "bob", "of three limit holds the first is the scout");
  ok(p.wait.length === 2 && p.wait.every((s) => s.kind === "limit") && !p.wait.some((s) => s.town === "A"), "the other two wait for its verdict");
  const only = wakePlan([{ town: "A", id: "pat", kind: "checkin" }]);
  ok(only.go.length === 1 && only.scout === null && only.wait.length === 0, "check-ins only → no scout");
  const none = wakePlan([]);
  ok(none.go.length === 0 && none.scout === null && none.wait.length === 0, "nobody stuck → nothing happens");
}

console.log("the scout's verdict:");
{
  ok(scoutVerdict({ working: false, limitedUntil: HOLD, spoke: false }, 5_000) === "still", "parked on the limit again → still (the rest stay parked)");
  ok(scoutVerdict({ working: false, limitedUntil: HOLD, spoke: true }, 5_000) === "still", "a new hold beats anything said before it");
  ok(scoutVerdict({ working: true, limitedUntil: 0, spoke: true }, 5_000) === "through", "Claude answered → through (the rest are released)");
  ok(scoutVerdict({ working: false, limitedUntil: 0, spoke: true }, 60_000) === "through", "answered and already finished → through");
  ok(scoutVerdict({ working: true, limitedUntil: 0, spoke: false }, 5_000) === "waiting", "working, nothing said yet → waiting");
  ok(scoutVerdict({ working: false, limitedUntil: 0, spoke: false }, SCOUT_START_GRACE_MS - 1) === "waiting", "not started yet, inside the start grace → waiting (not gone)");
  ok(scoutVerdict({ working: false, limitedUntil: 0, spoke: false }, SCOUT_START_GRACE_MS) === "gone", "not working, no hold, nothing said after the grace → gone (scrapped or burned: it proved nothing)");
  ok(scoutVerdict({ working: true, limitedUntil: 0, spoke: false }, SCOUT_PATIENCE_MS) === "gone", "silent past the patience → gone (the next one is tried)");
  ok(SCOUT_START_GRACE_MS === 20_000 && SCOUT_PATIENCE_MS === 180_000, "grace 20 s, patience 3 min");
}

console.log("the button:");
{
  ok(wakeSign([], false) === null, "nobody stuck → no button");
  const one = wakeSign([{ town: "A", id: "bob", kind: "limit" }], false);
  ok(one && one.label === "⏰ Wake 1" && one.count === 1 && one.limit === 1 && one.checkin === 0 && !one.trying, "one stuck → \"Wake 1\"");
  const many = wakeSign([{ town: "A", id: "bob", kind: "limit" }, { town: "B", id: "bob", kind: "limit" }, { town: "B", id: "pat", kind: "checkin" }], false);
  ok(many && many.label === "⏰ Wake all 3" && many.limit === 2 && many.checkin === 1, "three stuck in two towns → \"Wake all 3\" (2 limit, 1 check-in)");
  ok(many.title.includes("2 parked on Claude's limit") && many.title.includes("1 waiting for \"keep cooking\"") && many.title.includes("one tries first"), "the hover says who waits for what, and that one tries first");
  const trying = wakeSign([{ town: "B", id: "bob", kind: "limit" }], true);
  ok(trying && trying.trying && trying.label === "⏳ trying one…", "while the scout is out → \"trying one…\"");
  ok(wakeSign([], true) !== null, "the scout is out and nobody else waits → the button stays until the verdict");
}

console.log("a real lane engine — holds are read as such, a retry clears them at once:");
{
  const dir = mkdtempSync(join(tmpdir(), "bikini-wake-"));
  mkdirSync(join(dir, ".bikini"));
  const log = { append: async () => {}, all: () => [] };
  const lm = new LaneManager(dir, log, () => {}, () => {}, () => {});
  const sent = [];
  lm.send = async (id, text) => { sent.push([id, text]); }; // never open a real Claude session from a check
  const now = (id) => ({ town: dir, id, working: lm.isWorking(id), paused: lm.isPaused(id), burned: lm.isBurned(id), asking: lm.hasPendingChoice(id) || lm.hasPendingAsk(id), limitedUntil: lm.limitedUntil(id) });

  await lm.pauseForLimit("bob", { resetsAt: HOLD, text: "You've hit your session limit · resets 11am" });
  const pat = lm.lane("pat"); pat.paused = true; // the step-cap check-in sets exactly this
  lm.lane("squid").working = true;
  const s = stuckLanes(["bob", "pat", "squid", "sandy"].map(now));
  ok(s.length === 2 && s[0].id === "bob" && s[0].kind === "limit" && s[1].id === "pat" && s[1].kind === "checkin", "a limit hold reads as limit, a check-in pause as check-in, a working and an idle lane as nothing");

  const bob = lm.lane("bob"); bob.spoke = true; // left over from the turn before the hold
  void lm.retry("bob");
  ok(lm.limitedUntil("bob") === 0 && !lm.isPaused("bob"), "retry drops the hold before it returns (the scout is not read as \"still\" from its old hold)");
  ok(lm.spoke("bob") === false, "retry forgets what was said in the old turn (the scout is not read as \"through\" from it)");
  ok(scoutVerdict({ working: lm.isWorking("bob"), limitedUntil: lm.limitedUntil("bob"), spoke: lm.spoke("bob") }, 2_000) === "waiting", "two seconds after the press the scout reads waiting");
  ok(sent.length === 1 && sent[0][0] === "bob" && /Continue from where you left off/.test(sent[0][1]), "retry asks the character to continue where it left off — once");

  await lm.pauseForLimit("bob", { resetsAt: HOLD, text: "You've hit your session limit · resets 11am" });
  ok(scoutVerdict({ working: lm.isWorking("bob"), limitedUntil: lm.limitedUntil("bob"), spoke: lm.spoke("bob") }, 9_000) === "still", "parked on the limit again after the press → the scout reads still");
  lm.clearLimit(bob); // stop the resume timer so the check can exit
  if (lm.limitSweep) clearInterval(lm.limitSweep);
}

console.log("the page — the button is hidden until told otherwise and never animates:");
{
  const html = readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  ok(/<button class="topbtn" id="wakeBtn" hidden>/.test(html), "#wakeBtn starts hidden");
  const rules = [...css.matchAll(/([^{}]*#wakeBtn[^{}]*)\{([^}]*)\}/g)];
  ok(rules.length >= 1 && rules.every((r) => !/animation/.test(r[2])), "no #wakeBtn rule animates (a running animation costs a frame 60 times a second)");
}

console.log(fails ? `\n${fails} FAILED` : "\nall wake checks passed");
process.exit(fails ? 1 : 0);
