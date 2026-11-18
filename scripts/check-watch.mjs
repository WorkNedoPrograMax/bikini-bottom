// Checks "cheap when not watched" (2026-11-18): the pure decisions in
// dist/main/domain/watch.js, and that EVERY endless animation in styles.css is
// in the two lists that stand it still (nobody looking) and switch it off (calm
// mode). Plain node, no Electron. Run after `npm run build`:
//   node scripts/check-watch.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { watchState, snapshotGate, GLANCE_EVERY_MS, calmNow, nextCalm, normalizeCalm, CALM_ABOVE } = require("../dist/main/domain/watch.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };

console.log("watchState — is anyone looking:");
ok(watchState({ shown: true, minimized: false, focused: true }) === "watched", "shown + focused → watched");
ok(watchState({ shown: true, minimized: false, focused: false }) === "glance", "shown, another app has the keyboard → glance");
ok(watchState({ shown: false, minimized: false, focused: false }) === "away", "hidden (or fully covered) → away");
ok(watchState({ shown: true, minimized: true, focused: false }) === "away" && watchState({ shown: true, minimized: true, focused: true }) === "away", "minimised → away, whatever focus says");
ok(watchState({ shown: false, minimized: false, focused: true }) === "away", "not shown beats focused");

console.log("snapshotGate — when the page may hear an update:");
ok(snapshotGate("watched", 5000, 4999).send === true, "watched → every update at once (nothing changes for a looked-at window)");
const away = snapshotGate("away", 999999, 0);
ok(away.send === false && away.waitMs === null, "away → held, no timer (it goes out when someone looks)");
ok(GLANCE_EVERY_MS === 1000, "a glanced-at window hears at most one update a second");
ok(snapshotGate("glance", 10_000, 9_000).send === true && snapshotGate("glance", 10_000, 0).send === true, "glance, a second or more since the last → sent");
const g = snapshotGate("glance", 10_000, 9_700);
ok(g.send === false && g.waitMs === 700, "glance, 300 ms since the last → held, sent by a timer 700 ms later");

console.log("calm mode:");
ok(CALM_ABOVE === 3, "auto turns calm above three working lanes");
ok(!calmNow("auto", 0) && !calmNow("auto", 3) && calmNow("auto", 4) && calmNow("auto", 6), "auto: 3 working → not calm, 4 → calm");
ok(calmNow("on", 0) && !calmNow("off", 9), "on is always calm, off never — whatever the lanes do");
ok(nextCalm("auto") === "on" && nextCalm("on") === "off" && nextCalm("off") === "auto", "the button cycles auto → on → off → auto");
ok(normalizeCalm(undefined) === "auto" && normalizeCalm("nonsense") === "auto" && normalizeCalm("on") === "on" && normalizeCalm("off") === "off", "a missing or odd saved value → auto (the default)");

console.log("styles.css — every endless animation stands still when not watched and is off in calm mode:");
const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, " "), body: m[2] }));
const endless = rules.filter((r) => /animation[^;]*\binfinite\b/.test(r.body)).map((r) => r.sel);
const listOf = (root) => { const r = rules.find((x) => x.sel.startsWith(`:root.${root} :is(`)); return r ? r.sel.slice(`:root.${root} :is(`.length, -1).split(",").map((s) => s.trim()) : []; };
const still = listOf("still"), calm = listOf("calm");
ok(endless.length >= 7, `found the endless animations (${endless.length}): ${endless.join(" | ")}`);
for (const sel of endless) ok(still.includes(sel) && calm.includes(sel), `"${sel}" is in both lists`);
ok(rules.some((r) => r.sel.startsWith(":root.still") && /animation-play-state:\s*paused\s*!important/.test(r.body)), ":root.still pauses (the pulse resumes where it stopped)");
ok(rules.some((r) => r.sel.startsWith(":root.calm") && /animation:\s*none\s*!important/.test(r.body)), ":root.calm switches the pulses off (the dots themselves stay)");
ok(!rules.some((r) => /:root\.(still|calm)/.test(r.sel) && /display|visibility|opacity/.test(r.body)), "neither list hides anything — only motion stops");
const oneShot = rules.filter((r) => /animation\s*:/.test(r.body) && !/infinite|none/.test(r.body)).map((r) => r.sel);
ok(oneShot.length >= 1 && oneShot.every((s) => !still.includes(s) && !calm.includes(s)), `one-shot animations (${oneShot.join(" | ")}) are left alone — pausing "ink" would hide a fresh Notebook line`);

console.log(fails ? `\n${fails} check(s) failed` : "\nall watch checks passed");
process.exit(fails ? 1 : 0);
