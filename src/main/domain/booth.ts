// The Phone Booth: ONE test phone per town, shared in turns. Characters build in
// parallel on their own copies; only a command that touches the phone (install,
// run, drive, Maestro flow, screenshot) walks to the booth and waits its turn.
// PURE (no Electron, no timers of its own, the clock is injected) so
// scripts/check-booth.mjs can test it with plain node.

/** What the door guard makes of one tool call. */
export type PhoneVerdict = "phone" | "forbidden" | null;

export const FORBIDDEN_REASON = "The town runs the test phone. Never shut it down, wipe it, or boot another one — tell Maksym if it looks broken.";
export const LEFT_REASON = "Your job ended while waiting for the phone — this command was not run.";

export const DEFAULT_GRACE_SEC = 60;
export const DEFAULT_MAX_HOLD_MIN = 30;

/** Word wrappers that sit in front of the real binary on a command line. */
const PREFIXES = new Set(["npx", "bunx", "sudo", "time", "nohup", "exec", "fvm", "env", "command", "caffeinate"]);
/** Maestro flags that take a value (so the value is not read as the subcommand). */
const MAESTRO_VALUE_FLAGS = new Set(["--device", "--udid", "-d", "--platform", "-p", "--config", "-e", "--env", "--output", "--format", "--debug-output", "--driver-host-port", "--host", "--port", "--include-tags", "--exclude-tags", "--shards", "--shard-split", "--shard-all", "--test-output-dir", "--api-key", "--project-id"]);

const unquote = (t: string): string => t.replace(/^[("'`]+/, "").replace(/["'`)]+$/, "");
const basename = (t: string): string => t.split("/").pop() || t;

/** Split a shell line into command segments (on && || ; | and newlines), each
 *  a token list with quotes stripped and leading env assignments / wrappers
 *  dropped, so `cd ios && FOO=1 fvm flutter run -d X` sees `flutter run -d X`. */
export function commandSegments(cmd: string): string[][] {
  const out: string[][] = [];
  for (const raw of String(cmd || "").split(/\s*(?:&&|\|\||;|\||\n)\s*/)) {
    const toks = raw.trim().split(/\s+/).filter(Boolean).map(unquote).filter(Boolean);
    let i = 0;
    while (i < toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]) || PREFIXES.has(basename(toks[i])))) i++;
    const seg = toks.slice(i);
    if (seg.length) { seg[0] = basename(seg[0]); out.push(seg); }
  }
  return out;
}

/** The first token after the binary that is not a flag (skipping the value of a
 *  known value-taking flag): the subcommand. */
function subcommand(seg: string[], valueFlags: Set<string>): string | null {
  for (let i = 1; i < seg.length; i++) {
    const t = seg[i];
    if (t.startsWith("-")) { if (!t.includes("=") && valueFlags.has(t)) i++; continue; }
    return t;
  }
  return null;
}

function bashVerdict(seg: string[], deviceId: string): PhoneVerdict {
  const bin = seg[0];
  const isDevice = (t: string | undefined): boolean => !!t && t === deviceId;
  if (bin === "xcrun" || bin === "simctl") {
    const a = bin === "xcrun" ? seg.slice(1) : seg;
    if (a[0] !== "simctl") return null;
    const sub = a[1];
    if (sub === "shutdown" || sub === "erase" || sub === "delete") return "forbidden";
    if (sub === "boot") return isDevice(a[2]) ? null : "forbidden";
    if (["install", "launch", "terminate", "uninstall", "io", "openurl", "spawn"].includes(sub || "")) return "phone";
    return null; // list, help, runtime…
  }
  if (bin === "open") {
    const ai = seg.indexOf("-a");
    const appName = ai >= 0 ? (seg[ai + 1] || "").replace(/\.app$/, "") : "";
    if (appName !== "Simulator") return null;
    const ui = seg.indexOf("-CurrentDeviceUDID");
    if (ui < 0) return null;
    return isDevice(seg[ui + 1]) ? null : "forbidden";
  }
  if (bin === "emulator" || bin === "emulator-headless") {
    return seg.some((t) => t === "-avd" || t.startsWith("@")) ? "forbidden" : null;
  }
  if (bin === "adb") {
    // Skip target selectors: -s <serial>, -e, -d, -t <id>, -H/-P with values.
    let i = 1;
    while (i < seg.length && seg[i].startsWith("-")) { if (["-s", "-t", "-H", "-P", "-L"].includes(seg[i])) i++; i++; }
    const sub = seg[i];
    if (sub === "emu" && seg[i + 1] === "kill") return "forbidden";
    if (sub === "install" || sub === "uninstall" || sub === "shell") return "phone";
    return null; // devices, logcat, version…
  }
  if (bin === "maestro") {
    const sub = subcommand(seg, MAESTRO_VALUE_FLAGS);
    return sub === "test" || sub === "record" || sub === "studio" ? "phone" : null; // cloud, --version, login…
  }
  if (bin === "flutter") {
    const sub = subcommand(seg, new Set(["-d", "--device-id"]));
    if (sub === "run" || sub === "drive" || sub === "install") return "phone";
    if (sub === "test") return seg.some((t) => t.includes("integration_test")) ? "phone" : null;
    return null; // build, analyze, pub, doctor…
  }
  if (bin === "patrol") {
    const sub = subcommand(seg, new Set(["-d", "--device", "-t", "--target"]));
    return sub === "test" || sub === "develop" ? "phone" : null;
  }
  return null; // dart, pod, gradle, npm run <script> (NOT seen through), everything else
}

