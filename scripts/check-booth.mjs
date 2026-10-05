// Checks the Phone Booth's PURE parts (a door per phone, one line per town)
// against dist/, with plain node — no Electron, no simulator, no Claude. Run
// after `npm run build`:  node scripts/check-booth.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { phoneMatch, boothStep, wantsAndroid, Booth, Switchboard, phoneTarget, PHONE_ORDER, parseSimctlDevices, commandSegments, FORBIDDEN_REASON, DEFAULT_GRACE_SEC, DEFAULT_MAX_HOLD_MIN } = require("../dist/main/domain/booth.js");
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
ok(bash("adb reboot") === "forbidden" && bash("adb kill-server") === "forbidden" && bash("avdmanager delete avd -n Pixel_7") === "forbidden", "adb reboot / kill-server, avdmanager delete → forbidden");
ok(bash("flutter emulators --launch Pixel_8_API_34") === "forbidden" && bash("fvm flutter emulators --launch=Pixel_8_API_34") === "forbidden", "flutter emulators --launch → forbidden (the town boots, never the character)");
ok(bash("flutter emulators") === null && bash("emulator -list-avds") === null && bash("avdmanager list avd") === null, "flutter emulators / emulator -list-avds / avdmanager list → null (just a look)");
ok(bash("adb -s emulator-5554 push a.txt /sdcard/") === "phone" && bash("adb exec-out screencap -p > s.png") === "phone", "adb push / exec-out → phone");

console.log("phoneMatch — a town with TWO phones (iPhone + Android emulator), one door:");
const AVD = "Pixel_8_API_34";
const both = (command) => phoneMatch("Bash", { command }, [ID, AVD]);
ok(both(`flutter run -d ${ID}`) === "phone" && both(`flutter run -d ${AVD}`) === "phone" && both("flutter run -d emulator-5554") === "phone", "flutter run on either phone → phone");
ok(both(`emulator -avd ${AVD}`) === "forbidden" && both(`flutter emulators --launch ${AVD}`) === "forbidden", "booting even the town's OWN Android phone is forbidden for a character (the town wakes it)");
ok(both("adb emu kill") === "forbidden" && both(`xcrun simctl shutdown ${ID}`) === "forbidden", "shutting either phone down → forbidden");
ok(both(`xcrun simctl boot ${ID}`) === null && both("xcrun simctl boot 1111-2222") === "forbidden", "the iPhone rules are unchanged with a second phone");

console.log("wantsAndroid — which phone commands wake the emulator:");
const wa = (command) => wantsAndroid("Bash", { command }, AVD);
ok(wa("adb install app.apk") && wa("adb -s emulator-5554 shell input tap 1 1"), "any adb command → android");
ok(wa(`flutter run -d ${AVD}`) && wa("flutter run -d emulator-5554") && wa("fvm flutter run -d android"), "flutter run -d <avd> / <serial> / android → android");
ok(wa("maestro --device emulator-5554 test flows/") && wa(`maestro --udid=${AVD} test flows/`), "maestro --device <serial> / --udid=<avd> → android");
ok(wa(`cd android && flutter run -d ${AVD}`), "matched anywhere in the line");
ok(!wa(`flutter run -d ${ID}`) && !wa("maestro test flows/login.yaml") && !wa(`xcrun simctl install ${ID} Runner.app`), "an iPhone (or unnamed) phone command → NOT android");
ok(!wa("flutter build apk --debug") && !wa("flutter build appbundle"), "building for Android is NOT a phone command → NOT android");
ok(wantsAndroid("mcp__plugin_empat-qa_maestro__run", { yaml: "…", device_id: "emulator-5554" }, AVD) && !wantsAndroid("mcp__plugin_empat-qa_maestro__run", { yaml: "…", device_id: ID }, AVD), "maestro MCP run: device_id emulator-5554 → android, the iPhone udid → not");
ok(!wantsAndroid("Read", { file_path: "/x" }, AVD), "Read → not android");
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
const dev = [ID];
ok(boothStep("Bash", { command: `xcrun simctl shutdown ${ID}` }, dev, true) === "forbidden", "bypass ON: a forbidden command is still refused");
ok(boothStep("Bash", { command: `emulator -avd ${AVD}` }, [ID, AVD], true) === "forbidden", "bypass ON, two phones: booting the Android phone is still the town's job");
ok(boothStep("Bash", { command: `flutter run -d ${AVD}` }, [ID, AVD], true) === "phone", "two phones: an Android run queues at the one door");
ok(boothStep("Bash", { command: "maestro test x.yaml" }, ID, true) === "phone", "a single id string still works for callers that hold one");
ok(boothStep("Bash", { command: `xcrun simctl shutdown ${ID}` }, [], true) === "allow", "an empty id list = no booth");
ok(boothStep("Bash", { command: "maestro test x.yaml" }, dev, true) === "phone", "bypass ON: a phone command still queues (then bypass allows it)");
ok(boothStep("Bash", { command: "flutter build ios" }, dev, true) === "allow", "bypass ON: anything else is allowed");
ok(boothStep("Bash", { command: "flutter build ios" }, dev, false) === "gate", "bypass OFF: anything else goes through isSafe / ask");
ok(boothStep("Bash", { command: `xcrun simctl shutdown ${ID}` }, null, true) === "allow", "no phone in the town: nothing is refused, nothing queues (S&R as today)");
ok(boothStep("Bash", { command: "maestro test x.yaml" }, null, false) === "gate", "no phone in the town: a maestro command is an ordinary gated command");

