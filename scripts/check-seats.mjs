// Checks the town's seats (domain/seats.ts): at most `seats` characters of one
// town work at once (2 unless town.json says otherwise); a further order waits,
// visibly, and starts by itself the moment a seat frees up.
// No Claude call is made: the session loop is replaced by a stub.
// Run after `npm run build`:  node scripts/check-seats.mjs
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { LaneManager } = require("../dist/main/adapters/lane.js");
const S = require("../dist/main/domain/seats.js");
const { normalizeProfile } = require("../dist/main/config/townProfile.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 5000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await tick(); return cond(); };
const fakeLog = () => ({ append: async () => {}, all: () => [] });
const town = () => { const dir = mkdtempSync(join(tmpdir(), "bikini-seats-")); mkdirSync(join(dir, ".bikini")); return dir; };
/** Sessions never reach Claude; what send() pushed stays readable in the pump. */
const manager = () => { const lm = new LaneManager(town(), fakeLog(), () => {}, () => {}, () => {}); lm.runSession = async () => {}; return lm; };
const queued = async (pump) => { const out = []; for (let i = 0; i < 3; i++) { const r = await Promise.race([pump.iter.next(), tick(50).then(() => null)]); if (!r || r.done) break; out.push(r.value.message.content); } return out; };

console.log("domain — who may work:");
{
  const L = (id, busy, o = {}) => ({ id, busy, waitingOnMaksym: false, seatSince: 0, ...o });
  ok(S.DEFAULT_SEATS === 2, "two seats by default");
  ok(S.seatFree("c", [L("a", true), L("b", false)], 2) === true, "one working → a second may start");
  ok(S.seatFree("c", [L("a", true), L("b", true)], 2) === false, "two working → a third waits");
  ok(S.seatFree("a", [L("a", true), L("b", true), L("c", true)], 2) === true, "a character already working keeps its seat");
  ok(S.seatFree("c", [L("a", true, { waitingOnMaksym: true }), L("b", true)], 2) === true, "one waiting on Maksym's answer does not hold a seat");
  ok(S.seatFree("d", [L("a", true), L("b", true)], 3) === true, "a town with 3 seats lets a third in");
  ok(JSON.stringify(S.admitOrder([L("a", true), L("x", false, { seatSince: 20 }), L("y", false, { seatSince: 10 })], 2)) === '["y"]', "a freed seat goes to the longest wait");
  ok(S.normalizeSeats(3) === 3 && S.normalizeSeats(0) === 2 && S.normalizeSeats("4") === 2 && S.normalizeSeats(undefined) === 2, "town.json `seats`: a whole number ≥ 1, else 2");
  ok(normalizeProfile({ seats: 3 }, "/x/mobile").seats === 3 && normalizeProfile({ seats: -1 }, "/x/mobile").seats === undefined, "the town profile keeps a valid `seats` and drops a bad one");
  const main = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
  ok(/townLanes\.seats = normalizeSeats\(profile\.seats\)/.test(main), "each town's lanes take the town's own seat count");
}

console.log("lane — a third order waits, visibly, and starts by itself:");
{
  const lm = manager();
  await lm.send("bob", "order 1", true);
  await lm.send("pat", "order 2", true);
  ok(lm.lane("bob").working && lm.lane("pat").working, "two characters work");
  await lm.send("squid", "order 3", true);
  const sq = lm.lane("squid");
  ok(!sq.pump && sq.seatWait?.text === "order 3", "the third order is held, no session opened");
  ok(lm.view("squid").working === true && lm.view("squid").activity === S.SEAT_WAIT_ACTIVITY, "…and shown as waiting for a free seat");
  await lm.send("squid", "and this", false);
  ok(sq.seatWait.text === "order 3\n\nand this" && !sq.pump, "a second message while waiting joins the held one");
  await lm.send("bob", "follow-up", false);
  ok(lm.lane("bob").outstanding === 2, "a working character's follow-up is never held");
  await lm.goIdle("bob");
  ok(await until(() => !!sq.pump), "bob finished → squid gets the seat");
  ok(JSON.stringify(await queued(sq.pump)) === JSON.stringify(["order 3\n\nand this"]), "…and starts with what was held");
  ok(sq.seatWait === null && sq.seatSince === 0 && lm.view("squid").activity !== S.SEAT_WAIT_ACTIVITY, "the waiting state is gone");
  // A cancelled wait never starts.
  await lm.send("krabs", "order 4", true);
  ok(!!lm.lane("krabs").seatWait, "krabs waits too");
  await lm.cancel("krabs");
  await lm.goIdle("pat"); await tick(100);
  ok(!lm.lane("krabs").pump && lm.lane("krabs").seatWait === null, "a cancelled wait does not start when a seat frees");
}
{
  const lm = manager(); lm.seats = 3;
  await lm.send("bob", "1", true); await lm.send("pat", "2", true); await lm.send("squid", "3", true);
  ok(!!lm.lane("squid").pump && !lm.lane("squid").seatWait, "with seats: 3 a third character works at once");
}

console.log(fails ? `\n${fails} check(s) FAILED` : "\nall seat checks passed");
process.exit(fails ? 1 : 0);