/** Does this tool call touch the town's phone ("phone"), do something to the
 *  phone that only the town may do ("forbidden"), or neither (null)?
 *  Bash lines are matched anywhere in the command (`cd ios && flutter run -d X`
 *  counts); `npm run <script>` is NOT seen through. A forbidden segment wins
 *  over a phone segment in the same line. */
export function phoneMatch(toolName: string, toolInput: Record<string, unknown> | null | undefined, deviceId: string): PhoneVerdict {
  const input = toolInput || {};
  if (toolName === "Bash") {
    let phone = false;
    for (const seg of commandSegments(String(input.command ?? ""))) {
      const v = bashVerdict(seg, deviceId);
      if (v === "forbidden") return "forbidden";
      if (v === "phone") phone = true;
    }
    return phone ? "phone" : null;
  }
  if (toolName.startsWith("mcp__") && /maestro/i.test(toolName)) {
    // Local Maestro tools drive the phone; the cloud ones (run_on_cloud,
    // get_cloud_run_status, list_cloud_devices) never touch it.
    if (/__(run|take_screenshot|inspect_screen)$/.test(toolName)) return "phone";
  }
  return null;
}

/** The FIRST step of the PreToolUse hook, before the permission gate — kept pure
 *  so the check script can prove the order: the booth check runs BEFORE the
 *  bypass allow, so bypass mode still refuses forbidden commands and still queues
 *  phone work. "forbidden" → deny; "phone" → claim the booth, then the gate;
 *  "allow" → bypass allows everything else; "gate" → isSafe / ask Maksym. */
export function boothStep(toolName: string, toolInput: Record<string, unknown> | null | undefined, device: { id: string } | null, bypass: boolean): "forbidden" | "phone" | "allow" | "gate" {
  if (device) {
    const m = phoneMatch(toolName, toolInput, device.id);
    if (m) return m;
  }
  return bypass ? "allow" : "gate";
}

/** Why the booth let a holder go, so the caller can chalk the max-hold case. */
export type BoothRelease = { id: string; reason: "grace" | "maxHold" };

export interface BoothView { holder: string | null; since: number; queue: string[] }

/** The door: first come, first served. The holder keeps the phone while a phone
 *  command runs and for `graceSec` after its last one (so install → run → flow
 *  → screenshot is not interrupted), but only while someone is waiting; after
 *  `maxHoldMin` it is let go regardless. Never persisted: a relaunch starts empty. */
export class Booth {
  private holder: string | null = null;
  private since = 0;      // when the holder stepped in
  private touchedAt = 0;  // the holder's last phone activity (start or end of a command)
  private busy = 0;       // phone commands of the holder running right now
  private queue: { id: string; resolve: (r: "ok" | "left") => void }[] = [];
  private readonly graceMs: number;
  private readonly maxHoldMs: number;

  constructor(opts: { graceSec?: number; maxHoldMin?: number } = {}, private now: () => number = Date.now) {
    this.graceMs = (opts.graceSec ?? DEFAULT_GRACE_SEC) * 1000;
    this.maxHoldMs = (opts.maxHoldMin ?? DEFAULT_MAX_HOLD_MIN) * 60_000;
  }

