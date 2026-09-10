// The TRAY half of "Point at it": which lane is being pointed at, its picks
// (max 5), the Desktop / Phone hint, the preview, and the compose+send. It
// talks to the engine ONLY through `PointerSource`, so a simulator engine slots
// in later without touching anything here. Owns no Electron widgets itself.

import type { BrowserWindow } from "electron";
import { MAX_PICKS, type Attachment, type CharacterId, type Pick, type PickCard, type PointerView } from "../../../shared/ipc";
import { log } from "../../log";
import { composePicksMessage, duplicateIndex, pickCard, picksAttachments, type ComposeContext } from "./compose";
import type { PickRaw, PointerSource, Rect } from "./source";
import { WebPointerSource } from "./web";

const ZERO: Rect = { x: 0, y: 0, w: 0, h: 0 };
type ViewMode = "desktop" | "phone";

export interface PointerDeps {
  win: () => BrowserWindow | null;
  /** Something the renderer should redraw changed. */
  onChange: () => void;
  /** A one-line transient notice for the tray. */
  toast: (text: string) => void;
  /** The remembered Desktop / Phone choice per lane (desktop by default). */
  viewFor: (id: CharacterId) => ViewMode;
  saveView: (id: CharacterId, view: ViewMode) => Promise<void> | void;
}

export class PointerManager {
  /** The lane whose app is showing, or null. Only ever one at a time. */
  openFor: CharacterId | null = null;
  private source: PointerSource | null = null;
  private picks: Pick[] = [];
  private bounds: Rect = ZERO;
  private armed = true;
  private previewOpen = false;
  private error: string | null = null;

  constructor(private deps: PointerDeps) {}

  /** What the Work Window shows for this lane, or null when it has no app. */
  view(id: CharacterId, baseUrl: string | null): PointerView | null {
    if (!baseUrl) return null;
    const open = this.openFor === id && !!this.source;
    return {
      kind: this.source?.kind ?? "web",
      url: (open ? this.source?.currentUrl() : null) || baseUrl,
      view: this.deps.viewFor(id),
      open,
      armed: this.armed,
      error: open ? this.error : null,
      preview: open && this.previewOpen ? this.compose(id).text : null,
    };
  }

  cards(id: CharacterId): PickCard[] { return this.openFor === id ? this.picks.map(pickCard) : []; }

  open(id: CharacterId, url: string): void {
    if (this.openFor === id && this.source) return;
    if (this.source) this.closeQuiet();
    const win = this.deps.win();
    if (!win) return;
    this.openFor = id; this.picks = []; this.armed = true; this.previewOpen = false; this.error = null;
    const src = new WebPointerSource(win, url, {
      onPick: (raw) => this.addPick(raw),
      onUrl: () => this.deps.onChange(),
      onEscape: () => { if (this.previewOpen) this.closePreview(); else this.close(); },
      onError: (m) => { this.error = m; log("pointer", "engine error", { m }); this.deps.onChange(); },
      onReady: () => { this.readyAt = Date.now(); this.onReady?.(); },
    });
    this.source = src;
    src.open(this.bounds);
    src.arm(true);
    this.deps.onChange();
  }

  close(): void { if (this.closeQuiet()) this.deps.onChange(); }
  private closeQuiet(): boolean {
    if (!this.source && !this.openFor) return false;
    this.source?.close();
    this.source = null; this.openFor = null; this.picks = []; this.previewOpen = false; this.error = null;
    return true;
  }

  setBounds(b: Rect): void {
    this.bounds = b;
    this.source?.setBounds(b);
  }
  arm(on: boolean): void { this.armed = on; this.source?.arm(on); this.deps.onChange(); }

  /** The Desktop / Phone hint. Switching lets go of the picks (they were measured
   *  in the other layout); the renderer re-measures and sends new bounds. */
  async setView(id: CharacterId, view: ViewMode): Promise<void> {
    const before = this.deps.viewFor(id);
    await this.deps.saveView(id, view);
    if (this.openFor === id && before !== view) {
      const had = this.picks.length;
      this.picks = []; this.source?.setPins([]);
      this.deps.toast(`${view === "phone" ? "Phone" : "Desktop"} view.${had ? " Anything picked before was let go." : ""}`);
    }
    this.deps.onChange();
  }

  /** The window minimised / a preview is up → the engine's view must not float over it. */
  hideForWindow(): void { this.source?.hide(); }
  showForWindow(): void { if (!this.previewOpen) this.source?.show(); }

