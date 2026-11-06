// Electron main process — the authoritative half (AD-1). Owns the event log,
// the app config, First Run, and derives the snapshot pushed to the renderer.
// The renderer never touches fs/git/SDK; it renders what it's handed (AD-4).

import { app, BrowserWindow, ipcMain, dialog, Notification, nativeImage, powerSaveBlocker, shell } from "electron";
import path from "node:path";
import { execFile } from "node:child_process";
import { EventLog } from "./domain/eventLog";
import { fold, emptyTown, visibleOnStreet } from "./domain/snapshot";
import { ROSTER, REVIEWER_IDS } from "./config/roster";
import { TelegramBridge, type TgButton, type TgTextCtx } from "./adapters/telegram";
import { TgThreads, routeReply, type TgThread } from "./domain/tgThreads";
import { AppConfig } from "./config/appConfig";
import { prepareProject } from "./adapters/git";
import { checkClaude, clearStrayApiKey } from "./adapters/claude";
import { resolvePicture, resolveBackground, resolveSound, resolveFace, resolveHelperIcon, resolveMailPictures, resolveMailSound } from "./adapters/assets";
import { mailLines, forYouCount, newPings, pingKey, mergeRefusal, briefFor, markOnIt, inferOnIt, canTake, type GhThread } from "./domain/mail";
import { ghLogin, repoOf, fetchPulls, viewPull, mergePull as ghMergePull, requestReview, branchAt } from "./adapters/pulls";
import { JiraClient } from "./adapters/jira";
import { jiraLines, jiraForYou, newJiraPings, plateCounts, projectFromLifecycle, ticketKeyOf, moveAfterMerge, sweepBrief, markJiraOnIt, canHandJira, townForTicket, jiraBrief, type JiraRawIssue, type JiraRawComment } from "./domain/jira";
import { LaneManager, type AdoptionSupport } from "./adapters/lane";
import { PointerManager } from "./adapters/pointer/manager";
import { TerminalManager, listClaudeSessions } from "./adapters/terminal";
import { defaultName, loadProfile, seedProfile, serializeProfile, profilePath, laneAdoption, townTabsFor, type TownProfile, type DeviceSpec } from "./config/townProfile";
import { parseSimctlDevices } from "./domain/booth";
import { androidSerial, iosBooted } from "./adapters/phone";
import { seedSetup } from "./domain/laneSetup";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { initLog, log } from "./log";
import { startCacheProxy } from "./cacheProxy";
import { CHANNELS, EMPTY_JOB_STATS, EMPTY_FUEL, type Intent, type FirstRunView, type TownSnapshot, type WindowView, type CharacterId, type CharacterState, type Fuel, type FuelSign, type Gauge, type Attention, type OrderStatus, type TownTab, type AddingTown, type BoothView, type MailView, type MailLine, type JiraView, type JiraLine } from "../shared/ipc";
import { fmtClock, fmtWhen, fuelWord, fuelStale, previewOf } from "./adapters/guards";

const IDLE_PREP = { status: "idle" as const, message: "" };
const IDLE_CLAUDE = { status: "idle" as const, message: "" };
const IDLE_NOTIFY = { choice: "none" as const, message: "" };

const SMOKE = process.env.BIKINI_SMOKE === "1";

// Terminal-mode characters. The A/B experiment (squid = embedded `claude` CLI)
// concluded: the terminal isn't cheaper (same model, same per-step cost) and it
// caused real friction (session loss on restart, Past-orders tangle). Maksym's
// call: drop it. Empty set → EVERY character is a normal SDK chat (bob/pat/squid
// all identical). The terminal code stays dormant, unused. (squid's old terminal
// transcripts remain on disk under ~/.claude/projects/…-sr-squid/ if ever needed.)
const TERMINAL_IDS = new Set<CharacterId>();

// A job handed to a terminal char from Krasy Krab before its terminal exists.
// Held until the renderer mounts the xterm and sends term:open, so the pty is
// spawned WITH the job (nothing spawns before the view can receive its output).
const pendingTermJob: Partial<Record<CharacterId, string>> = {};

let win: BrowserWindow | null = null;
let cfg: AppConfig;
let projectLog: EventLog | null = null;
let lanes: LaneManager | null = null;
let terminals: TerminalManager | null = null;
let openWindowId: CharacterId | null = null;
let firstRun: FirstRunView | null = null;
let muted = false;
// "Point at it" (Orca plan, Job 5): the engine + tray manager, one lane at a time.
let pointer: PointerManager | null = null;
// The shown town's adoption table (where each lane's app runs), for the pointer's URL.
let adoptSupport: AdoptionSupport | null = null;

// ───────────── The Ferry: one town per project ─────────────
// Every project is its own town with its own event log, lane engine and profile.
// ALL towns are open (cooking) at once; only one is on the street. The module
// globals above (lanes / projectLog / terminals / adoptSupport) are "the shown
// town's objects" — showTown() swaps them, so their 100+ readers stay as they are.
interface Town { path: string; profile: TownProfile; log: EventLog; lanes: LaneManager; terminals: TerminalManager; adopt: AdoptionSupport | null }
const towns = new Map<string, Town>();
/** Towns whose folder could not be opened this launch (path → sign name): kept
 *  in the dropdown greyed as "folder missing", never dropped from the config. */
const missingTowns = new Map<string, string>();
let currentTownPath: string | null = null;
/** The "Add a town" card, while it is up (NOT First Run — that is over). */
let addingTown: AddingTown | null = null;

/** A town's sign name, whether it is open, missing, or merely a path. */
function townNameOf(townPath: string | null): string {
  if (!townPath) return "";
  return towns.get(townPath)?.profile.name ?? missingTowns.get(townPath) ?? defaultName(townPath);
}

async function seedTownIfEmpty(log: EventLog): Promise<void> {
  // An existing town registers only the roster entries it does not have yet
  // (Karen joined on 2026-11-06; the towns' logs predate her).
  const have = new Set(fold(log.all()).characters.map((c) => c.id));
  for (const c of ROSTER) {
    if (have.has(c.id)) continue;
    await log.append({
      type: "CharacterRegistered",
      id: c.id, name: c.name, role: c.role, accent: c.accent, pos: c.pos, isHomeBase: c.isHomeBase,
    });
  }
}

/** Open one town (project): its profile, event log, lane engine and terminals
 *  (everything lives in <project>/.bikini, AD-9). Callbacks are bound to THIS
 *  town's path, so a finish in a town that is not on screen still knows where it
 *  happened. Throws when the folder is gone — the caller keeps it listed as missing. */
async function openTown(projectPath: string): Promise<Town> {
  if (!existsSync(projectPath)) throw new Error("folder missing");
  // The profile: read <project>/.bikini/town.json, or seed + write it the first
  // time this build opens the town (Scout & Runner gets its three lanes here —
  // the table that used to live in code). .bikini is git-ignored: ports stay local.
  let profile = loadProfile(projectPath, (f) => readFileSync(f, "utf8"));
  if (!profile) {
    profile = seedProfile(projectPath);
    const setup = seedSetup((rel) => existsSync(path.join(projectPath, rel)));
    if (setup) profile.setup = setup;
    try {
      mkdirSync(path.dirname(profilePath(projectPath)), { recursive: true });
      writeFileSync(profilePath(projectPath), serializeProfile(profile), "utf8");
      log("town", "profile seeded", { projectPath, name: profile.name, lanes: Object.keys(profile.lanes || {}) });
    } catch (e) { log("town", "profile could not be written — using the seed in memory", { projectPath, error: String(e) }); }
  }
  const townLog = new EventLog(path.join(projectPath, ".bikini"));
  await townLog.load();
  await seedTownIfEmpty(townLog);
  // Adopted lanes (S&R): a character labels an existing lane; git untouched.
  const adopt: AdoptionSupport | null = laneAdoption(projectPath, profile);
  const townLanes = new LaneManager(projectPath, townLog, onLaneChange,
    (id, summary) => fireFinishNotification(projectPath, id, summary),
    (id, kind) => emitSoundCue(projectPath, id, kind),
    () => cfg.data.bypassPermissions, adopt,
    // One account, one fuel file: two towns sharing it is fine (same numbers).
    { fuelFile: path.join(app.getPath("userData"), "fuel.json"), onFuelWarning, onGitHubWrite: (id) => nudgeMail(projectPath, id) },
    profile.landing, profile.device ?? null, profile.setup ?? null, profile.android ?? null);
  // The Phone Booth: only LOOK at the town's phones on open — the iPhone and the
  // Android phone both sleep until a job aims a command at one, then the town
  // wakes it from the lane hook (Maksym, 2026-10-15: no simulator at app start,
  // only on first real use). Best effort, never blocks the town, never boots
  // or shuts anything down here — a phone found awake starts its bedtime clock
  // and the lane engine puts it to sleep after 10 unused minutes (2026-10-21).
  if (profile.device) void checkPhones(profile.device, profile.android ?? null, townLanes);
  // Real-terminal characters: the actual `claude` CLI in the lane worktree.
  // onData/onExit stream straight to the renderer's xterm. (TERMINAL_IDS is empty.)
  const townTerminals = new TerminalManager(
    (id) => townLanes.worktreeDir(id),
    (id, data) => { if (winAlive()) win!.webContents.send(CHANNELS.termData, { id, data }); },
    (id, code) => { if (winAlive()) win!.webContents.send(CHANNELS.termExit, { id, code }); },
    (id, kind) => emitSoundCue(projectPath, id, kind),
    (id, state) => onTerminalState(projectPath, id, state),
  );
  const town: Town = { path: projectPath, profile, log: townLog, lanes: townLanes, terminals: townTerminals, adopt };
  towns.set(projectPath, town);
  missingTowns.delete(projectPath);
  log("project", "opened", { projectPath, town: profile.name, landing: profile.landing, adoption: adopt ? Object.keys(profile.lanes || {}) : null, terminalChars: [...TERMINAL_IDS] });
  // The Mailbox: pull requests on this town's GitHub repo (best effort, never blocks the town).
  void startMail(projectPath, profile);
  // Its Jira page: the project's tickets, with the token from the settings (best effort too).
  void startJira(projectPath, profile);

  // Resume (AD-11, NFR-1): any Character left mid-cook when the app quit is
  // paused — flip its dot on and offer Keep cooking / Scrap.
  const events = townLog.all();
  for (const c of fold(events).characters) {
    // Terminal chars have no persistent SDK lane — their pty is gone after a
    // restart, so start them clean at idle (not "paused").
    if (TERMINAL_IDS.has(c.id)) {
      if (c.state !== "idle") await townLog.append({ type: "CharacterStateChanged", id: c.id, state: "idle" });
      continue;
    }
    // "Calling" with a saved open question = he was WAITING ON AN ANSWER, which
    // is mid-cook too (the question died with the session). Plain "calling"
    // (a finished result) stays as it is.
    const lost = c.state === "calling" ? townLanes.lostQuestion(c.id) : null;
    if (c.state === "working" || lost) {
      const last = [...events].reverse().find((e) => e.type === "JobHandedOut" && e.id === c.id);
      townLanes.markPaused(c.id, last && last.type === "JobHandedOut" ? last.prompt : null, lost);
      if (lost) log("lane", `${c.id} relaunched mid-question — paused, keep cooking offered`, { question: lost.slice(0, 100) });
      await townLog.append({ type: "CharacterStateChanged", id: c.id, state: "calling" });
    }
  }
  return town;
}

/** Look at the town's phones on open — never boot one: is the iPhone simulator
 *  booted, is the Android emulator running? The street tags a sleeping phone
 *  "asleep"; the first job that needs it wakes it (LaneManager.ensurePhone). */
async function checkPhones(dev: DeviceSpec, android: DeviceSpec | null, townLanes: LaneManager): Promise<void> {
  if (android) {
    const serial = await androidSerial(android.id);
    log("booth", serial ? "android phone already awake" : "android phone asleep (wakes when a job needs it)", { avd: android.id, serial });
    townLanes.setAndroidOn(!!serial);
  }
  if (dev.kind === "ios-simulator") {
    const on = await iosBooted(dev.id);
    log("booth", on ? "iphone already awake" : "iphone asleep (wakes when a job needs it)", { id: dev.id, name: dev.name });
    townLanes.setIosOn(on);
  } else {
    // An Android default phone: looked at, like the second phone above.
    const serial = await androidSerial(dev.id);
    log("booth", serial ? "phone already awake" : "phone asleep (wakes when a job needs it)", { avd: dev.id, name: dev.name, serial });
    townLanes.setAndroidOn(!!serial);
  }
}

/** Put a town on the street. The module globals become THAT town's objects, so
 *  everything that reads `lanes`/`projectLog` means "the shown town". Any open
 *  window, pointer view or past view closes first. Nothing is stopped: the town
 *  you leave keeps cooking; its finishes still ring (named) and mark the sign. */
function showTown(projectPath: string): void {
  const t = towns.get(projectPath);
  if (!t) return;
  if (currentTownPath !== projectPath) {
    pointer?.close();
    if (openWindowId && openWindowId !== "krabs" && lanes) lanes.closePast(openWindowId);
    openWindowId = null;
    currentTownPath = projectPath;
    projectLog = t.log; lanes = t.lanes; terminals = t.terminals; adoptSupport = t.adopt;
    log("town", "shown", { projectPath, name: t.profile.name });
    if (cfg.data.projectPath !== projectPath) void cfg.save({ projectPath });
  }
  pushSnapshot();
}

/** The switcher's lines, one per known town, from EACH town's own fold. */
function townTabs(): TownTab[] {
  const inputs = cfg.data.towns.map(({ path: p }) => {
    const t = towns.get(p);
    if (!t) return { path: p, name: townNameOf(p), missing: true, characters: [] };
    return { path: p, name: t.profile.name, characters: fold(t.log.all()).characters };
  });
  const tabs = townTabsFor(inputs, currentTownPath);
  for (const t of tabs) { const n = forYouCount(mails.get(t.path)?.lines ?? []); if (n) t.mail = n; const j = jiraOf(t.path); if (j && jiraForYou(j.lines)) t.jira = jiraForYou(j.lines); }
  return tabs;
}

// ───────────── The Mailbox: pull requests on the team repo ─────────────
// One per town with a GitHub remote. Reads GitHub through `gh` every couple of
// minutes (adapters/pulls), words the answers (domain/mail), and remembers which
// "needs you" lines the phone was already told about (<project>/.bikini/mail-pings.json).
interface TownMail {
  repo: string; me: string; everySec: number; merge: "squash" | "merge";
  /** The lines as GitHub says them, before "X is on it" is painted on. */
  raw: MailLine[];
  lines: MailLine[]; threads: Record<number, GhThread[]>;
  checkedAt: number; error: string | null;
  timer: ReturnType<typeof setInterval> | null; busy: boolean;
  pinged: Set<string>; merging: number | null;
  /** The last merge the guard refused (PR number + why), until it is handed
   *  off, merged, or goes clean. */
  refused: { number: number; reason: string } | null;
  /** A re-read a few seconds after a character wrote to GitHub (debounced). */
  nudge: ReturnType<typeof setTimeout> | null;
  /** PR number → the character cooking it (handed from the paper). */
  onIt: Map<number, { characterId: CharacterId; name: string; since: number }>;
}
const mails = new Map<string, TownMail>();

function onItFile(townPath: string): string { return path.join(townPath, ".bikini", "mail-on-it.json"); }
function loadOnIt(townPath: string): TownMail["onIt"] {
  const out: TownMail["onIt"] = new Map();
  try {
    const a = JSON.parse(readFileSync(onItFile(townPath), "utf8"));
    if (Array.isArray(a)) for (const e of a) if (e && typeof e.number === "number" && typeof e.characterId === "string") out.set(e.number, { characterId: e.characterId, name: String(e.name || tgName(e.characterId)), since: Number(e.since) || Date.now() });
  } catch { /* none yet */ }
  return out;
}
function saveOnIt(townPath: string, m: TownMail): void {
  try { writeFileSync(onItFile(townPath), JSON.stringify([...m.onIt].map(([number, o]) => ({ number, ...o }))) + "\n", "utf8"); } catch (e) { log("mail", "on-it not saved", { error: String(e) }); }
}
/** The paper's lines with "X is on it" applied — from the paper's own hand-offs
 *  AND from what the lanes are really doing (a cooking character whose lane is
 *  on the PR's branch). A hand-off mark whose character has stopped cooking
 *  (finished, or the app restarted mid-job) is dropped. */
