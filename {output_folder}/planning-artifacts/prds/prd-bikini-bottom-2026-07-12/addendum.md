# Bikini Bottom PRD — Addendum

Depth that belongs downstream (architecture, UX spec) but was gathered during PRD discovery. Not part of the build contract.

## Agreed technical foundation (from REQUIREMENTS.md / CONTEXT.md)

- Front-end wrapper over Claude Code via the **Claude Agent SDK** (TypeScript, `@anthropic-ai/claude-agent-sdk`) for sessions, tools, permissions, streaming.
- Each Lane = its own Claude Code session, ideally in its **own git worktree** so parallel Lanes on the same shared Project don't collide.
- Shell: **Electron or Tauri** + web front-end — final pick during architecture.
- Sounds are local audio files; notifications are native macOS.

## Landscape research digest (2026-07-12, web research subagent)

Comparable "parallel Claude Code lanes" desktop apps exist — the concept is proven:

- **Conductor** (conductor.build) — free macOS app; parallel workspaces, each task auto-gets its own git worktree + branch + diff pane; per-repo setup script on workspace creation. Gotcha they hit: worktrees don't copy untracked files (e.g. `.env.local`).
- **Crystal → Nimbalyst** (github.com/stravu/crystal, nimbalyst.com) — Electron; per-session worktrees; Nimbalyst adds automatic per-session status ("done / in progress / needs attention") and push notifications on complete/error/needs-approval — directly analogous to our three States + Unseen Dot.
- **opcode** (github.com/winfunc/opcode) — Tauri 2 GUI; session browser/resume, checkpoints/timeline restore; largest OSS Claude Code GUI.
- **Vibe Kanban** (github.com/BloopAI/vibe-kanban) — web UI; kanban columns as agent lifecycle, worktree per task.
- **Claude Squad** — terminal TUI, tmux + worktrees (anti-reference for our UX, useful for lane mechanics).
- Smaller references: Fergana Labs `claude_agent_desktop` (Electron directly on the Agent SDK, SQLite session persistence), `yume` (Tauri+React, background agents, checkpoints), an Electron starter kit for the Agent SDK (github.com/vanzan01/claude-agent-sdk-starter). Claude Code itself now has native worktree docs + experimental Agent Teams.

## Claude Agent SDK notes relevant to our FRs

- `query({prompt, options})` returns an async generator. **Streaming-input mode** (prompt as AsyncIterable) is required for `interrupt()`, `setPermissionMode()`, and mid-run steering. Relevant to FR-11 (live chat), FR-13 (follow-ups), FR-14 (cancel).
- **Permission prompts in a GUI:** `canUseTool(toolName, input, ...) → PermissionResult` fires only when the flow reaches an interactive prompt (pre-approved tools skip it). `permissionMode`: default / acceptEdits / bypassPermissions / plan / dontAsk / auto. This is the natural implementation seam for FR-12 (Risky-Action Allow/Deny in the chat bubble) and Open Question 3 (the Safe/Risky boundary = the SDK permission config).
- **Sessions:** capture `session_id` from the init message; `resume: id`, `forkSession`, `persistSession`. **Gotcha:** sessions are stored per-`cwd` (`~/.claude/projects/<encoded-cwd>/*.jsonl`) — resuming from a different cwd (i.e. a different worktree) silently starts fresh. Directly affects FR-13 (follow-ups) + per-Lane worktrees: keep each Lane's worktree path stable.
- `listSessions()` / `getSessionMessages()` exist for building session pickers; the V2 `createSession()` API was removed in SDK 0.3.142.
- Fork branches the conversation, **not files** — `enableFileCheckpointing` + `rewindFiles()` for file restore.
- Idle/working signal = message-stream activity + per-turn result message (also carries cost); `includePartialMessages` for token-level streaming; hooks surface needs-attention states. Relevant to FR-3/FR-4 state transitions and FR-7's completion summary.

## Design notes captured during discovery

- The mockup's Work Window shows only clean chat bubbles; FR-11's folded-technical-detail behavior is an inference to keep the "be honest" principle without breaking coziness.
- Statuses keep diner vocabulary (WAITING/COOKING/SERVED) — the Orders Board maps WAITING to a handed-out-but-not-started state; in practice Jobs may go straight to COOKING (assignment starts the Lane). The PRD has since resolved the terminology question: the character state is renamed "Calling"; the board keeps WAITING.
