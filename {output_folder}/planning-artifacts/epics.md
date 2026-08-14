---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-final-validation]
inputDocuments:
  - '{output_folder}/planning-artifacts/prds/prd-bikini-bottom-2026-07-12/prd.md'
  - '{output_folder}/planning-artifacts/ux-designs/ux-bikini-bottom-2026-07-12/DESIGN.md'
  - '{output_folder}/planning-artifacts/ux-designs/ux-bikini-bottom-2026-07-12/EXPERIENCE.md'
  - '{output_folder}/planning-artifacts/architecture/architecture-bikini-bottom-2026-07-12/ARCHITECTURE-SPINE.md'
---

# Bikini Bottom - Epic Breakdown

## Overview

This document decomposes the locked PRD, UX spines (DESIGN.md + EXPERIENCE.md), and architecture spine into implementable epics and stories for the Developer agent. **v1 cast:** SpongeBob, Squidward, Patrick (real pictures) + Mr. Krabs (Home Base). Sandy joins later as a drop-in Character (the roster and asset resolver are built drop-in-ready). Terms are used verbatim from the PRD Glossary. Assumptions carried from planning are tagged `[ASSUMPTION]`.

## Requirements Inventory

### Functional Requirements

- **FR-1:** Street scene — Town renders over the daytime background with each Character positioned by their house; Characters/houses are clickable.
- **FR-2:** Drop-in Characters — a new Character (Sandy first) is added by files + one config row, no redesign.
- **FR-3:** Three picture States — each Character shows Idle / Working / Calling by its picture; a Lane needing Maksym is never shown Idle/Working.
- **FR-4:** Unseen Dot + nudge, until resolved — dot + bubble persist until the need is resolved; survives restart; never self-clears.
- **FR-5:** Trouble handling (BURNED) — failures/stalls go BURNED with a plain explanation and Try again / Scrap it.
- **FR-6:** Per-Character Voice Lines — distinct clip on entering Calling; finished-call most prominent; staggered, never overlapping.
- **FR-7:** macOS notifications — a Lane entering Calling fires a native notification (who + one plain line); click focuses that Character.
- **FR-8:** Quiet controls — mute/volume; visual signals never muted; persists.
- **FR-9:** Summonable Orders Board — 📋 / M toggles a board of every Job.
- **FR-10:** Job lines & statuses — one line per Job with WAITING / COOKING / SERVED / BURNED / SCRAPPED / SENT BACK; live updates; click opens the Work Window.
- **FR-11:** Cozy chat over a real session — Work Window shows the live Claude conversation as bubbles; folded technical detail; closing never stops the Job.
- **FR-12:** Permission asks, in character — Risky Actions pause and ask Allow/Deny in a bubble; Safe Actions never ask.
- **FR-13:** Follow-ups in the same conversation — replying to a finished Job resumes the same conversation.
- **FR-14:** Cancel an order — cancel a COOKING/WAITING Job; Character returns to Idle; no half-work lands.
- **FR-15:** Hand out a Job — Home Base picker of Idle Characters + plain-language Job entry; busy Characters unavailable.
- **FR-16:** Serving finished work — work lands automatically with a per-order Send it back undo; collisions surface as a plain choice, never a merge view.
- **FR-17:** One shared Project, isolated Lanes — all Lanes work the one Project, isolated so parallel work never collides while cooking.
- **FR-18:** Swappable slots with stand-ins — every visual/sound is a user file with a labelled stand-in when absent; never fetched or AI-generated.
- **FR-19:** Guided First Run — walk Maksym through Project folder, notification permission, and optional assets, preparing the folder invisibly.

### NonFunctional Requirements

- **NFR-1 (Reliability):** All state — States, dots, board, conversations, each order's Send-it-back ability — survives app quit, crash, and Mac sleep; a COOKING Job pauses on quit and offers to resume.
- **NFR-2 (Platform):** macOS desktop only.
- **NFR-3 (Cost honesty):** Claude access reuses Maksym's existing subscription login (no metered billing by default; API key optional); usage-limit stalls surface as trouble, never silence; no misleading cost copy.
- **NFR-4 (Copyright/privacy):** Private personal tool; show assets are Maksym's own files, never fetched, generated, published, or shared.
- **NFR-5 (Cozy, never techy):** No surface may read as a terminal/IDE/dashboard; all product text is plain and warm.

### Additional Requirements

