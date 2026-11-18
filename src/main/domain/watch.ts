// Is anyone looking at the town? PURE: decides, from the window's state, how
// much drawing and how many page updates the town may spend. No Electron here,
// so scripts/check-watch.mjs can run it.
//
// Why (measured 2026-11-18, M1, test copy): two pulsing 15 px dots alone cost
// about 10% of a core in the app and about 22% in WindowServer, because a
// running CSS animation makes the whole window present 60 times a second. With
// no animation running the app sits at 0.3%.

/** watched: visible, not minimised, focused — everything runs.
 *  glance:  visible but another app has the keyboard — pulses stand still, the page hears at most one update a second.
 *  away:    hidden, minimised or fully covered — pulses stand still, updates are held until someone looks. */
export type WatchState = "watched" | "glance" | "away";

export function watchState(w: { shown: boolean; minimized: boolean; focused: boolean }): WatchState {
  if (!w.shown || w.minimized) return "away";
  return w.focused ? "watched" : "glance";
}

/** At most one page update per this long while the window is only glanced at. */
export const GLANCE_EVERY_MS = 1000;

/** May a snapshot go to the page now? `waitMs` is set when it should be sent
 *  later by a timer (glance); null means "held until the watch state changes". */
export function snapshotGate(state: WatchState, now: number, lastSentAt: number): { send: boolean; waitMs: number | null } {
  if (state === "watched") return { send: true, waitMs: null };
  if (state === "away") return { send: false, waitMs: null };
  const since = now - lastSentAt;
  return since >= GLANCE_EVERY_MS ? { send: true, waitMs: null } : { send: false, waitMs: GLANCE_EVERY_MS - since };
}

/** Calm mode: the pulses stand still (the dots stay visible). auto = calm
 *  whenever more than CALM_ABOVE lanes are working, across every town. */
export type CalmMode = "auto" | "on" | "off";
export const CALM_ABOVE = 3;

export function normalizeCalm(v: unknown): CalmMode { return v === "on" || v === "off" ? v : "auto"; }
export function calmNow(mode: CalmMode, workingLanes: number): boolean {
  return mode === "on" || (mode === "auto" && workingLanes > CALM_ABOVE);
}
/** The button's cycle: auto → on → off → auto. */
export function nextCalm(mode: CalmMode): CalmMode { return mode === "auto" ? "on" : mode === "on" ? "off" : "auto"; }
