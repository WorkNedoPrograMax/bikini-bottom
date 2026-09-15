// Checks the Ferry's PURE parts (one town per project) against dist/, with plain
// node and FAKE paths — never a real project folder. Run after `npm run build`:
//   node scripts/check-towns.mjs
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const P = require("../dist/main/config/townProfile.js");
const { seedProfile, loadProfile, defaultName, townTabsFor, shouldLand, laneAdoption, normalizeProfile, serializeProfile, profilePath } = P;
const { AppConfig, migrateTowns } = require("../dist/main/config/appConfig.js");
const { emptyTown, fold } = require("../dist/main/domain/snapshot.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const tmp = mkdtempSync(path.join(tmpdir(), "bikini-towns-"));

console.log("defaultName — the sign before anyone renames it:");
ok(defaultName("/x/scout-and-runner") === "Scout & Runner", '"scout-and-runner" → "Scout & Runner"');
ok(defaultName("/x/my-app") === "my-app", '"my-app" → "my-app"');
ok(defaultName("/x/rock-bottom/") === "rock-bottom", "a trailing slash is ignored");

console.log("seedProfile — S&R gets today's three lanes; anything else is a name:");
const sr = seedProfile("/x/scout-and-runner");
ok(sr.name === "Scout & Runner" && sr.landing === "none", "S&R: named, landing none (Bikini never merges on a team repo)");
ok(sr.lanes && Object.keys(sr.lanes).sort().join(",") === "bob,pat,squid", "S&R: bob, squid, pat adopted");
ok(sr.lanes.bob.dir === "../sr-bob" && sr.lanes.bob.branch === "feat/bob" && sr.lanes.bob.frontendPort === 3100 && sr.lanes.bob.backendPort === 3101, "bob → ../sr-bob · feat/bob · 3100/3101");
ok(sr.lanes.squid.dir === "../sr-squid" && sr.lanes.squid.branch === "feat/squid" && sr.lanes.squid.frontendPort === 3200 && sr.lanes.squid.backendPort === 3201, "squid → ../sr-squid · feat/squid · 3200/3201");
ok(sr.lanes.pat.dir === "../sr-pat" && sr.lanes.pat.branch === "feat/pat" && sr.lanes.pat.frontendPort === 3300 && sr.lanes.pat.backendPort === 3301, "pat → ../sr-pat · feat/pat · 3300/3301");
ok(!sr.lanes.krabs, "Mr. Krabs has no lane");
const plain = seedProfile("/x/whatever");
ok(JSON.stringify(plain) === JSON.stringify({ name: "whatever", landing: "none" }), 'other folder → { name: "whatever", landing: "none" }, no lanes');
ok(seedProfile("/x/whatever", "auto").landing === "auto", "the add-a-town answer can seed landing auto");

console.log("laneAdoption — lane dirs resolve against the project folder:");
const ad = laneAdoption("/x/scout-and-runner", sr);
ok(ad && ad.adoptionFor("bob").worktree === "/x/sr-bob", "bob's worktree is the sibling /x/sr-bob (as today)");
ok(ad.adoptionFor("pat").branch === "feat/pat" && ad.adoptionFor("pat").frontendPort === 3300, "pat keeps branch + port");
ok(ad.adoptionFor("krabs") === null, "no adoption for Krabs");
ok(laneAdoption("/x/whatever", plain) === null, "a plain town has no adoptions (fresh .bikini worktrees)");

console.log("loadProfile — never throws:");
const proj = path.join(tmp, "rock-bottom");
mkdirSync(path.join(proj, ".bikini"), { recursive: true });
const read = (f) => readFileSync(f, "utf8");
ok(loadProfile(proj, read) === null, "no file → null");
writeFileSync(profilePath(proj), "{ this is not json", "utf8");
ok(loadProfile(proj, read) === null, "bad JSON → null");
writeFileSync(profilePath(proj), JSON.stringify({ name: "Rock Bottom", landing: "auto", mood: "gloomy", lanes: { bob: { dir: "lanes/bob", branch: "bob-work", extra: 1 }, sandy: { dir: "x", branch: "y" } } }), "utf8");
const rb = loadProfile(proj, read);
ok(rb && rb.name === "Rock Bottom" && rb.landing === "auto", "a profile with unknown fields loads (name + landing kept)");
ok(rb.mood === undefined, "unknown top-level fields are dropped");
ok(rb.lanes && rb.lanes.bob && rb.lanes.bob.label === "bob" && rb.lanes.bob.frontendPort === undefined, "a lane without a label gets its dir's basename; no ports stays no ports");
ok(!rb.lanes.sandy, "a lane for an unknown character is ignored");
writeFileSync(profilePath(proj), JSON.stringify({ landing: "sideways" }), "utf8");
const odd = loadProfile(proj, read);
ok(odd.name === "rock-bottom" && odd.landing === "none", "missing name → folder name; unknown landing → none");
writeFileSync(profilePath(proj), "[1,2,3]", "utf8");
ok(loadProfile(proj, read) === null, "a JSON array is not a profile → null");
ok(normalizeProfile(null, "/x/q").name === "q", "normalizeProfile(null) → defaults");
const round = normalizeProfile(JSON.parse(serializeProfile(sr)), "/x/scout-and-runner");
ok(JSON.stringify(round) === JSON.stringify(sr), "serialize → parse → normalize is a round trip");
ok(serializeProfile(sr).endsWith("\n"), "the file ends with a newline");

console.log("shouldLand — the integrate() gate:");
ok(shouldLand("none", false) === false, 'landing "none", fresh lane → never serveJob');
ok(shouldLand("none", true) === false, 'landing "none", adopted lane → never serveJob');
ok(shouldLand("auto", true) === false, 'landing "auto", adopted lane → still never (the repo\'s own rules decide)');
ok(shouldLand("auto", false) === true, 'landing "auto", fresh lane → serveJob (Epic 5 as v1)');

console.log("config migration — the lone project becomes the first town:");
ok(JSON.stringify(migrateTowns({ projectPath: "/a", towns: [] })) === JSON.stringify([{ path: "/a" }]), '{ projectPath: "/a", towns: [] } → towns [/a]');
ok(JSON.stringify(migrateTowns({ projectPath: "/a", towns: [{ path: "/a" }, { path: "/b" }] })) === JSON.stringify([{ path: "/a" }, { path: "/b" }]), "two towns stay as they are");
ok(JSON.stringify(migrateTowns({ projectPath: null, towns: [] })) === "[]", "no project, no towns → []");
ok(JSON.stringify(migrateTowns({ projectPath: "/a", towns: [{ path: "/b" }, "junk", { nope: 1 }] })) === JSON.stringify([{ path: "/b" }]), "malformed entries are dropped");
const ud = path.join(tmp, "userData"); mkdirSync(ud);
writeFileSync(path.join(ud, "bikini-config.json"), JSON.stringify({ projectPath: "/a", firstRunComplete: true }), "utf8");
const cfg = new AppConfig(ud);
await cfg.load();
ok(cfg.data.towns.length === 1 && cfg.data.towns[0].path === "/a" && cfg.data.projectPath === "/a", "AppConfig.load(): an old config (no towns key) → towns [/a], projectPath kept");
await cfg.save({ towns: [...cfg.data.towns, { path: "/b" }] });
const cfg2 = new AppConfig(ud); await cfg2.load();
ok(cfg2.data.towns.length === 2 && cfg2.data.towns[1].path === "/b", "saved towns round-trip through the file");
const cfg3 = new AppConfig(path.join(tmp, "nothing-here")); await cfg3.load();
ok(cfg3.data.towns.length === 0 && cfg3.data.projectPath === null, "a fresh install: no towns");

console.log("townTabsFor — the switcher's lines from each town's own fold:");
const A = { path: "/x/scout-and-runner", name: "Scout & Runner", characters: [
  { name: "Mr. Krabs", state: "idle", unseen: false, isHomeBase: true },
  { name: "SpongeBob", state: "working", unseen: false, isHomeBase: false },
  { name: "Patrick", state: "idle", unseen: false, isHomeBase: false },
] };
const B = { path: "/x/rock-bottom", name: "Rock Bottom", characters: [
  { name: "SpongeBob", state: "calling", unseen: true, isHomeBase: false },
  { name: "Squidward", state: "calling", unseen: false, isHomeBase: false }, // seen already — no dot
] };
const C = { path: "/gone/atlantis", name: "atlantis", missing: true, characters: [] };
const tabs = townTabsFor([A, B, C], "/x/scout-and-runner");
ok(tabs.length === 3 && tabs[0].current === true && tabs[1].current === false && tabs[2].current === false, "three lines; only the shown town is current");
ok(tabs[0].cooking === 1 && tabs[0].needsYou === 0 && tabs[0].cookingNames[0] === "SpongeBob", "S&R: cooking 1 (SpongeBob) / needsYou 0");
ok(tabs[1].cooking === 0 && tabs[1].needsYou === 1, "Rock Bottom: cooking 0 / needsYou 1 (the seen one does not count)");
ok(tabs[2].missing === true && tabs[2].cooking === 0 && tabs[2].needsYou === 0, "missing folder flagged, quiet");
ok(tabs[0].missing === undefined, "an open town carries no missing flag");
ok(townTabsFor([A, B], null).every((t) => !t.current), "no shown town → nothing current");
// The same fold the street uses feeds the tabs: a real event log slice.
let seq = 0; const events = []; const append = (ev) => events.push({ ...ev, seq: ++seq, at: new Date().toISOString() });
append({ type: "CharacterRegistered", id: "bob", name: "SpongeBob", role: "r", accent: "#f7b500", pos: { leftPct: 80, topPct: 74 }, isHomeBase: false });
append({ type: "CharacterRegistered", id: "krabs", name: "Mr. Krabs", role: "r", accent: "#c0392b", pos: { leftPct: 63, topPct: 79 }, isHomeBase: true });
append({ type: "JobHandedOut", id: "bob", prompt: "Fix the footer" });
append({ type: "CharacterStateChanged", id: "bob", state: "working" });
const live = townTabsFor([{ path: "/x/y", name: "y", characters: fold(events).characters }], "/x/y")[0];
ok(live.cooking === 1 && live.needsYou === 0, "fold → tabs: a working SpongeBob is 1 cooking");
append({ type: "CharacterStateChanged", id: "bob", state: "calling" });
const done = townTabsFor([{ path: "/x/y", name: "y", characters: fold(events).characters }], "/other")[0];
ok(done.cooking === 0 && done.needsYou === 1 && done.current === false, "…finished (calling, unseen) in a background town → 1 needs you");

console.log("snapshot — the new fields exist in every constructor:");
const e = emptyTown();
ok(Array.isArray(e.towns) && e.towns.length === 0 && e.townName === "" && e.addingTown === null, "emptyTown(): towns [], townName \"\", addingTown null");
const f = fold([]);
ok(Array.isArray(f.towns) && f.townName === "" && f.addingTown === null, "fold(): same defaults (main fills them)");

rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} CHECK(S) FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