async function decorateMail(townPath: string, m: TownMail, lines: MailLine[]): Promise<MailLine[]> {
  const L = lanesOf(townPath);
  const working = (id: string) => L?.isWorking(id as CharacterId) ?? false;
  let dropped = false;
  for (const [n, o] of m.onIt) if (!working(o.characterId)) { m.onIt.delete(n); dropped = true; }
  if (dropped) saveOnIt(townPath, m);
  const lanes: { characterId: string; name: string; branch: string | null; working: boolean; since: number }[] = [];
  if (L) for (const r of ROSTER) {
    if (r.isHomeBase || TERMINAL_IDS.has(r.id) || !L.isWorking(r.id)) continue;
    lanes.push({ characterId: r.id, name: r.name, branch: await branchAt(L.worktreeDir(r.id)), working: true, since: L.view(r.id).taskStartedAt || Date.now() });
  }
  return markOnIt(lines, inferOnIt(lines, lanes, m.onIt), working);
}
let ghMe: string | null | undefined; // Maksym's GitHub login (undefined = not asked yet)

function pingsFile(townPath: string): string { return path.join(townPath, ".bikini", "mail-pings.json"); }
function loadPinged(townPath: string): Set<string> {
  try { const a = JSON.parse(readFileSync(pingsFile(townPath), "utf8")); return new Set(Array.isArray(a) ? a.map(String) : []); } catch { return new Set(); }
}
function savePinged(townPath: string, set: Set<string>): void {
  try { writeFileSync(pingsFile(townPath), JSON.stringify([...set].slice(-400)) + "\n", "utf8"); } catch (e) { log("mail", "pings not saved", { error: String(e) }); }
}

// ───────────── The Jira page of the Mailbox ─────────────
// One board per Jira PROJECT, shared by every town that points at it (both
// highcap towns read HIGHCAP): one look, one set of pings, one "seen" state.
interface JiraBoard {
  project: string; me: string; meName: string;
  raw: { issues: JiraRawIssue[]; comments: Record<string, JiraRawComment[]> };
  lines: JiraLine[]; plate: { status: string; count: number }[]; open: number;
  checkedAt: number; error: string | null;
  timer: ReturnType<typeof setInterval> | null; busy: boolean;
  pinged: Set<string>; seen: Set<string>;
  /** A character sweeping this board (handed from the page), until it finishes. */
  sweeping: { characterId: CharacterId; name: string; since: number; townPath: string } | null;
  /** Notes handed to a character (line id → who), until that character finishes. Persisted. */
  onIt: Map<string, { characterId: CharacterId; name: string; since: number; townPath: string }>;
}
const jiras = new Map<string, JiraBoard>();
const townJira = new Map<string, string>(); // town path → project key
let jiraClient: JiraClient | null = null;
const JIRA_EVERY_SEC = 180;

function jiraStateFile(kind: "pings" | "seen" | "on-it", project: string): string { return path.join(app.getPath("userData"), `jira-${kind}-${project}.json`); }
function loadJiraOnIt(project: string): JiraBoard["onIt"] {
  const out: JiraBoard["onIt"] = new Map();
  try {
    const a = JSON.parse(readFileSync(jiraStateFile("on-it", project), "utf8"));
    if (Array.isArray(a)) for (const e of a) if (e && typeof e.id === "string" && typeof e.characterId === "string" && typeof e.townPath === "string") out.set(e.id, { characterId: e.characterId, name: String(e.name || tgName(e.characterId)), since: Number(e.since) || Date.now(), townPath: e.townPath });
  } catch { /* none yet */ }
  return out;
}
function saveJiraOnIt(b: JiraBoard): void {
  try { writeFileSync(jiraStateFile("on-it", b.project), JSON.stringify([...b.onIt].map(([id, o]) => ({ id, ...o }))) + "\n", "utf8"); } catch (e) { log("jira", "on-it not saved", { error: String(e) }); }
}
/** The lines with "X is on it" laid on: a mark whose character stopped cooking is dropped. */
function jiraLinesOf(b: JiraBoard): JiraLine[] {
  const working = (id: string) => [...b.onIt.values()].some((o) => o.characterId === id && (lanesOf(o.townPath)?.isWorking(o.characterId) ?? false));
  let dropped = false;
  for (const [id, o] of b.onIt) if (!(lanesOf(o.townPath)?.isWorking(o.characterId) ?? false)) { b.onIt.delete(id); dropped = true; }
  if (dropped) saveJiraOnIt(b);
  return markJiraOnIt(b.lines, b.onIt, working);
}
function loadJiraSet(kind: "pings" | "seen", project: string): Set<string> {
  try { const a = JSON.parse(readFileSync(jiraStateFile(kind, project), "utf8")); return new Set(Array.isArray(a) ? a.map(String) : []); } catch { return new Set(); }
}
function saveJiraSet(kind: "pings" | "seen", project: string, set: Set<string>): void {
  try { writeFileSync(jiraStateFile(kind, project), JSON.stringify([...set].slice(-600)) + "\n", "utf8"); } catch (e) { log("jira", `${kind} not saved`, { error: String(e) }); }
}
function jiraOf(townPath: string | null): JiraBoard | null { const k = townPath ? townJira.get(townPath) : null; return k ? jiras.get(k) ?? null : null; }
function jiraConfigured(): boolean { return !!(cfg.data.jiraEmail && cfg.data.jiraToken && cfg.data.jiraSite); }
function jiraSite(): string { return (cfg.data.jiraSite || "https://empat.atlassian.net").replace(/\/+$/, ""); }

/** Which Jira project a town's tickets live in: its profile, else the plugin's
 *  lifecycle config, else none (Rock Bottom has no Jira). */
function jiraProjectFor(townPath: string, profile: TownProfile): string | null {
  if (profile.jira?.off) return null;
  if (profile.jira?.project) return profile.jira.project;
  try { return projectFromLifecycle(JSON.parse(readFileSync(path.join(townPath, ".claude", "lifecycle", "config.json"), "utf8"))); } catch { return null; }
}

async function startJira(townPath: string, profile: TownProfile): Promise<void> {
  const project = jiraProjectFor(townPath, profile);
  if (!project) { log("jira", "no Jira project — no Jira page", { town: profile.name }); return; }
  townJira.set(townPath, project);
  if (jiras.has(project)) return; // another town already reads this board
  if (!jiraConfigured()) { log("jira", "no token yet — the page shows the paste box", { town: profile.name, project }); return; }
  if (!jiraClient) jiraClient = new JiraClient(jiraSite(), cfg.data.jiraEmail!, cfg.data.jiraToken!);
  let me: { accountId: string; displayName: string };
  try { me = await jiraClient.myself(); } catch (e: any) { log("jira", "token check failed", { project, error: String(e?.message || e) }); jiras.set(project, { project, me: "", meName: "", raw: { issues: [], comments: {} }, lines: [], plate: [], open: 0, checkedAt: 0, error: String(e?.message || e), timer: null, busy: false, pinged: new Set(), seen: new Set(), sweeping: null, onIt: new Map() }); pushSnapshot(); return; }
  const b: JiraBoard = { project, me: me.accountId, meName: me.displayName, raw: { issues: [], comments: {} }, lines: [], plate: [], open: 0, checkedAt: 0, error: null, timer: null, busy: false, pinged: loadJiraSet("pings", project), seen: loadJiraSet("seen", project), sweeping: null, onIt: loadJiraOnIt(project) };
  jiras.set(project, b);
  log("jira", "board up", { project, me: me.displayName, everySec: JIRA_EVERY_SEC });
  await pollJira(project);
  b.timer = setInterval(() => void pollJira(project), JIRA_EVERY_SEC * 1000);
}

/** Lines from the last raw answer (after a look, or after Maksym looked at the page). */
function relineJira(b: JiraBoard): void {
  b.lines = jiraLines({ issues: b.raw.issues, comments: b.raw.comments, me: b.me, now: Date.now(), seen: b.seen, site: jiraSite() });
  b.plate = plateCounts(b.raw.issues, b.me);
  b.open = b.raw.issues.filter((i) => (i.fields.assignee?.accountId || "") === b.me).length;
}

/** One look at Jira: tickets + comments → lines. New "for you" lines ring and ping, once each. */
async function pollJira(project: string): Promise<void> {
  const b = jiras.get(project);
  if (!b || b.busy || !jiraClient) return;
  b.busy = true; pushSnapshot();
  try {
    b.raw = await jiraClient.board(project, b.me);
    relineJira(b);
    b.checkedAt = Date.now(); b.error = null;
    const fresh = newJiraPings(jiraLinesOf(b), b.pinged);
    if (fresh.length) {
      for (const l of fresh) b.pinged.add(l.id);
      saveJiraSet("pings", project, b.pinged);
      log("jira", "new notes for Maksym", { project, lines: fresh.map((l) => `${l.key} ${l.word}`) });
      if (winAlive()) win!.webContents.send(CHANNELS.sound, { characterId: "krabs", kind: "mail", url: resolveMailSound(SOUNDS_DIR) });
      notifyTgJira(project, fresh);
    }
  } catch (e: any) {
    b.error = e?.message || String(e);
    log("jira", "look at Jira failed", { project, error: b.error });
  } finally { b.busy = false; }
  pushSnapshot();
}

/** Maksym looked at the page: everything on it is seen — the flag drops. */
function jiraSeenNow(townPath: string | null): void {
  const b = jiraOf(townPath);
  if (!b) return;
  let changed = false;
  for (const l of b.lines) if (l.forYou && !b.seen.has(l.id)) { b.seen.add(l.id); changed = true; }
  if (!changed) return;
  saveJiraSet("seen", b.project, b.seen);
  relineJira(b);
  pushSnapshot();
}

function jiraViewFor(townPath: string | null, chars: TownSnapshot["characters"]): JiraView | null {
  const project = townPath ? townJira.get(townPath) : null;
  if (!project) return null;
  const L = townPath ? lanesOf(townPath) : null;
  const crew = chars.filter((x) => !x.isHomeBase && !x.reviewer).map((x) => ({ id: x.id, name: x.name, available: !TERMINAL_IDS.has(x.id) && x.state === "idle" && !(L?.isWorking(x.id) ?? false) }));
  const b = jiras.get(project);
  if (!b) return { project, site: jiraSite(), configured: jiraConfigured(), email: cfg.data.jiraEmail, checkedAt: 0, checking: false, forYou: 0, lines: [], plate: [], open: 0, error: null, crew, sweeping: null };
  const sw = b.sweeping && (L?.isWorking(b.sweeping.characterId) ?? false) ? { characterId: b.sweeping.characterId, name: b.sweeping.name, since: b.sweeping.since } : null;
  if (b.sweeping && !sw) b.sweeping = null; // stopped cooking (finished, or the app restarted mid-sweep)
  const lines = jiraLinesOf(b);
  return { project, site: jiraSite(), configured: true, email: cfg.data.jiraEmail, checkedAt: b.checkedAt, checking: b.busy, forYou: jiraForYou(lines), lines, plate: b.plate, open: b.open, error: b.error, crew, sweeping: sw };
}

/** After Maksym merged a PR from the town: its ticket moves to Review Completed
 *  when it still sits in Code Review — the one write the town makes with the
 *  token (the merge IS the approval). Anything else stays with the characters. */
async function moveTicketAfterMerge(townPath: string, line: MailLine): Promise<void> {
  const project = townJira.get(townPath);
  if (!project || !jiraClient) return;
  const key = ticketKeyOf(line.branch, line.title, project);
  if (!key) { log("jira", "merged PR names no ticket", { number: line.number, branch: line.branch }); return; }
  try {
    const status = await jiraClient.status(key);
    const d = moveAfterMerge(status);
    if (!d.ok) { log("jira", "ticket left where it is after the merge", { key, status, why: d.why }); toast(`Jira: ${key} stays in ${status || "?"} — ${d.why}`); return; }
    const r = await jiraClient.move(key, d.move.transition, `Merged PR #${line.number} into ${line.base} — moved to ${d.move.to} from Bikini Bottom on Maksym's click.`);
    log("jira", r.ok ? "ticket moved after the merge" : "ticket move failed", { key, number: line.number, message: r.message });
    toast(r.ok ? `Jira: ${r.message} ✓` : `Jira: ${key} not moved — ${r.message}`);
    if (r.ok) await tg?.send(`📋 ${tgEsc(r.message)} (merged #${line.number})`);
    void pollJira(project);
  } catch (e: any) { log("jira", "ticket move failed", { key, error: String(e?.message || e) }); toast(`Jira: ${key} not moved — ${String(e?.message || e)}`); }
}

/** Hand the sweep to a character: it reads the board, proposes the moves in one
 *  question, applies Maksym's picks. The page says who is on it meanwhile. */
async function sweepFromTown(townPath: string, characterId: CharacterId): Promise<void> {
  const b = jiraOf(townPath); const t = towns.get(townPath);
  if (!b || !t || characterId === "krabs") return;
  if (TERMINAL_IDS.has(characterId)) { toast(`${tgName(characterId)} works in a terminal — pick another character.`); return; }
  if (t.lanes.isWorking(characterId)) { toast(`${tgName(characterId)} is busy — pick someone idle.`); return; }
  if (b.sweeping && (lanesOf(b.sweeping.townPath)?.isWorking(b.sweeping.characterId) ?? false)) { toast(`${b.sweeping.name} is already sweeping the board.`); return; }
  const repos = [...new Set([...towns.keys()].filter((p) => townJira.get(p) === b.project).map((p) => mails.get(p)?.repo).filter((r): r is string => !!r))];
  const brief = sweepBrief({ project: b.project, site: jiraSite(), plate: b.plate, open: b.open, repos });
  log("jira", "sweep handed to a character", { project: b.project, characterId, town: townNameOf(townPath) });
  if (townPath === currentTownPath) openWindowId = characterId;
  await t.lanes.startJob(characterId, brief);
  b.sweeping = { characterId, name: tgName(characterId), since: Date.now(), townPath };
  pushSnapshot();
}

/** Hand a note to a character: it reads the ticket and its thread, answers on
 *  Jira or does the work, and reports. The line says "X is on it" meanwhile. */
async function handOffJira(townPath: string, id: string, characterId: CharacterId): Promise<void> {
  const b = jiraOf(townPath); const t = towns.get(townPath);
  if (!b || !t || characterId === "krabs") return;
  if (REVIEWER_IDS.has(characterId)) { toast("Karen only reviews pull requests — pick someone else for this."); return; }
  const line = b.lines.find((l) => l.id === id);
  if (!line) { toast("That note isn't on the page anymore."); return; }
  if (!canHandJira(line)) { toast("Nothing to hand over on that line."); return; }
  if (TERMINAL_IDS.has(characterId)) { toast(`${tgName(characterId)} works in a terminal — pick another character.`); return; }
  if (t.lanes.isWorking(characterId)) { toast(`${tgName(characterId)} is busy — pick someone idle.`); return; }
  const brief = jiraBrief({ line, comments: b.raw.comments[line.key] || [], site: jiraSite(), project: b.project, me: b.me });
  log("jira", "note handed to a character", { key: line.key, word: line.word, characterId, town: townNameOf(townPath) });
  if (townPath === currentTownPath) openWindowId = characterId;
  await t.lanes.startJob(characterId, brief);
  b.onIt.set(id, { characterId, name: tgName(characterId), since: Date.now(), townPath });
  saveJiraOnIt(b);
  pushSnapshot();
}

