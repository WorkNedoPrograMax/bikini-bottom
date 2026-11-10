// The snapshot is a PURE FOLD over the event log (AD-2). No side effects,
// no I/O — deterministic, so a boot-time replay yields exactly the live state.

import type { DomainEvent } from "./events";
import type { CharacterState, CharacterView, TownSnapshot } from "../../shared/ipc";
import { EMPTY_FUEL } from "../../shared/ipc";

export const BACKGROUND = "conch-day.png";

/** Is this character drawn on the street? Everyone always — except the
 *  reviewer (Karen), who is there only while reviewing: working, calling, or
 *  finished-but-not-yet-seen (else "posted ✓ — Approve" would vanish unseen).
 *  Maksym, 2026-11-06: "always visible only when she's reviewing something". */
export function visibleOnStreet(c: { reviewer: boolean; state: CharacterState; unseen: boolean }): boolean {
  if (!c.reviewer) return true;
  return c.state !== "idle" || c.unseen;
}

/** The town before any Character exists (First Run shows over this). */
export function emptyTown(): TownSnapshot {
  return { seq: 0, background: BACKGROUND, characters: [], firstRun: null, openWindow: null, orders: [], muted: false, faces: {}, fuel: EMPTY_FUEL, fuelSign: null, towns: [], townName: "", addingTown: null, booth: null, mail: null, jira: null, notebook: null };
}

export function fold(events: readonly DomainEvent[]): TownSnapshot {
  const chars = new Map<string, CharacterView>();
  let seq = 0;

  for (const ev of events) {
    if (ev.seq > seq) seq = ev.seq;
    switch (ev.type) {
      case "CharacterRegistered":
        chars.set(ev.id, {
          id: ev.id,
          name: ev.name,
          role: ev.role,
          accent: ev.accent,
          pos: ev.pos,
          isHomeBase: ev.isHomeBase,
          reviewer: false, visible: true, // main sets both from the roster (the log predates Karen)
          state: "idle",
          unseen: false,
          picture: null, // filled by the Asset Slot resolver in main (AD-7)
          note: null, noteAt: 0, // the chalk line lives in the lane; main fills it
          attention: null,       // main derives it from the lane
          reminded: false,
          booth: null,           // the phone booth lives in the lane; main fills it
        });
        break;
      case "CharacterStateChanged": {
        const c = chars.get(ev.id);
        if (c) {
          c.state = ev.state;
          // A Character needing Maksym is "unseen" until resolved (FR-4) — and a
          // pinned one ("come back later") stays unseen whatever its state does.
          c.unseen = ev.state === "calling" || c.reminded;
        }
        break;
      }
      case "ReminderSet": {
        const c = chars.get(ev.id);
        if (c) { c.reminded = true; c.unseen = true; }
        break;
      }
      case "ReminderCleared": {
        const c = chars.get(ev.id);
        if (c) { c.reminded = false; c.unseen = c.state === "calling"; }
        break;
      }
      case "JobHandedOut": {
        // A genuinely NEW order clears the pin (the old result is moot now).
        const c = chars.get(ev.id);
        if (c) { c.reminded = false; c.unseen = c.state === "calling"; }
        break;
      }
    }
  }

  return { seq, background: BACKGROUND, characters: [...chars.values()], firstRun: null, openWindow: null, orders: [], muted: false, faces: {}, fuel: EMPTY_FUEL, fuelSign: null, towns: [], townName: "", addingTown: null, booth: null, mail: null, jira: null, notebook: null };
}
