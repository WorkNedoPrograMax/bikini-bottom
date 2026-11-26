// A fresh session per ticket stage, and a compaction when a session gets big.
//
// WHY. Every model call re-sends the whole conversation. Measured 2026-11-09..23
// over the seven lanes (scripts/lane-usage.mjs): the average call carried 240k
// tokens, calls above 200k were 64% of the cost, and 79 times a main session
// that had sat for over an hour re-wrote its whole memory to the cache (383k
// tokens each on average). A session that starts clean at each stage carries
// only what the next stage needs.
//
// TWO RULES, both decided here so they can be checked without a live session:
//
// 1. STAGE HAND-OVER. When a character finishes a ticket stage (plan · build ·
//    review · ship) it calls `stage_done` with a short written hand-over. The
//    town ends that session at the end of the turn and starts a new one whose
//    first message is the hand-over. The character decides when the stage is
//    done — the town never cuts one mid-way.
//
// 2. COMPACT AT 200k. When the session's last call carried COMPACT_AT_CTX or
//    more and the character is idle, the next message is preceded by the
//    engine's own /compact, so the turn starts from a summary instead of the
//    full history. It only ever happens between messages, never during a turn.
//
// 3. THE TOWN'S OWN HAND-OVER (2026-11-26, below): rule 1 waits for the
//    character, so the town also asks for the note itself — see the end of this file.

export type Stage = "plan" | "build" | "review" | "ship";
export const STAGES: readonly Stage[] = ["plan", "build", "review", "ship"];

/** Which model a stage runs on. Planning and reviewing are decisions → the
 *  strong model; building and shipping are routine → the cheaper one. A session
 *  with no known stage (a new order, before any hand-over) is "think": the order
 *  starts with understanding and planning. Measured 2026-11-09..23: 99% of the
 *  lanes' spend was on the strong model, 62% of it in the characters' own sessions. */