  /** Keep the engine in step with the town: pointing only inside the lane's own
   *  open Work Window, never while browsing a past order. Quiet — the caller is
   *  already pushing a snapshot. */
  reconcile(openWindowId: CharacterId | null, viewingPast: boolean): void {
    if (this.openFor && (this.openFor !== openWindowId || viewingPast)) this.closeQuiet();
  }

  private addPick(raw: PickRaw): void {
    if (!this.openFor) return;
    const dup = duplicateIndex(this.picks, raw);
    if (dup >= 0) { this.deps.toast(`Already in the tray — that one is number ${dup + 1}.`); this.pushPins(); return; }
    if (this.picks.length >= MAX_PICKS) { this.deps.toast("Five is plenty for one message — send these first."); this.pushPins(); return; }
    this.picks.push({ ...raw, note: "" });
    log("pointer", "pick", { n: this.picks.length, kind: raw.kind, label: raw.label, rect: raw.rect, image: raw.image ? raw.image.length : 0 });
    this.pushPins();
    this.deps.onChange();
  }
  private pushPins(): void { this.source?.setPins(this.picks.map((p, i) => ({ id: p.id, n: i + 1 }))); }

  removePick(id: CharacterId, pickId: string): void {
    if (this.openFor !== id) return;
    const n = this.picks.length;
    this.picks = this.picks.filter((p) => p.id !== pickId);
    if (this.picks.length !== n) { this.pushPins(); this.deps.onChange(); }
  }

  private setNotes(notes: Record<string, string> | undefined): void {
    if (!notes) return;
    for (const p of this.picks) if (typeof notes[p.id] === "string") p.note = notes[p.id].trim();
  }

  /** "What they will read": compose and show; the engine's view hides so the card is visible. */
  openPreview(id: CharacterId, notes: Record<string, string>): void {
    if (this.openFor !== id || !this.picks.length) return;
    this.setNotes(notes);
    this.previewOpen = true;
    this.source?.hide();
    this.deps.onChange();
  }
  closePreview(): void {
    if (!this.previewOpen) return;
    this.previewOpen = false;
    this.source?.show();
    this.deps.onChange();
  }

  private context(id: CharacterId): ComposeContext {
    return { engine: this.source?.kind ?? "web", url: this.source?.currentUrl() || "", view: this.deps.viewFor(id), viewWidth: this.bounds.w };
  }
  private compose(id: CharacterId): { text: string; attachments: Attachment[] } {
    const ctx = this.context(id);
    const when = Date.now();
    return { text: composePicksMessage(this.picks, ctx), attachments: picksAttachments(this.picks, ctx, when) };
  }

  /** Compose the ONE follow-up and hand it back; the tray empties and the app
   *  stays showing so Maksym can click again to check. */
  take(id: CharacterId, notes: Record<string, string>): { text: string; attachments: Attachment[] } | null {
    if (this.openFor !== id || !this.picks.length) return null;
    this.setNotes(notes);
    const out = this.compose(id);
    log("pointer", "send", { n: this.picks.length, chars: out.text.length, attachments: out.attachments.map((a) => a.name) });
    this.picks = []; this.previewOpen = false;
    this.pushPins(); this.source?.show();
    this.deps.toast("Sent. The tray is empty again.");
    this.deps.onChange();
    return out;
  }

  // ── dev/screenshot hooks only (BIKINI_CAPTURE / BIKINI_POINT_CLICKS) ──
  /** The engine's own picture + where it sits, for compositing into a capture. */
  async shot(): Promise<{ image: Electron.NativeImage; bounds: Rect } | null> {
    const src = this.source as WebPointerSource | null;
    return src && "shot" in src ? src.shot() : null;
  }
  private readyAt = 0;
  private onReady: (() => void) | null = null;
  /** Click these spots inside the engine's view once its page is ready; with a
   *  `previewNote`, then open the "what they will read" card with that note on pick 1. */
  debugClicks(points: [number, number][], previewNote: string | null = null, onPreview: ((id: CharacterId, notes: Record<string, string>) => void) | null = null, gapMs = 700): void {
    const go = () => {
      const src = this.source as WebPointerSource | null;
      if (!src || !("debugClick" in src)) return;
      points.forEach(([x, y], i) => setTimeout(() => src.debugClick(x, y), 600 + i * gapMs));
      if (previewNote !== null) setTimeout(() => {
        if (!this.openFor || !this.picks[0]) return;
        const notes = { [this.picks[0].id]: previewNote };
        this.openPreview(this.openFor, notes);
        if (onPreview) setTimeout(() => this.openFor && onPreview(this.openFor, notes), 1500); // "Send it", for a driven test
      }, 600 + points.length * gapMs + 500);
    };
    if (this.readyAt) go(); else this.onReady = go;
  }
}
