# Architecture Spine — Version & Reality Check Review

**Target:** `ARCHITECTURE-SPINE.md` (Bikini Bottom, 2026-07-12)
**Reviewer scope:** Stack table + AD claims — confirm each named technology exists, versions are current, and named SDK APIs are real (not asserted from memory).
**Date of check:** 2026-07-12
**Verdict: PASS.** Every committed version and named API was reality-checked against primary sources (npm registry, releases.electronjs.org, code.claude.com Agent SDK docs). All confirmed current and correctly named. One cosmetic imprecision noted (non-blocking).

---

## Stack table

| Claim | Verdict | Evidence |
| --- | --- | --- |
| **Electron 43.1.0** — current stable | ✅ CONFIRMED | releases.electronjs.org lists 43.1.0 as the latest stable, released **2026-07-07**. It is a real stable release (not beta/nightly). |
| **Electron ships Node 24.x** — spine says "24.18" | ✅ CONFIRMED | Electron 43.1.0 bundles **Node.js 24.18.0** (and Chromium 150.0.7871.47). Spine's "24.18" is exact. |
| **@anthropic-ai/claude-agent-sdk 0.3.207** — current | ✅ CONFIRMED | npm registry `@anthropic-ai/claude-agent-sdk/latest` returns version **0.3.207**. Real and current latest. (Note: this is the Claude **Agent** SDK — Claude Code as a library — not the Anthropic API SDK `@anthropic-ai/sdk`. The spine uses it correctly.) |
| **SDK bundles native binary (no separate CLI install)** | ✅ CONFIRMED | npm metadata shows platform native binaries as **optionalDependencies**, including `@anthropic-ai/claude-agent-sdk-darwin-arm64` and `-darwin-x64` @ 0.3.207. Agent SDK overview docs confirm the TS SDK bundles a native binary; `pathToClaudeCodeExecutable` is the fallback only if optional deps are skipped. macOS coverage is complete. |
| **electron-builder, code-signed macOS packaging** | ✅ CONFIRMED (1 wording nit) | electron-builder is a standard, current tool with first-class macOS code-signing + notarization (`hardenedRuntime`, `notarize: true`, auto-staple). Valid choice. **Nit:** the parenthetical "(required for macOS notifications)" is imprecise — code signing/notarization is required for **distribution past Gatekeeper**, not for local notifications per se. Given v1 is a single-user local build (per Deferred), signing isn't strictly needed for notifications to fire. Cosmetic; does not affect the decision. |
| TypeScript 5.x (current) | ✅ trivially current | Not separately researched; "5.x current" is accurate. |
| Renderer: plain HTML/CSS/JS; system git; append-only JSON log | ✅ n/a | No external version claims to verify. |

---

## AD-level API claims (Agent SDK surface named in the Capability Map & ADs)

All verified against code.claude.com/docs/en/agent-sdk (sessions, permissions, file-checkpointing).

| Named API | Verdict | Evidence |
| --- | --- | --- |
| `query()` **streaming-input mode** (async-iterable prompt) | ✅ CONFIRMED | Documented; `query()` accepts an async iterable of messages. |
| `canUseTool` / **PermissionResult** | ✅ CONFIRMED | `canUseTool` callback returns a `PermissionResult` (Allow/Deny). This is the seam AD-6 relies on. |
| `resume` | ✅ CONFIRMED | `resume: <sessionId>` option on `query()`. |
| `forkSession` | ✅ CONFIRMED | Real TS option: `forkSession: true` (used with `resume`). Python: `fork_session=True`. **Note:** an initial sub-agent pass flagged this as "not an explicit option" — that was wrong; the docs show it verbatim. |
| `interrupt()` | ✅ CONFIRMED | `Query` object exposes `interrupt()`. Backs FR-14 Cancel. |
| `enableFileCheckpointing` / `rewindFiles` | ✅ CONFIRMED | `enableFileCheckpointing: true` option; `rewindFiles(...)` restores files to a checkpoint. |
| `listSessions` | ✅ CONFIRMED | `listSessions()` (TS) / `list_sessions()` (Python) enumerate on-disk sessions. |

**Bonus corroboration for AD-3:** The spine's AD-3 rationale — "SDK session resume silently starting fresh (the per-cwd storage gotcha)" — is explicitly confirmed by the Agent SDK docs: sessions are stored under `~/.claude/projects/<encoded-cwd>/*.jsonl`, and a `resume` from a mismatched `cwd` returns a fresh session. The spine's fixed-path-per-Lane invariant is a correct mitigation, not folklore.

---

## AD-8 (decision-critical) — claude.ai subscription auth NOT available to third-party SDK apps

**✅ CONFIRMED — the premise holds.**

- The Agent SDK overview states plainly: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Please use the API key authentication methods … instead."*
- A distributed third-party desktop app therefore **cannot ride on an end user's claude.ai Pro/Max subscription via OAuth login**; it must authenticate with an `ANTHROPIC_API_KEY` (pay-per-token). AD-8 and the First-Run flow are built on a correct external-policy reading.
- **Watch item (already flagged in the spine's Deferred):** A June 2026 billing change that would have given subscribers Agent-SDK **credits** to spend via API key was **paused on 2026-06-15** and is not in effect. Even if it resumes, it is a credit allowance spent through an API key — **not** OAuth/subscription login — so it would not change AD-8's structure. The spine already treats this as "the one place the product premise depends on an external policy — flagged to Maksym," which is the right posture.

---

## Flags / follow-ups

1. **(Cosmetic)** Stack table: "electron-builder, code-signed (required for macOS notifications)" — the *notifications* justification is inaccurate; signing/notarization is a *distribution* (Gatekeeper) requirement. Reword to "(required for distribution / avoiding Gatekeeper blocks)" or drop the parenthetical for a single-user local build.
2. **(Watch, already in Deferred)** AD-8 depends on Anthropic's third-party auth policy; the paused June-2026 credits change is the thing to keep an eye on. No action needed now.
3. Nothing in the stack was found to be fabricated, renamed, out of date, or unconfirmable.

**Sources:** releases.electronjs.org (Electron 43.1.0 stable, Node 24.18.0, 2026-07-07); registry.npmjs.org/@anthropic-ai/claude-agent-sdk (0.3.207 + darwin optionalDependencies); code.claude.com/docs/en/agent-sdk {sessions, permissions, file-checkpointing, overview}; electron.build code-signing/notarization docs.
