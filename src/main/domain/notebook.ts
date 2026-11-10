// The Notebook (2026-11-10): one sentence per finished ticket, written by the
// character who did the work, kept by the town so Maksym can copy it by hand
// into his paper notebook (the "forced context sync" — he was losing track of
// what shipped under his name). PURE: no fs, no Electron, no Jira; main owns
// the file (<town>/.bikini/notebook.json) and the lane owns the hooks.
//
// The loop, by part:
//   * the lane's PostToolUse hook sees the Atlassian "move ticket" call → when
//     the move reached Code Review (or Review Completed), the key is PENDING
//     for that character (`notePending`) and the model is told right away;
//   * the character calls the `notebook_line` town tool → `addLine` (one line
//     per key, ever — a second one is a "dupe", nothing changes);
//   * the lane's Stop hook asks `stopVerdict` → a pending key with no line gets
//     the stop refused ONCE ("write the line, then finish"); never twice, so a
//     stubborn session can always end.
import type { CharacterId } from "../../shared/ipc";

export interface NotebookEntry {
  /** The ticket, "HIGHCAP-275". One entry per key, ever. */
  key: string;
  /** The one Ukrainian sentence. */
  sentence: string;
  characterId: CharacterId;
  name: string;
  /** Epoch ms the line was written. */
  at: number;
  /** Maksym ticked it: copied into the paper notebook. */
  copied: boolean;
  copiedAt: number | null;
}

/** A ticket that reached Code Review with no line yet — who owes the line. */
export interface NotebookPending {
  key: string;
  characterId: CharacterId;
  at: number;
  /** The Stop hook already refused one finish over this key. */
  nudged: boolean;
}

export interface NotebookState { entries: NotebookEntry[]; pending: NotebookPending[] }

export const EMPTY_NOTEBOOK: NotebookState = { entries: [], pending: [] };

/** The file's contents, however old or broken → a usable state. */
export function parseNotebook(raw: unknown): NotebookState {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const entries: NotebookEntry[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(o.entries) ? o.entries : []) {
    const x = (e || {}) as Record<string, unknown>;
    const key = String(x.key || "").trim();
    const sentence = String(x.sentence || "").trim();
    if (!key || !sentence || seen.has(key)) continue;
    seen.add(key);
    entries.push({ key, sentence, characterId: String(x.characterId || "bob") as CharacterId, name: String(x.name || ""), at: Number(x.at) || 0, copied: !!x.copied, copiedAt: x.copiedAt ? Number(x.copiedAt) || null : null });
  }
  const pending: NotebookPending[] = [];
  for (const p of Array.isArray(o.pending) ? o.pending : []) {
    const x = (p || {}) as Record<string, unknown>;
    const key = String(x.key || "").trim();
    if (!key || seen.has(key) || pending.some((q) => q.key === key)) continue;
    pending.push({ key, characterId: String(x.characterId || "bob") as CharacterId, at: Number(x.at) || 0, nudged: !!x.nudged });
  }
  return { entries, pending };
}

// ─── Seeing the move ─────────────────────────────────────────────────────────
// Atlassian MCP tool names: `mcp__<server>__transitionJiraIssue` (the server
// is "claude_ai_Atlassian_MCP" today, a plugin's name tomorrow) — or the
// generic `executeWrite` with `name: "transitionJiraIssue"`.
const KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

function nameOf(toolName: string, input: Record<string, unknown>): string {
  const base = String(toolName || "").split("__").pop() || "";
  if (/^execute(Read|Write|Destructive)$/i.test(base)) return String(input.name || "");
  return base;
}
function inputsOf(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  const base = String(toolName || "").split("__").pop() || "";
  if (/^execute(Read|Write|Destructive)$/i.test(base)) return (input.inputs && typeof input.inputs === "object" ? input.inputs : {}) as Record<string, unknown>;
  return input;
}
function keyIn(inputs: Record<string, unknown>): string | null {
  const k = String(inputs.issueIdOrKey ?? inputs.issueKey ?? inputs.key ?? "").trim().toUpperCase();
  return KEY_RE.test(k) ? k : null;
}

