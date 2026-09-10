// "Point at it" is two halves. This is the seam between them: the ENGINE that
// shows the lane's app and answers "what is at this spot?" lives behind this
// interface; the TRAY (cards, notes, compose, send) never sees anything else.
// Today the only engine is `WebPointerSource` (a WebContentsView over the lane's
// running web app). A future `SimulatorPointerSource` (screenshot of the iOS /
// Android simulator + a view-hierarchy lookup via Maestro / idb / adb) slots in
// here without touching the tray, the renderer or the compose step.

import type { PickRect, PointerKind } from "../../../shared/ipc";

export type Rect = PickRect;

/** What an engine reports for one click — a Pick minus Maksym's note. `details`
 *  carries whatever the engine knows, as strings (web: colour, font, radius,
 *  cssPath, html; a simulator: class, accessibility id, …). */
export interface PickRaw {
  id: string;
  kind: string;
  label: string;
  rect: Rect;
  /** PNG base64, ≤400 px wide, or null when the engine could not photograph it. */
  image: string | null;
  details: Record<string, string>;
}

/** What the engine tells the manager. */
export interface SourceEvents {
  onPick(p: PickRaw): void;
  /** The engine moved to a new screen/page (web: a navigation). */
  onUrl?(url: string): void;
  /** Maksym pressed Esc inside the engine's view. */
  onEscape?(): void;
  /** The app could not be shown (server down, bad URL…). Plain words. */
  onError?(message: string): void;
  /** The engine's page is ready for input (used by the dev-only click hook). */
  onReady?(): void;
}

export interface PointerSource {
  readonly kind: PointerKind;
  /** Show the app inside these window-content bounds (CSS px). */
  open(bounds: Rect): void;
  setBounds(bounds: Rect): void;
  /** Hide without losing state (the window minimised, a preview card is up). */
  hide(): void;
  show(): void;
  /** Armed = clicks pick things and emit `onPick`; off = clicks work as usual. */
  arm(on: boolean): void;
  /** Tell the engine which picks still stand, so it can draw numbered pins. */
  setPins(pins: { id: string; n: number }[]): void;
  /** Where the app is right now (web: the current URL), or null. */
  currentUrl(): string | null;
  /** Tear everything down. */
  close(): void;
}
