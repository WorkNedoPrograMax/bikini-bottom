// Checks the two spend rules of domain/handover.ts and their wiring in the lane
// (a fresh session per finished stage; /compact before a message once the
// session's last call passed 200k), plus the lane's connector list.
// No Claude call is made: the session loop is replaced by a stub.
// Run after `npm run build`:  node scripts/check-handover.mjs
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { LaneManager } = require("../dist/main/adapters/lane.js");
const H = require("../dist/main/domain/handover.js");
const C = require("../dist/main/domain/laneConnectors.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 5000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await tick(); return cond(); };
const fakeLog = () => { const events = []; return { events, append: async (e) => { events.push(e); }, all: () => events }; };
// A read can land in the middle of a save (the file is half-written) → not there yet; `until` asks again.
const readSaved = (dir) => { const f = join(dir, ".bikini", "sessions.json"); try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; } catch { return null; } };
const town = () => { const dir = mkdtempSync(join(tmpdir(), "bikini-handover-")); mkdirSync(join(dir, ".bikini")); return dir; };
/** A manager whose sessions never reach Claude: runSession is a no-op, so what
 *  send() pushed stays readable in the pump. */
const manager = (dir) => { const lm = new LaneManager(dir, fakeLog(), () => {}, () => {}, () => {}); lm.runSession = async () => {}; return lm; };
/** A stand-in for a live session's pump that records what it is fed. */
const livePump = () => { const got = []; let closed = false; return { got, closed: () => closed, end() { closed = true; }, push(text) { got.push(text); } }; };
/** Drain what send() queued in a real (new) pump. */
const queued = async (pump) => { const out = []; for (let i = 0; i < 3; i++) { const r = await Promise.race([pump.iter.next(), tick(50).then(() => null)]); if (!r || r.done) break; out.push(r.value.message.content); } return out; };

const LONG = "HIGHCAP-123 on feat/HIGHCAP-123-plan-tabs. Plan approved by Maksym: tabs with a per-day cache. ".repeat(3) + "Change folder openspec/changes/HIGHCAP-123-plan-tabs/ holds proposal, design and tasks. Open: none.";
const good = { stage: "plan", next: "run /implement for HIGHCAP-123", handover: LONG };
const st = (o = {}) => ({ ctx: 260_000, helpers: 0, done: 0, now: 1, ...o });

console.log("stage_done — what is taken and what is sent back:");
ok(H.handoverVerdict(good, st()).ok === true, "a finished stage with a real hand-over on a big session is taken");
ok(H.handoverVerdict({ ...good, stage: "lunch" }, st()).ok === false, "an unknown stage is refused");
ok(/still running/.test(H.handoverVerdict(good, st({ helpers: 1 })).reply), "a helper still running → the stage is not finished, refused");
ok(/still small/.test(H.handoverVerdict(good, st({ ctx: H.HANDOVER_MIN_CTX - 1 })).reply), `under ${H.HANDOVER_MIN_CTX / 1000}k the session carries on (a restart would cost more)`);
ok(H.handoverVerdict(good, st({ ctx: H.HANDOVER_MIN_CTX })).ok === true, `at ${H.HANDOVER_MIN_CTX / 1000}k it is taken`);
ok(/too thin/.test(H.handoverVerdict({ ...good, handover: "done, see ticket" }, st()).reply), "a one-line hand-over is refused");
ok(/keep it under/.test(H.handoverVerdict({ ...good, handover: "x".repeat(H.HANDOVER_MAX_CHARS + 1) }, st()).reply), "a pasted wall is refused");
ok(/`next` is missing/.test(H.handoverVerdict({ ...good, next: " " }, st()).reply), "no next step → refused");
ok(H.handoverVerdict(good, st({ done: H.MAX_HANDOVERS_PER_ORDER })).ok === false, "an order that keeps handing over stops restarting");
{
  const m = H.handoverMessage({ stage: "plan", next: "run /implement", text: LONG, at: 1 }, "Do HIGHCAP-123", "also rename the tab");
  ok(m.includes(LONG) && m.includes("Do HIGHCAP-123") && m.includes("NEXT: run /implement") && m.includes("also rename the tab"), "the fresh session's first message carries the order, the hand-over, the next step and what Maksym just said");
  ok(/Carry on with NEXT now/.test(H.handoverMessage({ stage: "plan", next: "n", text: LONG, at: 1 }, null)), "with nothing said, it is told to carry on");
}

