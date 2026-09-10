// Electron main process — the authoritative half (AD-1). Owns the event log,
// the app config, First Run, and derives the snapshot pushed to the renderer.
// The renderer never touches fs/git/SDK; it renders what it's handed (AD-4).

import { app, BrowserWindow, ipcMain, dialog, Notification, nativeImage, powerSaveBlocker } from "electron";
import path from "node:path";
import { execFile } from "node:child_process";
import { EventLog } from "./domain/eventLog";
import { fold, emptyTown } from "./domain/snapshot";
import { ROSTER } from "./config/roster";
import { TelegramBridge, type TgButton } from "./adapters/telegram";
import { AppConfig } from "./config/appConfig";
import { prepareProject } from "./adapters/git";
import { checkClaude, clearStrayApiKey } from "./adapters/claude";
import { resolvePicture, resolveBackground, resolveSound, resolveFace, resolveHelperIcon } from "./adapters/assets";
import { LaneManager, type AdoptionSupport } from "./adapters/lane";
import { TerminalManager, listClaudeSessions } from "./adapters/terminal";
import { srProjectFor } from "./config/adoptions";
import { initLog, log } from "./log";
import { startCacheProxy } from "./cacheProxy";
import { CHANNELS, EMPTY_JOB_STATS, EMPTY_FUEL, type Intent, type FirstRunView, type TownSnapshot, type WindowView, type CharacterId, type CharacterState, type Fuel, type FuelSign, type Gauge } from "../shared/ipc";
import { fmtClock, fmtWhen, fuelWord, fuelStale } from "./adapters/guards";

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

async function seedTownIfEmpty(log: EventLog): Promise<void> {
  if (log.all().length > 0) return;
  for (const c of ROSTER) {
    await log.append({
      type: "CharacterRegistered",
      id: c.id, name: c.name, role: c.role, accent: c.accent, pos: c.pos, isHomeBase: c.isHomeBase,
    });
  }
}

/** Open the Project's event log (lives in <project>/.bikini, AD-9) and seed it. */
async function openProjectLog(projectPath: string): Promise<void> {
  projectLog = new EventLog(path.join(projectPath, ".bikini"));
  await projectLog.load();
  await seedTownIfEmpty(projectLog);
  // Scout & Runner adoption: a character labels an existing lane (town-label,
  // git untouched). Finishing pushes the lane's REAL branch + opens a PR — gated
  // by cfg.srDryRun (logs only) until Maksym flips it live.
  const sr = srProjectFor(projectPath);
  let adopt: AdoptionSupport | null = null;
  if (sr) {
    const parent = path.dirname(projectPath);
    adopt = {
      adoptionFor(id) {
        const a = sr.adoptions[id];
        return a ? { worktree: path.join(parent, a.laneDir), branch: a.branch, label: a.label, frontendPort: a.frontendPort, backendPort: a.backendPort } : null;
      },
    };
  }
  lanes = new LaneManager(projectPath, projectLog, onLaneChange, fireFinishNotification, emitSoundCue, () => cfg.data.bypassPermissions, adopt,
    { fuelFile: path.join(app.getPath("userData"), "fuel.json"), onFuelWarning });
  // Real-terminal characters (squid): the actual `claude` CLI in the lane
  // worktree. onData/onExit stream straight to the renderer's xterm.
  terminals = new TerminalManager(
    (id) => lanes!.worktreeDir(id),
    (id, data) => { if (winAlive()) win!.webContents.send(CHANNELS.termData, { id, data }); },
    (id, code) => { if (winAlive()) win!.webContents.send(CHANNELS.termExit, { id, code }); },
    emitSoundCue, // squid keeps his voice: 'start' on launch, 'ready' when a reply settles
    onTerminalState, // drives the street picture (working / calling) for terminal chars
  );
  log("project", "opened", { projectPath, adoption: sr ? Object.keys(sr.adoptions) : null, terminalChars: [...TERMINAL_IDS] });

  // Resume (AD-11, NFR-1): any Character left mid-cook when the app quit is
  // paused — flip its dot on and offer Keep cooking / Scrap.
  const events = projectLog.all();
  for (const c of fold(events).characters) {
    // Terminal chars (squid) have no persistent SDK lane — their pty is gone
    // after a restart, so start them clean at idle (not "paused").
    if (TERMINAL_IDS.has(c.id)) {
      if (c.state !== "idle") await projectLog.append({ type: "CharacterStateChanged", id: c.id, state: "idle" });
      continue;
    }
    if (c.state === "working") {
      const last = [...events].reverse().find((e) => e.type === "JobHandedOut" && e.id === c.id);
      lanes.markPaused(c.id, last && last.type === "JobHandedOut" ? last.prompt : null);
      await projectLog.append({ type: "CharacterStateChanged", id: c.id, state: "calling" });
    }
  }
}