/** The towns of a project, for the phone's buttons: a [BE] ticket goes to the backend town. */
function jiraTownFor(project: string, title: string): string | null {
  const ts = [...towns.keys()].filter((p) => townJira.get(p) === project).map((p) => ({ path: p, repo: mails.get(p)?.repo ?? null }));
  return townForTicket(title, ts);
}

/** The paste box: the token is saved to the town's settings and every town's board starts. */
async function saveJiraSettings(email: string, token: string, site: string): Promise<void> {
  const e = email.trim(), t = token.trim(), s = (site.trim() || "https://empat.atlassian.net").replace(/\/+$/, "");
  if (!e || !t) { toast("Both the email and the token are needed."); return; }
  const probe = new JiraClient(s, e, t);
  try { const me = await probe.myself(); toast(`Jira knows this token as ${me.displayName}. Saved.`); } catch (err: any) { toast(`Jira did not accept it — ${String(err?.message || err)}. Nothing saved.`); return; }
  await cfg.save({ jiraEmail: e, jiraToken: t, jiraSite: s });
  jiraClient = probe;
  for (const b of jiras.values()) if (b.timer) clearInterval(b.timer);
  jiras.clear();
  for (const [p, t] of towns) await startJira(p, t.profile);
  log("jira", "token saved from the page", { site: s });
}

/** The phone: one message per new note (buttons open Jira), a list when many. */
function notifyTgJira(project: string, fresh: JiraLine[]): void {
  if (!tg) return;
  if (fresh.length > 3) {
    const body = fresh.map((l) => `• <b>${tgEsc(l.key)}</b> ${tgEsc(l.label)} — ${tgEsc(l.title.slice(0, 60))}\n   ↳ ${tgEsc(l.reason)}`).join("\n");
    void tg.send(`📋 <b>Jira</b> — ${fresh.length} notes for you:\n${body}`);
    return;
  }
  for (const l of fresh) {
    const buttons: TgButton[][] = [];
    // A note a character can take: one tap hands it over, like the mailbox's "fixes it".
    const townPath = canHandJira(l) ? jiraTownFor(project, l.title) : null;
    if (townPath) {
      const t = towns.get(townPath);
      const faces: TgButton[] = ROSTER.filter((r) => !r.isHomeBase && !r.reviewer && !TERMINAL_IDS.has(r.id) && !(t?.lanes.isWorking(r.id) ?? true)).map((r) => ({ text: `${r.name} handles it`, data: tgData("jirahand", r.id, l.id.replace(/:/g, "~"), townPath) }));
      if (faces.length) buttons.push(faces);
    }
    buttons.push([{ text: "Open on Jira", url: l.url }]);
    void tg.send(`📋 <b>${tgEsc(l.key)} · ${tgEsc(l.label)}</b> — ${tgEsc(l.title)}\n↳ ${tgEsc(l.reason)}`, buttons);
  }
}

async function startMail(townPath: string, profile: TownProfile): Promise<void> {
  if (profile.pulls?.off) { log("mail", "mailbox off by profile", { town: profile.name }); return; }
  const repo = profile.pulls?.repo ?? await repoOf(townPath);
  if (!repo) { log("mail", "no GitHub remote — no mailbox", { town: profile.name }); return; }
  if (ghMe === undefined) ghMe = await ghLogin();
  if (!ghMe) { log("mail", "gh not logged in — no mailbox", { town: profile.name, repo }); return; }
  const m: TownMail = {
    repo, me: ghMe, everySec: profile.pulls?.everySec ?? 60, merge: profile.pulls?.merge ?? "squash",
    raw: [], lines: [], threads: {}, checkedAt: 0, error: null, timer: null, busy: false, pinged: loadPinged(townPath), merging: null,
    nudge: null, refused: null, onIt: loadOnIt(townPath),
  };
  mails.set(townPath, m);
  log("mail", "mailbox up", { town: profile.name, repo, me: ghMe, everySec: m.everySec, merge: m.merge });
  await pollMail(townPath);
  m.timer = setInterval(() => void pollMail(townPath), m.everySec * 1000);
}

/** A character just wrote to GitHub (review, push, PR edit…): look again in a
 *  few seconds — one look for a burst of commands — so the paper never shows a
 *  review as still due right after it was posted (Maksym, 2026-11-05). */
function nudgeMail(townPath: string, id: CharacterId): void {
  const m = mails.get(townPath);
  if (!m) return;
  if (m.nudge) clearTimeout(m.nudge);
  m.nudge = setTimeout(() => { m.nudge = null; log("mail", "a character wrote to GitHub — re-reading", { town: townNameOf(townPath), characterId: id }); void pollMail(townPath); }, 6_000);
}

/** One look at GitHub: the open PRs and their threads → the paper's lines. New
 *  "needs you" lines ring the chime and ping the phone, once each. */
async function pollMail(townPath: string): Promise<void> {
  const m = mails.get(townPath);
  if (!m || m.busy) return;
  m.busy = true;
  pushSnapshot(); // the paper says "checking…" while the look runs
  const before = JSON.stringify(m.lines) + m.error;
  try {
    const { pulls, threads } = await fetchPulls(m.repo);
    const raw = mailLines(pulls, threads, m.me);
    const lines = await decorateMail(townPath, m, raw);
    const fresh = newPings(lines, m.pinged);
    m.raw = raw; m.lines = lines; m.threads = threads; m.checkedAt = Date.now(); m.error = null;
    // A refusal is moot once the line is mergeable again, gone, or in a character's hands.
    if (m.refused) { const l = lines.find((x) => x.number === m.refused!.number); if (!l || l.canMerge || l.onIt) m.refused = null; }
    if (fresh.length) {
      for (const l of fresh) m.pinged.add(pingKey(l));
      savePinged(townPath, m.pinged);
      log("mail", "new mail for Maksym", { town: townNameOf(townPath), lines: fresh.map((l) => `#${l.number} ${l.word}`) });
      if (winAlive()) win!.webContents.send(CHANNELS.sound, { characterId: "krabs", kind: "mail", url: resolveMailSound(SOUNDS_DIR) });
      notifyTgMail(townPath, fresh);
    }
  } catch (e: any) {
    m.error = e?.message || String(e);
    log("mail", "look at GitHub failed", { town: townNameOf(townPath), repo: m.repo, error: m.error });
  } finally {
    m.busy = false;
  }
  pushSnapshot(); // always: "checked just now" and the button come back even when nothing changed
  void before;
}

/** The mailbox as the shown town's street draws it. */
function mailViewFor(townPath: string | null, chars: TownSnapshot["characters"]): MailView | null {
  const m = townPath ? mails.get(townPath) : null;
  if (!m) return null;
  const L = townPath ? lanesOf(townPath) : null;
  const chip = (x: TownSnapshot["characters"][number]) => ({ id: x.id, name: x.name, available: !TERMINAL_IDS.has(x.id) && x.state === "idle" && !(L?.isWorking(x.id) ?? false) });
  const crew = chars.filter((x) => !x.isHomeBase && !x.reviewer).map(chip);
  const reviewCrew = chars.filter((x) => x.reviewer).map(chip);
  return { repo: m.repo, checkedAt: m.checkedAt, forYou: forYouCount(m.lines), lines: m.lines, error: m.error, pictures: resolveMailPictures(ASSETS_DIR), crew, reviewCrew, merging: m.merging, refused: m.refused, checking: m.busy };
}

/** Merge one of Maksym's PRs from the town — after asking GitHub once more
 *  that it is still on a clean plate. `via` says where the click came from. */
async function mergeFromTown(townPath: string, number: number, via: "street" | "tg"): Promise<void> {
  const m = mails.get(townPath);
  if (!m) return;
  const say = async (text: string) => { toast(text); if (via === "tg") await tg?.send(tgEsc(text)); };
  if (m.merging) { await say(`One merge at a time — #${m.merging} is still going.`); return; }
  const line = m.lines.find((l) => l.number === number) ?? null;
  const fresh = line && line.mine ? await viewPull(m.repo, number) : null;
  const refusal = mergeRefusal(line, fresh);
  if (!refusal) m.refused = null;
  if (refusal) {
    log("mail", "merge refused", { number, via, refusal });
    m.refused = { number, reason: refusal };
    toast(`Not merging — ${refusal}.`);
    if (via === "tg") {
      // The phone gets the faces too: one tap hands the fix to a character.
      const t = towns.get(townPath);
      const faces: TgButton[] = ROSTER.filter((r) => !r.isHomeBase && !r.reviewer && !TERMINAL_IDS.has(r.id) && !(t?.lanes.isWorking(r.id) ?? true)).map((r) => ({ text: `${r.name} fixes it`, data: tgData("mailhand", r.id, number, townPath) }));
      await tg?.send(`Not merging — ${tgEsc(refusal)}.${faces.length ? " Who fixes it?" : ""}`, faces.length ? [faces] : undefined);
    }
    await pollMail(townPath); // the line turns ALMOST / SENT BACK with its Hand button, right now
    pushSnapshot();
    return;
  }
  m.merging = number; pushSnapshot();
  const r = await ghMergePull(m.repo, number, m.merge);
  m.merging = null;
  log("mail", r.ok ? "merged" : "merge failed", { number, via, repo: m.repo, method: m.merge, message: r.message });
  if (r.ok) {
    toast(`✓ #${number} merged into ${line!.base} — branch deleted`);
    await tg?.send(`✅ Merged <b>#${number}</b> into ${tgEsc(line!.base)}${tgEsc(tgTown(townPath))} — ${tgEsc(line!.title)}`);
    void moveTicketAfterMerge(townPath, line!); // the ticket follows the work (Jira page policy)
  } else {
    await say(`Merge failed — ${r.message}`);
  }
  await pollMail(townPath);
}

/** Ask the reviewer(s) to look again at one of Maksym's PRs — the line's
 *  askBack list, as the paper showed it. Refused on anyone else's PR. */
async function askReviewFromTown(townPath: string, number: number, via: "street" | "tg"): Promise<void> {
  const m = mails.get(townPath);
  if (!m) return;
  const say = async (text: string) => { toast(text); if (via === "tg") await tg?.send(tgEsc(text)); };
  const line = m.lines.find((l) => l.number === number) ?? null;
  if (!line) { await say("That PR isn't on the paper anymore."); return; }
  if (!line.mine) { await say(`#${number} is ${line.author}'s — not yours to send around.`); return; }
  const who = line.askBack.length ? line.askBack : line.reviewers;
  if (!who.length) { await say(`#${number}: nobody to ask — no reviewer has looked yet.`); return; }
  const r = await requestReview(m.repo, number, who);
  log("mail", r.ok ? "asked to look again" : "ask failed", { number, via, repo: m.repo, who, message: r.message });
  if (r.ok) {
    toast(`✓ #${number}: asked ${who.join(", ")} to look again`);
    await tg?.send(`🙋 <b>#${number}</b>${tgEsc(tgTown(townPath))}: asked ${tgEsc(who.join(", "))} to look again`);
  } else {
    await say(`Couldn't ask — ${r.message}`);
  }
  await pollMail(townPath);
}

/** Hand a PR to a character: the fix of a sent-back PR of Maksym's, or the
 *  read-and-draft of a teammate's PR. The brief is the job; the Work Window opens. */
async function handOffPull(townPath: string, number: number, characterId: CharacterId): Promise<void> {
  const m = mails.get(townPath); const t = towns.get(townPath);
  if (!m || !t || characterId === "krabs") return;
  const line = m.lines.find((l) => l.number === number);
  if (!line) { toast("That PR isn't on the paper anymore."); return; }
  // The reviewer takes review orders only (someone else's PR waiting for Maksym's
  // look); a builder takes fixes and never a review — only Karen reviews.
  if (!canTake(REVIEWER_IDS.has(characterId), line.word)) {
    toast(REVIEWER_IDS.has(characterId) ? "Karen only reviews other people's PRs — this one needs fixing, pick a builder." : `Reviews are Karen's — hand #${number} to her.`);
    return;
  }
  if (TERMINAL_IDS.has(characterId)) { toast(`${tgName(characterId)} works in a terminal — pick another character.`); return; }
  if (t.lanes.isWorking(characterId)) { toast(`${tgName(characterId)} is busy — pick someone idle.`); return; }
  const brief = briefFor(line, m.threads[number] || [], m.repo);
  log("mail", "handed to a character", { number, word: line.word, characterId, town: townNameOf(townPath) });
  if (townPath === currentTownPath) openWindowId = characterId;
  await t.lanes.startJob(characterId, brief);
  // The line is in progress now: "<name> is on it", not yours, until they finish.
  m.onIt.set(number, { characterId, name: tgName(characterId), since: Date.now() });
  if (m.refused?.number === number) m.refused = null;
  saveOnIt(townPath, m);
  m.lines = await decorateMail(townPath, m, m.raw);
  pushSnapshot();
}

/** The phone: one message per new "needs you" line (buttons: Merge it / Open),
 *  or one list when many arrive at once (first look after a long sleep). */
function notifyTgMail(townPath: string, fresh: MailLine[]): void {
  if (!tg) return;
  const where = tgTown(townPath);
  if (fresh.length > 3) {
    const body = fresh.map((l) => `• <b>#${l.number}</b> ${tgEsc(l.status)} — ${tgEsc(l.title)}\n   ↳ ${tgEsc(l.reason)}`).join("\n");
    tgRemember(tg.send(`📬 <b>Mail${tgEsc(where)}</b> — ${fresh.length} pieces need you:\n${body}`), townPath, "krabs");
    return;
  }
  for (const l of fresh) {
    const buttons: TgButton[][] = [];
    if (l.canMerge) buttons.push([{ text: "✅ Merge it", data: tgData("mailmerge", "krabs", l.number, townPath) }]);
    if (l.askBack.length) buttons.push([{ text: `🙋 Ask ${l.askBack.join(", ")} to look again`, data: tgData("mailask", "krabs", l.number, townPath) }]);
    buttons.push([{ text: "Open on GitHub", url: l.url }]);
    tgRemember(tg.send(`📬 <b>#${l.number} · ${tgEsc(l.status)}</b>${tgEsc(where)} — ${tgEsc(l.title)}\n↳ ${tgEsc(l.reason)}`, buttons), townPath, "krabs");
  }
}

/** A Lane finished → native macOS notification (FR-7). Clicking it opens that
 *  Character (switching town first when it happened elsewhere). Skipped if
 *  Maksym is already looking at that window. The title names the town when it
 *  is not the one on screen: "SpongeBob finished! · Rock Bottom". */
function fireFinishNotification(townPath: string, id: CharacterId, summary: string): void {
  notifyTgDone(townPath, id, summary); // phone always gets the "finished" ping (not gated by focus/desktop-notif prefs)
  // A PR this character was on: the mark comes off and the paper looks at
  // GitHub right away, so the line says what came of the work, not "on it".
  for (const b of jiras.values()) {
    let again = false;
    if (b.sweeping && b.sweeping.characterId === id && b.sweeping.townPath === townPath) { b.sweeping = null; log("jira", "sweep finished — re-reading the board", { project: b.project, characterId: id }); again = true; }
    for (const [lid, o] of b.onIt) if (o.characterId === id && o.townPath === townPath) { b.onIt.delete(lid); log("jira", "character finished a note — re-reading", { id: lid, characterId: id }); again = true; }
    if (again) { saveJiraOnIt(b); void pollJira(b.project); }
  }
  const m = mails.get(townPath);
  if (m && ([...m.onIt.values()].some((o) => o.characterId === id) || m.lines.some((l) => l.onIt?.characterId === id))) {
    for (const [n, o] of m.onIt) if (o.characterId === id) { m.onIt.delete(n); log("mail", "character finished a PR — re-reading", { number: n, characterId: id, town: townNameOf(townPath) }); }
    saveOnIt(townPath, m);
    void pollMail(townPath); // re-reads GitHub and re-paints who is on what
  }
  if (!cfg.data.notificationsWanted || !Notification.isSupported()) return;
  const here = townPath === currentTownPath;
  if (here && win?.isFocused() && openWindowId === id) return; // already watching
  const name = ROSTER.find((r) => r.id === id)?.name ?? id;
  const n = new Notification({ title: `${name} finished!${here ? "" : ` · ${townNameOf(townPath)}`}`, body: summary });
  n.on("click", () => {
    showTown(townPath); // a town that is not on screen comes to the street first
    openWindowId = id;
    if (winAlive()) { if (win!.isMinimized()) win!.restore(); win!.show(); win!.focus(); }
    void handleIntent({ type: "openCharacter", id });
  });
  n.show();
}