console.log("model per stage — the strong one to plan and review, the cheaper one to build and ship:");
ok(H.stageModelKind(null) === "think" && H.stageModelKind("plan") === "think" && H.stageModelKind("review") === "think", "a new order, plan and review think");
ok(H.stageModelKind("build") === "routine" && H.stageModelKind("ship") === "routine", "build and ship are routine");
ok(H.nextStage("plan") === "build" && H.nextStage("build") === "review" && H.nextStage("review") === "ship" && H.nextStage("ship") === null, "plan → build → review → ship → (unknown)");
ok(H.handoverVerdict(good, st({ ctx: 20_000, model: "think" })).ok === true, "plan done on a small session is still taken: build moves to the cheaper model");
ok(/still small/.test(H.handoverVerdict({ ...good, stage: "build" }, st({ ctx: 20_000, model: "think" })).reply), "build done in a session that was thinking anyway (review thinks too) → small session carries on");
ok(H.handoverVerdict({ ...good, stage: "build" }, st({ ctx: 20_000, model: "routine" })).ok === true, "build done in a routine session → review gets the strong model at any size");
ok(/still running/.test(H.handoverVerdict(good, st({ ctx: 20_000, model: "think", helpers: 1 })).reply), "…but never while a helper is still running");
ok(/sonnet/.test(H.STAGE_NOTE) && /opus/.test(H.STAGE_NOTE), "builders are told which model a look-up helper and a judging helper get");

console.log("compact — only between messages, only for a big session that carries on:");
const cd = (o) => H.compactDue({ ctx: 250_000, busy: false, continuing: true, handoverPending: false, ...o });
ok(cd({}) === true, "idle + 250k + same session → compact first");
ok(cd({ ctx: H.COMPACT_AT_CTX }) === true && cd({ ctx: H.COMPACT_AT_CTX - 1 }) === false, `the line is ${H.COMPACT_AT_CTX / 1000}k`);
ok(cd({ busy: true }) === false, "mid-turn → never");
ok(cd({ continuing: false }) === false, "a brand-new session → nothing to compact");
ok(cd({ handoverPending: true }) === false, "a hand-over is about to replace the session → no compaction");
ok(H.COMPACT_COMMAND.startsWith("/compact "), "the command is the engine's own /compact with what to keep");

console.log("lane — a hand-over waits for the turn to end, then the next message opens a fresh session:");
{
  const dir = town(); const lm = manager(dir); const l = lm.lane("bob");
  const old = livePump();
  l.pump = old; l.sessionId = "old-session"; l.lastPrompt = "Do HIGHCAP-123"; l.lastCallCtx = 260_000;
  l.handover = { stage: "plan", next: "run /implement", text: LONG, at: Date.now() };
  // (a) the previous turn's done-timer is still armed → he is not idle yet.
  l.working = true; l.awaitingIdle = true;
  await lm.send("bob", "one more thing", false);
  ok(old.got.length === 1 && old.got[0] === "one more thing" && l.pump === old, "message during the quiet wait joins the running session (no cut mid-turn)");
  ok(l.handover === null, "…and the now-stale hand-over is dropped");
  // (b) idle with a hand-over → fresh session.
  l.working = false; l.awaitingIdle = false; l.outstanding = 0;
  l.handover = { stage: "plan", next: "run /implement", text: LONG, at: Date.now() };
  await lm.send("bob", "go on", false);
  ok(old.closed() && l.pump !== old, "idle: the old session is closed and a new one opened");
  const first = await queued(l.pump);
  ok(first.length === 1 && String(first[0]).includes(LONG) && String(first[0]).includes("MAKSYM JUST SAID:\ngo on"), "its first and only message is the hand-over plus what Maksym said — no /compact");
  ok(l.sessionId === null && l.handover === null && l.handovers === 1 && l.lastCallCtx === 0, "the lane forgot the old session id and size; one hand-over counted");
  ok(l.working === true, "he is shown working (no bell between the stages)");
  ok(l.stage === "build" && l.conversation.some((m) => /on Sonnet/.test(m.text)), "the new session is the build stage, and the chat says it runs on Sonnet");
  lm.persist();
  ok(await until(() => readSaved(dir)?.bob?.current?.stage === "build"), "the stage is saved, so a relaunch resumes it on the same model");
  ok(manager(dir).lane("bob").stage === "build", "…and a new town process reads it back");
  await lm.scrap("bob");
  ok(l.stage === null, "a scrapped order forgets its stage (the next one starts on the strong model)");
  ok(l.conversation.some((m) => /plan stage is done/.test(m.text)), "the chat says the stage ended and a clean one began");
}