/** A Lane finished → native macOS notification (FR-7). Clicking it opens that
 *  Character. Skipped if Maksym is already looking at that window. */
function fireFinishNotification(id: CharacterId, summary: string): void {
  notifyTgDone(id, summary); // phone always gets the "finished" ping (not gated by focus/desktop-notif prefs)
  if (!cfg.data.notificationsWanted || !Notification.isSupported()) return;
  if (win?.isFocused() && openWindowId === id) return; // already watching
  const name = ROSTER.find((r) => r.id === id)?.name ?? id;
  const n = new Notification({ title: `${name} finished!`, body: summary });
  n.on("click", () => {
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
      .filter((x) => !x.isHomeBase)
      .map((x) => ({
        id: x.id, name: x.name,
        // Terminal chars (squid) are always pickable — no SDK "working" state.
        available: TERMINAL_IDS.has(x.id) || (x.state === "idle" && !(lanes?.isWorking(x.id) ?? false)),
        stateWord: STATE_WORD[x.state],
      }));
    return { characterId: c.id, name: c.name, role: c.role, accent: c.accent, isHomeBase: true, terminal: false, crew, conversation: [], working: false, pendingAsk: null, pendingChoice: null, burned: false, paused: false, served: false, collision: false, agents: 0, agentNames: [], agentIcon: null, activity: null, taskTitle: null, todos: [], taskStartedAt: 0, taskTokens: 0, beatAt: 0, limitedUntil: 0, jobStats: EMPTY_JOB_STATS, pastSessions: [], viewing: null };
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
  };
}

const ASSETS_DIR = path.join(__dirname, "../../assets");
const SOUNDS_DIR = path.join(__dirname, "../../sounds");

/** Resolve a Character's sound file (AD-7) and push it to the renderer to
 *  play. Transient/view-only — never persisted. Renderer respects mute. */
function emitSoundCue(id: CharacterId, kind: "start" | "ready"): void {
  const url = resolveSound(SOUNDS_DIR, id, kind);
  log("sound", `${id} ${kind}`, { hasFile: !!url });
  if (winAlive()) win!.webContents.send(CHANNELS.sound, { characterId: id, kind, url });
  if (kind === "ready") notifyTelegram(id); // a character needs attention → ping the phone
  else if (kind === "start") notifyTgStart(id); // a job kicked off → ping the phone
}

// Reserve light (Job 1): the FIRST time the 5-hour tank lights up in a window,
// one line to the phone. Once per window — the lane persists what it warned about.
function onFuelWarning(g: Gauge): void {
  if (!tg) return;
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

function notifyTgStart(id: CharacterId): void {
  if (!tg || !lanes || id === "krabs") return;
  const task = lanes.lastPromptFor(id);
  void tg.sendLong(`▶️ ${tgName(id)} started:\n\n${task || "a new task."}`);
}

// ───────────────────────── Telegram remote control ─────────────────────────
// Answer questions, approve "keep cooking?" pauses, start jobs (Mr. Krabs) and
// manage sessions from the phone. Every tap becomes a normal Intent → nothing
// is reimplemented. Locked to the owner chat in the bridge.
let tg: TelegramBridge | null = null;
// Free-text expectation: after "/new → pick char" we await a job body; after a
// question we await a typed answer. Cleared once consumed.
let tgExpect: { mode: "answer" | "job"; id: CharacterId } | null = null;
const TG_CHARS: CharacterId[] = ["bob", "squid", "pat"];
const tgName = (id: CharacterId): string => ROSTER.find((r) => r.id === id)?.name ?? id;
const tgEsc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function startTelegram(): void {
  const token = cfg.data.telegramToken, chatId = cfg.data.telegramChatId;
  if (!token || !chatId) { log("tg", "not configured — skipping"); return; }
  tg = new TelegramBridge(token, chatId, {
    onTap: (d) => void handleTgTap(d),
    onCommand: (c, a) => void handleTgCommand(c, a),
    onText: (t) => void handleTgText(t),
  });
  tg.start();
  void tg.send("🍍 Bikini Bottom is online — I'll ping you when someone needs you.\nCommands: /town  /new  /orders  /cancel");
}

// Fired on the 'ready' cue — work out WHY the character needs Maksym, and ping.
function notifyTelegram(id: CharacterId): void {
  if (!tg || !lanes || id === "krabs") return;
  const nm = tgName(id);
  if (lanes.hasPendingChoice(id)) {
    const qs = lanes.view(id).pendingChoice?.questions || [];
    const q = qs[0];
    if (!q) return;
    tgExpect = { mode: "answer", id };
    if (qs.length > 1) {
      // A BATCH of questions (the character gathered them, as asked). Buttons
      // only fit one question, so list them all with numbered options and take
      // one reply line per question (a number or your own words).
      const body = qs.map((qq, qi) => `<b>${qi + 1}.</b> ${tgEsc(qq.question)}\n` + qq.options.map((o, oi) => `   ${oi + 1}) ${tgEsc(o.label.slice(0, 80))}`).join("\n")).join("\n\n");
      void tg.sendLong(`❓ <b>${tgEsc(nm)}</b> has ${qs.length} questions — all at once:\n\n${body}\n\n<i>Reply with one line per question: the option number, or your own words.</i>`);
      return;
    }
    const rows: TgButton[][] = q.options.map((o, i) => [{ text: o.label.slice(0, 60), data: `ans:${id}:${i}` }]);
    void tg.send(`❓ <b>${tgEsc(nm)}</b> asks:\n${tgEsc(q.question)}\n\n<i>Tap an option, or reply with your own answer.</i>`, rows);
  } else if (lanes.hasPendingAsk(id)) {
    tgExpect = { mode: "answer", id };
    void tg.send(`🔐 <b>${tgEsc(nm)}</b> needs approval:\n${tgEsc(lanes.view(id).pendingAsk || "…")}`, [[{ text: "✅ Allow", data: `perm:${id}:allow` }, { text: "🚫 Deny", data: `perm:${id}:deny` }]]);
  } else if (lanes.limitedUntil(id)) {
    // Usage limit: nothing to decide — it resumes by itself. Just say so honestly.
    void tg.send(`⏳ <b>${tgEsc(nm)}</b> ran into Claude's usage limit — it resets at ${tgEsc(fmtClock(lanes.limitedUntil(id)))} and ${tgEsc(nm)} will pick up by itself then. Nothing is lost.`, [[{ text: "🗑 Scrap the order", data: `scrap:${id}` }]]);
  } else if (lanes.isPaused(id)) {
    void tg.send(`⏸ <b>${tgEsc(nm)}</b> paused at a checkpoint — keep cooking?`, [[{ text: "🍳 Keep cooking", data: `retry:${id}` }, { text: "🗑 Scrap", data: `scrap:${id}` }]]);
  } else if (lanes.isBurned(id)) {
    void tg.send(`⚠️ <b>${tgEsc(nm)}</b> hit a snag.`, [[{ text: "🔁 Try again", data: `retry:${id}` }, { text: "🗑 Scrap", data: `scrap:${id}` }]]);
  }
}

function notifyTgDone(id: CharacterId, summary: string): void {
  if (!tg || id === "krabs" || !lanes) return;
  // Send the FULL final reply, not the 90-char summary (Maksym wants the whole
  // message, not the first few lines). sendLong auto-splits if it's huge.
  const full = lanes.view(id).conversation.slice().reverse().find((m) => m.from === "them" && !m.tool)?.text || summary || "finished the job";
  void tg.sendLong(`✅ ${tgName(id)} finished:\n\n${full}`);
}

async function handleTgTap(data: string): Promise<void> {
  const [action, id, extra] = data.split(":") as [string, CharacterId, string?];
  if (action === "ans") {
    const opt = lanes?.view(id).pendingChoice?.questions?.[0]?.options?.[Number(extra)];
    if (opt) { tgExpect = null; await handleIntent({ type: "answerQuestion", characterId: id, answers: [opt.label] }); await tg?.send(`✅ Told ${tgName(id)}: "${tgEsc(opt.label)}"`); }
    else await tg?.send("That question isn't waiting anymore.");
  } else if (action === "perm") {
    tgExpect = null; await handleIntent({ type: "answerPermission", characterId: id, allow: extra === "allow" });
    await tg?.send(extra === "allow" ? `✅ Allowed — ${tgName(id)} continues.` : `🚫 Denied — told ${tgName(id)}.`);
  } else if (action === "retry") {
    await handleIntent({ type: "retryJob", characterId: id }); await tg?.send(`🍳 ${tgName(id)} — picking up where it left off.`);
  } else if (action === "scrap") {
    await handleIntent({ type: "scrapJob", characterId: id }); await tg?.send(`🗑 Scrapped ${tgName(id)}'s job.`);
  } else if (action === "cancel") {
    await handleIntent({ type: "cancelJob", characterId: id }); await tg?.send(`🛑 Cancelled ${tgName(id)}'s job.`);
  } else if (action === "new") {
    tgExpect = { mode: "job", id }; await tg?.send(`📋 What should ${tgName(id)} do? Reply with the task.`);
  } else if (action === "resume") {
    await handleIntent({ type: "resumePast", characterId: id, index: Number(extra), prompt: "I'm picking this order back up — continue from where we left off." });
    await tg?.send(`▶️ Reopened that order for ${tgName(id)} and asked it to continue.`);
  } else if (action === "orders") {
    await sendTgOrders(id);
  }
}

async function handleTgCommand(cmd: string, args: string): Promise<void> {
  if (cmd === "start" || cmd === "help") {
    await tg?.send("🍍 <b>Bikini Bottom</b>\n/town — who's doing what\n/new — hand out a new job\n/orders — past orders per character\n/cancel — stop a running job\nWhen someone needs you, I message you with buttons.");
  } else if (cmd === "town" || cmd === "status") {
    await sendTgTown();
  } else if (cmd === "new") {
    await tg?.send("Who should take this job?", [TG_CHARS.map((id) => ({ text: tgName(id), data: `new:${id}` }))]);
  } else if (cmd === "orders") {
    const id = TG_CHARS.find((c) => c === (args.toLowerCase() as CharacterId));
    if (id) await sendTgOrders(id);
    else await tg?.send("Whose past orders?", [TG_CHARS.map((c) => ({ text: tgName(c), data: `orders:${c}` }))]);
  } else if (cmd === "cancel") {
    const id = TG_CHARS.find((c) => c === (args.toLowerCase() as CharacterId));
    if (id) await handleTgTap(`cancel:${id}`);
    else await tg?.send("Cancel whose job?", [TG_CHARS.map((c) => ({ text: tgName(c), data: `cancel:${c}` }))]);
  } else if (TG_CHARS.includes(cmd as CharacterId)) {
    if (args) { await handleIntent({ type: "handOutJob", characterId: cmd as CharacterId, prompt: args }); await tg?.send(`📋 Handed ${tgName(cmd as CharacterId)} the job.`); }
    else { tgExpect = { mode: "job", id: cmd as CharacterId }; await tg?.send(`What should ${tgName(cmd as CharacterId)} do? Reply with the task.`); }
  } else {
    await tg?.send("Didn't catch that — try /town, /new, /orders, /cancel.");
  }
}

async function handleTgText(text: string): Promise<void> {
  if (!tgExpect) { await tg?.send("Not sure what that's for. Try /town or /new."); return; }
  const { mode, id } = tgExpect; tgExpect = null;
  if (mode === "answer") {
    // A batch of questions → one reply line per question; a bare number picks
    // that option. A single question → the whole text is the answer.
    const qs = lanes?.view(id).pendingChoice?.questions || [];
    let answers = [text];
    if (qs.length > 1) {
      const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
      answers = qs.map((q, qi) => {
        const line = lines[qi] || "";
        const n = /^\d+[.)]?$/.test(line) ? parseInt(line, 10) : 0;
        return (n >= 1 && n <= q.options.length) ? q.options[n - 1].label : line;
      });
    }
    await handleIntent({ type: "answerQuestion", characterId: id, answers });
    await tg?.send(`✅ Told ${tgName(id)}: "${tgEsc(answers.join(" · "))}"`);
  }
  else { await handleIntent({ type: "handOutJob", characterId: id, prompt: text }); await tg?.send(`📋 Handed ${tgName(id)} the job.`); }
}

async function sendTgTown(): Promise<void> {
  if (!tg || !lanes) return;
  const lines = TG_CHARS.map((id) => {
    let s = "💤 idle";
    if (lanes!.isWorking(id)) s = "⏳ working";
    else if (lanes!.hasPendingChoice(id) || lanes!.hasPendingAsk(id)) s = "❓ waiting for you";
    else if (lanes!.limitedUntil(id)) s = `⏳ waiting for Claude's limit (resets ${fmtClock(lanes!.limitedUntil(id))})`;
    else if (lanes!.isPaused(id)) s = "⏸ paused — keep cooking?";
    else if (lanes!.isBurned(id)) s = "⚠️ hit a snag";
    const title = lanes!.lastPromptFor(id);
    return `<b>${tgEsc(tgName(id))}</b>: ${s}${title ? `\n   ↳ ${tgEsc(title.slice(0, 60))}` : ""}`;
  });
  // The reserve light, when lit: one line per lit window.
  const fuel = lanes.fuel();
  for (const w of [fuelWord(fuel.fiveHour, Date.now(), "Reserve"), fuelWord(fuel.sevenDay, Date.now(), "Weekly reserve")]) if (w) lines.push(`⛽ ${tgEsc(w)}`);
  await tg.send("🏙 <b>Town status</b>\n" + lines.join("\n"));
}

async function sendTgOrders(id: CharacterId): Promise<void> {
  if (!tg || !lanes) return;
  const past = lanes.view(id).pastSessions;
  if (!past.length) { await tg.send(`${tgName(id)} has no past orders yet.`); return; }
  const rows: TgButton[][] = past.slice().reverse().slice(0, 12).map((p) => [{ text: p.title.slice(0, 40), data: `resume:${id}:${p.index}` }]);
  await tg.send(`📜 <b>${tgEsc(tgName(id))}</b> — past orders (tap to reopen & continue):`, rows);
}

// A terminal character's picture is driven here (SDK chars use the lane engine).
// The TerminalManager reports 'working' when busy and 'calling' when a reply
// settles; we persist it as a state event so the street icon updates, then reuse
// markSeenIfWatching so 'calling' clears to idle if you're already watching it.
async function onTerminalState(id: CharacterId, state: CharacterState): Promise<void> {
  if (!projectLog) return;
  await projectLog.append({ type: "CharacterStateChanged", id, state });
  onLaneChange();
}

/** Derive the Orders Board (FR-9, FR-10) from each Lane's current situation. */
function buildOrders(chars: TownSnapshot["characters"]): TownSnapshot["orders"] {
  if (!lanes) return [];
  const out: TownSnapshot["orders"] = [];
  for (const c of chars) {
    if (c.isHomeBase) continue;
    const title = lanes.lastPromptFor(c.id);
    if (!title) continue; // never had a Job → no line
    const v = lanes.view(c.id);
    let status: TownSnapshot["orders"][number]["status"];
    if (lanes.isWorking(c.id)) status = "COOKING";
    else if (lanes.isBurned(c.id)) status = "BURNED";
    else if (v.collision || lanes.hasPendingAsk(c.id) || lanes.hasPendingChoice(c.id) || lanes.isPaused(c.id)) status = "WAITING";
    else if (v.sentBack) status = "SENT BACK";
    else status = "SERVED";
    out.push({ characterId: c.id, name: c.name, title: title.replace(/\s+/g, " ").slice(0, 48), status });
  }
  return out;
}

function snapshot(): TownSnapshot {
  const base = projectLog ? fold(projectLog.all()) : emptyTown();
  // Resolve every visual through the Asset Slot resolver (AD-7).
  for (const c of base.characters) c.picture = resolvePicture(ASSETS_DIR, c.id, c.state);
  base.background = resolveBackground(ASSETS_DIR, base.background) ?? base.background;
  base.firstRun = firstRun;
  base.openWindow = buildWindow(base.characters);
  base.orders = buildOrders(base.characters);
  base.muted = muted;
  // Portraits for all UI chrome (no emoji, AD-7).
  base.faces = {};
  for (const r of ROSTER) base.faces[r.id] = resolveFace(ASSETS_DIR, r.id);
  // The reserve light (town-wide usage windows), and its words when lit.
  base.fuel = lanes?.fuel() ?? EMPTY_FUEL;
  base.fuelSign = fuelSignFor(base.fuel);
  return base;
}

function pushSnapshot(): void {
  if (winAlive()) win!.webContents.send(CHANNELS.snapshot, snapshot());
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

async function handleIntent(intent: Intent): Promise<void> {
  log("intent", intent.type, { ...intent, type: undefined });
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
      await cfg.save({ firstRunComplete: true });
      await openProjectLog(cfg.data.projectPath);
      firstRun = null; // town opens; overlay lifts
      pushSnapshot();
      break;
    }

    case "openCharacter": {
      openWindowId = intent.id;
      // Mr. Krabs greets you when you step into the Krusty Krab.
      if (intent.id === "krabs") emitSoundCue("krabs", "start");
      // Opening a finished (Calling, not working) Character means the result is
      // now seen → clears the dot back to Idle (FR-4; AD-12 refinement later).
      const c = (projectLog ? fold(projectLog.all()).characters : []).find((x) => x.id === intent.id);
      if (c && c.state === "calling" && !(lanes?.isWorking(intent.id) ?? false)) {
        await projectLog!.append({ type: "CharacterStateChanged", id: intent.id, state: "idle" });
      }
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
      if (lanes) lanes.openPast(intent.characterId, intent.index);
      break;

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
          const img = await win!.webContents.capturePage();
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
  win.on("closed", () => { win = null; });

  await win.loadFile(path.join(__dirname, "../../src/renderer/index.html"));
}

/** True only when we have a usable, non-destroyed window to talk to. */
function winAlive(): boolean { return !!win && !win.isDestroyed(); }

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
    log("app", "cache proxy active", { proxyUrl });
  } catch (e) {
    log("app", "cache proxy failed to start — running without it", { error: String(e) });
  }
  cfg = new AppConfig(app.getPath("userData"));
  await cfg.load();
  muted = cfg.data.muted;
  log("app", "config loaded", { projectPath: cfg.data.projectPath, firstRunComplete: cfg.data.firstRunComplete, bypass: cfg.data.bypassPermissions });

  if (cfg.data.firstRunComplete && cfg.data.projectPath) {
    // Returning user: open straight into the town.
    await openProjectLog(cfg.data.projectPath);
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

  await createWindow();
  updateSleepBlocker(); // keep the Mac awake for the whole run (Telegram reachability)
  startTelegram(); // phone remote control, if a token+chat are configured
  // Clicking the dock icon re-opens the (hidden) town — same running session.
  app.on("activate", () => { if (winAlive()) win!.show(); else void createWindow(); });
});

