# The technical plan, in plain words

*For Maksym. This is the "how it's built underneath" plan. You don't need to understand it to use the app — but here's every decision I made while you were out, why, and the one thing I need you to weigh in on.*

## The big shape

The app has two halves. One half is **the town you see and click** (the pretty part). The other half is **the quiet engine behind it** that actually talks to Claude, keeps track of every job, and touches your files. I've kept these strictly separated: the pretty part can *only show* things and *ask* the engine to do things — it can never touch your project directly. That separation is what guarantees the promises we made: nothing gets lost when you close the app, and a character can never get "stuck" in a way you can't see.

## The decisions I made

1. **The app is built with Electron** (a common, boring, reliable way to make Mac apps). The alternative, Tauri, would have fought us because it can't run Claude's toolkit directly. Electron just works here.
2. **Each character works in their own private copy of your project**, so two characters working at once can never step on each other. When a job finishes, its work is folded back into your real project cleanly.
3. **Everything is written down the instant it happens** — every job handed out, finished, or gone wrong. So if the app crashes or you quit, it wakes up exactly where it was. A waiting character is still waiting.
4. **Undo ("Send it back") works by keeping each job as one neat package**, so removing it is clean and never damages anything else.
5. **A watchdog** now watches every working character — if one goes silent (not an error, just… stuck), it turns into a "burned" order and calls you, instead of pretending to work forever.
6. **Your project is treated as sacred**: the app hides its own machinery from your files, does every save-or-undo as an all-or-nothing step, and repairs itself if a crash happens mid-save. It never rewrites your existing history — it only adds.

## The four expert reviewers found real problems — all now fixed

I ran the same panel you like on the technical plan. They caught: two characters saving at the same moment could clash; the app could lose track of whether you'd "seen" a result; a stuck job could hide; and the "keep both versions" case was missing when two characters both did something good. All fixed before I locked the plan.

## ✅ Resolved: the app uses the Claude you already have

*(Earlier I flagged this as a "you must get a pay-as-you-go key" problem. Maksym asked the right question — "can't it use my terminal Claude Code?" — and after checking properly, the answer is yes. Updated here.)*

The app connects to Claude using **your existing Claude Code subscription login** — the same one your terminal already uses. **No separate key, no pay-per-use billing.** Anthropic explicitly allows this for a personal, single-user tool like ours, and other apps just like it already work this way.

**What this means for you:**
- Nothing to set up or buy — at first launch the app just confirms it found your Claude and you're connected.
- You use the Claude you already pay for; no per-use meter.
- The only rule to respect is the one we already committed to: this stays *your* private personal tool, not something shared with other people or sold.

**Two small safety nets the build handles for you (nothing to act on):** the app makes sure no leftover pay-as-you-go key sneaks in and bills you, and if your Mac ever blocks it from reading your login, it uses an official one-time subscription pass instead — still your subscription.

I'm at solid-but-not-total confidence here, so the very first Claude-connection story tests it for real on your machine and falls back gracefully if needed. **There is no longer an open decision blocking the plan.**

## Where things stand

- ✅ Master plan (what we're building) — **locked**
- ✅ Design spec (how it looks and behaves) — **locked**
- ✅ Technical plan (how it's built) — **locked** (Claude connection resolved: uses your existing subscription)
- ✅ Build checklist (epics & stories) — **done**: 5 epics, 18 stories in build order
- ⏭️ Next: start building — first version is 3 characters + Mr. Krabs, with stand-in art until your pictures and voices arrive.