console.log("Booth — first come, first served:");
let t = 1_000_000;
const now = () => t;
const booth = new Booth({ graceSec: 60, maxHoldMin: 30 }, now); // the single-door class keeps its own tests (60 s grace set explicitly)
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
ok(DEFAULT_GRACE_SEC === 600 && DEFAULT_MAX_HOLD_MIN === 30, "defaults: 600 s grace (2026-10-05: a tester editing a flow must not lose the phone), 30 min cap");

console.log("normalizeProfile — the phone in town.json:");
const good = normalizeProfile({ name: "Rock App", landing: "none", device: { kind: "ios-simulator", id: ID, name: "iPhone 17 Pro", graceSec: 90, extra: 1 } }, "/x/rock-app");
ok(good.device && good.device.kind === "ios-simulator" && good.device.id === ID && good.device.name === "iPhone 17 Pro" && good.device.graceSec === 90 && good.device.maxHoldMin === undefined && good.device.extra === undefined, "a valid device is kept (unknown keys dropped, missing cap left to the default)");
ok(normalizeProfile({ device: { kind: "ios-simulator", id: ID } }, "/x/a").device === undefined, "a device without a name is dropped");
ok(normalizeProfile({ device: { kind: "tv", id: ID, name: "x" } }, "/x/a").device === undefined, "an unknown kind is dropped");
ok(normalizeProfile({ device: "iPhone" }, "/x/a").device === undefined && normalizeProfile({ device: { kind: "android-emulator", id: "", name: "Pixel" } }, "/x/a").device === undefined, "a string, or an empty id, is dropped");
const two = normalizeProfile({ device: { kind: "ios-simulator", id: ID, name: "iPhone 17" }, android: { kind: "android-emulator", id: AVD, name: "Pixel 8" } }, "/x/a");
ok(two.android && two.android.kind === "android-emulator" && two.android.id === AVD && two.android.name === "Pixel 8", "a second, Android phone is kept next to the default one");
ok(normalizeProfile({ android: { kind: "android-emulator", id: AVD, name: "Pixel 8" } }, "/x/a").android === undefined, "an Android phone with NO default phone is dropped (no door to share)");
ok(normalizeProfile({ device: { kind: "ios-simulator", id: ID, name: "iPhone 17" }, android: { kind: "ios-simulator", id: "BBB", name: "iPhone 16" } }, "/x/a").android === undefined, "a second iPhone is dropped (the second phone is Android only)");
ok(normalizeProfile({ device: { kind: "android-emulator", id: AVD, name: "Pixel 8" }, android: { kind: "android-emulator", id: "Galaxy_26", name: "Galaxy" } }, "/x/a").android === undefined, "two emulators are dropped to one (this Mac cannot carry two)");
ok(JSON.stringify(normalizeProfile(JSON.parse(serializeProfile(two)), "/x/a").android) === JSON.stringify(two.android), "serialize → parse → normalize keeps the Android phone");
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


