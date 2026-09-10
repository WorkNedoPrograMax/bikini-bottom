// The PURE half of "Point at it": wording a Pick for the tray and composing the
// one follow-up message + attachments a character receives. No Electron, no
// engine knowledge — it renders only what a Pick's `details` actually carry, so
// a web pick (colour, font, radius, html) and a simulator pick (class,
// accessibility id) both read well. Checked by scripts/check-pointer.mjs.

import { MAX_PICKS, type Attachment, type Pick, type PickCard, type PickRect, type PointerKind } from "../../../shared/ipc";

export { MAX_PICKS };
/** The trimmed outerHTML kept per pick — HTML/CSS never go inline in the prompt,
 *  only into pointed-elements.json, so this cap keeps that file small too. */
export const HTML_MAX = 2048;
export const LABEL_MAX = 80;
export const IMAGE_MAX_WIDTH = 400;
export const CROP_PAD = 16;
export const ELEMENTS_FILE = "pointed-elements.json";

/** The context a message is composed in. `viewWidth` is the shown width in CSS px. */
export interface ComposeContext {
  engine: PointerKind;
  url: string;
  view: "desktop" | "phone";
  viewWidth: number;
}

// ── colours ───────────────────────────────────────────────────────────────
const NAMES: [string, string][] = [
  ["red", "#e74c3c"], ["coral", "#ff5a3c"], ["orange", "#f39c12"], ["yellow", "#f7b500"], ["green", "#1f7a3f"],
  ["mint", "#eaf6ee"], ["teal", "#4fb0a0"], ["blue", "#3b82f6"], ["navy", "#11303e"], ["purple", "#8e44ad"],
  ["pink", "#f072a6"], ["light grey", "#eef0f6"], ["grey", "#8a90a3"], ["dark grey", "#3b4252"], ["near-black", "#1c1f2a"],
  ["white", "#ffffff"], ["cream", "#fffaf0"], ["brown", "#8a5a2c"],
];

/** "rgb(231, 76, 60)" / "rgba(…)" / "#abc" → "#e74c3c"; transparent or unreadable → null. */
export function hexOf(c: string | null | undefined): string | null {
  if (!c) return null;
  const s = String(c).trim().toLowerCase();
  if (s === "transparent") return null;
  const hx = s.match(/^#([0-9a-f]{3,8})$/);
  if (hx) {
    const h = hx[1];
    if (h.length === 3 || h.length === 4) return "#" + h.slice(0, 3).split("").map((ch) => ch + ch).join("");
    if (h.length === 8 && h.slice(6) === "00") return null;
    return "#" + h.slice(0, 6);
  }
  const m = s.match(/-?\d+(\.\d+)?/g);
  if (!m || m.length < 3) return null;
  if (m.length > 3 && parseFloat(m[3]) === 0) return null; // fully transparent
  return "#" + m.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(+v))).toString(16).padStart(2, "0")).join("");
}

/** The nearest plain colour word for a hex ("red", "light grey", "near-black"). */
export function colorWord(hex: string | null): string {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return "";
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
  const [r, g, b] = rgb(hex);
  let best = "", d = Infinity;
  for (const [name, c] of NAMES) {
    const [R, G, B] = rgb(c);
    const dd = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
    if (dd < d) { d = dd; best = name; }
  }
  return best;
}

