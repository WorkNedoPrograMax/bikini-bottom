# Bikini Bottom — the Phone Booth (one test phone, shared in turns)

**Date:** 2026-09-28 · **Owner:** Maksym · **Status:** pre-scoped job, reviewed (architect/PM/UX pass applied), awaiting go
**Decision:** for the coming Flutter + Maestro project, the M1 2020 Mac cannot run three simulators at once. So: characters build in parallel on their own copies of the code, but there is ONE test phone in town. A character only waits at the moment it wants the phone and someone else is on it. Everything else keeps running.
**Shape:** one fresh build session, one branch, one commit, a plain-node check script, no relaunch without Maksym's OK (the Squidward shape).

---

## Part 1 — for Maksym (plain language)

### The picture

Think of the old red phone booth on the street. There is one phone. Bob, Squidward and Patrick each cook at their own stove (their own copy of the project, their own build). Cooking never waits. But when one of them wants to *try the dish on the phone* (install the app on the simulator, run a Maestro flow, take a screenshot on it), they walk to the booth. If it is free, they step in. If Patrick is inside, they wait outside the door, and the moment Patrick hangs up they step in. Nobody has to know about anyone else. The town runs the door.

### What you'll see

- **A phone booth prop on the street.** Empty when nobody is testing. When someone is inside, their name is on the door ("Patrick · 4 min"). Anyone waiting keeps their spot on the street and their word changes from "working…" to **"waiting for the phone"**, in the order they arrived.
- **In the Work Window** of a waiting character, the line under the name says *"Waiting for the phone — Patrick is testing (4 min)"*. Nothing is broken; it is a queue, not a snag. No red dot, no phone ping. It is not a "needs you".
- **The Orders board and Telegram `/town`** use the same words: "ON THE PHONE" / "WAITING FOR PHONE".
- **Adding a Flutter town** asks one more question, once, right after the "team repo or my own" question: *"Which phone should the characters test on?"* with a list of the simulators on your Mac. You pick one (or "no phone"). That phone is the booth for that town from then on (changeable in the town's profile file). Scout & Runner is not asked; it has no phone. A Flutter project opened through First Run (not "Add a town") is not asked either; you add the phone to its profile file by hand with the snippet at the end of this brief.
- **When you open a Flutter town**, the town boots that simulator if it is not already running, so the first tester never waits for a cold start.

### What the characters are told

Each character gets one extra paragraph in its standing orders, in plain terms: *there is one test phone, here is its name, always aim your commands at exactly that phone, build and analyse freely, group your phone work together, and if a phone command seems to take a while it is because someone else is on it — do not retry, do not boot a second simulator, never shut down or wipe the phone.* The last three are enforced, not just asked: the town's door guard refuses those commands.

### The rules of the door (the assumptions I made)

| Question | Assumed default | Change it by |
|---|---|---|
| Who goes first? | First come, first served. | Nothing to change; fairness is fixed. |
| How long can one character keep the phone? | As long as its test run lasts. Between two phone commands it keeps the phone for a short grace period (60 seconds) so a build-install-run-flow-screenshot chain is not interrupted mid-way. It lets go when its job ends, when it pauses, finishes, gets stuck, is given a new job, or hits a limit, or when someone is waiting and it has not touched the phone for that grace period. | The grace seconds in the town's profile. |
| What if a character holds the phone forever? | After 30 minutes without a break it is released anyway, and a chalk line under that character says so, so you can look. | The cap in the profile. |
| Android too? | The door works for either. Auto-boot is iOS-only in this job; for an Android emulator the town checks it is running and tells you if it isn't. | A later job. |
| One phone shared by two towns? | Out of scope. Each town has its own booth. | A later job. |
| Three Xcode builds at once on the M1? | The town does not limit building. Each character's copy also pays a first cold build and package install of its own (that is how git worktrees work). If builds themselves crawl, you will see it on the clocks; then the fix is running two characters instead of three, not a code change. | Your call at the time. |
| Does the character need the app's own Maestro/Flutter scripts changed? | No. The door sits in the town, not in the project. | Nothing. |

### What does NOT change

- Scout & Runner: untouched. Its lanes, Docker, ports, everything stays. The booth exists only in towns that have a phone in their profile.
- Cooking, chalk lines, questions, Telegram pings, the Ferry sign: untouched. The booth is one more prop and one more word.
- Bikini still never merges, pushes, or opens pull requests unless the town is set to "auto land".

### A side benefit

Today, when a character asks you a question and you take longer than 10 minutes to answer, a hidden timer can quietly refuse the step it was waiting on. The same fix that lets a character wait for the phone lifts that timer too.

### Size

One job, medium. Most of it is a small queue inside the town plus one hook that already exists (the same door guard that keeps a character inside its own worktree). The visible part is one prop, one word, and one picker card.

### Left out on purpose (say if you want them)

- Maestro Cloud as a "second phone" when the booth is busy (true parallel tests, costs money per run).
- A second physical or virtual phone for a bigger Mac ("two booths").
- A "let me in first" button for you to jump the queue.

---

## Part 2 — for the builder (a fresh Claude session)

### Ground rules
- Node 22: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`; `npm run build` = `tsc`. Visual check: `BIKINI_CAPTURE=/path.png electron .` with `--user-data-dir` pointing at a scratch folder so the running app is never touched (see the screenshot recipe in memory).
- **NEVER relaunch the running app without Maksym's explicit OK.** Build + check script only; relaunch is a separate, asked step.
- Invariants: renderer holds no state and only sends named intents (`src/shared/ipc.ts` is the only shared vocabulary, AD-4); snapshot is a pure fold over the event log plus main-side decoration (`snapshot()` in `main.ts`); pure helpers go in a plain module so a `scripts/check-*.mjs` can test them without Electron; **no emoji in new app chrome** (AD-7; two pre-existing emoji buttons in `index.html` are out of scope).
- When `TownSnapshot` gains a field, three constructors need it: `emptyTown()` and the `fold()` return literal in `src/main/domain/snapshot.ts` (lines ~12 and ~67), and `snapshot()` in `main.ts`.
- Branch `feat/phone-booth` off the current `feat/ferry` HEAD (`d5ff02d`; feat/ferry is live and not yet merged to main). One commit. Untracked files in the tree (`presentation/`, `s1.png`, `.claude/settings.local.json`, planning artifacts) are not part of this job.

### Fact base (verified in code 2026-09-28, line numbers as of `d5ff02d`)

- **Town profile** `src/main/config/townProfile.ts`: `TownProfile { name, landing, lanes?, servers? }`; `normalizeProfile()` (lines 67-89) drops unknown fields, so a new `device` field must be added there or it is silently lost; `seedProfile()`, `laneAdoption()`, `shouldLand()`. `servers` is declared but nothing reads it yet.
- **Non-adopted lanes** (any town without `lanes`): `worktreeFor()` in `src/main/adapters/lane.ts` (~line 1049) → `ensureWorktree()` in `src/main/adapters/git.ts` (26-38) = a bare `git worktree add` of `<project>/.bikini/worktrees/<id>` on branch `lane/<id>` off HEAD. No Docker, no ports. For Flutter this means `build/`, `.dart_tool/`, `ios/Pods` are absent in each lane (git-ignored), so every lane pays its own first `pub get` / `pod install` / cold Xcode build. Nothing to build here; the character note covers it.
- **Sessions, not turns.** There is no `runTurn`. `runSession` (lane.ts ~1170) opens ONE long-lived SDK `query()` per character that spans many messages; the hook, the system prompt (~1276, where `serverNote` is appended) and the SDK options (~1300-1338) all live there. A job "ends" at `goIdle` (1144-1168) after `SETTLE_MS` of silence, not at the `result` message (1520-1557). `send(fresh)` (667-675) can replace the pump with a NEW job without passing through `setPhase("waiting")`. `burn()` (1093-1104) is the stall exit (`endSession`). The `catch` at ~1607 has a "superseded" exit. `runSession` ends in a `finally` at ~1625.
- **The gate** is the in-process SDK `PreToolUse` hook in `runSession` (1319-1338): allows `mcp__bikini__*`, allows everything when bypass is on, otherwise `isSafe()` or pauses the lane and asks Maksym (awaits a promise). A second `PreToolUse` hook exists in `askPast` (~936) for read-only past-session questions; that one must NOT claim the phone.
- **Hook timeout (SDK fact, verified in the installed CLI 2.1.284 and the SDK-bundled CLI 2.1.207):** a callback hook without a matcher `timeout` is capped at **600 s**, and on expiry the tool is **blocked** ("hook callback timed out"), not allowed. `HookCallbackMatcher.timeout` (seconds, `sdk.d.ts` ~796-801) is forwarded per matcher. Consequence today: the ask-Maksym wait at 1332 is silently capped at 10 minutes. The booth wait must set the matcher timeout explicitly, and that also lifts the ask cap.
- **Stall watchdog:** `armWatchdog` re-arms only when an SDK message arrives (~1351); `WATCHDOG_MS` = 45 min (line 111). While the hook awaits nothing arrives, so a long queue would `burn()` the character as "stuck". The ask path avoids this with `clearWatchdog(l)` (1335) and re-arms on answer (~1041). The booth must mirror that.
- **Lane runtime state** lives on `Lane` objects in `LaneManager` (`phase: "working" | "waiting" | null`, `setPhase()` at 440 with eight call sites, `working`, `paused`, `abort`, `pending`). `limitSweep` (621-631) is a self-clearing interval, limit-specific; use its *pattern*, not the timer. There is no `dispose()` on `LaneManager`; towns are never closed and `will-quit` (main.ts ~1276) only kills terminals.
- The SDK exposes `PostToolUse` and `PostToolUseFailure` hooks with `tool_name`, `tool_input`, `tool_response`, `tool_use_id` (`sdk.d.ts` ~2168).
- **Display words:** `STATE_WORD` in `main.ts` 200-202 (`idle`, `cooking…`, `calling you`); renderer `stateWord()` (renderer.js ~13, used ~777) shows "working…" while `working` is true; the Orders board says "COOKING" (main.ts ~581) via the closed `OrderStatus` union (ipc.ts ~268); Telegram `/town` (main.ts 497-503) checks `isWorking` first. `CharacterView` (ipc.ts 15) has `state`, `note`, `attention`; `Attention` is strictly "why it needs you" — never use it for the queue. `buildWindow` (main.ts 205-240) makes `WindowView`; its `h-sub` line shows the role (renderer.js ~891); `winSnapSig` (renderer.js 160-175) decides when a Work Window repaints, so a new field must be part of it. `buildOrders` (~594) owns `OrderLine.since/holdUntil` (ipc.ts 283-285).
- **Add a town** flow: `AddingTown` (ipc.ts 308-313) has no step field; `addTown` runs the picker + `prepareProject()`; `addTownKind` (main.ts 837-864) writes the profile and opens the town at once. `firstRunChooseFolder` is at ~768; `firstRunOpenTown` (795-804) opens a First-Run project without the landing question. The `BIKINI_FIXTURE` type (main.ts ~634) already carries `addingTown`.
- **Check scripts**: `scripts/check-towns.mjs` shows the shape (createRequire of `dist/`, fake temp folders, `ok()` tally).
- The Maestro MCP in this workspace exposes `run`, `take_screenshot`, `inspect_screen` (need a `device_id`) and cloud tools (`run_on_cloud`, `get_cloud_run_status`, `list_cloud_devices`) that never touch a local phone. The Flutter repo will very likely carry the same plugin.

### Build

**1. Profile: the phone.** In `townProfile.ts` add
```ts
export interface DeviceSpec {
  kind: "ios-simulator" | "android-emulator";
  id: string;          // simctl UDID, or the AVD name
  name: string;        // what the street and the character call it, e.g. "iPhone 16"
  graceSec?: number;   // default 60
  maxHoldMin?: number; // default 30
}
TownProfile.device?: DeviceSpec;
```
`normalizeProfile` keeps it (validate kind/id/name; drop when malformed); `serializeProfile` writes it. S&R never gets one.

**2. Pure module `src/main/domain/booth.ts`.**
- `phoneMatch(toolName, toolInput, deviceId): "phone" | "forbidden" | null`.
  - `"forbidden"`: Bash commands that shut down, erase, or boot a *different* simulator: `xcrun simctl (shutdown|erase|delete)`, `xcrun simctl boot <not-deviceId>`, `open -a Simulator` naming another device, `emulator -avd`, `adb emu kill`. Verdict text: "The town runs the test phone. Never shut it down, wipe it, or boot another one — tell Maksym if it looks broken."
  - `"phone"`: Bash `maestro (test|record|studio)`, `flutter (run|drive|install)`, `flutter test … integration_test`, `patrol (test|develop)`, `xcrun simctl (install|launch|terminate|uninstall|io|openurl|spawn)`, `adb (install|uninstall|shell)`; MCP tools whose name contains `maestro` and ends in `__run`, `__take_screenshot`, or `__inspect_screen`. Cloud Maestro tools, `flutter build`, `flutter analyze`, `flutter test` (unit), `dart`, `pod install`, `maestro --version`, `xcrun simctl list` are NOT phone work.
  - Match anywhere in the command line (`cd ios && flutter run -d X` counts). `npm run <script>` is NOT seen through; the character note asks for real commands. Say so in the check script.
- `class Booth { claim(id): Promise<"ok" | "left">; release(id): void; touch(id): void; abandon(id): void; settle(now): CharacterId | null; view(): { holder, since, queue[] }; isEmpty(): boolean }`. FIFO. `claim` by the current holder resolves `"ok"` immediately (re-entry). `release` by a non-holder is a no-op. `abandon(id)` removes a queued character and **resolves** its promise with `"left"` (a dangling promise would hang the CLI's hook request until the matcher timeout). `settle(now)` releases the holder when (a) someone is queued and the holder's last `touch` is older than `graceSec`, or (b) the hold is older than `maxHoldMin`; returns who was released and why (so the caller can chalk the max-hold case).

**3. Wire it into `LaneManager` (all in `runSession`).** Constructor gains `device: DeviceSpec | null` (from the town profile, passed by `openTown` in `main.ts`). One `Booth` per LaneManager. `Lane.booth: "holding" | "queued" | null`.
- `PreToolUse` (the existing 1319 hook): after the `mcp__bikini__` allow and **before** the bypass allow, if `this.device` and `phoneMatch(...)` is `"forbidden"` → deny with the verdict text. If `"phone"` → `l.booth = "queued"`, `this.clearWatchdog(l)`, `onChange()`, `const r = await booth.claim(id)`; if `"left"` → deny with "your job ended while waiting for the phone"; else `l.booth = "holding"`, `booth.touch(id)`, `this.armWatchdog(id)`, `onChange()`, then fall through to the existing gate (bypass / isSafe / ask). Set the matcher `timeout: 3 * maxHoldMin * 60` (default 5400 s: a 3-deep queue is two full holds plus its own). This also lifts the 10-minute cap on the ask-Maksym wait; mention it in the commit message.
- `PostToolUse` and `PostToolUseFailure` matchers: if `phoneMatch` is `"phone"` → `booth.touch(id)` (grace clock starts). Do not release here.
- Ticker: start a 5 s `setInterval` on the first `claim`, `unref()` it, clear it when `booth.isEmpty()` (the `limitSweep` pattern). Each tick: `booth.settle(Date.now())`; on a release set that lane's `booth = null`, chalk *"Handed the phone over after 30 min"* only for the max-hold case, `onChange()`.
- `leaveBooth(l)` helper = `booth.release(id)` + `booth.abandon(id)` + `l.booth = null` + `onChange()`. Call it from: `goIdle` (1155), every other `setPhase(l, "waiting")` site (601, 773, 794, 1010, 1098, 1332 is the ask path — do NOT leave there, a character can ask while holding, 1553), `burn()` (1097), `send(fresh)` when it supersedes a running job (667-675), the superseded `catch` exit (~1607), and as the backstop in the `finally` of `runSession` (~1625). Grep every `setPhase(l, "waiting")` and account for each in the commit message.
- Home Base (`krabs`) never claims. `askPast` hook: untouched.

**4. The note.** In `runSession`, when `this.device` is set, append to the system prompt next to `serverNote`: *"This town has ONE test phone, the {name} ({kind}, id {id}). Every command that installs, runs, or drives the app on a device must target exactly this phone (`-d {id}`, `--device {id}`, `device_id: "{id}"`). Build, analyse, run unit tests, and edit freely and in parallel — nothing waits for that. Your lane is a fresh checkout: run `flutter pub get` (and `pod install` if iOS needs it) once before your first build. Phone commands may pause before they start: that means another character is on the phone and you are next; do NOT retry, do NOT boot or use any other simulator, never shut down, erase, or reinstall the simulator itself. Run real commands (`maestro test …`, `flutter run …`) rather than package scripts that hide them, so the town can see them. Group your phone work (build first, then install and run all flows back to back) so you hold the phone briefly."*

**5. Show it.**
- `ipc.ts`: `CharacterView.booth: "holding" | "queued" | null`; `WindowView.booth: { role: "holding" | "queued"; holder: string; minutes: number } | null`; `TownSnapshot.booth: { name: string; holder: CharacterId | null; since: number; queue: CharacterId[] } | null` (null when the town has no phone); `OrderStatus` gains `"ON THE PHONE"` and `"WAITING FOR PHONE"` (+ slug). Decorated main-side from `lanes.boothView()` (runtime state, not the event log; three constructors).
- Words: renderer `stateWord()` returns "in the phone booth" / "waiting for the phone" when `booth` is set (replaces "working…", no second line). Orders board (`buildOrders`) maps the same. Telegram `/town` gets a booth branch **before** the `isWorking` branch. `attention` stays null: no dot, no ping.
- Work Window: `buildWindow` fills `WindowView.booth`; the renderer shows it as the line under the name ("Waiting for the phone — Patrick is testing (4 min)" / "On the phone (4 min)"); add `booth` to `winSnapSig` so heartbeat-only snapshots repaint it.
- Street: a phone-booth prop drawn in CSS/SVG in the wooden-sign style, holder's name and minutes on the door; queued characters keep their street spot. When `TownSnapshot.booth` is null, no prop.

**6. Boot the phone.** In `openTown` (`main.ts`), after the profile loads: if `device.kind === "ios-simulator"`, run `xcrun simctl boot <id>` (ignore "already booted") and `open -a Simulator --args -CurrentDeviceUDID <id>`; log the outcome. Android: `adb devices` check only; if not running, chalk note on Home Base "The test phone is off — start the {name} emulator". Never shut anything down on town close.

**7. Ask for the phone when adding a town.** In `addTown`, after `prepareProject`, detect Flutter: `pubspec.yaml` or a `.maestro/` directory. `AddingTown` gains `landing?: Landing` (the held answer) and `devices?: { id: string; name: string; booted: boolean }[]` (from `xcrun simctl list devices available -j`, booted first). New intent `addTownPhone { deviceId: string | null }`. Flow: folder → landing question (existing two buttons) → if Flutter, the phone card (one wooden button per device, plus "No phone for this town") → profile written ONCE with both answers, then the town opens. Non-Flutter folders skip the phone card and behave exactly as today. `firstRunOpenTown` is not touched (documented in Part 1). The fixture type gets `booth` and the picker state so both screenshots can be staged.

**8. Check script** `scripts/check-booth.mjs` (plain node against `dist/`):
- `phoneMatch`: 12+ cases, both directions (Bash phone / not phone / forbidden; MCP maestro run vs cloud run; `boot <our id>` allowed vs `boot <other>` forbidden).
- `Booth`: FIFO with three claimants; re-entry by holder resolves `"ok"` immediately; grace release only when someone is queued; no release when nobody waits; max-hold release reports the reason; `abandon` resolves `"left"`; `release` by a non-holder is a no-op; `isEmpty` after everyone leaves.
- `normalizeProfile` keeps a valid `device`, drops a malformed one, and S&R's seed has none.
- Snapshot: `emptyTown().booth === null`; `fold()` return includes `booth`.
- Bypass: with the gate built as a pure function or a tiny harness, assert that under bypass a `"forbidden"` command is still denied and a `"phone"` command still queues.
Run `check-towns`, `check-fold`, `check-guards`, `check-pointer` too — all must stay green.

### Acceptance (what Maksym will look at)

1. `npm run build` clean; all five check scripts green.
2. Two screenshots via `BIKINI_CAPTURE` with a fixture: (a) the street with Patrick on the booth door and Bob "waiting for the phone", plus Bob's Work Window line; (b) the add-town phone picker card.
3. The commit message lists every release point (each `setPhase("waiting")` site, `burn`, superseding `send`, superseded catch, `finally`) and states that the hook matcher timeout now also lifts the 10-minute ask cap.
4. A short note for Maksym: the `town.json` snippet to add a phone to an existing town, e.g.
```json
"device": { "kind": "ios-simulator", "id": "<UDID from xcrun simctl list devices>", "name": "iPhone 16" }
```
5. No relaunch of the live app. Relaunch is asked separately.

### Risks the builder must not paper over
- The hook must never deadlock: a holder that dies (abort, crash, SDK error, burn, superseded) must release, and a queued character whose job ends must have its promise resolved (`"left"`), never left dangling. `leaveBooth` in the `finally` of `runSession` is the backstop.
- The stall watchdog must be cleared while queued and re-armed on claim, or a 45-minute wait is reported as "got stuck".
- Do not persist the booth; on relaunch it starts empty. A resumed session claims again on its next phone command.
- Keep bypass semantics: the booth check happens *before* the bypass allow, so bypass mode still queues and still refuses forbidden commands. Verify `deny` is honoured under `permissionMode: "bypassPermissions"` with a real probe, not by assumption.

---

## Part 3 — Lane setup ("the pantry"), added 2026-09-29

**The problem.** A lane is a plain git worktree, so it lacks everything git ignores: the env secrets, the generated Dart code, the downloaded packages, and on this Mac even the pinned Flutter SDK (3.44.9 was not installed). Every character would spend its first turns rediscovering `fvm install`, `pub get`, build_runner and the localisation step — and `fvm flutter` stops at an "install it now? (y/n)" prompt nobody can answer in a lane.

**What changed.** The town's profile (`<project>/.bikini/town.json`) carries a recipe:
```json
"setup": {
  "copy": ["env/.env*"],
  "run": ["fvm install", "fvm flutter pub get",
          "fvm dart run build_runner build --delete-conflicting-outputs",
          "fvm dart run intl_utils:generate"]
}
```
- A Flutter folder (pubspec.yaml) gets this seed when the town is added or first opened; `fvm` is used only when `.fvmrc` exists. Any other folder gets no recipe. Maksym edits the file to add or drop steps (e.g. `.claude/settings.local.json` or `.mcp.json` in `copy`).
- Before a character's first job in a fresh lane, Bikini copies the files and runs the commands in the lane through a login zsh (the real PATH, stdin closed, 15 min per step). The street shows "setting up the lane (packages)…". One town preps one lane at a time so three characters never race on the SDK download.
- A failed step never blocks the job: it is reported to the character in its system prompt ("these steps FAILED and are still needed: …") and retried on the next job. Passed steps are never re-run; copies always re-run (a secret that arrives later reaches the lane).
- The report lives at `<project>/.bikini/setup/<character>.json`, outside the lane, so nothing can be committed by mistake. Adopted lanes (Scout & Runner) are never prepped.
- Code: `src/main/domain/laneSetup.ts` (pure), `src/main/adapters/laneSetup.ts` (runner), `prepareLane()` in lane.ts, seed in main.ts. Check: `node scripts/check-lane-setup.mjs` (47 checks).

---

## Part 4 — The second phone (Android, asleep until needed), added 2026-10-02

**The problem.** SpongeBob built the Android side of a highcap ticket and wanted to run it on an emulator. The booth knew one phone (the iPhone 17), so "boot an emulator" was forbidden — rightly, a character must never boot devices — and Maksym's "I allow" in chat could not lift a hook. He wants: the iPhone stays the default, and an Android emulator is there when a job needs Android.

**What changed.** The town's profile can name a second phone:
```json
"device":  { "kind": "ios-simulator",    "id": "<udid>",  "name": "iPhone 17" },
"android": { "kind": "android-emulator", "id": "<avd>",   "name": "Pixel 3a" }
```
- ONE door, two phones: an Android test waits for the booth exactly like an iPhone test (the M1 cannot carry two test sessions anyway). The street's booth reads "iPhone 17 + Pixel 3a (asleep)".
- The Android phone SLEEPS until needed. A holder's first command aimed at it (any `adb …`, or `-d`/`--device` naming the AVD, an emulator serial, or `android`; a Maestro MCP call with an emulator serial) makes the TOWN boot the emulator and wait for Android's "boot completed" (up to 3 min) before the command runs. The character never boots anything: `emulator -avd`, `flutter emulators --launch`, `adb emu kill`, `adb reboot`, `avdmanager delete` are refused for every AVD, the town's own included. A town whose only phone is an emulator gets it booted on open, like the iPhone.
- The character's prompt explains the two phones, that the first Android command pauses while the phone wakes, and to pass the serial (`adb devices`, usually emulator-5554) once both phones are on.
- If the emulator cannot wake, the command is refused with the reason, the booth prop shows a warning line, and the character is told to carry on with what does not need Android.
- Code: `wantsAndroid()` + id sets in `src/main/domain/booth.ts` (pure), `src/main/adapters/phone.ts` (the waker: serial lookup by AVD name, single-flight boot, adb-server-safe process runs), `ensureAndroid()` in lane.ts, `bootPhone()` in main.ts. Check: `node scripts/check-booth.mjs` (105 checks). Real test 2026-10-02: with no emulator running, `wakeAndroid("Pixel_3a_…")` booted it and saw `sys.boot_completed=1` after 19 s; a second call answered "already awake".
- NOT done: the "Add a town" picker still asks for the iPhone only; the Android phone is added by editing town.json. Found on this Mac 2026-10-02: the `Pixel_8_API_34` AVD has no system image ("No initial system image for this configuration") and `Galaxy_26` needs a newer emulator (unknown skin); `Pixel_3a_API_34_extension_level_7_arm64-v8a` and `Slow_device_API_34` boot.
