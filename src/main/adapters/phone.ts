// The town's phones: an Android emulator and an iPhone simulator that BOTH
// sleep until a job needs them (Maksym, 2026-10-15: no simulator at app start,
// only on first real use). The TOWN wakes a phone (a character may never boot a
// device, see domain/booth.ts): the lane hook calls wakeAndroid() / wakeIos()
// while the character holds the booth, and the command it was about to run goes
// ahead once the phone says it has booted. The town also puts a phone back to
// sleep (sleepAndroid() / sleepIos()) once nobody has held it for a while
// (Maksym, 2026-10-21: 10 minutes) — the lane engine's bedtime ticker decides
// when; a character never may. A wake that arrives mid-shutdown waits for the
// shutdown and then boots the phone again.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { log } from "../log";

/** Where the Android SDK lives: $ANDROID_HOME, $ANDROID_SDK_ROOT, or Android
 *  Studio's default on a Mac. */
export function androidSdk(): string {
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), "Library", "Android", "sdk");
}

/** The SDK's own binary when it is there, else whatever PATH offers. (On this
 *  Mac `adb` is on PATH via Homebrew but `emulator` is not.) */
function sdkBin(rel: string, fallback: string): string {
  const p = path.join(androidSdk(), ...rel.split("/"));
  return existsSync(p) ? p : fallback;
}
const adbBin = (): string => sdkBin("platform-tools/adb", "adb");
const emulatorBin = (): string => sdkBin("emulator/emulator", "emulator");

/** Run a tool and settle on its EXIT, not on its pipes closing: an adb client
 *  that finds no server forks one that inherits the pipes and lives on, so the
 *  usual execFile would wait forever (seen 2026-10-02 — the first wake test hung). */
const run = (cmd: string, args: string[], timeout = 20_000): Promise<{ ok: boolean; out: string; stdout: string }> =>
  new Promise((resolve) => {
    let out = "";
    let stdout = ""; // stdout alone, for callers that parse JSON (stderr noise kept out)
    let done = false;
    const finish = (ok: boolean): void => { if (done) return; done = true; setImmediate(() => resolve({ ok, out, stdout })); };
    let child: ReturnType<typeof spawn>;
    try { child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { out = String((e as Error).message || e); finish(false); return; }
    child.stdout?.on("data", (d) => { out += String(d); stdout += String(d); });
    child.stderr?.on("data", (d) => { out += String(d); });
    child.once("error", (e) => { out += String(e.message || e); finish(false); });
    child.once("exit", (code) => finish(code === 0));
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } out += ` (timed out after ${timeout} ms)`; finish(false); }, timeout);
    timer.unref?.();
  });

/** Make sure one adb server is up BEFORE any client call, with no pipe of ours
 *  to inherit. Once per process; again after a call timed out. */
let adbServerUp: Promise<void> | null = null;
function ensureAdbServer(): Promise<void> {
  if (adbServerUp) return adbServerUp;
  adbServerUp = new Promise<void>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(adbBin(), ["start-server"], { stdio: "ignore", detached: true }); } catch { resolve(); return; }
    // Kept ref'd on purpose: `adb start-server` exits as soon as the daemon is
    // up, and a plain node run (the check scripts, a probe) must not drain its
    // event loop and quit before that — unref here made the first probe exit
    // silently with code 0.
    const t = setTimeout(() => resolve(), 15_000);
    child.once("error", () => { clearTimeout(t); resolve(); });
    child.once("exit", () => { clearTimeout(t); resolve(); });
  });
  return adbServerUp;
}

/** Serials of the emulators adb currently sees as ready ("device", not "offline"). */
async function emulatorSerials(): Promise<string[]> {
  await ensureAdbServer();
  const r = await run(adbBin(), ["devices"]);
  if (!r.ok && /timed out/.test(r.out)) adbServerUp = null; // next call starts it again
  return r.out.split("\n").map((l) => l.trim()).filter((l) => /^emulator-\d+\s+device$/.test(l)).map((l) => l.split(/\s+/)[0]);
}

/** The serial (emulator-5554…) of the running emulator that IS this AVD, or
 *  null when it is not running. Another AVD running is not it. */
export async function androidSerial(avd: string): Promise<string | null> {
  for (const s of await emulatorSerials()) {
    const r = await run(adbBin(), ["-s", s, "emu", "avd", "name"]);
    const name = r.out.split("\n").map((x) => x.trim()).find((x) => x && x !== "OK");
    if (name === avd) return s;
  }
  return null;
}

async function bootCompleted(serial: string): Promise<boolean> {
  const r = await run(adbBin(), ["-s", serial, "shell", "getprop", "sys.boot_completed"]);
  return r.ok && r.out.trim() === "1";
}

export type WakeResult = { ok: boolean; serial: string | null; alreadyOn: boolean; detail: string };
export type SleepResult = { ok: boolean; alreadyOff: boolean; detail: string };

