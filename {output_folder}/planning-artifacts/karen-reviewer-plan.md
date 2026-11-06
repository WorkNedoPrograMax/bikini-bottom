# Karen, the reviewer (plan, 2026-11-06)

**Status 2026-11-06:** Job 1 + the face-row routing of Job 2 BUILT and COMMITTED (054d770 on
feat/phone-booth), checks green, NOT live (relaunch needs Maksym's OK). Left of Job 2: the Telegram
"Karen reviews it" button and the reviewer tooling in her brief. Picture/sounds: Maksym, later.

Maksym's ask (2026-11-06): "a separate lane just for reviewing PRs — specialising in that, no other
lane does PR review, only that one. Not fixing PRs, simply reviewing others' PRs." Then: "maybe we
don't even need a lane for that — simply using the main repo is ok?" and "a character, maybe Karen
as Plankton's wife. I don't want her to be able to take normal stuff; always visible only when she's
reviewing something; she never writes code; she simply reviews PRs — that's the only job."

So: **Karen** — a fifth character, Plankton's computer wife. One job: review other people's pull
requests in Maksym's name. She works in the project's main folder (not a worktree), is on the street
only while reviewing, is offered for nothing else, and physically cannot change code.

## Measured today (2026-11-06, bikini-bottom at 1a98d79, highcap-mobile main checkout)

- A review order today goes to any idle builder you pick: `handOffPull` refuses Krabs, terminals and
  busy characters, nothing else (`src/main/main.ts:650`). The review brief tells the character to
  "read the whole diff against <base> and run what CI runs" and to end with ONE ask_maksym "What do I
  post?" (`src/main/domain/mail.ts:316`) — so a builder mid-ticket switches branches inside its lane
  for the review.
- The main highcap-mobile checkout: on `dev`, 1 untracked entry, 4 worktrees (main + 3 lanes); no
  character has a process there — Mr. Krabs is only the picker window (`isHomeBase`, never a lane).
- A character can already adopt an existing folder instead of a fresh worktree: `lanes.<id> = { dir,
  branch, label }` in `.bikini/town.json`, resolved relative to the project (`townProfile.ts:222`);
  an adopted lane is never created/reset and its setup recipe is skipped (`lane.ts:1544`, `:1555`).
  `dir: "."` is a legal value (path.resolve). Nothing in the town reads the main folder's branch: the
  Mailbox and Jira page read GitHub and Jira; the only git calls on the project folder are
  `ensureWorktree` and the landing path, which highcap never uses (landing "none").
- **One real consequence of main's branch moving:** a fresh lane is cut from the project's current
  `HEAD` — `git worktree add -B lane/<id> <wt> HEAD` (`src/main/adapters/git.ts:33`). A new lane
  created while Karen sits on a teammate's branch would start from that branch. highcap's four lanes
  already exist, so this fires only for a new character or a deleted lane — but it is a wrong base,
  so it is closed in Job 1 (see "back on dev").
- The guard machinery exists: the PreToolUse hook already has a look-only mode (READ_TOOLS only,
  `lane.ts:1391`) and the stay-in-lane refusal (pure `domain/stayInLane.ts`, replayed by
  `scripts/check-stay-in-lane.mjs`). Karen's guard is the same shape with a Bash allowlist.
- The roster is data-driven — "adding Sandy later is one row + her files" (`config/roster.ts`);
  `CharacterId` is a closed union in `shared/ipc.ts`, also listed in `townProfile.ts:125` and the
  sound aliases in `adapters/assets.ts`. Pictures are `<id>-<state>.png` under `assets/`, sounds by
  name under `sounds/`; the app never generates art (FR-18) — a missing file is a labelled stand-in.
- Where the crews are built (every place that offers a character for work): the Jira face row
  (`main.ts:411`), the Mailbox face row (`:583`), the Telegram "X handles it" (`:510`) and "X fixes
  it" (`:605`) buttons, Krabs's home-base picker (`:733`), and the two hand-off functions. Each
  filters `!isHomeBase && !TERMINAL_IDS && idle` — none knows a "reviewer" yet.
- The street draws every roster entry at `pos` with class `actor <state>` (`renderer.js:845`); there
  is no "hidden" state. The renderer holds no business state — a `visible` flag computed in main is
  the way to hide her (testable in a check script; a renderer-only rule is screen-only).
- Precedents matched (`hc-precedents.py --paths`, 3 of 71): §3 "a stateful feature's evidence walks
  the machine" and §15 "a status held as several copies" — both bind the *busy / queued / idle /
  relaunch* crossings of Karen's state; §15 "ownership inferred by recency" — Karen's folder is
  shared with nothing else that writes (Maksym: "I don't use the folder"), stated, not assumed.

## The shape

**Who.** `karen` — "Karen", role "the reviewer", Chum-Bucket green accent, standing by the Mailbox
(she reads the mail). Not home base, not a terminal. A roster flag `reviewer: true` carries every
rule below; nothing else in the code says "karen".

**Where she works.** The project folder itself, as an adopted lane: `lanes.karen = { dir: ".",
branch: "dev", label: "dev" }` in highcap-mobile's `town.json` (and the backend town's, when it gets
a Mailbox). No setup recipe, no fifth worktree: packages and generated code are already there.

