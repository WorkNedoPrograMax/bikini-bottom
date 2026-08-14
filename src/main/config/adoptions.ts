// Town-label adoption (Maksym's decision): a character is a friendly face over
// an EXISTING lane. The real git branch keeps its feature name; Bikini only
// labels it. Keyed by project so it only applies to scout-and-runner.

import path from "node:path";
import type { CharacterId } from "../../shared/ipc";

export interface Adoption {
  /** Worktree folder next to the repo, e.g. "sr-bob". */
  laneDir: string;
  /** The lane's feature branch. */
  branch: string;
  /** What to show under the character on the street. */
  label: string;
  /** The lane's ALREADY-RUNNING Docker app ports (so the character never starts servers). */
  frontendPort: number;
  backendPort: number;
}

export interface SrProject {
  ghRepo: string;
  baseBranch: string;
  adoptions: Partial<Record<CharacterId, Adoption>>;
}

/** Adoption table for a project, or null if it isn't an S&R adoption project. */
export function srProjectFor(projectPath: string): SrProject | null {
  if (path.basename(projectPath) !== "scout-and-runner") return null;
  return {
    ghRepo: "apex-telecom/scout-and-runner",
    baseBranch: "pre-staging",
    adoptions: {
      bob: { laneDir: "sr-bob", branch: "feat/bob", label: "sr-bob", frontendPort: 3100, backendPort: 3101 },
      squid: { laneDir: "sr-squid", branch: "feat/squid", label: "sr-squid", frontendPort: 3200, backendPort: 3201 },
      pat: { laneDir: "sr-pat", branch: "feat/pat", label: "sr-pat", frontendPort: 3300, backendPort: 3301 },
    },
  };
}
