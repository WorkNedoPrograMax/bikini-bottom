// App-level config (which Project, First Run progress) — lives in the app's
// own userData, NOT in the Project (chicken-and-egg: we must remember the
// chosen Project before one exists). The per-Project event log lives in
// <project>/.bikini (AD-9); this store is separate and small.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { FirstRunStep } from "../../shared/ipc";

export interface AppConfigData {
  projectPath: string | null;
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
}

const DEFAULTS: AppConfigData = {
  projectPath: null,
  firstRunComplete: false,
  firstRunStep: "welcome",
  notificationsWanted: false,
  muted: false,
  bypassPermissions: true,
  srDryRun: true,
  telegramToken: null,
  telegramChatId: null,
};

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
  }

  async save(patch: Partial<AppConfigData>): Promise<void> {
    this.data = { ...this.data, ...patch };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.data, null, 2), "utf8");
  }
}
