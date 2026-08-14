---
title: Bikini Bottom — Adversarial Spine Review
role: adversary (build-substrate hole-finder)
target: ARCHITECTURE-SPINE.md (architecture-bikini-bottom-2026-07-12)
status: complete
created: 2026-07-12
method: >
  Construct pairs of one-level-down units (stories/components) that each obey EVERY
  AD to the letter yet build incompatibly — clashing shared-data shapes, two owners of
  one entity, conflicting state-mutation paths, races. Each surviving pair is a hole to
  close with a new or tightened AD.
---

# Adversarial Review — Architecture Spine, Bikini Bottom

## Verdict

**CONDITIONAL — the spine is sound in its layering (AD-1/AD-4 CQRS split, AD-3 isolation, AD-7/AD-8) but under-specified in exactly the seams where concurrency and cross-boundary identity live.** Eleven incompatibility pairs survive; **6 are HIGH** (two units can each satisfy every AD and still corrupt state, desync, or drop a "need" — directly threatening SM-2 "zero missed needs" and PRD §9 durability). The recurring root cause: the spine defines *layers and vocabulary* but never names a **single serialized writer**, a **total event order**, a **snapshot schema**, or the **renderer↔main handshake for passive resolution**. Every HIGH hole is a place where two honest developers pick opposite-but-AD-compliant models.

The spine should not proceed to stories until H-1, H-2, H-3, H-6, H-8, H-9 are closed with tightened ADs.

---

## Incompatibility Pairs

Legend: each pair names **Unit A** and **Unit B** (both one level down), why **both obey every AD**, and the **hole**. Severity: HIGH = silent corruption / desync / missed need; MED = user-visible inconsistency or rework; LOW = cosmetic/ergonomic.

### H-1 — Event log has no single writer and no total order (Probe a) — HIGH
- **Unit A** *(Lane event emission story)*: each adapter callback appends its own event directly — `await fs.appendFile(logPath, JSON.stringify(evt)+'\n')` then updates the in-memory snapshot. Obeys AD-2 ("event written before its effect is acknowledged").
- **Unit B** *(Persistence service story)*: a buffered writer collects events and flushes on a durability tick, assigning file order at flush time. Also obeys AD-2 ("append to a persisted log", "snapshot is a pure fold").
- **Both AD-compliant?** Yes — AD-2 mandates *append-only* and *pure fold* but names neither a serializing writer nor a monotonic sequence.
- **Hole:** Two Lanes' SDK streams resolve on different microtasks; two un-serialized `appendFile` calls **interleave bytes → corrupt JSONL**, and A-order (in-memory) diverges from B-order (on-disk). Worse: AD-2 calls the snapshot "a **pure fold** over events," but a pure fold requires a *total order*; the spine gives only ISO-8601 dates (Consistency table) with **no tie-break** and **no `seq`**. Two events in the same millisecond replay in a different order than they occurred → **the restarted snapshot differs from the live one** (Character shown Idle that was Calling, or vice-versa). This breaks the very promise AD-2 exists for ("a Character that was Calling is still Calling", FR-4).
- **Close with:** new AD — "**One append queue in main is the sole writer of the log. Every event carries a monotonic `seq` (integer, gap-free); the fold orders by `seq`, never by timestamp. All domain mutations funnel through this queue; adapters emit *event requests*, never write the log.**"

### H-2 — Snapshot schema (full vs diff) is undefined, so shared-data shapes clash (Probe b) — HIGH
- **Unit A** *(Town view component)*: renders from **full snapshots** pushed on every change; `Snapshot = { characters[], orders[], … }`.
- **Unit B** *(main snapshot emitter story)*: for efficiency emits **diffs** — `SnapshotDiff = { type:'diff', changed:[…] }` — since AD-4 only says "state snapshots" (plural, unqualified) and the Deferred/Consistency notes never fix the shape.
- **Both AD-compliant?** Yes — AD-4 requires shapes in `src/shared` as "discriminated union on a `type` field"; both A and B are exactly that. AD-1 satisfied by both.
- **Hole:** The spine itself flags "full vs diff is left open." A renderer built against `FullSnapshot` and a main built to emit `SnapshotDiff` **cannot interoperate**, and there is no version/`seq` on the snapshot to detect the mismatch — they will typecheck against two different `src/shared` revisions and fail only at runtime. This is the canonical clashing-shared-data-shape.
- **Close with:** tightened AD-4 — "**Main→renderer state is a full snapshot carrying the log's current `seq` as its version. Diffs, if ever needed, are a post-v1 optimization layered under the same versioned envelope.**"

