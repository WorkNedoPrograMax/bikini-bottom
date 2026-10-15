# Bikini Bottom — the Ferry (one town per project, switch between them)

**Date:** 2026-09-15 · **Owner:** Maksym · **Status:** pre-scoped job, awaiting go
**Decision:** Maksym picked option 1 of the multi-project brainstorm: each project is its own town; a switcher swaps which town the street shows; the town you are not looking at keeps cooking.
**Shape:** one fresh build session, one branch, one commit, a plain-node check script, no relaunch without Maksym's OK (the Squidward shape).

---

## Part 1 — for Maksym (plain language)

### What you'll see

- **A wooden sign in the top-right corner of the street** with the current town's name, e.g. `Scout & Runner ▾`. Click it: a short list of your towns, one line each, with a status word ("Bob cooking", "1 needs you", "quiet"), and `Add a town…` at the bottom.
- **Switching** swaps the whole street in one go: characters, dots, Orders board, past orders. Any open Work Window closes first. Nothing is stopped: a character cooking in the town you left keeps cooking.
- **A small dot on the sign** when a town you are *not* looking at needs you. The dropdown line says who.
- **Finish notifications name the town** when it is not the one on screen ("SpongeBob finished · Rock Bottom"). Clicking one switches town and opens the character.
- **Adding a town** reuses the folder card from First Run. It asks one extra question, once, with two wooden buttons: **"Team repo — people review pull requests"** or **"My own — land finished work straight on main"**. That sets how finishing behaves in that town forever after (you can change it in the town's profile file).
- **Telegram:** one bot for all towns. "Finished" and "needs you" pings carry the town name. Commands like `/town` and `/new` act on the town currently on screen.

### The assumptions I made for the four open decisions

| Decision | Assumed default | Change it by |
|---|---|---|
| New project: team repo or your own? | Asked once when you add the town. | The two-button question. |
| Docker per character or light? | The Ferry does not manage Docker. S&R lanes stay as they are. A plain project gets light git worktrees inside its `.bikini` pocket, no servers. | Later profile field if the new project turns out to need running servers. |
| Both projects at once? | Yes. Both towns' characters can cook at the same time; the machine's RAM is the only limit. | Nothing to change. |
| Telegram | One bot, town name in every ping, commands follow the shown town. | Later: `/town <name>` to steer from the phone. |

### What does NOT change

- Scout & Runner works exactly as today. Its character-to-lane table just moves from the code into a small profile file, written automatically the first time the new build opens it.
- Characters, sounds, pictures, permissions, the reserve light, Point at it: untouched.
- Bikini still never merges, pushes, or opens pull requests on a team repo. In an "own" town, finishing lands the work on main the way v1 always did (Epic 5, tested).

### Size

One job, small-to-medium. Most of it is plumbing in the main process; the visible part is one sign and one dropdown.

### Left out on purpose (say if you want them)

- Removing a town from the list ("forget this town"). For now: edit the config file.
- Sideways-scrolling neighbourhoods (option 3). Same plumbing; a drawing job for later.
- Per-town Telegram bots.

---

## Part 2 — for the builder (a fresh Claude session)

### Ground rules
- Node 22: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`; `npm run build` = `tsc`. Visual check: `BIKINI_CAPTURE=/path.png electron .` (with `--user-data-dir` to a scratch folder so the running app is never touched — see the screenshot recipe in memory).
- **NEVER relaunch the running app without Maksym's explicit OK.** Build + check script only; relaunch is a separate, asked step.
- Invariants: renderer holds no state and only sends named intents (`src/shared/ipc.ts` is the only shared vocabulary, AD-4); snapshot is a pure fold over the event log plus main-side decoration (`snapshot()` in `main.ts`); pure helpers go in a plain module so a `scripts/check-*.mjs` can test them without Electron; **no emoji in app chrome** (AD-7) — the sign is a wooden word-button, emoji stay on Telegram.
- When `TownSnapshot` gains a field, three constructors need it: `emptyTown()` and the `fold()` return literal in `src/main/domain/snapshot.ts`, and `snapshot()` in `main.ts`.
- Branch `feat/ferry` off the current `feat/orca-upgrades` HEAD (that branch is live and not yet merged to main). One commit. Untracked files in the tree (`presentation/`, `s1.png`, `.claude/settings.local.json`, planning artifacts) are not part of this job — leave them out of the commit.

### Fact base (verified in code 2026-09-15)

- `AppConfigData.projectPath: string | null` in `src/main/config/appConfig.ts` is the single remembered project. Config lives in `<userData>/bikini-config.json`.
- `openProjectLog(projectPath)` in `main.ts` (~line 68) builds, once per launch: `projectLog = new EventLog(<project>/.bikini)`, `adoptSupport`, `lanes = new LaneManager(...)`, `terminals = new TerminalManager(...)`, then the pause/resume sweep. It is called from startup (~line 992) and from `firstRunOpenTown`.
- Module globals used everywhere in `main.ts`: `lanes` (66 uses), `projectLog` (19), `terminals` (15), `adoptSupport` (3). Rewriting every use is the wrong move; keep them as "the current town's objects" and swap them on switch.
- `LaneManager` (`src/main/adapters/lane.ts` ~line 318) takes `projectPath, log, onChange, onFinished, onCue, getBypass, adopt, fuelOpts`. Sessions run with cwd = lane worktree and live in the instance. Persists `<project>/.bikini/sessions.json`. The SDK session itself does not care which town is on screen.
- `srProjectFor()` in `src/main/config/adoptions.ts` hardcodes S&R by folder basename with bob/squid/pat → `sr-bob`/`feat/bob`/3100/3101 etc. Lane dirs are siblings of the project (`path.dirname(projectPath)/<laneDir>`).
- Non-adopted lanes: `worktreeFor()` → `ensureWorktree(project, id)` = `<project>/.bikini/worktrees/<id>` on branch `lane/<id>`; on finish `integrate()` (~line 798, called ~line 1161) → `serveJob()` lands onto the project's main line. This is the old Epic 5 auto-land; it must become a per-town choice.
- Callbacks that need to know their town: `onLaneChange` (just re-pushes the snapshot — safe for any town), `fireFinishNotification(id, summary)` (~line 119, also pings Telegram), `emitSoundCue`, `onFuelWarning`. Point at it reads `adoptSupport?.adoptionFor(id)?.frontendPort` (~line 194).
- Fuel (reserve light) is account-wide but stored per LaneManager, loaded from `<userData>/fuel.json`. Two LaneManagers sharing the file is fine (same account, same numbers); only the once-per-window Telegram warning could fire twice.
- `TERMINAL_IDS` is an empty set today (no pty characters), so `TerminalManager` is per town but idle.
- First Run: `FirstRunView { step, projectPath, prep, claude, notify }`, steps `welcome | folder | claude | notifications | ready`; `firstRunChooseFolder` (~line 645) runs the native picker + `prepareProject()` (safe, idempotent, git-ignores `.bikini`). `BIKINI_FIXTURE` overlays snapshot parts for screenshots.

### Build

**1. Town profile file — `src/main/config/townProfile.ts` (pure, no Electron).**
```ts
export interface LaneSpec { dir: string; branch: string; label: string; frontendPort?: number; backendPort?: number } // dir relative to the project, e.g. "../sr-bob"
export interface TownProfile {
  name: string;                     // shown on the sign
  landing: "none" | "auto";         // none = Bikini never touches git on finish; auto = Epic 5 serveJob
  lanes?: Partial<Record<CharacterId, LaneSpec>>; // adopted existing lanes (S&R); absent = .bikini/worktrees
  servers?: string;                 // optional extra sentence for the system prompt (S&R's "already running in Docker" note is derived from ports; this is for future projects)
}
export function loadProfile(projectPath, readFile): TownProfile | null   // <project>/.bikini/town.json
export function seedProfile(projectPath): TownProfile                    // no file yet: if basename === "scout-and-runner" → today's srProjectFor table as a profile, landing "none"; else { name: basename, landing: "none" }
export function defaultName(projectPath): string                          // basename, "scout-and-runner" → "Scout & Runner"
```
- `openTown` (below) loads the profile or seeds + writes it on first open, so S&R gets its `town.json` automatically. `.bikini` is git-ignored, so ports stay local.
- `adoptions.ts` shrinks to the seed table used by `seedProfile` (or is folded into `townProfile.ts`); `srProjectFor` is no longer called from `main.ts`.
- `AdoptionSupport` for a town is built from `profile.lanes` (resolve `dir` against the project path).

**2. Landing becomes a choice — `lane.ts`.**
- Add `landing: "none" | "auto"` to the LaneManager constructor (or a `getLanding()` callback). In `integrate()`: if `landing === "none"` or the lane is adopted → no-op (today's adopted branch). `serveJob` runs only for `auto`. Default the parameter to `"none"` so the tests/smoke path stays safe.

**3. Config: a list of towns — `appConfig.ts`.**
- Add `towns: { path: string }[]` (default `[]`). Keep `projectPath` as **the current town**. On `load()`: if `towns` is empty and `projectPath` is set → `towns = [{ path: projectPath }]` (silent migration, saved on next `save`).

**4. Town registry — `main.ts`.**
```ts
interface Town { path: string; profile: TownProfile; log: EventLog; lanes: LaneManager; terminals: TerminalManager; adopt: AdoptionSupport | null }
const towns = new Map<string, Town>();
async function openTown(path): Promise<Town>   // today's openProjectLog body, but returns a Town and binds callbacks with the town path: onFinished → fireFinishNotification(path, id, summary), onCue → emitSoundCue(path, id, kind), onFuelWarning → main-level dedupe by resetsAt
function showTown(path): void                  // sets lanes/projectLog/terminals/adoptSupport = towns.get(path)'s objects; closes openWindowId, pointer, past views; cfg.save({ projectPath: path }); pushSnapshot()
```
- Startup: open every town in `cfg.data.towns` (each keeps its own pause/resume sweep), then `showTown(cfg.data.projectPath)`. Opening a town whose folder no longer exists must not crash: log it, skip it, keep it in the dropdown greyed with "folder missing".
- `fireFinishNotification(townPath, ...)`: the Telegram ping and the macOS title get ` · <town name>` when `townPath !== current`; the click handler runs `showTown(townPath)` before `openCharacter`.
- `emitSoundCue` from a background town still plays (a "ready" from another town is useful); mute applies as today.
- `markSeenIfWatching` and everything else that reads `lanes` keep working because they mean "the shown town".

**5. Snapshot + intents — `ipc.ts`, `snapshot.ts`, `main.ts`, renderer.**
- `TownTab { path: string; name: string; current: boolean; cooking: number; needsYou: number; missing?: boolean }`; `TownSnapshot.towns: TownTab[]` and `TownSnapshot.townName: string`. Derive in `snapshot()` from the registry: `cooking` = characters in `working`, `needsYou` = characters in `calling` with the unseen dot (use each town's own fold: `fold(town.log.all())`). Pure helper `townTabsFor(...)` in `townProfile.ts` or `guards.ts` so the check script can hit it.
- Intents: `switchTown { path }`, `addTown`, `addTownKind { landing: "none" | "auto" }`, `cancelAddTown`.
- `addTown`: runs the same native picker + `prepareProject` as `firstRunChooseFolder`, but into a new `addingTown: { path, prep }` field on the snapshot (do **not** reuse `firstRun` — First Run is over and its `step` semantics would leak). On prep ok → the two-button question (`addTownKind`). On answer → write `town.json` with `{ name: defaultName, landing }`, push to `cfg.towns`, `openTown`, `showTown`. Picking a folder that is already a town → just `showTown` it.
- Renderer (`renderer.js` / `index.html` / `styles.css`): the sign is a `.topbtn`-style wooden word-button top-right (`#townBtn`, text = `townName ▾`, a dot when any non-current town has `needsYou > 0`); dropdown is a small paper list, closed by Esc / scrim / picking; the "Add a town" card is a Mr. Krabs-style card over the dimmed street, like First Run's folder step, with the two wooden buttons after prep ok and a "Never mind" link. Dropdown open/closed is renderer-local like `boardOpen`. Hide the sign while First Run is active or when there is only one town **and** you decide it reads better hidden — Maksym's call; default: always show it so "Add a town" is discoverable.
- Fixture hook: `BIKINI_FIXTURE` may overlay `towns` and `addingTown` so the dropdown and the card can be photographed with no second project on disk.

**6. Telegram — `main.ts` handlers.**
- Pings from `fireFinishNotification` and the "needs you" paths carry the town name when the town is not on screen (helper `tgTown(townPath)` → `""` or ` · <name>`). Commands act on the shown town; `/town` ends with one line per other town: `<name>: 1 cooking, 0 need you`.

**7. Check script — `scripts/check-towns.mjs` (plain node against `dist/`).**
- `seedProfile("/x/scout-and-runner")` → three lanes with today's dirs/branches/ports, landing none; `seedProfile("/x/whatever")` → `{ name: "whatever", landing: "none" }`, no lanes.
- `loadProfile` returns null on no file / bad JSON (never throws); a profile with unknown fields loads.
- Config migration: `{ projectPath: "/a" , towns: [] }` → `towns = [{path:"/a"}]`; `{ projectPath: "/a", towns: [{path:"/a"},{path:"/b"}] }` unchanged.
- `townTabsFor`: two towns, one current with 1 working, other with 1 calling-unseen → `cooking 1 / needsYou 0` and `cooking 0 / needsYou 1`; missing folder flagged.
- `defaultName`: "scout-and-runner" → "Scout & Runner"; "my-app" → "my-app".
- `integrate` gating: a LaneManager built with `landing: "none"` and a non-adopted lane never calls `serveJob` (stub `serveJob` via a spy or test the pure predicate `shouldLand(landing, adopted)`).
- Visual: two captures with a fixture — dropdown open with two towns and a dot; the "Add a town" card at the two-button step. Save under `{output_folder}/planning-artifacts/ferry-shots/`.

### Acceptance (what Maksym will check after the asked relaunch)
1. App opens on Scout & Runner exactly as before; `scout-and-runner/.bikini/town.json` now exists with the three lanes.
2. Sign top-right reads `Scout & Runner ▾`; dropdown shows it as current and `Add a town…`.
3. Add a scratch folder as a town, pick "My own": street swaps to an empty, quiet town named after the folder; switching back shows S&R unchanged, dots intact.
4. Hand SpongeBob a small job in the scratch town, switch to S&R while he cooks: the sign gets a dot when he finishes; the notification names the town; clicking it lands on him.
5. Telegram "finished" ping for that job carries the town name.
