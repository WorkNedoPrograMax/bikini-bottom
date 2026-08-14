# Bikini Bottom — Locked Requirements (design phase complete)

Design locked by Maksym on 2026-07-12. The clickable mockup at `mockup/bikini-town.html` is the visual source of truth — the real app should look and behave like it. CONTEXT.md holds the background story; this file holds what we're committing to build.

## The product in one sentence
A cozy macOS desktop app that wraps Claude Code: each work lane is a SpongeBob character living on Conch Street, and Maksym hands out jobs, watches progress, and reads results without ever seeing a terminal.

## The cast (5 lanes)
| Character | Home | Role |
|---|---|---|
| SpongeBob | pineapple | the eager lane |
| Squidward | moai head | the teal lane |
| Patrick | rock | the easy lane |
| Sandy | treedome (picture pending) | the science/research lane |
| Mr. Krabs | Krusty Krab (picture pending) | home base — where work is handed out |

## What the app must do
1. **The street.** One daytime, straight-on Conch Street scene (Maksym's background picture). Every character stands in front of their home. Sandy's and Mr. Krabs' house pictures arrive later from Maksym; the street must accept them as drop-in additions.
2. **Three states per character, shown by the picture itself** (no labels/pills as the primary signal):
   - **idle** — resting picture (e.g. Squidward in his bath)
   - **working** — busy picture (e.g. Patrick hammering)
   - **waiting** — finished-and-waiting picture (e.g. Patrick checking his watch), plus a pulsing red "unseen" dot and a nudging speech bubble
3. **Seen/unseen.** A finished lane keeps its red dot until Maksym opens that lane; opening clears it. Nothing finished may ever be missable.
4. **Every visual and sound is a swappable file slot.** Pictures/gifs per character per state; one voice clip per character. Maksym provides all assets (never fetched or AI-generated — Nickelodeon owns the art; the app is private and personal). Static pictures are shown as-is (no added wiggle); gifs bring their own motion.
5. **Voices.** When a character changes state it plays its own voice clip — distinct per character, Warcraft-peon energy. The "finished, waiting for you" call is the most prominent. Simultaneous state changes play staggered, never on top of each other.
6. **Desktop notifications.** When a lane finishes, a real macOS notification (like Telegram's) appears: who finished and a one-line summary. Clicking it should bring the app/lane forward.
7. **Orders board.** Hidden by default; summoned with the 📋 button or the **M** key. Styled as the Krusty Krab "Galley Grub" paper menu: tan paper, nailed corners, dark-red hand-painted title, one line per job with dotted leader to its status — WAITING (red) / COOKING (brown) / SERVED (green).
8. **Work window.** Clicking a character (or house) opens the cozy chat: wooden frame, parchment walls, cartoon-outlined bubbles, character portrait + per-character accent colour in the header. This is a real Claude Code conversation dressed up — paste a task, watch replies as chat bubbles. It must never feel like a terminal.
9. **Mr. Krabs = home base.** His window is where work gets handed out (choose a character, give the job), fitting his "you hand out the work" role.

## Under the hood (agreed foundation)
- Front-end wrapper over **Claude Code** via the **Claude Agent SDK** (TypeScript, `@anthropic-ai/claude-agent-sdk`) for sessions, tools, permissions, streaming.
- Each lane = its own Claude Code session, ideally in its **own git worktree** so parallel lanes don't collide.
- Shell: desktop app for **macOS** (Electron or Tauri + web front-end — final pick during BMAD planning).
- Sounds are local audio files; notifications are native macOS.

## Explicitly out of scope / later
- Sandy's & Mr. Krabs' pictures, houses, and a possible wider street background (Maksym may create one).
- Night version of the street (spare picture exists).
- Publishing/sharing of any kind — this stays a private personal tool with Maksym's own assets.
