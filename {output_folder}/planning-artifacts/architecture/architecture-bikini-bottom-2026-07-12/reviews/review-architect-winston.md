# Architecture Spine Review — Winston (System Architect)

**Artifact:** `ARCHITECTURE-SPINE.md` (Bikini Bottom, draft, 2026-07-12)
**Lens:** buildability + completeness. Can a story dev pick up any one AD and build against it without inventing a load-bearing decision? Where does the spine sell certainty it hasn't earned?

---

## Verdict

**Conditionally sound — the skeleton is right, but the parts that touch Maksym's real work are underspecified in exactly the places the PRD's central trust promise lives.**

Let me say the good part plainly first, because it's the reason the rest is worth fixing rather than rebuilding. The paradigm choice — main-process-authoritative, event-sourced, renderer as a pure view over pushed snapshots — is *boring in the best way*. For five lanes and one user, a plain append-only JSON log folded into a snapshot is the correct amount of machinery; a database would be gold-plating. AD-1 and AD-4 draw a clean, testable boundary (intents up, snapshots+events down) that will keep the renderer and the domain from growing two brains. Deferring the exact allow-list while fixing the *seam* (AD-6) is the right move — the seam is the decision, the table is content. Naming verbatim to the PRD glossary is a quiet gift to every downstream story. `OrderSeen` being a first-class event is exactly how "resolve-to-clear" becomes structural instead of a UI flag. This is a spine I'd be happy to build on.

But the spine says its durability is **"structural rather than best-effort."** That claim is true for the *app's* state — dots, board, States survive a crash because they're a folded log. It is **not** true for the side of the system that mutates Maksym's actual Project via git, and that's precisely the surface the PRD's #1 trust promise guards: *"never lose work to an invisible technical accident"* (JTBD §2.1). The spine's confidence and its coverage are inverted — most certain where the stakes are lowest, most silent where they're highest.

Counts: **1 critical, 5 high, 7 medium, 4 low.**

---

## Critical

### C1 — The Project-mutation safety envelope is unspecified, against the one promise that matters most
**Severity: critical.** Refs: AD-5, AD-2, Structural Seed, Consistency Conventions, PRD §9 + JTBD Trust.

Three gaps compound here, and together they let the app silently damage Maksym's real repository — the exact "invisible technical accident" the product exists to prevent.

1. **`.bikini/` is never declared git-ignored, and commits are never declared path-scoped.** The Structural Seed puts `<project>/.bikini/` — the event log *and* every Lane's worktree — **inside the user's Project working tree**. Git will see `.bikini/` as untracked in the main line. AD-5 says serving = "integrate its worktree commits into the Project's main line." The moment anything (the app's serve step, or a Lane's own `git add -A`) stages broadly, the event log, worktree metadata, and sibling worktrees can be committed into Maksym's history. Worse: AD-5's "Send it back = revert that Job's commit(s)" would then revert *app-internal files*. The fix is one line (`.bikini/` in `.git/info/exclude` + path-scoped commits) — but it is load-bearing and currently absent. A story dev implementing Serving has no instruction that would stop this.

2. **No git-transaction atomicity or crash recovery for serve / send-back / collision.** Event sourcing gives you *app-state* durability; it gives you nothing for a half-finished `git merge` on the real repo. Crash mid-integration leaves the Project in `MERGING`/dirty-index state with `MERGE_HEAD` present. AD-2's "event written before its effect is acknowledged" is ambiguous about whether "effect" is the git mutation or the renderer ack — and either reading has a failure mode: log `JobServed` before the merge lands and replay believes work is served that isn't; log it after and a crash mid-merge leaves a half-merged repo with no event and no recovery path. Nowhere does the spine define how the working repo is reconciled on relaunch. "Structural rather than best-effort" is simply not true here.

3. **Worktrees living inside the tracked working tree** is itself an unusual arrangement that keeps the main repo permanently "dirty" and interacts badly with (1). Convention among comparable tools (Conductor, Crystal — see PRD addendum) is worktrees *outside* the primary checkout.