console.log("lane — a hand-over written right before a relaunch is still used:");
{
  const dir = town(); const lm = manager(dir); const l = lm.lane("pat");
  l.sessionId = "old"; l.lastPrompt = "Do HIGHCAP-9"; l.handover = { stage: "build", next: "run the reviews", text: LONG, at: Date.now() }; l.handovers = 1;
  lm.persist();
  ok(await until(() => readSaved(dir)?.pat?.current?.handover?.stage === "build"), "the hand-over is in the saved file");
  const lm2 = manager(dir); const l2 = lm2.lane("pat");
  ok(l2.handover?.stage === "build" && l2.handovers === 1, "a new town process reads it back");
  await lm2.send("pat", "morning", false);
  const first = await queued(l2.pump);
  ok(l2.sessionId === null && String(first[0]).includes('"build" stage is finished'), "the first message after the relaunch opens a fresh session with it (the old one is not resumed)");
}

console.log("lane — the 200k rule:");
{
  const dir = town(); const lm = manager(dir); const l = lm.lane("squid");
  const p = livePump(); l.pump = p; l.sessionId = "s"; l.lastCallCtx = 250_000;
  await lm.send("squid", "next step", false);
  ok(p.got.length === 2 && p.got[0] === H.COMPACT_COMMAND && p.got[1] === "next step", "idle at 250k: /compact goes in first, then the message, same session");
  ok(l.outstanding === 2, "two answers are expected (the compaction's and the message's)");
  await lm.send("squid", "and this", false);
  ok(p.got.length === 3 && p.got[2] === "and this", "a message while he works is never preceded by a compaction");
  l.working = false; l.awaitingIdle = false; l.lastCallCtx = 150_000; l.stats.ctxTokens = 150_000;
  await lm.send("squid", "small", false);
  ok(p.got.length === 4, "idle at 150k: no compaction");
  // Closed session, big memory, resumed cold → compacted before the message.
  l.working = false; l.pump = null; l.lastCallCtx = 0; l.stats.ctxTokens = 380_000;
  await lm.send("squid", "back after lunch", false);
  const q = await queued(l.pump);
  ok(q.length === 2 && q[0] === H.COMPACT_COMMAND && q[1] === "back after lunch", "resumed after a break at 380k (size from the saved meter): compacted first");
  l.working = false; l.pump = null; l.stats.ctxTokens = 380_000;
  await lm.send("squid", "brand new", true);
  ok((await queued(l.pump)).length === 1, "a fresh session is never compacted");
}

console.log("lane — scrap and reopening a past order drop a pending hand-over:");
{
  const dir = town(); const lm = manager(dir); const l = lm.lane("bob");
  l.handover = { stage: "plan", next: "n", text: LONG, at: 1 };
  await lm.scrap("bob");
  ok(l.handover === null, "scrap");
}

