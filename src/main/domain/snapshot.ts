// The snapshot is a PURE FOLD over the event log (AD-2). No side effects,
// no I/O — deterministic, so a boot-time replay yields exactly the live state.

import type { DomainEvent } from "./events";
import type { CharacterView, TownSnapshot } from "../../shared/ipc";
import { EMPTY_FUEL } from "../../shared/ipc";

export const BACKGROUND = "conch-day.png";

/** The town before any Character exists (First Run shows over this). */
export function emptyTown(): TownSnapshot {
  return { seq: 0, background: BACKGROUND, characters: [], firstRun: null, openWindow: null, orders: [], muted: false, faces: {}, fuel: EMPTY_FUEL, fuelSign: null };
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
          state: "idle",
          unseen: false,
          picture: null, // filled by the Asset Slot resolver in main (AD-7)
          note: null, noteAt: 0, // the chalk line lives in the lane; main fills it
          attention: null,       // main derives it from the lane
          reminded: false,
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

  return { seq, background: BACKGROUND, characters: [...chars.values()], firstRun: null, openWindow: null, orders: [], muted: false, faces: {}, fuel: EMPTY_FUEL, fuelSign: null };
}