/** A "move this ticket" call → its key and the transition id it asked for. */
export function jiraMoveOf(toolName: string, input: unknown): { key: string; transitionId: string | null } | null {
  const ti = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (!/^transitionJiraIssue$/i.test(nameOf(toolName, ti))) return null;
  const inputs = inputsOf(toolName, ti);
  const key = keyIn(inputs);
  if (!key) return null;
  const t = inputs.transition as Record<string, unknown> | undefined;
  const id = t && typeof t === "object" ? t.id : inputs.transitionId;
  return { key, transitionId: id != null ? String(id) : null };
}

/** A "which moves are offered" call and its answer → id → name, per key. The
 *  character always asks before it moves (the overlay says so), so the town
 *  learns the names without a Jira token of its own. Tolerant of the response
 *  shape: structured, or JSON text inside `content`. */
export function jiraTransitionsOf(toolName: string, input: unknown, response: unknown): { key: string; names: Record<string, string> } | null {
  const ti = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (!/^getTransitionsForJiraIssue$/i.test(nameOf(toolName, ti))) return null;
  const key = keyIn(inputsOf(toolName, ti));
  if (!key) return null;
  const names: Record<string, string> = {};
  // Jira's answer is `{ transitions: [{ id, name, to: {...} }] }` — found either
  // as structured content or as JSON text inside the MCP `content` blocks.
  const walk = (v: unknown, depth: number): void => {
    if (depth > 8 || v == null) return;
    if (typeof v === "string") {
      const s = v.trim();
      if (s.startsWith("{") || s.startsWith("[")) { try { walk(JSON.parse(s), depth + 1); } catch { /* plain text */ } }
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.transitions)) {
        for (const t of o.transitions) { const x = (t || {}) as Record<string, unknown>; if (x.id != null && typeof x.name === "string") names[String(x.id)] = x.name; }
      }
      for (const x of Object.values(o)) walk(x, depth + 1);
    }
  };
  walk(response, 0);
  return Object.keys(names).length ? { key, names } : null;
}

/** The columns and moves that mean "the work is done from Maksym's side". */
export const REVIEW_COLUMNS = ["code review", "review completed"];
export const REVIEW_MOVES = ["to review", "review approved"];
/** A column name or a transition name → did the ticket reach review? */
export function reachedReview(statusOrMove: string | null | undefined): boolean {
  const s = String(statusOrMove || "").trim().toLowerCase();
  return !!s && (REVIEW_COLUMNS.includes(s) || REVIEW_MOVES.includes(s));
}

// ─── The sentence ────────────────────────────────────────────────────────────
export const SENTENCE_MAX = 280;
export const SENTENCE_MIN = 30;

function stripMd(s: string): string {
  return String(s || "").replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]*)\*\*/g, "$1").replace(/__([^_]*)__/g, "$1").replace(/^\s*[-*•]\s+/gm, "").replace(/\s+/g, " ").trim();
}

/** The line as written → accepted text, or why not (the tool answers with it
 *  so the character fixes it once). Rules: names the key · ONE sentence ·
 *  Ukrainian (Cyrillic letters outnumber Latin, the key and code words aside)
 *  · a length a hand can copy. */
export function sentenceCheck(key: string, raw: string): { ok: true; sentence: string } | { ok: false; reason: string } {
  const k = String(key || "").trim().toUpperCase();
  if (!KEY_RE.test(k)) return { ok: false, reason: `"${key}" is not a ticket key (expected something like HIGHCAP-275)` };
  let s = stripMd(raw);
  if (!s) return { ok: false, reason: "the sentence is empty" };
  if (!s.toUpperCase().includes(k)) return { ok: false, reason: `the sentence must name the ticket ${k}` };
  if (!/[.!…]$/.test(s)) s += ".";
  // One sentence: no end-of-sentence mark followed by a space and a capital letter inside it.
  const inner = s.slice(0, -1);
  if (/[.!?…]\s+[A-ZА-ЯІЇЄҐ]/.test(inner)) return { ok: false, reason: "that is more than one sentence — make it exactly one" };
  if (s.length > SENTENCE_MAX) return { ok: false, reason: `too long to copy by hand (${s.length} characters; keep it under ${SENTENCE_MAX})` };
  if (s.length < SENTENCE_MIN) return { ok: false, reason: "too short to say what was done and what the hard part was" };
  const cyr = (s.match(/[А-Яа-яІіЇїЄєҐґ]/g) || []).length;
  const lat = (s.replace(k, "").match(/[A-Za-z]/g) || []).length;
  if (cyr < 12 || cyr < lat) return { ok: false, reason: "the sentence must be in Ukrainian (Cyrillic), with only the ticket key and real code names in Latin" };
  return { ok: true, sentence: s };
}

