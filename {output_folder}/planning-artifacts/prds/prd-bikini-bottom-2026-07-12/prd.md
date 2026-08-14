---
title: Bikini Bottom — PRD
status: final
created: 2026-07-12
updated: 2026-07-12
---

# PRD: Bikini Bottom

*A cozy home for your work.*

## 0. Document Purpose

This PRD is the build contract for Bikini Bottom, written for the downstream BMAD workflows (UX spec, architecture, epics & stories). It builds on two locked inputs and does not duplicate them: `REQUIREMENTS.md` (the plain-language design-phase contract, locked 2026-07-12) and the clickable mockup `mockup/bikini-town.html` (the visual source of truth — the real app should look and behave like it). Vocabulary is anchored in §3 Glossary; features are grouped in §4 with globally numbered FRs; everything inferred without Maksym's confirmation is tagged `[ASSUMPTION]` inline and indexed in §11. This revision incorporates the findings of four reviews (rubric, PM, architecture, UX) — see `review-*.md` alongside this file.

## 1. Vision

Bikini Bottom is a warm, funny macOS desktop app that wraps Claude Code. Instead of terminal windows and tabs, Maksym works through a little SpongeBob town: each parallel lane of work is a Character standing on Conch Street in front of their house. He hands out Jobs at the Krusty Krab, hears a character's voice when one finishes, and reads results in a cozy wooden chat window — never a terminal.

The point is not efficiency; it's affection. Claude Code is powerful but feels like a tech tool. Bikini Bottom makes the same power feel personal, cozy, and fun: you glance at the street and *see* who's busy, who's idle, and who's calling for you — by how they behave, not by labels. Nothing that needs Maksym is ever missable — including bad days: a failed or stuck Job calls for him exactly like a finished one. Every picture and sound is Maksym's own.

## 2. Target User

Exactly one user: **Maksym**, a non-technical product owner who runs several strands of Claude Code work in parallel and wants to do it without terminals, jargon, or fear of missing a finished result. The app is private and personal — see §5 Non-Goals.

**Standing guidance for every downstream phase (from CONTEXT.md):** talk to Maksym in plain language — product-first, no jargon, no code or file names in chat; show, don't tell (he reacts best to things he can see and click); be honest about what's possible and don't oversell. This applies to the humans and agents building the product *and* to every word the product itself says (§8).

### 2.1 Jobs To Be Done

- **Functional:** run several Claude Code work lanes at once on one shared Project without them colliding, and hand out / monitor / read work without technical UI.
- **Emotional:** make daily work feel cozy and joyful — a town of friends, not a dashboard.
- **Contextual:** know *by ear and by glance* which lane needs attention, even when the app is in the background.
- **Trust:** never miss anything that needs him — finished, asking, or in trouble; never wonder silently whether Claude did something risky without asking; never lose work to an invisible technical accident.

### 2.2 Key User Journeys

- **UJ-1. Maksym hands out an order.** Maksym opens the app in the morning; the town is idle. He clicks the Krusty Krab. Mr. Krabs' window opens; Maksym picks Patrick (idle, therefore available) and types the job in plain words. Patrick's street picture switches to his Working slot and the Orders Board now shows the job as COOKING. Maksym closes the window and goes about his day — the job keeps cooking.
- **UJ-2. A voice calls him back.** While Maksym reads email, SpongeBob's voice line plays and a macOS notification appears: "SpongeBob finished: renamed all the product pages." He clicks the notification; the app comes forward with SpongeBob in his Calling picture, red Unseen Dot pulsing, speech bubble nudging. Maksym clicks SpongeBob and reads the result as chat bubbles — the work has already landed in the Project (FR-16), and a "Send it back" option sits right there if he doesn't like it; the dot clears once he's seen the result. Nothing was missable: even if he'd ignored the sound, the dot and the Orders Board would still show it.
- **UJ-3. A character asks permission.** Mid-job, Squidward's Claude session wants to do something Risky. Squidward switches to Calling behaviour (dot, voice, bubble: "Need your OK, barnacle-head"). Maksym opens Squidward's Work Window and sees a plain-language question with Allow / Deny buttons in a chat bubble. He clicks Allow; Squidward goes back to Working. If he closes the window *without* answering, the question is still unresolved — so the dot stays. Safe everyday actions never interrupt him.
- **UJ-4. An order gets burned.** Patrick's job hits a wall (an error, or Claude's usage limit for the hour). Patrick goes Calling; the Orders Board shows the job as BURNED; a notification says "Patrick got stuck: couldn't finish the renaming." Maksym opens Patrick, reads a plain-language explanation, and picks one of the offered choices — try again, or scrap the order. No silent failures, no character stuck "busy" forever.