const STATE_WORD: Record<CharacterState, string> = {
  idle: "idle", working: "cooking…", calling: "calling you",
};

/** Build the open window overlay (Home Base picker or a Work Window chat). */
function buildWindow(chars: TownSnapshot["characters"]): WindowView | null {
  if (!openWindowId) return null;
  const c = chars.find((x) => x.id === openWindowId);
  if (!c) return null;
  if (c.isHomeBase) {
    const crew = chars
      .filter((x) => !x.isHomeBase && !x.reviewer) // the reviewer is never on the picker
      .map((x) => ({
        id: x.id, name: x.name,
        // Terminal chars (squid) are always pickable — no SDK "working" state.
        available: TERMINAL_IDS.has(x.id) || (x.state === "idle" && !(lanes?.isWorking(x.id) ?? false)),
        stateWord: x.booth === "holding" ? "on the phone" : x.booth === "queued" ? "waiting for the phone" : STATE_WORD[x.state],
      }));
    return { characterId: c.id, name: c.name, role: c.role, accent: c.accent, isHomeBase: true, terminal: false, crew, conversation: [], working: false, pendingAsk: null, pendingChoice: null, burned: false, paused: false, served: false, collision: false, agents: 0, agentNames: [], agentIcon: null, activity: null, taskTitle: null, todos: [], taskStartedAt: 0, taskTokens: 0, beatAt: 0, limitedUntil: 0, jobStats: EMPTY_JOB_STATS, pastSessions: [], viewing: null, pointer: null, picks: [], booth: null };
  }
  const isTerm = TERMINAL_IDS.has(c.id);
  const v = lanes?.view(c.id);
  return {
    characterId: c.id, name: c.name, role: c.role, accent: c.accent, isHomeBase: false, terminal: isTerm, crew: [],
    // Terminal char: its "Past orders" are Claude's own past sessions on disk.
    termSessions: isTerm && lanes ? listClaudeSessions(lanes.worktreeDir(c.id)).map((s) => ({ sessionId: s.sessionId, title: s.title })) : undefined,
    conversation: v?.conversation ?? [],
    working: v?.working ?? false,
    pendingAsk: v?.pendingAsk ?? null,
    pendingChoice: v?.pendingChoice ?? null,
    burned: v?.burned ?? false,
    paused: v?.paused ?? false,
    served: v?.served ?? false,
    collision: v?.collision ?? false,
    agents: v?.agents ?? 0,
    agentNames: v?.agentNames ?? [],
    agentIcon: resolveHelperIcon(ASSETS_DIR, c.id),
    activity: v?.activity ?? null,
    taskTitle: v?.taskTitle ?? null,
    todos: v?.todos ?? [],
    taskStartedAt: v?.taskStartedAt ?? 0,
    taskTokens: v?.taskTokens ?? 0,
    beatAt: v?.beatAt ?? 0,
    limitedUntil: v?.limitedUntil ?? 0,
    jobStats: v?.jobStats ?? EMPTY_JOB_STATS,
    pastSessions: v?.pastSessions ?? [],
    viewing: v?.viewing ?? null,
    // Point at it: only lanes with a running app (S&R adoptions) get the button.
    pointer: pointer?.view(c.id, pointerUrlFor(c.id)) ?? null,
    picks: pointer?.cards(c.id) ?? [],
    booth: boothLineFor(c.id, chars),
    ...(loadFixture()?.window || {}), // dev/screenshot overlay only (BIKINI_FIXTURE)
  };
}

/** The Work Window's booth line: who has the phone and for how long, or null. */
function boothLineFor(id: CharacterId, chars: TownSnapshot["characters"]): WindowView["booth"] {
  const v = lanes?.view(id);
  const role = v?.booth ?? null;
  const b = boothView();
  if (!role || !b) return null;
  const nameOf = (cid: CharacterId | null) => chars.find((x) => x.id === cid)?.name ?? ROSTER.find((r) => r.id === cid)?.name ?? "someone";
  const mins = (since: number) => (since ? Math.max(0, Math.round((Date.now() - since) / 60_000)) : 0);
  const doors = b.doors ?? [];
  if (role === "holding") {
    const mine = doors.find((d) => d.phone === v?.phone) ?? doors.find((d) => d.holder === id);
    return { role, holder: nameOf(id), minutes: mins(mine?.since ?? b.since), phone: mine?.name ?? b.name };
  }
  // Queued: say who has what, so the wait makes sense.
  const busy = doors.filter((d) => d.holder);
  const who = busy.length
    ? busy.map((d) => `${nameOf(d.holder)} has the ${d.name} (${mins(d.since)} min)`).join(", ")
    : `${nameOf(b.holder)} is testing`;
  return { role, holder: who, minutes: mins(busy[0]?.since ?? b.since), phone: null };
}

/** The shown town's booth (fixture first, for photographs), or null. */
function boothView(): BoothView | null {
  const fx = loadFixture();
  if (fx && fx.booth !== undefined) return fx.booth;
  return lanes?.boothView() ?? null;
}

/** Where this lane's own app is running (the adoption's frontend port), or null.
 *  The engine shows THIS; a lane without an app has no "Point at it" button. */
function pointerUrlFor(id: CharacterId): string | null {
  if (id === "krabs") return null;
  const fx = loadFixture();
  if (fx?.pointerUrl) return fx.pointerUrl; // dev/screenshot hook only
  const port = adoptSupport?.adoptionFor(id)?.frontendPort;
  return port ? `http://localhost:${port}` : null;
}

const ASSETS_DIR = path.join(__dirname, "../../assets");
const SOUNDS_DIR = path.join(__dirname, "../../sounds");

/** Resolve a Character's sound file (AD-7) and push it to the renderer to
 *  play. Transient/view-only — never persisted. Renderer respects mute. */
function emitSoundCue(townPath: string, id: CharacterId, kind: "start" | "ready"): void {
  const url = resolveSound(SOUNDS_DIR, id, kind);
  // A cue from a town that is not on screen still plays — a "ready" from the
  // other town is exactly the thing worth hearing. Mute applies as always.
  log("sound", `${id} ${kind}`, { hasFile: !!url, town: townNameOf(townPath), onScreen: townPath === currentTownPath });
  if (winAlive()) win!.webContents.send(CHANNELS.sound, { characterId: id, kind, url });
  if (kind === "ready") notifyTelegram(townPath, id); // a character needs attention → ping the phone
  else if (kind === "start") notifyTgStart(townPath, id); // a job kicked off → ping the phone
}

// Reserve light (Job 1): the FIRST time the 5-hour tank lights up in a window,
// one line to the phone. Once per window — the lane persists what it warned about.
let fuelWarnedFor = 0; // the reset time already announced — each town's lane engine would otherwise warn once
function onFuelWarning(g: Gauge): void {
  if (!tg) return;
  if (g.resetsAt && g.resetsAt === fuelWarnedFor) return;
  fuelWarnedFor = g.resetsAt;
  const pct = g.util !== null ? ` (${Math.round(g.util * 100)}% used)` : "";
  const when = g.resetsAt ? ` — resets ${fmtWhen(g.resetsAt)}` : "";
  void tg.send(`⛽ Claude's 5-hour tank is in reserve${pct}${when}. Long orders will slow down; hand the next task out as a NEW order.`);
}

/** The street sign's words, from the town-wide fuel reading (null = dark/hidden).
 *  The 5-hour tank is the headline; the weekly window is the tooltip — unless
 *  only the weekly one is lit, in which case IT is the headline. */
function fuelSignFor(fuel: Fuel, now: number = Date.now()): FuelSign | null {
  const five = fuelWord(fuel.fiveHour, now, "Reserve");
  const week = fuelWord(fuel.sevenDay, now, "Weekly reserve");
  if (five && fuel.fiveHour) return { level: fuel.fiveHour.level as FuelSign["level"], text: five, title: week || "", stale: fuelStale(fuel.fiveHour, now) };
  if (week && fuel.sevenDay) return { level: fuel.sevenDay.level as FuelSign["level"], text: week, title: "", stale: fuelStale(fuel.sevenDay, now) };
  return null;
}

function notifyTgStart(townPath: string, id: CharacterId): void {
  const L = lanesOf(townPath);
  if (!tg || !L || id === "krabs") return;
  const task = L.lastPromptFor(id);
  tgRemember(tg.sendLong(`▶️ ${tgName(id)}${tgTown(townPath)} started:\n\n${task || "a new task."}`), townPath, id);
}

// ───────────────────────── Telegram remote control ─────────────────────────
// Answer questions, approve "keep cooking?" pauses, start jobs (Mr. Krabs) and
// manage sessions from the phone. Every tap becomes a normal Intent → nothing
// is reimplemented. Locked to the owner chat in the bridge.
let tg: TelegramBridge | null = null;
// Free-text expectation: after "/new → pick char" we await a job body; after a
// question we await a typed answer. Cleared once consumed.
let tgExpect: { mode: "answer" | "job"; id: CharacterId; town: string } | null = null;
// Reply-to-continue: every message about a session is remembered against that
// session, so a swipe-reply on the phone goes into IT (domain/tgThreads.ts).
const tgThreads = new TgThreads();
// A reply aimed at a past order while the character is busy: held here until
// Maksym taps "switch" (stops the current order) or "keep" (drops the reply).
let tgSwitch: { text: string; thread: TgThread; index: number } | null = null;
const TG_CHARS: CharacterId[] = ["bob", "squid", "pat"];
const tgName = (id: CharacterId): string => ROSTER.find((r) => r.id === id)?.name ?? id;
const tgEsc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// The Ferry on the phone: ONE bot for every town. A ping names its town when
// that town is not on screen; a tap answers into the town it came from. Button
// data is capped at 64 bytes, so it carries the town's INDEX in the config list.
const tgTown = (townPath: string): string => (townPath === currentTownPath ? "" : ` · ${townNameOf(townPath)}`);
const tgTownIdx = (townPath: string): number => Math.max(0, cfg.data.towns.findIndex((t) => t.path === townPath));
const tgTownAt = (idx: string | undefined): string => (idx ? cfg.data.towns[Number(idx)]?.path : undefined) ?? currentTownPath ?? "";
const tgData = (action: string, id: CharacterId, extra: string | number | undefined, townPath: string): string => `${action}:${id}:${extra ?? ""}:${tgTownIdx(townPath)}`;
const lanesOf = (townPath: string): LaneManager | null => towns.get(townPath)?.lanes ?? null;
const curTown = (): string => currentTownPath ?? "";
/** The session a character is in RIGHT NOW, as a thread key (null = no lane). */
const tgThreadFor = (townPath: string, id: CharacterId): TgThread | null => {
  const L = lanesOf(townPath);
  if (!L) return null;
  return { town: townPath, id, session: L.sessionIdFor(id), startedAt: L.view(id).taskStartedAt };
};
/** Remember the sent message id(s) against the character's current session —
 *  fire-and-forget around a send(), so a later swipe-reply finds the session. */
const tgRemember = (sent: Promise<number | null | number[]> | number | null | Array<number | null | undefined>, townPath: string, id: CharacterId): void => {
  const thread = tgThreadFor(townPath, id); // the session as it is NOW (the send is about it)
  if (!thread) return;
  void Promise.resolve(sent).then((r) => tgThreads.remember(Array.isArray(r) ? r : [r], thread)).catch(() => {});
};

/** Run a lane intent in a town that may NOT be on screen (a Telegram tap on a
 *  background town's ping). The shown town goes through handleIntent as usual;
 *  another town's lane engine is driven directly — the street stays where it is. */
async function runInTown(townPath: string, intent: Intent): Promise<void> {
  const t = towns.get(townPath);
  if (!t || townPath === currentTownPath) { await handleIntent(intent); return; }
  log("intent", `${intent.type} (in ${t.profile.name})`, { ...intent, type: undefined });
  switch (intent.type) {
    case "answerQuestion": void t.lanes.answerQuestion(intent.characterId, intent.answers, intent.attachments); break;
    case "answerPermission": void t.lanes.answerPermission(intent.characterId, intent.allow); break;
    case "retryJob": void t.lanes.retry(intent.characterId); break;
    case "scrapJob": void t.lanes.scrap(intent.characterId); break;
    case "cancelJob": void t.lanes.cancel(intent.characterId); break;
    case "handOutJob": void t.lanes.startJob(intent.characterId, intent.prompt, intent.attachments); break;
    case "followUp": void t.lanes.followUp(intent.characterId, intent.prompt, intent.attachments); break;
    case "resumePast": void t.lanes.resumePast(intent.characterId, intent.index, intent.prompt); break;
    case "remindLater": await t.log.append({ type: "ReminderSet", id: intent.characterId }); pushSnapshot(); break;
    default: await handleIntent(intent);
  }
}

function startTelegram(): void {
  const token = cfg.data.telegramToken, chatId = cfg.data.telegramChatId;
  if (!token || !chatId) { log("tg", "not configured — skipping"); return; }
  tg = new TelegramBridge(token, chatId, {
    onTap: (d) => void handleTgTap(d),
    onCommand: (c, a) => void handleTgCommand(c, a),
    onText: (t, ctx) => void handleTgText(t, ctx),
  });
  tg.start();
  void tg.send("🍍 Bikini Bottom is online — I'll ping you when someone needs you.\nCommands: /town  /new  /orders  /cancel");
}