export type ModelKind = "think" | "routine";
export function stageModelKind(stage: Stage | null | undefined): ModelKind {
  return stage === "build" || stage === "ship" ? "routine" : "think";
}
/** The stage that follows a finished one. After ship nothing is known → null. */
export function nextStage(done: Stage): Stage | null {
  const i = STAGES.indexOf(done);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

export interface Handover {
  stage: Stage;   // the stage that just finished ("memory": the stage in progress)
  next: string;   // what the fresh session starts with, in one line
  text: string;   // the hand-over itself
  at: number;     // epoch ms it was written
  /** "stage" (absent on old saves) = the character finished a stage with
   *  `stage_done`; "memory" = the TOWN asked for it because the session got big
   *  (clean_memory) — the stage carries on in the fresh session. */
  kind?: "stage" | "memory";
  /** Open the fresh session by itself at the end of this turn (the character
   *  was mid-work). False = wait for the next message (he was waiting on Maksym
   *  or idle), so no fresh session is paid for before anyone needs it. */
  auto?: boolean;
}

/** Below this a restart costs more than it saves: a fresh session re-writes its
 *  ~65k (backend) to ~110k (mobile) start to the cache, while carrying on costs
 *  only the cache-read price of the extra history on each call. */
export const HANDOVER_MIN_CTX = 150_000;
/** The last call's size at which the next message is preceded by /compact. */
export const COMPACT_AT_CTX = 200_000;
/** A written hand-over is short on purpose; the files hold the detail. */
export const HANDOVER_MIN_CHARS = 200;
export const HANDOVER_MAX_CHARS = 6000;
/** plan → build → review → ship is three hand-overs; a few review rounds on top. */
export const MAX_HANDOVERS_PER_ORDER = 8;

export type HandoverVerdict =
  | { ok: true; handover: Handover }
  | { ok: false; reply: string };

/** Decide on a `stage_done` call. `ctx` is the size of the session's latest
 *  model call; `helpers` the helpers still running; `done` the hand-overs this
 *  order already made. */
export function handoverVerdict(
  args: { stage?: unknown; next?: unknown; handover?: unknown },
  state: { ctx: number; helpers: number; done: number; now: number; model?: ModelKind },
): HandoverVerdict {
  const stage = String(args.stage || "").trim().toLowerCase() as Stage;
  const next = String(args.next || "").replace(/\s+/g, " ").trim();
  const text = String(args.handover || "").trim();
  if (!STAGES.includes(stage)) return { ok: false, reply: `Not saved — \`stage\` is the stage you just finished: one of ${STAGES.join(", ")}. Carry on.` };
  if (state.helpers > 0) return { ok: false, reply: `Not saved — ${state.helpers} helper(s) are still running, so this stage is not finished. Wait for them, then call stage_done again.` };
  // A hand-over that also changes the model is worth it at any size: the whole
  // next stage then runs at the other model's price, not just a smaller memory.
  const modelChanges = state.model !== undefined && stageModelKind(nextStage(stage)) !== state.model;
  if (!modelChanges && state.ctx < HANDOVER_MIN_CTX) return { ok: false, reply: `Noted, no restart needed — this session is still small (${Math.round(state.ctx / 1000)}k), so carrying on here is cheaper than starting over. Carry on with the next stage in this session.` };
  if (state.done >= MAX_HANDOVERS_PER_ORDER) return { ok: false, reply: "Noted, no restart — this order has already been handed over many times. Carry on in this session and tell Maksym if the ticket keeps looping." };
  if (!next) return { ok: false, reply: "Not saved — `next` is missing: one line saying what the fresh session starts with (e.g. 'run /implement for HIGHCAP-123'). Call stage_done again." };
  if (text.length < HANDOVER_MIN_CHARS) return { ok: false, reply: `Not saved — the hand-over is too thin (${text.length} characters). The next session sees ONLY this text and the files: name the ticket, the branch, what this stage decided and produced (with paths), what Maksym answered, and what is still open. Call stage_done again.` };
  if (text.length > HANDOVER_MAX_CHARS) return { ok: false, reply: `Not saved — the hand-over is ${text.length} characters; keep it under ${HANDOVER_MAX_CHARS}. Point at files instead of pasting them. Call stage_done again.` };
  return { ok: true, handover: { stage, next, text, at: state.now, kind: "stage", auto: true } };
}

/** What the tool answers when the hand-over is accepted. */
export const HANDOVER_SAVED_REPLY =
  "Hand-over saved. End this turn now with ONE short line for Maksym (which stage is done, what comes next) — do not start the next stage here. The town opens a fresh session with your hand-over and carries on by itself.";

/** The first message of the fresh session. `order` is what Maksym originally
 *  asked for; `said` is a message he sent that arrived with the switch. */
export function handoverMessage(h: Handover, order: string | null, said?: string): string {
  if (h.kind === "memory") return [
    `You are carrying on a job in a fresh session: your previous session's memory grew too big, so the town asked you for a hand-over and started you clean (a clean memory is cheaper and sharper). You remember nothing from before — everything you need is in the hand-over below and in the files, the ticket and the pull request it points at. Read those before acting; do not redo finished work. The "${h.stage}" stage is still in progress.`,
    order ? `WHAT MAKSYM ASKED FOR (the original order):\n${order.slice(0, 2000)}` : "",
    `HAND-OVER you wrote just before the switch:\n${h.text}`,
    `NEXT: ${h.next}`,
    said ? `MAKSYM JUST SAID:\n${said}` : "Carry on with NEXT now.",
  ].filter(Boolean).join("\n\n");
  return [
    `You are picking up a job at a stage boundary. The "${h.stage}" stage is finished; this is a fresh session on purpose (a clean memory is cheaper and sharper). You remember nothing from before — everything you need is in the hand-over below and in the files, the ticket and the pull request it points at. Read those before acting; do not redo the finished stage.`,
    order ? `WHAT MAKSYM ASKED FOR (the original order):\n${order.slice(0, 2000)}` : "",
    `HAND-OVER written by you at the end of the "${h.stage}" stage:\n${h.text}`,
    `NEXT: ${h.next}`,
    said ? `MAKSYM JUST SAID:\n${said}` : "Carry on with NEXT now.",
  ].filter(Boolean).join("\n\n");
}

/** Should the next message be preceded by /compact? Only between messages
 *  (the character is idle), only for a session that carries on, and never when
 *  a hand-over is about to replace the session anyway. */
export function compactDue(s: { ctx: number; busy: boolean; continuing: boolean; handoverPending: boolean }): boolean {
  return s.continuing && !s.busy && !s.handoverPending && s.ctx >= COMPACT_AT_CTX;
}

/** The context size one streamed assistant message stands for — only when it is
 *  the character's OWN call. A helper's frames carry a parent_tool_use_id and
 *  their size is the helper's memory, not the session's: on 2026-11-23 16:08 and
 *  2026-11-24 12:01 a review helper's 218,755 / 207,412 calls were taken as the
 *  session size and two sessions of 137,645 / 95,411 were compacted. */
export function mainCallCtx(msg: { type?: string; parent_tool_use_id?: string | null; message?: { usage?: Record<string, number | undefined> } }): number | null {
  if (msg.type !== "assistant" || msg.parent_tool_use_id) return null;
  const u = msg.message?.usage;
  if (!u) return null;
  const c = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  return c > 0 ? c : null;
}

/** The engine's own compaction, told what must survive. */
export const COMPACT_COMMAND =
  "/compact Keep exactly: the ticket key and branch; which stage (plan, build, review, ship) is in progress and what is left of it; every decision and answer Maksym gave; open questions and review findings not yet fixed; the paths of the files and records being worked on; commands that must still be run. Drop: file contents already read, command output, finished steps.";

/** Added to every builder's instructions. */
export const STAGE_NOTE =
  " STAGES AND A CLEAN MEMORY: a ticket moves through stages — plan (kickoff, the approved change), build (implement), review (verify, the reviews, fixing their findings), ship (commit, push, the pull request). The moment one stage is FINISHED — its gate passed, Maksym's answers in, nothing of it left running — and before you start the next one, call `stage_done` with the stage, one line for what comes next, and a short hand-over: the ticket and branch, what this stage decided and produced (paths, not contents), what Maksym answered, what is still open. Then end your turn with one line. The town starts you fresh with that hand-over, so write it for someone who remembers nothing. Never call it in the middle of a stage; if the tool says the session is still small, just carry on. HELPERS AND THEIR MODEL: the town launches Explore, general-purpose, task-context-harvester and figma-comparer with `model: \"sonnet\"` whatever you pass, so give them a self-contained brief; a helper that reviews, audits or judges gets `model: \"opus\"` unless its own file already names one.";


// ───────────── The town's own hand-over (2026-11-26) ─────────────
// WHY. Measured 2026-11-26 (scripts/lane-usage.mjs, .bikini/sessions.json): the
// stage hand-over above almost never fired — mobile pat 0, bob 0, squid 1,
// backend pat 0 at 413k — because it waits for the character to decide a stage
// is done, and the 200k /compact only runs before a message Maksym sends, so a
// long autonomous turn grew from 100k to 400k+ untouched. Mobile pat still had
// 54–62% of its calls above 200k on 2026-11-24/25. So the TOWN now asks for the
// hand-over at three moments, with the `clean_memory` tool:
//
//   turn end   — a turn ended on a session of FORCED_HANDOVER_CTX or more;
//   mid-run    — the session passed MID_RUN_BRAKE_CTX between two tool calls;
//   pre-break  — the character sat idle BREAK_IDLE_MS on a session of
//                BREAK_HANDOVER_MIN_CTX or more: the note is written while the
//                one-hour prompt cache is still warm, so coming back after the
//                break opens a fresh session instead of re-reading the old one
//                cold (74 cache rebuilds after >60 min in the week to 2026-11-26).

/** Turn end: the session size at which the town asks for a hand-over itself
 *  (the same line under which a stage hand-over is refused as not worth it). */
export const FORCED_HANDOVER_CTX = HANDOVER_MIN_CTX;
/** No loop: a session must have grown this much since it started (fresh) or
 *  since the last time the town asked (the note did not come) before it asks again. */
export const FORCED_HANDOVER_REGROW = 50_000;
/** Mid-run: between two tool calls past this size the character is told to
 *  write the hand-over now; the town then carries on in a fresh session. */
export const MID_RUN_BRAKE_CTX = COMPACT_AT_CTX;
/** Pre-break: idle this long → the note is written (the prompt cache lives an hour). */
export const BREAK_IDLE_MS = 55 * 60_000;
/** Pre-break: below this size a cold re-read costs less than a fresh start. */
export const BREAK_HANDOVER_MIN_CTX = 100_000;

export type NoteAsk = "turn" | "brake" | "break";

/** Turn end: ask for the hand-over now? `base` is the size the session started
 *  at when it was opened fresh (0 for a resumed one), `lastTry` the size at the
 *  last ask that brought no note (0 = none). */
export function forcedHandoverDue(s: { ctx: number; base: number; lastTry: number; orderOpen: boolean; handoverPending: boolean; helpers: number }): boolean {
  if (!s.orderOpen || s.handoverPending || s.helpers > 0) return false;
  if (s.ctx < FORCED_HANDOVER_CTX) return false;
  return s.ctx - Math.max(s.base, s.lastTry) >= FORCED_HANDOVER_REGROW;
}

/** Mid-run: tell the character to write the hand-over before its next step?
 *  Once per session (`braked`), never while a note is already asked for or written. */
export function brakeDue(s: { ctx: number; braked: boolean; handoverPending: boolean; noteAsked: boolean; mainThread: boolean }): boolean {
  return s.mainThread && !s.braked && !s.handoverPending && !s.noteAsked && s.ctx >= MID_RUN_BRAKE_CTX;
}

/** Pre-break: write the note now? Only on a live, idle session nobody is using. */
export function breakNoteDue(s: { ctx: number; idleMs: number; live: boolean; busy: boolean; handoverPending: boolean; noteAsked: boolean; waitingOnMaksym: boolean }): boolean {
  return s.live && !s.busy && !s.handoverPending && !s.noteAsked && !s.waitingOnMaksym && s.idleMs >= BREAK_IDLE_MS && s.ctx >= BREAK_HANDOVER_MIN_CTX;
}

/** Decide on a `clean_memory` call. Only taken when the town asked for it
 *  (`asked`), so a character can never restart itself at will. */
export function memoryVerdict(
  args: { next?: unknown; handover?: unknown },
  state: { asked: NoteAsk | null; helpers: number; stage: Stage | null; now: number },
): HandoverVerdict {
  const next = String(args.next || "").replace(/\s+/g, " ").trim();
  const text = String(args.handover || "").trim();
  if (!state.asked) return { ok: false, reply: "Not saved — the town did not ask for a clean memory. Carry on." };
  if (state.helpers > 0) return { ok: false, reply: `Not saved — ${state.helpers} helper(s) are still running. Wait for them, then call clean_memory again.` };
  if (!next) return { ok: false, reply: "Not saved — `next` is missing: one line saying what the fresh session does first. Call clean_memory again." };
  if (text.length < HANDOVER_MIN_CHARS) return { ok: false, reply: `Not saved — the hand-over is too thin (${text.length} characters). The next session sees ONLY this text and the files: name the ticket, the branch, what is done (with paths), what Maksym answered, what is in progress and what is still open. Call clean_memory again.` };
  if (text.length > HANDOVER_MAX_CHARS) return { ok: false, reply: `Not saved — the hand-over is ${text.length} characters; keep it under ${HANDOVER_MAX_CHARS}. Point at files instead of pasting them. Call clean_memory again.` };
  return { ok: true, handover: { stage: state.stage ?? "plan", next, text, at: state.now, kind: "memory", auto: state.asked === "brake" } };
}

const NOTE_BODY = "call `clean_memory` with `next` (one line: what the fresh session does first — or, if you are waiting for Maksym, what you are waiting for) and `handover`: the ticket and branch; what is done and what it produced (paths, not contents); every answer Maksym gave; what is in progress and what is still open; anything that must not be redone. Write it for someone who remembers nothing.";

/** Turn end and pre-break: a message the character gets, never shown in the chat. */
export const NOTE_REQUEST =
  `[The town, not Maksym] Your memory for this order has grown big, so your next turn will run in a fresh session. Do NOT do any other work and do not write anything for Maksym: ${NOTE_BODY} Then end your turn without another word.`;

/** Mid-run: added after a tool call's result (never shown in the chat). */
export const BRAKE_NOTE =
  `[The town, not Maksym] Your memory has passed ${MID_RUN_BRAKE_CTX / 1000}k tokens. Before your next step — once any helpers you started are back — ${NOTE_BODY} Then end your turn with nothing more; the town carries on with NEXT in a fresh session by itself, so do not wait for Maksym.`;

export const MEMORY_SAVED_REPLY =
  "Hand-over saved. End your turn now without another word — the town opens a fresh session with it.";
