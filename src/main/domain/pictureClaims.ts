// Which character a picture belongs to.
//
// 2026-11-04: Patrick (the mobile town) saved seven phone screenshots into
// ~/Desktop/claude-deliverables/ and Bob (the backend town) showed the very same
// seven in his own bubbles minutes later, as if he had made them. The folder is
// one for every character in every town, and "newer than the start of my turn"
// was true for every lane that happened to be awake. So time alone is not
// ownership. A character claims a picture only when its OWN work this turn
// named it — in a tool call, in a tool's result, in a reply — or when the file
// appeared while one of its own tool calls that named the deliverables folder
// was running (`cp shots/*.png ~/Desktop/claude-deliverables/` never spells the
// file names out). Nothing here touches Electron, so the check script can run it.
import path from "node:path";

/** The folder name every lane's pictures land in (any depth of path). */
export const DELIVERABLES_DIR_NAME = "claude-deliverables";
const PICTURE_MENTION_RE = /\.(?:png|jpe?g|gif|webp)\b/i;
const EVIDENCE_MAX_ENTRIES = 200;
const EVIDENCE_CLIP = 64_000;
/** A file's mtime and the clock we stamp tool calls with are not the same clock. */
const WINDOW_SLACK_MS = 2000;

export interface PictureEvidence {
  /** Text this lane's own stream produced this turn that mentions a picture at
   *  all — tool inputs, tool results, replies. Clipped and bounded. */
  text: string[];
  /** Tool calls whose input named the deliverables folder: tool_use id → the
   *  span they ran in. `to` is Infinity until the result comes back. */
  windows: Map<string, { from: number; to: number }>;
}

export function newEvidence(): PictureEvidence { return { text: [], windows: new Map() }; }

function asText(s: unknown): string {
  if (typeof s === "string") return s;
  if (s == null) return "";
  try { return JSON.stringify(s); } catch { return String(s); }
}

/** Remember a piece of this lane's own stream (only kept when it names a picture). */
export function noteEvidence(ev: PictureEvidence, s: unknown): void {
  const t = asText(s);
  if (!t || !PICTURE_MENTION_RE.test(t)) return;
  ev.text.push(t.length > EVIDENCE_CLIP ? t.slice(0, EVIDENCE_CLIP) : t);
  if (ev.text.length > EVIDENCE_MAX_ENTRIES) ev.text.splice(0, ev.text.length - EVIDENCE_MAX_ENTRIES);
}

/** A tool call started: if its input names the deliverables folder, pictures
 *  that appear while it runs are this lane's. */
export function openWindow(ev: PictureEvidence, toolUseId: string, input: unknown, now: number): void {
  if (!toolUseId || !asText(input).includes(DELIVERABLES_DIR_NAME)) return;
  ev.windows.set(toolUseId, { from: now, to: Infinity });
}

/** That tool call's result came back: close its window. */
export function closeWindow(ev: PictureEvidence, toolUseId: string, now: number): void {
  const w = ev.windows.get(toolUseId);
  if (w && w.to === Infinity) w.to = now;
}

/** Is this picture this lane's own — named in `text` (the reply or question
 *  being shown), named anywhere in the turn's evidence, or made inside one of
 *  the lane's own deliverables-folder tool calls? */
export function isClaimed(ev: PictureEvidence, file: string, mtime: number, text: string): boolean {
  const base = path.basename(file);
  if (text.includes(base)) return true;
  for (const t of ev.text) if (t.includes(base)) return true;
  for (const w of ev.windows.values()) if (mtime >= w.from - WINDOW_SLACK_MS && mtime <= w.to + WINDOW_SLACK_MS) return true;
  return false;
}