const inflight = new Map<string, Promise<WakeResult>>();
/** Shutdowns in flight, keyed like `inflight`. A wake waits for one; a sleep
 *  never starts while a wake runs (the phone was just woken for someone). */
const napping = new Map<string, Promise<SleepResult>>();

/** Wake the AVD if it is not running and wait until Android reports the boot
 *  complete (or give up after `timeoutMs`). Two lanes asking at once share one
 *  boot. Never throws. */
export function wakeAndroid(avd: string, timeoutMs = 180_000): Promise<WakeResult> {
  const cur = inflight.get(avd);
  if (cur) return cur;
  const p = wake(avd, timeoutMs).finally(() => inflight.delete(avd));
  inflight.set(avd, p);
  return p;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function wake(avd: string, timeoutMs: number): Promise<WakeResult> {
  await napping.get(avd); // a shutdown in progress finishes first; then we boot again
  const started = Date.now();
  try {
    const serial = await androidSerial(avd);
    if (serial && await bootCompleted(serial)) return { ok: true, serial, alreadyOn: true, detail: "already awake" };
    if (!serial) {
      // Detached: the emulator outlives this process and is never our child to
      // kill. A snapshot boot (the default) is the fast path.
      const child = spawn(emulatorBin(), ["-avd", avd, "-no-boot-anim"], { detached: true, stdio: "ignore" });
      const spawnError = await new Promise<string | null>((resolve) => {
        child.once("error", (e) => resolve(String((e as Error).message || e)));
        child.once("spawn", () => resolve(null));
      });
      child.unref();
      if (spawnError) {
        log("booth", "android emulator could not be started", { avd, error: spawnError.slice(0, 160) });
        return { ok: false, serial: null, alreadyOn: false, detail: `the emulator binary did not start (${spawnError.slice(0, 80)})` };
      }
      log("booth", "android emulator starting", { avd, bin: emulatorBin() });
    }
    while (Date.now() - started < timeoutMs) {
      await sleep(3_000);
      const s = await androidSerial(avd);
      if (s && await bootCompleted(s)) {
        log("booth", "android phone awake", { avd, serial: s, afterSec: Math.round((Date.now() - started) / 1000) });
        return { ok: true, serial: s, alreadyOn: false, detail: "booted" };
      }
    }
    log("booth", "android phone did not wake in time", { avd, afterSec: Math.round(timeoutMs / 1000) });
    return { ok: false, serial: null, alreadyOn: false, detail: `no boot after ${Math.round(timeoutMs / 1000)} s` };
  } catch (e) {
    return { ok: false, serial: null, alreadyOn: false, detail: String((e as Error)?.message || e).slice(0, 120) };
  }
}

/** Put the AVD to sleep: `adb emu kill` on its serial (the emulator saves its
 *  quick-boot snapshot on the way out, so the next wake is the fast path), then
 *  wait until adb no longer lists it (or give up after `timeoutMs`). Never throws. */
export function sleepAndroid(avd: string, timeoutMs = 60_000): Promise<SleepResult> {
  const cur = napping.get(avd);
  if (cur) return cur;
  const p = nap(avd, timeoutMs).finally(() => napping.delete(avd));
  napping.set(avd, p);
  return p;
}

async function nap(avd: string, timeoutMs: number): Promise<SleepResult> {
  const started = Date.now();
  try {
    const waking = inflight.get(avd);
    if (waking) { await waking; return { ok: false, alreadyOff: false, detail: "it was being woken for someone" }; }
    const serial = await androidSerial(avd);
    if (!serial) return { ok: true, alreadyOff: true, detail: "already off" };
    const r = await run(adbBin(), ["-s", serial, "emu", "kill"]);
    // Settle on what adb SEES, not on the kill's exit code (some emulator
    // builds answer the console goodbye with a non-zero status).
    while (Date.now() - started < timeoutMs) {
      await sleep(2_000);
      if (!(await androidSerial(avd))) {
        log("booth", "android phone asleep", { avd, serial, afterSec: Math.round((Date.now() - started) / 1000) });
        return { ok: true, alreadyOff: false, detail: "shut down" };
      }
    }
    const detail = `still running after ${Math.round(timeoutMs / 1000)} s (${(r.out.trim().split("\n").pop() || "no answer from adb").slice(0, 80)})`;
    log("booth", "android phone would not sleep", { avd, serial, detail });
    return { ok: false, alreadyOff: false, detail };
  } catch (e) {
    return { ok: false, alreadyOff: false, detail: String((e as Error)?.message || e).slice(0, 120) };
  }
}

// ---- The iPhone: a simulator with the same sleep/wake life as the Android
// phone above. Booting one cold takes ~30–60 s; a booted one answers at once.

/** The UDIDs simctl reports as Booted right now. A simctl failure or bad JSON
 *  reads as "none booted" (a wake then tries to boot and reports what simctl says). */
async function bootedSims(): Promise<Set<string>> {
  const out = new Set<string>();
  const r = await run("xcrun", ["simctl", "list", "devices", "-j"]);
  if (!r.ok) return out;
  try {
    const parsed = JSON.parse(r.stdout) as { devices?: Record<string, { udid?: string; state?: string }[]> };
    for (const list of Object.values(parsed.devices ?? {})) for (const d of list) if (d.udid && d.state === "Booted") out.add(d.udid);
  } catch { /* not json — treat as none */ }
  return out;
}

/** Is this simulator booted right now? An unknown UDID or a simctl failure
 *  counts as off. */
export async function iosBooted(udid: string): Promise<boolean> {
  return (await bootedSims()).has(udid);
}

/** Shut the simulator down (`simctl shutdown`) and, when no simulator is left
 *  booted, close the Simulator window too — otherwise it would sit there
 *  showing a dark phone. A simulator Maksym booted by hand keeps the window.
 *  Never throws. */
export function sleepIos(udid: string, timeoutMs = 60_000): Promise<SleepResult> {
  const key = `ios:${udid}`;
  const cur = napping.get(key);
  if (cur) return cur;
  const p = napSim(udid, timeoutMs).finally(() => napping.delete(key));
  napping.set(key, p);
  return p;
}

async function napSim(udid: string, timeoutMs: number): Promise<SleepResult> {
  const started = Date.now();
  try {
    const waking = inflight.get(`ios:${udid}`);
    if (waking) { await waking; return { ok: false, alreadyOff: false, detail: "it was being woken for someone" }; }
    if (!(await iosBooted(udid))) return { ok: true, alreadyOff: true, detail: "already off" };
    const r = await run("xcrun", ["simctl", "shutdown", udid], timeoutMs);
    const left = await bootedSims();
    if (left.has(udid)) {
      const detail = (/timed out/.test(r.out) ? `no shutdown after ${Math.round(timeoutMs / 1000)} s` : (r.out.trim().split("\n").pop() || "simctl could not shut it down")).slice(0, 120);
      log("booth", "iphone would not sleep", { udid, detail });
      return { ok: false, alreadyOff: false, detail };
    }
    // SIGTERM, not AppleScript: an Electron app sending Apple Events would pop
    // macOS's "wants to control Simulator" consent dialog the first time.
    const window = left.size ? "left up (another simulator is booted)" : ((await run("pkill", ["-x", "Simulator"])).ok ? "closed" : "was not open");
    log("booth", "iphone asleep", { udid, afterSec: Math.round((Date.now() - started) / 1000), window });
    return { ok: true, alreadyOff: false, detail: "shut down" };
  } catch (e) {
    return { ok: false, alreadyOff: false, detail: String((e as Error)?.message || e).slice(0, 120) };
  }
}

/** Boot the simulator if it is not booted and wait until iOS is up (or give up
 *  after `timeoutMs`); on a cold boot also bring the Simulator window up so
 *  there is something to look at. Two lanes asking at once share one boot.
 *  Never throws; `serial` carries the UDID. */
export function wakeIos(udid: string, timeoutMs = 180_000): Promise<WakeResult> {
  const key = `ios:${udid}`;
  const cur = inflight.get(key);
  if (cur) return cur;
  const p = wakeSim(udid, timeoutMs).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function wakeSim(udid: string, timeoutMs: number): Promise<WakeResult> {
  await napping.get(`ios:${udid}`); // a shutdown in progress finishes first; then we boot again
  const started = Date.now();
  try {
    if (await iosBooted(udid)) return { ok: true, serial: udid, alreadyOn: true, detail: "already awake" };
    log("booth", "iphone simulator starting", { udid });
    // `bootstatus -b` boots the device when it is off and returns once iOS has
    // finished booting — the one call that both starts and waits.
    const r = await run("xcrun", ["simctl", "bootstatus", udid, "-b"], timeoutMs);
    if (!r.ok && !(await iosBooted(udid))) {
      const detail = /timed out/.test(r.out) ? `no boot after ${Math.round(timeoutMs / 1000)} s` : (r.out.trim().split("\n").pop() || "simctl could not boot it").slice(0, 120);
      log("booth", "iphone did not wake", { udid, detail });
      return { ok: false, serial: null, alreadyOn: false, detail };
    }
    // The window, only on a cold boot: re-opening it on every phone grant would
    // steal Maksym's focus each time a character takes the phone.
    const open = await run("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", udid]);
    log("booth", "iphone awake", { udid, afterSec: Math.round((Date.now() - started) / 1000), window: open.ok ? "up" : `not up: ${open.out.slice(0, 120)}` });
    return { ok: true, serial: udid, alreadyOn: false, detail: "booted" };
  } catch (e) {
    return { ok: false, serial: null, alreadyOn: false, detail: String((e as Error)?.message || e).slice(0, 120) };
  }
}