// A genuine Quit (Cmd+Q) must not silently kill cooking jobs. If any lane is
// working, ask first: keep them cooking in the background (hide), or stop + quit.
app.on("before-quit", (e) => {
  if (reallyQuit || SMOKE || process.env.BIKINI_CAPTURE) return;
  const working = lanes ? lanes.workingCount() : 0;
  if (working === 0) { reallyQuit = true; return; } // nothing cooking → quit freely
  e.preventDefault();
  const names = lanes!.workingNames().map((id) => ROSTER.find((r) => r.id === id)?.name || id);
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
app.on("will-quit", () => { terminals?.killAll(); });

// Graceful shutdown on a termination signal (this is how a restart reaches us).
// Interrupt each terminal's Claude first and pause, so it can reach a checkpoint
// it persists, BEFORE the pty dies — instead of the instant kill that lost a
// live session. Best-effort; still exits even if a terminal doesn't settle.
let shuttingDown = false;
async function gracefulSignalExit(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    const busy = terminals?.anyBusy() ? " (a terminal was busy)" : "";
    log("app", `signal shutdown — interrupting terminals then exiting${busy}`);
    terminals?.interruptAll();
    await new Promise((r) => setTimeout(r, 2500)); // let Claude settle/save its turn
    terminals?.killAll();
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
