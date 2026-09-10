// Checks the PURE fold (snapshot.ts) for "Come back later" (Orca plan, Job 4):
// a pin keeps the red dot on regardless of state changes, and only opening the
// character (ReminderCleared) or a genuinely new order (JobHandedOut) drops it.
// Run after `npm run build`:  node scripts/check-fold.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { fold } = require("../dist/main/domain/snapshot.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };

// A tiny event-log stand-in: stamps seq + at like the real writer.
let seq = 0;
const events = [];
const append = (ev) => { events.push({ ...ev, seq: ++seq, at: new Date().toISOString() }); return events; };
const bob = () => fold(events).characters.find((c) => c.id === "bob");

console.log("fold — come back later (reminded ⟂ state):");
append({ type: "CharacterRegistered", id: "bob", name: "SpongeBob", role: "the eager lane", accent: "#f7b500", pos: { leftPct: 80, topPct: 74 }, isHomeBase: false });
ok(bob().state === "idle" && bob().unseen === false && bob().reminded === false, "registered → idle, no dot, not pinned");
append({ type: "JobHandedOut", id: "bob", prompt: "Add the refund flow" });
append({ type: "CharacterStateChanged", id: "bob", state: "working" });
ok(bob().state === "working" && bob().unseen === false, "working → no dot");
append({ type: "CharacterStateChanged", id: "bob", state: "calling" });
ok(bob().state === "calling" && bob().unseen === true, "calling (finished) → dot on (FR-4, unchanged)");
append({ type: "ReminderCleared", id: "bob" });
ok(bob().unseen === true, "ReminderCleared while still calling → dot stays (it's the finished result, not a pin)");
append({ type: "CharacterStateChanged", id: "bob", state: "idle" }); // Maksym opened it (markSeen)
ok(bob().state === "idle" && bob().unseen === false, "opened → idle, dot off");
append({ type: "ReminderSet", id: "bob" }); // "Come back later"
ok(bob().reminded === true && bob().unseen === true && bob().state === "idle", "ReminderSet → pinned: dot back on, still idle");
append({ type: "CharacterStateChanged", id: "bob", state: "working" }); // askPast browsing an old order
ok(bob().unseen === true && bob().reminded === true, "browsing an old order (→ working) does NOT drop the pin");
append({ type: "CharacterStateChanged", id: "bob", state: "idle" }); // askPast done
ok(bob().unseen === true && bob().reminded === true, "…back to idle: still pinned");
append({ type: "CharacterStateChanged", id: "bob", state: "calling" }); // a late background report
ok(bob().unseen === true, "calling while pinned → dot on (of course)");
append({ type: "CharacterStateChanged", id: "bob", state: "idle" });
ok(bob().unseen === true && bob().reminded === true, "seen that report, but the pin still holds the dot");
append({ type: "JobHandedOut", id: "bob", prompt: "Now fix the footer" }); // a genuinely new order
ok(bob().reminded === false && bob().unseen === false, "a NEW order clears the pin → dot off");
append({ type: "CharacterStateChanged", id: "bob", state: "working" });
append({ type: "CharacterStateChanged", id: "bob", state: "calling" });
append({ type: "CharacterStateChanged", id: "bob", state: "idle" });
append({ type: "ReminderSet", id: "bob" });
append({ type: "ReminderCleared", id: "bob" }); // opened it again
ok(bob().reminded === false && bob().unseen === false, "pin → opened (ReminderCleared) while idle → dot off");
// Replay determinism: the same log folds to the same town (AD-2).
const a = JSON.stringify(fold(events)), b = JSON.stringify(fold(events));
ok(a === b, "fold is deterministic over the same log");
// Unknown character: events for someone not registered are ignored, not a crash.
append({ type: "ReminderSet", id: "sandy" });
ok(fold(events).characters.length === 1, "a reminder for an unregistered character is ignored");

console.log(fails ? `\n${fails} CHECK(S) FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