// Fired on the 'ready' cue — work out WHY the character needs Maksym, and ping.
function notifyTelegram(townPath: string, id: CharacterId): void {
  const lanes = lanesOf(townPath); // THIS town's engine, shown or not
  if (!tg || !lanes || id === "krabs") return;
  const nm = tgName(id) + tgTown(townPath);
  if (lanes.hasPendingChoice(id)) {
    const qs = lanes.view(id).pendingChoice?.questions || [];
    const q = qs[0];
    if (!q) return;
    tgExpect = { mode: "answer", id, town: townPath };
    if (qs.length > 1) {
      // A BATCH of questions (the character gathered them, as asked). Buttons
      // only fit one question, so list them all with numbered options and take
      // one reply line per question (a number or your own words).
      // HTML when it fits in one message; a very long batch goes as plain text
      // (sendLong is plain — HTML tags would show up literally).
      const body = qs.map((qq, qi) => `<b>${qi + 1}.</b> ${tgEsc(qq.question)}\n` + qq.options.map((o, oi) => `   ${oi + 1}) ${tgEsc(o.label.slice(0, 80))}`).join("\n")).join("\n\n");
      const html = `❓ <b>${tgEsc(nm)}</b> has ${qs.length} questions — all at once:\n\n${body}\n\n<i>Reply with one line per question: the option number, or your own words.</i>`;
      if (html.length <= 3900) tgRemember(tg.send(html), townPath, id);
      else tgRemember(tg.sendLong(html.replace(/<\/?(b|i)>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")), townPath, id);
      return;
    }
    const rows: TgButton[][] = q.options.map((o, i) => [{ text: o.label.slice(0, 60), data: tgData("ans", id, i, townPath) }]);
    tgRemember(tg.send(`❓ <b>${tgEsc(nm)}</b> asks:\n${tgEsc(q.question)}\n\n<i>Tap an option, or reply with your own answer.</i>`, rows), townPath, id);
  } else if (lanes.hasPendingAsk(id)) {
    tgExpect = { mode: "answer", id, town: townPath };
    tgRemember(tg.send(`🔐 <b>${tgEsc(nm)}</b> needs approval:\n${tgEsc(lanes.view(id).pendingAsk || "…")}`, [[{ text: "✅ Allow", data: tgData("perm", id, "allow", townPath) }, { text: "🚫 Deny", data: tgData("perm", id, "deny", townPath) }]]), townPath, id);
  } else if (lanes.limitedUntil(id)) {
    // Usage limit: nothing to decide — it resumes by itself. Just say so honestly.
    tgRemember(tg.send(`⏳ <b>${tgEsc(nm)}</b> ran into Claude's usage limit — it resets at ${tgEsc(fmtClock(lanes.limitedUntil(id)))} and ${tgEsc(tgName(id))} will pick up by itself then. Nothing is lost.`, [[{ text: "🗑 Scrap the order", data: tgData("scrap", id, "", townPath) }]]), townPath, id);
  } else if (lanes.isPaused(id)) {
    tgRemember(tg.send(`⏸ <b>${tgEsc(nm)}</b> paused at a checkpoint — keep cooking?`, [[{ text: "🍳 Keep cooking", data: tgData("retry", id, "", townPath) }, { text: "🗑 Scrap", data: tgData("scrap", id, "", townPath) }]]), townPath, id);
  } else if (lanes.isBurned(id)) {
    tgRemember(tg.send(`⚠️ <b>${tgEsc(nm)}</b> hit a snag.`, [[{ text: "🔁 Try again", data: tgData("retry", id, "", townPath) }, { text: "🗑 Scrap", data: tgData("scrap", id, "", townPath) }]]), townPath, id);
  }
}

function notifyTgDone(townPath: string, id: CharacterId, summary: string): void {
  const lanes = lanesOf(townPath);
  if (!tg || id === "krabs" || !lanes) return;
  // Send the FULL final reply, not the 90-char summary (Maksym wants the whole
  // message, not the first few lines). sendLong auto-splits if it's huge.
  const full = lanes.view(id).conversation.slice().reverse().find((m) => m.from === "them" && !m.tool)?.text || summary || "finished the job";
  const bridge = tg;
  const thread = tgThreadFor(townPath, id); // the session that just finished — a reply continues IT
  // …then a short follow-up with a "remind me" button ("come back later" from the phone).
  void Promise.resolve(bridge.sendLong(`✅ ${tgName(id)}${tgTown(townPath)} finished:\n\n${full}`))
    .then(async (ids) => {
      const tail = await bridge.send("Come back to this later, or reply to continue it?", [[{ text: "📌 Remind me", data: tgData("remind", id, "", townPath) }]]);
      if (thread) tgThreads.remember([...ids, tail], thread);
    })
    .catch(() => {});
}

async function handleTgTap(data: string): Promise<void> {
  // "action:id:extra:townIdx" — the town index is new (the Ferry); an old button
  // without one means the town on screen.
  const [action, id, extra, tIdx] = data.split(":") as [string, CharacterId, string?, string?];
  const townPath = tgTownAt(tIdx);
  const L = lanesOf(townPath);
  const who = tgName(id) + tgTown(townPath);
  if (action === "ans") {
    const choice = L?.view(id).pendingChoice ?? null;
    const opt = choice?.questions?.[0]?.options?.[Number(extra)];
    if (opt) { tgExpect = null; await runInTown(townPath, { type: "answerQuestion", characterId: id, answers: [opt.label] }); await tg?.send(`✅ Told ${who}: "${tgEsc(opt.label)}"`); }
    else {
      // Say WHY on the log, so a lost tap can be traced (2026-11-03).
      log("tg", "tap found no question to answer", { id, town: townNameOf(townPath), lane: !!L, pending: !!choice, options: choice?.questions?.[0]?.options?.length ?? 0, picked: extra, working: L?.isWorking(id) ?? null });
      await tg?.send("That question isn't waiting anymore.");
    }
  } else if (action === "perm") {
    tgExpect = null; await runInTown(townPath, { type: "answerPermission", characterId: id, allow: extra === "allow" });
    await tg?.send(extra === "allow" ? `✅ Allowed — ${who} continues.` : `🚫 Denied — told ${who}.`);
  } else if (action === "retry") {
    await runInTown(townPath, { type: "retryJob", characterId: id }); await tg?.send(`🍳 ${who} — picking up where it left off.`);
  } else if (action === "scrap") {
    await runInTown(townPath, { type: "scrapJob", characterId: id }); await tg?.send(`🗑 Scrapped ${who}'s job.`);
  } else if (action === "cancel") {
    await runInTown(townPath, { type: "cancelJob", characterId: id }); await tg?.send(`🛑 Cancelled ${who}'s job.`);
  } else if (action === "new") {
    tgExpect = { mode: "job", id, town: townPath }; await tg?.send(`📋 What should ${who} do? Reply with the task.`);
  } else if (action === "resume") {
    await runInTown(townPath, { type: "resumePast", characterId: id, index: Number(extra), prompt: "I'm picking this order back up — continue from where we left off." });
    await tg?.send(`▶️ Reopened that order for ${who} and asked it to continue.`);
  } else if (action === "orders") {
    await sendTgOrders(townPath, id);
  } else if (action === "remind") {
    await runInTown(townPath, { type: "remindLater", characterId: id });
    await tg?.send(`📌 Pinned — ${who} keeps the red dot until you open it.`);
  } else if (action === "switch") {
    // A reply aimed at a past order while the character was busy: Maksym chose
    // to stop the current order and continue the old one with that reply.
    const held = tgSwitch; tgSwitch = null;
    if (!held) { await tg?.send("That reply isn't waiting anymore."); return; }
    await tgContinuePast(held.thread, held.index, held.text);
  } else if (action === "keep") {
    tgSwitch = null;
    await tg?.send(`👍 Kept ${who} on the current order — that reply was dropped.`);
  } else if (action === "mailmerge") {
    await mergeFromTown(townPath, Number(extra), "tg");
  } else if (action === "mailask") {
    await askReviewFromTown(townPath, Number(extra), "tg");
  } else if (action === "mailhand") {
    await handOffPull(townPath, Number(extra), id);
    await tg?.send(`🍳 ${tgName(id)} is on <b>#${Number(extra)}</b>${tgEsc(tgTown(townPath))}.`);
  } else if (action === "jirahand") {
    const lineId = String(extra || "").replace(/~/g, ":");
    await handOffJira(townPath, lineId, id);
    const key = jiraOf(townPath)?.lines.find((l) => l.id === lineId)?.key || lineId;
    await tg?.send(`🍳 ${tgName(id)} is on <b>${tgEsc(key)}</b>${tgEsc(tgTown(townPath))}.`);
  }
}

/** Make a past order the character's current session and send it the reply. The
 *  archive may have shifted since the reply arrived, so the index is re-found by
 *  session id at the moment of switching. */
async function tgContinuePast(thread: TgThread, index: number, text: string): Promise<void> {
  const L = lanesOf(thread.town);
  const who = tgName(thread.id) + tgTown(thread.town);
  const idx = L ? L.pastIndexOf(thread.id, thread.session) : -1;
  if (idx < 0) { await tg?.send(`Can't find that order of ${who}'s anymore — /orders lists what's there.`); return; }
  if (idx !== index) log("tg", "past order moved in the archive since the reply — re-found by session id", { was: index, now: idx });
  await runInTown(thread.town, { type: "resumePast", characterId: thread.id, index: idx, prompt: text });
  const sent = await tg?.send(`▶️ Reopened that order for ${who} and told it: "${tgEsc(text.slice(0, 200))}"`);
  tgRemember([sent ?? null], thread.town, thread.id); // the session is current now — remember it as such
}

async function handleTgCommand(cmd: string, args: string): Promise<void> {
  if (cmd === "start" || cmd === "help") {
    await tg?.send("🍍 <b>Bikini Bottom</b>\n/town — who's doing what\n/new — hand out a new job\n/orders — past orders per character\n/cancel — stop a running job\nWhen someone needs you, I message you with buttons.\n<b>Reply</b> (swipe) to any started / finished / asks message to continue that same order.");
  } else if (cmd === "town" || cmd === "status") {
    await sendTgTown();
  } else if (cmd === "new") {
    // Commands act on the town on screen (the buttons remember which one that was).
    await tg?.send(`Who should take this job?${currentTownPath && towns.size > 1 ? ` (in ${tgEsc(townNameOf(currentTownPath))})` : ""}`, [TG_CHARS.map((id) => ({ text: tgName(id), data: tgData("new", id, "", curTown()) }))]);
  } else if (cmd === "orders") {
    const id = TG_CHARS.find((c) => c === (args.toLowerCase() as CharacterId));
    if (id) await sendTgOrders(curTown(), id);
    else await tg?.send("Whose past orders?", [TG_CHARS.map((c) => ({ text: tgName(c), data: tgData("orders", c, "", curTown()) }))]);
  } else if (cmd === "cancel") {
    const id = TG_CHARS.find((c) => c === (args.toLowerCase() as CharacterId));
    if (id) await handleTgTap(tgData("cancel", id, "", curTown()));
    else await tg?.send("Cancel whose job?", [TG_CHARS.map((c) => ({ text: tgName(c), data: tgData("cancel", c, "", curTown()) }))]);
  } else if (TG_CHARS.includes(cmd as CharacterId)) {
    if (args) { await handleIntent({ type: "handOutJob", characterId: cmd as CharacterId, prompt: args }); await tg?.send(`📋 Handed ${tgName(cmd as CharacterId)} the job.`); }
    else { tgExpect = { mode: "job", id: cmd as CharacterId, town: curTown() }; await tg?.send(`What should ${tgName(cmd as CharacterId)} do? Reply with the task.`); }
  } else {
    await tg?.send("Didn't catch that — try /town, /new, /orders, /cancel.");
  }
}

async function handleTgText(text: string, ctx: TgTextCtx = { msgId: null, replyTo: null }): Promise<void> {
  // A swipe-reply to a message about a session goes into THAT session —
  // regardless of what the bot last asked for.
  const thread = tgThreads.lookup(ctx.replyTo);
  if (thread) { await handleTgReply(text, ctx.msgId, thread); return; }
  if (ctx.replyTo != null) {
    // Replied to something we don't remember (an older app run, a /town list…).
    log("tg", "reply to a message I don't remember", { replyTo: ctx.replyTo, remembered: tgThreads.size });
    await tg?.send("I don't know which order that message belongs to (it may be from before the last relaunch). Reply to a 'started' / 'finished' / 'asks' message, or use /orders.");
    return;
  }
  if (!tgExpect) { log("tg", "text with nothing expected", { text: text.slice(0, 60) }); await tg?.send("Not sure what that's for. Reply to a character's message to continue that order, or try /town or /new."); return; }
  const { mode, id, town } = tgExpect; tgExpect = null;
  const who = tgName(id) + tgTown(town);
  if (mode === "answer") {
    const answers = tgAnswersFor(town, id, text);
    await runInTown(town, { type: "answerQuestion", characterId: id, answers });
    tgRemember([ctx.msgId, await tg?.send(`✅ Told ${who}: "${tgEsc(answers.join(" · "))}"`) ?? null], town, id);
  }
  else {
    await runInTown(town, { type: "handOutJob", characterId: id, prompt: text });
    // startJob has run synchronously up to its first await → the lane's
    // taskStartedAt is the NEW job's; remember both messages against it.
    tgRemember([ctx.msgId, await tg?.send(`📋 Handed ${who} the job.`) ?? null], town, id);
  }
}

/** A batch of questions → one reply line per question; a bare number picks
 *  that option. A single question → the whole text is the answer. */
function tgAnswersFor(town: string, id: CharacterId, text: string): string[] {
  const qs = lanesOf(town)?.view(id).pendingChoice?.questions || [];
  if (qs.length <= 1) return [text];
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return qs.map((q, qi) => {
    const line = lines[qi] || "";
    const n = /^\d+[.)]?$/.test(line) ? parseInt(line, 10) : 0;
    return (n >= 1 && n <= q.options.length) ? q.options[n - 1].label : line;
  });
}

/** Reply-to-continue: the text goes into the session behind the replied-to
 *  message. Current session → a follow-up (or the answer, if it's asking).
 *  A past order → reopened with this text, after a "switch?" when the
 *  character is busy with something else. */
async function handleTgReply(text: string, msgId: number | null, thread: TgThread): Promise<void> {
  const { town, id } = thread;
  const L = lanesOf(town);
  const who = tgName(id) + tgTown(town);
  if (!L) { await tg?.send(`That town isn't open anymore.`); return; }
  const route = routeReply(thread, {
    terminal: TERMINAL_IDS.has(id),
    working: L.isWorking(id),
    asking: L.hasPendingChoice(id),
    approving: L.hasPendingAsk(id),
    session: L.sessionIdFor(id),
    startedAt: L.view(id).taskStartedAt,
    pastIndex: L.pastIndexOf(id, thread.session),
  });
  log("tg", `reply → ${route.kind}`, { id, town: townNameOf(town), session: thread.session });
  switch (route.kind) {
    case "terminal":
      await tg?.send(`${who} works in a terminal — I can't type a reply into it from here. Use /${id} <task> for a new job.`);
      return;
    case "answer": {
      tgExpect = null;
      const answers = tgAnswersFor(town, id, text);
      await runInTown(town, { type: "answerQuestion", characterId: id, answers });
      tgRemember([msgId, await tg?.send(`✅ Told ${who}: "${tgEsc(answers.join(" · "))}"`) ?? null], town, id);
      return;
    }
    case "approval":
      await tg?.send(`${who} is waiting for a yes or no — tap Allow or Deny on that message; words don't answer it.`);
      return;
    case "followUp":
      await runInTown(town, { type: "followUp", characterId: id, prompt: text });
      tgRemember([msgId, await tg?.send(L.isWorking(id) ? `💬 Passed that to ${who} while it works.` : `💬 Told ${who} — it's picking the order back up.`) ?? null], town, id);
      return;
    case "resume":
      await tgContinuePast(thread, route.index, text);
      if (msgId != null) tgRemember([msgId], town, id);
      return;
    case "switch": {
      tgSwitch = { text, thread, index: route.index };
      const busyWith = L.hasPendingChoice(id) ? "is asking you something" : L.hasPendingAsk(id) ? "is waiting for your approval" : "is busy with another order";
      await tg?.send(`${who} ${busyWith}. That reply belongs to an earlier order — switch to it? (stops the current one)`, [[
        { text: "⏭ Switch", data: tgData("switch", id, "", town) },
        { text: "✋ Keep current", data: tgData("keep", id, "", town) },
      ]]);
      return;
    }
    case "lost":
      await tg?.send(`Can't find that order of ${who}'s anymore — /orders lists what's there.`);
      return;
  }
}

async function sendTgTown(): Promise<void> {
  if (!tg || !lanes) return;
  const snap = snapshot();
  const orders = snap.orders;
  const lines = TG_CHARS.map((id) => {
    let s = "💤 idle";
    if (snap.characters.find((c) => c.id === id)?.reminded) s = "📌 " + s; // pinned: come back to this
    const booth = lanes!.view(id).booth; // the phone booth, before the working word
    if (booth === "holding") s = "📱 on the phone";
    else if (booth === "queued") s = "⏳ waiting for the phone";
    else if (lanes!.isWorking(id)) s = "⏳ working";
    else if (lanes!.hasPendingChoice(id) || lanes!.hasPendingAsk(id)) s = "❓ waiting for you";
    else if (lanes!.limitedUntil(id)) s = `⏳ waiting for Claude's limit (resets ${fmtClock(lanes!.limitedUntil(id))})`;
    else if (lanes!.isPaused(id)) s = "⏸ paused — keep cooking?";
    else if (lanes!.isBurned(id)) s = "⚠️ hit a snag";
    const title = lanes!.lastPromptFor(id);
    // The chalk line — or, while working in silence, how long it's been quiet.
    const v = lanes!.view(id);
    let note = "";
    if (v.note) note = `\n   ↳ ${tgEsc(v.note)}`;
    else if (lanes!.isWorking(id)) note = `\n   ↳ (no update yet${v.taskStartedAt ? ` · ${Math.max(1, Math.round((Date.now() - v.taskStartedAt) / 60_000))} min` : ""})`;
    // Needs you? Add what it's asking / the last thing it said, so you can decide from the phone.
    const line = orders.find((o) => o.characterId === id);
    const needsYou = line && line.attention && line.attention !== "done" && line.attention !== "limit";
    const preview = needsYou && line!.preview ? `\n   💬 ${tgEsc(line!.preview)}` : "";
    // (a pinned character shows 📌 before its status word)
    return `<b>${tgEsc(tgName(id))}</b>: ${s}${title ? `\n   ↳ ${tgEsc(title.slice(0, 60))}` : ""}${note}${preview}`;
  });
  // The reserve light, when lit: one line per lit window.
  const fuel = lanes.fuel();
  for (const w of [fuelWord(fuel.fiveHour, Date.now(), "Reserve"), fuelWord(fuel.sevenDay, Date.now(), "Weekly reserve")]) if (w) lines.push(`⛽ ${tgEsc(w)}`);
  // The Mailbox: what needs you on the team repo, then how much else is on the paper.
  const mail = currentTownPath ? mails.get(currentTownPath) : null;
  if (mail) {
    const need = mail.lines.filter((l) => l.forYou);
    lines.push("", need.length ? `✉️ <b>Mail: ${need.length} for you</b>` : `✉️ Mail: nothing for you (${mail.lines.length} open)`);
    for (const l of need.slice(0, 6)) lines.push(`   <b>#${l.number}</b> ${tgEsc(l.status)} — ${tgEsc(l.title.slice(0, 50))}\n     ↳ ${tgEsc(l.reason)}`);
    if (mail.error) lines.push(`   ⚠️ last look failed: ${tgEsc(mail.error)}`);
  }
  // The Jira page: notes waiting for you, then the plate.
  const jb = jiraOf(currentTownPath);
  if (jb) {
    const need = jb.lines.filter((l) => l.forYou);
    lines.push("", need.length ? `📋 <b>Jira: ${need.length} for you</b>` : `📋 Jira: nothing new (${jb.open} open tickets of yours)`);
    for (const l of need.slice(0, 6)) lines.push(`   <b>${tgEsc(l.key)}</b> ${tgEsc(l.label)} — ${tgEsc(l.title.slice(0, 50))}\n     ↳ ${tgEsc(l.reason)}`);
    if (jb.plate.length) lines.push(`   ${tgEsc(jb.plate.map((p) => `${p.status} ${p.count}`).join(" · "))}`);
    if (jb.error) lines.push(`   ⚠️ last look failed: ${tgEsc(jb.error)}`);
  }
  // The other towns, one line each — the ferry's view from the phone.
  const others = snap.towns.filter((t) => !t.current);
  if (others.length) {
    lines.push("");
    for (const t of others) lines.push(`🛳 <b>${tgEsc(t.name)}</b>: ${t.missing ? "folder missing" : `${t.cooking} cooking, ${t.needsYou} need you${t.mail ? `, ✉️ ${t.mail} mail` : ""}`}`);
  }
  const title = towns.size > 1 ? `🏙 <b>Town status · ${tgEsc(townNameOf(currentTownPath))}</b>` : "🏙 <b>Town status</b>";
  await tg.send(title + "\n" + lines.join("\n"));
}

async function sendTgOrders(townPath: string, id: CharacterId): Promise<void> {
  const lanes = lanesOf(townPath);
  if (!tg || !lanes) return;
  const past = lanes.view(id).pastSessions;
  if (!past.length) { await tg.send(`${tgName(id)}${tgTown(townPath)} has no past orders yet.`); return; }
  const rows: TgButton[][] = past.slice().reverse().slice(0, 12).map((p) => [{ text: p.title.slice(0, 40), data: tgData("resume", id, p.index, townPath) }]);
  await tg.send(`📜 <b>${tgEsc(tgName(id) + tgTown(townPath))}</b> — past orders (tap to reopen & continue):`, rows);
}

// A terminal character's picture is driven here (SDK chars use the lane engine).
// The TerminalManager reports 'working' when busy and 'calling' when a reply
// settles; we persist it as a state event so the street icon updates, then reuse
// markSeenIfWatching so 'calling' clears to idle if you're already watching it.
async function onTerminalState(townPath: string, id: CharacterId, state: CharacterState): Promise<void> {
  const t = towns.get(townPath);
  if (!t) return;
  await t.log.append({ type: "CharacterStateChanged", id, state });
  onLaneChange();
}

/** WHY a character needs you — ONE predicate order, shared by the Orders board,
 *  the street label and Telegram /town (it was /town's order first). */
function attentionFor(id: CharacterId, state: CharacterState): Attention {
  if (!lanes) return null;
  if (lanes.isWorking(id)) return null;
  if (lanes.hasPendingChoice(id)) return "question";
  if (lanes.hasPendingAsk(id)) return "approval";
  if (lanes.limitedUntil(id)) return "limit";
  if (lanes.isPaused(id)) return "paused";
  if (lanes.isBurned(id)) return "snag";
  if (lanes.view(id).collision) return "collision";
  if (state === "calling") return "done";
  return null;
}

/** Board words for each attention, kitchen vocabulary (no car metaphors). */
const ORDER_WORD: Record<Exclude<Attention, null>, OrderStatus> = {
  question: "ASKING YOU", approval: "NEEDS A YES", limit: "ON HOLD", paused: "CHECK-IN",
  snag: "BURNED", collision: "MIXED UP", done: "SERVED",
};

/** Derive the Orders Board (FR-9, FR-10) from each Lane's current situation. */
function buildOrders(chars: TownSnapshot["characters"]): TownSnapshot["orders"] {
  if (!lanes) return [];
  const out: TownSnapshot["orders"] = [];
  for (const c of chars) {
    if (c.isHomeBase) continue;
    const title = lanes.lastPromptFor(c.id);
    if (!title) continue; // never had a Job → no line
    const v = lanes.view(c.id);
    const attention = attentionFor(c.id, c.state);
    let status: OrderStatus;
    if (v.booth === "holding") status = "ON THE PHONE";
    else if (v.booth === "queued") status = "WAITING FOR PHONE";
    else if (lanes.isWorking(c.id)) status = "COOKING";
    else if (attention && attention !== "done") status = ORDER_WORD[attention];
    else if (v.sentBack) status = "SENT BACK";
    else status = "SERVED";
    // The preview: the question being asked, the permission wanted, or else
    // the last thing the character said (tool chatter excluded).
    const lastSaid = v.conversation.slice().reverse().find((m) => m.from === "them" && !m.tool)?.text ?? null;
    const preview = attention === "question" ? previewOf(v.pendingChoice?.questions?.[0]?.question)
      : attention === "approval" ? previewOf(v.pendingAsk)
      : previewOf(lastSaid);
    out.push({
      characterId: c.id, name: c.name, title: title.replace(/\s+/g, " ").slice(0, 48), status, note: v.note,
      attention, preview, since: v.phaseSince, holdUntil: v.limitedUntil,
      slug: status.toLowerCase().replace(/\s+/g, "-"),
    });
  }
  return out;
}

function snapshot(): TownSnapshot {
  const base = projectLog ? fold(projectLog.all()) : emptyTown();
  // The chalk line lives in the lane (not the event log) — fill it in here.
  if (lanes) for (const c of base.characters) { if (!c.isHomeBase) { const v = lanes.view(c.id); c.note = v.note; c.noteAt = v.noteAt; c.attention = attentionFor(c.id, c.state); c.booth = v.booth; } }
  // The reviewer (Karen): flagged from the roster, on the street only while reviewing.
  for (const c of base.characters) { c.reviewer = REVIEWER_IDS.has(c.id); c.visible = visibleOnStreet(c); }
  applyFixture(base); // dev/screenshot hook only (BIKINI_FIXTURE) — a no-op in normal runs
  // Resolve every visual through the Asset Slot resolver (AD-7).
  for (const c of base.characters) {
    c.picture = resolvePicture(ASSETS_DIR, c.id, c.state);
    // Where someone stands is the roster's call, not the town log's: the log
    // registered them once (with that day's spot) and a move must reach every town.
    c.pos = ROSTER.find((r) => r.id === c.id)?.pos ?? c.pos;
  }
  base.background = resolveBackground(ASSETS_DIR, base.background) ?? base.background;
  base.firstRun = firstRun;
  base.openWindow = buildWindow(base.characters);
  base.orders = (base as any).__fixtureOrders || buildOrders(base.characters);
  base.muted = muted;
  // Portraits for all UI chrome (no emoji, AD-7).
  base.faces = {};
  for (const r of ROSTER) base.faces[r.id] = resolveFace(ASSETS_DIR, r.id);
  // The reserve light (town-wide usage windows), and its words when lit.
  base.fuel = lanes?.fuel() ?? EMPTY_FUEL;
  base.fuelSign = (base as any).__fixtureFuelSign !== undefined ? (base as any).__fixtureFuelSign : fuelSignFor(base.fuel);
  delete (base as any).__fixtureOrders; delete (base as any).__fixtureFuelSign;
  // The Ferry: every town for the sign, the shown town's name, the add-a-town card.
  const fx = loadFixture();
  base.towns = fx?.towns ?? townTabs();
  base.townName = fx?.townName ?? base.towns.find((t) => t.current)?.name ?? townNameOf(currentTownPath);
  base.addingTown = fx?.addingTown ?? addingTown;
  // The Phone Booth prop (runtime state from the lane engine, never the event log).
  base.booth = boothView();
  // The Mailbox (pull requests): runtime state from the town's mail reader.
  base.mail = fx?.mail !== undefined ? fx.mail : mailViewFor(currentTownPath, base.characters);
  base.jira = fx?.jira !== undefined ? fx.jira : jiraViewFor(currentTownPath, base.characters);
  return base;
}

// Dev/screenshot hook ONLY (like BIKINI_BOARD / BIKINI_OPEN): BIKINI_FIXTURE=<file.json>
// overlays parts of the snapshot so a state that needs a live job (a working
// character with a chalk line, a full Orders board) can be photographed with
// `BIKINI_CAPTURE` and no job running. Shape: { characters?: { [id]: Partial<CharacterView> },
// orders?: OrderLine[], fuelSign?: FuelSign }. Unset in normal runs → no-op.
type Fixture = { characters?: Record<string, Partial<TownSnapshot["characters"][number]>>; orders?: TownSnapshot["orders"]; fuelSign?: FuelSign | null; pointerUrl?: string; window?: Partial<WindowView>; towns?: TownTab[]; townName?: string; addingTown?: AddingTown; booth?: BoothView | null; mail?: MailView | null; jira?: JiraView | null };
let fixture: Fixture | null | undefined;
function loadFixture(): Fixture | null {
  if (fixture === undefined) {
    fixture = null;
    const f = process.env.BIKINI_FIXTURE;
    if (f) { try { fixture = JSON.parse(require("node:fs").readFileSync(f, "utf8")); } catch (e) { log("app", "BIKINI_FIXTURE unreadable — ignored", { error: String(e) }); } }
  }
  return fixture ?? null;
}
function applyFixture(base: TownSnapshot): void {
  loadFixture();
  if (!fixture) return;
  if (fixture.characters) for (const c of base.characters) Object.assign(c, fixture.characters[c.id] || {});
  if (fixture.orders) (base as any).__fixtureOrders = fixture.orders;
  if (fixture.fuelSign !== undefined) (base as any).__fixtureFuelSign = fixture.fuelSign;
}

function pushSnapshot(): void {
  // The pointer's engine floats over the page: it may only show inside the lane's
  // own open Work Window (not another window, not a past order, not First Run).
  if (pointer) {
    const viewingPast = !!(openWindowId && openWindowId !== "krabs" && lanes && lanes.view(openWindowId).viewing);
    pointer.reconcile(firstRun ? null : openWindowId, viewingPast);
  }
  if (winAlive()) win!.webContents.send(CHANNELS.snapshot, snapshot());
}

/** A transient one-liner for the tray (never persisted, like sound cues). */
function toast(text: string): void {
  if (winAlive()) win!.webContents.send(CHANNELS.toast, { text });
}

// The lane engine's "something changed" callback. If a Character finishes/needs
// attention (goes Calling) WHILE you're already watching its open, visible
// window, that result is already seen — so clear it straight back to Idle
// instead of leaving a "calling" icon until you reopen (Maksym's report).
function onLaneChange(): void {
  void markSeenIfWatching();
  updateSleepBlocker();
  pushSnapshot();
}

// Keep the Mac awake the ENTIRE time Bikini Bottom is running — not just when a
// character is working — so the app can always reach you on Telegram (answer a
// question, take a new job, push an update) even while you're away and idle.
// "prevent-app-suspension" keeps the SYSTEM awake but still lets the DISPLAY
// sleep to save power. Released automatically when the app quits.
let sleepBlockerId: number | null = null;
function updateSleepBlocker(): void {
  if (sleepBlockerId !== null && powerSaveBlocker.isStarted(sleepBlockerId)) return;
  sleepBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  log("app", "sleep blocker ON — staying awake the whole time Bikini Bottom runs");
}

async function markSeenIfWatching(): Promise<void> {
  if (!projectLog || openWindowId == null || !win || !win.isVisible()) return;
  const id = openWindowId;
  const c = fold(projectLog.all()).characters.find((x) => x.id === id);
  // "Calling" but not working and not awaiting a permission answer = a finished
  // or burned result. You're looking at it → mark seen (persisted, so it stays
  // Idle after you close). A pending permission ask still needs your answer, so
  // it's left alone.
  if (c && c.state === "calling" && !(lanes?.isWorking(id) ?? false) && !(lanes?.hasPendingAsk(id) ?? false) && !(lanes?.hasPendingChoice(id) ?? false)) {
    await projectLog.append({ type: "CharacterStateChanged", id, state: "idle" });
    pushSnapshot();
  }
}

/** Run the live Claude connection check and reflect it into First Run (AD-8). */
async function runClaudeCheck(): Promise<void> {
  if (!firstRun || firstRun.step !== "claude") return;
  firstRun = { ...firstRun, claude: { status: "working", message: "Knocking on Claude's door…" } };
  pushSnapshot();
  const res = await checkClaude();
  if (!firstRun || firstRun.step !== "claude") return;
  firstRun = {
    ...firstRun,
    claude: { status: res.connected ? "ok" : "warn", message: res.message },
  };
  pushSnapshot();
}

/** The last step of "Add a town": write the profile once (landing + phone), list
 *  the town, open it and put it on the street. Errors go back onto the card. */
async function finishAddTown(folder: string, landing: "none" | "auto", device: DeviceSpec | null): Promise<void> {
  // A folder Bikini knew before keeps its profile; the answers win on landing + phone.
  const existing = loadProfile(folder, (f) => readFileSync(f, "utf8"));
  const profile: TownProfile = existing ? { ...existing, landing } : seedProfile(folder, landing);
  if (device) profile.device = device; else delete profile.device;
  // Lane setup: a Flutter folder gets the seed recipe (packages, generated code,
  // env files) unless the profile already carries one Maksym edited.
  if (!profile.setup) {
    const setup = seedSetup((rel) => existsSync(path.join(folder, rel)));
    if (setup) profile.setup = setup;
  }
  try {
    mkdirSync(path.dirname(profilePath(folder)), { recursive: true });
    writeFileSync(profilePath(folder), serializeProfile(profile), "utf8");
  } catch (e) {
    log("town", "profile could not be written", { folder, error: String(e) });
    addingTown = { path: folder, prep: { status: "error", message: "I couldn't write the town's profile in that folder. Try another one." } };
    pushSnapshot();
    return;
  }
  if (!cfg.data.towns.some((t) => t.path === folder)) await cfg.save({ towns: [...cfg.data.towns, { path: folder }] });
  try { await openTown(folder); }
  catch (e) {
    log("town", "could not open the new town", { folder, error: String(e) });
    addingTown = { path: folder, prep: { status: "error", message: "I couldn't open that folder as a town. Try another one." } };
    pushSnapshot();
    return;
  }
  addingTown = null;
  showTown(folder);
}

/** Does this folder look like a Flutter (+ Maestro) project? */
function isFlutterProject(folder: string): boolean {
  return existsSync(path.join(folder, "pubspec.yaml")) || existsSync(path.join(folder, ".maestro"));
}

/** The simulators on this Mac for the phone picker (booted first). Empty when
 *  `xcrun` is missing or says nothing — the card then only offers "No phone". */
function listSimulators(): Promise<AddingTown["devices"]> {
  return new Promise((resolve) => {
    execFile("xcrun", ["simctl", "list", "devices", "available", "-j"], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) { log("booth", "simctl list failed — no simulators offered", { error: String(err).slice(0, 120) }); resolve([]); return; }
      resolve(parseSimctlDevices(String(stdout)));
    });
  });
}

