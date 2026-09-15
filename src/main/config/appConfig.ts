// App-level config (which Project, First Run progress) — lives in the app's
// own userData, NOT in the Project (chicken-and-egg: we must remember the
// chosen Project before one exists). The per-Project event log lives in
// <project>/.bikini (AD-9); this store is separate and small.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { FirstRunStep, CharacterId } from "../../shared/ipc";

export interface AppConfigData {
  /** The town on screen (the Ferry): one of `towns`. Was "the single project". */
  projectPath: string | null;
  /** Every town (project folder) the app knows. Empty on an old config — load()
   *  migrates the lone projectPath into it. */
  towns: { path: string }[];
  firstRunComplete: boolean;
  /** Where the walkthrough left off, so quitting mid-First-Run resumes. */
  firstRunStep: FirstRunStep;
  /** Whether Maksym opted into notifications (optional; FR-7). */
  notificationsWanted: boolean;
  /** Sound muted? (FR-8) Persists across restarts. */
  muted: boolean;
  /** Bypass permissions — characters never stop to ask (Maksym's preference). */
  bypassPermissions: boolean;
  /** Gate S&R serving: when true, finishing only LOGS the push/PR (fires nothing). */
  srDryRun: boolean;
  /** Telegram remote control (FR: answer/drive the town from your phone). Both
   *  must be set for the bridge to run; kept in local config, never in source. */
  telegramToken: string | null;
  telegramChatId: number | null;
  /** "Point at it": the last Desktop / Phone choice per lane (desktop when unset). */
  pointerView: Partial<Record<CharacterId, "desktop" | "phone">>;
}

const DEFAULTS: AppConfigData = {
  projectPath: null,
  towns: [],
  firstRunComplete: false,
  firstRunStep: "welcome",
  notificationsWanted: false,
  muted: false,
  bypassPermissions: true,
  srDryRun: true,
  telegramToken: null,
  telegramChatId: null,
  pointerView: {},
};

/** A config from before the Ferry knew one project; now it is the first town.
 *  Silent: saved along with the next save(). Also drops malformed entries. */
export function migrateTowns(data: { projectPath: string | null; towns?: unknown }): { path: string }[] {
  const towns = Array.isArray(data.towns)
    ? (data.towns as unknown[]).filter((t): t is { path: string } => !!t && typeof t === "object" && typeof (t as { path?: unknown }).path === "string")
        .map((t) => ({ path: t.path }))
    : [];
  if (towns.length === 0 && data.projectPath) return [{ path: data.projectPath }];
  return towns;
}

export class AppConfig {
  private readonly file: string;
  data: AppConfigData = { ...DEFAULTS };

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, "bikini-config.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      this.data = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      this.data = { ...DEFAULTS };
    }
    this.data.towns = migrateTowns(this.data);
  }

  async save(patch: Partial<AppConfigData>): Promise<void> {
    this.data = { ...this.data, ...patch };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.data, null, 2), "utf8");
  }
}
