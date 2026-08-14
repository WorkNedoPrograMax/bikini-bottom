# Architecture Spine Review — Rubric (good-spine checklist)

**Target:** `ARCHITECTURE-SPINE.md` (Bikini Bottom, initiative altitude, 2026-07-12)
**Reviewer scope:** good-spine checklist, calibrated to hobby-stakes single-user macOS app.

## Overall verdict

**ADEQUATE — publishable after targeted fixes; not broken.** This is a strong, well-structured spine. The paradigm (main-authoritative event-sourced state, renderer as pure view) is exactly right for the reliability promise, and it resolves multi-Lane write concurrency for free. The two nastiest named risks are caught cleanly: the SDK per-`cwd` session gotcha is nailed by AD-3 (path-stable worktree = SDK cwd for the Lane's whole life), and crash/quit survival is made structural by AD-2 (event log + fold). All FR-1..FR-19 map to an AD/component.

Three gaps keep it from "strong," all in the git/persistence machinery that FR-16 and PRD §9 lean on: (a) no invariant that a Job's work is a **discrete, attributable commit set** — yet AD-5's "revert that Job's commit(s)" and clean Serving both depend on it; (b) the **pause/resume of an in-flight Lane** across quit is asserted but its mechanism is neither decided nor deferred; (c) a few **operational-envelope corners** are silent (first-run folder-prep failure, worktree setup on a non-git / already-git folder, code-signing prerequisite).

---

### (1) Fixes the real divergence points for epics/stories; misses none — **ADEQUATE**

Eight ADs cover the genuinely load-bearing seams (truth ownership, event log, Lane=session=worktree, IPC vocabulary, git-as-invisible, permission boundary, asset resolver, auth). But two real divergence points are unaddressed:

- **[high]** No invariant fixes **how a Job's changes become commits**. AD-5 says Serving = "integrate its worktree commits" and Send-it-back = "revert that Job's commit(s)" — both presume each Job produces an *identifiable, attributable* commit set. Nothing states who commits (the Claude session may or may not), or that each Job squashes to one revertible unit. The Serving story and the Send-it-back story will each invent this differently, and they must agree. (AD-3/AD-5.) *Fix:* add a rule — e.g. "on Job finish, main squashes the Lane's worktree changes into exactly one commit tagged with `jobId`; Serving cherry-picks/merges that commit; Send-it-back reverts it." This is what makes AD-5 enforceable.
- **[med-high]** **Pause-on-quit / resume-on-relaunch mechanism** (PRD §9, EXPERIENCE "App quit / relaunch") is asserted but undecided. AD-2 persists the *snapshot*; it does not say what happens to a mid-turn SDK session on quit or how "Keep cooking" resumes it (re-issue the prompt? `resume: session_id`? just re-mark WAITING?). Stories will diverge. *Fix:* one line in AD-2 or a new AD: "COOKING → quit writes a `JobPaused` event and terminates the SDK query; relaunch shows WAITING; 'Keep cooking' resumes via `resume: session_id` on the stable cwd (AD-3)."

### (2) Every AD's Rule is enforceable and prevents its stated divergence — **ADEQUATE**

Most rules are crisp and enforceable (AD-1, AD-2, AD-3, AD-4, AD-6, AD-7, AD-8 all have a concrete seam). The exception:

- **[high]** **AD-5's rule is not enforceable as written** — "revert that Job's commit(s)" cannot be executed unless a Job's commits are attributable (see item 1). Without the commit-attribution invariant, the rule describes an outcome, not a mechanism the git adapter can implement. *Fix:* same as above — pin the commit model, then AD-5 becomes executable.
- **[low]** **Send-it-back entanglement** (PRD Open Q4: undoing an older order when newer served work overlaps) is a *different* case from collision-at-landing, yet AD-5 only names the landing collision. It is neither decided nor listed under Deferred. *Fix:* add to Deferred with the seam fixed — "entanglement surfaces through the same either/or seam as a collision; exact revert strategy settled in the Send-it-back story (Open Q4)."

### (3) Nothing under Deferred could let two units diverge — **STRONG**

Deferred items are content (art/audio), a fixed-seam allow-list table, collision batching (seam = one either/or, fixed by AD-5), auth ergonomics (mechanism fixed by AD-8), and out-of-scope v2 cuts. Each has its seam nailed before deferral, so no two stories can diverge on them. Well done.

### (4) Named tech verified-current — **STRONG**

Electron 43.1.0, `@anthropic-ai/claude-agent-sdk` 0.3.207, Node 24.18 (Electron-bundled), TS 5.x. Version research assumed done per instructions; versions are pinned in the Stack table. No unpinned "latest" hand-waving.

### (5) Greenfield — no brownfield ratification needed — **STRONG**

Correctly greenfield; no existing system to ratify. N/A handled by omission, appropriately.

### (6) Covers PRD capabilities FR-1..FR-19 — **STRONG**

Walked all nineteen: every FR maps to an AD and a home in the Capability→Architecture map. FR-13 (follow-ups) correctly routes to AD-3's resume + stable cwd — the exact gotcha mitigation. FR-19's git-init on a plain folder is noted in the map.

- **[low]** Mapping nit: FR-17 ("one shared Project, isolated Lanes") is listed under AD-5 (git/Serving) but its isolation guarantee is really AD-3 (worktree-per-Lane). Cosmetic, but a story author tracing FR-17 lands on the wrong AD. *Fix:* map FR-17 to AD-3 (isolation) + AD-5 (landing).

### (7) Every dimension the initiative altitude owns is decided/deferred/open — esp. operational/environmental envelope — **THIN**

Decided well: API-key storage (AD-8, `safeStorage`), event-log + worktree location (`<project>/.bikini/`), packaging (electron-builder), no-DB persistence. But several envelope corners are silent — no AD, not in Deferred, not in Open:

- **[med]** **First-run folder-prep failure is a silent dimension.** EXPERIENCE step 3 explicitly punts it to architecture ("failure specifics are architecture's"), and the spine neither decides nor defers it. It's a real first-run failure path. *Fix:* add an Open item or one rule — what "the folder can't be prepared" means (git init fails, no write permission, read-only volume) and that it emits a plain domain event Krabs renders, never a raw error (consistent with the AD-4 "raw errors never cross IPC" convention).
- **[med]** **Worktree setup on an arbitrary folder is under-specified.** PRD allows a *plain* (non-git) folder; worktrees require a git repo, so First Run must `git init`. The spine mentions "git init" only in the cap-map cell. The already-a-git-repo case (user's own history / uncommitted changes) and the addendum's own flagged gotcha — *worktrees don't copy untracked files like `.env.local`* — are unaddressed. For a plain-folder project the untracked gotcha is mild; if Maksym ever points at a real code project it bites. *Fix:* fold into AD-3 — "First Run `git init`s a plain folder; an existing repo is used as-is; the initial commit captures current contents so worktrees inherit them."
- **[low-med]** **Code-signing prerequisite is thin.** Stack says "code-signed (required for macOS notifications)" — correct that signing matters for FR-7, but it silently assumes an Apple Developer ID cert/account exists. That's a real gate for a hobby project, and the whole notification channel (FR-7, SM-2) rests on it. *Fix:* note the Developer ID dependency as an Open item so it can't surprise the notification story.
- **[low]** **`<project>/.bikini/` may pollute the user's git status.** Placing the event log inside the user's Project folder means an existing repo will show `.bikini/` as untracked (and a Lane could theoretically stage it). *Fix:* one convention line — First Run appends `.bikini/` to the Project's `.gitignore`.

---

## Load-bearing risk scorecard (from review brief)

| Risk | Handled? | Where |
|---|---|---|
| State persistence across crash/quit (PRD §9) | Mostly — snapshot survival structural; in-flight pause/resume mechanism undecided | AD-2 strong; see finding (1b) |
| SDK per-`cwd` session gotcha | **Yes, cleanly** | AD-3 (stable cwd = worktree, whole Lane life) |
| Worktree isolation on a possibly-non-git folder | Partial — git-init mentioned, non-git/untracked cases thin | Cap map + finding (7) |
| Notification code-signing | Named, but cert dependency not flagged | Stack + finding (7) |
| Git commit attribution behind Serving/Send-it-back | **No — missing invariant** | Finding (1a)/(2) |
