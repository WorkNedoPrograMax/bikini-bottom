# Bikini Bottom — the Orca-inspired upgrades (plan v2)

**Date:** 2026-09-09 · **Owner:** Maksym · **Status:** plan, awaiting go
**Where the ideas came from:** a review of Orca (onorca.dev), a developer tool for running agent fleets. We are NOT forking it (its engine is a terminal; ours is the Agent SDK with structured messages). We borrow five ideas and drop one, all grounded in Bikini's real code as of today.
**v2:** revised after a three-role panel review (product / architecture / UX) checked against the code and the app log. Twelve findings folded in; the biggest changed Job 1.

---

## Part 1 — for Maksym (plain language)

### What you'll get, in the order it ships

| # | Feature | What you'll see | Size |
|---|---|---|---|
| 1 | **Reserve light** | A small wooden sign on the street that stays dark most of the day. When Claude's 5-hour tank drops into its last quarter it lights up amber: "Reserve · 82% used · resets 1:40 PM". Red in the last 10%. After a stop: "Empty · back at 1:40 PM". A one-line Telegram heads-up the first time it lights. **Honest limit:** Claude only reports the level once it's past ~75% used, so the sign cannot show a full green-to-red gauge. It shows the part that matters: the warning before the wall. | small |
| 2 | **Chalk line** | Under each working character's name, one sentence in their own words about where they are: "reproduced the refund bug, testing a fix". Updates as they work. When a character finishes without ever writing one, the first line of their final reply is used. Also on the Orders board and in /town on your phone, where silence shows as "(no update yet · 12 min)". | small |
| 3 | **Catch-up board** | The Orders board uses kitchen words that tell the cases apart: ASKING YOU, NEEDS A YES, ON HOLD · 1:40, CHECK-IN, COOKING, SERVED, MIXED UP. Each line carries a faint preview of the last thing the character said and how long it has been that way. Lines that need you float to the top. The street label says "asking you" instead of a generic "waiting for you". | small–medium |
| 4 | **Come back later** | A wooden "Come back later" button in the Work Window and on each board line. Puts the red dot back on a character you've already looked at. Opening the character clears it; handing out a new order clears it too. On the phone, the "finished" message gets a button for it. | small |
| 5 | **Point at it** | In a character's Work Window, a "Point at it" button opens that lane's own running app inside the window, phone-width. You click the things that are wrong, add a short note to each, press Send. The character receives a cropped picture of each element plus a plain description and your note, fixes it, and you click again to check. | large (two jobs) |

**Dropped: scanning old Claude transcripts on disk.** I claimed Squidward's old terminal work was invisible. The numbers say otherwise: Bikini's own past-orders archive holds 75 / 47 / 72 conversations for SpongeBob / Squidward / Patrick, each with its Claude session id, while the disk holds only 25 / 22 / 23 transcripts. Only 2 / 1 / 1 are missing from the archive. Not worth a line of code.

### How we'll build it (the Squidward shape)

- Each row above is **one fresh session, pre-scoped, no drip questions.** Jobs 1–4 build and check on a branch **without relaunching the running app**. One relaunch at the end, and I ask first.
- Every job ends with a plain-node check script (like the existing `check-guards`), so the logic is proven before you see it.
- Job 5 is split: first a **clickable standalone mockup** of the pointer so you judge the feel, then the real wiring.

### What changes for the characters

Two new sentences in their instructions: post a one-line status after every meaningful step (job 2), and treat pointed-at elements as the design brief (job 5). Nothing else about how they work changes.

### What the panel changed

- Job 1 was a full fuel gauge with an 80% warning. The log shows Claude never reports a level below ~75%, so it became a reserve light and the copy says so.
- Board words were a mix of car and kitchen metaphors ("TANK EMPTY", "NEEDS OK"); now all kitchen.
- Buttons were emoji (📌 🎯); the town avoids emoji chrome, so they are wooden word-buttons. Emoji stay on Telegram.
- Chalk lines were going to collide on a narrow window (three characters, one at 47% and one at 63%); now 20 characters wide, two lines max, hidden for idle characters and while a window is open, never on Mr. Krabs.
- Several plumbing details a builder would have tripped over (see Part 2).