async function handleIntent(intent: Intent): Promise<void> {
  if (intent.type !== "pointerBounds") log("intent", intent.type, { ...intent, type: undefined, notes: undefined });
  switch (intent.type) {
    case "rendererReady":
      pushSnapshot();
      // On resume directly into the Claude step, run the check once.
      if (firstRun && firstRun.step === "claude" && firstRun.claude.status === "idle") void runClaudeCheck();
      break;

    case "firstRunNext":
      if (firstRun && firstRun.step === "welcome") {
        firstRun = { ...firstRun, step: "folder" };
        await cfg.save({ firstRunStep: "folder" });
        pushSnapshot();
      }
      break;

    case "firstRunCheckClaude":
      await runClaudeCheck();
      break;

    case "firstRunClaudeNext":
      if (firstRun && firstRun.step === "claude") {
        firstRun = { ...firstRun, step: "notifications" };
        await cfg.save({ firstRunStep: "notifications" });
        pushSnapshot();
      }
      break;

    case "firstRunNotifyAllow":
      if (firstRun && firstRun.step === "notifications") {
        // Firing one notification triggers the macOS permission prompt.
        if (Notification.isSupported()) {
          new Notification({ title: "Bikini Bottom", body: "I'll holler when yer crew needs ye!", silent: true }).show();
        }
        await cfg.save({ notificationsWanted: true, firstRunStep: "ready" });
        firstRun = { ...firstRun, step: "ready", notify: { choice: "allowed", message: "" } };
        pushSnapshot();
      }
      break;

    case "firstRunNotifySkip":
      if (firstRun && firstRun.step === "notifications") {
        await cfg.save({ notificationsWanted: false, firstRunStep: "ready" });
        firstRun = {
          ...firstRun, step: "ready",
          notify: { choice: "declined", message: "Suit yerself! Ye can allow it later in System Settings — the red dots never lie anyway." },
        };
        pushSnapshot();
      }
      break;

    case "firstRunChooseFolder": {
      if (!firstRun) break;
      const picked = await dialog.showOpenDialog(win!, {
        title: "Which folder is your project?",
        properties: ["openDirectory", "createDirectory"],
        buttonLabel: "Use this folder",
      });
      if (picked.canceled || picked.filePaths.length === 0) break;
      const projectPath = picked.filePaths[0];

      // Show "working" while we prepare the folder (AD-9).
      firstRun = { step: "folder", projectPath, prep: { status: "working", message: "Setting up my kitchen…" }, claude: IDLE_CLAUDE, notify: IDLE_NOTIFY };
      pushSnapshot();

      const result = await prepareProject(projectPath);
      if (result.ok) {
        await cfg.save({ projectPath, firstRunStep: "claude" });
        firstRun = { step: "claude", projectPath, prep: { status: "ok", message: result.message }, claude: IDLE_CLAUDE, notify: IDLE_NOTIFY };
        pushSnapshot();
        void runClaudeCheck();
      } else {
        // Leave the step on "folder" so Maksym can pick another folder.
        firstRun = { step: "folder", projectPath: null, prep: { status: "error", message: result.message }, claude: IDLE_CLAUDE, notify: IDLE_NOTIFY };
        pushSnapshot();
      }
      break;
    }

    case "firstRunOpenTown": {
      if (!firstRun || firstRun.step !== "ready" || !cfg.data.projectPath) break;
      const first = cfg.data.projectPath;
      await cfg.save({ firstRunComplete: true, towns: cfg.data.towns.some((t) => t.path === first) ? cfg.data.towns : [...cfg.data.towns, { path: first }] });
      try { await openTown(first); }
      catch (e) { log("town", "the first town could not be opened", { path: first, error: String(e) }); break; }
      firstRun = null; // town opens; overlay lifts
      showTown(first);
      break;
    }

    // ── The Ferry: switch towns, add one ──
    case "switchTown": {
      if (towns.has(intent.path)) { showTown(intent.path); break; }
      // A town whose folder was missing at launch may be back (a drive plugged in).
      if (cfg.data.towns.some((t) => t.path === intent.path)) {
        try { await openTown(intent.path); showTown(intent.path); }
        catch (e) { log("town", "still missing", { path: intent.path, error: String(e) }); pushSnapshot(); }
      }
      break;
    }

    case "refreshMail":
      if (currentTownPath) void pollMail(currentTownPath);
      break;

    case "refreshJira": {
      const k = currentTownPath ? townJira.get(currentTownPath) : null;
      if (k && jiras.has(k)) void pollJira(k);
      else if (k && jiraConfigured() && currentTownPath) void startJira(currentTownPath, towns.get(currentTownPath)!.profile);
      break;
    }

    case "openJira":
      if (/^[A-Z][A-Z0-9]+-\d+$/.test(intent.key)) void shell.openExternal(`${jiraSite()}/browse/${intent.key}`);
      else if (intent.url && intent.url.startsWith(jiraSite() + "/")) void shell.openExternal(intent.url); // a batch line: a Jira search over its tickets
      break;

    case "saveJira":
      await saveJiraSettings(String(intent.email || ""), String(intent.token || ""), String(intent.site || ""));
      break;

    case "jiraSeen":
      jiraSeenNow(currentTownPath);
      break;

    case "sweepJira":
      if (currentTownPath) await sweepFromTown(currentTownPath, intent.characterId);
      break;
    case "handOffJira":
      if (currentTownPath) await handOffJira(currentTownPath, intent.id, intent.characterId);
      break;

    case "openPull": {
      const l = currentTownPath ? mails.get(currentTownPath)?.lines.find((x) => x.number === intent.number) : null;
      if (l) void shell.openExternal(l.url);
      break;
    }

    case "mergePull":
      if (currentTownPath) await mergeFromTown(currentTownPath, intent.number, "street");
      break;

    case "askReview":
      if (currentTownPath) await askReviewFromTown(currentTownPath, intent.number, "street");
      break;

    case "handOffPull":
      if (currentTownPath) await handOffPull(currentTownPath, intent.number, intent.characterId);
      break;

    case "forgetTown": {
      // Only a MISSING town can be forgotten (its folder is gone — e.g. Scout &
      // Runner, 2026-10-05). An open town has lanes; it stays.
      if (towns.has(intent.path)) { log("town", "forget refused — town is open", { path: intent.path }); break; }
      if (!cfg.data.towns.some((t) => t.path === intent.path)) break;
      await cfg.save({ towns: cfg.data.towns.filter((t) => t.path !== intent.path) });
      missingTowns.delete(intent.path);
      log("town", "forgotten", { path: intent.path });
      pushSnapshot();
      break;
    }

    case "addTown": {
      if (firstRun) break;
      const picked = await dialog.showOpenDialog(win!, {
        title: "Which folder is the new town's project?",
        properties: ["openDirectory", "createDirectory"],
        buttonLabel: "Use this folder",
      });
      if (picked.canceled || picked.filePaths.length === 0) break;
      const folder = picked.filePaths[0];
      if (towns.has(folder)) { addingTown = null; showTown(folder); break; } // already a town → just go there
      addingTown = { path: folder, prep: { status: "working", message: "Setting up my kitchen…" } };
      pushSnapshot();
      const result = await prepareProject(folder); // safe, idempotent, git-ignores .bikini (AD-9)
      if (!addingTown || addingTown.path !== folder) break; // "Never mind" while preparing
      addingTown = { path: folder, prep: { status: result.ok ? "ok" : "error", message: result.message } };
      // A Flutter project (pubspec.yaml or a .maestro/ folder) gets the phone
      // question after the landing one: list the simulators on this Mac now.
      if (result.ok && isFlutterProject(folder)) {
        const devices = await listSimulators();
        if (!addingTown || addingTown.path !== folder) break;
        addingTown = { ...addingTown, devices };
      }
      pushSnapshot();
      break;
    }

    case "addTownKind": {
      // The one question, answered: team repo (landing none) or my own (auto).
      if (!addingTown || !addingTown.path || addingTown.prep.status !== "ok") break;
      const landing = intent.landing === "auto" ? "auto" : "none";
      // A Flutter town has one more question (the phone): hold this answer and
      // show the picker; the profile is written ONCE, with both answers.
      if (addingTown.devices) { addingTown = { ...addingTown, landing }; pushSnapshot(); break; }
      await finishAddTown(addingTown.path, landing, null);
      break;
    }

    case "addTownPhone": {
      // The phone question, answered (a simulator, or "no phone for this town").
      if (!addingTown || !addingTown.path || addingTown.prep.status !== "ok" || !addingTown.landing) break;
      const picked = intent.deviceId ? (addingTown.devices || []).find((d) => d.id === intent.deviceId) : null;
      const device: DeviceSpec | null = picked ? { kind: "ios-simulator", id: picked.id, name: picked.name } : null;
      await finishAddTown(addingTown.path, addingTown.landing, device);
      break;
    }

    case "cancelAddTown":
      addingTown = null;
      pushSnapshot();
      break;

    case "openCharacter": {
      openWindowId = intent.id;
      // Mr. Krabs greets you when you step into the Krusty Krab.
      if (intent.id === "krabs") emitSoundCue(curTown(), "krabs", "start");
      // Opening a finished (Calling, not working) Character means the result is
      // now seen → clears the dot back to Idle (FR-4; AD-12 refinement later).
      const c = (projectLog ? fold(projectLog.all()).characters : []).find((x) => x.id === intent.id);
      if (c && c.state === "calling" && !(lanes?.isWorking(intent.id) ?? false)) {
        await projectLog!.append({ type: "CharacterStateChanged", id: intent.id, state: "idle" });
      }
      // Opening a pinned ("come back later") character clears the pin.
      if (c && c.reminded) await projectLog!.append({ type: "ReminderCleared", id: intent.id });
      pushSnapshot();
      break;
    }

    case "remindLater": {
      // "Come back later": put the red dot back on a character already looked at.
      // Closes the window so the dot is visible on the street. Cleared by opening
      // the character again, or by handing it a genuinely new order (the fold).
      if (!projectLog) break;
      await projectLog.append({ type: "ReminderSet", id: intent.characterId });
      openWindowId = null;
      log("intent", `remind later ${intent.characterId}`);
      pushSnapshot();
      break;
    }

    case "closeWindow":
      openWindowId = null;
      pushSnapshot();
      break;

    case "handOutJob":
      if (!lanes) break;
      openWindowId = intent.characterId; // switch to that Character's Work Window to watch
      // (No Krabs "order up" cue here — it collided with the character's own start
      //  sound. Krabs only speaks when you open the Krusty Krab window.)
      pushSnapshot();
      // Terminal char (squid): start a FRESH terminal session and type the job.
      // Attachments are saved into the lane and their paths appended to the job
      // (a terminal has no chat bubble to embed files in — Claude opens them by
      // path). If its terminal is already warm, do it now; if cold, hold the job
      // until the renderer mounts (term:open) so no startup output is lost.
      if (TERMINAL_IDS.has(intent.characterId)) {
        let jobText = intent.prompt;
        if (intent.attachments && intent.attachments.length && lanes) {
          const paths = await lanes.saveAttachments(intent.characterId, intent.attachments);
          if (paths.length) jobText += `\n\nI've attached these files — please open them:\n${paths.map((p) => "- " + p).join("\n")}`;
        }
        if (terminals?.has(intent.characterId)) terminals.startJob(intent.characterId, jobText);
        else pendingTermJob[intent.characterId] = jobText;
        break;
      }
      void lanes.startJob(intent.characterId, intent.prompt, intent.attachments); // streams via onChange
      break;

    case "followUp":
      if (!lanes || TERMINAL_IDS.has(intent.characterId)) break; // terminal chars type into their pty, not the SDK
      void lanes.followUp(intent.characterId, intent.prompt, intent.attachments);
      break;

    case "answerPermission":
      if (lanes) void lanes.answerPermission(intent.characterId, intent.allow);
      break;

    case "answerQuestion":
      if (lanes) void lanes.answerQuestion(intent.characterId, intent.answers, intent.attachments);
      break;

    case "cancelJob":
      if (lanes) void lanes.cancel(intent.characterId);
      break;

    case "openTerminal": {
      if (!lanes) break;
      // Open a real interactive terminal in this character's lane worktree, and
      // resume THIS character's exact Claude session (the SDK-written session
      // won't show in `claude --resume`'s picker, but resuming by id works).
      // This is the escape hatch for anything the headless session can't do,
      // e.g. an interactive connector OAuth like monday.com.
      const dir = lanes.worktreeDir(intent.characterId);
      // Only resume the session if the character is NOT currently cooking —
      // resuming a live session in a second process hijacks Bikini's own run
      // and makes it look "burned". While working, just open the folder.
      const sid = lanes.isWorking(intent.characterId) ? null : lanes.sessionIdFor(intent.characterId);
      const cmd = sid
        ? `cd '${dir}' && export PATH=/opt/homebrew/opt/node@22/bin:$PATH && claude --resume ${sid}`
        : `cd '${dir}'`;
      log("terminal", `open ${intent.characterId}`, { dir, resumeSession: !!sid, working: lanes.isWorking(intent.characterId) });
      execFile("osascript", [
        "-e", `tell application "Terminal" to do script ${JSON.stringify(cmd)}`,
        "-e", 'tell application "Terminal" to activate',
      ], () => {});
      break;
    }

    case "terminalResume":
      // Reopen a terminal char on a chosen past Claude session (`claude --resume`).
      if (TERMINAL_IDS.has(intent.characterId)) {
        openWindowId = intent.characterId;
        pushSnapshot();
        terminals?.resume(intent.characterId, intent.sessionId);
      }
      break;

    case "retryJob":
      if (lanes) void lanes.retry(intent.characterId);
      break;

    case "scrapJob":
      if (lanes) void lanes.scrap(intent.characterId);
      break;

    case "sendItBack":
      if (lanes) void lanes.sendItBack(intent.characterId);
      break;

    case "resolveCollision":
      if (lanes) void lanes.resolveCollision(intent.characterId, intent.keepMine);
      break;

    case "openPast":
      pointer?.close(); // pointing only makes sense on the live order
      if (lanes) lanes.openPast(intent.characterId, intent.index);
      break;

    // ── Point at it (Orca plan, Job 5) ──
    case "pointerOpen": {
      const url = pointerUrlFor(intent.characterId);
      if (pointer && url && openWindowId === intent.characterId) pointer.open(intent.characterId, url);
      break;
    }
    case "pointerClose":
      pointer?.close();
      break;
    case "pointerBounds":
      pointer?.setBounds({ x: intent.x, y: intent.y, w: intent.w, h: intent.h });
      break;
    case "pointerArm":
      pointer?.arm(intent.on);
      break;
    case "pointerView":
      if (pointer) await pointer.setView(intent.characterId, intent.view);
      break;
    case "removePick":
      pointer?.removePick(intent.characterId, intent.id);
      break;
    case "previewPicks":
      pointer?.openPreview(intent.characterId, intent.notes || {});
      break;
    case "closePreview":
      pointer?.closePreview();
      break;
    case "sendPicks": {
      // ONE follow-up: the short composed brief + each picture inline + the JSON
      // file (saved into the lane, path handed over). A lane that never had an
      // order gets it as its first order instead.
      if (!pointer || !lanes) break;
      const out = pointer.take(intent.characterId, intent.notes || {});
      if (!out) break;
      if (lanes.view(intent.characterId).conversation.length) void lanes.followUp(intent.characterId, out.text, out.attachments);
      else void lanes.startJob(intent.characterId, out.text, out.attachments);
      break;
    }

    case "closePast":
      if (lanes) lanes.closePast(intent.characterId);
      break;

    case "setReadOnly":
      if (lanes) lanes.setReadOnly(intent.characterId, intent.readOnly);
      break;

    case "askPast":
      if (lanes) void lanes.askPast(intent.characterId, intent.prompt);
      break;

    case "resumePast":
      if (lanes) void lanes.resumePast(intent.characterId, intent.index, intent.prompt);
      break;

    case "toggleMute":
      muted = !muted;
      await cfg.save({ muted });
      pushSnapshot();
      break;
  }
}

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1100, height: 720, minWidth: 720, minHeight: 460,
    backgroundColor: "#04222f", title: "Bikini Bottom", show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });

  win.once("ready-to-show", () => {
    win?.show();
    const capturePath = process.env.BIKINI_CAPTURE;
    if (capturePath) {
      const delay = Number(process.env.BIKINI_CAPTURE_DELAY || 1400);
      setTimeout(async () => {
        try {
          let img = await win!.webContents.capturePage();
          // The pointer's engine is a child view the page capture can't see —
          // paste its own picture into place so the photo shows what Maksym sees.
          const over = pointer ? await pointer.shot() : null;
          if (over) img = compositeOver(img, over.image, over.bounds, img.getSize().width / win!.getContentSize()[0]);
          await require("node:fs").promises.writeFile(capturePath, img.toPNG());
          console.log(`[capture] wrote ${capturePath}`);
        } catch (e) { console.log(`[capture] failed: ${(e as Error).message}`); }
        app.quit();
      }, delay);
    }
    if (SMOKE) {
      const s = snapshot();
      console.log(`[smoke] window opened; firstRun=${s.firstRun ? s.firstRun.step : "none"}; characters=${s.characters.map((c) => c.name).join(", ") || "(none yet)"}`);
      setTimeout(() => app.quit(), 400);
    }
  });

  // Closing the window must NEVER stop a cooking lane (Maksym's rule). Instead of
  // destroying the window (which would tear down the app + kill the sessions),
  // we just HIDE it and keep the engine running in the background. Reopen from
  // the dock. Only a genuine Quit (with `reallyQuit` set) is allowed through.
  win.on("close", (e) => {
    if (reallyQuit || SMOKE || process.env.BIKINI_CAPTURE) return; // genuine teardown
    e.preventDefault();
    win?.hide();
    log("app", "window hidden (lanes keep cooking in background)", { working: lanes?.workingCount() ?? 0 });
  });
  // When the window is actually destroyed, drop the reference so nothing tries
  // to talk to a dead window (that's the "Object has been destroyed" crash).
  win.on("closed", () => { pointer?.close(); win = null; });
  // The pointer's engine is a child view of this window: it must not linger when
  // the window is minimised (it comes back with it). NOT on "hide"/"show": on
  // macOS Electron fires those on OCCLUSION too (another window fully covering
  // ours), which blanked the engine for no reason.
  win.on("minimize", () => pointer?.hideForWindow());
  win.on("restore", () => pointer?.showForWindow());

  await win.loadFile(path.join(__dirname, "../../src/renderer/index.html"));
}