### H-3 — Snapshot AND events both flow to the renderer with no reconciliation → renderer/main desync (Probe b) — HIGH
- **Unit A** *(Town)*: treats **snapshots** as truth, ignores the event stream.
- **Unit B** *(Work Window chat)*: FR-11 needs *incremental* streaming, so it consumes the **append-only event stream** and appends bubbles itself, keeping a derived chat list.
- **Both AD-compliant?** Yes — AD-4 literally says main replies with "**state snapshots and append-only domain events**" (both), and AD-1 is satisfied because neither invents business truth.
- **Hole:** AD-4 hands the renderer **two sources of truth with no stated precedence**. B can apply an event already folded into a newer snapshot A received (double-apply → duplicate chat bubble, or Unseen Dot re-appears), or apply a snapshot older than an event already shown (regression). No `seq` ties the two streams (see H-1/H-2). Desync is guaranteed under load, not incidental.
- **Close with:** AD tightening — "**The snapshot (with `seq`) is the single authority the renderer renders. `seq`-tagged events are advisory hints for animation/streaming only; on any snapshot the renderer discards events with `seq ≤ snapshot.seq`.**" (Resolves H-2, H-3, and the streaming question in H-4 together.)

### H-4 — "Exactly one channel" vs live token streaming: is a token an event? (Probe b, FR-11) — MED→HIGH
- **Unit A** *(chat streaming story)*: streams Claude tokens/tool-activity as **domain events** through the one AD-4 channel and, per AD-2 ("**every** transition is an event … written before its effect is acknowledged"), **persists every token**. Log bloats to hundreds of MB; every keystroke of output is fsync'd.
- **Unit B** *(chat streaming story, sibling dev)*: streams tokens on a **transient side channel** (not the log) to keep the log clean.
- **Both AD-compliant?** A obeys AD-2 literally; B obeys the *spirit* of AD-2 but **violates AD-4's "exactly one typed IPC channel each way"** — yet B's author reads "append-only domain events" as *domain* events (not view chatter), a defensible reading.
- **Hole:** The spine never distinguishes **persisted domain events** from **transient view/stream deltas**. Under B the chat is *not* in the log, so PRD §9 ("conversations survive quit/crash/sleep") **fails on restart** — bubbles vanish. Under A the log is unusable. Two valid readings, opposite durability outcomes.
- **Close with:** tightened AD-2/AD-4 — "**The log holds domain transitions only (a bounded, enumerable set). A Lane's conversation transcript is a per-Lane artifact persisted by the SDK adapter (or a sidecar), referenced by the snapshot — not folded into the event log. Token/tool streaming rides the single main→renderer channel as `seq`-less transient deltas, explicitly non-authoritative.**" (Makes H-4 and §9-conversation-durability consistent.)

### H-5 — Integration into main has no owner: two serves race on one working tree (Probe c) — HIGH
- **Unit A** *(SpongeBob "serve" story)*: on `JobServed`, `git -C <mainline> merge <spongebob-branch>`.
- **Unit B** *(Squidward "serve" story)*: same, on its own finish.
- **Both AD-compliant?** Yes — AD-5 says "landing = integrate its worktree commits into the Project's main line"; AD-3 isolates the *Lanes* (each its own worktree). Neither AD assigns an owner to **the main line**.
- **Hole:** AD-3 carefully isolates cooking, but **the shared integration point (main line) has no single writer**. Two near-simultaneous merges contend on `index.lock` / the shared index / the shared checkout → one aborts, corrupts, or silently clobbers. The spine's isolation guarantee stops exactly at the moment two Lanes need it most (landing). This is the concurrency twin of H-1 in the git layer.
- **Close with:** new AD — "**All integration into the main line is serialized through a single in-main mutex/queue owned by the domain; only one landing, send-back, or revert touches the main line at a time. Lanes never write the main line directly.**"