*(From the architecture spine — the invariants stories must obey. AD-ids are stable references.)*

- **AD-1:** Main process is the single source of truth (exception: a Lane's SDK session transcript is its chat-log-of-record).
- **AD-2:** One serialized event-log writer, total order via `seq`, persist-before-ack, side-effect-free replay on boot.
- **AD-3:** One Lane = one worktree (path-stable cwd) = one session; new Job resets the worktree + fresh session, follow-up resumes.
- **AD-4:** Renderer speaks intents only; main replies with seq-stamped snapshots + events; token streaming is a separate transient view-only channel.
- **AD-5:** Serving / Send-it-back / collisions are serialized git ops; one Job → one squashed commit tagged `jobId`; never shown as git.
- **AD-6:** Risky vs Safe is the `canUseTool` seam; pending asks survive relaunch (re-driven, never silently resolved).
- **AD-7:** Every visual/sound resolves through the Asset Slot resolver with labelled stand-ins.
- **AD-8:** Claude access reuses Maksym's existing Claude subscription login (SDK spawns the bundled CLI); ensure no stray `ANTHROPIC_API_KEY`; fall back to an official subscription token if keychain access is blocked; explicit API key is an optional advanced path.
- **AD-9:** The Project is sacred — `.bikini/` git-ignored, commits path-scoped, all git ops atomic + crash-recoverable, history only appended.
- **AD-10:** A liveness watchdog turns a silently-stalled COOKING Lane into a BURNED order.
- **AD-11:** In-flight work is conversation-resumable, not turn-resumable; no half-turn is ever committed or double-applied.
- **AD-12:** "Seen" is owned by main; only an explicit render-ack (`markSeen`) after the resolving content is displayed clears the dot.
- **Stack:** Electron 43.1.0, Node 24.18, TypeScript 5.x, @anthropic-ai/claude-agent-sdk 0.3.207, plain HTML/CSS/JS renderer, system git, append-only JSON event log, electron-builder (code-signed + notarized for distribution).

### UX Design Requirements

- **UX-DR1:** Bespoke hand-drawn visual system per DESIGN.md tokens (deep-sea page, galley-paper, rough-cut wood, chalk/marker type, per-Character accents) — no UI framework; captured from `mockup/bikini-town.html`.
- **UX-DR2:** Actor component — real pictures shown as-is (no added wiggle); emoji stand-ins get the mockup animations (sway/bob/hop); Unseen Dot (coral, ping), nudge speech bubble.
- **UX-DR3:** Orders Board — Galley Grub paper menu (tan gradient, nail dots, dark-red title, dotted leaders, status inks), one overlay at a time, board-line click opens Work Window.
- **UX-DR4:** Work Window — wooden frame, parchment wall, cartoon-outlined bubbles, per-Character accent header; in-chat choice buttons use wood style, send button uses per-Character accent.
- **UX-DR5:** First Run walkthrough scene (Mr. Krabs), folder step mandatory / notifications optional / assets optional; street dimmed & non-clickable until complete; resume mid-walkthrough on relaunch. Illustrated by `mockups/mock-firstrun.html`.
- **UX-DR6:** Character picker (Home Base) — portrait chips, accent ring on select, grayed + state word when unavailable. Illustrated by `mockups/mock-handout.html`.
- **UX-DR7:** Trouble & undo scenes — BURNED line + Try again/Scrap (`mockups/mock-burned.html`); Send it back + confirmation (`mockups/mock-sendback.html`).
- **UX-DR8:** Voice & tone — diner vocabulary, character-flavored, honest-underneath; trouble explained gently; no jargon.
- **UX-DR9:** Comfort floor — reduced-motion honored; mute/volume; readable type; not formal WCAG (single known user).

### FR Coverage Map

- **FR-1:** Epic 1 — town renders; Characters by their houses.
- **FR-2:** Epic 1 — roster + resolver built drop-in-ready (Sandy joins post-v1).
- **FR-3:** Epic 1 (states render) + Epic 2 (transitions on work).
- **FR-4:** Epic 2 — Unseen Dot resolve-to-clear.
- **FR-5:** Epic 3 — BURNED + watchdog.
- **FR-6:** Epic 2 (voice on Calling) + Epic 4 (stagger).
- **FR-7:** Epic 1 (permission) + Epic 2 (fires on Calling).
- **FR-8:** Epic 4 — quiet controls.
- **FR-9:** Epic 4 — summonable board.
- **FR-10:** Epic 4 — job lines & statuses.
- **FR-11:** Epic 2 — cozy chat + folded detail.
- **FR-12:** Epic 3 — permission asks.
- **FR-13:** Epic 2 — follow-ups.
- **FR-14:** Epic 3 — cancel.
- **FR-15:** Epic 2 — hand out a Job.
- **FR-16:** Epic 5 — serving, send it back, collisions.
- **FR-17:** Epic 5 (landing) + Epic 2 (isolated cooking).
- **FR-18:** Epic 1 — asset slots + stand-ins.
- **FR-19:** Epic 1 — guided First Run.

## Epic List

### Epic 1: Welcome to Bikini Bottom
Maksym opens the app for the first time, sets it up with zero technical steps, and sees his cozy Conch Street with the characters standing in front of their houses in the right mood.
**FRs covered:** FR-1, FR-2, FR-3 (rendering), FR-7 (permission grant), FR-14 (asset slots), FR-18, FR-19 · **NFRs:** NFR-2, NFR-3, NFR-4, NFR-5 · **ADs:** AD-1, AD-2, AD-4, AD-7, AD-8, AD-9

### Epic 2: Hand out a job and watch it cook
Maksym hands a job to a character at the Krusty Krab and watches it work in the cozy chat, gets called back when it finishes, and can ask for tweaks — the core daily loop.
**FRs covered:** FR-3 (transitions), FR-4, FR-6 (voice on Calling), FR-7 (fires), FR-11, FR-13, FR-15, FR-17 (isolated cooking) · **ADs:** AD-3, AD-4, AD-12

### Epic 3: Trust the town
The town is safe and honest: it asks before anything risky, never hides a failure or a stall, lets Maksym cancel, and never loses work across a quit or crash.
**FRs covered:** FR-5, FR-12, FR-14 · **NFRs:** NFR-1, NFR-3 · **ADs:** AD-6, AD-10, AD-11

### Epic 4: The whole kitchen at a glance
Maksym can summon the Galley Grub orders board to see every job across all characters, and control the town's sounds.
**FRs covered:** FR-6 (stagger), FR-8, FR-9, FR-10 · **ADs:** AD-1, AD-4

### Epic 5: Finished work lands — and the fearless undo
Finished work flows into Maksym's real project automatically, with a Send it back undo and gentle collision choices — and never a technical merge screen.
**FRs covered:** FR-16, FR-17 (landing) · **NFRs:** NFR-1 · **ADs:** AD-5, AD-9

---

## Epic 1: Welcome to Bikini Bottom

Maksym goes from a first launch to a live, cozy town pointed at his project — no jargon, no terminal, nothing technical touched by hand. This epic also lays the load-bearing spine (main-authoritative event log + typed IPC + asset resolver) as the thinnest visible slices, so every later epic builds on a working skeleton.

### Story 1.1: The town window opens

As Maksym,
I want the app to open into a cozy Conch Street window,
So that I see a friendly place, not a program.

**Acceptance Criteria:**

**Given** the app is launched
**When** the main window appears
**Then** a single macOS window shows the daytime Conch Street background from DESIGN.md, sized per the mockup, with no terminal/IDE chrome (NFR-5)
**And** the main process holds an append-only event log with a single writer and `seq` ordering (AD-2), and the renderer receives its first state snapshot over the typed IPC channel and renders from it only (AD-1, AD-4)
**And** the renderer never reads the filesystem, git, or SDK directly (AD-1).

### Story 1.2: First Run — point the town at your project

As Maksym,
I want Mr. Krabs to walk me through choosing my project folder,
So that the town knows where my work lives without me doing anything technical.

**Acceptance Criteria:**

**Given** no Project has been configured yet
**When** the app first launches
**Then** a First Run walkthrough opens inside Mr. Krabs' window with the street dimmed and non-clickable behind it (UX-DR5), and the folder step is mandatory — the walkthrough cannot advance until a folder is chosen via the native picker
**And** when a folder is chosen the app prepares it invisibly: if it is not a git repo it runs `git init` plus an initial commit, creates a git-ignored `.bikini/` holding worktrees + the event log, and reports the prep in plain words (FR-19, FR-17, AD-9)
**And** every git preparation step is atomic and crash-recoverable — an interrupted prep leaves the folder usable and re-attempts cleanly on relaunch (AD-9)
**And** if the folder cannot be prepared, Mr. Krabs explains plainly and offers to pick another folder — never a raw error (NFR-5)
**And** quitting mid-walkthrough resumes at the same step on relaunch, remembering the folder already chosen (UX-DR5).

### Story 1.3: First Run — connect to Claude

As Maksym,
I want the app to just use the Claude I already have,
So that the characters can work without me setting up or paying for anything extra.

**Acceptance Criteria:**

**Given** the folder step is complete
**When** the walkthrough reaches the Claude step
**Then** the app detects Maksym's existing Claude Code subscription login and confirms in plain words that it's connected using the Claude he already has — no API key, no per-use billing (AD-8, NFR-3)
**And** the app ensures no stray `ANTHROPIC_API_KEY` is set that would silently switch to metered billing (AD-8)
**And** if the subscription login can't be read (e.g. keychain blocked), the app falls back to an official one-time subscription token (`claude setup-token`), still on his subscription, explained plainly (AD-8)
**And** an explicit pay-as-you-go API key is offered only as an optional advanced choice, never the default, and no copy implies "hourly reset" semantics (NFR-3)
**And** [ASSUMPTION] if Claude can't be connected at all, the town still opens but handing out a Job explains plainly that Claude isn't connected yet and points back to this step — a required setup step, not a hard block on opening the app
**And** this story verifies real-machine credential pickup and the token fallback (architecture AD-8 open item).

### Story 1.4: First Run — notifications and assets

As Maksym,
I want to optionally turn on notifications and drop in my own pictures,
So that the town can call me when I'm away and look like mine — but I'm not forced to.

**Acceptance Criteria:**

**Given** the Claude step is complete
**When** the walkthrough reaches the notifications step
**Then** it offers "Allow notifications" and a quieter "Not now"; choosing Not now (or macOS denying) shows Mr. Krabs' reassurance and never traps the walkthrough (FR-7, UX-DR5)
**And** an optional assets step lets Maksym place files now or later, and finishing the walkthrough opens the town regardless of the notification choice
**And** if notifications are denied, the Town works normally with voices and dots carrying the load (FR-7, NFR-5).

### Story 1.5: Characters live on the street in their moods

As Maksym,
I want to see SpongeBob, Squidward, Patrick and Mr. Krabs standing by their houses in the right mood,
So that I can read the whole town at a glance.

**Acceptance Criteria:**

**Given** the town is open and configured
**When** the street renders
**Then** each Character appears at their house position from the mockup, showing the picture for their current State — Idle / Working / Calling — resolved through the Asset Slot resolver (FR-1, FR-3, AD-7)
**And** a missing picture falls back to a clearly-labelled stand-in and never crashes the Character (FR-18, AD-7)
**And** real pictures are shown as-is with no added wiggle; emoji stand-ins get the mockup animations (UX-DR2)
**And** no asset is ever fetched from the internet or AI-generated (FR-18, NFR-4)
**And** the Character roster is data-driven so adding Sandy later needs only her files + one config row, with no change to any other feature (FR-2).

---

## Epic 2: Hand out a job and watch it cook

The core daily loop: assign work at Home Base, watch a character cook in the cozy chat, get called back when it's done, and follow up. Parallel Lanes cook in isolation (AD-3) so two characters never collide while working.

### Story 2.1: Hand out a Job at the Krusty Krab

As Maksym,
I want to pick an available character and tell them a job in plain words,
So that work gets started without me choosing anything technical.

**Acceptance Criteria:**

**Given** the Town is open
**When** Maksym clicks the Krusty Krab
**Then** Mr. Krabs' window opens with his greeting and a picker of Character portrait chips; Idle Characters are selectable and busy ones are grayed with their state word (FR-15, UX-DR6)
**When** Maksym selects an Idle Character and enters a job in plain language and sends it
**Then** that Lane starts on a fresh SDK session in its own worktree, reset to the Project main HEAD (AD-3), the Character switches to Working, and a `JobHandedOut` event is recorded (AD-2)
**And** a Character already Working or Calling cannot be handed a new Job — one active Job per Character (FR-15).

### Story 2.2: The cozy Work Window chat

As Maksym,
I want to open a character and watch them work as warm chat bubbles,
So that it feels like talking to a friend, not reading a terminal.

**Acceptance Criteria:**

**Given** a Character has a conversation
**When** Maksym clicks that Character (or a board line, or a notification)
**Then** the Work Window opens with the wooden frame, parchment wall, per-Character accent header and cartoon bubbles (UX-DR4), showing the Lane's live conversation
**And** each Character reply turn is one chat bubble; tool/command activity folds behind one plain-language line that updates live and expands on click (FR-11, AD-4)
**And** live token streaming arrives on the transient view-only channel, and if it drops the durable turn summary still lands (AD-4)
**And** closing the Work Window never stops the Job (FR-11).

### Story 2.3: A character finishes and calls you back

As Maksym,
I want a character to visibly and audibly call me when they finish,
So that nothing finished is ever missed.

**Acceptance Criteria:**

**Given** a Lane finishes its Job
**When** the finish is recorded
**Then** the Character switches to Calling with a pulsing coral Unseen Dot and a nudge bubble (FR-3, FR-4, UX-DR2), plays its distinct Voice Line (FR-6), and — if the app is not frontmost — fires a macOS notification with the Character's name and a one-line summary that focuses that Character on click (FR-7)
**When** Maksym opens the Work Window and the result summary is displayed
**Then** the renderer sends `markSeen(jobId)` and main records `OrderSeen`, clearing the dot; snapshot delivery alone never clears it (FR-4, AD-12)
**And** a Character that was Calling before a restart is still Calling with its dot afterward (FR-4, AD-2, NFR-1)
**And** replaying the log on boot does not re-fire the voice or notification (AD-2).

### Story 2.4: Ask for a tweak (follow-ups)

As Maksym,
I want to reply to a finished job and have the same character keep going,
So that small changes feel like a conversation, not a new order.

**Acceptance Criteria:**

**Given** a Character has a finished conversation and is Idle
**When** Maksym sends a follow-up message in the Work Window
**Then** the same SDK session resumes (not a fresh one), the Character returns to Working, and the same Order flips back to COOKING rather than creating a new Order (FR-13, AD-3)
**And** handing that Character a brand-new Job from Home Base instead starts a fresh conversation, with the prior outcome kept in board history (FR-13, AD-3).

---

## Epic 3: Trust the town

Safety and honesty. Risky actions ask first; nothing fails silently; work can be cancelled; and a quit or crash never loses or duplicates work.

### Story 3.1: Permission asks, in character

As Maksym,
I want a character to stop and ask me before doing anything risky,
So that Claude never changes things I didn't expect.

**Acceptance Criteria:**

**Given** a Lane is Working
**When** it attempts a Risky Action (outside its worktree, a network install, or a destructive shell command per the `canUseTool` allow-list)
**Then** the Lane pauses, `PermissionAsked` is recorded, the Character goes Calling, and the Work Window shows a plain-language Allow/Deny ask as wooden buttons (FR-12, AD-6)
**And** Safe Actions (reads/edits inside the worktree) never prompt (FR-12)
**When** Maksym clicks Allow or Deny
**Then** `PermissionAnswered` is recorded, Allow resumes Working and Deny lets the Character explain and adjust; the choice stays in history
**And** a `PermissionAsked` with no answer at relaunch is re-driven, never silently resolved (AD-6).

### Story 3.2: Burned orders and the watchdog

As Maksym,
I want a character to tell me plainly when a job fails or gets stuck,
So that no character is ever secretly stuck forever.

**Acceptance Criteria:**

**Given** a Lane is COOKING
**When** it errors, hits a usage limit, or loses connection
**Then** the Order flips to BURNED, the Character goes Calling, and the Work Window explains what happened in plain, gentle language with Try again / Scrap it wooden buttons (FR-5, UX-DR7, UX-DR8)
**When** a COOKING Lane produces no activity past the watchdog timeout
**Then** it is turned into a BURNED "got stuck" order rather than staying Working forever (FR-5, AD-10)
**And** until Maksym picks Try again or Scrap it the Character stays Calling; Try again returns it to Working/COOKING, Scrap flips the Order to SCRAPPED and the Character to Idle (FR-5)
**And** the Character's error is never shown as a stack trace or code (NFR-5).

### Story 3.3: Cancel an order

As Maksym,
I want to cancel a job I regret giving,
So that I'm never stuck waiting for work I don't want.

**Acceptance Criteria:**

**Given** a Character's Order is COOKING or WAITING
**When** Maksym clicks Cancel this order and confirms
**Then** the Lane is interrupted, the Character returns to Idle, the Order flips to SCRAPPED, and the cancellation is written into the chat (FR-14, AD-3)
**And** no half-done work lands in the Project — landing happens only when a Job finishes (FR-14, AD-5).

### Story 3.4: Quit and come back

As Maksym,
I want everything to be exactly as I left it when I reopen the app,
So that I can trust the town with days of work.

**Acceptance Criteria:**

**Given** Jobs are in various States (Idle/Working/Calling, dots set)
**When** Maksym quits the app (or it crashes, or the Mac sleeps) and reopens it
**Then** the town restores every Character's State, dot, conversation, board line, and each order's Send-it-back ability from the event log (NFR-1, AD-2)
**And** a Job that was COOKING is paused, its worktree left at its last committed state, and the app offers "keep cooking" which re-drives from that point — no half-turn is committed or double-applied (NFR-1, AD-11).

---

## Epic 4: The whole kitchen at a glance

The summonable Galley Grub board and the town's quiet controls.

### Story 4.1: The Orders Board

As Maksym,
I want to summon one paper menu of every job,
So that I can see the whole kitchen at once.

**Acceptance Criteria:**

**Given** the Town is open
**When** Maksym clicks 📋 or presses M (and no text field is focused)
**Then** the Galley Grub board appears — tan paper, nail dots, dark-red title, one line per Job with a dotted leader (UX-DR3), and it is hidden on launch
**And** each line shows its live status: WAITING / COOKING / SERVED / BURNED / SCRAPPED / SENT BACK with its status ink (FR-9, FR-10)
**When** Maksym clicks a Job line
**Then** that Character's Work Window opens and the board closes; M, Esc, the button, or a scrim click also closes it (FR-10, UX-DR3)
**And** only one overlay is shown at a time (UX-DR3)
**And** an empty board shows a warm "no orders yet" line, never a blank menu (UX-DR8).

### Story 4.2: Quiet controls

As Maksym,
I want to mute or turn down the town and never have voices talk over each other,
So that it stays cozy, not noisy.

**Acceptance Criteria:**

**Given** the Town is open
**When** Maksym uses the mute/volume control
**Then** sound mutes or adjusts immediately and the setting persists across restarts; visual signals (States, dots, board) are never muted (FR-8)
**Given** two or more Lanes enter Calling at nearly the same moment
**When** their Voice Lines would play
**Then** they play staggered and never overlap (FR-6).

---

## Epic 5: Finished work lands — and the fearless undo

Serving: finished work flows into the real Project automatically, undoable, with collisions handled as plain choices — never a merge screen.

### Story 5.1: Serving — finished work lands

As Maksym,
I want a finished job's work to appear in my project automatically,
So that I don't do any technical step to get my results.

**Acceptance Criteria:**

**Given** a Lane finishes a Job
**When** the finish is recorded
**Then** the Job's work is integrated into the Project's main line as exactly one squashed commit tagged with its `jobId`, applied through the single integration queue so simultaneous serves never collide, and the Order shows SERVED within seconds (FR-16, FR-17, AD-5)
**And** the integration is atomic and crash-recoverable, and only Lane work is committed — never the app's own files or `.bikini/` (AD-9)
**And** Maksym never sees or performs a technical merge step (FR-16, NFR-5).

### Story 5.2: Send it back

As Maksym,
I want a plain undo on any served order,
So that I can accept results fearlessly.

**Acceptance Criteria:**

**Given** a served Order
**When** Maksym clicks Send it back under its result summary and confirms
**Then** that order's tagged commit is reverted, the Project is restored to before that order, the Order flips to SENT BACK, and the Character confirms in plain words (FR-16, AD-5, UX-DR7)
**And** the Send it back option stays available for the lifetime of that conversation, survives quit/relaunch, and is retired when that Character is handed a new Job (FR-16, NFR-1).

### Story 5.3: Collisions and entanglement

As Maksym,
I want two characters' overlapping work sorted out with a simple choice,
So that the scariest moment never becomes a technical mess.

**Acceptance Criteria:**

**Given** a finished Job's work overlaps another Character's served work
**When** it is about to land (or a Send it back tangles with newer served work)
**Then** if the two changes don't overlap, both are kept automatically; only when they genuinely conflict does the Character go Calling and ask one plain either/or ("keep {this}'s" / "keep {other}'s") with wooden buttons (FR-16, FR-17, AD-5)
**And** choosing either side lands the order and leaves the Project consistent; the app never shows a diff or merge view (FR-16, NFR-5).
