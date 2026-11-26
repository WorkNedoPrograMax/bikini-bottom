// Checks the two spend rules of domain/handover.ts and their wiring in the lane
// (a fresh session per finished stage; /compact before a message once the
// session's last call passed 200k), plus the lane's connector list, and the
// town's own hand-over (2026-11-26): asked at a big turn's end, braked mid-run
// past 200k, and written before a long break — each driven through a whole
// scripted session (lm.queryFn).
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

// ───────────── The town's own hand-over (2026-11-26) ─────────────
// Measured 2026-11-26: the stage hand-over almost never fired (mobile pat 0,
// bob 0, squid 1; backend pat 0 at 413k). These checks drive a WHOLE session
// through the lane with a scripted stand-in for the engine (lm.queryFn), so
// each one goes red if the town stops asking for the note itself.
const CLEAN_NEXT = "carry on with the build of HIGHCAP-77 task 3";
const CLEAN = { next: CLEAN_NEXT, handover: "HIGHCAP-77 on feat/HIGHCAP-77-tabs. Done: tasks 1–2 (lib/features/tabs/…). In progress: task 3, the cache. Maksym answered: keep the old tab order. Open: the empty state copy. ".repeat(2) };
const call = (ctx, text, tools = []) => ({ type: "assistant", session_id: "sess-1", parent_tool_use_id: null, message: { usage: { input_tokens: 2, cache_read_input_tokens: ctx - 2, cache_creation_input_tokens: 0 }, content: [...(text ? [{ type: "text", text }] : []), ...tools.map((t, i) => ({ type: "tool_use", id: `toolu_${t}_${i}_${ctx}`, name: t, input: {} }))] } });
const done = () => ({ type: "result", subtype: "success", usage: {}, num_turns: 1 });
const useTool = (opts, name, args) => opts.mcpServers.bikini.instance._registeredTools[name].handler(args, {});
const postTool = (opts, input = {}) => opts.hooks.PostToolUse[0].hooks[0]({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" }, tool_response: "", ...input });
const textOf = (m) => (typeof m.message.content === "string" ? m.message.content : (m.message.content.find((b) => b.type === "text")?.text ?? ""));
/** A town whose sessions run against `script(text, opts, n)` → the messages the
 *  "engine" answers with. Records every message each session received. */
const live = (script) => {
  const dir = town(); const cues = [];
  const lm = new LaneManager(dir, fakeLog(), () => {}, () => {}, (id, kind) => cues.push(kind));
  lm.worktreeFor = async () => dir; lm.prepareLane = async () => {};
  const sessions = [];
  lm.queryFn = ({ prompt, options }) => {
    const got = []; sessions.push({ got, options });
    const gen = (async function* () { for await (const m of prompt) { const t = textOf(m); got.push(t); for (const out of await script(t, options, sessions.length)) yield out; } })();
    gen.interrupt = async () => {};
    return gen;
  };
  return { dir, lm, sessions, cues };
};
const said = (l) => l.conversation.filter((m) => m.from === "them").map((m) => m.text).join("\n");

console.log("domain — when the town asks for a hand-over itself:");
{
  const f = (o) => H.forcedHandoverDue({ ctx: 170_000, base: 110_000, lastTry: 0, orderOpen: true, handoverPending: false, helpers: 0, ...o });
  ok(f({}) === true, "turn end at 170k on a session that started at 110k → ask");
  ok(f({ ctx: H.FORCED_HANDOVER_CTX - 1, base: 0 }) === false && f({ ctx: H.FORCED_HANDOVER_CTX, base: 0 }) === true, `the line is ${H.FORCED_HANDOVER_CTX / 1000}k`);
  ok(f({ base: 130_000 }) === false, `a session that grew less than ${H.FORCED_HANDOVER_REGROW / 1000}k since it started fresh is not asked (no loop right after a switch)`);
  ok(f({ lastTry: 165_000 }) === false && f({ ctx: 215_000, lastTry: 165_000 }) === true, "an ask that brought no note is repeated only after another 50k of growth");
  ok(f({ helpers: 1 }) === false && f({ handoverPending: true }) === false && f({ orderOpen: false }) === false, "never with a helper running, a hand-over already written, or no order");
  const b = (o) => H.brakeDue({ ctx: 205_000, braked: false, handoverPending: false, noteAsked: false, mainThread: true, ...o });
  ok(b({}) === true && b({ ctx: H.MID_RUN_BRAKE_CTX - 1 }) === false, `mid-run brake at ${H.MID_RUN_BRAKE_CTX / 1000}k`);
  ok(b({ braked: true }) === false && b({ mainThread: false }) === false && b({ noteAsked: true }) === false, "once per session, only on the character's own tool calls, not while a note is asked");
  const k = (o) => H.breakNoteDue({ ctx: 120_000, idleMs: H.BREAK_IDLE_MS, live: true, busy: false, handoverPending: false, noteAsked: false, waitingOnMaksym: false, ...o });
  ok(k({}) === true && k({ idleMs: H.BREAK_IDLE_MS - 1 }) === false, `pre-break note after ${H.BREAK_IDLE_MS / 60000} idle minutes`);
  ok(k({ ctx: H.BREAK_HANDOVER_MIN_CTX - 1 }) === false && k({ live: false }) === false && k({ busy: true }) === false && k({ waitingOnMaksym: true }) === false, `…only for ${H.BREAK_HANDOVER_MIN_CTX / 1000}k+ on a live, idle session nobody is waiting on`);
  ok(H.BREAK_IDLE_MS < 60 * 60_000, "…and before the one-hour prompt cache runs out");
  const mv = (asked, args = CLEAN, helpers = 0) => H.memoryVerdict(args, { asked, helpers, stage: "build", now: 1 });
  ok(mv(null).ok === false, "clean_memory is refused when the town did not ask (no restarting at will)");
  ok(mv("turn").ok && mv("turn").handover.kind === "memory" && mv("turn").handover.auto === false && mv("turn").handover.stage === "build", "a turn-end note waits for the next message and keeps the stage");
  ok(mv("brake").handover.auto === true, "a mid-run note opens the fresh session by itself");
  ok(/too thin/.test(mv("turn", { ...CLEAN, handover: "see ticket" }).reply) && /still running/.test(mv("brake", CLEAN, 1).reply), "a thin note or a running helper is refused");
  const m = H.handoverMessage(mv("turn").handover, "Do HIGHCAP-77", "and the copy");
  ok(m.includes(CLEAN.handover.trim()) && m.includes(`NEXT: ${CLEAN_NEXT}`) && /still in progress/.test(m) && m.includes("MAKSYM JUST SAID:\nand the copy"), "the fresh session's first message carries the note, NEXT, the stage still in progress and what Maksym said");
}

console.log("lane 1 — turn end on a big session: the town asks for the note, the next message opens a fresh session:");
{
  let noteAsks = 0;
  const { lm, sessions, cues } = live(async (t, opts, n) => {
    if (t === H.NOTE_REQUEST) { noteAsks++; await useTool(opts, "clean_memory", CLEAN); return [call(171_000, "Saved."), done()]; }
    if (n === 1) return [call(110_000), call(170_000, "Built tasks 1 and 2 — want me to keep the old tab order?"), done()];
    return [call(112_000, "On it."), done()];
  });
  const l = lm.lane("bob"); l.lastPrompt = "Do HIGHCAP-77"; l.stage = "build";
  await lm.send("bob", "go", true);
  ok(await until(() => l.handover?.kind === "memory"), "after a turn that ended at 170k the town asked, and the note was written");
  ok(noteAsks === 1 && sessions.length === 1 && sessions[0].got[1] === H.NOTE_REQUEST, "the ask went into the same session, once");
  ok(!/Saved\./.test(said(l)) && !said(l).includes("[The town"), "the chat shows neither the ask nor the reply to it");
  ok(said(l).includes("keep the old tab order?"), "…while the real reply is there");
  ok(l.handover.auto === false && sessions.length === 1, "no fresh session is paid for until someone needs it");
  await lm.goIdle("bob");
  ok(cues.filter((c) => c === "ready").length === 1, "one bell, after the note");
  await lm.send("bob", "yes keep it", false);
  ok(await until(() => sessions.length === 2 && sessions[1].got.length >= 1), "Maksym's next message opened a fresh session");
  ok(sessions[1].got[0].includes(CLEAN.handover.trim()) && sessions[1].got[0].includes("MAKSYM JUST SAID:\nyes keep it"), "…whose first message is the note plus what he said");
  ok(/📒 My memory for this order had grown to 171k tokens — carrying on with a clean memory/.test(said(l)), "the chat gets the one 📒 clean-memory line");
  ok(l.stage === "build" && l.handovers === 0, "the stage (and its model) carry on; it is not counted as a stage hand-over");
  await lm.scrap("bob");
}

console.log("lane 1 — no loop when the note does not come:");
{
  let noteAsks = 0; let size = 170_000;
  const { lm } = live(async (t, opts, n) => {
    if (t === H.NOTE_REQUEST) { noteAsks++; return [call(size, "ok"), done()]; } // ignores the ask
    return [call(n === 1 && size === 170_000 ? 110_000 : size - 1000), call(size, "done"), done()];
  });
  const l = lm.lane("pat"); l.lastPrompt = "Do HIGHCAP-5";
  await lm.send("pat", "go", true);
  ok(await until(() => noteAsks === 1 && l.noteAsk === null && l.noteTry === 170_000), "asked once at 170k; no note → the size is remembered");
  await lm.goIdle("pat");
  size = 200_000; await lm.send("pat", "more", false); await until(() => !l.awaitingIdle && l.outstanding === 0, 1500); await tick(100);
  ok(noteAsks === 1, "at 200k (30k later) it is not asked again");
  await lm.goIdle("pat");
  size = 221_000; await lm.send("pat", "more", false);
  ok(await until(() => noteAsks === 2), "at 221k (51k later) it is asked again");
  await lm.scrap("pat");
}

console.log("lane 2 — mid-run brake past 200k: told between tool calls, carries on in a fresh session by itself:");
{
  let hookSaid = null, second = null, helperSaid = null, refused = null;
  const { lm, sessions } = live(async (t, opts, n) => {
    if (n === 1 && t === "go") {
      refused = (await useTool(opts, "clean_memory", CLEAN)).content[0].text; // before any ask
      const out = [call(110_000, null, ["Bash"])];
      return [...out, { type: "__hook" }];
    }
    return [call(95_000, "Picking up task 3."), done()];
  });
  // the scripted engine yields one sentinel; run the hook and the tool between the calls the way the CLI does
  const l = lm.lane("squid"); l.lastPrompt = "Do HIGHCAP-77"; l.stage = "build";
  const orig = lm.queryFn;
  lm.queryFn = (p) => {
    const g = orig(p); const opts = p.options;
    const wrapped = (async function* () {
      for await (const m of g) {
        if (m.type !== "__hook") { yield m; continue; }
        yield call(205_000, null, ["Bash"]);              // the call that crossed 200k
        await tick(10);
        helperSaid = await postTool(opts, { agent_id: "agent-1" });
        hookSaid = await postTool(opts);
        second = await postTool(opts);
        await useTool(opts, "clean_memory", CLEAN);       // the character obeys
        yield call(206_000, "Hand-over written."); yield done();
      }
    })();
    wrapped.interrupt = async () => {};
    return wrapped;
  };
  await lm.send("squid", "go", true);
  ok(await until(() => sessions.length === 2 && sessions[1].got.length >= 1), "after the turn the town opened a fresh session by itself (nobody typed)");
  ok(/did not ask/.test(refused || ""), "before the brake, clean_memory is refused");
  ok(hookSaid?.hookSpecificOutput?.additionalContext?.includes(H.BRAKE_NOTE), "the tool call after 200k got the brake as additional context");
  ok(!second?.hookSpecificOutput && !helperSaid?.hookSpecificOutput, "said once per session, and never to a helper");
  ok(sessions[1].got[0].includes(CLEAN.handover.trim()) && /Carry on with NEXT now/.test(sessions[1].got[0]), "the fresh session starts from the note and carries on");
  ok(/📒 My memory for this order had grown to 206k tokens/.test(said(l)), "one 📒 line in the chat");
  ok(await until(() => l.lastCallCtx === 95_000 && l.sessionBaseCtx === 95_000), "the new session's size is its own (95k), and growth is measured from there");
  await lm.scrap("squid");
}

console.log("lane 2 — a brake the character ignores is followed by the turn-end ask:");
{
  let noteAsks = 0;
  const { lm } = live(async (t, opts, n) => {
    if (t === H.NOTE_REQUEST) { noteAsks++; await useTool(opts, "clean_memory", CLEAN); return [call(231_000, "Saved."), done()]; }
    return [call(110_000), call(230_000, null, ["Bash"]), { type: "__brake" }, call(230_500, "Done with task 3."), done()];
  });
  const orig = lm.queryFn;
  lm.queryFn = (p) => { const g = orig(p); const w = (async function* () { for await (const m of g) { if (m.type === "__brake") { await tick(10); await postTool(p.options); continue; } yield m; } })(); w.interrupt = async () => {}; return w; };
  const l = lm.lane("pat"); l.lastPrompt = "Do HIGHCAP-77";
  await lm.send("pat", "go", true);
  ok(await until(() => noteAsks === 1 && l.handover?.kind === "memory"), "the town asked at the end of that turn and got the note");
  await lm.scrap("pat");
}

console.log("lane 3 — before a break: idle 55 min on a big session → note while the cache is warm, then a fresh session:");
{
  let noteAsks = 0;
  const { lm, sessions, cues } = live(async (t, opts, n) => {
    if (t === H.NOTE_REQUEST) { noteAsks++; await useTool(opts, "clean_memory", CLEAN); return [call(121_000, "Saved."), done()]; }
    if (n === 1) return [call(80_000), call(120_000, "Plan written."), done()];
    return [call(90_000, "Back on it."), done()];
  });
  const l = lm.lane("bob"); l.lastPrompt = "Do HIGHCAP-8"; l.stage = "plan";
  await lm.send("bob", "go", true);
  await until(() => l.awaitingIdle); await lm.goIdle("bob");
  ok(l.breakTimer !== null, "going idle on a big session arms the pre-break timer");
  const bells = cues.length;
  ok(lm.breakTick("bob", l.idleAt + H.BREAK_IDLE_MS - 60_000) === false && noteAsks === 0, "at 54 min nothing happens");
  ok(lm.breakTick("bob", l.idleAt + H.BREAK_IDLE_MS) === true, "at 55 min the town asks for the note");
  ok(await until(() => l.handover?.kind === "memory" && l.noteAsk === null), "…and it is written in the old (still warm) session");
  ok(cues.length === bells && l.working === false && !/Saved\./.test(said(l)), "silently: no bell, not shown working, nothing in the chat");
  await lm.send("bob", "morning", false);
  ok(await until(() => sessions.length === 2 && sessions[1].got.length >= 1), "coming back opens a fresh session instead of re-reading the old one cold");
  ok(sessions[1].got[0].includes("MAKSYM JUST SAID:\nmorning"), "…with what he said");
  await lm.scrap("bob");
}
{
  // A message that lands while the pre-break note is being written waits for it.
  let release; const gate = new Promise((r) => (release = r));
  const { lm, sessions } = live(async (t, opts, n) => {
    if (t === H.NOTE_REQUEST) { await gate; await useTool(opts, "clean_memory", CLEAN); return [call(121_000, "Saved."), done()]; }
    if (n === 1) return [call(80_000), call(120_000, "Plan written."), done()];
    return [call(90_000, "ok"), done()];
  });
  const l = lm.lane("pat"); l.lastPrompt = "Do HIGHCAP-8";
  await lm.send("pat", "go", true); await until(() => l.awaitingIdle); await lm.goIdle("pat");
  lm.breakTick("pat", l.idleAt + H.BREAK_IDLE_MS);
  await until(() => sessions[0].got.length === 2);
  await lm.send("pat", "I'm back", false); await tick(100);
  ok(sessions.length === 1 && sessions[0].got.length === 2 && l.working === true, "a message during the note is held (shown working), not pushed into the old session");
  release();
  ok(await until(() => sessions.length === 2 && sessions[1].got.length >= 1 && sessions[1].got[0].includes("MAKSYM JUST SAID:\nI'm back")), "…then opens the fresh session with the note");
  await lm.scrap("pat");
}
{
  const { lm } = live(async () => [call(90_000, "x"), done()]);
  const l = lm.lane("squid"); l.lastPrompt = "Do X";
  await lm.send("squid", "go", true); await until(() => l.awaitingIdle); await lm.goIdle("squid");
  ok(lm.breakTick("squid", l.idleAt + 2 * H.BREAK_IDLE_MS) === false, "a 90k session is not handed over before a break (a cold re-read is cheaper)");
  await lm.scrap("squid");
}

console.log(fails ? `\n${fails} check(s) FAILED` : "\nall hand-over checks passed");
process.exit(fails ? 1 : 0);