Trade-off, honestly stated: none of this is hard to fix, and none of it invalidates the event-sourced choice. But the spine presents the durability story as finished, and for the Project-mutation half it hasn't started. This must be an explicit AD before the Serving story is written.

---

## High

### H1 — AD-4's "snapshots + events only" cannot carry live token streaming; the transport for the folded line is undefined
**Severity: high.** Refs: AD-4, AD-2, FR-11, EXPERIENCE "Folded technical detail".

EXPERIENCE is precise: one chat bubble per turn, tool activity folded behind **one plain-language line that updates live** during tool-only stretches. The SDK delivers this as a token-level stream (`includePartialMessages`, per addendum). AD-4 says the only thing main sends down is "state snapshots and append-only domain events," and AD-2 says *every* transition is an immutable event written to a persisted log before acknowledgement. Put those together and you get an impossible choice: either you write an event per token (a durable log that grows by thousands of entries per turn — absurd, and the fsync-before-ack discipline of AD-2 makes it worse), or streaming text is *not* an event — in which case it violates AD-4's "exactly one channel each way / only snapshots+events." The spine needs a third, explicitly **transient, non-persisted** category (stream deltas) that rides the boundary without entering the log. That's a fine decision — but it's a decision, and right now a story dev has to invent it, and the tidy up/down duality the spine is proud of quietly breaks.

### H2 — Conversation content has a second source of truth (the SDK's per-cwd `.jsonl`), contradicting AD-1/AD-2
**Severity: high.** Refs: AD-1, AD-2, AD-3, FR-11, FR-13, PRD §9.

The reliability NFR says conversations survive quit/crash. But if streaming text is *not* in the event log (per H1, correctly), then the chat transcript is reconstructed from the SDK's own session store (`~/.claude/projects/<cwd>/*.jsonl`, via `resume`/`getSessionMessages` — addendum). That store is authoritative conversation state living **outside** main's event log. So AD-1's "single source of truth" and AD-2's "snapshot is a pure fold over events" are already false for the one kind of content that fills the Work Window. This isn't necessarily wrong — leaning on the SDK's transcript is pragmatic — but the spine pretends this seam doesn't exist. Someone has to own the answer to "on relaunch, where does a Character's chat history come from?" and reconcile it with AD-1/AD-2 in writing.

### H3 — Nothing states that log replay on boot is side-effect-free; naive replay re-fires voices and notifications
**Severity: high.** Refs: AD-2, FR-4, FR-6, FR-7, EXPERIENCE sound/notification matrix.

AD-2: "Restart replays the log; a Character that was Calling is still Calling." Good — that's how FR-4's "dot survives restart" becomes structural. But the classic event-sourcing trap is unaddressed: side effects must not fire during rehydration. Voice Lines and macOS notifications fire on the *live* "started Calling" event. If replay reuses the same event handler, every historical Calling event re-fires its Voice Line and notification on launch — a cacophony, and a direct hit to the "never nagging" intent (FR-6) and to SM-2. The spine must distinguish "events replayed to rebuild state (silent)" from "events emitted live (may trigger effects)." One sentence, but its absence is a guaranteed bug.

### H4 — AD-5 defers the wrong layer: the integration *strategy* and *who commits* are load-bearing and unpinned
**Severity: high.** Refs: AD-5, FR-16, Open Q4, Deferred.

The spine defers "multi-file collision batching" and "send-it-back entanglement mechanics" — but leaves undecided the choice that determines whether those deferrals are even tractable: **how a Lane's work is committed and integrated.** "Integrate its worktree commits" presupposes commits exist — but nothing says who creates them or when (does Claude commit? does the app auto-commit on finish? the addendum floats `enableFileCheckpointing`/`rewindFiles()`, which the spine silently dropped in favor of git). And squash-merge-vs-merge is the hinge: squash makes "Send it back = revert that Job's commit(s)" a clean single-commit revert; a multi-commit branch merge makes revert a range operation and turns entanglement into the hairy problem the spine is hoping to defer past. The "scariest moment in the product" (EXPERIENCE collision flow) rests entirely on this undecided mechanic. Pin the commit-and-integrate strategy *before* deferring the edge cases that hang off it.

