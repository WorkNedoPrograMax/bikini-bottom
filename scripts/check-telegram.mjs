// Checks reply-to-continue on the phone (Telegram swipe-reply → the session
// behind the message) against dist/, with plain node. Run after `npm run build`:
//   node scripts/check-telegram.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { TgThreads, routeReply, isCurrentThread } = require("../dist/main/domain/tgThreads.js");
const { TelegramBridge } = require("../dist/main/adapters/telegram.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

// ── TgThreads: remember / lookup / cap ──────────────────────────────────────
console.log("TgThreads — the memory of which message belongs to which session:");
{
  const t = new TgThreads(3);
  const bob = { town: "/t", id: "bob", session: "s1", startedAt: 100 };
  t.remember([10, 11, null, undefined], bob);
  eq(t.lookup(10), bob, "a sent id is remembered");
  eq(t.lookup(11), bob, "every chunk of a long message is remembered");
  ok(t.lookup(null) === null && t.lookup(99) === null, "unknown / null ids → null");
  ok(t.size === 2, "nulls are skipped");
  t.remember([12, 13], { ...bob, session: "s2" });
  ok(t.lookup(10) === null && t.lookup(13).session === "s2", "oldest forgotten past the cap");
  const copy = t.lookup(13); copy.session = "mutated";
  ok(t.lookup(13).session === "s2", "lookup hands back a copy-safe record (stored one untouched)");
}

// ── isCurrentThread ─────────────────────────────────────────────────────────
console.log("isCurrentThread — is the remembered message about the lane's current conversation?");
{
  const facts = (o) => ({ terminal: false, working: false, asking: false, approving: false, session: "s1", startedAt: 100, pastIndex: -1, ...o });
  ok(isCurrentThread({ town: "/t", id: "bob", session: "s1", startedAt: 100 }, facts({})), "same session id → current");
  ok(!isCurrentThread({ town: "/t", id: "bob", session: "s0", startedAt: 100 }, facts({})), "different session id → not current, even with the same start stamp");
  ok(isCurrentThread({ town: "/t", id: "bob", session: null, startedAt: 100 }, facts({})), "'started' ping (no id yet) matches by the job's start stamp");
  ok(!isCurrentThread({ town: "/t", id: "bob", session: null, startedAt: 50 }, facts({})), "'started' ping of an OLDER job does not match the new job");
  ok(!isCurrentThread({ town: "/t", id: "bob", session: null, startedAt: 0 }, facts({ startedAt: 0 })), "a zero stamp never matches (fresh lane, nothing to continue)");
}

// ── routeReply ──────────────────────────────────────────────────────────────
console.log("routeReply — where a swipe-reply goes:");
{
  const cur = { town: "/t", id: "bob", session: "s1", startedAt: 100 };
  const old = { town: "/t", id: "bob", session: "s0", startedAt: 50 };
  const facts = (o) => ({ terminal: false, working: false, asking: false, approving: false, session: "s1", startedAt: 100, pastIndex: -1, ...o });
  eq(routeReply(cur, facts({})), { kind: "followUp" }, "reply to the finished message, character idle → follow-up in the same session (the 2026-10-29 case)");
  eq(routeReply(cur, facts({ working: true })), { kind: "followUp" }, "reply while it still works → follow-up (injected into the live turn)");
  eq(routeReply(cur, facts({ asking: true })), { kind: "answer" }, "reply to the 'asks' message → the answer");
  eq(routeReply(cur, facts({ approving: true })), { kind: "approval" }, "reply while a permission waits → told to tap Allow/Deny");
  eq(routeReply(old, facts({ pastIndex: 2 })), { kind: "resume", index: 2 }, "reply to an archived order, character free → reopen it with the text");
  eq(routeReply(old, facts({ pastIndex: 2, working: true })), { kind: "switch", index: 2 }, "reply to an archived order while busy → ask before stopping the current one");
  eq(routeReply(old, facts({ pastIndex: 2, asking: true })), { kind: "switch", index: 2 }, "…also while a question of the current order waits");
  eq(routeReply(old, facts({})), { kind: "lost" }, "reply to a session that is neither current nor archived → lost");
  eq(routeReply(cur, facts({ terminal: true })), { kind: "terminal" }, "a terminal character can't take a phone reply");
}

// ── TelegramBridge.dispatch: a reply carries reply_to_message ───────────────
console.log("TelegramBridge — a swipe-reply reaches onText with the replied-to id:");
{
  const seen = [];
  const b = new TelegramBridge("tok", 42, {
    onTap: () => {}, onCommand: (c, a) => seen.push(["cmd", c, a]),
    onText: (t, ctx) => seen.push(["text", t, ctx]),
  });
  const msg = (o) => ({ update_id: 1, message: { chat: { id: 42 }, message_id: 7, ...o } });
  await b["dispatch"](msg({ text: "answer this too", reply_to_message: { message_id: 5, text: "✅ SpongeBob finished:" } }));
  eq(seen.at(-1), ["text", "answer this too", { msgId: 7, replyTo: 5 }], "reply → onText(text, {msgId, replyTo})");
  await b["dispatch"](msg({ text: "plain" }));
  eq(seen.at(-1), ["text", "plain", { msgId: 7, replyTo: null }], "no reply → replyTo null");
  await b["dispatch"](msg({ text: "/town", reply_to_message: { message_id: 5 } }));
  eq(seen.at(-1), ["cmd", "town", ""], "a command stays a command even as a reply");
  await b["dispatch"]({ update_id: 2, message: { chat: { id: 1 }, message_id: 8, text: "hi", reply_to_message: { message_id: 5 } } });
  ok(seen.length === 3, "a stranger's reply is still ignored (owner lock)");
}

// ── sendLong returns every chunk's id ───────────────────────────────────────
console.log("TelegramBridge.sendLong — returns the id of every chunk:");
{
  let n = 100;
  const b = new TelegramBridge("tok", 42, { onTap() {}, onCommand() {}, onText() {} });
  b["api"] = async () => ({ ok: true, result: { message_id: n++ } });
  eq(await b.sendLong("short"), [100], "one chunk → one id");
  eq(await b.sendLong("x".repeat(3900 * 2 + 1)), [101, 102, 103], "three chunks → three ids");
  b["api"] = async () => null;
  eq(await b.sendLong("short"), [], "a failed send → no ids (nothing to reply to)");
}

console.log(fails ? `\n${fails} check(s) failed` : "\nall telegram checks passed");
process.exit(fails ? 1 : 0);