### H-6 — "The main line" is undefined: which working tree is it? (Probe c) — HIGH
- **Unit A** *(serving story)*: main line = **the user's chosen Project folder** (Maksym's actual working directory); landings merge into it.
- **Unit B** *(serving story)*: main line = a dedicated `.bikini` main branch/worktree; the user's folder is itself just a checkout, or is *also* a worktree.
- **Both AD-compliant?** Yes — AD-3 fixes only the *Lane* worktree path (`.bikini/worktrees/<character>`); AD-5 says "the Project's main line" without defining it; PRD §17 allows the Project to start as "a plain folder."
- **Hole:** Under A, a Lane's commits can't land while the user has uncommitted files in the folder, and Send-it-back's `git revert` rewrites the folder under Maksym's feet. Under B, the folder Maksym sees may lag behind "main." The two models produce **incompatible worktree topologies and incompatible First-Run setup (FR-19)** — the "invisible machinery" a plain folder gets is different in each. Every downstream git story inherits the wrong assumption from whichever sibling shipped first.
- **Close with:** new AD fixing the repo topology — e.g. "**First Run converts the Project folder into a git repo (if not one); its checked-out branch `main` IS the main line and the single integration target; each Lane worktree branches from and lands into `main` via the H-5 serializer.**"

### H-7 — JobServed event ordering vs landing outcome (Probe c, AD-2 vs AD-5) — MED
- **Unit A** *(serve story)*: per AD-2 ("event written **before** its effect"), emit `JobServed` first, then run the git landing; on conflict emit `CollisionRaised`. Board momentarily shows **SERVED** then flips to WAITING.
- **Unit B** *(serve story)*: run the landing first; emit `JobServed` only on a clean land, else `CollisionRaised` straight to WAITING.
- **Both AD-compliant?** A follows AD-2's letter ("event before effect"); B follows EXPERIENCE ("the order flips to **WAITING** … instead of landing silently" — never shows SERVED on a collision).
- **Hole:** AD-2's "event-before-effect" directly fights the required UX (collision must never flash SERVED). Two developers order the event and the git op oppositely.
- **Close with:** carve-out in AD-2 — "**For effects that can fail (git landing/revert), the *attempt* is the event (`LandingAttempted`), and the outcome (`JobServed` | `CollisionRaised`) is emitted after the git result. 'Event before effect' applies to in-memory transitions, not to fallible adapter effects.**"

### H-8 — Send-it-back of an old order vs a newer order: revert-time conflict has no home (Probe c, Open Q4) — HIGH
- **Unit A** *(Send-it-back story)*: AD-5 says "Send it back = **revert that Job's commit(s)**." Dev does `git revert <O1 commits>`. When newer order O2 touched the same lines, the revert **conflicts**; dev reuses FR-16 collision machinery → one either/or bubble.
- **Unit B** *(Send-it-back story)*: same start, but treats a revert conflict as a **failure** → emits a BURNED-style "couldn't send it back" with Try-again/Scrap.
- **Both AD-compliant?** Yes — AD-5 defines "collision" **only for landing** ("A collision = an integration conflict [at landing]"), and is silent on revert-time entanglement. Both readings honor "never a diff/merge view."
- **Hole:** Open Q4 (entanglement of Send-it-back with newer served work) is acknowledged in the PRD but **the spine provides no AD** — so the two units diverge on user-facing behavior *and* on data (does entanglement emit `CollisionRaised` or a new `SendBackBlocked`?). Plus the race: Send-it-back(O1) and landing(O2) both hit the main line concurrently (H-5).
- **Close with:** new AD extending AD-5 — "**Revert-time entanglement is modeled identically to a landing collision: emit `CollisionRaised` and surface the same single either/or ('send back both' vs 'keep the newer'). Send-it-back is routed through the H-5 integration serializer.**"

