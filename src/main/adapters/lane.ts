// The LaneManager runs each Character's Claude session (one Lane, AD-3) inside
// that Character's worktree. It owns the trust layer (Epic 3): Risky-vs-Safe
// permission asks (AD-6), a liveness watchdog (AD-10), cancel + burned + resume.

import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import path from "node:path";
import { readFileSync, promises as fs } from "node:fs";
import type { CharacterId, ChatMessage, AskChoice, Attachment, JobStats, Fuel, Gauge } from "../../shared/ipc";
import { EMPTY_JOB_STATS, EMPTY_FUEL } from "../../shared/ipc";
import type { EventLog } from "../domain/eventLog";
import { ensureWorktree, headSha, serveJob, sendBack } from "./git";
import { clearStrayApiKey } from "./claude";
import { normalizeResetsAt, parseLimitText, fmtClock, isAckOnly, foldFuel, fuelWarnDue, sanitizeStatus, statusAccepted, fallbackNote } from "./guards";
import { log } from "../log";

// KEEP-WARM — the concrete fix for Maksym's overspend on the SDK side (bob/pat).
// A character's live session is ONE long-lived process, like a terminal you
// leave open. It stays alive for this long after going idle, so a follow-up sent
// after one of Maksym's frequent 5-minute breaks INJECTS into the still-warm
// session instead of forcing a cold `resume` — a full re-read of the entire
// conversation, the app-specific cost a real terminal never pays. Only after
// this much true idleness does the process close; the next message resumes cold.
// (Also keeps a slow `ask_maksym` answer from dropping the in-process tool call.)
const KEEPWARM_MS = 3_600_000; // 1 hour
process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT || String(KEEPWARM_MS);

// Load the project's OWN setup — its CLAUDE.md, skills, commands (/implement,
// /review, opsx…), rules, agents, and MCP connectors — exactly like the terminal
// does, so characters are as smart about the repo as Maksym's real Claude Code.
// (We used to pass [] to isolate the permission gate; unneeded now that bypass is
// on and our PreToolUse hook is the gate regardless.)
const SETTING_SOURCES: ("user" | "project" | "local")[] = ["user", "project", "local"];

// Pin every character to Opus 4.8 — the most capable model — so sessions never
// silently fall back to a smaller/cheaper model (Maksym's rule). Maps to the
// CLI's --model flag via the SDK query options.
const MODEL = "claude-sonnet-5[1m]"; // EXECUTOR — cheap Sonnet for the token-heavy build. The [1m] SUFFIX is REQUIRED: plain "claude-sonnet-5" runs a 200k window and a real /implement overflows it → autocompact thrashes and burns (Opus 5 defaults to a big window, which is why it never hit this). [1m] unlocks the full 1M window. Planning is delegated to the Opus 5 `planner` sub-agent (repo).

// Thinking effort. Claude Code's default is "xhigh" (the priciest); Maksym chose
// "high" — the quality/cost sweet spot — to cut Opus token spend without a
// meaningful quality drop. (Maps to --effort.)
const EFFORT = "medium"; // Opus 5 over-invests at "high" (auto-verifies + delegates); Anthropic's migration guide: "Lower effort settings still perform well and often exceed xhigh performance on prior models."

// Per-message spend cap. A single message's agentic loop wraps up gracefully
// when it approaches this many tokens. Set GENEROUS: a thorough /implement
// legitimately needs ~2-3M (mostly re-reading its own context each step), so a
// tight cap just fragments work into "send one more message" turns that re-read
// context to resume — costing MORE, not less. The real runaway guards are
// maxTurns (200) + the 45-min silence watchdog, not this. Tunable.
// (Maps to output_config.task_budget; SDK min is 20,000.)
// (No task budget: it's injected as a countdown the model SEES, and any finite
// value made the executor refuse a full /implement upfront — "out of working
// space" — because plan→build→check→review legitimately needs more than a small
// budget. Anthropic's guide: "for open-ended agentic tasks … do not set a task
// budget." Runaway is bounded instead by maxTurns + the repo's reviewer round-cap.)

// A push-driven message queue used as a live session's streaming input. This is
// what lets Maksym drive a character WHILE it works (like the terminal): every
// message he sends is pushed into the one running session, never spawned as a
// second parallel turn.
interface Pump {
  iter: AsyncGenerator<any>;
  push: (text: string, blocks?: any[]) => void;
  end: () => void;
  closed: () => boolean;
}
function makePump(): Pump {
  const queue: any[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  const iter = (async function* () {
    while (true) {
      if (queue.length) { yield queue.shift(); continue; }
      if (done) return;
      await new Promise<void>((r) => (wake = r));
    }
  })();
  const kick = () => { if (wake) { const w = wake; wake = null; w(); } };
  return {
    iter,
    push(text: string, blocks?: any[]) {
      // With attachments the user message is a content-block array (text + image
      // blocks) instead of a plain string; non-image files are saved to disk and
      // referenced in the text (see prepareAttachments).
      const content = blocks && blocks.length
        ? [...(text ? [{ type: "text", text }] : []), ...blocks]
        : text;
      queue.push({ type: "user", message: { role: "user", content }, parent_tool_use_id: null });
      kick();
    },
    end() { done = true; kick(); },
    closed() { return done; },
  };
}

const isImageType = (t: string) => /^image\/(png|jpe?g|gif|webp)$/i.test(t || "");

/** Data: URLs for showing attached IMAGES back in the chat bubble. */
function imageUrls(atts?: Attachment[]): string[] | undefined {
  const imgs = (atts || []).filter((a) => isImageType(a.mediaType));
  return imgs.length ? imgs.map((a) => `data:${a.mediaType};base64,${a.data}`) : undefined;
}
/** Names of attached NON-image files (shown as chips in the bubble). */
function fileNames(atts?: Attachment[]): string[] | undefined {
  const files = (atts || []).filter((a) => !isImageType(a.mediaType));
  return files.length ? files.map((a) => a.name) : undefined;
}

const WATCHDOG_MS = 2_700_000; // 45 min of TRUE silence → BURNED (AD-10). Very
// generous: real dev work (long reviews, test suites, sub-agents thinking for a
// long stretch) legitimately goes quiet. Any streamed output resets this clock.

// After a `result` (a mere TURN boundary), wait for this much TRUE silence
// before chiming "done". The agent often resumes a beat later — a background
// explorer wakes it, or it keeps thinking — with NO new user message; chiming
// instantly there produced a false "done" chime and a flip back to "working".
// Re-armed on every SDK message, so an active session never trips it.
const SETTLE_MS = 12_000;

// After a HELPER / background task finishes, the main agent almost always has
// follow-up work (read the helper's result, commit, push, write up) that begins
// a beat later WITHOUT a new user message. So a helper finishing must NOT chime
// "done" — we hold for this grace period past the helper's completion, and only
// chime if the agent then stays genuinely quiet. Any resumed activity re-holds.
const HELPER_GRACE_MS = 45_000;

// Last-resort recovery ONLY: if a tracked helper goes TRULY silent this long, we
// assume its completion signal was lost and force done. It sits far above how
// long a real sub-agent legitimately goes quiet — a deep stress-test/review pass
// streams nothing to the parent for 2-8 min, and firing at 150s falsely chimed
// "done" mid-run (then re-chimed on the real completion). The authoritative
// release is the completion signal / background-tasks-changed -> 0; this is just
// a backstop so a genuinely-lost signal can't hang "working" forever.
const HELPER_STALL_MS = 900_000; // 15 min

// QUESTION BATCHING (25 Aug 2026: Patrick called ask_maksym 33 times in one day,
// mostly 1–2 questions at a time, ~half of them progress reports dressed as
// questions — Maksym spent 4–7 h/character just waiting). The repo's prose rule
// ("never drip-feed questions") didn't hold, so the TOOL enforces it: a second
// single question within this window of the last answer is bounced back with
// "batch it" (a `questions` array of 2+ always goes through, so does
// `batchComplete: true`), and an ask whose every option is a mere acknowledgment
// ("I'll check it", "Looks good, keep going") is bounced as a status update.
const ASK_COOLDOWN_MS = 5 * 60_000;

// USAGE LIMIT: when Claude's subscription limit is used up, the CLI ends the
// turn with "You've hit your session limit · resets 1:40pm" and an error result.
// Bikini used to show that as a generic burn ("something went wrong — try
// again"), and every Try again paid a cold resume of the whole conversation just
// to fail again (5 presses in 90 s on 25 Aug). Now: PAUSE with the honest reason
// and the reset time, refuse retries until then, and resume by ourselves.
const LIMIT_FALLBACK_MS = 60 * 60_000; // if no reset time can be read, wait an hour
const LIMIT_RESUME_SLACK_MS = 45_000;   // resume a bit after the reset, not on the dot

// LONG-ORDER NUDGE: past any of these, the character says once, in chat, that
// the next task should be a NEW order (fresh session). A day-long order is what
// pushed context to ~550k tokens per turn and tripped the limit three times.
const NUDGE_CTX_TOKENS = 400_000;
const NUDGE_HOURS = 4;
const NUDGE_OUT_TOKENS = 1_000_000;

// PreToolUse hook verdicts (AD-6).
const ALLOW = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } } as const;
const DENY = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: "Maksym asked you not to do that — take a different approach.",
  },
} as const;
const DENY_READONLY = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: "This is a look-only chat — answer from what you can read, but do not change anything.",
  },
} as const;
const READ_TOOLS = ["Read", "Glob", "Grep", "TodoWrite", "NotebookRead"];

/** A past conversation for a Character, kept so it can be reopened. */
interface ArchivedSession {
  title: string;
  messages: ChatMessage[];
  sdkSessionId: string | null;
}

/** What we persist per Character so a close/reopen keeps everything. */
interface PersistedLane {
  archive: ArchivedSession[];
  current?: {
    conversation: ChatMessage[];
    sessionId: string | null;
    lastPrompt: string | null;
    baseSha: string | null;
    servedTip: string | null;
    served: boolean;
    sentBack: boolean;
    // Job meter + limit hold (optional: older files won't have them).
    taskStartedAt?: number;
    taskTokens?: number;
    stats?: JobStats;
    limitedUntil?: number;
    // The chalk line (Job 2): the character's own status + when it wrote it.
    note?: string | null;
    noteAt?: number;
  };
}