### H5 — AD-8 unblocks the build but silently contradicts the PRD's cost model
**Severity: high.** Refs: AD-8, PRD §9 Cost + Assumptions Index, FR-5/UJ-4 copy.

Does AD-8 unblock the build? For engineering, yes — an `ANTHROPIC_API_KEY` is a concrete, SDK-supported, testable auth path devs can build against today, and `safeStorage` is the right store. So the *auth* risk is genuinely retired. But it **relocates** the risk and the spine flags only half of it. AD-8 flags the *policy* risk to Maksym (good). It does not flag the *cost* consequence: the PRD's cost assumption — "Maksym's existing Claude Code plan suffices; the app adds no separate metering" (§9) — was written for a **subscription**. An API key is **usage-billed per token**, org-level, with no flat cap and no "hourly reset." The whole point of the product is *parallel* lanes, i.e. parallel token burn, with budgeting UI explicitly out of scope. And UJ-4's reassuring copy — "I hit Claude's hourly limit… it'll reset within the hour" — is subscription language the app can't truthfully say on API tiers. For a non-technical single user this is the difference between "my plan covers it" and an unexpected bill. The spine changed the auth model and didn't reconcile the cost premise or the UX copy that depends on it. Buildable — but the owner has been shown a subscription-shaped world and handed a metered one.

---

## Medium

### M1 — AD-3 conflates cwd-stability with session identity
Refs: AD-3, FR-13, addendum SDK notes. AD-3 reads "one Lane = one session, path-stable, so `resume` always finds the session." But FR-13 says a *new* Job "starts a fresh conversation" — so over a Lane's life there are *many* sessions in the same stable cwd, and the per-cwd `.jsonl` store holds several. cwd-stability is necessary but **not sufficient**: resume must target the persisted `session_id` (captured from the init message), or it finds the wrong session or starts fresh. AD-3 half-fixes the addendum's own gotcha (the cwd half) and misses the other half (persist and pass the id). "One Lane = one session" is imprecise — it's one *active* session at a time.

### M2 — Worktree reuse across Jobs leaves the next Job's diff polluted
Refs: AD-3, FR-13, FR-14, EXPERIENCE cancel/scrap. AD-3 keeps one worktree "for the Lane's whole life." A scrapped or cancelled Job leaves uncommitted edits in that worktree; the next Job "starts fresh" (new session) but in the *same* dirty worktree. Nothing specifies a reset (`git reset --hard` / `clean`) between Jobs. Cancel's promise "no half-done work lands" holds (landing is explicit), but the leftover edits pollute the next Job's diff and its eventual serve. Specify the between-Jobs worktree reset.