### H-9 — Worktree/session lifecycle vs FR-13 fresh conversation (Probe d) — HIGH
- **Unit A** *(new-Job / Home Base story)*: FR-13 requires a **fresh conversation** on a new Job, so A resets/clears the Lane's SDK session state on hand-out.
- **Unit B** *(follow-up / resume story)*: AD-3 pins the SDK `cwd` to a **per-character-stable** path so "`resume` always finds the session." B expects the same session to persist; a new Job at the same cwd will **resume the old conversation**.
- **Both AD-compliant?** Yes — AD-3 says "**the cwd never changes, so resume always finds the session**" (per Character, whole life); FR-13 says a new Job "**starts a fresh conversation**." The SDK stores session state keyed by cwd, so a stable cwd *by construction* resurfaces the prior session.
- **Hole:** AD-3's path-stability (needed for resume/follow-ups) **structurally fights** FR-13's fresh-start. "The Lane's whole life" is undefined — is it the Character's lifetime (B) or a single Job (A)? The two units disagree on whether a new Job carries stale context, and on **who deletes the SDK session** (and when). No AD names the session identifier or its reset point.
- **Close with:** new AD — "**A Lane's SDK session is identified by an explicit per-Job `sessionId`, not by cwd alone. The cwd stays path-stable (AD-3) for resume *within* a Job; handing out a new Job mints a new `sessionId` and archives the old transcript. Session teardown/reset is a domain event (`SessionReset`), owned by the Lane adapter.**"

### H-10 — Worktree branch topology across a Character's many Jobs (Probe d) — MED
- **Unit A** *(Lane worktree story)*: the per-Character worktree branch is **long-lived**; Job 2, 3, … stack on it. Never reset.
- **Unit B** *(Lane worktree story)*: the worktree **resets to `main`** at each new Job so each Job is a clean diff.
- **Both AD-compliant?** Yes — AD-3 fixes only the *path*; it says nothing about the branch's relationship to `main` across Jobs.
- **Hole:** Under A the branch diverges from `main` forever → every landing is a giant, collision-prone diff and Send-it-back must revert commits buried under later ones. Under B, resetting discards the commits that Send-it-back for an *older* SERVED order (still offered "for the lifetime of that conversation", EXPERIENCE) needs to revert — **Send-it-back becomes impossible**. Path-stability + per-order revertability are in tension; the two units are mutually exclusive.
- **Close with:** AD extension — define the branch lifecycle: e.g. "**each Job is its own branch off current `main` in the stable worktree path; landing fast-forwards/merges to `main`; the branch (and thus its revertable commit range) is retained as long as its order is Send-it-back-able (the conversation's life).**"

### H-11 — "Displayed = seen": OrderSeen has no owning layer and can be lost (Probes b, f) — HIGH
- **Unit A** *(Work Window render story)*: resolve-to-clear type 1 says the need clears when the summary is **displayed**. A treats "displayed" as a *renderer* fact: on actually painting the summary bubble, the renderer sends an intent → main emits `OrderSeen`.
- **Unit B** *(domain/snapshot story)*: AD-1 forbids the renderer from owning state and there is no user *action* for a passive "display" (unlike Allow/Deny/Scrap, which are clear intents). So B has **main** emit `OrderSeen` when it *delivers* a snapshot containing the summary to an open Work Window — "displayed = delivered."
- **Both AD-compliant?** Yes — AD-2 lists `OrderSeen` as an event but never says who emits it; AD-1/AD-4 make "displayed" (a pure-view fact) awkward to source from the only layer that knows it (the renderer) without granting the renderer authority.
- **Hole:** The two units **disagree on the meaning of "seen"** and both can be wrong:
  - Under **B**, a notification raises the window and main marks `OrderSeen` on delivery, but the summary is below the fold / the window closes before paint → **the dot clears though Maksym never saw it** → directly violates SM-2 ("zero missed needs") and UJ-2's promise "nothing was missable."
  - Under **A**, the "seen" intent is a fire-and-forget renderer→main message; if it's lost in IPC or main crashes before appending it (AD-2's write-before-ack governs *effects*, not inbound intents), **the dot never clears** on restart — a phantom permanent need.
  - No idempotency guard: if both the Town-snapshot path and the Work-Window path can trigger it, `OrderSeen` double-fires.
  This is the single most product-critical hole: the whole "nothing missable" thesis rests on a resolution event with no defined owner, no delivery guarantee, and no agreed definition.
- **Close with:** new AD — "**Passive resolutions are renderer-observed but main-authoritative. The renderer emits an explicit `orderSeen` intent only after the summary is actually on-screen (visible, not merely delivered); main folds it idempotently (guarded by `orderId`). If the intent is lost, the dot persists — the safe failure. 'Delivered' never counts as 'seen.'**" Consider making type-1 resolution require the same explicit-action rigor as types 2/3 rather than a passive paint.

