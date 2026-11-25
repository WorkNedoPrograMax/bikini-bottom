// Which model a helper (sub-agent) runs on — decided by the town, not by the
// character's prompt.
//
// 2026-11-24, measured with scripts/lane-usage.mjs --by-helper: helpers were 45%
// of the lanes' cost and 92% of their calls ran on Opus, although the stage note
// told builders to give look-up helpers Sonnet. A note is a suggestion; this is
// the setting.
//
// How it is enforced: the lane's PreToolUse hook sees every Agent/Task launch
// and, for a look-up helper, returns the launch with `model: "sonnet"` as its
// updatedInput. Probe 2026-11-25 (SDK 0.3.289, CLI 2.1.289): a helper whose own
// file says `model: opus`, launched with `model: "opus"`, ran its calls on
// claude-sonnet-5-5 with the rewrite and on claude-opus-5-5 without it — the
// rewrite beats both the caller and the helper's file.
//
// Reviewers, lenses, auditors and walkthroughs are left alone (Opus, as their
// own files or the caller say). Not covered: agents a Workflow script starts
// inside its own run (they do not pass through the Agent tool).

/** Helpers that only search, read or gather. Matched on the name after a
 *  plugin prefix, so "flutter:figma-comparer" and "figma-comparer" both count. */
export const LOOKUP_HELPERS: ReadonlySet<string> = new Set([
  "Explore",
  "general-purpose",
  "task-context-harvester",
  "figma-comparer",
]);

export const LOOKUP_MODEL = "sonnet";

const AGENT_TOOLS = new Set(["Agent", "Task"]);

/** The launch input with the look-up model forced in, or null when this tool
 *  call is not a look-up helper launch (or already asks for that model).
 *  A launch with no subagent_type is the engine's general-purpose helper. */
export function pinnedHelperInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (!AGENT_TOOLS.has(toolName)) return null;
  const raw = typeof input.subagent_type === "string" && input.subagent_type.trim() ? input.subagent_type.trim() : "general-purpose";
  const base = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
  if (!LOOKUP_HELPERS.has(base)) return null;
  if (input.model === LOOKUP_MODEL) return null;
  return { ...input, model: LOOKUP_MODEL };
}

/** Put the pinned input on an "allow" verdict. A refusal, an ask still open or
 *  any verdict that is not an allow is returned untouched. */
export function withPinnedHelper<T>(toolName: string, input: Record<string, unknown>, verdict: T): T {
  const pinned = pinnedHelperInput(toolName, input);
  const out = (verdict as { hookSpecificOutput?: { permissionDecision?: string } } | null)?.hookSpecificOutput;
  if (!pinned || !out || out.permissionDecision !== "allow") return verdict;
  return { ...(verdict as object), hookSpecificOutput: { ...out, updatedInput: pinned } } as T;
}
