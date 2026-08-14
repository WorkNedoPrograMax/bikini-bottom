// The Character roster — data-driven so adding Sandy later is one row + her
// files, with no code change anywhere else (FR-2). Positions and accents come
// from the mockup + DESIGN.md tokens.

import type { CharacterId } from "../../shared/ipc";

export interface RosterEntry {
  id: CharacterId;
  name: string;
  role: string;
  accent: string;
  pos: { leftPct: number; topPct: number };
  isHomeBase: boolean;
}

export const ROSTER: RosterEntry[] = [
  { id: "pat", name: "Patrick", role: "the easy lane", accent: "#f072a6", pos: { leftPct: 16, topPct: 74 }, isHomeBase: false },
  { id: "squid", name: "Squidward", role: "the grumpy lane", accent: "#4fb0a0", pos: { leftPct: 47, topPct: 76 }, isHomeBase: false },
  { id: "krabs", name: "Mr. Krabs", role: "home base", accent: "#c0392b", pos: { leftPct: 63, topPct: 79 }, isHomeBase: true },
  { id: "bob", name: "SpongeBob", role: "the eager lane", accent: "#f7b500", pos: { leftPct: 80, topPct: 74 }, isHomeBase: false },
];