console.log("connectors — by name, never a wildcard, and never one the lanes use:");
{
  const denied = C.DENIED_CONNECTORS, kept = C.KEPT_CONNECTORS;
  ok(denied.length > 0 && denied.every((n) => /^claude\.ai \S/.test(n) && !/[*?]/.test(n)), `${denied.length} names, each a full claude.ai connector name with no wildcard`);
  ok(new Set(denied).size === denied.length, "no name twice");
  ok(kept.every((k) => !denied.includes(k)), `none of the kept ones is denied (${kept.join(", ")})`);
  ok(!denied.some((n) => /atlassian|slack/i.test(n)), "nothing Jira- or Slack-shaped is denied");
  const s = JSON.parse(C.laneSettings());
  ok(Array.isArray(s.deniedMcpServers) && s.deniedMcpServers.length === C.deniedServers("other").length && s.deniedMcpServers.every((e) => typeof e.serverName === "string" && Object.keys(e).length === 1), "the settings overlay is { deniedMcpServers: [{ serverName }] }");
  ok(denied.includes("claude.ai Figma"), "the unauthorized Figma twin stays denied (the Figma plugin needs that)");
  // Per town (2026-11-25): plugin servers too, by full name, never a kept one.
  for (const [kind, keep] of [["app", C.KEPT_IN_APP_TOWN], ["other", C.KEPT_IN_OTHER_TOWNS]]) {
    const d = C.deniedServers(kind);
    ok(new Set(d).size === d.length && d.every((n) => !/[*?]/.test(n)), `${kind} town: ${d.length} names, none twice, no wildcard`);
    ok(keep.every((k) => !d.includes(k)), `${kind} town keeps ${keep.join(", ")}`);
    ok(!d.some((n) => /atlassian|slack|gmail|figma:figma/i.test(n)), `${kind} town: nothing Jira-, Slack-, Gmail- or Figma-plugin-shaped is denied`);
    ok(JSON.parse(C.laneSettings(kind)).deniedMcpServers.length === d.length, `${kind} town: the overlay carries all of them`);
  }
  ok(C.deniedServers("app").includes("claude.ai Supabase") && !C.deniedServers("other").includes("claude.ai Supabase"), "Supabase: off in the app town, kept where it was called (backend)");
  ok(C.deniedServers("other").includes("plugin:flutter:maestro") && !C.deniedServers("app").includes("plugin:flutter:maestro"), "Maestro: off away from the phone, kept in the app town");
  ok(C.deniedServers("app").includes("playwright-ext") && C.deniedServers("other").includes("playwright-ext"), "the browser extension is off everywhere");
  const lsrc = readFileSync(new URL("../src/main/adapters/lane.ts", import.meta.url), "utf8");
  ok((lsrc.match(/settings: laneSettingsFor\(this\.projectPath\)/g) || []).length === 2 && !/LANE_SETTINGS/.test(lsrc), "both lane session kinds take the town's own list");
}

console.log("lane — the size the 200k rule reads is the session's own:");
{
  const usage = (n) => ({ input_tokens: 2, cache_read_input_tokens: n - 2, cache_creation_input_tokens: 0 });
  ok(H.mainCallCtx({ type: "assistant", parent_tool_use_id: null, message: { usage: usage(137_645) } }) === 137_645, "the character's own call sets the size");
  ok(H.mainCallCtx({ type: "assistant", parent_tool_use_id: "toolu_lens", message: { usage: usage(218_755) } }) === null, "a helper's call (it has a parent tool) does not — 2026-11-23 16:08, backend Pat");
  ok(H.mainCallCtx({ type: "user", parent_tool_use_id: null, message: {} }) === null, "a non-call message does not");
  const src = readFileSync(new URL("../src/main/adapters/lane.ts", import.meta.url), "utf8");
  ok(/const own = mainCallCtx\(msg as any\);\s*if \(own !== null\) l\.lastCallCtx = own;/.test(src) && !/if \(c > 0\) l\.lastCallCtx = c;/.test(src), "the lane's stream sets the size only through mainCallCtx");
  // A past order picked up again: the size of the session left behind is dropped.
  const dir = town(); const lm = manager(dir); const l = lm.lane("squid");
  l.sessionId = "big-one"; l.lastCallCtx = 272_592; l.stats.ctxTokens = 272_592;
  l.conversation = [{ from: "you", text: "current order" }];
  l.archive = [{ title: "older", messages: [{ from: "you", text: "older order" }], sdkSessionId: "small-past", endedAt: 1 }];
  const sent = []; lm.send = async (id, text, fresh) => { sent.push({ id, text, fresh, ctx: l.lastCallCtx, meter: l.stats.ctxTokens }); };
  await lm.resumePast("squid", 0, "carry on");
  ok(sent.length === 1 && sent[0].ctx === 0 && sent[0].meter === 0, "resuming a past order starts with no inherited size (no compaction on the old session's 272k) — 2026-11-24 20:30");
  ok(H.compactDue({ ctx: sent[0]?.meter ?? 1e9, busy: false, continuing: true, handoverPending: false }) === false, "…so the 200k rule does not fire before its first message");
}

console.log(fails ? `\n${fails} check(s) FAILED` : "\nall hand-over checks passed");
process.exit(fails ? 1 : 0);
