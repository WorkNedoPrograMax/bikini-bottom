# Bikini Bottom — a cozy home for your work

This file is the full context for this project. If you're a fresh Claude session picking this up, read this top to bottom — it has everything. Nothing from any other project applies here; this is standalone.

## What this is
A warm, funny **desktop app that wraps Claude Code**. Instead of terminal windows and tabs, you work through a little SpongeBob town: each "lane" of work is a character living in Bikini Bottom. The whole point is that it should feel **personal, cozy and fun — not like a tech tool.**

## Who it's for, and how to talk to him
Built for **Maksym**, a **non-technical product owner**.
- In chat: **plain language, product-first, no jargon, no code or file names.** If he wants technical detail he'll ask.
- **Show, don't tell.** He reacts best to *seeing and clicking* a live mockup, not to descriptions. Build/open things for him.
- **Be honest** about what's possible and what isn't. Don't oversell.

## The world & the cast (ONE world: Bikini Bottom)
Each work lane = a neighbour standing on Conch Street in front of their house:
- **SpongeBob** (pineapple) — the eager lane, ready for anything
- **Squidward** (moai head) — the grumpy "teal" lane
- **Patrick** (rock) — the easy lane, simple jobs
- **Sandy** (treedome) — the science/research lane
- **Mr. Krabs** (Krusty Krab) — "home base", where you hand out the work

(Number of lanes is flexible; this is the chosen cast. Mixing other franchises was considered and rejected — one cohesive world feels cozier.)

## What it should do (requirements gathered so far)
- **Person + house.** Each character stands out on the street by their house — you see the character, not just a building.
- **At least 3 character states, shown by behaviour** (not by labels/pills):
  1. **idle** — nothing to do, just standing around
  2. **working** — busy, doing something (a real pic/gif)
  3. **finished-but-not-yet-seen** — the character visibly **waits for you**
- **Seen / unseen marker.** A clear sign of whether Maksym has looked at a finished result yet; it clears when he opens that lane. Nothing finished should ever be missable.
- **Session / "orders" list is hidden by default** — summoned on demand (a button or a hotkey), shown as the **Krusty Krab menu / sidewalk chalkboard**: every job across all lanes in one place.
- **Getting to the work.** Clicking a character (or house) opens a **cozy, on-theme work window** — a dressed-up wrapper around the **Claude conversation** for that lane (paste a task, watch Claude's reply as warm chat bubbles). It must respect the world's look and NOT feel like a techy terminal.
- **Sounds.** Each character has their own voice line / catchphrase (Warcraft-peon-style energy) that plays when their lane **finishes or needs you** — distinct per character so you know by ear which lane is calling.

## Look & assets — "bring your own pictures"
- The art is **real SpongeBob backgrounds and characters**, daytime, straight-on Conch Street view.
- **Every visual is a swappable picture/gif slot.** Maksym drops in image/gif files and they appear — no hand-drawn art in the final product. Same for sounds (audio files).
- **Copyright:** the show's art and audio belong to Nickelodeon. This is a **private, personal tool** — do not publish or share it with the real assets baked in. **Never fetch or AI-generate the show's artwork**; only wire in the asset files Maksym provides himself. (Claude models can't generate/repaint images anyway.)

## Under the hood (for the eventual build)
- It's a **front-end wrapper over Claude Code.** Each lane is a Claude Code session; ideally each lane runs in its **own git worktree** so parallel work doesn't collide ("lanes").
- Foundation: the **Claude Agent SDK** (TypeScript: `@anthropic-ai/claude-agent-sdk`) provides the session management, tools, permissions, hooks and streaming. You build the **cozy UI shell** on top (e.g. Electron or Tauri + a web front-end).
- Sounds: the app plays a local audio file when a lane finishes / needs input.
- Target platform: **macOS** (Maksym's machine).

## Process (important — design before build)
1. **DESIGN FIRST — ✅ done (locked 2026-07-12).** The clickable mockup (`mockup/bikini-town.html`) is the approved design: all 3 states with real pictures for SpongeBob/Squidward/Patrick, Sandy & Mr. Krabs as stand-ins, Galley-Grub-style orders menu, wooden work window, placeholder voices, desktop notifications.
2. **Lock the requirements — ✅ done.** See `REQUIREMENTS.md` (plain-language, the build contract).
3. **BUILD with BMAD — ⬅️ where we are now.** BMAD v6 is installed (`_bmad/` + skills in `.claude/skills/`). Use the BMAD workflows to plan → build → test the real app, dropping in Maksym's real pictures, gifs and sounds. Maksym still owes: Sandy & Mr. Krabs pictures/houses, real voice clips.

## What's included in this folder
- `mockup/bikini-town.html` — the working, clickable **design mockup**. Open it in a browser. It shows the daytime town; characters in the 3 states (SpongeBob working, Squidward waiting with an unseen dot, Patrick idle); the summonable orders board (the 📋 button / press **M**); and the cozy work window (click a character). *Characters are emoji stand-ins for Maksym's real pics/gifs.*
- `mockup/conch-day.png` — the daytime Conch Street background (Maksym-provided).
- `mockup/conch-night.png` — a night version (spare; day is the chosen look).

## Immediate next step
Open the mockup, confirm the vision, and ask Maksym what he wants to change next. Stay in the DESIGN phase until he says the design is locked.
