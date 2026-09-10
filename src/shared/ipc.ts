// The IPC contract — the ONLY vocabulary that crosses the main↔renderer
// boundary (AD-4). Both sides import these shapes; nothing else is shared.

/** Fixed Character slugs for v1 (AD conventions). Sandy joins later as a drop-in. */
export type CharacterId = "bob" | "squid" | "pat" | "krabs";

/** A Character's visible State, shown by its picture (PRD Glossary; FR-3). */
export type CharacterState = "idle" | "working" | "calling";

/** One Character as the renderer needs to draw it. */
export interface CharacterView {
  id: CharacterId;
  name: string;
  role: string;
  /** Per-Character accent colour (DESIGN.md tokens). */
  accent: string;
  /** Street position as percentages, matching the mockup. */
  pos: { leftPct: number; topPct: number };
  /** Home Base isn't a work Lane; it hands out Jobs. */
  isHomeBase: boolean;
  state: CharacterState;
  /** True while a finished/needy result is unseen (FR-4). */
  unseen: boolean;
  /** Resolved picture (file:// URL) for the current State, or null → stand-in (AD-7). */
  picture: string | null;
  /** The chalk line: the character's own one-sentence status, or null. */
  note: string | null;
  /** Epoch ms the chalk line was written (0 if none). */
  noteAt: number;
}

/** First Run walkthrough steps (FR-19). Folder is mandatory; notifications/
 *  assets (1.4) land before "ready" in a later story. */
export type FirstRunStep = "welcome" | "folder" | "claude" | "notifications" | "ready";

/** The state the First Run overlay renders from. Null once completed. */
export interface FirstRunView {
  step: FirstRunStep;
  projectPath: string | null;
  /** Result of preparing the chosen folder (AD-9). */
  prep: { status: "idle" | "working" | "ok" | "error"; message: string };
  /** Result of the live Claude connection check (AD-8). */
  claude: { status: "idle" | "working" | "ok" | "warn"; message: string };
  /** Notification choice (optional; never blocks — FR-7, FR-19). */
  notify: { choice: "none" | "allowed" | "declined"; message: string };
}

/** A structured question a Character asks (from Claude's AskUserQuestion tool).
 *  Rendered as clickable option buttons + a "type my own" box (FR-12 sibling). */
export interface AskChoice {
  questions: {
    question: string;
    header: string;
    multiSelect: boolean;
    options: { label: string; description?: string }[];
  }[];
}

/** One chat bubble in a Work Window. `tool` marks folded technical activity. */
export interface ChatMessage {
  from: "you" | "them";
  text: string;
  tool?: boolean;
  /** Attached images, as data: URLs (shown inline in the bubble). */
  images?: string[];
  /** Names of attached NON-image files (shown as file chips in the bubble). */
  files?: string[];
}

/** A file attached to a message: base64 payload + its name + mime type. Images
 *  are sent to Claude inline; any other file is saved into the lane and its path
 *  handed to the character to open. */
export interface Attachment {
  name: string;      // original filename, e.g. "error.log"
  mediaType: string; // e.g. "image/png", "application/pdf", "text/csv"
  data: string;      // base64, no "data:...;base64," prefix
}

/** A crew member as a picker chip in Home Base (FR-15, UX-DR6). */
export interface CrewChip {
  id: CharacterId;
  name: string;
  /** Available = Idle and pickable; else shows the state word, grayed. */
  available: boolean;
  stateWord: string;
}

