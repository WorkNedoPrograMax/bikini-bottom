// Checks the PURE half of "Point at it" (Orca plan, Job 5b): wording a pick,
// composing the one follow-up message + attachments, HTML trimming and size
// caps — with a WEB-shaped pick (colour, font, radius, cssPath, html) AND a
// details-less pick (what a future simulator engine might send), so nothing
// assumes CSS fields exist. Run after `npm run build`:  node scripts/check-pointer.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../dist/main/adapters/pointer/compose.js");
const { hexOf, colorWord, capText, trimHtml, summarizePick, pickCard, composePicksMessage, pointedElementsJson, picksAttachments, duplicateIndex, cropRect, viewWord, MAX_PICKS, HTML_MAX, ELEMENTS_FILE } = C;
const { MAX_PICKS: IPC_MAX } = require("../dist/shared/ipc.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };

// ── the two shapes of pick ──
const web = {
  id: "p1", kind: "button", label: "Claim plan", rect: { x: 640, y: 388, w: 160, h: 44 }, image: "iVBORw0KGgo=", note: "make it full width",
  details: { tag: "button", cssPath: "#root > div.list > div.card:nth-of-type(1) > button.btn", background: "#e74c3c", color: "#ffffff", fontSize: "14px", fontWeight: "700", radius: "10px", html: '<button class="btn">Claim plan</button>' },
};
const webText = {
  id: "p2", kind: "text", label: "Kyiv · 3 runners · starts 12:00", rect: { x: 300, y: 340, w: 210.4, h: 17.6 }, image: null, note: "",
  details: { tag: "div", cssPath: "#root > div.card > div.meta", color: "#6b7284", fontSize: "13px", radius: "0px" },
};
const bare = { id: "s1", kind: "button", label: "Claim plan", rect: { x: 20, y: 500, w: 350, h: 48 }, image: "iVBORw0KGgo=", note: "", details: {} };
const sim = { id: "s2", kind: "label", label: "2 SPOTS LEFT", rect: { x: 40, y: 420, w: 90, h: 20 }, image: null, note: "colour is too loud", details: { class: "UILabel", accessibilityId: "plan_spots_badge" } };

console.log("colours:");
ok(hexOf("rgb(231, 76, 60)") === "#e74c3c", "rgb() → hex");
ok(hexOf("rgba(0, 0, 0, 0)") === null && hexOf("transparent") === null, "transparent → null");
ok(hexOf("#abc") === "#aabbcc" && hexOf("#E74C3C") === "#e74c3c" && hexOf("#11223300") === null, "short / upper / transparent-8 hex handled");
ok(colorWord("#e74c3c") === "red" && colorWord("#1c1f2a") === "near-black" && colorWord(null) === "", `colour words: ${colorWord("#e74c3c")}, ${colorWord("#1c1f2a")}`);

console.log("summarizePick — renders only what the engine knew:");
ok(summarizePick(web) === "button “Claim plan” 160×44, red #e74c3c, 14px, 10px corners", `web: ${summarizePick(web)}`);
ok(summarizePick(webText) === "text “Kyiv · 3 runners · starts 12:00” 210×18, text grey #6b7284, 13px", `text colour when no background: ${summarizePick(webText)}`);
ok(summarizePick(bare) === "button “Claim plan” 350×48", `no details → kind, label, size only: ${summarizePick(bare)}`);
ok(summarizePick(sim) === "label “2 SPOTS LEFT” 90×20, id plan_spots_badge, UILabel", `simulator-shaped details: ${summarizePick(sim)}`);
const longLabel = { ...bare, label: "A very long button label that goes on and on and on for ages" };
const ll = summarizePick(longLabel);
ok(/^button “A very long button label that goes on a…” 350×48$/.test(ll) && ll.indexOf("”") - ll.indexOf("“") <= 41, `a long label is cut at 40 in the summary (the JSON keeps it whole): ${ll}`);

console.log("pickCard — the tray's second line + swatch:");
ok(pickCard(web).summary === "160×44 · #e74c3c · 14px" && pickCard(web).swatch === "#e74c3c", `web card: ${pickCard(web).summary}`);
ok(pickCard(webText).swatch === "#6b7284", "text colour is the swatch when there is no background");
ok(pickCard(bare).summary === "350×48" && pickCard(bare).swatch === null, `bare card: ${pickCard(bare).summary} (no swatch)`);
ok(pickCard(sim).summary === "90×20 · id plan_spots_badge", `sim card: ${pickCard(sim).summary}`);
ok(pickCard(web).id === "p1" && pickCard(web).note === "make it full width", "a card keeps the pick's own fields");

console.log("composePicksMessage — the ONE follow-up:");
const ctx = { engine: "web", url: "http://localhost:3100/plans", view: "desktop", viewWidth: 1100 };
const msg = composePicksMessage([web, webText, bare], ctx);
ok(msg.startsWith("Maksym pointed at 3 things on http://localhost:3100/plans (1100px desktop view).\n\n"), "opening line: count, URL, view word");
ok(msg.includes("1) button “Claim plan” 160×44, red #e74c3c, 14px, 10px corners — Maksym: “make it full width” [picture 1]\n"), "a noted pick with a picture");
ok(msg.includes("2) text “Kyiv · 3 runners · starts 12:00” 210×18, text grey #6b7284, 13px — Maksym: no note, just look at it.\n"), "no note → 'just look at it'; no picture → no [picture]");
ok(msg.includes("3) button “Claim plan” 350×48 — Maksym: no note, just look at it. [picture 3]\n"), "a details-less pick reads fine");
ok(/tell me which file you touched\. The exact HTML and CSS of each is in pointed-elements\.json\.$/.test(msg), "ends with 'tell me which file you touched' + the JSON pointer (web)");
ok(!/<button|cssPath|#root/.test(msg), "HTML / CSS paths never go inline in the prompt");
ok(msg.length < 700, `stays short (${msg.length} chars)`);
const one = composePicksMessage([sim], { engine: "simulator", url: "ScoutRunner / PlansScreen", view: "phone", viewWidth: 390 });
ok(one.startsWith("Maksym pointed at one thing on ScoutRunner / PlansScreen (390px phone view)."), `one thing, phone: ${one.split("\n")[0]}`);
ok(/Everything else the pointer knew about each one is in pointed-elements\.json\.$/.test(one), "a non-web engine gets the neutral closing line");
ok(viewWord("phone", 0) === "390px phone view" && viewWord("desktop", 1024.6) === "1025px desktop view", "view words");

console.log("pointed-elements.json + attachments:");
const json = JSON.parse(pointedElementsJson([web, bare], ctx, Date.parse("2026-09-10T12:00:00Z")));
ok(Object.keys(json)[0] === "engine" && json.engine === "web", "`engine` comes first");
ok(json.url === ctx.url && json.view === "1100px desktop view" && json.pointedAt === "2026-09-10T12:00:00.000Z", "url, view, time");
ok(json.elements.length === 2 && json.elements[0].n === 1 && json.elements[0].details.html === '<button class="btn">Claim plan</button>' && json.elements[0].picture === "picture-1.png", "web element carries its html + picture name");
ok(json.elements[1].details && Object.keys(json.elements[1].details).length === 0 && json.elements[1].picture === "picture-2.png", "a details-less element is an empty bag, not a crash");
const atts = picksAttachments([web, webText, bare], ctx);
ok(atts.map((a) => a.name).join(",") === `picture-1.png,picture-3.png,${ELEMENTS_FILE}`, `attachments: ${atts.map((a) => a.name).join(", ")} (no picture for a pick without one)`);
ok(atts.every((a) => a.mediaType === (a.name.endsWith(".png") ? "image/png" : "application/json")), "media types");
ok(JSON.parse(Buffer.from(atts[2].data, "base64").toString("utf8")).engine === "web", "the JSON attachment round-trips");
ok(ELEMENTS_FILE === "pointed-elements.json", "named by what it holds");

console.log("trimHtml — ≤2 KB, no inline styles / handlers / data URIs:");
const raw = '<div   style="color:red; width: 100px"  onclick="go()" class="card"  data-x="1">\n   <img src="data:image/png;base64,AAAA…" alt="a">\n  <span>Text</span>\n</div>';
ok(trimHtml(raw) === '<div class="card" data-x="1"><img src="data:…" alt="a"><span>Text</span></div>', `trimmed: ${trimHtml(raw)}`);
const big = "<div>" + "<p class=\"x\">para</p>".repeat(400) + "</div>";
ok(trimHtml(big).length <= HTML_MAX && trimHtml(big).endsWith("…"), `a ${big.length}-char blob is cut to ≤${HTML_MAX}`);
const longAttr = `<a href="${"h".repeat(300)}">x</a>`;
ok(trimHtml(longAttr).length < 140 && trimHtml(longAttr).includes("…\">"), "a 300-char attribute value is shortened");
ok(trimHtml(null) === "" && trimHtml("") === "", "nothing → empty string");

console.log("caps + helpers:");
ok(MAX_PICKS === 5 && IPC_MAX === 5, "MAX_PICKS is 5 (compose and ipc agree)");
ok(capText("  hello   world  ") === "hello world" && capText("x".repeat(100)).length === 80 && capText("x".repeat(100)).endsWith("…"), "capText collapses + cuts at 80");
ok(duplicateIndex([web, webText], { rect: { x: 1, y: 1, w: 1, h: 1 }, details: { cssPath: web.details.cssPath } }) === 0, "same cssPath → duplicate of #1");
ok(duplicateIndex([bare], { rect: { x: 20.4, y: 499.6, w: 350, h: 48 }, details: {} }) === 0, "no paths → the very same box is a duplicate");
ok(duplicateIndex([web], { rect: web.rect, details: { cssPath: "#other" } }) === -1, "a different path at the same spot is a new pick");
ok(duplicateIndex([sim], { rect: { x: 0, y: 0, w: 1, h: 1 }, details: { accessibilityId: "plan_spots_badge" } }) === 0, "simulator: same accessibility id → duplicate");
const cr = cropRect({ x: 640, y: 388, w: 160, h: 44 }, 1100, 700);
ok(cr.x === 624 && cr.y === 372 && cr.width === 192 && cr.height === 76, `crop = element + 16 px: ${JSON.stringify(cr)}`);
const edge = cropRect({ x: 2, y: 690, w: 300, h: 40 }, 1100, 700);
ok(edge.x === 0 && edge.y === 674 && edge.width === 318 && edge.height === 26, `crop clamps to the view: ${JSON.stringify(edge)}`);
ok(cropRect({ x: -5, y: -5, w: 0, h: 0 }, 0, 0).width >= 1, "never an empty crop");

console.log(fails ? `\n${fails} CHECK(S) FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