## 3. Glossary

*Downstream documents must use these terms verbatim.*

- **Town** — the single main screen: daytime Conch Street scene with all Characters and their houses.
- **Character** — one work lane's persona, each with a role and personality: SpongeBob (pineapple — the eager lane), Squidward (moai head — the grumpy lane, teal accent), Patrick (rock — the easy lane, simple jobs); later Sandy (treedome — the science/research lane). Each Character has a house, three State pictures, one Voice Line, and a per-Character accent colour. All Characters belong to the one SpongeBob world — mixing franchises was considered and rejected (one cohesive world is cozier); FR-2 drop-ins must honor this.
- **Home Base** — Mr. Krabs + the Krusty Krab. Not a work lane: the place where Jobs are handed out. Mr. Krabs runs no Claude session of his own in v1 (confirmed by Maksym, 2026-07-12).
- **Lane** — the working machinery behind a Character: one Claude Code session working on the shared Project, isolated so parallel Lanes don't collide.
- **Project** — the one shared folder of real work the whole Town operates on. One Project at a time in v1. A plain folder is acceptable: First Run sets up any invisible machinery the folder needs (FR-19).
- **Job** (aka **Order**) — one task handed to one Character. One active Job per Character; a busy Character can't take another, no queueing (confirmed by Maksym, 2026-07-12). Board lifecycle: WAITING → COOKING → SERVED, with **BURNED** as the failure exit. WAITING also covers "paused for Maksym's OK".
- **State** — a Character's visible condition, shown by its picture/behaviour, never by labels: **Idle**, **Working**, **Calling**. *(Calling is the state REQUIREMENTS.md calls "waiting" — renamed here so it can't be confused with the Orders Board's WAITING status.)* Calling covers all three "needs Maksym" cases: finished-unseen, asking permission, in trouble.
- **Unseen Dot** — the pulsing red marker on a Calling Character. It clears only when the *need* is resolved: the result is seen, the question is answered, or the trouble is acknowledged — not merely because a window was opened.
- **Orders Board** — the summonable Galley-Grub-style paper menu listing every Job across all Lanes with status.
- **Work Window** — the cozy chat window for one Character: a dressed-up real Claude Code conversation (wooden frame, parchment, cartoon bubbles).
- **Voice Line** — a Character's own audio clip — a catchphrase with Warcraft-peon-style energy — played when it starts Calling; distinct enough per Character to know by ear who's calling.
- **Asset Slot** — a named file location where Maksym drops a picture/gif/sound; the app uses whatever file is present, with a clearly-labelled stand-in when absent.
- **Risky Action** — a step Claude wants to take that requires Maksym's OK (asked in the Work Window). Everything else is a **Safe Action** and proceeds silently. The exact safe/risky boundary is settled during architecture — see Open Question 3.
- **Serving** — the moment a finished Job's work lands in the Project: automatic on finish, with a per-order **Send it back** undo. (Maksym's decision, 2026-07-12 — chosen over a look-first review gate.)

## 4. Features

### 4.1 The Town

