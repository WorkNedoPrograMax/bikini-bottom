// Checks the lane's "what is he doing" across its copies (working flag, settle
// timer, pending question, the saved file, the street's state event): a new
// wait state must survive the two crossings that bit on 2026-11-06 — entered
// while the previous turn's done-timer is still armed, and entered right before
// the app is relaunched — and a character who resumes by himself after the
// bell must be shown working again.
// Run after `npm run build`:  node scripts/check-lane-states.mjs
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { LaneManager } = require("../dist/main/adapters/lane.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const fakeLog = () => { const events = []; return { events, append: async (e) => { events.push(e); }, all: () => events }; };
const manager = (dir, log, cues) => new LaneManager(dir, log, () => {}, () => {}, (id, kind) => cues.push(kind));
const readSaved = (dir) => { const f = join(dir, ".bikini", "sessions.json"); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };
const lastState = (log, id) => [...log.events].reverse().find((e) => e.type === "CharacterStateChanged" && e.id === id)?.state;

const dir = mkdtempSync(join(tmpdir(), "bikini-lane-states-"));
mkdirSync(join(dir, ".bikini")); // the town folder every real project has (sessions.json lives there)
const log = fakeLog(); const cues = [];
const lm = manager(dir, log, cues);
const l = lm.lane("squid");
l.pump = { closed: () => false, end() {}, push() {} }; // "live" session: pending items count only while one exists
l.working = true;

console.log("ask while the previous turn is still settling:");
{
  // What the session loop does on a `result`: hold as working, arm the quiet-timer.
  l.awaitingIdle = true; l.awaitSince = Date.now(); l.beatAt = Date.now(); lm.bumpIdle("squid");
  ok(l.idleTimer !== null, "the done-timer is armed by the result");
  void lm.promptChoice("squid", { questions: [{ question: "Ship it?", options: ["yes", "no"] }] });
  await tick();
  ok(l.pendingChoice !== null && l.working === false, "the question is pending and he is not 'working'");
  ok(l.idleTimer === null && l.awaitingIdle === false, "the done-timer is disarmed — no second bell 12 s into the wait");
  ok(cues.filter((k) => k === "ready").length === 1, "exactly one bell for the question");
  ok(lastState(log, "squid") === "calling", "the street shows him calling");
}

console.log("ask, then the app closes and reopens:");
{
  await tick(300); // persist() is fire-and-forget
  ok(readSaved(dir)?.squid?.current?.pendingQuestion === "Ship it?", "the open question is saved to disk the moment it goes out");
  const log2 = fakeLog(); const lm2 = manager(dir, log2, []);
  ok(lm2.lostQuestion("squid") === "Ship it?", "a fresh manager over the same town knows which question was lost");
  ok(lm2.lostQuestion("pat") === null, "a character who never asked has no lost question");
  lm2.markPaused("squid", "/ticket X", lm2.lostQuestion("squid"));
  const l2 = lm2.lane("squid");
  const said = l2.conversation[l2.conversation.length - 1]?.text || "";
  ok(l2.paused === true && said.includes("Ship it?") && /keep cooking/i.test(said), "he comes back paused, names the lost question, offers Keep cooking");
}

console.log("answered → working again, the question gone from disk:");
{
  await lm.answerQuestion("squid", ["yes"]);
  await tick(300);
  ok(l.working === true && l.pendingChoice === null, "he is working and the question is closed");
  ok(lastState(log, "squid") === "working", "the street shows him working");
  ok(readSaved(dir)?.squid?.current?.pendingQuestion === null, "nothing is saved as pending any more");
}

console.log("resumes by himself after the bell:");
{
  // What goIdle leaves behind: not working, not settling, nothing pending, session alive.
  l.working = false; l.awaitingIdle = false; if (l.idleTimer) { clearTimeout(l.idleTimer); l.idleTimer = null; }
  const own = { type: "assistant", parent_tool_use_id: null };
  ok(lm.wakeIfResumed("squid", { type: "assistant", parent_tool_use_id: "toolu_helper" }) === false && l.working === false, "a helper's frame does not wake him");
  ok(lm.wakeIfResumed("squid", { type: "system", parent_tool_use_id: null }) === false && l.working === false, "a system frame does not wake him");
  ok(lm.wakeIfResumed("squid", own) === true && l.working === true, "his own model call after the bell flips him back to working");
  await tick();
  ok(lastState(log, "squid") === "working", "the street shows him working again");
  ok(lm.wakeIfResumed("squid", own) === false, "already working → nothing to do");
  l.working = false; void lm.promptChoice("squid", { questions: [{ question: "Again?", options: ["a"] }] }); await tick();
  ok(lm.wakeIfResumed("squid", own) === false && l.working === false, "waiting on a question is a real stop — never woken over it");
  await lm.answerQuestion("squid", ["a"]);
  l.working = false; l.paused = true;
  ok(lm.wakeIfResumed("squid", own) === false, "paused is a real stop too");
  l.paused = false;
}

if (l.watchdog) clearTimeout(l.watchdog);
if (l.idleTimer) clearTimeout(l.idleTimer);
console.log(fails ? `\n${fails} check(s) failed` : "\nall lane-state checks passed");
process.exit(fails ? 1 : 0);
