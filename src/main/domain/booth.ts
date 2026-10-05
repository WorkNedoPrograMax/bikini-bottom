// The Phone Booth: one door PER PHONE, shared in turns, with ONE waiting line.
// Behind the doors sit the town's test phones: the default one (an iPhone
// simulator, awake while the town is open) and, when the town has one, an
// Android emulator that sleeps until a job needs it — the TOWN wakes it, a
// character never boots anything. Characters build in parallel on their own
// copies; only a command that touches a phone (install, run, drive, Maestro
// flow, screenshot) walks to the booth. Maksym's routing rule (2026-10-05): take
// the iPhone if it is free, else the Android phone if it is free, else wait in
// the line and take whichever frees first. A command that can only run on one
// phone (xcrun/simctl, adb, --platform) waits for that phone. STRICT: a phone
// has one holder; nobody else's command touches it until the holder hangs up,
// goes quiet for the grace (10 min, while someone waits) or hits the cap — so a
// build cannot change under a tester (the 2026-10-04 complaint).
// PURE (no Electron, no timers of its own, the clock is injected) so
// scripts/check-booth.mjs can test it with plain node.

/** What the door guard makes of one tool call. */
export type PhoneVerdict = "phone" | "forbidden" | null;

export const FORBIDDEN_REASON = "The town runs the test phone. Never shut it down, wipe it, or boot another one — tell Maksym if it looks broken.";
export const LEFT_REASON = "Your job ended while waiting for the phone — this command was not run.";

// 2026-10-05: 60 → 600. A tester who edits a flow for three minutes between two
// phone commands must NOT lose the phone to a waiting lane (whose install then
// swaps the build under the test). With a door per phone the line is short, so
// a long grace costs little; `phone_done` hands the phone over at once.
export const DEFAULT_GRACE_SEC = 600;
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

/** Android emulators show up in `adb devices` as emulator-5554, emulator-5556… */
const EMULATOR_SERIAL = /^emulator-\d+$/;

function bashVerdict(seg: string[], ids: ReadonlySet<string>): PhoneVerdict {
  const bin = seg[0];
  const isDevice = (t: string | undefined): boolean => !!t && ids.has(t);
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
    // Booting ANY emulator is the town's job (it wakes its own Android phone
    // when a command needs it); `emulator -list-avds` is just a look.
    return seg.some((t) => t === "-avd" || t.startsWith("@")) ? "forbidden" : null;
  }
  if (bin === "avdmanager") {
    return seg.includes("delete") ? "forbidden" : null; // list / create are harmless
  }
  if (bin === "adb") {
    // Skip target selectors: -s <serial>, -e, -d, -t <id>, -H/-P with values.
    let i = 1;
    while (i < seg.length && seg[i].startsWith("-")) { if (["-s", "-t", "-H", "-P", "-L"].includes(seg[i])) i++; i++; }
    const sub = seg[i];
    if (sub === "emu" && seg[i + 1] === "kill") return "forbidden";
    if (sub === "reboot" || sub === "kill-server") return "forbidden";
    if (["install", "uninstall", "shell", "push", "pull", "exec-out", "root"].includes(sub || "")) return "phone";
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
    // `flutter emulators --launch <avd>` boots an emulator: the town's job, like
    // `emulator -avd`. A plain `flutter emulators` listing is just a look.
    if (sub === "emulators") return seg.some((t) => t === "--launch" || t.startsWith("--launch=")) ? "forbidden" : null;
    return null; // build, analyze, pub, doctor…
  }
  if (bin === "patrol") {
    const sub = subcommand(seg, new Set(["-d", "--device", "-t", "--target"]));
    return sub === "test" || sub === "develop" ? "phone" : null;
  }
  return null; // dart, pod, gradle, npm run <script> (NOT seen through), everything else
}

/** The town's phone ids: one id (the default phone alone) or every id the town
 *  has (default + Android AVD). Loose on purpose so each caller passes what it holds. */
export type PhoneIds = string | readonly string[];
const idSet = (ids: PhoneIds): ReadonlySet<string> => new Set(typeof ids === "string" ? [ids] : ids);

