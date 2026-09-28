// Checks the Phone Booth's PURE parts (one test phone per town, shared in turns)
// against dist/, with plain node — no Electron, no simulator, no Claude. Run
// after `npm run build`:  node scripts/check-booth.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { phoneMatch, boothStep, Booth, parseSimctlDevices, commandSegments, FORBIDDEN_REASON, DEFAULT_GRACE_SEC, DEFAULT_MAX_HOLD_MIN } = require("../dist/main/domain/booth.js");
const { normalizeProfile, seedProfile, serializeProfile, normalizeDevice } = require("../dist/main/config/townProfile.js");
const { emptyTown, fold } = require("../dist/main/domain/snapshot.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const ID = "5DAAE89E-981D-4A6E-83B8-A610AF8779A3";
const bash = (command) => phoneMatch("Bash", { command }, ID);

console.log("phoneMatch — Bash commands that USE the phone (queue for it):");
ok(bash("maestro test .maestro/login.yaml") === "phone", "maestro test → phone");
ok(bash(`maestro --device ${ID} test flows/`) === "phone", "maestro --device X test → phone (flag before the subcommand)");
ok(bash("maestro record flow.yaml") === "phone" && bash("maestro studio") === "phone", "maestro record / studio → phone");
ok(bash(`flutter run -d ${ID}`) === "phone", "flutter run -d X → phone");
ok(bash(`cd ios && flutter run -d ${ID}`) === "phone", "cd ios && flutter run → phone (matched anywhere in the line)");
ok(bash("fvm flutter drive --target=test_driver/app.dart") === "phone", "fvm flutter drive → phone (fvm wrapper seen through)");
ok(bash(`flutter install -d ${ID}`) === "phone", "flutter install → phone");
ok(bash("flutter test integration_test/app_test.dart") === "phone", "flutter test integration_test/… → phone");
ok(bash("patrol test") === "phone" && bash("patrol develop -t integration_test/x.dart") === "phone", "patrol test / develop → phone");
ok(bash(`xcrun simctl install ${ID} build/ios/iphonesimulator/Runner.app`) === "phone", "xcrun simctl install → phone");
ok(bash(`xcrun simctl launch ${ID} com.example.app`) === "phone" && bash(`xcrun simctl io ${ID} screenshot s.png`) === "phone", "xcrun simctl launch / io → phone");
ok(bash("adb install app.apk") === "phone" && bash("adb -s emulator-5554 shell input tap 1 1") === "phone", "adb install / adb -s X shell → phone");
ok(bash(`FLUTTER_ROOT=/x flutter run -d ${ID} 2>&1 | tee run.log`) === "phone", "env prefix + a pipe → still phone");

console.log("phoneMatch — Bash commands that do NOT touch the phone (never wait):");
ok(bash("flutter build ios --simulator") === null, "flutter build → null");
ok(bash("flutter analyze && flutter test") === null, "flutter analyze / unit flutter test → null");
ok(bash("flutter pub get") === null && bash("dart run build_runner build") === null, "flutter pub get / dart run → null");
ok(bash("cd ios && pod install") === null, "pod install → null");
ok(bash("maestro --version") === null && bash("maestro cloud --api-key k flows/") === null, "maestro --version / maestro cloud → null");
ok(bash("xcrun simctl list devices available -j") === null, "xcrun simctl list → null");
ok(bash("adb devices") === null && bash("adb logcat -d") === null, "adb devices / logcat → null");
ok(bash("npm run e2e") === null, "npm run <script> → null (NOT seen through — the character note asks for real commands)");
ok(bash("git status && ls") === null, "git status → null");
ok(bash("open -a Simulator") === null, "open -a Simulator (no device named) → null");

console.log("phoneMatch — what only the town may do to the phone (refused):");
ok(bash(`xcrun simctl shutdown ${ID}`) === "forbidden", "xcrun simctl shutdown <our phone> → forbidden");
ok(bash("xcrun simctl shutdown all") === "forbidden" && bash(`xcrun simctl erase ${ID}`) === "forbidden" && bash("xcrun simctl delete unavailable") === "forbidden", "shutdown all / erase / delete → forbidden");
ok(bash(`xcrun simctl boot ${ID}`) === null, "xcrun simctl boot <our phone> → allowed (null)");
ok(bash("xcrun simctl boot 1111-2222") === "forbidden", "xcrun simctl boot <another one> → forbidden");
ok(bash(`open -a Simulator --args -CurrentDeviceUDID ${ID}`) === null, "open -a Simulator naming our phone → allowed");
ok(bash("open -a Simulator --args -CurrentDeviceUDID 1111-2222") === "forbidden", "open -a Simulator naming another phone → forbidden");
ok(bash("emulator -avd Pixel_7") === "forbidden" && bash("emulator @Pixel_7") === "forbidden", "emulator -avd / @avd → forbidden");
ok(bash("adb emu kill") === "forbidden" && bash("adb -s emulator-5554 emu kill") === "forbidden", "adb emu kill → forbidden");
ok(bash(`flutter run -d ${ID} && xcrun simctl shutdown ${ID}`) === "forbidden", "a forbidden segment wins over a phone segment in the same line");
ok(typeof FORBIDDEN_REASON === "string" && /Never shut it down/.test(FORBIDDEN_REASON), "the verdict text is the brief's sentence");

console.log("phoneMatch — MCP tools:");
ok(phoneMatch("mcp__plugin_empat-qa_maestro__run", { yaml: "…", device_id: ID }, ID) === "phone", "maestro __run → phone");
ok(phoneMatch("mcp__maestro__take_screenshot", {}, ID) === "phone" && phoneMatch("mcp__maestro__inspect_screen", {}, ID) === "phone", "maestro __take_screenshot / __inspect_screen → phone");
ok(phoneMatch("mcp__plugin_empat-qa_maestro__run_on_cloud", {}, ID) === null, "maestro __run_on_cloud → null (cloud never touches the local phone)");
ok(phoneMatch("mcp__maestro__get_cloud_run_status", {}, ID) === null && phoneMatch("mcp__maestro__list_cloud_devices", {}, ID) === null && phoneMatch("mcp__maestro__list_devices", {}, ID) === null, "cloud status / device listings → null");
ok(phoneMatch("mcp__playwright__browser_click", {}, ID) === null, "a non-maestro MCP tool → null");
ok(phoneMatch("Read", { file_path: "/x" }, ID) === null && phoneMatch("Edit", {}, ID) === null, "Read / Edit → null");
ok(commandSegments("(cd ios && flutter run) ; echo done").length === 3 && commandSegments("(cd ios && flutter run) ; echo done")[1][0] === "flutter", "commandSegments: a subshell's parens are stripped");

console.log("boothStep — the hook's order: the booth comes BEFORE the bypass allow:");
const dev = { id: ID };
ok(boothStep("Bash", { command: `xcrun simctl shutdown ${ID}` }, dev, true) === "forbidden", "bypass ON: a forbidden command is still refused");
ok(boothStep("Bash", { command: "maestro test x.yaml" }, dev, true) === "phone", "bypass ON: a phone command still queues (then bypass allows it)");
ok(boothStep("Bash", { command: "flutter build ios" }, dev, true) === "allow", "bypass ON: anything else is allowed");
ok(boothStep("Bash", { command: "flutter build ios" }, dev, false) === "gate", "bypass OFF: anything else goes through isSafe / ask");
ok(boothStep("Bash", { command: `xcrun simctl shutdown ${ID}` }, null, true) === "allow", "no phone in the town: nothing is refused, nothing queues (S&R as today)");
ok(boothStep("Bash", { command: "maestro test x.yaml" }, null, false) === "gate", "no phone in the town: a maestro command is an ordinary gated command");

console.log("Booth — first come, first served:");
let t = 1_000_000;
const now = () => t;
const booth = new Booth({ graceSec: 60, maxHoldMin: 30 }, now);
ok(booth.isEmpty(), "starts empty");
const states = {};
const claim = (id) => { states[id] = "pending"; return booth.claim(id).then((r) => { states[id] = r; }); };
const tick = () => new Promise((r) => setTimeout(r, 0));
await claim("pat");
ok(states.pat === "ok" && booth.view().holder === "pat", "pat claims an empty booth → ok at once, pat holds");
claim("bob"); claim("squid");
await tick();
ok(states.bob === "pending" && states.squid === "pending" && booth.view().queue.join(",") === "bob,squid", "bob then squid wait in arrival order");
await claim("pat");
ok(states.pat === "ok", "re-entry: the holder claims again → ok immediately");
booth.release("bob");
ok(booth.view().holder === "pat", "release by a non-holder is a no-op");
t += 30_000;
ok(booth.settle(t) === null && booth.view().holder === "pat", "30 s after pat's last touch: no release (grace is 60 s)");
booth.begin("pat"); // a phone command starts
t += 120_000;
ok(booth.settle(t) === null && booth.view().holder === "pat", "a phone command still running: the grace clock waits (no release after 120 s)");
booth.touch("pat"); // it finished
t += 59_000;
ok(booth.settle(t) === null, "59 s after it finished: still pat's");
t += 2_000;
let rel = booth.settle(t);
await tick();
ok(rel && rel.id === "pat" && rel.reason === "grace", "61 s after it finished, with a queue: pat is let go (reason grace)");
ok(booth.view().holder === "bob" && states.bob === "ok" && states.squid === "pending", "…and bob (first in line) steps in; squid still waits");
booth.abandon("squid");
await tick();
ok(states.squid === "left" && booth.view().queue.length === 0, "abandon(squid) resolves its promise with \"left\" and drops it from the queue");
t += 120_000;
ok(booth.settle(t) === null && booth.view().holder === "bob", "nobody waiting: bob keeps the phone past the grace");
t += 30 * 60_000;
rel = booth.settle(t);
ok(rel && rel.id === "bob" && rel.reason === "maxHold" && booth.view().holder === null, "30 min in: bob is let go regardless (reason maxHold) — the caller chalks it");
ok(booth.isEmpty(), "everyone left → isEmpty");
ok(booth.settle(t) === null, "settle on an empty booth → null");
claim("squid"); await tick();
ok(states.squid === "ok", "a fresh claim after everyone left → ok at once");
booth.release("squid");
ok(booth.isEmpty() && booth.view().since === 0, "release by the holder empties it");
// Parallel tool calls: the same character twice in the queue gets both at once.
const b2 = new Booth({}, now);
await b2.claim("pat");
const r1 = b2.claim("bob"), r2 = b2.claim("bob");
b2.release("pat");
ok((await r1) === "ok" && (await r2) === "ok" && b2.view().queue.length === 0 && b2.view().holder === "bob", "two queued calls from one character both resolve when it steps in");
ok(DEFAULT_GRACE_SEC === 60 && DEFAULT_MAX_HOLD_MIN === 30, "defaults: 60 s grace, 30 min cap");

console.log("normalizeProfile — the phone in town.json:");
const good = normalizeProfile({ name: "Rock App", landing: "none", device: { kind: "ios-simulator", id: ID, name: "iPhone 17 Pro", graceSec: 90, extra: 1 } }, "/x/rock-app");
ok(good.device && good.device.kind === "ios-simulator" && good.device.id === ID && good.device.name === "iPhone 17 Pro" && good.device.graceSec === 90 && good.device.maxHoldMin === undefined && good.device.extra === undefined, "a valid device is kept (unknown keys dropped, missing cap left to the default)");
ok(normalizeProfile({ device: { kind: "ios-simulator", id: ID } }, "/x/a").device === undefined, "a device without a name is dropped");
ok(normalizeProfile({ device: { kind: "tv", id: ID, name: "x" } }, "/x/a").device === undefined, "an unknown kind is dropped");
ok(normalizeProfile({ device: "iPhone" }, "/x/a").device === undefined && normalizeProfile({ device: { kind: "android-emulator", id: "", name: "Pixel" } }, "/x/a").device === undefined, "a string, or an empty id, is dropped");
ok(normalizeDevice({ kind: "android-emulator", id: "Pixel_7", name: "Pixel 7", graceSec: -5 }).graceSec === undefined, "a negative grace falls back to the default");
ok(seedProfile("/x/scout-and-runner").device === undefined, "Scout & Runner's seed has no phone");
ok(seedProfile("/x/rock-app", "auto").device === undefined, "a plain seed has no phone (the add-town answer or the profile file adds one)");
const round = normalizeProfile(JSON.parse(serializeProfile(good)), "/x/rock-app");
ok(JSON.stringify(round.device) === JSON.stringify(good.device), "serialize → parse → normalize keeps the phone");

console.log("snapshot — the booth field exists in every constructor:");
ok(emptyTown().booth === null, "emptyTown().booth === null");
ok(fold([]).booth === null, "fold().booth === null (main fills it)");
const reg = fold([{ seq: 1, at: "", type: "CharacterRegistered", id: "bob", name: "SpongeBob", role: "r", accent: "#f7b500", pos: { leftPct: 80, topPct: 74 }, isHomeBase: false }]);
ok(reg.characters[0].booth === null, "a registered character starts with booth null");

console.log("parseSimctlDevices — the phone picker's lines:");
const simJson = JSON.stringify({ devices: {
  "com.apple.CoreSimulator.SimRuntime.iOS-26-3": [
    { udid: "AAA", name: "iPhone 17 Pro", state: "Shutdown", isAvailable: true },
    { udid: "BBB", name: "iPhone 17", state: "Booted", isAvailable: true },
    { udid: "CCC", name: "iPad Air 11-inch (M3)", state: "Shutdown", isAvailable: false },
  ],
  "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [{ udid: "DDD", name: "iPhone 16", state: "Shutdown", isAvailable: true }],
} });
const devs = parseSimctlDevices(simJson);
ok(devs.length === 3 && devs[0].id === "BBB" && devs[0].booted === true, "booted first; unavailable ones dropped");
ok(devs[0].os === "iOS 26.3" && devs[1].os === "iOS 18.0", "runtime key → \"iOS 26.3\"");
ok(devs.map((d) => d.name).join("|") === "iPhone 17|iPhone 16|iPhone 17 Pro", "then by name");
ok(parseSimctlDevices("not json").length === 0 && parseSimctlDevices("{}").length === 0, "bad or empty JSON → []");

console.log(fails ? `\n${fails} CHECK(S) FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