// ── text ──────────────────────────────────────────────────────────────────
/** One line, whitespace collapsed, cut at `max` with an ellipsis. */
export function capText(s: string | null | undefined, max: number = LABEL_MAX): string {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** Trim an element's outerHTML for pointed-elements.json: drop inline styles,
 *  event handlers and data: URIs, shorten long attribute values, collapse
 *  whitespace, cap at `max` chars. */
export function trimHtml(html: string | null | undefined, max: number = HTML_MAX): string {
  let s = String(html || "");
  s = s.replace(/\s(?:style|on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/\s(src|href|xlink:href)\s*=\s*"data:[^"]*"/gi, ' $1="data:…"');
  s = s.replace(/\s(src|href|xlink:href)\s*=\s*'data:[^']*'/gi, " $1='data:…'");
  s = s.replace(/=("|')([^"']{120,})\1/g, (_m, q, v) => `=${q}${v.slice(0, 117)}…${q}`);
  s = s.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** "160×44" */
export function sizeWord(r: PickRect): string { return `${Math.round(r.w)}×${Math.round(r.h)}`; }

/** "red #e74c3c" (background) or "text near-black #1c1f2a" — null when the engine gave no colour. */
export function colourPhrase(details: Record<string, string>): string | null {
  const bg = hexOf(details.background), fg = hexOf(details.color);
  if (bg) return `${colorWord(bg)} ${bg}`.trim();
  if (fg) return `text ${colorWord(fg)} ${fg}`.replace(/\s+/g, " ").trim();
  return null;
}

/** The extras after the size, in order, only those the engine knew:
 *  colour · font size · corners · (anything else worth a word). */
function extras(p: Pick): string[] {
  const d = p.details || {};
  const out: string[] = [];
  const col = colourPhrase(d); if (col) out.push(col);
  if (d.fontSize) out.push(String(d.fontSize).replace(/(\.\d+)?px$/, "px"));
  const rad = parseFloat(d.radius || ""); if (rad > 0) out.push(`${Math.round(rad)}px corners`);
  if (d.accessibilityId) out.push(`id ${d.accessibilityId}`);
  if (d.class && !d.cssPath) out.push(String(d.class));
  return out;
}

/** Labels longer than this are cut in the composed message (the JSON keeps them whole). */
export const SUMMARY_LABEL_MAX = 40;

/** Full one-liner for the message: `button “Claim plan” 160×44, red #e74c3c, 14px, 10px corners`. */
export function summarizePick(p: Pick): string {
  const head = [p.kind, p.label ? `“${capText(p.label, SUMMARY_LABEL_MAX)}”` : null, sizeWord(p.rect)].filter(Boolean).join(" ");
  const ex = extras(p);
  return ex.length ? `${head}, ${ex.join(", ")}` : head;
}

/** The tray card's second line (`160×44 · #e74c3c · 14px`) + its swatch. */
export function pickCard(p: Pick): PickCard {
  const d = p.details || {};
  const swatch = hexOf(d.background) || hexOf(d.color) || null;
  const parts = [sizeWord(p.rect)];
  if (swatch) parts.push(swatch);
  if (d.fontSize) parts.push(String(d.fontSize).replace(/(\.\d+)?px$/, "px"));
  if (!swatch && !d.fontSize) { if (d.accessibilityId) parts.push(`id ${d.accessibilityId}`); else if (d.class) parts.push(String(d.class)); }
  return { ...p, summary: parts.join(" · "), swatch };
}

/** "1100px desktop view" / "390px phone view". */
export function viewWord(view: "desktop" | "phone", width: number): string {
  return `${Math.round(width) || (view === "phone" ? 390 : 0)}px ${view} view`;
}

/** The ONE follow-up a character gets. Short on purpose: pictures go inline as
 *  attachments, HTML/CSS go into pointed-elements.json, never into the prompt. */
export function composePicksMessage(picks: Pick[], ctx: ComposeContext): string {
  const n = picks.length;
  let out = `Maksym pointed at ${n === 1 ? "one thing" : `${n} things`} on ${ctx.url} (${viewWord(ctx.view, ctx.viewWidth)}).\n\n`;
  picks.forEach((p, i) => {
    const note = (p.note || "").trim();
    out += `${i + 1}) ${summarizePick(p)} — ${note ? `Maksym: “${note}”` : "Maksym: no note, just look at it."}`;
    if (p.image) out += ` [picture ${i + 1}]`;
    out += "\n";
  });
  const tail = ctx.engine === "web"
    ? `The exact HTML and CSS of each is in ${ELEMENTS_FILE}.`
    : `Everything else the pointer knew about each one is in ${ELEMENTS_FILE}.`;
  out += `\nTreat these as the design brief. Find each one in this lane's code, make the change, and tell me which file you touched. ${tail}`;
  return out;
}

/** pointed-elements.json — named by what it holds; `engine` first so the
 *  character knows what kind of details to expect. */
export function pointedElementsJson(picks: Pick[], ctx: ComposeContext, when: number = Date.now()): string {
  return JSON.stringify({
    engine: ctx.engine,
    url: ctx.url,
    view: viewWord(ctx.view, ctx.viewWidth),
    pointedAt: new Date(when).toISOString(),
    elements: picks.map((p, i) => ({
      n: i + 1, kind: p.kind, label: p.label, rect: p.rect, note: p.note || "",
      picture: p.image ? `picture-${i + 1}.png` : null,
      details: p.details || {},
    })),
  }, null, 2);
}

/** Each picture inline (PNG) + one JSON file (saved into the lane, path handed over). */
export function picksAttachments(picks: Pick[], ctx: ComposeContext, when: number = Date.now()): Attachment[] {
  const out: Attachment[] = [];
  picks.forEach((p, i) => { if (p.image) out.push({ name: `picture-${i + 1}.png`, mediaType: "image/png", data: p.image }); });
  out.push({ name: ELEMENTS_FILE, mediaType: "application/json", data: Buffer.from(pointedElementsJson(picks, ctx, when), "utf8").toString("base64") });
  return out;
}

/** Index of an existing pick that is the same element (same engine path, else
 *  the very same box), or -1. */
export function duplicateIndex(existing: Pick[], raw: { rect: PickRect; details: Record<string, string> }): number {
  const key = raw.details?.cssPath || raw.details?.accessibilityId || "";
  return existing.findIndex((p) => {
    const k = p.details?.cssPath || p.details?.accessibilityId || "";
    if (key && k) return key === k;
    const a = p.rect, b = raw.rect;
    return Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y) && Math.round(a.w) === Math.round(b.w) && Math.round(a.h) === Math.round(b.h);
  });
}

/** The crop box for a screenshot: the element padded by 16 px, clamped to the
 *  view; integers, never empty. */
export function cropRect(r: PickRect, viewW: number, viewH: number, pad: number = CROP_PAD): { x: number; y: number; width: number; height: number } {
  const x0 = Math.max(0, Math.floor(r.x - pad)), y0 = Math.max(0, Math.floor(r.y - pad));
  const x1 = Math.min(Math.max(1, viewW), Math.ceil(r.x + r.w + pad)), y1 = Math.min(Math.max(1, viewH), Math.ceil(r.y + r.h + pad));
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}