console.log("phoneTarget — which phone a command wants, and whether it is bound to it:");
const PH = { ios: ID, android: AVD };
const tgt = (command) => phoneTarget("Bash", { command }, PH);
const eq = (a, want, bound) => a.want === want && a.bound === bound;
ok(eq(tgt(`flutter run -d ${ID}`), "ios", false), "flutter run -d <iphone> → wants ios, NOT bound (may be re-aimed at Android)");
ok(eq(tgt(`maestro --device ${ID} test flows/`), "ios", false), "maestro --device <iphone> → ios, not bound");
ok(eq(tgt("maestro test flows/login.yaml"), null, false) && eq(tgt("flutter run"), null, false), "names no phone → want null");
ok(eq(tgt(`xcrun simctl install ${ID} Runner.app`), "ios", true) && eq(tgt(`xcrun simctl io ${ID} screenshot s.png`), "ios", true), "xcrun simctl … → ios, BOUND");
ok(eq(tgt(`open -a Simulator --args -CurrentDeviceUDID ${ID}`), "ios", true), "open -a Simulator → ios, bound");
ok(eq(tgt("maestro --platform ios test flows/"), "ios", true) && eq(tgt("maestro --platform=iOS test flows/"), "ios", true), "maestro --platform ios → ios, bound");
ok(eq(tgt("flutter run -d ios"), "ios", true), "flutter run -d ios → ios, bound");
ok(eq(tgt("adb install app.apk"), "android", true) && eq(tgt(`flutter run -d ${AVD}`), "android", true) && eq(tgt("flutter run -d emulator-5554"), "android", true) && eq(tgt("fvm flutter run -d android"), "android", true), "adb / -d <avd> / <serial> / android → android, BOUND");
ok(eq(phoneTarget("mcp__plugin_empat-qa_maestro__run", { yaml: "…", device_id: ID }, PH), "ios", false), "maestro MCP device_id <iphone> → ios, not bound");
ok(eq(phoneTarget("mcp__plugin_empat-qa_maestro__run", { yaml: "…", device_id: "emulator-5554" }, PH), "android", true), "maestro MCP device_id <serial> → android, bound");
ok(eq(phoneTarget("mcp__maestro__take_screenshot", {}, PH), null, false), "maestro MCP with no device → null");
ok(eq(phoneTarget("Bash", { command: "maestro test x.yaml" }, { ios: ID }), null, false), "a one-phone (iPhone) town: unnamed → null (the caller maps it to the only phone)");
ok(eq(phoneTarget("Bash", { command: "maestro test x.yaml" }, { android: AVD }), "android", true), "a one-phone (Android) town: everything is the Android phone");
ok(PHONE_ORDER[0] === "ios" && PHONE_ORDER[1] === "android", "preference order: iPhone first");

