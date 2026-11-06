// The Asset Slot resolver (AD-7). Main — not the view — decides which file
// fills each slot, falling back to null (a labelled stand-in) when absent.
// The app never fetches or generates art (FR-18); it only wires in files
// Maksym provides under the assets directory.

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CharacterId, CharacterState } from "../../shared/ipc";

// Name aliases so Maksym's own files are found however he named them
// (sponge/bob, patrick/patrcick, hyphen/underscore, numbered variants).
const SOUND_ALIASES: Record<CharacterId, string[]> = {
  bob: ["bob", "sponge"],
  squid: ["squid"],
  pat: ["pat", "patrick", "patrcick"],
  krabs: ["krab"],
  karen: ["karen"],
};

/** Resolve a Character's sound for a cue ('start' | 'ready'), picking a random
 *  variant when several match. Returns a file:// URL or null → no sound. */
export function resolveSound(soundsDir: string, id: CharacterId, kind: "start" | "ready"): string | null {
  let files: string[];
  try { files = readdirSync(soundsDir); } catch { return null; }
  const aliases = SOUND_ALIASES[id] || [id];
  const matches = files.filter((f) => {
    const n = f.toLowerCase();
    return /\.(mp3|wav|m4a|ogg|aac)$/.test(n) && n.includes(kind) && aliases.some((a) => n.includes(a));
  });
  if (!matches.length) return null;
  const pick = matches[Math.floor(Math.random() * matches.length)];
  return pathToFileURL(path.join(soundsDir, pick)).href;
}

/** A Character's picture for a State, as a file:// URL — or null → stand-in. */
export function resolvePicture(assetsDir: string, id: CharacterId, state: CharacterState): string | null {
  const p = path.join(assetsDir, `${id}-${state}.png`);
  return existsSync(p) ? pathToFileURL(p).href : null;
}

/** The street background, as a file:// URL — or null → stand-in colour. */
export function resolveBackground(assetsDir: string, name: string): string | null {
  const p = path.join(assetsDir, name);
  return existsSync(p) ? pathToFileURL(p).href : null;
}

/** A Character's portrait (`<id>.png`) for UI chrome — file:// URL or null. */
export function resolveFace(assetsDir: string, id: CharacterId): string | null {
  const p = path.join(assetsDir, `${id}.png`);
  return existsSync(p) ? pathToFileURL(p).href : null;
}

/** A Character's helper/sub-agent icon, shown next to running helper names.
 *  Looks for `<id>-helper.png` or `<id>-agent.png` — file:// URL or null. */
export function resolveHelperIcon(assetsDir: string, id: CharacterId): string | null {
  for (const name of [`${id}-helper.png`, `${id}-agent.png`, `${id}-subagent.png`]) {
    const p = path.join(assetsDir, name);
    if (existsSync(p)) return pathToFileURL(p).href;
  }
  return null;
}

/** The Mailbox's two pictures: `mailbox-empty.png` (flag down, nothing for
 *  you) and `mailbox-ready.png` (mail is in) — file:// URLs or null → stand-in. */
export function resolveMailPictures(assetsDir: string): { empty: string | null; ready: string | null } {
  const url = (name: string) => { const p = path.join(assetsDir, name); return existsSync(p) ? pathToFileURL(p).href : null; };
  return { empty: url("mailbox-empty.png"), ready: url("mailbox-ready.png") };
}

/** The mail chime: any audio file whose name contains "mail" — or null (no sound). */
export function resolveMailSound(soundsDir: string): string | null {
  let files: string[];
  try { files = readdirSync(soundsDir); } catch { return null; }
  const m = files.filter((f) => /\.(mp3|wav|m4a|ogg|aac)$/i.test(f) && f.toLowerCase().includes("mail"));
  if (!m.length) return null;
  return pathToFileURL(path.join(soundsDir, m[Math.floor(Math.random() * m.length)])).href;
}