**Her only orders.** A Mailbox line whose word is `your-turn` or `look-again` (someone else's PR,
waiting for Maksym's review) may be handed to Karen and to nobody else. Every other hand-off (a PR of
yours sent back, a Jira ticket, a sweep, a chalk-line job, Krabs's picker, the Telegram face buttons)
never offers her. Her window takes a message like any character's, so Maksym can still talk to her.

**What she can do.** A new hook mode `reviewOnly` on her sessions:
- allowed: the read tools; Bash where **every** segment of the command is one of — `git fetch | pull
  | switch | checkout | status | log | diff | show | branch | rev-parse`, `gh pr view | diff | checkout
  | checks`, `gh pr review`, `gh pr comment`, `gh pr edit … --add-reviewer`, `gh api` with no
  `-X`/`--method` other than GET, the town's test/analyze runners (`fvm flutter analyze | test`, `fvm
  dart run build_runner …`, `fvm dart run intl_utils …`, `python3 ~/.claude/scripts/hc-precedents.py`),
  and plain readers (`ls cat head tail sed -n grep rg find wc diff`);
- refused, with the reason "Karen only reviews — she never changes code. Say what is wrong in the
  review; the author fixes it.": Edit / Write / MultiEdit / NotebookEdit, any `git` that writes
  (`add commit push stash reset rebase merge cherry-pick tag`), `gh pr create | merge | close | ready
  | edit` (except `--add-reviewer`), `rm mv cp` into the tree, shell redirects into the tree, and
  everything not on the allowlist.
Pure module `domain/reviewOnly.ts`, replayed by `scripts/check-review-only.mjs` (added to
`postbuild` beside check-lane-states), one case per row above. A subagent she spawns goes through
the same hook — `unverified — probe: Karen spawns a helper that tries Write; expected: refused`.

**Back on dev.** Three layers, each named for what it closes:
1. `ensureWorktree` cuts a new lane from the remote default branch (`origin/dev` → fallback
   `origin/HEAD`), not from the folder's `HEAD`. *Closes by construction* the only consequence of
   main's branch moving.
2. Her brief ends every review with `git switch dev`. *Compensation*: fails when she is killed.
3. When Karen leaves `working` (done, burned, cancelled, relaunch-restore), the town runs `git switch
   dev` in her folder itself, once, logged. *Compensation for 2*: fails when git refuses (dirty
   generated files → `git switch -f`? no — a dirty tree is reported on the street, never forced).

| edge | what happens |
|---|---|
| review fails / she burns | layer 3 switches back; the PR line shows "Karen burned it" like any character |
| late (review takes an hour) | nothing else uses the folder — stated by Maksym 2026-11-06, not measured |
| handed twice (same PR) | second hand-off refused: "Karen is already on #N" (today's `onIt` mark) |
| killed mid-way (app quit) | main stays on the PR branch until the next launch restores her lane → layer 3 on restore; a lane cut meanwhile is still right (layer 1) |
| two reviews at once | v1: refused with a toast "Karen is reviewing #N — hand it to her when she's done"; the queue is Job 3 |
| offline | `gh` fails, she reports it; nothing written |

**Visible only while reviewing.** Main computes `visible` per character: always true, except a
`reviewer` who is `idle` with nothing unseen. So she appears when a review starts (her start sound),
stays while she asks "What do I post?", and stays after posting until Maksym has opened her result
(else "posted ✓ — Approve" vanishes unseen). Pure in `domain/fold.ts` or a sibling, covered by
`check-fold.mjs`. The town-switcher counts skip an invisible reviewer.

**Her brief** = today's review brief (one ask, four verdicts, post as Maksym, collisions are never
"request changes") + her voice + the reviewer's tools: run the precedent selector on the PR's diff
and read the matched entries; on highcap, walk the lead-lens checklist; run what CI runs on the
checked-out branch; end on `dev`. "Never a draft, the review on GitHub is the deliverable" stays.

**Art.** `assets/karen-working.png`, `karen-calling.png`, `karen.png`; `sounds/karen-start*.mp3`,
`karen-ready*.mp3` — Maksym's files, as for every character; stand-in until then.

## Jobs (one per run)

**Job 1 — Karen exists, guarded, on the main folder.** Id + roster row + flag; `reviewOnly` hook
mode + `domain/reviewOnly.ts` + `check-review-only.mjs` in postbuild; adoption entry in highcap's
`town.json`; the three "back on dev" layers; `visible` in the snapshot + the street hiding her;
sound/picture aliases. She is reachable from her own window only (no routing yet).
Proof: (a) check scripts green; (b) live, with Maksym's OK to relaunch: tell Karen "add a comment to
README" → refused with the reason; "post a comment on PR #<test> saying hi" → posted; her folder is
on `dev` after. Size: standard (90 min); half a day if `CharacterId` ripples further than the five
files measured.

**Job 2 — The Mailbox routes reviews to Karen.** Review lines offer only Karen (street face row and
Telegram "Karen reviews it"); every other crew excludes her; busy → toast. Proof: `check-mail.mjs`
cases (review line → [karen]; sent-back line → crew without karen; Jira crew without karen), then one
real teammate PR reviewed from the town end-to-end (hand-off → ask → posted on GitHub → back on dev).
Size: standard.

**Job 3 (after a week of real reviews) — queue and auto-dispatch.** Review orders queue behind
her, FIFO; a `your-turn` line starts by itself when she is idle, with a one-line undo. §3/§15 table:
transitions (handed while busy, finishes, relaunch with a queue, cancel) × copies (`onIt`, queue
file, lane state) walked, and a test that relaunches with one queued.

## Not in this plan

- Reviewing Maksym's own PRs (built by Bob/Squid/Pat): the Mailbox calls those "theirs" / "with
  reviewer"; Karen never sees them. A second-voice look at our own PR before asking the lead is a
  different order (`/hc-review` in the builder's lane) and stays there.
- Karen fixing anything, ever — by construction, not by prompt.
- A fifth worktree for Karen instead of the main folder: one line in `town.json` turns it on later
  (`dir: ".bikini/worktrees/karen"`); then setup runs once and layers 1–3 become moot.

## Open for Maksym (asked in chat, 2026-11-06)

1. Art and sound for Karen — his files, or a stand-in until he has them (default: stand-in).
2. Job 1 ends with a relaunch of the live town (hard rule: with his OK), to prove the guard for real.
