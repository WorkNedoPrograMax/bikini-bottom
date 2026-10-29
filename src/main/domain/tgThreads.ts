// Reply-to-continue on the phone (2026-10-29). Every message the bot sends about
// a character (started, finished, asks, needs approval, the confirmations) and
// every text Maksym types that lands in a session is REMEMBERED against the
// session it belongs to. A swipe-reply to any of them then goes into THAT
// session — the follow-up the Work Window has had all along, from Telegram.
// Measured need (2026-10-29): the lead reviewed a PR, Maksym asked Sponge to
// answer, Sponge said "done", the lead replied again — and there was no way
// from the phone to tell the same Sponge session "answer this too"; only /new
// (a fresh session that knows nothing). PURE so scripts/check-telegram.mjs can
// test the routing without Electron.

import type { CharacterId } from "../../shared/ipc";

/** The session behind one Telegram message. `session` is the SDK session id
 *  when it was known at send time (null right after a job starts — the SDK
 *  hands the id out a moment later); `startedAt` is the job's start stamp, the
 *  fallback key for exactly that moment. */
export type TgThread = { town: string; id: CharacterId; session: string | null; startedAt: number };

/** message id → thread, capped (oldest forgotten first). Lives only in memory:
 *  after a relaunch old messages can't be replied to, which the reply says. */
export class TgThreads {
  private readonly map = new Map<number, TgThread>();
  constructor(private readonly cap = 2000) {}

  remember(ids: Array<number | null | undefined>, t: TgThread): void {
    for (const id of ids) {
      if (typeof id !== "number") continue;
      this.map.delete(id); // re-insert → newest
      this.map.set(id, { ...t });
      while (this.map.size > this.cap) {
        const oldest = this.map.keys().next().value;
        if (oldest === undefined) break;
        this.map.delete(oldest);
      }
    }
  }

  lookup(msgId: number | null | undefined): TgThread | null {
    if (typeof msgId !== "number") return null;
    const t = this.map.get(msgId);
    return t ? { ...t } : null; // a copy — a caller re-stamping it never edits the memory
  }

  get size(): number { return this.map.size; }
}

/** What the lane looks like at the moment the reply arrives. */
export type LaneFacts = {
  terminal: boolean;        // a terminal character types into a pty — no SDK follow-up
  working: boolean;         // cooking right now
  asking: boolean;          // a question is waiting (pending choice, live session)
  approving: boolean;       // a permission is waiting (pending ask, live session)
  session: string | null;   // the CURRENT conversation's SDK session id
  startedAt: number;        // the current job's start stamp
  pastIndex: number;        // where the thread's session sits in the archive, or -1
};

export type ReplyRoute =
  | { kind: "terminal" }                 // can't follow up a terminal character from the phone
  | { kind: "answer" }                   // the thread is current and a question is waiting → the text answers it
  | { kind: "approval" }                 // the thread is current and a permission is waiting → buttons, not text
  | { kind: "followUp" }                 // the thread is the current conversation → follow-up (injected if cooking)
  | { kind: "resume"; index: number }    // the thread is a past order and the character is free → make it current with this text
  | { kind: "switch"; index: number }    // the thread is a past order but the character is busy → ask before stopping that
  | { kind: "lost" };                    // nothing matches anymore (relaunch, session gone)

/** Is the remembered thread the lane's CURRENT conversation? Session ids win
 *  when both sides have one; the start stamp covers the moment before the SDK
 *  named the session. */
export function isCurrentThread(t: TgThread, f: LaneFacts): boolean {
  if (t.session && f.session) return t.session === f.session;
  return t.startedAt > 0 && t.startedAt === f.startedAt;
}

export function routeReply(t: TgThread, f: LaneFacts): ReplyRoute {
  if (f.terminal) return { kind: "terminal" };
  if (isCurrentThread(t, f)) {
    if (f.asking) return { kind: "answer" };
    if (f.approving) return { kind: "approval" };
    return { kind: "followUp" };
  }
  if (f.pastIndex >= 0) {
    return (f.working || f.asking || f.approving) ? { kind: "switch", index: f.pastIndex } : { kind: "resume", index: f.pastIndex };
  }
  return { kind: "lost" };
}
