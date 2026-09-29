// The Ferry: one town per project. Each project carries a small PROFILE at
// <project>/.bikini/town.json — its sign name, how finishing behaves ("landing"),
// and, for Scout & Runner, the character-to-lane table that used to live in code.
// PURE (fs is injected, no Electron) so scripts/check-towns.mjs can test it.

import path from "node:path";
import type { CharacterId, TownTab } from "../../shared/ipc";
import { normalizeSetup, type LaneSetup } from "../domain/laneSetup";

export interface LaneSpec {
  /** The lane's worktree, RELATIVE to the project (e.g. "../sr-bob"). */
  dir: string;
  /** The lane's real feature branch (Bikini only labels it, never touches it). */
  branch: string;
  /** What to show under the character on the street. */
  label: string;
  /** The lane's ALREADY-RUNNING app ports (so the character never starts servers). */
  frontendPort?: number;
  backendPort?: number;
}

export type Landing = "none" | "auto";

/** The Phone Booth: the ONE test phone this town's characters share in turns.
 *  Absent = no booth (Scout & Runner never gets one). */
export interface DeviceSpec {
  kind: "ios-simulator" | "android-emulator";
  /** simctl UDID, or the AVD name. */
  id: string;
  /** What the street and the character call it, e.g. "iPhone 16". */
  name: string;
  /** Seconds the holder keeps the phone between two phone commands (default 60). */
  graceSec?: number;
  /** Minutes after which the phone is handed over regardless (default 30). */
  maxHoldMin?: number;
}

export interface TownProfile {
  /** Shown on the sign. */
  name: string;
  /** none = Bikini never touches git on finish (team repo, people review PRs);
   *  auto = Epic 5 serveJob lands finished work on the project's main line. */
  landing: Landing;
  /** Adopted existing lanes (S&R). Absent = fresh .bikini/worktrees per character. */
  lanes?: Partial<Record<CharacterId, LaneSpec>>;
  /** Optional extra sentence for the system prompt (future projects with servers). */
  servers?: string;
  /** The test phone (the booth), when this town has one. */
  device?: DeviceSpec;
  /** What a fresh lane needs before building (git-ignored files to copy in,
   *  commands to run once). Absent = a lane is ready as checked out. */
  setup?: LaneSetup;
}

/** Where a project's profile lives. */
export function profilePath(projectPath: string): string {
  return path.join(projectPath, ".bikini", "town.json");
}

const SR_BASENAME = "scout-and-runner";

/** The sign name a folder gets before anyone renames it. */
export function defaultName(projectPath: string): string {
  const base = path.basename(projectPath);
  return base === SR_BASENAME ? "Scout & Runner" : base;
}

/** Today's Scout & Runner table (was `srProjectFor` in adoptions.ts): a
 *  character is a friendly face over an EXISTING lane next to the repo. */
function srLanes(): Partial<Record<CharacterId, LaneSpec>> {
  return {
    bob: { dir: "../sr-bob", branch: "feat/bob", label: "sr-bob", frontendPort: 3100, backendPort: 3101 },
    squid: { dir: "../sr-squid", branch: "feat/squid", label: "sr-squid", frontendPort: 3200, backendPort: 3201 },
    pat: { dir: "../sr-pat", branch: "feat/pat", label: "sr-pat", frontendPort: 3300, backendPort: 3301 },
  };
}

/** The profile a project gets when it has no town.json yet. S&R gets its three
 *  lanes and landing "none" (Bikini never merges on a team repo); any other
 *  folder is just a name — landing "none" until Maksym says otherwise. */
export function seedProfile(projectPath: string, landing: Landing = "none"): TownProfile {
  const p: TownProfile = { name: defaultName(projectPath), landing };
  if (path.basename(projectPath) === SR_BASENAME) p.lanes = srLanes();
  return p;
}

const CHARACTER_IDS: readonly CharacterId[] = ["bob", "squid", "pat", "krabs"];

/** Tidy whatever was in the file into a well-formed profile. Unknown fields are
 *  dropped, missing ones defaulted — never throws. */