interface Lane {
  conversation: ChatMessage[];
  working: boolean;
  burned: boolean;
  paused: boolean;
  sessionId: string | null;
  lastPrompt: string | null;
  abort: AbortController | null;
  cancelled: boolean;
  superseded: boolean; // this turn was interrupted by a newer one — don't burn it
  resumedSession: boolean; // did THIS session open with a cold resume (vs warm)?
  turnsThisSession: number; // turns answered since this session opened (1 = first)
  lastCallCtx: number;      // context size of the LATEST single model call (input+cache read+cache write) — the true "memory" size
  // Live streaming session (terminal-style): one persistent query fed by `pump`.
  pump: Pump | null;
  sdkQuery: any | null;         // the running query() — for interrupt()
  outstanding: number;          // messages sent but not yet answered (working = >0)
  awaitingIdle: boolean;        // turn ended but helpers still running — hold the "ready" chime
  awaitSince: number;           // epoch ms when awaitingIdle began (max-hold safety cap)
  idleAt: number;               // epoch ms of the last time we chimed "ready" (straggler-chime guard)
  helperFinishedAt: number;     // epoch ms a helper/bg task last finished (post-helper grace before chiming)
  idleTimer: ReturnType<typeof setTimeout> | null; // fires "ready" after true silence
  activity: string | null;      // live label of what it's doing now ("thinking…", "running a command…")
  todos: { content: string; status: string }[]; // Claude's batch/task checklist (live)
  taskStartedAt: number;        // epoch ms the current job began (for elapsed display)
  taskTokens: number;           // output tokens spent on the current job so far
  beatAt: number;               // epoch ms of the last sign of life (any SDK message)
  lastBeatPush: number;         // throttle: last time we pushed a heartbeat snapshot
  sessionLoop: Promise<void> | null;
  pending: { question: string; resolve: (r: unknown) => void } | null;
  // A structured multiple-choice question (Claude's AskUserQuestion tool) awaiting
  // the user's pick(s)/typed answer. resolve() feeds a hook decision back.
  pendingChoice: { ask: AskChoice; resolve: (answer: string) => void } | null;
  watchdog: ReturnType<typeof setTimeout> | null;
  agents: Map<string, string>; // in-flight sub-agents: Task tool_use id → friendly name
  notified: Set<string>;       // task_ids of background notifications already surfaced (dedupe)
  // Serving (Epic 5, AD-5): the Project main-line commits this Job produced.
  baseSha: string | null;   // main HEAD when the Job started
  servedTip: string | null; // main HEAD after the Job landed
  served: boolean;          // work is in the Project (offer Send it back)
  sentBack: boolean;        // work was undone
  collision: boolean;       // landing bumped another Character's work
  // Past-sessions + "just asking" (post-v1 follow-ups):
  archive: ArchivedSession[];   // prior conversations, newest last
  viewing: number | null;       // index of a past session being browsed, or null
  viewReadOnly: boolean;        // is the browsed session in look-only mode?
  askingPast: boolean;          // a read-only/past turn is running
  // Job meter (visible cost) + question batching + usage-limit hold:
  stats: JobStats;              // this job's running tally (turns, helpers, asks, context, time)
  phase: "working" | "waiting" | null; // what the working/waiting clocks are currently counting
  phaseSince: number;           // epoch ms the current phase began
  lastAskAnsweredAt: number;    // epoch ms Maksym last answered an ask_maksym (cooldown anchor)
  nudged: boolean;              // the once-per-job "start the next task as a new order" note was shown
  limitedUntil: number;         // epoch ms Claude's usage limit resets (0 = not limited)
  limitTimer: ReturnType<typeof setTimeout> | null; // auto-resume when the limit resets
  limitSeen: { resetsAt: number; text: string } | null; // a limit signal seen during the current turn
  // Chalk line (Job 2): ONE sentence in the character's own words about where it
  // is, posted via `post_status`. Shown under its name on the street.
  note: string | null;
  noteAt: number;               // epoch ms of the last accepted line (cooldown anchor)
}

/** Adoption support (Scout & Runner): a character labels an existing lane.
 *  Bikini only needs to know WHERE a character works — it never touches git/PRs. */
export interface AdoptionSupport {
  /** The worktree a character is adopted onto (its existing lane), or null.
   *  Includes the lane's already-running app ports so we can tell the character
   *  the servers are up (and not to start its own). */
  adoptionFor(id: CharacterId): { worktree: string; branch: string; label: string; frontendPort?: number; backendPort?: number } | null;
}

export interface LaneView {
  conversation: ChatMessage[];
  working: boolean;
  pendingAsk: string | null;
  pendingChoice: AskChoice | null;
  burned: boolean;
  paused: boolean;
  served: boolean;
  sentBack: boolean;
  collision: boolean;
  /** How many sub-agents ("helpers") are running right now. */
  agents: number;
  /** The running helpers' friendly names (for the header list). */
  agentNames: string[];
  /** Live "what it's doing now" label while working, or null. */
  activity: string | null;
  /** The current job's short title (its first instruction), or null. */
  taskTitle: string | null;
  /** Claude's live batch/task checklist, and the job's running time + spend. */
  todos: { content: string; status: string }[];
  taskStartedAt: number;
  taskTokens: number;
  /** Epoch ms of the last sign of life from the session (0 if none). */
  beatAt: number;
  /** Claude's usage limit resets at (epoch ms); 0 when not limited. */
  limitedUntil: number;
  /** This job's running tally (with the live phase's time folded in). */
  jobStats: JobStats;
  /** The chalk line — the character's own one-sentence status, or null. */
  note: string | null;
  noteAt: number;
  /** Epoch ms the current phase (working / waiting) began — "· 12 min" on the board. */
  phaseSince: number;
  /** Prior conversations for this Character (newest last). */
  pastSessions: { index: number; title: string }[];
  /** A past session being browsed, or null when on the current conversation. */
  viewing: { index: number; readOnly: boolean; messages: ChatMessage[]; asking: boolean } | null;
}

export class LaneManager {
  private lanes = new Map<CharacterId, Lane>();
  /** Single integration queue — serves apply one at a time (AD-5). */
  private integrateChain: Promise<void> = Promise.resolve();

  constructor(
    private projectPath: string,
    private log: EventLog,
    private onChange: () => void,
    private onFinished: (id: CharacterId, summary: string) => void = () => {},
    /** Fires a sound cue: 'start' on a first order, 'ready' when it needs Maksym. */
    private onCue: (id: CharacterId, kind: "start" | "ready") => void = () => {},
    /** When true, characters never stop to ask — bypass permissions (Maksym's pref). */
    private getBypass: () => boolean = () => false,
    /** Scout & Runner adoption: a character labels an existing lane (or null). */
    private adopt: AdoptionSupport | null = null,
    /** Reserve light (Orca plan, Job 1): where to persist the town-wide usage
     *  windows (<userData>/fuel.json) and whom to tell the first time the 5-hour
     *  tank lights up. Both optional — tests and the smoke path run without. */
    private fuelOpts: { fuelFile?: string; onFuelWarning?: (g: Gauge) => void } = {}
  ) {
    this.sessionsFile = path.join(projectPath, ".bikini", "sessions.json");
    if (fuelOpts.fuelFile) {
      try {
        const raw = JSON.parse(readFileSync(fuelOpts.fuelFile, "utf8"));
        if (raw && typeof raw === "object") {
          this.fuelState = { fiveHour: raw.fuel?.fiveHour ?? null, sevenDay: raw.fuel?.sevenDay ?? null };
          this.warnedFor = Number(raw.warnedFor) || 0;
        }
      } catch { /* no fuel.json yet — dark */ }
    }
    try {
      const raw = JSON.parse(readFileSync(this.sessionsFile, "utf8"));
      // Migrate the old shape ({id: ArchivedSession[]}) → {id: {archive,current}}.
      for (const [id, v] of Object.entries(raw)) {
        this.loaded[id] = Array.isArray(v) ? { archive: v as ArchivedSession[] } : (v as PersistedLane);
      }
    } catch { this.loaded = {}; }
  }

  private sessionsFile: string;
  private loaded: Record<string, PersistedLane> = {};

  // Reserve light: Claude's usage windows are per ACCOUNT, not per character, so
  // every lane's rate_limit_event folds into this one town-wide reading.
  private fuelState: Fuel = EMPTY_FUEL;
  private warnedFor = 0; // resetsAt of the 5-hour window we already warned about
  /** The town-wide usage windows (for the street sign + /town). */
  fuel(): Fuel { return this.fuelState; }
  private takeFuelEvent(id: CharacterId, info: Record<string, any>): void {
    const ev = { type: String(info.rateLimitType || ""), status: String(info.status || ""), util: typeof info.utilization === "number" ? info.utilization : undefined, resetsAt: info.resetsAt, at: Date.now() };
    const prev = this.fuelState;
    const next = foldFuel(prev, ev);
    if (next === prev) return;
    this.fuelState = next;
    if (fuelWarnDue(prev, next, this.warnedFor) && next.fiveHour) {
      this.warnedFor = next.fiveHour.resetsAt;
      log("limit", `${id} reserve light ON`, { util: next.fiveHour.util, level: next.fiveHour.level, resetsAt: new Date(next.fiveHour.resetsAt).toISOString() });
      try { this.fuelOpts.onFuelWarning?.(next.fiveHour); } catch { /* never let a notifier break the lane */ }
    }
    if (this.fuelOpts.fuelFile) void fs.writeFile(this.fuelOpts.fuelFile, JSON.stringify({ fuel: this.fuelState, warnedFor: this.warnedFor }), "utf8").catch(() => {});
    this.onChange();
  }

  /** Persist each Character's past sessions AND current conversation so a
   *  close/reopen keeps everything (the live chat, not just old orders). */
  private persist(): void {
    const map: Record<string, PersistedLane> = { ...this.loaded };
    for (const [id, l] of this.lanes) {
      map[id] = {
        archive: l.archive,
        current: {
          conversation: l.conversation, sessionId: l.sessionId, lastPrompt: l.lastPrompt,
          baseSha: l.baseSha, servedTip: l.servedTip, served: l.served, sentBack: l.sentBack,
          taskStartedAt: l.taskStartedAt, taskTokens: l.taskTokens, stats: l.stats, limitedUntil: l.limitedUntil,
          note: l.note, noteAt: l.noteAt,
        },
      };
    }
    void fs.writeFile(this.sessionsFile, JSON.stringify(map), "utf8").catch(() => {});
  }

  lane(id: CharacterId): Lane {
    let l = this.lanes.get(id);
    if (!l) {
      const saved = this.loaded[id];
      const cur = saved?.current;
      l = this.lanes.set(id, {
        conversation: cur?.conversation ?? [], working: false, burned: false, paused: false,
        sessionId: cur?.sessionId ?? null, lastPrompt: cur?.lastPrompt ?? null,
        abort: null, cancelled: false, superseded: false,
        resumedSession: false, turnsThisSession: 0, lastCallCtx: 0,
        pump: null, sdkQuery: null, outstanding: 0, awaitingIdle: false, awaitSince: 0, idleAt: 0, helperFinishedAt: 0, idleTimer: null,
        activity: null, todos: [], taskStartedAt: cur?.taskStartedAt ?? 0, taskTokens: cur?.taskTokens ?? 0, beatAt: 0, lastBeatPush: 0, sessionLoop: null,
        pending: null, pendingChoice: null, watchdog: null, agents: new Map(), notified: new Set(),
        baseSha: cur?.baseSha ?? null, servedTip: cur?.servedTip ?? null,
        served: cur?.served ?? false, sentBack: cur?.sentBack ?? false, collision: false,
        archive: saved?.archive ?? [], viewing: null, viewReadOnly: true, askingPast: false,
        stats: { ...EMPTY_JOB_STATS, ...(cur?.stats ?? {}) }, phase: null, phaseSince: 0,
        lastAskAnsweredAt: 0, nudged: false,
        limitedUntil: cur?.limitedUntil ?? 0, limitTimer: null, limitSeen: null,
        note: cur?.note ?? null, noteAt: cur?.noteAt ?? 0,
      }).get(id)!;
      // Closed the app while waiting out a usage limit? Keep waiting — and keep
      // the promise to pick up by ourselves when it resets.
      if (l.limitedUntil > Date.now()) { l.paused = true; this.scheduleLimitResume(id); }
      else l.limitedUntil = 0;
    }
    return l;
  }

  /** Epoch ms Claude's usage limit resets for this character (0 = not limited). */
  limitedUntil(id: CharacterId): number { const l = this.lane(id); return l.limitedUntil > Date.now() ? l.limitedUntil : 0; }