/** True only when we have a usable, non-destroyed window to talk to. */
function winAlive(): boolean { return !!win && !win.isDestroyed(); }

/** Dev/screenshot hook only: paste `top` onto `base` at `at` (CSS px × scale). */
function compositeOver(base: Electron.NativeImage, top: Electron.NativeImage, at: { x: number; y: number }, scale: number): Electron.NativeImage {
  const b = base.toBitmap(), bs = base.getSize();
  const t = top.toBitmap(), ts = top.getSize();
  const ox = Math.max(0, Math.round(at.x * scale)), oy = Math.round(at.y * scale);
  const w = Math.min(ts.width, bs.width - ox);
  if (w <= 0) return base;
  for (let row = 0; row < ts.height; row++) {
    const y = oy + row;
    if (y < 0 || y >= bs.height) continue;
    t.copy(b, (y * bs.width + ox) * 4, row * ts.width * 4, row * ts.width * 4 + w * 4);
  }
  return nativeImage.createFromBitmap(b, { width: bs.width, height: bs.height, scaleFactor: 1 });
}

// True only when we mean to actually quit (so the window `close` handler above
// lets the window go instead of just hiding it).
let reallyQuit = false;

// SINGLE-INSTANCE LOCK. Two copies of the app running at once each adopt the
// SAME lanes/worktrees and each run their OWN Bob/Pat/Squid — so two characters
// edit the same files in parallel and clobber each other's work. Only ONE
// instance may run. A second launch fails to get the lock, focuses the window
// of the instance that already holds it, and quits itself.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  log("app", "another instance already running — focusing it and quitting this launch");
  app.quit();
}
app.on("second-instance", () => {
  if (winAlive()) { win!.show(); win!.focus(); }
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return; // lost the lock → this launch is quitting; don't init
  clearStrayApiKey(); // AD-8: never let a stray key silently bill per-use.
  const logFile = initLog(app.getPath("userData"));
  log("app", "ready", { version: app.getVersion(), logFile });
  // Dock icon for the running app (matches the desktop launcher's .icns).
  try {
    const iconImg = nativeImage.createFromPath(path.join(__dirname, "../../assets/icon.png"));
    if (!iconImg.isEmpty() && app.dock) app.dock.setIcon(iconImg);
  } catch { /* non-fatal */ }
  // Route every character's Claude traffic through the local caching proxy so
  // sub-agents get prompt caching (SDK bug #29966). Must be set before any
  // session spawns. Best-effort: if it fails, carry on without it.
  try {
    const proxyUrl = await startCacheProxy();
    process.env.ANTHROPIC_BASE_URL = proxyUrl;
    // Behind a custom base URL Claude Code switches its MCP tool search OFF and
    // loads EVERY connector's full tool schema into every call (docs: env-vars →
    // ANTHROPIC_BASE_URL). That was the 2026-09-29 "445k tokens on turn 1" and the
    // 2026-09-30 "Prompt is too long" in the highcap town: 340–500 MCP tools ≈
    // 300–480k tokens before the character has read a single file. The docs'
    // opt-back-in is ENABLE_TOOL_SEARCH=true, safe when the proxy forwards
    // tool_reference blocks — ours only adds cache_control and passes the rest
    // through. Measured 2026-09-30 through the live proxy from a lane worktree:
    // turn-1 context 214.6k → 55.5k (MCP tools 142k loaded → 631 loaded + 141.6k
    // deferred index), and a real ToolSearch → deferred Atlassian tool call
    // round-trips fine. Connectors stay available; they are just loaded on demand.
    process.env.ENABLE_TOOL_SEARCH = process.env.ENABLE_TOOL_SEARCH || "true";
    log("app", "cache proxy active", { proxyUrl, toolSearch: process.env.ENABLE_TOOL_SEARCH });
  } catch (e) {
    log("app", "cache proxy failed to start — running without it", { error: String(e) });
  }
  cfg = new AppConfig(app.getPath("userData"));
  await cfg.load();
  muted = cfg.data.muted;
  log("app", "config loaded", { projectPath: cfg.data.projectPath, firstRunComplete: cfg.data.firstRunComplete, bypass: cfg.data.bypassPermissions });

  if (cfg.data.firstRunComplete && cfg.data.projectPath) {
    // Returning user: open EVERY town (each keeps cooking whether shown or not),
    // then put the last-shown one on the street. A town whose folder is gone is
    // logged, skipped, and stays in the dropdown greyed as "folder missing".
    for (const t of cfg.data.towns) {
      try { await openTown(t.path); }
      catch (e) { missingTowns.set(t.path, defaultName(t.path)); log("town", "folder missing — kept in the list, greyed", { path: t.path, error: String(e) }); }
    }
    const show = towns.has(cfg.data.projectPath) ? cfg.data.projectPath : towns.keys().next().value;
    if (show) showTown(show); else log("town", "no town could be opened — the street stays empty");
    firstRun = null;
  } else {
    // First Run — resume at the saved step. If a folder was chosen but prep
    // was interrupted, re-run prep (it's idempotent, AD-9).
    let step = cfg.data.firstRunStep;
    let prep: FirstRunView["prep"] = { ...IDLE_PREP };
    if (step !== "welcome" && step !== "folder" && cfg.data.projectPath) {
      const r = await prepareProject(cfg.data.projectPath);
      if (!r.ok) { step = "folder"; prep = { status: "error", message: r.message }; }
      else prep = { status: "ok", message: r.message };
    }
    firstRun = { step, projectPath: cfg.data.projectPath, prep, claude: { ...IDLE_CLAUDE }, notify: { ...IDLE_NOTIFY } };
  }

  // Dev/screenshot hook: open a Character's window on launch.
  if (process.env.BIKINI_OPEN && !firstRun) openWindowId = process.env.BIKINI_OPEN as CharacterId;

  ipcMain.on(CHANNELS.intent, (_e, intent: Intent) => { void handleIntent(intent); });

  // Real-terminal channels (squid). The renderer's xterm drives a live pty.
  ipcMain.on(CHANNELS.termOpen, (_e, p: { id: CharacterId; cols: number; rows: number }) => {
    if (!TERMINAL_IDS.has(p.id)) return;
    const job = pendingTermJob[p.id];
    delete pendingTermJob[p.id];
    terminals?.open(p.id, p.cols, p.rows, job ? { job } : {}); // spawn with the held job if any
  });
  ipcMain.on(CHANNELS.termInput, (_e, p: { id: CharacterId; data: string }) => { terminals?.input(p.id, p.data); });
  ipcMain.on(CHANNELS.termResize, (_e, p: { id: CharacterId; cols: number; rows: number }) => { terminals?.resize(p.id, p.cols, p.rows); });
  ipcMain.on(CHANNELS.termDrop, async (_e, p: { id: CharacterId; attachments: { name: string; mediaType: string; data: string }[] }) => {
    if (!TERMINAL_IDS.has(p.id) || !lanes || !terminals) return;
    const paths = await lanes.saveAttachments(p.id, p.attachments); // save into the lane
    if (paths.length) terminals.input(p.id, paths.map((q) => `'${q}'`).join(" ") + " "); // type the paths at the cursor
  });

  // Before the window: the renderer's first snapshot must already know about the pointer.
  pointer = new PointerManager({
    win: () => (winAlive() ? win : null),
    onChange: pushSnapshot,
    toast,
    viewFor: (id) => cfg.data.pointerView?.[id] ?? "desktop",
    saveView: (id, view) => cfg.save({ pointerView: { ...(cfg.data.pointerView || {}), [id]: view } }),
  });
  await createWindow();
  // Dev/screenshot hooks only: BIKINI_POINT=1 opens "Point at it" on the launched
  // window; BIKINI_POINT_CLICKS="x,y;x,y" then clicks those spots in the page.
  if (process.env.BIKINI_POINT === "1" && openWindowId && !firstRun) {
    const url = pointerUrlFor(openWindowId);
    if (url) pointer.open(openWindowId, url);
    const clicks = (process.env.BIKINI_POINT_CLICKS || "").split(";").map((s) => s.split(",").map(Number)).filter((p) => p.length === 2 && p.every(isFinite)) as [number, number][];
    // …and BIKINI_POINT_SEND=1 presses "Send it" once the preview is up (a driven end-to-end test).
    if (clicks.length) pointer.debugClicks(clicks, process.env.BIKINI_POINT_PREVIEW ?? null,
      process.env.BIKINI_POINT_SEND === "1" ? (id, notes) => void handleIntent({ type: "sendPicks", characterId: id, notes }) : null);
  }
  updateSleepBlocker(); // keep the Mac awake for the whole run (Telegram reachability)
  startTelegram(); // phone remote control, if a token+chat are configured
  // Clicking the dock icon re-opens the (hidden) town — same running session.
  app.on("activate", () => { if (winAlive()) win!.show(); else void createWindow(); });
});