console.log("Switchboard — a door per phone, ONE line, iPhone first:");
let T = 2_000_000;
const nowB = () => T;
const sb = new Switchboard(["ios", "android"], { graceSec: 600, maxHoldMin: 30 }, nowB);
const got = {};
const want = (id, w) => { got[id] = "pending"; return sb.claim(id, w).then((g) => { got[id] = g.r === "ok" ? g.phone : "left"; }); };
ok(sb.isEmpty() && sb.view().doors.length === 2, "starts empty with two doors");
await want("squid", null);
ok(got.squid === "ios" && sb.holding("squid") === "ios", "first comer, no preference → the iPhone");
await want("pat", null);
ok(got.pat === "android" && sb.holding("pat") === "android", "iPhone busy → the next comer gets the Android phone");
want("bob", null); await tick();
ok(got.bob === "pending" && sb.view().queue.join(",") === "bob", "both busy → bob waits in the line");
await want("squid", null);
ok(got.squid === "ios", "re-entry: the holder's unnamed command uses the phone it holds");
await want("squid", "ios");
ok(got.squid === "ios", "re-entry: the holder naming its own phone → ok at once");
sb.release("pat"); await tick();
ok(got.bob === "android" && sb.holding("bob") === "android" && sb.view().queue.length === 0, "pat hangs up → bob (first in line) takes WHICHEVER freed first: the Android phone");
want("pat", "ios"); await tick();
ok(got.pat === "pending", "pat now wants the iPhone specifically (bound) → waits even though… both are busy");
sb.release("bob"); await tick();
ok(got.pat === "pending" && sb.holding("bob") === null && sb.view().doors[1].holder === null, "the Android phone frees but pat is bound to the iPhone → keeps waiting; Android stays free");
want("krabs", null); await tick();
ok(got.krabs === "android", "krabs, no preference, arrives later → takes the free Android phone (does not jump pat for the iPhone)");
sb.release("squid"); await tick();
ok(got.pat === "ios" && sb.holding("pat") === "ios", "squid hangs up → pat gets the iPhone it waited for");
// Bound switch: a holder asking for the OTHER phone hands its own back.
want("krabs", "ios"); await tick();
ok(got.krabs === "pending" && sb.holding("krabs") === "android", "krabs (on Android) asks for the iPhone, which is busy → waits, still holding Android for now");
sb.release("pat"); await tick();
ok(got.krabs === "ios" && sb.holding("krabs") === "ios" && sb.view().doors[1].holder === null, "…iPhone frees → krabs switches to it and the Android phone is handed back (one phone per character)");
// Grace is per door and only when someone who could use THAT door waits.
want("squid", "android"); await tick();
ok(got.squid === "android", "a bound Android request takes the free Android door at once");
want("pat", null); await tick();
ok(got.pat === "pending", "pat (any) waits: both doors busy");
T += 599_000;
ok(sb.settle(T).length === 0, "599 s of silence: nobody is let go (grace is 600 s)");
T += 2_000;
let rels = sb.settle(T); await tick();
ok(rels.length === 1 && rels[0].id === "krabs" && rels[0].phone === "ios" && rels[0].reason === "grace", "601 s: the quiet iPhone holder is let go by grace (pat was waiting) — doors are checked iPhone first");
ok(got.pat === "ios", "…and pat, first in line with no preference, gets the iPhone (preference order), not the Android phone");
ok(sb.holding("squid") === "android", "squid, quiet on the Android phone, KEEPS it: nobody who could use it is waiting any more (grace needs a waiter)");
sb.begin("pat"); T += 2_000_000;
want("bob", null); await tick();
rels = sb.settle(T); await tick();
ok(rels.length === 2 && rels.every((r) => r.reason === "maxHold") && rels.some((r) => r.id === "pat") && rels.some((r) => r.id === "squid"), "33 min in: a phone command still running does not stop the 30-min cap — both long holders are let go (reason maxHold)");
ok(sb.holding("pat") === null && got.bob === "ios", "…the cap handed the iPhone to bob (first in line, iPhone first)");
// Abandon while queued.
want("squid", null); await tick(); // Android is free → takes it
want("krabs", "ios"); await tick();
ok(got.krabs === "pending", "krabs waits for the busy iPhone");
sb.abandon("krabs"); await tick();
ok(got.krabs === "left" && sb.view().queue.length === 0, "abandon(krabs) → 'left', out of the line");
sb.release("bob"); sb.release("squid");
ok(sb.isEmpty(), "everyone hung up → empty");
// Parallel tool calls from one character resolve together on one door.
const sb2 = new Switchboard(["ios", "android"], {}, nowB);
await sb2.claim("squid", null); await sb2.claim("pat", null);
const q1 = sb2.claim("bob", null), q2 = sb2.claim("bob", null);
sb2.release("squid");
const g1 = await q1, g2 = await q2;
ok(g1.r === "ok" && g2.r === "ok" && g1.phone === "ios" && g2.phone === "ios" && sb2.view().queue.length === 0, "two queued calls from one character both resolve on the same freed phone");
// A one-phone town behaves like the old single door.
const sb3 = new Switchboard(["ios"], {}, nowB);
await sb3.claim("squid", null);
const q3 = sb3.claim("pat", null); let r3 = "pending"; q3.then((g) => { r3 = g.phone; });
await tick();
ok(r3 === "pending", "one phone: the second comer waits");
sb3.release("squid"); await tick();
ok(r3 === "ios", "…and gets it when the holder hangs up");

console.log(fails ? `\n${fails} CHECK(S) FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
