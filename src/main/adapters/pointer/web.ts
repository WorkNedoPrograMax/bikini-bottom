// The WEB engine of "Point at it": Electron's WebContentsView (main-process
// owned, composited ABOVE the renderer page — so no CSP fight, and everything
// under its bounds is hidden) showing the lane's already-running app, with
// `pointerPreload.js` inside it doing the hover/click work. `capturePage(rect)`
// gives the cropped screenshot. Navigation is locked to the lane's origin.

import { BrowserWindow, WebContentsView, ipcMain, type IpcMainEvent } from "electron";
import path from "node:path";
import { log } from "../../log";
import { capText, cropRect, hexOf, trimHtml, IMAGE_MAX_WIDTH } from "./compose";
import type { PickRaw, PointerSource, Rect, SourceEvents } from "./source";

const ZERO: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** What the preload sends on a click (see pointerPreload.ts). */
interface PreloadPick {
  id: string; kind: string; label: string; rect: Rect; viewport: { w: number; h: number };
  tag: string; cssPath: string; html: string; computed: Record<string, string>;
}

export class WebPointerSource implements PointerSource {
  readonly kind = "web" as const;
  private view: WebContentsView | null = null;
  private bounds: Rect = ZERO;
  private visible = true;
  private armed = false;
  private pins: { id: string; n: number }[] = [];
  private url: string;
  private readonly origin: string;
  private closed = false;
  private readonly onPickIpc = (e: IpcMainEvent, data: PreloadPick) => { if (this.mine(e)) void this.handlePick(data); };
  private readonly onEscIpc = (e: IpcMainEvent) => { if (this.mine(e)) this.ev.onEscape?.(); };
  private readonly onReadyIpc = (e: IpcMainEvent) => { if (this.mine(e)) { this.pushState(); this.ev.onReady?.(); } };

  constructor(private win: BrowserWindow, url: string, private ev: SourceEvents) {
    this.url = url;
    let origin = "";
    try { origin = new URL(url).origin; } catch { /* keep "" → every navigation is refused */ }
    this.origin = origin;
  }

  private mine(e: IpcMainEvent): boolean { return !!this.view && e.sender.id === this.view.webContents.id; }

  open(bounds: Rect): void {
    if (this.view || this.closed) return;
    this.bounds = bounds;
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, "pointerPreload.js"),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        partition: "persist:pointer",
      },
    });
    this.view = view;
    view.setBackgroundColor("#ffffff");
    this.win.contentView.addChildView(view);
    view.setBounds(this.electronBounds());
    view.setVisible(this.visible && bounds.w > 0 && bounds.h > 0);
    const wc = view.webContents;
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (details) => {
      let ok = false;
      try { ok = new URL(details.url).origin === this.origin; } catch { ok = false; }
      if (!ok) { details.preventDefault(); log("pointer", "navigation refused (other origin)", { url: details.url }); }
    });
    const nav = (_e: unknown, url: string) => { if (url && url !== this.url) { this.url = url; this.ev.onUrl?.(url); } };
    wc.on("did-navigate", nav);
    wc.on("did-navigate-in-page", nav);
    wc.on("dom-ready", () => this.pushState());
    if (process.env.BIKINI_POINT) wc.on("console-message", (_e, _lvl, msg) => log("pointer", "page console", { msg: msg.slice(0, 200) }));
    wc.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = aborted (a redirect / our own reload)
      this.ev.onError?.(`Couldn't open ${url} — ${desc || "no answer"}. Is this lane's app running?`);
    });
    ipcMain.on("pointer:pick", this.onPickIpc);
    ipcMain.on("pointer:escape", this.onEscIpc);
    ipcMain.on("pointer:ready", this.onReadyIpc);
    log("pointer", "web source open", { url: this.url, bounds });
    void wc.loadURL(this.url).catch((e) => this.ev.onError?.(`Couldn't open ${this.url} — ${String((e as Error).message || e).slice(0, 80)}`));
  }

  private electronBounds() { return { x: this.bounds.x, y: this.bounds.y, width: Math.max(0, this.bounds.w), height: Math.max(0, this.bounds.h) }; }

  setBounds(bounds: Rect): void {
    this.bounds = bounds;
    if (!this.view) return;
    this.view.setBounds(this.electronBounds());
    this.view.setVisible(this.visible && bounds.w > 0 && bounds.h > 0);
  }
  hide(): void { this.visible = false; this.view?.setVisible(false); }
  show(): void { this.visible = true; if (this.view) this.view.setVisible(this.bounds.w > 0 && this.bounds.h > 0); }

  arm(on: boolean): void { this.armed = on; this.pushState(); }
  setPins(pins: { id: string; n: number }[]): void { this.pins = pins; this.pushState(); }
  currentUrl(): string | null { return this.url; }

  /** (Re)send arm + pins to the preload — on every dom-ready too, since a page
   *  reload starts the preload from scratch. */
  private pushState(): void {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    try { wc.send("pointer:arm", this.armed); wc.send("pointer:pins", this.pins); } catch { /* view going away */ }
  }

  private async handlePick(data: PreloadPick): Promise<void> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    let image: string | null = null;
    try {
      const vw = data.viewport?.w || this.bounds.w, vh = data.viewport?.h || this.bounds.h;
      let img = await wc.capturePage(cropRect(data.rect, vw, vh));
      if (img.getSize().width > IMAGE_MAX_WIDTH) img = img.resize({ width: IMAGE_MAX_WIDTH });
      image = img.isEmpty() ? null : img.toPNG().toString("base64");
    } catch (e) {
      log("pointer", "capture failed", { error: String(e).slice(0, 120) });
    }
    const c = data.computed || {};
    const details: Record<string, string> = { tag: data.tag || "", cssPath: data.cssPath || "" };
    const bg = hexOf(c.background); if (bg) details.background = bg;
    const fg = hexOf(c.color); if (fg) details.color = fg;
    for (const k of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "margin", "padding", "radius", "display", "width", "height"] as const) {
      const v = c[k]; if (v && v !== "none" && v !== "normal" && v !== "0px") details[k] = String(v).slice(0, 120);
    }
    details.html = trimHtml(data.html);
    const raw: PickRaw = { id: data.id, kind: data.kind || "box", label: capText(data.label), rect: data.rect, image, details };
    this.ev.onPick(raw);
    this.pushState(); // brings the overlay back (the preload hid it for the photo)
  }

  /** Dev/screenshot hook only: a photo of the whole view (the window's own
   *  capturePage cannot see a child view), for compositing into BIKINI_CAPTURE. */
  async shot(): Promise<{ image: Electron.NativeImage; bounds: Rect } | null> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed() || !this.visible || this.bounds.w <= 0) { log("pointer", "shot skipped", { has: !!wc, visible: this.visible, bounds: this.bounds }); return null; }
    try { return { image: await wc.capturePage(), bounds: this.bounds }; } catch (e) { log("pointer", "shot failed", { error: String(e) }); return null; }
  }

  /** Dev/screenshot hook only: a synthetic click at (x, y) inside the view. */
  debugClick(x: number, y: number): void {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.sendInputEvent({ type: "mouseMove", x, y });
    wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    ipcMain.removeListener("pointer:pick", this.onPickIpc);
    ipcMain.removeListener("pointer:escape", this.onEscIpc);
    ipcMain.removeListener("pointer:ready", this.onReadyIpc);
    const view = this.view;
    this.view = null;
    if (!view) return;
    try { if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view); } catch { /* window gone */ }
    try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch { /* already closed */ }
    log("pointer", "web source closed", { url: this.url });
  }
}