---

## Secondary observations (not full pairs, but tightenings worth making)

- **PermissionAsked survives quit; the awaiting `canUseTool` promise does not (Probe e).** AD-6 emits `PermissionAsked` (persisted, good), but the *resolution* is a promise the SDK awaits **in memory**. On quit → relaunch, the log replays the ask (Character Calling, order WAITING) yet **no session is awaiting the answer**. Two units: one wires **Allow** to resolve the in-memory promise (does nothing / throws after restart); the other wires **Allow** to *resume* the session with the tool pre-approved. Also **is there a `PermissionAnswered` event?** AD-2's list ends in "…" and omits it — one dev persists the answer (replay-safe), another only resolves the promise (answer lost on crash mid-decision). And PRD §9's "quit pauses COOKING" is silent on "quit while WAITING on an ask." **Fix:** add AD — "`PermissionAsked` and `PermissionAnswered` are both persisted events; on relaunch an unanswered ask is re-presented and the answer *resumes the SDK session* (never resolves a dead promise); Allow/Deny is idempotent on `askId`."

- **Two owners of "the current Job for a Character."** PRD: Job≡Order, one active per Character (keyed by `character` slug), but the board keeps history and FR-13 flips the *same* `jobId` back to COOKING. One unit keys live state by `character`; another keys by `jobId`; the "which board line is live" pointer is not in any defined shape. **Fix:** the snapshot must carry an explicit `activeJobId` per character; history lines are read-only.

- **`interrupt()` (FR-14 cancel) vs the event log.** Cancel/scrap calls SDK `interrupt()`; is `JobScrapped` written before or after the interrupt returns, and is any partial in-flight tool output that arrives *after* the interrupt still a foldable event? Undefined; risks a SCRAPPED order still emitting `JobServed`. Fold under H-7's fallible-effect carve-out.

- **Staggered Voice Lines (0.55s, EXPERIENCE) are a renderer concern, but "which Calling happened first" is an ordering fact (H-1).** Without `seq`, two simultaneous Callings can't be deterministically staggered. Resolves once H-1 lands.

---

## Summary of holes → required spine changes

| ID | Probe | Severity | One-line hole | Fix |
|----|-------|----------|---------------|-----|
| H-1 | a | HIGH | No single writer / no total order on the log | AD: single append queue + monotonic `seq`; fold by `seq` |
| H-2 | b | HIGH | Snapshot shape (full/diff) undefined → shape clash | AD: full versioned snapshot carrying `seq` |
| H-3 | b | HIGH | Snapshot + events both authoritative, no precedence | AD: snapshot authoritative; events advisory, `seq`-gated |
| H-4 | b/FR-11 | MED→HIGH | Is a streamed token a persisted event? §9 durability at stake | AD: domain events vs transient deltas; transcript is a sidecar |
| H-5 | c | HIGH | Main-line integration has no owner → merge race | AD: single serialized integration queue in main |
| H-6 | c | HIGH | "The main line" working tree undefined | AD: fix repo topology (folder's `main` = integration target) |
| H-7 | c | MED | Event-before-effect vs "never flash SERVED on collision" | AD-2 carve-out: fallible effects emit attempt→outcome |
| H-8 | c/Q4 | HIGH | Revert-time entanglement has no model | AD: model as a landing collision through the serializer |
| H-9 | d | HIGH | Stable cwd (resume) vs FR-13 fresh conversation | AD: explicit per-Job `sessionId`; `SessionReset` event |
| H-10 | d | MED | Worktree branch lifecycle across Jobs undefined | AD: per-Job branch off `main`; retain while Send-it-back-able |
| H-11 | b/f | HIGH | `OrderSeen` has no owner, no delivery guarantee, disputed meaning | AD: renderer-observed/main-authoritative; delivered≠seen; safe-fail persists dot |

**Bottom line:** the spine's *structure* is defensible; its *seams* are not yet contracts. Close the six HIGH holes (H-1, H-2/H-3, H-5, H-6, H-8, H-9, H-11) before story work, or downstream developers will each build correct-per-AD units that cannot compose.