/** The open window overlay — Home Base (picker) or a Character's Work Window. */
export interface WindowView {
  characterId: CharacterId;
  name: string;
  role: string;
  accent: string;
  isHomeBase: boolean;
  /** This character runs as a REAL embedded terminal (the actual `claude` CLI)
   *  instead of our SDK chat — the "embed the terminal" side of the experiment.
   *  When true, the renderer shows an xterm view and ignores `conversation`. */
  terminal: boolean;
  /** Home Base only: the crew to choose from. */
  crew: CrewChip[];
  /** Work Window: the live conversation. */
  conversation: ChatMessage[];
  /** Work Window: is this Lane currently cooking? */
  working: boolean;
  /** A pending Risky-Action question awaiting Allow/Deny, or null (FR-12). */
  pendingAsk: string | null;
  /** A pending multiple-choice question from the Character, or null. Rendered as
   *  clickable options + a "type my own" box. */
  pendingChoice: AskChoice | null;
  /** The Job failed/stalled and awaits Try again / Scrap it (FR-5). */
  burned: boolean;
  /** The Job was cooking when the app quit; awaits Keep cooking / Scrap (AD-11). */
  paused: boolean;
  /** Work landed in the Project — offer Send it back (FR-16). */
  served: boolean;
  /** Landing bumped another Character's work — awaits a keep-which choice (FR-16). */
  collision: boolean;
  /** How many sub-agents ("helpers") are running right now (info only). */
  agents: number;
  /** The running helpers' friendly names, for the header list. */
  agentNames: string[];
  /** This Character's helper/sub-agent icon (file:// URL), or null. */
  agentIcon: string | null;
  /** Live "what it's doing now" label while working, or null. */
  activity: string | null;
  /** The current job's short title (its first instruction), shown in the header
   *  so Maksym always sees WHAT this Character is working on. Null if none yet. */
  taskTitle: string | null;
  /** Claude's live batch/task checklist (the TodoWrite plan), shown as a panel
   *  that ticks off as it works. */
  todos: { content: string; status: string }[];
  /** Epoch ms the current job started (0 if none) + output tokens spent so far,
   *  for the live "⏱ 3m · 10k tok" readout. */
  taskStartedAt: number;
  taskTokens: number;
  /** Epoch ms of the last sign of life (for a live "active Ns ago" heartbeat). */
  beatAt: number;
  /** Claude's usage limit is used up: epoch ms when it resets (0 = not limited).
   *  The Character is paused until then and picks up by itself. */
  limitedUntil: number;
  /** Running tally for the current job, so its cost is visible while it runs. */
  jobStats: JobStats;
  /** Prior conversations for this Character (newest last). */
  pastSessions: { index: number; title: string }[];
  /** A past session being browsed ("just asking"), or null on the current one. */
  viewing: { index: number; readOnly: boolean; messages: ChatMessage[]; asking: boolean } | null;
  /** Terminal-mode only: the character's past Claude sessions (its "Past orders"),
   *  newest first. Clicking one resumes it in the terminal via `claude --resume`. */
  termSessions?: { sessionId: string; title: string }[];
}

/** What one job has cost so far — the numbers that were invisible on 25 Aug 2026
 *  (7,900 turns, 89 helpers, 33 questions across two characters, nobody could
 *  see it). All counters reset when a NEW order is handed out. */
export interface JobStats {
  /** Answered turns (one per message the character finished replying to). */
  turns: number;
  /** Sub-agents ("helpers") called in so far. */
  helpers: number;
  /** Times it stopped to ask Maksym a question. */
  asks: number;
  /** Size of the conversation Claude re-reads every turn (input + cache), from
   *  the last turn. This is what makes a long order slow and expensive. */
  ctxTokens: number;
  /** Time the character was actually working vs. sitting idle waiting on Maksym. */
  workingMs: number;
  waitingMs: number;
  /** How many times this job ran into Claude's usage limit. */
  limitHits: number;
  /** Last reported share of the usage limit already used (0–1), or null. */
  limitUtil: number | null;
}

export const EMPTY_JOB_STATS: JobStats = { turns: 0, helpers: 0, asks: 0, ctxTokens: 0, workingMs: 0, waitingMs: 0, limitHits: 0, limitUtil: null };

/** One window of Claude's subscription limit, as the street's RESERVE LIGHT
 *  sees it. Claude only reports a level once it's past ~75% used, so this is a
 *  warning light, not a gauge: dark most of the day, then amber/red/empty. */
export interface Gauge {
  /** Share already used (0–1), or null while dark (nothing reported yet). */
  util: number | null;
  /** Epoch ms this window resets (0 if unknown). */
  resetsAt: number;
  /** Epoch ms of the reading this came from (for "as of 12 min ago"). */
  at: number;
  level: "dark" | "amber" | "red" | "empty";
}
/** The two windows Claude enforces: the rolling 5-hour tank and the weekly one. */
export interface Fuel { fiveHour: Gauge | null; sevenDay: Gauge | null; }
export const EMPTY_FUEL: Fuel = { fiveHour: null, sevenDay: null };
/** The wooden sign as the renderer draws it: null when every window is dark. */
export interface FuelSign {
  level: "amber" | "red" | "empty";
  /** "Reserve · 82% used · resets 1:40 PM" — main words it (guards.fuelWord). */
  text: string;
  /** Tooltip: the other window's word (the weekly one), or "". */
  title: string;
  /** The reading is older than 10 min (nobody has worked since). */
  stale: boolean;
}