  /** The working/waiting clocks: switch what's being counted, banking the time
   *  spent in the phase that just ended. Waiting = idle/asking/paused, i.e. the
   *  hours Maksym couldn't see on 25 Aug (4.2 h and 7.4 h per character). */
  private setPhase(l: Lane, phase: "working" | "waiting"): void {
    const now = Date.now();
    if (l.phase && l.phaseSince) {
      const dt = Math.max(0, now - l.phaseSince);
      if (l.phase === "working") l.stats.workingMs += dt; else l.stats.waitingMs += dt;
    }
    l.phase = phase; l.phaseSince = now;
  }

  conversationFor(id: CharacterId): ChatMessage[] { return this.lane(id).conversation; }
  isWorking(id: CharacterId): boolean { return this.lane(id).working; }
  /** How many characters are cooking right now (across all lanes). */
  workingCount(): number { let n = 0; for (const l of this.lanes.values()) if (l.working) n++; return n; }
  /** Names of the characters currently cooking (for a quit warning). */
  workingNames(): CharacterId[] { const out: CharacterId[] = []; for (const [id, l] of this.lanes) if (l.working) out.push(id); return out; }
  /** The character's current SDK session id (for `claude --resume`), or null. */
  sessionIdFor(id: CharacterId): string | null { return this.lane(id).sessionId; }
  lastPromptFor(id: CharacterId): string | null { return this.lane(id).lastPrompt; }
  isBurned(id: CharacterId): boolean { return this.lane(id).burned; }
  isPaused(id: CharacterId): boolean { return this.lane(id).paused; }
  // A pending question/permission only counts while there's a LIVE session
  // behind it (l.pump). A leftover pending with no session is stale — it can't be
  // answered into a dead session — so treat it as gone, or it shows a phantom
  // "waiting for you" with nothing to act on (Maksym's Pat bug).
  hasPendingAsk(id: CharacterId): boolean { const l = this.lane(id); return l.pending !== null && !!l.pump; }
  hasPendingChoice(id: CharacterId): boolean { const l = this.lane(id); return l.pendingChoice !== null && !!l.pump; }
  view(id: CharacterId): LaneView {
    const l = this.lane(id);
    const live = !!l.pump; // pending items are only real while the session is alive
    return {
      conversation: l.conversation, working: l.working, pendingAsk: live ? (l.pending?.question ?? null) : null,
      pendingChoice: live ? (l.pendingChoice?.ask ?? null) : null,
      burned: l.burned, paused: l.paused, served: l.served, sentBack: l.sentBack, collision: l.collision,
      agents: l.agents.size,
      agentNames: [...l.agents.values()],
      activity: l.activity,
      // The current job's title = its first instruction (same rule as Past orders).
      taskTitle: (() => {
        const firstYou = l.conversation.find((m) => m.from === "you" && m.text);
        return firstYou ? firstYou.text.replace(/\s+/g, " ").trim().slice(0, 80) : null;
      })(),
      todos: l.todos,
      taskStartedAt: l.taskStartedAt,
      taskTokens: l.taskTokens,
      beatAt: l.beatAt,
      limitedUntil: l.limitedUntil > Date.now() ? l.limitedUntil : 0,
      // Stats with the CURRENT phase's elapsed time folded in, so the clocks tick.
      jobStats: (() => {
        const s = { ...l.stats };
        if (l.phase && l.phaseSince) {
          const dt = Math.max(0, Date.now() - l.phaseSince);
          if (l.phase === "working") s.workingMs += dt; else s.waitingMs += dt;
        }
        return s;
      })(),
      note: l.note, noteAt: l.noteAt,
      phaseSince: l.phaseSince,
      pastSessions: l.archive.map((s, i) => ({ index: i, title: s.title })),
      viewing: l.viewing != null && l.archive[l.viewing]
        ? { index: l.viewing, readOnly: l.viewReadOnly, messages: l.archive[l.viewing].messages, asking: l.askingPast }
        : null,
    };
  }

  /** On boot, a Character left mid-cook is paused (AD-11): offer Keep cooking. */
  markPaused(id: CharacterId, lastPrompt: string | null): void {
    const l = this.lane(id);
    l.paused = true; l.lastPrompt = lastPrompt;
    l.conversation.push({ from: "them", text: "I paused when you closed the app. Want me to keep cooking, or scrap it?" });
  }

  async startJob(id: CharacterId, prompt: string, attachments?: Attachment[]): Promise<void> {
    const l = this.lane(id);
    // Any pending question/permission from the OLD job must be cleared, or it
    // leaks into the fresh job's window (Maksym's bug: Patrick's question
    // followed him into a brand-new Krabs job).
    if (l.pending) { const r = l.pending.resolve; l.pending = null; r(DENY); }
    if (l.pendingChoice) { const r = l.pendingChoice.resolve; l.pendingChoice = null; r("(cancelled — starting a new job)"); }
    // A new Job starts a fresh conversation — end any live session and archive
    // the old one so it can be reopened later (FR-13; past-sessions follow-up).
    this.endSession(l);
    if (l.conversation.length) {
      const firstYou = l.conversation.find((m) => m.from === "you");
      l.archive.push({
        title: (firstYou?.text || "a past order").replace(/\s+/g, " ").slice(0, 40),
        messages: l.conversation.slice(),
        sdkSessionId: l.sessionId,
      });
      this.persist();
    }
    l.viewing = null;
    l.conversation = [{ from: "you", text: prompt, images: imageUrls(attachments), files: fileNames(attachments) }];
    l.sessionId = null; l.lastPrompt = prompt;
    l.todos = []; l.taskStartedAt = Date.now(); l.taskTokens = 0; // fresh job → fresh plan/timer/spend
    l.stats = { ...EMPTY_JOB_STATS }; l.phase = null; l.phaseSince = 0; l.nudged = false; l.lastAskAnsweredAt = 0;
    l.note = null; l.noteAt = 0; // a fresh order starts with a clean chalk line
    this.clearLimit(l); // a new order never inherits an old limit hold
    // Remember the main-line commit this Job builds on (for landing/undo, AD-5).
    try { l.baseSha = await headSha(this.projectPath); } catch { l.baseSha = null; }
    l.servedTip = null; l.served = false; l.sentBack = false; l.collision = false;
    await this.log.append({ type: "JobHandedOut", id, prompt });
    this.onCue(id, "start"); // first order of this session
    void this.send(id, prompt, false, attachments);
  }

  /** A follow-up. If a live session is running, the message is INJECTED into it
   *  (drives the character while it works, like the terminal) — never a second
   *  parallel turn. If idle, it wakes the session back up (resuming context). */
  async followUp(id: CharacterId, prompt: string, attachments?: Attachment[]): Promise<void> {
    const l = this.lane(id);
    l.conversation.push({ from: "you", text: prompt, images: imageUrls(attachments), files: fileNames(attachments) });
    l.burned = false;
    this.onChange();
    void this.send(id, prompt, false, attachments);
  }

  /** Try again / Keep cooking after a burn: wake the session and tell it to
   *  carry on where it left off (resumes context — never replays the first
   *  prompt from scratch). */
  async retry(id: CharacterId): Promise<void> {
    const l = this.lane(id);
    // Waiting out Claude's usage limit and Maksym presses Try again anyway? His
    // call — the reset clock can be conservative. Drop the hold and try; if the
    // limit is still on, the turn ends with the limit error and we park again
    // with the freshly reported reset time (one cold re-read, no loop).
    if (l.limitedUntil > Date.now()) {
      log("limit", `${id} retry during limit hold — trying now anyway`, { resetsAt: new Date(l.limitedUntil).toISOString() });
      this.clearLimit(l);
      l.burned = false; l.paused = false;
      l.conversation.push({ from: "you", text: "Try again now." });
      l.conversation.push({ from: "them", text: "🔁 Trying now — if Claude's limit is still on, I'll wait it out again with the new reset time.", tool: true });
      this.onChange();
      void this.send(id, "Continue from where you left off and finish what you were doing.", false);
      return;
    }
    this.clearLimit(l);
    l.burned = false; l.paused = false;
    l.conversation.push({ from: "you", text: "Keep going — pick up where you left off." });
    this.onChange();
    void this.send(id, "Continue from where you left off and finish what you were doing.", false);
  }

  /** Forget a usage-limit hold (new order, scrap, cancel, or the limit reset). */
  private clearLimit(l: Lane): void {
    l.limitedUntil = 0; l.limitSeen = null;
    if (l.limitTimer) { clearTimeout(l.limitTimer); l.limitTimer = null; }
  }

  /** Claude's usage limit is used up. NOT a burn: pause with the honest reason
   *  and the reset time, hold the session's place, and come back by ourselves.
   *  (Before: "something went wrong — try again", and each Try again cold-
   *  resumed the whole conversation only to fail again.) */
  private async pauseForLimit(id: CharacterId, seen: { resetsAt: number; text: string }): Promise<void> {
    const l = this.lane(id);
    const resetsAt = seen.resetsAt > Date.now() ? seen.resetsAt : Date.now() + LIMIT_FALLBACK_MS;
    l.limitSeen = null;
    l.limitedUntil = resetsAt;
    l.stats.limitHits++;
    this.endSession(l);
    l.paused = true; l.burned = false; l.working = false; l.activity = null; l.agents.clear();
    this.clearWatchdog(l);
    this.setPhase(l, "waiting");
    l.conversation.push({ from: "them", text: `⏳ Claude's usage limit is used up for now — it resets at ${fmtClock(resetsAt)}. I'm holding my place and will pick up again by myself right after; nothing is lost. (Scrap it if you'd rather drop this order.)` });
    log("limit", `${id} paused — usage limit`, { resetsAt: new Date(resetsAt).toISOString(), hits: l.stats.limitHits, seen: seen.text.slice(0, 80) });
    await this.log.append({ type: "CharacterStateChanged", id, state: "calling" });
    this.onCue(id, "ready"); // so the phone hears about it (main.ts words it as a limit, not a snag)
    this.scheduleLimitResume(id);
    this.persist();
    this.onChange();
  }

  /** Arm the auto-resume for a limit hold: a beat after the reset, carry on.
   *  Belt AND braces: a one-shot timer plus a 30 s sweep (`limitSweep`) — macOS
   *  throttles a backgrounded app's long timers (App Nap), which made the first
   *  live resume fire 9 minutes late on 25 Aug; short periodic checks don't drift. */
  private scheduleLimitResume(id: CharacterId): void {
    const l = this.lane(id);
    if (l.limitTimer) clearTimeout(l.limitTimer);
    const delay = Math.max(15_000, l.limitedUntil - Date.now() + LIMIT_RESUME_SLACK_MS);
    l.limitTimer = setTimeout(() => { l.limitTimer = null; this.resumeAfterLimit(id); }, delay);
    if (!this.limitSweep) {
      this.limitSweep = setInterval(() => {
        let anyHeld = false;
        for (const [cid, ln] of this.lanes) {
          if (!ln.paused || !ln.limitedUntil) continue;
          anyHeld = true;
          if (Date.now() >= ln.limitedUntil + LIMIT_RESUME_SLACK_MS) this.resumeAfterLimit(cid);
        }
        if (!anyHeld && this.limitSweep) { clearInterval(this.limitSweep); this.limitSweep = null; }
      }, 30_000);
    }
  }
  private limitSweep: ReturnType<typeof setInterval> | null = null;

  /** The limit has reset → carry on where we left off. Idempotent. */
  private resumeAfterLimit(id: CharacterId): void {
    const l = this.lane(id);
    if (!l.paused || !l.limitedUntil) return; // scrapped / resumed by hand meanwhile
    if (Date.now() < l.limitedUntil) return;   // not yet
    this.clearLimit(l);
    l.paused = false;
    l.conversation.push({ from: "them", text: "🔔 Claude's limit has reset — picking up right where I left off." });
    log("limit", `${id} limit reset — resuming`);
    this.onChange();
    void this.send(id, "Continue from where you left off and finish what you were doing.", false);
  }

