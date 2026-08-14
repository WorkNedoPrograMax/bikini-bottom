// Simple always-on logger. Writes timestamped lines to a log file in the app's
// userData dir (and mirrors to stdout → /tmp/bikini-live.log). So whenever
// anything happens — a job, a tool, a finish, a burn with its real error — we
// can see exactly what and why.

import { appendFile } from "node:fs";
import path from "node:path";

let LOG_FILE = "";

export function initLog(userDataDir: string): string {
  LOG_FILE = path.join(userDataDir, "bikini.log");
  log("app", "logging started", { file: LOG_FILE });
  return LOG_FILE;
}

export function logFilePath(): string { return LOG_FILE; }

export function log(area: string, msg: string, extra?: unknown): void {
  const line = `${new Date().toISOString()} [${area}] ${msg}${extra !== undefined ? " " + safe(extra) : ""}\n`;
  try { process.stdout.write(line); } catch { /* ignore */ }
  if (LOG_FILE) appendFile(LOG_FILE, line, () => {});
}

function safe(x: unknown): string {
  if (typeof x === "string") return x;
  try { return JSON.stringify(x); } catch { return String(x); }
}
