// The bridge. The renderer gets ONLY this small, typed surface — it can send
// named intents and receive snapshots, and nothing else (AD-1, AD-4). No Node,
// no fs, no direct SDK/git access ever reaches the view.

import { contextBridge, ipcRenderer, clipboard } from "electron";
import { CHANNELS, type Intent, type TownSnapshot, type SoundCue, type Toast, type CharacterId } from "../shared/ipc";

contextBridge.exposeInMainWorld("town", {
  send(intent: Intent) {
    ipcRenderer.send(CHANNELS.intent, intent);
  },
  // Copy text to the clipboard (Electron's clipboard, reliable under file://).
  copy(text: string) {
    try { clipboard.writeText(String(text)); } catch { /* ignore */ }
  },
  onSnapshot(cb: (snap: TownSnapshot) => void) {
    ipcRenderer.on(CHANNELS.snapshot, (_e, snap: TownSnapshot) => cb(snap));
  },
  onSound(cb: (cue: SoundCue) => void) {
    ipcRenderer.on(CHANNELS.sound, (_e, cue: SoundCue) => cb(cue));
  },
  // A transient one-liner for the "Point at it" tray (never persisted).
  onToast(cb: (t: Toast) => void) {
    ipcRenderer.on(CHANNELS.toast, (_e, t: Toast) => cb(t));
  },
  // Dev/screenshot hook only: open the Orders Board on launch.
  initialBoard: process.env.BIKINI_BOARD === "1",
});

// Real-terminal bridge for terminal-mode characters (squid). The renderer's
// xterm sends keystrokes/resizes and receives pty output — same tiny, typed
// surface discipline as `town` (AD-1, AD-4).
contextBridge.exposeInMainWorld("term", {
  open(id: CharacterId, cols: number, rows: number) {
    ipcRenderer.send(CHANNELS.termOpen, { id, cols, rows });
  },
  input(id: CharacterId, data: string) {
    ipcRenderer.send(CHANNELS.termInput, { id, data });
  },
  resize(id: CharacterId, cols: number, rows: number) {
    ipcRenderer.send(CHANNELS.termResize, { id, cols, rows });
  },
  // Files dropped onto the terminal → saved in the lane; their paths get typed in.
  dropFiles(id: CharacterId, attachments: { name: string; mediaType: string; data: string }[]) {
    ipcRenderer.send(CHANNELS.termDrop, { id, attachments });
  },
  onData(cb: (p: { id: CharacterId; data: string }) => void) {
    ipcRenderer.on(CHANNELS.termData, (_e, p) => cb(p));
  },
  onExit(cb: (p: { id: CharacterId; code: number }) => void) {
    ipcRenderer.on(CHANNELS.termExit, (_e, p) => cb(p));
  },
});