  /** Once per job: when an order has grown long/heavy, say so in chat and point
   *  at the fix (next task = NEW order). Informational — no chime, no pause. */
  private maybeNudge(id: CharacterId, ctx: number): void {
    const l = this.lane(id);
    if (l.nudged || !l.taskStartedAt) return;
    const hours = (Date.now() - l.taskStartedAt) / 3_600_000;
    const why: string[] = [];
    if (ctx >= NUDGE_CTX_TOKENS) why.push(`my memory for this order is up to ${Math.round(ctx / 1000)}k tokens`);
    if (hours >= NUDGE_HOURS) why.push(`it's been running ${Math.floor(hours)} hours`);
    if (l.taskTokens >= NUDGE_OUT_TOKENS) why.push(`I've written ${(l.taskTokens / 1e6).toFixed(1)}M tokens`);
    if (!why.length) return;
    l.nudged = true;
    const helpers = l.stats.helpers ? `, with ${l.stats.helpers} helpers called in so far` : "";
    l.conversation.push({ from: "them", text: `🧭 Heads-up from the kitchen: ${why.join(", ")}${helpers}. Long orders get slower and pricier with every step — the whole conversation is re-read each turn, and that's what runs into Claude's limit. When this piece lands, hand the next task out as a NEW order (fresh start) instead of adding it here.` });
    log("lane", `${id} long-order nudge`, { ctx, hours: hours.toFixed(1), out: l.taskTokens, helpers: l.stats.helpers });
  }

  /** Deliver a user message to the character's live session, starting (or
   *  resuming) the session if one isn't already running. Single-flight: there is
   *  only ever ONE session per character, so messages queue/inject in order. */
  private async send(id: CharacterId, text: string, fresh: boolean, attachments?: Attachment[]): Promise<void> {
    const l = this.lane(id);
    if (!l.pump || l.pump.closed()) {
      // No live session → open one. Resume the prior session unless this is a
      // brand-new job (fresh), so context carries across follow-ups and restarts.
      const resume = !fresh && !!l.sessionId;
      l.pump = makePump();
      l.sessionLoop = this.runSession(id, l.pump, resume);
    }
    l.outstanding++;
    l.working = true; l.burned = false; l.paused = false; l.cancelled = false; l.awaitingIdle = false;
    l.limitSeen = null; // a fresh turn starts with a clean slate (no stale limit flag from an old turn)
    this.setPhase(l, "working");
    if (l.idleTimer) { clearTimeout(l.idleTimer); l.idleTimer = null; }
    // Reset the heartbeat to NOW so the "working" strip counts from THIS message,
    // not from the character's last activity (which could be minutes ago after it
    // finished a prior task) — otherwise it instantly shows a stale "no update for
    // 110s" the moment you send, which looks stuck but isn't.
    l.beatAt = Date.now();
    l.activity = "getting started…";
    // Turn attachments into image content blocks (inline vision) + saved files
    // (referenced by path so the character opens them with its tools — works for
    // ANY file type: PDFs, logs, CSVs, code, etc.).
    const { blocks, textSuffix } = await this.prepareAttachments(id, attachments);
    l.pump.push(text + textSuffix, blocks);
    this.armWatchdog(id);
    // AWAIT the state event before pushing a snapshot — the event log persists
    // asynchronously, so a fire-and-forget append would let the snapshot render
    // the OLD state (street icon stuck on idle while the chat is actually
    // working). Awaiting keeps the street icon in sync with the session.
    await this.log.append({ type: "CharacterStateChanged", id, state: "working" });
    this.onChange();
  }

