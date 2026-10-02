// The town's Android phone: an emulator that sleeps until a job needs it. The
// TOWN wakes it (a character may never boot a device, see domain/booth.ts): the
// lane hook calls wakeAndroid() while the character holds the booth, and the
// command it was about to run goes ahead once Android says it has booted.
// Nothing here ever shuts an emulator down.
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
const run = (cmd: string, args: string[], timeout = 20_000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (ok: boolean): void => { if (done) return; done = true; setImmediate(() => resolve({ ok, out })); };
    let child: ReturnType<typeof spawn>;
    try { child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { out = String((e as Error).message || e); finish(false); return; }
    child.stdout?.on("data", (d) => { out += String(d); });
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

const inflight = new Map<string, Promise<WakeResult>>();

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
