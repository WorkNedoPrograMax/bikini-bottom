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
  /** The reviewer: review orders only, never code, visible only while reviewing. */
  reviewer: boolean;
}

export const ROSTER: RosterEntry[] = [
  { id: "pat", name: "Patrick", role: "the easy lane", accent: "#f072a6", pos: { leftPct: 16, topPct: 74 }, isHomeBase: false, reviewer: false },
  { id: "squid", name: "Squidward", role: "the grumpy lane", accent: "#4fb0a0", pos: { leftPct: 47, topPct: 76 }, isHomeBase: false, reviewer: false },
  { id: "krabs", name: "Mr. Krabs", role: "home base", accent: "#c0392b", pos: { leftPct: 58, topPct: 79 }, isHomeBase: true, reviewer: false },
  { id: "bob", name: "SpongeBob", role: "the eager lane", accent: "#f7b500", pos: { leftPct: 80, topPct: 74 }, isHomeBase: false, reviewer: false },
  // Karen (2026-11-06): Plankton's computer wife, the reviewer — a wall screen
  // that hangs from the ceiling at the top middle of the street (2026-11-09:
  // "hang from the ceiling on the top middle part when she's working and
  // finished; mouse over and she comes down a bit so I can press"), appears
  // only while reviewing, and is offered for nothing else. Her workspace is the project folder itself (town.json
  // `lanes.karen = { dir: ".", branch: "dev" }`), never a worktree.
  { id: "karen", name: "Karen", role: "the reviewer", accent: "#39c08f", pos: { leftPct: 50, topPct: 0 }, isHomeBase: false, reviewer: true },
];

/** The reviewer ids (one today). */
export const REVIEWER_IDS: ReadonlySet<CharacterId> = new Set(ROSTER.filter((r) => r.reviewer).map((r) => r.id));