  /** Prepare a message's attachments: images become inline vision blocks (the
   *  character sees them directly); every OTHER file is written into the lane's
   *  `.bikini-attachments/` folder and its path referenced in the text, so the
   *  character opens it with its own tools (Read/Bash) — works for ANY file:
   *  PDFs, logs, CSVs, code, spreadsheets, etc. */
  private async prepareAttachments(id: CharacterId, atts?: Attachment[], imagesAsFiles = false): Promise<{ blocks: any[]; textSuffix: string }> {
    if (!atts || !atts.length) return { blocks: [], textSuffix: "" };
    const blocks: any[] = [];
    // Images normally become inline vision blocks. But when the destination is a
    // text-only slot (a tool answer to ask_maksym), `imagesAsFiles` saves them to
    // disk like any other file and references them by path instead.
    if (!imagesAsFiles) {
      for (const a of atts) {
        if (isImageType(a.mediaType)) {
          blocks.push({ type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } });
        }
      }
    }
    const others = imagesAsFiles ? atts : atts.filter((a) => !isImageType(a.mediaType));
    const savedPaths = await this.writeAttachmentFiles(id, others);
    const textSuffix = savedPaths.length
      ? `\n\nI've attached ${savedPaths.length} file(s) for you to open and use:\n` + savedPaths.map((p) => `- ${p}`).join("\n")
      : "";
    return { blocks, textSuffix };
  }

  /** Write attachments into the lane's `.bikini-attachments/` folder; return
   *  their absolute paths. Shared by SDK chats and terminal chars. */
  private async writeAttachmentFiles(id: CharacterId, atts: Attachment[]): Promise<string[]> {
    if (!atts.length) return [];
    const saved: string[] = [];
    try {
      const wt = await this.worktreeFor(id);
      const dir = path.join(wt, ".bikini-attachments");
      await fs.mkdir(dir, { recursive: true });
      let i = 0;
      for (const a of atts) {
        const base = (a.name || "file").replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
        const full = path.join(dir, `${i++}-${base}`);
        await fs.writeFile(full, Buffer.from(a.data, "base64"));
        saved.push(full);
      }
    } catch (e) {
      log("lane", `${id} attachment save failed`, { error: String(e).slice(0, 120) });
    }
    return saved;
  }

  /** Save attachments and return their paths — for TERMINAL characters (squid),
   *  which have no chat message to embed files in, so they receive them by path
   *  typed into the terminal. Images included (Claude reads them from disk). */
  async saveAttachments(id: CharacterId, atts?: Attachment[]): Promise<string[]> {
    return this.writeAttachmentFiles(id, atts || []);
  }

  /** Tear down a character's live session (scrap, new job, or shutdown). */
  private endSession(l: Lane): void {
    if (l.pump && !l.pump.closed()) l.pump.end();
    try { l.sdkQuery?.interrupt?.(); } catch { /* best effort */ }
    l.abort?.abort();
    l.pump = null; l.sdkQuery = null; l.outstanding = 0; l.awaitingIdle = false;
    if (l.idleTimer) { clearTimeout(l.idleTimer); l.idleTimer = null; }
  }

  /** Scrap a burned/paused order → back to Idle. Ends the live session. */
  async scrap(id: CharacterId): Promise<void> {
    const l = this.lane(id);
    l.cancelled = true;
    this.endSession(l);
    this.clearLimit(l);
    l.burned = false; l.paused = false; l.working = false;
    this.clearWatchdog(l);
    this.setPhase(l, "waiting");
    l.note = null; l.noteAt = 0; // nothing to report about a scrapped order
    l.conversation.push({ from: "them", text: "Scrapped. That order's off the books." });
    await this.log.append({ type: "CharacterStateChanged", id, state: "idle" });
    this.persist();
    this.onChange();
  }

  /** Cancel/stop cooking (FR-14): stop everything the character is doing right
   *  now. Ends the whole live session so nothing keeps writing (fixes the
   *  "I said stop but it kept going" bug — there are no parallel turns to miss). */
  async cancel(id: CharacterId): Promise<void> {
    const l = this.lane(id);
    if (l.pending) { const r = l.pending.resolve; l.pending = null; r(DENY); }
    if (l.pendingChoice) { const r = l.pendingChoice.resolve; l.pendingChoice = null; r("(cancelled — no answer)"); }
    if (!l.working && !l.pump) return;
    l.cancelled = true;
    this.endSession(l);
    this.clearLimit(l);
    l.working = false;
    this.clearWatchdog(l);
    this.setPhase(l, "waiting");
    l.conversation.push({ from: "them", text: "Okay — I stopped. Nothing was left half-done." });
    await this.log.append({ type: "CharacterStateChanged", id, state: "idle" });
    this.persist();
    this.onChange();
  }

  /** Land a finished Job's work in the Project (AD-5), serialized so two
   *  serves never race. Sets served / collision and narrates the outcome. */
  private integrate(id: CharacterId, strategy?: "mine" | "theirs"): Promise<void> {
    const l = this.lane(id);
    const adoption = this.adopt?.adoptionFor(id);
    this.integrateChain = this.integrateChain.then(async () => {
      try {
        if (adoption) {
          // Adopted lane: Bikini does NOT manage git or PRs. The repo's own
          // instructions/skills (and the session itself) decide commits, branches,
          // and PRs. "Finish" here just means the character is done — nothing else.
          return;
        }
        const res = await serveJob(this.projectPath, id, l.lastPrompt || "your job", strategy);
        if (res.status === "served") {
          l.served = true; l.collision = false; l.servedTip = res.tip ?? null;
          l.conversation.push({ from: "them", text: "Served! Your work is in the project now — Send it back if you don't like it." });
        } else if (res.status === "collision") {
          l.collision = true; l.served = false;
          l.conversation.push({ from: "them", text: "Me work bumped into another neighbour's on the same spot — come pick which one stays." });
        }
        // 'nochange' → nothing to land; stays a plain finished order.
      } catch { /* leave as finished; serving can be retried */ }
      this.onChange();
    });
    return this.integrateChain;
  }

  /** Send a served Job back — undo its changes in the Project (FR-16, AD-5). */
  async sendItBack(id: CharacterId): Promise<void> {
    const l = this.lane(id);
    if (!l.served || !l.baseSha || !l.servedTip) return;
    const r = await sendBack(this.projectPath, l.baseSha, l.servedTip);
    if (r.status === "sent") {
      l.served = false; l.sentBack = true;
      l.conversation.push({ from: "them", text: "Sent it back — the project is just as it was before this order." });
    } else {
      l.conversation.push({ from: "them", text: "I couldn't cleanly send this back — newer work built on top of it. I left everything as-is to be safe." });
    }
    this.persist();
    this.onChange();
  }

  /** Resolve a landing collision by keeping one side (FR-16, AD-5). */
  async resolveCollision(id: CharacterId, keepMine: boolean): Promise<void> {
    const l = this.lane(id);
    if (!l.collision) return;
    l.conversation.push({ from: "you", text: keepMine ? "Keep this one's version." : "Keep the other's version." });
    await this.integrate(id, keepMine ? "mine" : "theirs");
  }

  /** Open a past conversation to browse it — read-only ("just asking") by default. */
  openPast(id: CharacterId, index: number): void {
    const l = this.lane(id);
    if (index < 0 || index >= l.archive.length) return;
    l.viewing = index; l.viewReadOnly = true;
    this.onChange();
  }

  /** Promote a past order to the CURRENT live session and continue it. The old
   *  current conversation is archived; the chosen past one becomes the working
   *  session (resumed by its SDK id), so the character now cooks in it and its
   *  street state (working/calling) tracks it — "talking to a past order makes
   *  it the main one" (Maksym). */
  async resumePast(id: CharacterId, index: number, prompt: string): Promise<void> {
    const l = this.lane(id);
    if (index < 0 || index >= l.archive.length) return;
    const sess = l.archive[index];
    this.endSession(l); // stop whatever's live now
    // Archive the current conversation (if it's a real, different one).
    if (l.conversation.length && l.conversation !== sess.messages && l.sessionId !== sess.sdkSessionId) {
      const firstYou = l.conversation.find((m) => m.from === "you");
      l.archive.push({
        title: (firstYou?.text || "a past order").replace(/\s+/g, " ").slice(0, 40),
        messages: l.conversation.slice(), sdkSessionId: l.sessionId,
      });
    }
    // Promote the chosen past order to current (remove it from the archive).
    l.archive.splice(index, 1);
    l.conversation = sess.messages;
    l.sessionId = sess.sdkSessionId;
    l.lastPrompt = prompt;
    l.viewing = null; l.burned = false; l.paused = false;
    l.note = null; l.noteAt = 0; // a promoted old order must not carry a stale chalk line
    l.conversation.push({ from: "you", text: prompt });
    this.onChange();
    log("lane", `${id} resumed a past order as current`, { sessionId: sess.sdkSessionId });
    void this.send(id, prompt, false); // resume that session live → state tracks (working→calling)
  }

  /** Return to the current conversation. */
  closePast(id: CharacterId): void {
    const l = this.lane(id);
    l.viewing = null;
    this.onChange();
  }

  /** Toggle whether the browsed past session may make changes. */
  setReadOnly(id: CharacterId, readOnly: boolean): void {
    const l = this.lane(id);
    l.viewReadOnly = readOnly;
    this.onChange();
  }

  /** Ask a question in the browsed past session. In read-only mode the Character
   *  can look and answer but is forbidden from changing anything. */
  async askPast(id: CharacterId, prompt: string): Promise<void> {
    const l = this.lane(id);
    if (l.viewing == null) return;
    const sess = l.archive[l.viewing];
    if (!sess) return;
    const readOnly = l.viewReadOnly;
    clearStrayApiKey();

    let cwd: string;
    try { cwd = await this.worktreeFor(id); }
    catch { sess.messages.push({ from: "them", text: "I couldn't open my workspace to look." }); this.onChange(); return; }

    sess.messages.push({ from: "you", text: prompt });
    l.askingPast = true;
    // Answering a past order IS active work — reflect it on the street so the
    // character isn't shown "idle" while he's clearly looking things up.
    await this.log.append({ type: "CharacterStateChanged", id, state: "working" });
    this.onChange();

    const abort = new AbortController();
    try {
      const q = query({
        prompt,
        options: {
          cwd, model: MODEL, effort: EFFORT, maxTurns: 20, settingSources: SETTING_SOURCES, permissionMode: "default",
          abortController: abort,
          ...(sess.sdkSessionId ? { resume: sess.sdkSessionId } : {}),
          hooks: {
            PreToolUse: [{
              hooks: [async (input: any) => {
                const tool = input.tool_name as string;
                if (readOnly) return READ_TOOLS.includes(tool) ? ALLOW : DENY_READONLY; // look-only wins over bypass
                if (this.getBypass()) return ALLOW; // changes-on + bypass → anything goes
                const ti = (input.tool_input || {}) as Record<string, unknown>;
                if (this.isSafe(tool, ti, cwd)) return ALLOW;
                return DENY_READONLY; // reopened sessions don't do risky ops [ASSUMPTION]
              }],
            }],
          } as any,
        },
      });
      for await (const msg of q) {
        if (msg.type === "system" && msg.subtype === "init") sess.sdkSessionId = msg.session_id;
        else if (msg.type === "assistant") {
          for (const block of msg.message.content) {
            if (block.type === "text" && block.text.trim()) sess.messages.push({ from: "them", text: block.text.trim() });
            else if (block.type === "tool_use" && block.name !== "TodoWrite") sess.messages.push({ from: "them", text: describeTool(block), tool: true });
          }
          this.onChange();
        } else if (msg.type === "result") {
          // The answer is done. BREAK now — don't wait for the stream to close on
          // its own, which (with the 1h keep-warm timeout) never happens, leaving
          // the past chat stuck "…looking…" and its input read-only forever.
          break;
        }
      }
    } catch {
      sess.messages.push({ from: "them", text: "I hit a snag answering that one." });
    } finally {
      try { abort.abort(); } catch { /* free the lingering CLI process */ }
      l.askingPast = false; // ALWAYS re-enable the input, even on error/break
      // Restore the character's resting state (the live session's, not the past
      // browse's): working if a live job is running, calling if it needs Maksym,
      // otherwise idle.
      const resting = l.working ? "working" : ((l.pending || l.pendingChoice) ? "calling" : "idle");
      await this.log.append({ type: "CharacterStateChanged", id, state: resting });
    }
    this.persist();
    this.onChange();
  }

  /** Resolve a pending Risky-Action ask (FR-12, AD-6). */
  async answerPermission(id: CharacterId, allow: boolean): Promise<void> {
    const l = this.lane(id);
    if (!l.pending) return;
    const resolve = l.pending.resolve;
    l.pending = null;
    await this.log.append({ type: "PermissionAnswered", id, allow });
    l.conversation.push({ from: "you", text: allow ? "Allowed." : "Don't do that." });
    l.working = true;
    this.setPhase(l, "working");
    await this.log.append({ type: "CharacterStateChanged", id, state: "working" });
    this.persist();
    this.onChange();
    resolve(allow ? ALLOW : DENY);
  }

  // The Character's `ask_maksym` tool called in. Pause it (Calling), show the
  // question with clickable options, and WAIT for Maksym's answer. Resolves to
  // the answer text, which becomes the tool's result (the model reads it and
  // continues) — so a question is a clean round-trip, not a failed tool.
  private promptChoice(id: CharacterId, ask: AskChoice): Promise<string> {
    const l = this.lane(id);
    const q0 = ask.questions[0];
    // One question → its text in the bubble (the option buttons follow). A
    // BATCH → say how many; the panel titles each one.
    const head = ask.questions.length > 1
      ? `🤔 I've got ${ask.questions.length} questions for you — all in one go:`
      : `🤔 ${q0 ? q0.question : "I have a question."}`;
    l.conversation.push({ from: "them", text: head, tool: true });
    l.working = false;
    l.stats.asks++;
    this.setPhase(l, "waiting");
    l.pendingChoice = null;
    void this.log.append({ type: "CharacterStateChanged", id, state: "calling" });
    this.clearWatchdog(l);
    this.onCue(id, "ready"); // needs my answer — call Maksym
    log("lane", `${id} asked a question`, { question: q0?.question?.slice(0, 100) });
    return new Promise<string>((resolve) => {
      l.pendingChoice = { ask, resolve };
      this.onChange();
    });
  }

  // Maksym answered. Resume the Character and hand the answer to the waiting tool.
  // May include attachments (saved to the lane; their paths appended to the
  // answer so the character can open them — text-only tool result, so even images
  // go via disk).
  async answerQuestion(id: CharacterId, answers: string[], attachments?: Attachment[]): Promise<void> {
    const l = this.lane(id);
    if (!l.pendingChoice) return;
    const { ask, resolve } = l.pendingChoice;
    l.pendingChoice = null;
    const shown = ask.questions.map((q, i) => answers[i] || "(no answer)").join(" · ");
    const { textSuffix } = await this.prepareAttachments(id, attachments, true); // images-as-files (tool result is text)
    l.conversation.push({ from: "you", text: shown, images: imageUrls(attachments), files: fileNames(attachments) });
    l.working = true;
    l.lastAskAnsweredAt = Date.now(); // anchors the ask cooldown (batch, don't drip)
    this.setPhase(l, "working");
    await this.log.append({ type: "CharacterStateChanged", id, state: "working" });
    this.armWatchdog(id);
    this.persist();
    this.onChange();
    log("lane", `${id} question answered`, { shown, attachments: attachments?.length || 0 });
    resolve(shown + textSuffix);
  }

  /** The worktree a character works in: its adopted lane, or a fresh one. */
  private async worktreeFor(id: CharacterId): Promise<string> {
    const a = this.adopt?.adoptionFor(id);
    if (a) return a.worktree; // adopted existing S&R lane — never create/reset
    return ensureWorktree(this.projectPath, id);
  }

  /** The character's lane folder as a path (no creation) — for "open terminal here". */
  worktreeDir(id: CharacterId): string {
    const a = this.adopt?.adoptionFor(id);
    if (a) return a.worktree;
    return path.join(this.projectPath, ".bikini", "worktrees", id);
  }

  private isSafe(tool: string, input: Record<string, unknown>, cwd: string): boolean {
    if (["Read", "Glob", "Grep", "TodoWrite", "NotebookRead"].includes(tool)) return true;
    if (["Edit", "Write", "MultiEdit"].includes(tool)) {
      const p = (input.file_path || input.path) as string | undefined;
      if (!p) return false;
      // Resolve relative paths against the Lane's worktree, not the app cwd,
      // so an ordinary edit inside the worktree counts as Safe (AD-6).
      return path.resolve(cwd, p).startsWith(path.resolve(cwd));
    }
    return false; // Bash, WebFetch, WebSearch, installs, anything else → Risky
  }

  private describe(tool: string, input: Record<string, unknown>): string {
    if (tool === "Bash") return `Can I run this command? \`${String(input.command).slice(0, 120)}\``;
    if (tool === "WebFetch" || tool === "WebSearch") return "Can I look something up online?";
    return `Can I use ${tool}?`;
    }

  private clearWatchdog(l: Lane) { if (l.watchdog) { clearTimeout(l.watchdog); l.watchdog = null; } }
  private armWatchdog(id: CharacterId) {
    const l = this.lane(id);
    this.clearWatchdog(l);
    l.watchdog = setTimeout(() => {
      if (l.working) {
        log("burn", `${id} watchdog fired`, { silentMs: WATCHDOG_MS, agents: l.agents.size });
        this.burn(id, "got stuck (no progress for a while)");
      }
    }, WATCHDOG_MS);
  }

  private async burn(id: CharacterId, reason: string): Promise<void> {
    const l = this.lane(id);
    log("burn", `${id} burned`, { reason });
    l.burned = true; // set before ending so the session loop's catch won't double-burn
    this.endSession(l); // stop the live session — nothing keeps writing after a burn
    l.working = false; this.clearWatchdog(l);
    this.setPhase(l, "waiting");
    l.conversation.push({ from: "them", text: `Uh oh — I burned this one: ${reason}. Nothing broke; your project is untouched. Try again, or scrap it?` });
    await this.log.append({ type: "JobBurned", id, reason });
    await this.log.append({ type: "CharacterStateChanged", id, state: "calling" });
    this.onCue(id, "ready"); // trouble — call Maksym
    this.persist();
    this.onChange();
  }

  /** While waiting for a background helper (e.g. a long reviewer) to finish, we
   *  can't trust a fixed timeout — the helper streams progress with gaps. So we
   *  chime "ready" only after the session has been TRULY SILENT for a stretch;
   *  every message resets this. A genuinely-working-but-gappy reviewer keeps it
   *  alive; a truly-done session goes quiet and chimes. */
  private bumpIdle(id: CharacterId): void {
    const l = this.lane(id);
    if (!l.awaitingIdle) return;
    if (l.idleTimer) clearTimeout(l.idleTimer);
    l.idleTimer = setTimeout(() => {
      // Only declare done once NO helper is still tracked as running — a quietly-
      // working sub-agent must not trigger a premature "done" chime (that was the
      // false chime Maksym heard). Safety net: force done after a long max-hold in
      // case a completion signal is ever missed (so it can't hang forever).
      const heldMs = l.awaitSince ? Date.now() - l.awaitSince : 0;
      const quietMs = l.beatAt ? Date.now() - l.beatAt : heldMs; // silence since the last SDK message
      const sinceHelper = l.helperFinishedAt ? Date.now() - l.helperFinishedAt : Infinity;
      if (l.agents.size === 0 && sinceHelper < HELPER_GRACE_MS) {
        // A helper finished moments ago — the main agent typically resumes with
        // follow-up work (commit/push/write-up) within seconds. Keep holding
        // "working…" until the grace window passes with the stream still quiet;
        // any resumed activity re-arms this timer and pushes the window out.
        log("lane", `${id} helper just finished (${Math.round(sinceHelper / 1000)}s ago) — holding for follow-up work`);
        this.bumpIdle(id);
      }
      else if (l.agents.size === 0) { log("lane", `${id} quiet + no helpers — chiming`); void this.goIdle(id); }
      // Helpers still tracked: only force done when the stream has been TRULY
      // SILENT for a long stretch (a missed completion signal) — NOT merely
      // because a lot of wall-clock passed. A multi-helper research run streams
      // in bursts with 30–60s gaps; a fixed elapsed cap chimed mid-run and then
      // re-chimed on each straggler (the false "he's done" Maksym heard).
      else if (quietMs > HELPER_STALL_MS) { log("lane", `${id} helper(s) silent ${Math.round(quietMs / 1000)}s — forcing idle (lost signal?)`); l.agents.clear(); void this.goIdle(id); }
      else this.bumpIdle(id); // helper still running / mid-burst → keep holding, re-check
    }, SETTLE_MS);
  }

  /** The turn (and any helpers) are truly done → Calling, chime, land the work.
   *  Idempotent (a stale-timeout and a helper-done can both call it). */
  private async goIdle(id: CharacterId): Promise<void> {
    const l = this.lane(id);
    if (l.idleTimer) { clearTimeout(l.idleTimer); l.idleTimer = null; }
    if (!l.working && !l.awaitingIdle) return; // already idle
    l.awaitingIdle = false;
    l.activity = null;
    l.outstanding = 0; // reset the (unreliable, coalesce-prone) counter so it can't drift
    this.clearWatchdog(l);
    l.working = false;
    l.agents.clear();
    this.setPhase(l, "waiting");
    l.idleAt = Date.now(); // remember when we chimed → suppress straggler re-chimes
    await this.log.append({ type: "CharacterStateChanged", id, state: "calling" });
    this.onCue(id, "ready"); // truly finished — call Maksym
    this.persist();
    this.onChange();
    const lastReply = [...l.conversation].reverse().find((m) => m.from === "them" && !m.tool);
    const summary = (lastReply?.text || "finished the job").replace(/\s+/g, " ").slice(0, 90);
    // Never wrote a chalk line? The first line of the final reply stands in.
    if (l.note === null) { const fb = fallbackNote(lastReply?.text || ""); if (fb) { l.note = fb; l.noteAt = Date.now(); this.persist(); this.onChange(); } }
    log("lane", `${id} idle`, summary);
    this.onFinished(id, summary);
    void this.integrate(id); // land the work in the Project (AD-5)
  }

  private async runSession(id: CharacterId, pump: Pump, resume: boolean): Promise<void> {
    const l = this.lane(id);
    clearStrayApiKey();

    let cwd: string;
    try { cwd = await this.worktreeFor(id); }
    catch (e) { await this.burn(id, `couldn't set up my workspace (${(e as Error).message})`); l.pump = null; return; }

    l.agents.clear();
    l.abort = new AbortController();
    l.resumedSession = !!(resume && l.sessionId); // first turn will be a cold resume
    l.turnsThisSession = 0; l.lastCallCtx = 0;
    log("lane", `${id} session start`, { cwd, resume: l.resumedSession, keepWarmMs: KEEPWARM_MS });

    // Give the Character a real "ask Maksym" tool. When it needs a decision it
    // calls this instead of only asking in text; Maksym gets clickable options +
    // a "type my own" box, and his answer becomes the tool's result. `alwaysLoad`
    // keeps it visible (this headless mode otherwise hides tools behind a search).
    const askServer = createSdkMcpServer({
      name: "bikini",
      version: "1.0.0",
      alwaysLoad: true,
      tools: [
        tool(
          "ask_maksym",
          "Ask Maksym to DECIDE something, with clickable answer choices; blocks until he answers and returns his answer as text. Only for real decisions that change what you do next — never for progress reports ('Fixed…', 'Deployed…', 'Done…'): write those as normal text and keep working. Maksym wants questions BATCHED: finish the current step, collect every open question, then ask them all in ONE call via `questions` (each answered separately). A lone follow-up question within a few minutes of his last answer is bounced back with 'batch it' unless you set batchComplete=true (meaning: nothing else can come up, this one blocks everything).",
          {
            question: z.string().optional().describe("A single question — clear and specific. (Or use `questions` for several at once.)"),
            options: z.array(z.string()).min(2).max(6).optional().describe("2–6 short answer choices for `question`."),
            multiSelect: z.boolean().optional().describe("true if he may pick more than one option."),
            questions: z.array(z.object({
              question: z.string().describe("The question — clear and specific."),
              options: z.array(z.string()).min(2).max(6).describe("2–6 short answer choices."),
              multiSelect: z.boolean().optional(),
            })).min(1).max(8).optional().describe("Several questions asked together in one go (preferred over asking one at a time)."),
            batchComplete: z.boolean().optional().describe("Set true only when this single question blocks all further work and no other question can come up. Skips the batching cooldown."),
          },
          async (args) => {
            // Normalise the two shapes into one list.
            const list = (args.questions && args.questions.length
              ? args.questions
              : (args.question ? [{ question: args.question, options: args.options || [], multiSelect: args.multiSelect }] : [])
            ).filter((q) => q.question && q.options && q.options.length >= 2);
            if (!list.length) {
              return { content: [{ type: "text", text: "Nothing was asked: pass `question` + `options` (2–6), or a `questions` array of those." }] };
            }
            // GUARD 1 — a status update is not a question. If every option is a
            // mere acknowledgment ("I'll check it", "Looks good, keep going"),
            // Maksym isn't deciding anything; he's being made to click through a
            // progress report (that was ~half of Patrick's 33 asks on 25 Aug).
            const acks = list.filter((q) => isAckOnly(q.options));
            if (acks.length === list.length) {
              log("lane", `${id} ask bounced — status update, not a decision`, { q: list[0].question.slice(0, 80) });
              return { content: [{ type: "text", text: "Not sent to Maksym — this reads as a progress update, not a decision: every option is just an acknowledgment. Say it in your normal reply (he reads everything you write) and KEEP WORKING; do not wait for a reply. Use ask_maksym only when he must CHOOSE between outcomes that change what you build or do next." }] };
            }
            // GUARD 2 — batch, don't drip. A lone question minutes after his last
            // answer means you're asking one at a time. Go collect the rest first.
            const sinceAnswer = l.lastAskAnsweredAt ? Date.now() - l.lastAskAnsweredAt : Infinity;
            if (list.length === 1 && !args.batchComplete && sinceAnswer < ASK_COOLDOWN_MS) {
              const mins = Math.max(1, Math.round(sinceAnswer / 60_000));
              log("lane", `${id} ask bounced — cooldown (batch it)`, { sinceMin: mins, q: list[0].question.slice(0, 80) });
              return { content: [{ type: "text", text: `Not sent yet — Maksym answered you only ${mins} minute${mins === 1 ? "" : "s"} ago, and he wants questions BATCHED, not one at a time (every question pauses him and his phone rings). Do this instead: keep working on everything that does NOT depend on this answer, note every other question that comes up, and then call ask_maksym ONCE with a \`questions\` array holding all of them. If this one question truly blocks all further work and nothing else can come up, call again with batchComplete: true.` }] };
            }
            const answer = await this.promptChoice(id, {
              questions: list.map((q) => ({
                question: q.question,
                header: "",
                multiSelect: !!q.multiSelect,
                options: q.options.map((o: string) => ({ label: o })),
              })),
            });
            // Several questions → the answers come back in the same order, one per line.
            if (list.length > 1) {
              const parts = answer.split(" · ");
              const lines = list.map((q, i) => `${i + 1}. ${q.question}\n   → ${parts[i] ?? "(no answer)"}`);
              const extra = parts.length > list.length ? "\n" + parts.slice(list.length).join(" · ") : "";
              return { content: [{ type: "text", text: lines.join("\n") + extra }] };
            }
            return { content: [{ type: "text", text: answer }] };
          },
        ),
        // The chalk line (Job 2): one plain sentence about where it is, shown under
        // its name on the street. Never blocks, never a question.
        tool(
          "post_status",
          "Post ONE plain sentence for Maksym about where you are right now (what just happened → what's next). Call it after every meaningful step or phase change. It is not a question and it never waits.",
          { status: z.string().describe("One plain sentence, no Markdown, not a question — e.g. 'reproduced the refund bug, testing a fix'.") },
          async (args) => {
            const line = sanitizeStatus(args.status);
            if (!line) {
              return { content: [{ type: "text", text: "Not posted — give one plain sentence about where you are (not a question; questions go through ask_maksym). Carry on." }] };
            }
            if (!statusAccepted(l.noteAt)) {
              return { content: [{ type: "text", text: "Kept your previous line (you posted one moments ago). Carry on." }] };
            }
            l.note = line; l.noteAt = Date.now();
            log("lane", `${id} status`, line);
            this.persist();
            this.onChange();
            return { content: [{ type: "text", text: "Posted. Carry on." }] };
          },
        ),
      ],
    });

    // The lane's app is already running in Docker (lane-up brought it up and it's
    // persistent). Tell the character so it NEVER wastes turns starting servers.
    const adoption = this.adopt?.adoptionFor(id);
    const serverNote = adoption?.frontendPort
      ? ` This lane's app is ALREADY running in Docker and stays up: frontend at http://localhost:${adoption.frontendPort}, backend at http://localhost:${adoption.backendPort} (the API is served under /api, proxied by the frontend). Use these running services directly to run, test, or verify. Do NOT start, restart, kill, or bootstrap any server (never run \`npm run dev\`, \`vite\`, \`docker compose up\`, or similar) — they are already up. If something looks down, tell Maksym rather than starting your own.`
      : "";

    try {
      const q = query({
        prompt: pump.iter,
        options: {
          cwd,
          model: MODEL,
          effort: EFFORT,
          maxTurns: 179, // check-in cadence, NOT a kill switch — hitting it PAUSES and asks "keep cooking?" (resumes where it left off). ~179 steps between check-ins on a big job; bounds unattended spend without nagging.
          abortController: l.abort,
          mcpServers: { bikini: askServer },
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: "If you need Maksym to decide, choose, approve, or answer ANYTHING before you can correctly continue, you MUST call the `ask_maksym` tool and WAIT — it blocks until he actually replies (he taps an option or types his own answer). Never write a question only in prose and then keep going, and NEVER assume, invent, guess, or imagine his answer. Do not say you have 'his decisions', 'as he decided', or 'per your call' unless an `ask_maksym` answer really came back to you this turn. If the answer would change WHAT you build, ask via `ask_maksym` and wait BEFORE building anything; if it's a minor call, make a sensible choice and note it rather than blocking."
              + " HOW to ask — Maksym is one person running several of you at once, and every question stops him and rings his phone. So: (1) BATCH. Finish the step you're on, gather EVERY open question, and ask them together in ONE `ask_maksym` call using the `questions` array — never one question now and another ten minutes later. Natural batching points: after planning, after a design walkthrough, before opening a PR. (2) Progress is NOT a question. 'Fixed it', 'Deployed to staging', 'Done — take a look' go in your normal reply; never route them through `ask_maksym`. (3) Prefer deciding small things yourself and saying what you chose. The tool enforces (1) and (2): a lone follow-up question right after his last answer, or a question whose options are all acknowledgments, is bounced back to you — that means keep working and batch, not stop."
              + " KEEP MAKSYM POSTED: after every meaningful step or phase change, call `post_status` with ONE plain sentence about where you are (what just happened → what's next) — it never waits, and it is NOT a substitute for `ask_maksym`: anything you need him to decide still goes through `ask_maksym`."
              + " POINTED-AT ELEMENTS: when a message says Maksym 'pointed at' things (a numbered list, pictures, and a pointed-elements.json with the exact details), treat them as the design brief — find each element in this lane's source, make the change, and say which file you touched."
              + serverNote,
          },
          // Load the repo's full setup (CLAUDE.md, skills, /commands, rules,
          // agents, connectors) so the character is as smart as the terminal.
          // Our PreToolUse hook is still the permission gate regardless (AD-6;
          // canUseTool doesn't fire in this SDK's local transport, the hook does).
          settingSources: SETTING_SOURCES,
          // When bypass is on (Maksym's "just work, never ask" pref), run in TRUE
          // bypass mode — not "default". "default" still enforces Claude Code's
          // built-in guards (notably: an agent editing its own `.claude/**` config
          // or rules ALWAYS needs human approval), which our allow-hook can't
          // override and which has no pop-up to answer here — so those edits came
          // back "not allowed" and the character invented a phantom terminal
          // prompt. bypassPermissions skips those guards so the work lands. With
          // bypass off we keep "default" so the PreToolUse hook can still ask.
          permissionMode: this.getBypass() ? "bypassPermissions" : "default",
          ...(resume && l.sessionId ? { resume: l.sessionId } : {}),
          // Cast: the SDK's hook types are a large union; our runtime shape is
          // verified by tests. This keeps the gate readable.
          hooks: {
            PreToolUse: [{
              hooks: [async (input: any): Promise<any> => {
                const toolName = input.tool_name as string;
                const ti = (input.tool_input || {}) as Record<string, unknown>;
                // Our own "ask Maksym" tool is never a permission risk — always allow
                // it so the question reaches him (even when asking-mode is on).
                if (toolName.startsWith("mcp__bikini__")) return ALLOW;
                if (this.getBypass()) return ALLOW; // bypass — never ask (Maksym's pref)
                if (this.isSafe(toolName, ti, cwd)) return ALLOW;
                // Risky → pause and ask (FR-12). Character goes Calling until answered.
                const question = this.describe(toolName, ti);
                l.conversation.push({ from: "them", text: question, tool: true });
                l.working = false;
                this.setPhase(l, "waiting");
                await this.log.append({ type: "PermissionAsked", id });
                await this.log.append({ type: "CharacterStateChanged", id, state: "calling" });
                this.clearWatchdog(l);
                this.onCue(id, "ready"); // needs my OK — call Maksym
                this.onChange();
                return new Promise((resolve) => { l.pending = { question, resolve: resolve as (r: unknown) => void }; });
              }],
            }],
          },
        },
      });
      l.sdkQuery = q;

      for await (const msg of q) {
        if (l.working) this.armWatchdog(id); // progress → reset the stall timer
        if (l.awaitingIdle) this.bumpIdle(id); // activity → not done yet, keep waiting
        const mtype = (msg as any).type as string;
        const msub = (msg as any).subtype as string | undefined;
        // Heartbeat: EVERY message = a genuine sign of life. Stamp the time and,
        // for high-frequency "thinking" ticks (which don't otherwise touch the
        // UI), push a throttled snapshot so the live "working…" indicator keeps
        // moving — proving it's actually churning, not stuck.
        l.beatAt = Date.now();
        if (mtype === "system" && msub === "thinking_tokens") {
          l.activity = "thinking…";
          if (l.beatAt - l.lastBeatPush > 1500) { l.lastBeatPush = l.beatAt; this.onChange(); }
        }
        if (mtype === "rate_limit_event") {
          // Subscription usage-limit status from the CLI. "rejected" = the turn
          // is about to end with the limit error → remember it so the result is
          // handled as a limit PAUSE, not a generic burn. Any status carries the
          // share already used (shown on the job meter).
          const info = ((msg as any).rate_limit_info || {}) as Record<string, any>;
          if (typeof info.utilization === "number") l.stats.limitUtil = info.utilization > 1 ? info.utilization / 100 : info.utilization;
          log("limit", `${id} rate_limit_event`, { status: info.status, type: info.rateLimitType, util: info.utilization, resetsAt: info.resetsAt });
          this.takeFuelEvent(id, info); // the town-wide reserve light
          if (info.status === "rejected") {
            l.limitSeen = { resetsAt: normalizeResetsAt(info.resetsAt), text: `usage limit (${info.rateLimitType || "session"})` };
          }
        } else if (msg.type === "system" && msg.subtype === "init") {
          l.sessionId = msg.session_id;
          log("lane", `${id} session ready`, { sessionId: msg.session_id, cwd });
        } else if (mtype === "system" && msub === "task_started") {
          // A sub-agent ("helper") started. ONLY task_started registers one (its
          // name is stable here); task_progress is deliberately ignored for
          // membership — its `description` is the live action ("Running Read …"),
          // which is NOT the helper's name and was polluting the header.
          const m: any = msg;
          const key = m.tool_use_id || m.task_id;
          if (m.skip_transcript) { /* housekeeping task — don't show */ }
          else if (key && !l.agents.has(key)) {
            const name = helperName(m); // subagent_type / workflow / description
            l.agents.set(key, name);
            l.stats.helpers++;
            l.conversation.push({ from: "them", text: `🐟 Called in a helper — ${name}`, tool: true });
            log("tool", `${id} helper started (task_started)`, { name, key, agents: l.agents.size });
            this.onChange();
          }
        } else if (mtype === "system" && (msub === "task_completed" || msub === "task_finished")) {
          const m: any = msg;
          const key = m.tool_use_id || m.task_id;
          if (key && l.agents.has(key)) {
            const name = l.agents.get(key);
            l.agents.delete(key);
            l.conversation.push({ from: "them", text: `✅ Helper done — ${name}`, tool: true });
            log("tool", `${id} helper done (${msub})`, { name, agents: l.agents.size });
            this.onChange();
            // Do NOT chime just because the last helper finished — the main agent
            // usually has follow-up work. Stamp the completion and settle; the
            // grace window in bumpIdle decides when it's truly done.
            if (l.awaitingIdle && l.agents.size === 0) { l.helperFinishedAt = Date.now(); this.bumpIdle(id); }
          }
        } else if (mtype === "system" && msub === "task_notification") {
          // A background task settled. TWO cases, kept apart so we chime once:
          //  (a) a TRACKED sub-agent (a helper we're showing) finished → mark it
          //      done; goIdle handles the single chime. No separate alert.
          //  (b) a genuinely background task/watch (e.g. a Monitor) reporting
          //      AFTER the turn ended → surface it + alert (the "tell me when the
          //      deploy finishes" case) that Bikini used to silently drop.
          const m: any = msg;
          const key = (m.tool_use_id || m.task_id || "").toString();
          const summary = (m.summary || "").toString().replace(/\s+/g, " ").trim();
          log("lane", `${id} task_notification`, { status: m.status, working: l.working, tracked: l.agents.has(key), summary: summary.slice(0, 90) });
          if (key && l.agents.has(key)) {
            const name = l.agents.get(key);
            l.agents.delete(key); // (a) tracked helper done
            l.conversation.push({ from: "them", text: `✅ Helper done — ${name}`, tool: true });
            this.onChange();
            if (l.awaitingIdle && l.agents.size === 0) { l.helperFinishedAt = Date.now(); this.bumpIdle(id); }
          } else if (summary && key && !l.notified.has(key) && !l.working && !l.awaitingIdle) {
            l.notified.add(key);
            if (Date.now() - l.idleAt > 45_000) {
              // (b) A GENUINE later background report — e.g. a Monitor/deploy
              // Maksym asked to watch, arriving well after the job settled. Its
              // summary IS the new information, so surface it and chime.
              const icon = m.status === "failed" ? "⚠️" : m.status === "stopped" ? "⏹" : "🔔";
              l.conversation.push({ from: "them", text: `${icon} ${summary}` });
              await this.log.append({ type: "CharacterStateChanged", id, state: "calling" });
              this.onCue(id, "ready");
              this.onFinished(id, summary.slice(0, 90));
              this.persist();
              this.onChange();
            } else {
              // A helper that reports a beat AFTER we just chimed idle is a
              // straggler from the SAME job — its real (properly formatted) reply
              // already streamed into the chat. Do NOT push the notification's
              // whitespace-collapsed summary (that was the flat duplicate bubble
              // Maksym saw) and do NOT re-ring the bell. Just note it in the log.
              log("lane", `${id} straggler notification — dropped (dupe of streamed reply)`, { summary: summary.slice(0, 60) });
            }
          }
        } else if (mtype === "system" && msub === "background_tasks_changed") {
          // AUTHORITATIVE live set of background tasks (REPLACE semantics). This
          // is the reliable release signal for the "holding ready" state — an
          // edge (task_notification) can be missed (e.g. a backgrounded slow
          // query bob abandoned), leaving him stuck "working". When the live set
          // empties AND we're holding, the background work is truly done → chime.
          const tasks = (msg as any).tasks || [];
          log("lane", `${id} background tasks`, { count: tasks.length, awaiting: l.awaitingIdle });
          // Background work emptied — but the agent usually resumes with follow-up
          // work right after. Don't chime here; stamp the completion and settle,
          // letting bumpIdle's grace window catch the follow-up before chiming.
          if (l.awaitingIdle && tasks.length === 0) { l.agents.clear(); l.helperFinishedAt = Date.now(); this.bumpIdle(id); }
        } else if (msg.type === "assistant") {
          // Each assistant message is ONE model call; its usage is that call's real
          // context size. (The `result` usage below is SUMMED over every call in
          // the turn — 4 tool calls at ~190k each read as "784k" — so never use
          // that sum as the memory size.)
          const au = (msg.message as any).usage;
          if (au) { const c = (au.input_tokens || 0) + (au.cache_read_input_tokens || 0) + (au.cache_creation_input_tokens || 0); if (c > 0) l.lastCallCtx = c; }
          for (const block of msg.message.content) {
            if (block.type === "text" && block.text.trim()) {
              l.conversation.push({ from: "them", text: block.text.trim() });
              l.activity = "writing a reply…";
              // "You've hit your session limit · resets 1:40pm" arrives as plain
              // text before the error result — read the reset clock from it.
              const lim = parseLimitText(block.text);
              if (lim) l.limitSeen = { resetsAt: l.limitSeen?.resetsAt || lim.resetsAt, text: lim.text };
              log("lane", `${id} said`, block.text.replace(/\s+/g, " ").slice(0, 120));
            } else if (block.type === "tool_use") {
              // Sub-agents ("helpers") launch via the "Agent"/"Task" tool. Only
              // register here if the live task_started message didn't already
              // (dedup by id) — otherwise this buffered block double-counts.
              if (block.name === "Agent" || block.name === "Task") {
                if (!l.agents.has(block.id)) {
                  const name = helperName((block as any).input);
                  l.agents.set(block.id, name);
                  l.stats.helpers++;
                  l.conversation.push({ from: "them", text: `🐟 Called in a helper — ${name}`, tool: true });
                  log("tool", `${id} helper started (tool_use)`, { name, agents: l.agents.size });
                }
              } else if (block.name === "TodoWrite") {
                // Claude's batch/task plan → the live checklist panel (not a bubble).
                l.todos = parseTodos((block as any).input);
                l.activity = "planning the work…";
                log("tool", `${id} TodoWrite`, { count: l.todos.length });
              } else {
                const label = describeTool(block);
                l.activity = label;
                l.conversation.push({ from: "them", text: label, tool: true });
                log("tool", `${id} ${block.name}`);
              }
            }
          }
          this.onChange();
        } else if (msg.type === "user") {
          // tool results come back as user messages. NOTE: we do NOT treat a
          // tool_result as "helper done" — a BACKGROUNDED sub-agent returns its
          // tool_result immediately ("running in the background") while it keeps
          // working, so removing it here caused a false "done" + early chime.
          // Helper completion is driven by task_completed / task_notification.
          this.onChange();
        } else if (msg.type === "result") {
          // One user message has been fully answered. The session STAYS OPEN for
          // more (that's what lets Maksym keep driving) — we only flip to Calling
          // when nothing is left outstanding.
          const sub = (msg as any).subtype as string | undefined;
          const isErr = (msg as any).is_error === true || (sub && sub !== "success");
          // Real usage numbers so we can MEASURE spend (input = full-price tokens,
          // cacheRead ≈ 10% price, cacheWrite ≈ 125% price, out = output tokens).
          const u = (msg as any).usage || {};
          l.turnsThisSession++;
          // A cold resume = the first turn of a session that reopened by `resume`
          // (a full re-read of the conversation — the app-specific cost we want to
          // MEASURE and minimise). Any later turn in the session is warm.
          const coldResume = l.turnsThisSession === 1 && l.resumedSession;
          // `usage` on a result is the TOTAL over every model call in this turn
          // (a 4-call turn at ~190k context reports ~780k). The memory size we
          // show/nudge on is the LATEST single call, tracked from assistant
          // messages above; fall back to total ÷ calls if none was seen.
          const turnInput = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          const calls = Math.max(1, Number((msg as any).num_turns) || 1);
          const ctx = l.lastCallCtx > 0 ? l.lastCallCtx : Math.round(turnInput / calls);
          log("usage", `${id} turn`, {
            input: u.input_tokens, cacheRead: u.cache_read_input_tokens,
            cacheWrite: u.cache_creation_input_tokens, out: u.output_tokens,
            turnInput, ctx, coldResume, warm: !coldResume, sessionTurn: l.turnsThisSession,
            turns: (msg as any).num_turns,
          });
          l.taskTokens += (u.output_tokens || 0); // running output-token spend for this job
          l.stats.turns++;
          if (ctx > 0) l.stats.ctxTokens = ctx; // what the next call will re-read (latest call size, NOT the turn total)
          log("lane", `${id} message answered`, { subtype: sub, isError: isErr, turns: (msg as any).num_turns, outstanding: l.outstanding });
          l.outstanding = Math.max(0, l.outstanding - 1);
          if (isErr) {
            console.error(`[bikini] lane ${id} error result: ${sub}`);
            // Claude's usage limit — the CLI reports it as is_error + "success".
            // Not a failure of the job: pause honestly and auto-resume at reset.
            if (l.limitSeen) { await this.pauseForLimit(id, l.limitSeen); return; }
            this.endSession(l);
            // Hitting the step cap is NOT a failure — it's a deliberate check-in
            // so a big job can't run up spend unattended. PAUSE and ask instead of
            // burning; "Keep cooking" (retry) resumes exactly where it left off
            // (context preserved, never replays), with a fresh step budget. This
            // is the whole point of the cap: bound unattended runs, lose nothing.
            if (sub === "error_max_turns") {
              l.paused = true; l.working = false; this.clearWatchdog(l); this.setPhase(l, "waiting");
              l.conversation.push({ from: "them", text: "That's a big job — I've taken a lot of steps, so I paused to check in before spending more (so I don't run up your bill while you're away). Nothing's lost. Want me to keep cooking? I'll pick up right where I left off." });
              await this.log.append({ type: "CharacterStateChanged", id, state: "calling" });
              this.onCue(id, "ready"); // needs a decision — call Maksym
              this.persist();
              this.onChange();
              return;
            }
            // The SDK ends an autocompact-thrash turn with is_error + subtype
            // "success" (misleading). Detect it from what the character just said
            // so the burn reason is honest ("session too full") not "success".
            const lastSaid = [...l.conversation].reverse().find((mm) => mm.from === "them" && !mm.tool)?.text || "";
            const reasonHint = /compact|context|working space|too large|out of (working )?room/i.test(lastSaid)
              ? "context too full"
              : (sub || "unknown");
            await this.burn(id, reasonFromError(reasonHint));
            return;
          }
          l.limitSeen = null; // a limit mention that did NOT end the turn (e.g. a helper's) is not ours
          this.maybeNudge(id, ctx);
          this.persist(); // save progress (survives restart)
          // If more messages appear outstanding OR helpers are still running,
          // HOLD (stay working, Cancel active) but arm the quiet-timer so silence
          // releases us. CRITICAL: `outstanding` is unreliable — the model can
          // COALESCE several rapidly-sent messages into ONE answer (one result),
          // leaving outstanding>0 forever — so we can't rely on it alone.
          // ALWAYS settle rather than chiming on the result itself. A `result`
          // is only a turn boundary — the agent frequently continues a few
          // seconds later (a background explorer returns, or it keeps thinking)
          // with NO new user message. So hold as "working…" and let the quiet-
          // timer chime only after SETTLE_MS of real silence; any resumed
          // activity re-arms it (loop top), keeping him working. Outstanding
          // messages / live helpers extend the same hold.
          l.awaitingIdle = true;
          l.awaitSince = Date.now();
          l.beatAt = Date.now(); // start the silence clock from the result
          log("lane", `${id} turn ended — settling`, { outstanding: l.outstanding, helpers: l.agents.size });
          this.onChange();
          this.bumpIdle(id);
          continue;
        } else {
          // Diagnostic: capture any message type we don't handle (e.g. sub-agent
          // progress variants) so we can see exactly what the SDK emits.
          log("msg", `${id} unhandled`, { type: mtype, subtype: msub, hasTaskId: !!(msg as any).task_id, hasToolUseId: !!(msg as any).tool_use_id });
        }
      }
      // The pump was closed (scrap / new job / shutdown) — clean end.
      log("lane", `${id} session closed`);
    } catch (e: any) {
      // SUPERSEDED guard: if the lane's current pump is no longer THIS loop's
      // pump, a newer session (a new job / follow-up) has replaced us and the
      // error we just caught is our OWN interrupted child dying — NOT the new
      // session failing. Bailing here fixes the false "Operation aborted" burn
      // that hit the 2nd+ job handed to a warm character.
      if (l.pump !== pump) { log("lane", `${id} old session superseded — ignoring its shutdown`); return; }
      this.clearWatchdog(l);
      if (l.cancelled) { log("lane", `${id} session cancelled (not a failure)`); return; }
      if (l.burned) return;    // watchdog already burned it
      // Died while idle/waiting (not mid-work) → an idle session just closed;
      // that's not a failure. Next message resumes a fresh one.
      if (!l.working) { log("lane", `${id} idle session closed`, { note: String(e?.message || e).slice(0, 80) }); return; }
      const raw = (e && (e.stack || e.message)) || String(e);
      // Died on the usage limit (as an exception rather than an error result) →
      // same honest pause + auto-resume, not a burn.
      if (l.limitSeen || /session limit|usage limit|rate.?limit|\b429\b/i.test(raw)) {
        log("limit", `${id} threw on usage limit`, { error: raw.slice(0, 120) });
        await this.pauseForLimit(id, l.limitSeen || { resetsAt: 0, text: raw.slice(0, 120) });
        return;
      }
      console.error(`[bikini] lane ${id} burned — real error:\n${raw}`); // → /tmp/bikini-live.log
      log("burn", `${id} threw`, { error: raw });
      await this.burn(id, reasonFromError(e && (e.message || String(e)) || "unknown"));
    } finally {
      // Session is over; a later message will open a fresh one (resuming context).
      if (l.pump === pump) { l.pump = null; l.sdkQuery = null; l.working = false; }
    }
  }
}