### M3 — The tool→friendly-phrase mapping and the completion-summary sentence have no owner
Refs: FR-7, FR-11, EXPERIENCE folded detail, DESIGN folded detail. Both UX spines explicitly punt "the exact mapping is architecture's." The architecture spine dropped it. Two related derivations are unassigned: (a) mapping SDK tool activity → the friendly line ("rummaging through the kitchen…"), and (b) the one-line completion summary for the notification/result (PRD FR-7: "produced by the Lane's Claude session"). Is the summary the last assistant text, or a separately-prompted sentence? Where does the tool-phrase map live — SDK adapter, domain, or renderer? These are small but honesty-bearing (they're the plain-language surface), and right now nobody owns them.

### M4 — Event-log location contradicts itself and sits in a hazardous place
Refs: Consistency Conventions vs Structural Seed. Conventions say "single event log per app install." The Seed puts it in `<project>/.bikini/` — i.e. *per project folder*, not per install. For v1's single project it's moot, but it's a real inconsistency, and it points at a hazard: install-level state living inside the user's project folder means a cloud-synced Project (iCloud/Dropbox) or a moved/deleted folder corrupts or loses the log and worktrees. Decide: install-scoped state belongs in app support, not the repo.

### M5 — First Run "git init" is insufficient for the folders Maksym will actually pick
Refs: AD-3, FR-19, EXPERIENCE First Run. `git worktree add` needs a repo with **at least one commit** — an empty folder after `git init` has no HEAD and worktree creation fails. An existing dirty repo, a detached HEAD, or a pre-existing `.bikini/` are all real inputs. The real requirement is "ensure a repo with an initial commit, create and exclude `.bikini/`, add worktrees" — not "git init." EXPERIENCE has the warm retry copy ("That drawer's stuck, lad"); the spine should enumerate what actually trips it.

### M6 — Renderer must play asset files it's forbidden to resolve
Refs: AD-1, AD-7, FR-6. The renderer owns audio playback (layer table) but "never reads the filesystem" (AD-1). Asset resolution is AD-7's resolver, which lives in main's asset adapter. So resolved file URIs/bytes for voices (and State pictures, background) must travel down in the snapshot or the Calling event — but the spine never says the snapshot carries resolved asset paths. Small, but a story dev building the renderer will hit it on day one.

### M7 — The 0.55s voice stagger has no owner, and "staggered" vs "never overlapping" are two rules
Refs: FR-6, EXPERIENCE matrix. "Two Lanes start Calling together → staggered 0.55s apart, never overlapping." Who spaces them — main (spacing the emissions) or the renderer (a playback queue)? The spine doesn't say. And a fixed 0.55s offset does *not* guarantee non-overlap if a clip runs longer than 0.55s — those are different rules. Assign ownership (a renderer playback queue is legitimate view state) and pick the actual rule.

---

## Low

### L1 — "Destructive shell command" isn't reliably detectable at the `canUseTool` seam
Refs: AD-6. Path-inside-worktree checks are clean for structured file tools, but a Bash tool's target is an arbitrary shell string; "any destructive shell command → Risky" can't be reliably classified without parsing shell. The deferral (allow-list settled in the first permission story) mostly covers this, so it's low — but "safe-narrow" slightly oversells how cleanly the seam separates safe from risky for shell. A plain-language sign-off can't make an unparseable command safe.

### L2 — Code-signing/notarization is sold casually for a hobby single-user app
Refs: Stack ("electron-builder, code-signed (required for macOS notifications)"). Notifications work unsigned in local/dev; signing + notarization needs a paid Apple Developer account and a real setup step. For a one-user personal tool that's non-trivial friction the owner may not expect. Worth a plain-language note rather than a parenthetical.

### L3 — "Adding Sandy = files + one config row, no code" slightly understates
Refs: AD-7, FR-2. Also needs an accent-color token, street position coords, and a worktree provisioned. DESIGN already pre-provisions Sandy (position + accent exist), so it's genuinely near-zero-code for *her* — but the general claim (FR-2 drop-ins) hides a couple of config touchpoints beyond "one row." Minor.

### L4 — The "structural not best-effort" framing (paradigm) overstates the Project-mutation side
Refs: Design Paradigm. Covered under C1; flagging separately because it's a *framing* problem an owner reads as a guarantee. True for app state, aspirational for the git side until C1/H4 are resolved.

---

## What I'd want fixed before stories are cut

In priority order: **C1** (Project-mutation safety — one AD covering ignore + path-scoped commits + integration atomicity/recovery), **H4** (pin commit-and-integrate strategy), **H1/H2/H3** (the streaming/transient channel, the SDK-as-second-source-of-truth reconciliation, and the replay-is-silent rule — these three are the difference between a Work Window that works and one that lies or shouts on boot), and **H5** (put the API-key cost consequence in front of Maksym in plain words, not just the auth-policy risk). The mediums are all one-sentence pins; none require rethinking the spine. The spine's bones are good — it just needs to be as careful about the git repo and the message stream as it already is about the dots and the board.

— Winston