// A genuine Quit (Cmd+Q) must not silently kill cooking jobs. If any lane is
// working, ask first: keep them cooking in the background (hide), or stop + quit.
app.on("before-quit", (e) => {
  if (reallyQuit || SMOKE || process.env.BIKINI_CAPTURE) return;
  // Every town counts — a character cooking in a town that is not on screen is still cooking.
  const all = [...towns.values()];
  const working = all.reduce((n, t) => n + t.lanes.workingCount(), 0);
  if (working === 0) { reallyQuit = true; return; } // nothing cooking → quit freely
  e.preventDefault();
  const names = all.flatMap((t) => t.lanes.workingNames().map((id) => (ROSTER.find((r) => r.id === id)?.name || id) + (all.length > 1 ? ` (${t.profile.name})` : "")));
  const who = names.join(" and ");
  const opts = {
    type: "question" as const,
    buttons: ["Keep them cooking", "Stop & quit"],
    defaultId: 0,
    cancelId: 0,
    message: working === 1 ? `${who} is still cooking.` : `${who} are still cooking.`,
    detail: "Keep them cooking — I'll hide the town and let them finish in the background. Or stop everything and quit.",
  };
  const choice = winAlive() ? dialog.showMessageBoxSync(win!, opts) : dialog.showMessageBoxSync(opts);
  if (choice === 0) { if (winAlive()) win!.hide(); log("app", "quit declined — lanes keep cooking", { working }); }
  else { reallyQuit = true; log("app", "quit confirmed — stopping lanes", { working }); app.quit(); }
});

// Real terminals are long-lived warm processes — they must survive a window
// hide/close (the whole point). Only tear them down on a genuine quit.
app.on("will-quit", () => { for (const t of towns.values()) t.terminals.killAll(); for (const m of mails.values()) { if (m.timer) clearInterval(m.timer); if (m.nudge) clearTimeout(m.nudge); } for (const b of jiras.values()) if (b.timer) clearInterval(b.timer); });

// Graceful shutdown on a termination signal (this is how a restart reaches us).
// Interrupt each terminal's Claude first and pause, so it can reach a checkpoint
// it persists, BEFORE the pty dies — instead of the instant kill that lost a
// live session. Best-effort; still exits even if a terminal doesn't settle.
let shuttingDown = false;
async function gracefulSignalExit(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    const all = [...towns.values()];
    const busy = all.some((t) => t.terminals.anyBusy()) ? " (a terminal was busy)" : "";
    log("app", `signal shutdown — interrupting terminals then exiting${busy}`);
    for (const t of all) t.terminals.interruptAll();
    await new Promise((r) => setTimeout(r, 2500)); // let Claude settle/save its turn
    for (const t of all) t.terminals.killAll();
  } catch { /* best effort */ }
  app.exit(0);
}
process.on("SIGTERM", () => { void gracefulSignalExit(); });
process.on("SIGINT", () => { void gracefulSignalExit(); });

app.on("window-all-closed", () => {
  // Do NOT quit when the window closes — the town keeps running in the background
  // so lanes never stop (Maksym's rule). Only auto-quit in headless test modes.
  if (SMOKE || process.env.BIKINI_CAPTURE) app.quit();
});