---

## Part 2 — for the builder (a fresh Claude session)

### Ground rules
- Node 22 for build: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`; `npm run build` = `tsc`. Visual check: `BIKINI_CAPTURE=/path.png electron .` photographs the page and quits.
- **NEVER relaunch the running app without Maksym's explicit OK** (characters may be cooking). Build + check scripts only; relaunch is a separate, asked step.
- Architecture invariants: renderer holds no state and only sends named intents (`src/shared/ipc.ts` is the only shared vocabulary, AD-4); the snapshot is a pure fold over the event log (`src/main/domain/snapshot.ts`, AD-2); pure helpers live in `src/main/adapters/guards.ts` so `scripts/check-guards.mjs` can test them without Electron; no emoji in app chrome (AD-7).
- Whenever `TownSnapshot` or `CharacterView` gains a field, **three** constructors need it: `emptyTown()` and the `fold()` return literal in `snapshot.ts`, and `snapshot()` in `main.ts`. `tsc` will remind you; expect it.
- One branch `feat/orca-upgrades`, one commit per job. The working tree already has unrelated uncommitted changes (package-lock, the lane.ts meter fix, guards.ts, check-guards.mjs); commit those first as their own "meter fix" commit or leave them out of the job commits deliberately.

### Job 1 — Reserve light (town-level usage warning)

**Fact base (verified in the app log `~/Library/Application Support/bikini-bottom/bikini.log`, 851 events).** The SDK streams `rate_limit_event` while any character works. Three statuses: `allowed` (172 events, **none carry `utilization`**), `allowed_warning` (257 events, always with `utilization`, **lowest ever 0.75**), `rejected` (26). Two windows: `five_hour` and `seven_day` (53 warning events with util, e.g. 0.91 on 31 Aug). `resetsAt` is unix s or ms (`normalizeResetsAt` handles both). Today Squidward's five-hour went 0.93 → 0.94 → 0.95 → 0.96 → `rejected` → `allowed` with a new `resetsAt`. Consequence: below ~75% the app is blind; the feature is a **reserve light**, not a gauge. Today only the per-lane `stats.limitUtil` keeps the latest number and it shows only inside the open Work Window's meter.

**Build.**
1. `ipc.ts`: `Gauge = { util: number|null; resetsAt: number; at: number; level: "dark"|"amber"|"red"|"empty" }`, `Fuel = { fiveHour: Gauge|null; sevenDay: Gauge|null }`, `TownSnapshot.fuel: Fuel`. (`guards.ts` imports types from `ipc.ts`, as today.)
2. `guards.ts`: pure `foldFuel(prev: Fuel, ev: {type; status; util?; resetsAt}, now): Fuel`. Rules: `allowed_warning` with util → store util, level amber (<0.9) or red (≥0.9); `rejected` → util 1, level empty; `allowed` → if `now > prev.resetsAt` (a fresh window) → util null, level dark, keep the new `resetsAt`; else leave util as is; ignore events whose `at` is older than stored. `fuelWord(g, now)` → `"Reserve · 82% used · resets 1:40 PM"` / `"Empty · back at 1:40 PM"` / `null` when dark; append `"· as of 12 min ago"` when `now - at > 10 min`. `fuelWarnDue(prev, next)` → true on the first amber-or-worse for a given `resetsAt` (persist `warnedFor: resetsAt`).
3. `lane.ts`: `LaneManager` gets `private fuel: Fuel` + `private warnedFor = 0`, loaded from `<userData>/fuel.json` (path passed in from `main.ts`); in the `rate_limit_event` handler (~line 1273) call `foldFuel`, persist, `onChange()`; if `fuelWarnDue` → new optional callback `onFuelWarning(text)`. Expose `fuel(): Fuel`.
4. `main.ts`: `snapshot()` sets `base.fuel = lanes?.fuel() ?? EMPTY_FUEL`; `onFuelWarning` → `tg.send("⛽ Claude's 5-hour tank is in reserve (82% used) — resets 1:40 PM. Long orders will slow down; hand the next task out as a NEW order.")` once per window; `sendTgTown` appends the `fuelWord` for each window when not dark.
5. `snapshot.ts`: `emptyTown()` and `fold()` return `fuel: EMPTY_FUEL`.
6. Renderer: `#fuel` element beside the Orders button, class `fuel amber|red|empty|stale`, text from `fuelWord`; hidden when dark. Style: small wooden sign, `--disp` font, same shadow as `.topbtn`. Tooltip: weekly window word.
7. `scripts/check-guards.mjs`: a "fuel" block replaying 15 real lines from the log (today's 0.93 → rejected → allowed run, plus one `allowed` with no util mid-window) asserting levels, the single warning, and the fresh-window reset.

**Done when:** build clean; checks green; `BIKINI_CAPTURE` shows no sign (dark) — then a fixture-driven capture (`BIKINI_SMOKE` path) shows the amber sign.

### Job 2 — Chalk line (agent-written status)

**Fact base.** Characters have an in-process MCP server `bikini` with the `ask_maksym` tool (`lane.ts:~1124`). The live `activity` label ("thinking…", "running a command…") is machine-derived and shown only in the open window. Nothing on the street says what a character is actually doing. Orca's equivalent is `worktree set --comment`.

**Build.**
1. `guards.ts`: pure `sanitizeStatus(raw: string): string|null` — trim, collapse whitespace, strip markdown/newlines, cut at 90 chars on a word boundary, null if empty or a question (ends with `?`) — questions go through `ask_maksym`. Pure `statusAccepted(lastAt, now)` → false when < 20 s since the last accepted one (the tool then answers "kept your previous line", never an error). Pure `fallbackNote(finalReply)` → first 90 chars, markdown stripped.
2. `lane.ts`: `tool("post_status", "Post ONE plain sentence for Maksym about where you are right now (what just happened → what's next). Call it after every meaningful step or phase change. It is not a question and it never waits.", { status: z.string() }, …)` next to `ask_maksym`; handler → `sanitizeStatus`, cooldown, then `l.note = s; l.noteAt = now; onChange()`. Fields `note`, `noteAt` on `Lane`, on `PersistedLane.current`, written in `persist()` (~line 338) **and** restored in the loader (~line 359) **and** reset in `startJob` (~line 478, where the meter resets) **and** in `resumePast` (~line 824, a promoted old order must not carry a stale note). Keep on finish; if `note` is null when the job finishes (`goIdle`), set it from `fallbackNote(last "them" reply)`. Clear on scrap. Add to `LaneView`. System prompt append (~line 1210): one sentence telling the character to use `post_status` at checkpoints and that it is NOT a substitute for `ask_maksym`.
3. `ipc.ts`: `CharacterView.note: string|null`, `noteAt: number`; `OrderLine.note: string|null`.
4. `main.ts`: `snapshot()` fills `note/noteAt` from `lanes.view(id)` for non-home-base characters; `buildOrders` copies `note`; `sendTgTown` adds `↳ note` under the title, or `(no update yet · 12 min)` when null and working.
5. Renderer `renderStreet`: `a._note = el("div","note")` after the label; shown only when `state === "working"` **and** no window is open; never for `krabs`. CSS `.actor .note`: `--disp` font 11–13px, `max-width: 20ch`, two lines (`-webkit-line-clamp: 2`), translucent white, `text-shadow` like `.label`. Board: faint second line under each title.
6. `check-guards.mjs`: cases for `sanitizeStatus` (markdown, 300-char rant, a question, empty), the cooldown, `fallbackNote`.

**Done when:** build clean, checks green, a smoke snapshot shows `note` on characters (null before any job is fine).

### Job 3 — Catch-up board (previews + "asking you")

**Fact base.** `buildOrders` (`main.ts:364`) maps question/approval/paused/collision all to `WAITING`; the street's `stateWord.calling` is always "waiting for you". The board (`renderer.js:534`) shows title + status only and builds the status class as `"s-" + status.replace(/\s+/g, ".")` — a class with a dot is unselectable, so the existing `.s-SENT.back` rule (`styles.css:397`) is already dead. Telegram `/town` already distinguishes the cases — reuse its predicate order.

**Build.**
1. `ipc.ts`: `type Attention = "question"|"approval"|"limit"|"paused"|"snag"|"collision"|"done"|null`; `CharacterView.attention`; `OrderLine.attention`, `OrderLine.preview: string|null`, `OrderLine.since: number`, `OrderLine.slug: string` (CSS-safe, e.g. `asking-you`). Extend `OrderStatus` with `"ASKING YOU" | "NEEDS A YES" | "ON HOLD" | "CHECK-IN" | "MIXED UP"`.
2. `main.ts`: `attentionFor(id): Attention` with the exact predicate order of `sendTgTown` (working → null; pendingChoice → question; pendingAsk → approval; limitedUntil → limit; paused → paused; burned → snag; collision → collision; state calling → done). `buildOrders` uses it: question → `ASKING YOU`, approval → `NEEDS A YES`, limit → `ON HOLD` (renderer appends `· 1:40`), paused → `CHECK-IN`, snag → `BURNED`, collision → `MIXED UP`, working → `COOKING`, done → `SERVED`, plus existing `SENT BACK`/`SCRAPPED`; `slug = status.toLowerCase().replace(/\s+/g,"-")`; `preview` = `previewOf(last from:"them" non-tool message)`; `since` = expose `phaseSince` in `LaneView`.
3. `guards.ts`: pure `previewOf(text)` → first 90 chars, one line, markdown/code fences stripped.
4. Renderer: `stateWord(state, attention)`: question → "asking you", approval → "needs a yes", limit → "on hold", paused → "checking in", snag → "hit a snag", done → "waiting for you". Board: order needs-you first, cooking, then served; faint `preview` line; `since` as `· 12 min` after the status; classes `s-asking-you`, `s-needs-a-yes`, `s-on-hold`, `s-check-in`, `s-mixed-up`, and fix `s-sent-back`. Colours: needs-you red (as WAITING today), cooking brown, served green, on-hold grey.
5. Telegram: `/town` adds the `preview` line only when the character needs you.
6. `check-guards.mjs`: `previewOf` cases.

**Done when:** build clean, checks green, `BIKINI_CAPTURE` with the board open (`initialBoard` in the renderer bridge) shows the new words with their colours.

### Job 4 — Come back later

**Fact base.** `unseen` is folded from `CharacterStateChanged` (`snapshot.ts`): true only while `calling`. `markSeenIfWatching` (`main.ts:424`) flips calling→idle when you look. There is no way to re-flag a character. `askPast` (`lane.ts:865`) flips a character to `working` while browsing an old order, so "working clears the pin" would drop pins wrongly. `notifyTgDone` uses `sendLong` (plain text, no buttons).

**Build.**
1. `events.ts`: `ReminderSet {id}` / `ReminderCleared {id}` (+ `NewEvent` variants). `snapshot.ts`: `reminded` per character; `c.unseen = c.state === "calling" || reminded`; cleared by `ReminderCleared` or by `JobHandedOut` (a genuinely new order) — **not** by state changes.
2. `ipc.ts`: intent `remindLater {characterId}`; `CharacterView.reminded: boolean`.
3. `main.ts`: `remindLater` → append `ReminderSet`, `openWindowId = null` (so the dot is visible), push. `openCharacter` → if reminded, append `ReminderCleared`. `markSeenIfWatching` is untouched (reminded is independent of state). Telegram: `/town` prefixes 📌 when reminded; after `notifyTgDone`'s `sendLong`, a second short `tg.send("Come back to this later?", [[{text:"📌 Remind me", data:"remind:<id>"}]])`; `handleTgTap` handles `remind:`.
4. Renderer: wooden word-button "Come back later" in the Work Window header (non-home-base) and a small "later" link at the end of each board line; both send `remindLater`. Street label when reminded and idle: "come back to this".
5. `scripts/check-fold.mjs` (pure): register → calling → ReminderCleared → idle → ReminderSet → unseen true → CharacterStateChanged working (askPast) → still true → JobHandedOut → false.

**Done when:** build clean, fold check green.

### Job 5 — Point at it (two sessions)

**Fact base.** Each adopted lane's app is already running: `http://localhost:3100|3200|3300` (`config/adoptions.ts`), a React mobile-web app. The renderer's CSP is `default-src 'none'` (no iframes). Electron 43 provides `WebContentsView` (main-process owned, positioned over the window): no CSP fight, and `webContents.capturePage(rect)` gives the cropped screenshot. **Z-order rule:** a `WebContentsView` composites above the page, so it hides anything under its bounds (dim layer, board, First Run card, chat chrome). Attachments already flow to characters (`Attachment` in `ipc.ts`; images inline, other files saved into the lane with their path handed over). Per-call context is ~150–200k tokens, so the send must stay small.

**5a — the mockup (show first).** A standalone `mockup/point-at-it.html`: a fake phone-width page inside a Work Window frame, a wooden "Point at it" toggle, hover highlight, click → a card in a right-hand tray with a tiny thumbnail (canvas crop), element summary ("button · 'Claim plan' · 44×160 · #e74c3c · 14px") and a note box; remove/edit; a Send button that shows the composed message. Maksym approves look and wording. No app code.

**Decision after 5a (2026-09-10, Maksym approved the mockup):** the page shows at **desktop width by default** (Maksym develops S&R in a desktop browser), with a small wooden **Desktop / Phone** switch above it; Phone = 390 px centred. Remember the last choice per lane. Plain kind words (button, heading, field, tab, card, label, picture, text, box), sizes W×H, composed message ends "tell me which file you touched". Bounds for the WebContentsView therefore = the whole middle column (chat 24% left, tray 300 px right), not a 390 px strip.

**Build for a later mobile engine (Maksym, 2026-09-10: "build it all wisely so it's easy to append it afterwards").** Point at it is two halves: the *engine* that shows the app and answers "what is at this spot?", and the *tray* (cards, notes, compose, send). Only the engine is web-specific. So:
- Put the engine behind one small interface, `PointerSource` in `adapters/pointer/`: `open(bounds)`, `setBounds`, `hide`, `close`, `arm()`, and it emits `pick(PickRaw)`. `WebPointerSource` (WebContentsView + preload) is the only implementation now; a future `SimulatorPointerSource` (screenshot of the iOS/Android simulator + view-hierarchy lookup, e.g. via Maestro/idb/adb) slots in without touching the tray, the renderer or the compose step.
- `Pick` in `ipc.ts` is engine-neutral: `{ kind, label, rect, image (PNG base64), note, details: Record<string,string> }` — `details` carries whatever the engine knows (web: colour, font, radius, cssPath; a simulator would give class, accessibility id). `summarizePick` / `composePicksMessage` render only what is present; they must not assume CSS fields exist.
- `WindowView.pointer` describes the source, not the web: `{ kind: 'web' | 'simulator', url?: string, view: 'desktop' | 'phone' }`. The renderer shows the button whenever `pointer` is non-null.
- The Desktop / Phone switch is a `view` hint the source may ignore (a simulator is always phone-shaped).
- The JSON attachment is named by what it holds, `pointed-elements.json`, with `engine: 'web'` at the top so the character knows what kind of details to expect.
- `scripts/check-pointer.mjs` tests summarize/compose with both a web-shaped and a details-less pick.

**5b — the wiring.**
1. `adapters/pointer.ts`: `PointerManager` — `open(id, url)` creates a `WebContentsView` with preload `pointerPreload.js`, adds it to `win.contentView`, `setBounds` from renderer intent `pointerBounds {x,y,w,h}` (sent on layout/resize; bounds = the right two-thirds of the Work Window, phone-width 390 px centred, tray stays in renderer space below/outside the bounds); `hide()` whenever `openWindowId` changes, the board opens, First Run shows, or the window blurs/minimises; `close()`. Navigation locked to the lane's origin (`will-navigate` guard).
2. `pointerPreload.js`: on `pointer:arm` inject an overlay: `mousemove` → outline; `click` (capture, `preventDefault`) → `{ tag, text (≤80), rect, outerHTML (≤2 KB, attributes trimmed), computed: color, background-color, font-family, font-size, font-weight, line-height, margin, padding, border-radius, display, width, height, cssPath }` → `ipcRenderer.send("pointer:pick", data)`.
3. Main on `pointer:pick`: `view.webContents.capturePage(rect)` → PNG resized to ≤400 px wide → base64 → push into that lane's `picks` (max 5; a 6th is refused with a toast); `WindowView.picks: Pick[]` (`ipc.ts`); renderer renders the tray (thumbnail, summary, note input, remove).
4. Send: intent `sendPicks {characterId}` → main composes ONE follow-up: `Maksym pointed at 3 things on http://localhost:3100/plans (390px phone view). 1) button "Claim plan" 160×44, red #e74c3c, 14px — Maksym: "make it full width". [image 1] …` + attachments: each PNG inline, and one `pointed-elements.json` (outerHTML + computed CSS) as a non-image file — HTML/CSS never inline in the prompt. Then `followUp` as usual; tray clears. Prompt note: treat pointed elements as the design brief; find them in this lane's `src/`; after changing, say which file.
5. Renderer: wooden word-button "Point at it" in the Work Window header only when `WindowView.pointerUrl` is non-null (main sets it from the adoption's `frontendPort`); the chat narrows to the left third while open.
6. `scripts/check-pointer.mjs` for the pure parts (`summarizePick`, `composePicksMessage`, HTML trimming, size caps). Manual: open Bob, Point at it, click two elements, Send → Bob's reply names files.

**Later, not now:** source-map lookup (file:line of the element) — S&R's dev build may expose it.

### Relaunch & rollout
- Jobs 1–4: build, checks, one **asked** relaunch. Then a normal day of use.
- Job 5a: open the mockup, get a yes/no on the feel.
- Job 5b: build, checks, one **asked** relaunch.

### Ready-to-paste job prompts

**Job 1:** "Bikini Bottom, job 1 of the Orca plan (`{output_folder}/planning-artifacts/orca-borrowed-features-plan.md`, Job 1 — Reserve light). Build it exactly as specified on branch feat/orca-upgrades, extend scripts/check-guards.mjs with real log lines, run build + checks + a BIKINI_CAPTURE shot. Do NOT relaunch the app. Report with the capture."

**Job 2:** same sentence with "Job 2 — Chalk line".

**Job 3:** same with "Job 3 — Catch-up board".

**Job 4:** same with "Job 4 — Come back later; add scripts/check-fold.mjs".

**Job 5a:** "Build `mockup/point-at-it.html` per Job 5a of the plan: a clickable standalone mockup, no app code. Open it for me."

**Job 5b:** "Wire 'Point at it' per Job 5b of the plan. Do NOT relaunch; end with build + check-pointer green."