// ─── The state's moves ───────────────────────────────────────────────────────
/** A ticket reached review with nobody's line yet: remember who owes it. A
 *  key that already has a line, or is already pending, changes nothing. */
export function notePending(state: NotebookState, key: string, characterId: CharacterId, at: number): { state: NotebookState; added: boolean } {
  if (state.entries.some((e) => e.key === key) || state.pending.some((p) => p.key === key)) return { state, added: false };
  return { state: { entries: state.entries, pending: [...state.pending, { key, characterId, at, nudged: false }] }, added: true };
}

/** The line lands: first one per key wins; the key's pending goes. */
export function addLine(state: NotebookState, line: { key: string; sentence: string; characterId: CharacterId; name: string; at: number }): { state: NotebookState; result: "new" | "dupe"; existing?: NotebookEntry } {
  const existing = state.entries.find((e) => e.key === line.key);
  if (existing) return { state, result: "dupe", existing };
  const entry: NotebookEntry = { key: line.key, sentence: line.sentence, characterId: line.characterId, name: line.name, at: line.at, copied: false, copiedAt: null };
  return { state: { entries: [...state.entries, entry], pending: state.pending.filter((p) => p.key !== line.key) }, result: "new" };
}

/** Maksym ticks (or unticks) a line. */
export function setCopied(state: NotebookState, key: string, copied: boolean, at: number): NotebookState {
  return { entries: state.entries.map((e) => e.key === key ? { ...e, copied, copiedAt: copied ? at : null } : e), pending: state.pending };
}

/** What the Stop hook tells the CLI. A pending key of THIS character with no
 *  line and no nudge yet → block once, with the ask; the key is marked nudged
 *  so a second stop always goes through (never a loop). `stopHookActive` is
 *  the CLI saying "this stop is already the continuation of a blocked one" —
 *  then nothing is refused, whatever the state says. */
export function stopVerdict(state: NotebookState, characterId: CharacterId, stopHookActive: boolean): { block: false } | { block: true; key: string; reason: string; state: NotebookState } {
  if (stopHookActive) return { block: false };
  const owed = state.pending.find((p) => p.characterId === characterId && !p.nudged && !state.entries.some((e) => e.key === p.key));
  if (!owed) return { block: false };
  const next: NotebookState = { entries: state.entries, pending: state.pending.map((p) => p.key === owed.key ? { ...p, nudged: true } : p) };
  return { block: true, key: owed.key, reason: nudgeText(owed.key), state: next };
}

/** The ask, as the model reads it (right after the move, and on a refused stop). */
export function nudgeText(key: string): string {
  return `Maksym's notebook: ${key} reached Code Review this job and has no notebook line yet. Before you finish, call the \`notebook_line\` tool ONCE with key "${key}" and ONE sentence in Ukrainian that names ${key}, says what exactly was done, and what the core technical problem was (he copies it by hand into a paper notebook, so one plain sentence, no Markdown, under ${SENTENCE_MAX} characters). Then finish as usual.`;
}

/** The line as the character's chat shows it. */
export function bubbleText(sentence: string): string { return `📓 Записав у записник Максима: ${sentence}`; }

/** Lines not yet copied — the number on the street. */
export function uncopiedCount(state: NotebookState): number { return state.entries.filter((e) => !e.copied).length; }

/** Newest first. */
export function sortedEntries(state: NotebookState): NotebookEntry[] { return [...state.entries].sort((a, b) => b.at - a.at); }

/** A line written in the last few minutes still "wet" — the paper animates it. */
export const FRESH_MS = 10 * 60_000;
export function isFresh(entry: NotebookEntry, now: number = Date.now()): boolean { return !entry.copied && now - entry.at < FRESH_MS; }