/** An Orders Board status (FR-10). Diner vocabulary. */
export type OrderStatus = "WAITING" | "COOKING" | "SERVED" | "BURNED" | "SCRAPPED" | "SENT BACK";

/** One line on the Galley Grub Orders Board. */
export interface OrderLine {
  characterId: CharacterId;
  name: string;
  title: string;
  status: OrderStatus;
  /** The character's chalk line (its own status), or null. */
  note: string | null;
}

/** The whole town as a derived, seq-stamped snapshot (AD-2, AD-4). */
export interface TownSnapshot {
  /** Monotonic sequence of the last event folded into this snapshot. */
  seq: number;
  background: string;
  characters: CharacterView[];
  /** Present while First Run is active; null once the town is open. */
  firstRun: FirstRunView | null;
  /** The open window overlay, or null when just viewing the street. */
  openWindow: WindowView | null;
  /** Every Job across all Lanes, for the Orders Board (FR-9, FR-10). */
  orders: OrderLine[];
  /** Sound muted? Visual signals are never muted (FR-8). */
  muted: boolean;
  /** Per-Character portrait (file:// URL) for all UI chrome — no emoji (AD-7). */
  faces: Partial<Record<CharacterId, string | null>>;
  /** Claude's usage-limit windows, town-wide (the reserve light's data). */
  fuel: Fuel;
  /** The reserve light as drawn, or null when dark (hidden). */
  fuelSign: FuelSign | null;
}

/** Renderer → main. Named intents only — never raw fs/git/SDK calls (AD-4). */
export type Intent =
  | { type: "rendererReady" }
  | { type: "firstRunNext" }
  | { type: "firstRunChooseFolder" }
  | { type: "firstRunCheckClaude" }
  | { type: "firstRunClaudeNext" }
  | { type: "firstRunNotifyAllow" }
  | { type: "firstRunNotifySkip" }
  | { type: "firstRunOpenTown" }
  | { type: "openCharacter"; id: CharacterId }
  | { type: "closeWindow" }
  | { type: "handOutJob"; characterId: CharacterId; prompt: string; attachments?: Attachment[] }
  | { type: "followUp"; characterId: CharacterId; prompt: string; attachments?: Attachment[] }
  | { type: "answerPermission"; characterId: CharacterId; allow: boolean }
  | { type: "answerQuestion"; characterId: CharacterId; answers: string[]; attachments?: Attachment[] }
  | { type: "cancelJob"; characterId: CharacterId }
  | { type: "retryJob"; characterId: CharacterId }
  | { type: "scrapJob"; characterId: CharacterId }
  | { type: "openTerminal"; characterId: CharacterId }
  | { type: "terminalResume"; characterId: CharacterId; sessionId: string }
  | { type: "sendItBack"; characterId: CharacterId }
  | { type: "resolveCollision"; characterId: CharacterId; keepMine: boolean }
  | { type: "openPast"; characterId: CharacterId; index: number }
  | { type: "closePast"; characterId: CharacterId }
  | { type: "setReadOnly"; characterId: CharacterId; readOnly: boolean }
  | { type: "askPast"; characterId: CharacterId; prompt: string }
  | { type: "resumePast"; characterId: CharacterId; index: number; prompt: string }
  | { type: "toggleMute" };

/** A one-shot sound cue (transient, view-only — like the token stream). */
export interface SoundCue {
  characterId: CharacterId;
  kind: "start" | "ready";
  /** Resolved file:// URL of Maksym's clip, or null → fall back to a placeholder. */
  url: string | null;
}

/** Channel names, shared so both sides agree. */
export const CHANNELS = {
  snapshot: "town:snapshot",
  intent: "town:intent",
  sound: "town:sound",
  // Real-terminal (node-pty) channels for terminal-mode characters (e.g. squid).
  termOpen: "term:open",     // renderer → main: {id, cols, rows}
  termInput: "term:input",   // renderer → main: {id, data}
  termResize: "term:resize", // renderer → main: {id, cols, rows}
  termData: "term:data",     // main → renderer: {id, data}
  termExit: "term:exit",     // main → renderer: {id, code}
  termDrop: "term:drop",     // renderer → main: {id, attachments} — files dropped on the terminal
} as const;