**Description:** One daytime, straight-on Conch Street scene (Maksym's background picture) fills the main window. Each Character stands in front of their house — you see the person, not just a building. The Town is the resting screen of the whole app; everything else (Orders Board, Work Windows) is summoned from it. Realizes UJ-1, UJ-2.

#### FR-1: Street scene
The app displays the Town using the background Asset Slot, with SpongeBob (pineapple), Squidward (moai head), Patrick (rock) and Mr. Krabs (Krusty Krab) each positioned by their house, matching the mockup's layout.
**Consequences (testable):**
- Launching the app shows all four Characters and their houses over the daytime background with no other chrome that reads as "tech tool".
- Each Character (and its house) is clickable: Characters open their Work Window (FR-11); the Krusty Krab opens Home Base (FR-15).

#### FR-2: Drop-in Characters
A new Character (Sandy first) can be added by providing its Asset Slots (pictures, house, Voice Line) and a position — with no redesign of the street. [ASSUMPTION: adding a Character is a config-plus-files affair Maksym can do with guided help, not a code change he must understand.]
**Consequences (testable):**
- Adding Sandy's files and an entry in the Character list makes her appear on the street with full State behaviour, without changes to any other feature.

### 4.2 Character States & the Unseen Dot

**Description:** Each Character shows exactly one of three States at all times, expressed by the picture itself (Idle: resting; Working: busy; Calling: needs Maksym), never by labels or pills as the primary signal. A Calling Character additionally gets the pulsing red Unseen Dot and a nudging speech bubble. Static pictures are shown as-is (no added wiggle); gifs bring their own motion. Realizes UJ-2, UJ-3, UJ-4.

#### FR-3: Three picture States
Each Character's on-street picture always reflects its Lane: Idle when no Job, Working while a Job cooks, Calling when its Job has finished, needs an OK, or has hit trouble.
**Consequences (testable):**
- Handing a Job to an idle Character switches its picture to the Working slot within a second.
- A Lane that finishes, pauses on a Risky Action, or fails switches the Character to the Calling slot — there is no way for a Lane to need Maksym while its Character looks Idle or Working.

#### FR-4: Unseen Dot + nudge, until resolved
A Calling Character shows a pulsing red dot and a speech bubble until the need is resolved in its Work Window: result seen, question answered, or trouble acknowledged. Then the Character returns to Idle (or Working, if the answer resumed the Job). *(Deliberate strengthening of the locked requirement's "opening the lane clears it" — an opened-but-unanswered permission question must not go dark; UX review finding C-1.)*
**Consequences (testable):**
- Opening and closing the Work Window *without* resolving the need (e.g. an unanswered Allow/Deny) leaves the dot in place.
- The dot never clears by itself — not on app restart, not with time.
- After a restart, a Character that was Calling is still Calling with its dot.

#### FR-5: Trouble handling (BURNED orders)
When a Lane fails or stalls (error, usage limit, lost connection), its Character goes Calling and the Job shows as BURNED on the Orders Board. The Work Window explains what happened in plain language and offers plain choices — at minimum "try again" and "scrap this order". Realizes UJ-4.
**Consequences (testable):**
- Killing a Lane's ability to work (e.g. network off) results in a Calling Character and a BURNED order within a reasonable time — never a forever-"Working" Character.
- "Try again" resumes or restarts the Job; "scrap" retires the order and returns the Character to Idle; both choices are visible in the chat history.

### 4.3 Voices & Notifications

**Description:** The Town talks to Maksym even when he isn't looking at it — but only when it matters. A Character plays its Voice Line when it starts Calling (finished / needs an OK / trouble); starting work is silent or nearly so. When a Lane starts Calling, a real macOS notification names the Character and says why in one line. Realizes UJ-2, UJ-4.

#### FR-6: Per-Character Voice Lines
Each Character plays its own Voice Line (defined in §3) when it starts Calling; clips are distinct enough to identify the Character by ear. The finished-unseen call is the most prominent sound in the app. *(Deliberate narrowing of the locked requirement's "on every state change" back to CONTEXT.md's original "finishes or needs you" scope — UX review flagged voice-on-everything as fatigue risk.)*
**Consequences (testable):**
- Handing out a Job produces no voice interruption (a subtle acknowledgment sound at most); a Character starting to Call always produces its Voice Line (unless muted, FR-8).
- Two Lanes starting to Call at (nearly) the same moment play their Voice Lines staggered, never overlapping.
- Missing voice files fall back to a labelled placeholder sound, and the app still works. [ASSUMPTION: placeholder sounds stay until Maksym delivers real clips.]

#### FR-7: macOS notifications
A Lane starting to Call fires a native macOS notification: Character name + one plain-language line — what was finished, what OK is needed, or what went wrong. Clicking it brings the app forward focused on that Character. [ASSUMPTION: the one-line summary for finished work is produced by the Lane's Claude session as part of finishing the Job.]
**Consequences (testable):**
- The notification arrives even when the app is in the background or the Town window is closed-to-dock.
- Clicking the notification opens/raises the app and opens that Character's Work Window directly.
- First Run asks for macOS notification permission and explains why (FR-19).

#### FR-8: Quiet controls
Maksym can mute all sounds or adjust their volume from an unobtrusive, on-theme control; notifications remain on when sound is muted.
**Consequences (testable):**
- Muting stops Voice Lines immediately and persists across restarts; the visual signals (States, dots, board) are never muted.

### 4.4 The Orders Board

**Description:** The session list stays hidden by default and is summoned on demand — the 📋 button or the **M** key — styled as the Krusty Krab "Galley Grub" paper menu: tan paper, nailed corners, dark-red hand-painted title, one line per Job with a dotted leader to its status. Realizes UJ-1, UJ-4.

#### FR-9: Summonable board
The Orders Board toggles with the 📋 button or the M key and shows every Job across all Lanes in one place.
**Consequences (testable):**
- The Orders Board is not visible on launch; pressing M shows it; pressing M (or Esc, or the button) hides it.

#### FR-10: Job lines & statuses
Each Job renders as one line — plain-language title, dotted leader, status: WAITING (red — handed out or paused for Maksym's OK), COOKING (brown — working), SERVED (green — done), BURNED (charcoal — failed/stuck, until resolved via FR-5).
**Consequences (testable):**
- Statuses update live while the board is open.
- Clicking a Job line opens that Character's Work Window. [ASSUMPTION: board lines are clickable shortcuts; the mockup implies but doesn't demonstrate this.]

### 4.5 The Work Window

**Description:** Clicking a Character (or house) opens the cozy chat: wooden frame, parchment walls, cartoon-outlined bubbles, Character portrait and per-Character accent colour in the header. Behind the dressing it is a real Claude Code conversation for that Lane — Maksym types or pastes a task, watches replies arrive as warm chat bubbles. It must never feel like a terminal. Realizes UJ-2, UJ-3, UJ-4.

#### FR-11: Cozy chat over a real session
The Work Window shows the Lane's live Claude conversation as chat bubbles (Maksym's messages on one side, the Character's on the other), streaming in as Claude works.
**Consequences (testable):**
- A running Job's progress is visible as it happens while the window is open; closing the window never stops the Job.
- Raw technical output (file paths, command logs, code) is folded away by default behind a plain-language line, expandable on demand. [ASSUMPTION: expandable folding is the right cozy/honest balance — the mockup shows only clean bubbles.]

#### FR-12: Permission asks, in character
When a Lane hits a Risky Action it pauses, the Character goes Calling (dot + Voice Line), and the Work Window shows the request as a plain-language chat bubble with Allow / Deny buttons. Safe Actions never ask.
**Consequences (testable):**
- Denying lets the conversation continue (Claude explains and adjusts); allowing resumes work; either way the choice is visible in the chat history.
- Safe Actions (everyday reading/editing inside the Project) produce no interruptions at all.
- An unanswered ask keeps the Character Calling and the order WAITING (FR-4, FR-10).

#### FR-13: Follow-ups in the same conversation
Maksym can reply to a finished Job in the Work Window ("actually, make the title bigger") and the Character resumes Working in the same conversation. A Character's conversation persists until Maksym hands that Character a *new* Job from Home Base, which starts a fresh conversation. [ASSUMPTION: a follow-up flips the same Job line back to COOKING rather than creating a new Job.]
**Consequences (testable):**
- Sending a message to an Idle Character with a past conversation continues that conversation; States and the Orders Board update accordingly.
- Handing the same Character a new Job from Home Base starts a clean conversation; the old one's outcome remains on the board as history. [ASSUMPTION: the board keeps a modest history of SERVED/scrapped orders rather than growing forever — exact retention decided in UX.]

#### FR-14: Cancel an order
Maksym can cancel a COOKING or WAITING Job from its Work Window; the Character returns to Idle and the order is retired.
**Consequences (testable):**
- Cancelling visibly stops the work within seconds; the cancellation appears in the chat history; no half-done work ever lands in the Project — landing happens only when a Job finishes (FR-16).

### 4.6 Home Base (Mr. Krabs)

**Description:** Mr. Krabs' window is where work gets handed out, fitting his "you hand out the work" role. Maksym picks an available Character and describes the Job in plain words; Mr. Krabs assigns it and the town gets to work. Serving — how finished work lands in the Project — is Home Base's other responsibility. Realizes UJ-1, UJ-2.

#### FR-15: Hand out a Job
In the Krusty Krab window Maksym chooses among currently-Idle Characters and enters the Job in plain language; the chosen Lane starts Working on the shared Project. [NOTE FOR UX: the character-picker moment has no visual definition in the mockup — the UX spec must design it.]
**Consequences (testable):**
- Busy (Working/Calling) Characters are visibly unavailable for new Jobs.
- The new Job appears on the Orders Board with the Character's name.

#### FR-16: Serving finished work
A finished Job's work lands in the Project automatically, and every served order carries a plain **Send it back** undo in its Work Window that removes that order's changes from the Project. (Maksym's decision, 2026-07-12.) If landing work collides with something another Character changed, the Character pauses instead of landing silently: it goes Calling and asks in plain language which version should win — never a technical merge screen.
**Consequences (testable):**
- A finished Job's work is in the Project within seconds of SERVED, with no action from Maksym.
- "Send it back" restores the Project to how it was before that order, and says so in the chat; if newer served work is tangled up with it, the Character explains and offers a plain-language choice rather than failing or breaking the Project. [ASSUMPTION: plain-choice entanglement handling is the product bar; mechanics decided in architecture — see Open Question 4.]
- A collision at landing presents as a plain-language choice in the chat; picking either option leaves the Project consistent.
- Maksym never sees or performs a technical merge step.

#### FR-17: One shared Project, isolated Lanes
All Lanes work on the one configured Project. Lanes are isolated from each other so parallel work never collides while cooking; collisions surface only at landing time (FR-16).
**Consequences (testable):**
- Two Characters working at once never corrupt or overwrite each other's in-progress work.
- The Project may start as a plain folder; First Run (FR-19) sets up whatever invisible machinery isolation needs, without Maksym doing technical steps.

### 4.7 Asset Slots (bring-your-own pictures & sounds)

**Description:** Every visual and sound is a swappable file slot: per-Character State pictures/gifs, house pictures, one Voice Line each, the street background. Maksym drops files in and they appear. The app never fetches or generates the show's artwork — Nickelodeon owns it; this is a private personal tool.

#### FR-18: Swappable slots with stand-ins
Each Asset Slot uses the file Maksym provides; absent files show/play a clearly-labelled neutral stand-in (as the mockup does for Sandy and Mr. Krabs today).
**Consequences (testable):**
- Replacing a file and relaunching (or a refresh action) shows the new asset — no other steps.
- No asset is ever downloaded from the internet or AI-generated by the app.

### 4.8 First Run

**Description:** The first launch is a scene, not a settings form: Mr. Krabs welcomes Maksym, walks him through pointing the Town at his Project folder (a plain folder picker in cozy dress), asks for notification permission with a reason, and offers to drop in pictures/sounds now or later. Realizes the "no technical steps, ever" promise from minute one.

#### FR-19: Guided first run
On first launch the app walks Maksym through: choosing the Project folder, granting notification permission, and (optionally) placing assets. It silently prepares whatever the Project folder needs for Lane isolation (FR-17).
**Consequences (testable):**
- A non-technical user goes from first launch to handing out a first Job without touching anything technical or reading documentation.
- Pointing at a plain, non-technical folder works; the app performs any setup itself and says so in plain words.

## 5. Non-Goals (Explicit)

- **Not multi-user, not published, not shared.** One user, one Mac, real assets never leave the machine.
- **Not a terminal.** No mode where raw terminal UI is the interface; folded technical detail (FR-11) is the ceiling.
- **Not a Claude Code replacement for programmers.** No tabs, panes, keybinding systems, or power-user session tooling beyond what the Town metaphor carries.
- **Not a generic multi-project dashboard** (v1 is one Project; see §6.2).
- **No AI-generated or fetched show artwork or audio, ever.**

## 6. MVP Scope

### 6.1 In Scope

- The Town with SpongeBob, Squidward, Patrick + Mr. Krabs' Krusty Krab (Home Base), on Maksym's daytime background.
- Three picture States per Character (Idle / Working / Calling), Unseen Dot + nudge bubble, clearing only when the need is resolved.
- Trouble handling: BURNED orders, plain-language explanations, try-again/scrap.
- Voice Lines on Calling (placeholder clips until Maksym's arrive), staggered playback, mute/volume, macOS notifications with click-through.
- Orders Board (📋 / M) in Galley Grub style with live statuses (WAITING / COOKING / SERVED / BURNED).
- Work Windows with real Claude conversations, folded technical detail, Risky-Action Allow/Deny, follow-ups, cancel.
- Home Base job handout to Idle Characters; Serving with plain-language collision choices; one shared Project with isolated Lanes.
- Guided First Run (project folder, permissions, assets).
- Asset Slots for everything, with labelled stand-ins.

### 6.2 Out of Scope for MVP

- **Sandy** — joins as the first drop-in Character (FR-2) when her pictures arrive. `[NOTE FOR PM]` emotionally load-bearing; revisit as soon as assets land.
- **Real voice clips & remaining pictures** — Maksym owes Sandy + Mr. Krabs pictures/houses and all real Voice Lines; placeholders ship first.
- **Night street** (spare picture exists) — later cosmetic.
- **Multiple Projects / per-Job Project choice** — deliberate v1 cut (Maksym chose one shared Project); revisit in v2.
- **Wider street background** — Maksym may create one later.
- **Look-first serving** (a "Serve it" review gate before work lands) — considered and not chosen; revisit only if auto-landing ever burns trust in practice.

## 7. Success Metrics

- **SM-1:** A month after v1, Bikini Bottom is how Maksym runs his Claude Code work day-to-day — he hasn't gone back to terminals. Validates the whole spine.
- **SM-2:** Zero missed needs — nothing finished, asking, or BURNED goes unseen for a day without Maksym having chosen to ignore it. Validates FR-4, FR-5, FR-7.
- **SM-3:** Maksym smiles. Genuinely. The app feels like the mockup felt. Validates §8 Aesthetic.
- **Counter-metric SM-C1:** Do not optimize for feature count or "power". Every addition must survive the question "does the town stay cozy?" — counterbalances SM-1.

## 8. Aesthetic and Tone

The mockup `mockup/bikini-town.html` is the binding visual reference — daytime Conch Street, real-show art style (Maksym's assets), Galley-Grub paper menu, wooden Work Window with parchment and cartoon-outlined bubbles, per-Character accent colours. Anti-references: terminals, IDEs, dashboards, anything with a sidebar of monospace text. Product-generated text (notifications, stand-in labels, status words, trouble explanations) speaks plainly and warmly, in keeping with the show's tone; statuses keep the diner vocabulary (WAITING / COOKING / SERVED / BURNED). Bad news is delivered gently and honestly — a burned order is a joke about Patrick's cooking, not a stack trace.

## 9. Constraints and Guardrails

- **Copyright/privacy:** Show assets belong to Nickelodeon; the app is private and personal, never published or shared with real assets baked in; the app never fetches or generates them (FR-18).
- **Platform:** macOS only (Maksym's machine). Desktop app; shell choice (Electron vs. Tauri) is an architecture decision — inputs in the addendum.
- **Agreed foundation (binding input to architecture):** the app wraps Claude Code via the Claude Agent SDK (TypeScript); each Lane is its own Claude Code session, isolated per Lane (git worktrees are the working hypothesis). Architecture may deviate only by surfacing a plain-language blocker to Maksym — not silently.
- **Reliability (cross-cutting NFR):** All state — States, dots, board, conversations, each order's Send-it-back ability — survives app quit, crash, and Mac sleep. A COOKING Job pauses when the app quits and offers to resume on relaunch — nothing works invisibly in the background (confirmed by Maksym, 2026-07-12).
- **Cost:** Lanes consume Claude usage. v1 needs no budgeting UI, but usage-limit stalls must surface as trouble (FR-5), never as silence. [ASSUMPTION: Maksym's existing Claude Code subscription/limits apply and suffice; the app adds no separate metering.]

## 10. Open Questions

1. **Sandy & Mr. Krabs assets** — when will pictures/houses arrive? (Owner: Maksym; revisit when delivered — triggers FR-2 for Sandy.)
2. **Real Voice Lines** — Maksym to deliver per-Character clips; placeholders until then.
3. **The Safe/Risky boundary** — exactly which actions ask for OK (FR-12) is settled during architecture, then explained to Maksym in plain examples for sign-off.
4. **Send-it-back mechanics** — how undo behaves when newer served work overlaps an older order (FR-16). Architecture proposes; the plain-language-choice bar and "no technical merge" bar stand regardless.

## 11. Assumptions Index

- §4.6 FR-16 — entanglement of "Send it back" with newer served work resolves as a plain-language choice; mechanics in architecture (Open Question 4).
- §4.1 FR-2 — adding a Character is config-plus-files with guided help, not a Maksym-facing code change.
- §4.3 FR-6 — placeholder sounds acceptable until real clips arrive.
- §4.3 FR-7 — the notification's one-line summary for finished work is written by the Lane's Claude session.
- §4.4 FR-10 — Orders Board lines are clickable shortcuts to Work Windows.
- §4.5 FR-11 — technical output folded-but-expandable is the right honesty/cozy balance.
- §4.5 FR-13 — a follow-up flips the same Job back to COOKING rather than creating a new Job; the board keeps modest history (retention decided in UX).
- §9 Cost — existing Claude Code plan suffices; no in-app metering in v1.

*Confirmed by Maksym (2026-07-12), no longer assumptions: serving model (auto-land + Send it back), one Job per Character, Mr. Krabs hands out only, pause-on-quit.*