// Turn a raw SDK/CLI error into a short, honest, cozy reason for a burned order.
function reasonFromError(msg: string): string {
  const m = msg.toLowerCase();
  if (/compact|context|too large|working space|out of (working )?room|window/.test(m)) return "this session got too full to keep going — start me on a fresh order and I'll be fine";
  if (/limit|rate|quota|overloaded|429|529|usage/.test(m)) return "I hit Claude's usage limit for now — give it a minute and try again";
  if (/network|fetch|econn|enotfound|socket|timeout|dns|offline/.test(m)) return "I lost the connection to Claude";
  if (/max.?turns/.test(m)) return "this one ran really long and hit its step limit";
  if (/auth|401|403|unauthorized|token|login|credential/.test(m)) return "there's a login/auth hiccup with Claude";
  // "success"/"unknown"/empty are not meaningful to show — the SDK sometimes
  // ends an aborted turn with subtype "success" + is_error. Say something honest
  // instead of echoing a garbled word (the old "hit a snag — success").
  if (!m.trim() || /^(success|unknown|error|done)$/.test(m.trim())) return "something went wrong mid-task — nothing broke, try again";
  return `hit a snag — ${msg.replace(/\s+/g, " ").slice(0, 140)}`;
}

// A readable name for a sub-agent from its Task input: prefer the short
// description, else the agent type (e.g. "reviewer"), else just "helper".
function helperName(input: unknown): string {
  const i = (input || {}) as Record<string, unknown>;
  const desc = typeof i.description === "string" ? i.description.trim() : "";
  const type = typeof i.subagent_type === "string" ? i.subagent_type.trim() : "";
  const wf = typeof i.workflow_name === "string" ? i.workflow_name.trim() : "";
  const name = desc || type || wf || "helper";
  return name.replace(/\s+/g, " ").slice(0, 60);
}

