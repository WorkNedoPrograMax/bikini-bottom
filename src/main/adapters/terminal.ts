// The TerminalManager runs a character as a REAL, honest terminal: it spawns the
// actual `claude` CLI inside the character's worktree via a pseudo-terminal
// (node-pty), exactly like Maksym's own Terminal. This is the "embed the real
// terminal" half of the A/B experiment (squid) — no SDK, one long-lived warm
// process that never resumes, so it costs what the terminal costs.
//
// Crucially the pty gets a CLEAN, login-shell environment (our cache-proxy var
// and any stray API key stripped) so it is a pristine terminal — the fair
// baseline to compare our SDK lanes (bob/pat) against.

import * as pty from "node-pty";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CharacterId, CharacterState } from "../../shared/ipc";
import { log } from "../log";

// You asked Claude something (pressed Enter, or a launched job); once its output
// then stops flowing for this long we treat it as done → picture back to
// "calling" (needs you) + the finish chime. Long enough that short mid-reply
// pauses (thinking, a quick command) don't fire early; short enough to feel live.
const IDLE_MS = 8000;

interface Term {
  proc: pty.IPty;
  cols: number;
  rows: number;
  launched: boolean;    // have we typed the launch command yet?
  launchCmd: string;    // "claude", "claude '<job>'", or "claude --resume <id>"
  bornWithJob: boolean; // spawned to run a job (→ starts "working" on launch)
  startedAt: number;
  busy: boolean;        // actively working on something you asked
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/** Single-quote a string for a POSIX shell command line (Krabs jobs are a
 *  single line — the Home Base input can't contain newlines). */
function shq(s: string): string { return "'" + s.replace(/'/g, "'\\''") + "'"; }

export class TerminalManager {
  private terms = new Map<CharacterId, Term>();

  constructor(
    /** Where a character works (its lane worktree). */
    private worktreeFor: (id: CharacterId) => string,
    /** Live pty output → renderer. */
    private onData: (id: CharacterId, data: string) => void,
    /** The pty (shell/claude) exited. */
    private onExit: (id: CharacterId, code: number) => void,
    /** Sound cue: 'start' when Claude launches, 'ready' when a reply settles. */
    private onCue: (id: CharacterId, kind: "start" | "ready") => void = () => {},
    /** Street picture state: 'working' while busy, 'calling' when done/needs-you. */
    private onState: (id: CharacterId, state: CharacterState) => void = () => {}
  ) {}

  /** You asked something → picture goes "working" and we start watching for the
   *  reply to settle. Called on a launched job or when you press Enter. */
  private setBusy(id: CharacterId, term: Term): void {
    if (!term.busy) {
      term.busy = true;
      this.onState(id, "working"); // street picture: working
      log("term", `${id} working`, {});
    }
    this.armIdle(id, term);
  }

  /** After output stops for IDLE_MS while busy: done → picture "calling" + chime.
   *  Re-armed on every output chunk, so it only fires once the stream goes quiet. */
  private armIdle(id: CharacterId, term: Term): void {
    if (term.idleTimer) clearTimeout(term.idleTimer);
    term.idleTimer = setTimeout(() => {
      term.idleTimer = null;
      if (term.busy) {
        term.busy = false;
        this.onState(id, "calling"); // street picture: needs you / finished
        this.onCue(id, "ready");      // finish chime
        log("term", `${id} settled → calling + ready chime`, {});
      }
    }, IDLE_MS);
  }

  /** Is this character running as a real terminal right now? */
  has(id: CharacterId): boolean {
    return this.terms.has(id);
  }

  /** A pristine, login-shell env: the user's real PATH (so `claude` resolves
   *  exactly as in Terminal), minus anything Bikini injected that would make it
   *  behave differently from a plain terminal. */
  private cleanEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.ANTHROPIC_BASE_URL; // our cache proxy — a real terminal has none
    delete env.ANTHROPIC_API_KEY;  // never let a stray key bill per-use (AD-8)
    // CRITICAL: if Bikini was itself launched from inside a Claude Code session
    // (or by another `claude`), the process env carries CLAUDECODE / CLAUDE_CODE_*
    // vars. `CLAUDE_CODE_CHILD_SESSION=1` in particular makes the terminal's
    // Claude run as a NESTED/child session that never writes its own resumable
    // transcript (breaking resume + Past orders). Strip every inherited Claude
    // var so this is a clean, top-level `claude` — exactly like Maksym's own
    // Terminal. The login shell re-applies any values his real profile sets.
    for (const k of Object.keys(env)) {
      if (/^CLAUDE_CODE/i.test(k) || k === "CLAUDECODE" || k === "CLAUDE_EFFORT") delete env[k];
    }
    env.TERM = "xterm-256color";
    env.COLORTERM = "truecolor";
    return env;
  }

  /** Open (or re-attach to) this character's terminal. Idempotent: if the
   *  process is already alive we just push the current size — the warm process
   *  keeps running while the window is hidden, so reopening is instant and free.
   *
   *  The launch command is decided ONCE here: opts.job → `claude '<job>'` (a
   *  fresh interactive session with the prompt already submitted — far more
   *  reliable than typing into Claude's live-repainting UI); opts.resumeId →
   *  `claude --resume <id>`; otherwise a plain `claude`. */
  open(id: CharacterId, cols: number, rows: number, opts: { job?: string; resumeId?: string } = {}): void {
    const existing = this.terms.get(id);
    if (existing) {
      existing.cols = cols; existing.rows = rows;
      try { existing.proc.resize(Math.max(cols, 2), Math.max(rows, 2)); } catch { /* race with exit */ }
      return; // a job/resume on an already-open terminal goes through startJob/resume
    }

    const cwd = this.worktreeFor(id);
    const shell = process.env.SHELL || "/bin/zsh";
    const proc = pty.spawn(shell, ["-l", "-i"], {
      name: "xterm-256color",
      cols: Math.max(cols, 2), rows: Math.max(rows, 2),
      cwd, env: this.cleanEnv(),
    });

    // Default open CONTINUES the last conversation (like coming back to a
    // terminal you left open) — so a reopen after the pty was killed (app
    // restart, crash) restores the session instead of starting empty. A Krabs
    // job starts fresh; a Past-orders click resumes a specific session.
    const launchCmd = opts.resumeId ? `claude --resume ${opts.resumeId}`
      : opts.job ? `claude ${shq(opts.job)}`
      : (listClaudeSessions(cwd, 1).length ? "claude --continue" : "claude");
    const term: Term = {
      proc, cols, rows, launched: false, launchCmd,
      bornWithJob: !!opts.job, // a launched job → starts "working" once Claude is up
      startedAt: Date.now(), busy: false, idleTimer: null,
    };
    this.terms.set(id, term);
    log("term", `${id} terminal spawned`, { cwd, shell, launchCmd: launchCmd.slice(0, 80) });

    proc.onData((data) => {
      this.onData(id, data);
      if (!term.launched) {
        // Once the shell prints its first prompt, launch Claude for real — the
        // same `claude` binary Maksym runs by hand (optionally with a job/resume).
        term.launched = true;
        try { proc.write(term.launchCmd + "\r"); } catch { /* exited already */ }
        log("term", `${id} launched`, { cmd: term.launchCmd.slice(0, 80) });
        this.onCue(id, "start"); // same "getting to work" cue the chat played
        if (term.bornWithJob) this.setBusy(id, term); // running a job → working
      } else if (term.busy) {
        // Busy → every output chunk (re)starts the idle countdown, so "done"
        // only fires once the stream truly goes quiet.
        this.armIdle(id, term);
      }
    });

    proc.onExit(({ exitCode }) => {
      // Identity guard: a relaunch (job/resume) kills the old pty and spawns a
      // new one; make sure the old proc's exit doesn't clobber the fresh term.
      if (this.terms.get(id) !== term) return;
      const aliveMs = Date.now() - term.startedAt;
      if (term.idleTimer) clearTimeout(term.idleTimer);
      this.terms.delete(id);
      log("term", `${id} terminal exited`, { exitCode, aliveMs });
      this.onExit(id, exitCode);
    });
  }

  /** Kill any existing terminal and open a fresh one (reset the renderer's
   *  xterm first). Used for a new Krabs job or resuming a past session — both
   *  are, by design, a brand-new terminal session. */
  private relaunch(id: CharacterId, opts: { job?: string; resumeId?: string }): void {
    const old = this.terms.get(id);
    const cols = old ? old.cols : 80, rows = old ? old.rows : 24;
    if (old) {
      if (old.idleTimer) clearTimeout(old.idleTimer);
      this.terms.delete(id);          // remove BEFORE kill so onExit's identity guard skips it
      try { old.proc.kill(); } catch { /* already gone */ }
    }
    this.onData(id, "\x1bc");          // reset the renderer's xterm (clear old scrollback)
    this.open(id, cols, rows, opts);
  }

  /** Krabs handed this character a job → a FRESH terminal session running it.
   *  (Cold terminals are opened directly via open({job}) from term:open so no
   *  startup output is lost; this warm path relaunches.) */
  startJob(id: CharacterId, prompt: string): void {
    this.relaunch(id, { job: prompt });
    log("term", `${id} fresh session + job`, { job: prompt.slice(0, 80) });
  }

  /** Reopen the terminal on a specific past Claude session (`claude --resume`). */
  resume(id: CharacterId, sessionId: string): void {
    this.relaunch(id, { resumeId: sessionId });
    log("term", `${id} resuming session`, { sessionId });
  }

  /** A keystroke (or paste) from the renderer's xterm → the real pty. */
  input(id: CharacterId, data: string): void {
    const t = this.terms.get(id);
    if (!t) return;
    // Pressing Enter = you asked for something → picture goes "working" and we
    // watch for the reply to settle (finish chime + "calling" when it goes quiet).
    if (/[\r\n]/.test(data)) this.setBusy(id, t);
    try { t.proc.write(data); } catch { /* exited */ }
  }

  /** The xterm was resized (window grew/shrank) → tell the pty. */
  resize(id: CharacterId, cols: number, rows: number): void {
    const t = this.terms.get(id);
    if (!t) return;
    t.cols = cols; t.rows = rows;
    try { t.proc.resize(Math.max(cols, 2), Math.max(rows, 2)); } catch { /* exited */ }
  }

  /** Stop one character's terminal (explicit scrap only — NOT on window close). */
  close(id: CharacterId): void {
    const t = this.terms.get(id);
    if (!t) return;
    if (t.idleTimer) clearTimeout(t.idleTimer);
    this.terms.delete(id);
    try { t.proc.kill(); } catch { /* already gone */ }
    log("term", `${id} terminal killed`, {});
  }

  /** Best-effort graceful step before a kill: Ctrl-C each terminal so Claude
   *  aborts its current turn and reaches a checkpoint it can persist. The caller
   *  should wait briefly, then killAll(). */
  interruptAll(): void {
    for (const [id, t] of this.terms) {
      try { t.proc.write("\x03"); } catch { /* exited */ }
      log("term", `${id} interrupt (graceful pre-kill)`, {});
    }
  }

  /** Any terminal currently busy (mid-task)? Used to warn before quitting. */
  anyBusy(): boolean {
    for (const [, t] of this.terms) if (t.busy) return true;
    return false;
  }

  /** Stop every terminal — only on a genuine app quit. */
  killAll(): void {
    for (const [id, t] of this.terms) {
      if (t.idleTimer) clearTimeout(t.idleTimer);
      try { t.proc.kill(); } catch { /* already gone */ }
      log("term", `${id} terminal killed (quit)`, {});
    }
    this.terms.clear();
  }
}

// ---- Past Claude sessions for a terminal character (its "Past orders") -------
// Claude stores each session as a JSONL transcript under
// ~/.claude/projects/<escaped-cwd>/<sessionId>.jsonl. We read these to show a
// reopen list, resuming via `claude --resume <sessionId>` in the terminal.

export interface TermSession { sessionId: string; title: string; mtime: number; }

const listCache = new Map<string, { at: number; list: TermSession[] }>();

/** Claude's cwd → project-dir name: every non-alphanumeric char becomes "-". */
function escapeCwd(p: string): string { return p.replace(/[^a-zA-Z0-9]/g, "-"); }

/** The first user message's text. We read a chunk from the top and pull the
 *  first text block by regex rather than parsing whole JSON lines — the first
 *  user message often carries an inline base64 image, making its line far too
 *  big to parse, but the text block sits right at the start of that line. */
function firstUserTitle(file: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const chunk = buf.toString("utf8", 0, n);
    const unquote = (s: string) => { try { return JSON.parse('"' + s + '"'); } catch { return s; } };
    // Prefer MAKSYM's first prompt over Claude's first reply. User content is
    // either a plain string ("content":"…") or a text block AFTER "role":"user".
    let m = chunk.match(/"role":"user"[^}]*?"content":"((?:[^"\\]|\\.)*)"/);
    if (m) return unquote(m[1]);
    const ui = chunk.indexOf('"role":"user"');
    if (ui >= 0) {
      m = chunk.slice(ui).match(/"type":"text","text":"((?:[^"\\]|\\.)*)"/);
      if (m) return unquote(m[1]);
    }
    // Last resort: any text block (may be Claude's — better than nothing).
    m = chunk.match(/"type":"text","text":"((?:[^"\\]|\\.)*)"/);
    if (m) return unquote(m[1]);
  } catch { /* unreadable */ } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* ignore */ } }
  return null;
}

/** List a worktree's past Claude sessions, newest first (cached ~3s so it's
 *  cheap to call from the per-snapshot buildWindow). */
export function listClaudeSessions(worktree: string, limit = 12): TermSession[] {
  const cached = listCache.get(worktree);
  const now = Date.now();
  if (cached && now - cached.at < 3000) return cached.list;

  const dir = path.join(os.homedir(), ".claude", "projects", escapeCwd(worktree));
  let list: TermSession[] = [];
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    list = files.map((f) => {
      const full = path.join(dir, f);
      let mtime = 0; try { mtime = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
      const sessionId = f.replace(/\.jsonl$/, "");
      const title = (firstUserTitle(full) || "a past session").replace(/\s+/g, " ").slice(0, 40);
      return { sessionId, title, mtime };
    });
    list.sort((a, b) => b.mtime - a.mtime);
    list = list.slice(0, limit);
  } catch { list = []; } // dir doesn't exist yet (no sessions) → empty

  listCache.set(worktree, { at: now, list });
  return list;
}