export function normalizeProfile(raw: unknown, projectPath: string): TownProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: TownProfile = {
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : defaultName(projectPath),
    landing: r.landing === "auto" ? "auto" : "none",
  };
  if (r.lanes && typeof r.lanes === "object") {
    const lanes: Partial<Record<CharacterId, LaneSpec>> = {};
    for (const id of CHARACTER_IDS) {
      const l = (r.lanes as Record<string, unknown>)[id] as Record<string, unknown> | undefined;
      if (!l || typeof l !== "object" || typeof l.dir !== "string" || typeof l.branch !== "string") continue;
      const spec: LaneSpec = { dir: l.dir, branch: l.branch, label: typeof l.label === "string" ? l.label : path.basename(l.dir) };
      if (typeof l.frontendPort === "number" && isFinite(l.frontendPort)) spec.frontendPort = l.frontendPort;
      if (typeof l.backendPort === "number" && isFinite(l.backendPort)) spec.backendPort = l.backendPort;
      lanes[id] = spec;
    }
    if (Object.keys(lanes).length) out.lanes = lanes;
  }
  if (typeof r.servers === "string" && r.servers.trim()) out.servers = r.servers.trim();
  const dev = normalizeDevice(r.device);
  if (dev) out.device = dev;
  const setup = normalizeSetup(r.setup);
  if (setup) out.setup = setup;
  return out;
}

/** A well-formed phone, or null when the field is missing or malformed (a
 *  malformed phone is dropped rather than half-kept: no booth beats a wrong one). */
export function normalizeDevice(raw: unknown): DeviceSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (d.kind !== "ios-simulator" && d.kind !== "android-emulator") return null;
  if (typeof d.id !== "string" || !d.id.trim() || typeof d.name !== "string" || !d.name.trim()) return null;
  const out: DeviceSpec = { kind: d.kind, id: d.id.trim(), name: d.name.trim() };
  if (typeof d.graceSec === "number" && isFinite(d.graceSec) && d.graceSec > 0) out.graceSec = d.graceSec;
  if (typeof d.maxHoldMin === "number" && isFinite(d.maxHoldMin) && d.maxHoldMin > 0) out.maxHoldMin = d.maxHoldMin;
  return out;
}

/** Read <project>/.bikini/town.json. Null when there is no file or it isn't
 *  JSON — the caller then seeds one. Never throws. */
export function loadProfile(projectPath: string, readFile: (file: string) => string): TownProfile | null {
  let raw: string;
  try { raw = readFile(profilePath(projectPath)); } catch { return null; }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return normalizeProfile(parsed, projectPath);
  } catch { return null; }
}

/** The profile as it is written to disk (pretty, stable key order). */
export function serializeProfile(p: TownProfile): string {
  return JSON.stringify(p, null, 2) + "\n";
}

/** One adopted lane, resolved against the project folder. */
export interface ResolvedLane { worktree: string; branch: string; label: string; frontendPort?: number; backendPort?: number }

/** Resolve a profile's adopted lanes to absolute paths, or null when the town
 *  has none (characters then get fresh worktrees under .bikini). The returned
 *  object is shape-compatible with the lane engine's AdoptionSupport. */
export function laneAdoption(projectPath: string, profile: TownProfile): { adoptionFor(id: CharacterId): ResolvedLane | null } | null {
  const lanes = profile.lanes;
  if (!lanes || Object.keys(lanes).length === 0) return null;
  const resolved: Partial<Record<CharacterId, ResolvedLane>> = {};
  for (const id of CHARACTER_IDS) {
    const l = lanes[id];
    if (!l) continue;
    resolved[id] = { worktree: path.resolve(projectPath, l.dir), branch: l.branch, label: l.label, frontendPort: l.frontendPort, backendPort: l.backendPort };
  }
  return { adoptionFor: (id) => resolved[id] ?? null };
}

/** Landing gate for the lane engine's integrate(): only an "auto" town lands
 *  work, and never on an adopted lane (its repo's own rules decide commits/PRs). */
export function shouldLand(landing: Landing, adopted: boolean): boolean {
  return landing === "auto" && !adopted;
}

/** What the sign needs to know about one town, before wording. */
export interface TownTabInput {
  path: string;
  name: string;
  /** The folder is gone (could not open) — shown greyed, unclickable. */
  missing?: boolean;
  /** That town's characters, from ITS OWN fold. */
  characters: readonly { name: string; state: string; unseen: boolean; isHomeBase: boolean }[];
}

/** The switcher's lines: who is cooking and who needs you, per town. */
export function townTabsFor(inputs: readonly TownTabInput[], currentPath: string | null): TownTab[] {
  return inputs.map((t) => {
    const crew = t.characters.filter((c) => !c.isHomeBase);
    const cookingNames = crew.filter((c) => c.state === "working").map((c) => c.name);
    const needsYou = crew.filter((c) => c.state === "calling" && c.unseen).length;
    const tab: TownTab = { path: t.path, name: t.name, current: t.path === currentPath, cooking: cookingNames.length, needsYou, cookingNames };
    if (t.missing) tab.missing = true;
    return tab;
  });
}