  /** Step in, or wait outside the door. Resolves "ok" when it is yours (at once
   *  for the holder — re-entry — or when the phone is free), "left" if the
   *  character was abandoned while queued (its job ended). */
  claim(id: string): Promise<"ok" | "left"> {
    if (this.holder === id) return Promise.resolve("ok");
    if (!this.holder) { this.take(id); return Promise.resolve("ok"); }
    return new Promise((resolve) => this.queue.push({ id, resolve }));
  }

  /** A phone command of the holder is starting (the grace clock waits for it). */
  begin(id: string): void { if (this.holder === id) { this.busy++; this.touchedAt = this.now(); } }

  /** The holder just used the phone (a command finished): the grace clock starts. */
  touch(id: string): void {
    if (this.holder !== id) return;
    if (this.busy > 0) this.busy--;
    this.touchedAt = this.now();
  }

  /** Hang up. A non-holder releasing is a no-op. */
  release(id: string): void {
    if (this.holder !== id) return;
    this.holder = null; this.since = 0; this.touchedAt = 0; this.busy = 0;
    this.next();
  }

  /** Take a waiting character out of the queue and tell its hook ("left") — a
   *  dangling promise would hang the CLI's hook request until the timeout. */
  abandon(id: string): void {
    const mine = this.queue.filter((q) => q.id === id);
    if (!mine.length) return;
    this.queue = this.queue.filter((q) => q.id !== id);
    for (const q of mine) q.resolve("left");
  }

  /** The ticker's job: let the holder go when (a) someone is queued, no phone
   *  command is running and the last touch is older than the grace, or (b) the
   *  hold is older than the cap. Returns who was released and why, or null. */
  settle(now: number = this.now()): BoothRelease | null {
    if (!this.holder) return null;
    const id = this.holder;
    if (now - this.since >= this.maxHoldMs) { this.release(id); return { id, reason: "maxHold" }; }
    if (this.queue.length && this.busy === 0 && now - this.touchedAt >= this.graceMs) { this.release(id); return { id, reason: "grace" }; }
    return null;
  }

  view(): BoothView {
    const queue: string[] = [];
    for (const q of this.queue) if (!queue.includes(q.id)) queue.push(q.id);
    return { holder: this.holder, since: this.since, queue };
  }

  isEmpty(): boolean { return !this.holder && this.queue.length === 0; }

  private take(id: string): void {
    this.holder = id; this.since = this.now(); this.touchedAt = this.since; this.busy = 0;
  }

  private next(): void {
    const q = this.queue.shift();
    if (!q) return;
    this.take(q.id);
    q.resolve("ok");
    // The same character may have two phone calls waiting (parallel tool calls):
    // they are all its now.
    const rest = this.queue.filter((x) => x.id === q.id);
    this.queue = this.queue.filter((x) => x.id !== q.id);
    for (const r of rest) r.resolve("ok");
  }
}

/** One simulator as the "Add a town" phone picker lists it. */
export interface SimDevice { id: string; name: string; os: string; booted: boolean }

/** Turn `xcrun simctl list devices available -j` into picker lines, booted
 *  first, then by name. Never throws (bad JSON → []). */
export function parseSimctlDevices(json: string): SimDevice[] {
  let parsed: any;
  try { parsed = JSON.parse(json); } catch { return []; }
  const out: SimDevice[] = [];
  const devices = parsed && typeof parsed === "object" ? parsed.devices : null;
  if (!devices || typeof devices !== "object") return [];
  for (const [runtime, list] of Object.entries(devices as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    // "com.apple.CoreSimulator.SimRuntime.iOS-26-3" → "iOS 26.3"
    const m = /SimRuntime\.([A-Za-z]+)-(\d+)-(\d+)/.exec(runtime);
    const os = m ? `${m[1]} ${m[2]}.${m[3]}` : runtime;
    for (const d of list as any[]) {
      if (!d || typeof d.udid !== "string" || typeof d.name !== "string") continue;
      if (d.isAvailable === false) continue;
      out.push({ id: d.udid, name: d.name, os, booted: d.state === "Booted" });
    }
  }
  return out.sort((a, b) => Number(b.booted) - Number(a.booted) || a.name.localeCompare(b.name) || a.os.localeCompare(b.os));
}