/** Does this tool call touch one of the town's phones ("phone"), do something
 *  to a phone that only the town may do ("forbidden"), or neither (null)?
 *  Bash lines are matched anywhere in the command (`cd ios && flutter run -d X`
 *  counts); `npm run <script>` is NOT seen through. A forbidden segment wins
 *  over a phone segment in the same line. */
export function phoneMatch(toolName: string, toolInput: Record<string, unknown> | null | undefined, phoneIds: PhoneIds): PhoneVerdict {
  const input = toolInput || {};
  const ids = idSet(phoneIds);
  if (toolName === "Bash") {
    let phone = false;
    for (const seg of commandSegments(String(input.command ?? ""))) {
      const v = bashVerdict(seg, ids);
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

/** Is this phone command aimed at the town's Android phone — so the town should
 *  wake the emulator before letting it run? True when the line talks to adb or
 *  the emulator, names the AVD or an emulator serial anywhere, gives "android"
 *  as its device, or a Maestro tool is handed an emulator serial. Pure; a plain
 *  iPhone command → false. */
export function wantsAndroid(toolName: string, toolInput: Record<string, unknown> | null | undefined, androidId: string): boolean {
  const input = toolInput || {};
  const DEVICE_FLAGS = ["-d", "--device", "--device-id", "--udid"];
  const isAndroidRef = (t: string | undefined): boolean => !!t && (t === androidId || EMULATOR_SERIAL.test(t) || t.toLowerCase() === "android");
  if (toolName === "Bash") {
    for (const seg of commandSegments(String(input.command ?? ""))) {
      const bin = seg[0];
      if (bin === "adb" || bin === "emulator" || bin === "emulator-headless") return true;
      for (let i = 1; i < seg.length; i++) {
        const t = seg[i];
        if (t === androidId || EMULATOR_SERIAL.test(t)) return true;
        if (DEVICE_FLAGS.includes(t) && isAndroidRef(seg[i + 1])) return true;
        const eq = t.indexOf("=");
        if (t.startsWith("--") && eq > 0 && DEVICE_FLAGS.includes(t.slice(0, eq)) && isAndroidRef(t.slice(eq + 1))) return true;
      }
    }
    return false;
  }
  if (toolName.startsWith("mcp__") && /maestro/i.test(toolName)) {
    const d = input.device_id ?? input.deviceId;
    return typeof d === "string" && (d === androidId || EMULATOR_SERIAL.test(d));
  }
  return false;
}

/** The FIRST step of the PreToolUse hook, before the permission gate — kept pure
 *  so the check script can prove the order: the booth check runs BEFORE the
 *  bypass allow, so bypass mode still refuses forbidden commands and still queues
 *  phone work. "forbidden" → deny; "phone" → claim the booth, then the gate;
 *  "allow" → bypass allows everything else; "gate" → isSafe / ask Maksym.
 *  `phones` is every phone id the town has (null when the town has no booth). */
export function boothStep(toolName: string, toolInput: Record<string, unknown> | null | undefined, phones: PhoneIds | null, bypass: boolean): "forbidden" | "phone" | "allow" | "gate" {
  if (phones && (typeof phones === "string" || phones.length)) {
    const m = phoneMatch(toolName, toolInput, phones);
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

/** The town's phone slots, in Maksym's preference order: iPhone first. */
export type PhoneKey = "ios" | "android";
export const PHONE_ORDER: readonly PhoneKey[] = ["ios", "android"];

/** Which phone a phone command is aimed at. `bound` = it can ONLY run there
 *  (xcrun/simctl, open -a Simulator, --platform ios, -d ios → iPhone; any adb /
 *  emulator / AVD / serial / -d android → Android). Not bound + want "ios" = it
 *  merely names the iPhone and may be re-aimed at the Android phone when the
 *  iPhone is busy. want null = names no phone at all. */
export interface PhoneTarget { want: PhoneKey | null; bound: boolean }
export function phoneTarget(toolName: string, toolInput: Record<string, unknown> | null | undefined, phones: { ios?: string; android?: string }): PhoneTarget {
  const input = toolInput || {};
  if (phones.android && wantsAndroid(toolName, toolInput, phones.android)) return { want: "android", bound: true };
  if (!phones.ios) return { want: phones.android ? "android" : null, bound: !!phones.android };
  const iosId = phones.ios;
  if (toolName === "Bash") {
    let names = false;
    for (const seg of commandSegments(String(input.command ?? ""))) {
      const bin = seg[0];
      if (bin === "xcrun" || bin === "simctl") return { want: "ios", bound: true };
      if (bin === "open" && seg.includes("-a") && seg.some((t) => t.replace(/\.app$/, "") === "Simulator")) return { want: "ios", bound: true };
      for (let i = 1; i < seg.length; i++) {
        const t = seg[i];
        if (t === iosId) names = true;
        const lower = t.toLowerCase();
        if ((lower === "--platform" || lower === "-p") && (seg[i + 1] || "").toLowerCase() === "ios") return { want: "ios", bound: true };
        if (lower === "--platform=ios" || lower === "-p=ios") return { want: "ios", bound: true };
        if ((lower === "-d" || lower === "--device-id" || lower === "--device") && (seg[i + 1] || "").toLowerCase() === "ios") return { want: "ios", bound: true };
        if (lower === "-d=ios" || lower === "--device-id=ios" || lower === "--device=ios") return { want: "ios", bound: true };
      }
    }
    return names ? { want: "ios", bound: false } : { want: null, bound: false };
  }
  if (toolName.startsWith("mcp__") && /maestro/i.test(toolName)) {
    const d = input.device_id ?? input.deviceId;
    if (d === iosId) return { want: "ios", bound: false };
    const plat = String(input.platform ?? "").toLowerCase();
    if (plat === "ios") return { want: "ios", bound: true };
  }
  return { want: null, bound: false };
}

/** What the switchboard answers a claim with. */
export type Granted = { r: "ok"; phone: PhoneKey } | { r: "left" };
export type BoardRelease = { id: string; phone: PhoneKey; reason: "grace" | "maxHold" | "hangUp" | "switch" };
export interface DoorView { phone: PhoneKey; holder: string | null; since: number }
export interface BoardView { doors: DoorView[]; queue: string[] }

interface Door { holder: string | null; since: number; touchedAt: number; busy: number }
interface Waiting { id: string; want: PhoneKey | null; resolve: (g: Granted) => void }

/** The switchboard: one door per phone, ONE line. A character holds at most one
 *  phone. claim(id, want): the held phone when it fits; else the first free
 *  phone in preference order (or the one wanted); else a place in the line,
 *  served first-come-first-served by whichever fitting door frees first. The
 *  holder keeps a phone while a phone command runs and for `graceSec` after
 *  its last one (only while someone who could use it waits); after `maxHoldMin`
 *  it is let go regardless. Never persisted: a relaunch starts empty. */
export class Switchboard {
  private doors = new Map<PhoneKey, Door>();
  private line: Waiting[] = [];
  private readonly graceMs: number;
  private readonly maxHoldMs: number;
  private released: BoardRelease[] = []; // what the last operation let go (for the caller's log)

  constructor(public readonly phones: readonly PhoneKey[], opts: { graceSec?: number; maxHoldMin?: number } = {}, private now: () => number = Date.now) {
    for (const k of phones) this.doors.set(k, { holder: null, since: 0, touchedAt: 0, busy: 0 });
    this.graceMs = (opts.graceSec ?? DEFAULT_GRACE_SEC) * 1000;
    this.maxHoldMs = (opts.maxHoldMin ?? DEFAULT_MAX_HOLD_MIN) * 60_000;
  }

  /** The phone this character holds, or null. */
  holding(id: string): PhoneKey | null {
    for (const [k, d] of this.doors) if (d.holder === id) return k;
    return null;
  }

  /** Step up to the switchboard. Resolves at once when a fitting phone is the
   *  character's already or free; otherwise when its turn comes ("left" if its
   *  job ended while it waited). Taking a different phone than the one held
   *  (a bound request) hands the held one back. */
  claim(id: string, want: PhoneKey | null): Promise<Granted> {
    const held = this.holding(id);
    if (held && (want === null || want === held)) return Promise.resolve({ r: "ok", phone: held });
    const candidates = want ? [want] : this.phones;
    for (const k of candidates) {
      const d = this.doors.get(k);
      if (d && !d.holder) { this.take(k, id); return Promise.resolve({ r: "ok", phone: k }); }
    }
    return new Promise((resolve) => this.line.push({ id, want, resolve }));
  }

  /** A phone command of the holder is starting (the grace clock waits for it). */
  begin(id: string): void { const k = this.holding(id); if (k) { const d = this.doors.get(k)!; d.busy++; d.touchedAt = this.now(); } }

  /** A phone command of the holder finished: the grace clock starts. */
  touch(id: string): void { const k = this.holding(id); if (k) { const d = this.doors.get(k)!; if (d.busy > 0) d.busy--; d.touchedAt = this.now(); } }

  /** Hang up (every phone this character holds). A non-holder is a no-op. */
  release(id: string, reason: BoardRelease["reason"] = "hangUp"): BoardRelease[] {
    const out: BoardRelease[] = [];
    for (const [k, d] of this.doors) {
      if (d.holder !== id) continue;
      d.holder = null; d.since = 0; d.touchedAt = 0; d.busy = 0;
      out.push({ id, phone: k, reason });
      this.fill(k);
    }
    return out;
  }

  /** Take a waiting character out of the line and tell its hook ("left"). */
  abandon(id: string): void {
    const mine = this.line.filter((w) => w.id === id);
    if (!mine.length) return;
    this.line = this.line.filter((w) => w.id !== id);
    for (const w of mine) w.resolve({ r: "left" });
  }

  /** The ticker's job: let a holder go when (a) someone who could use that
   *  phone waits, no phone command runs and the last touch is older than the
   *  grace, or (b) the hold is older than the cap. */
  settle(now: number = this.now()): BoardRelease[] {
    const out: BoardRelease[] = [];
    for (const [k, d] of this.doors) {
      if (!d.holder) continue;
      const id = d.holder;
      if (now - d.since >= this.maxHoldMs) { out.push(...this.release(id, "maxHold")); continue; }
      const wanted = this.line.some((w) => w.want === null || w.want === k);
      if (wanted && d.busy === 0 && now - d.touchedAt >= this.graceMs) out.push(...this.release(id, "grace"));
    }
    return out;
  }

  view(): BoardView {
    const queue: string[] = [];
    for (const w of this.line) if (!queue.includes(w.id)) queue.push(w.id);
    return { doors: this.phones.map((k) => { const d = this.doors.get(k)!; return { phone: k, holder: d.holder, since: d.since }; }), queue };
  }

  isEmpty(): boolean { return this.line.length === 0 && [...this.doors.values()].every((d) => !d.holder); }

  private take(k: PhoneKey, id: string): void {
    const prev = this.holding(id);
    const d = this.doors.get(k)!;
    d.holder = id; d.since = this.now(); d.touchedAt = d.since; d.busy = 0;
    // One phone per character: a bound switch hands the other one back.
    if (prev && prev !== k) { const pd = this.doors.get(prev)!; pd.holder = null; pd.since = 0; pd.touchedAt = 0; pd.busy = 0; this.fill(prev); }
  }

  /** A door just freed: serve the first in line who can use it, and every other
   *  waiting call of that same character that fits (parallel tool calls). */
  private fill(k: PhoneKey): void {
    const i = this.line.findIndex((w) => w.want === null || w.want === k);
    if (i < 0) return;
    const first = this.line[i];
    this.take(k, first.id);
    const mine = this.line.filter((w) => w.id === first.id && (w.want === null || w.want === k));
    this.line = this.line.filter((w) => !mine.includes(w));
    for (const w of mine) w.resolve({ r: "ok", phone: k });
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