function friendlyTool(name: string): string {
  const map: Record<string, string> = {
    Read: "reading through things…", Edit: "making changes…", Write: "writing something up…",
    Bash: "rummaging through the kitchen…", Glob: "looking around…", Grep: "searching for something…",
  };
  return map[name] || "working on it…";
}

// A precise, human-readable line for a tool call — WHAT it's doing right now
// (which file, which command, which search), surfaced instead of a vibe phrase.
function describeTool(block: any): string {
  const inp = (block?.input || {}) as Record<string, any>;
  const base = (p?: string): string => (p ? String(p).split("/").pop() || String(p) : "");
  const clip = (s: any, n: number): string => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  switch (block?.name) {
    case "Edit": case "MultiEdit": return `✏️ edited ${base(inp.file_path)}`;
    case "Write": return `📝 wrote ${base(inp.file_path)}`;
    case "Read": case "NotebookRead": return `📖 read ${base(inp.file_path)}`;
    case "Bash": return `⚡ ran: ${clip(inp.command, 72)}`;
    case "Grep": return `🔍 searched: ${clip(inp.pattern, 50)}`;
    case "Glob": return `🔎 looked for: ${clip(inp.pattern, 50)}`;
    case "WebSearch": return `🌐 web search: ${clip(inp.query, 60)}`;
    case "WebFetch": return `🌐 fetched: ${base(inp.url) || clip(inp.url, 60)}`;
    default: return friendlyTool(block?.name);
  }
}

// Claude's own to-do/batch list (the TodoWrite tool) → a compact live checklist.
function parseTodos(input: any): { content: string; status: string }[] {
  const arr = (input?.todos || []) as any[];
  return arr.map((t) => ({ content: String(t.content || t.activeForm || "").slice(0, 120), status: String(t.status || "pending") }));
}
