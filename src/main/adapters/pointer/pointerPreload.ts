// Preload for the WEB engine of "Point at it". Runs inside the lane's own page
// (a WebContentsView), isolated from the page's scripts. When ARMED it draws a
// hover outline with a plain kind word, swallows clicks and reports what was
// under the mouse; when off, the page works as usual. Numbered pins mark what
// is already in the tray. Self-contained on purpose: sandboxed preloads may only
// `require("electron")`, so nothing here imports the rest of the app.
//
// Wire: renderer(page) --pointer:pick {…}--> main   ·   main --pointer:arm on-->
//       --pointer:pins [{id,n}]-->   ·   page --pointer:escape-->

(() => {
  const { ipcRenderer } = require("electron");

  const Z = "2147483647";
  let armed = false;
  let layer: HTMLDivElement | null = null, hl: HTMLDivElement | null = null, lab: HTMLDivElement | null = null, pinsEl: HTMLDivElement | null = null;
  const picked = new Map<string, Element>(); // pick id → the element (for pins)
  let pins: { id: string; n: number }[] = [];
  let seq = 0;

  const css = (e: HTMLElement, st: Record<string, string>) => { for (const k of Object.keys(st)) (e.style as any)[k] = st[k]; };

  function ensureLayer(): void {
    if (layer || !document.body) return;
    layer = document.createElement("div");
    layer.setAttribute("data-bikini-pointer", "");
    css(layer, { position: "fixed", inset: "0", zIndex: Z, pointerEvents: "none", display: armed ? "block" : "none" });
    hl = document.createElement("div");
    css(hl, { position: "fixed", display: "none", border: "2px solid #ff5a3c", borderRadius: "4px", boxSizing: "border-box",
      boxShadow: "0 0 0 2px rgba(255,255,255,.7), 0 0 0 9999px rgba(4,34,47,.10)", pointerEvents: "none" });
    lab = document.createElement("div");
    css(lab, { position: "absolute", left: "-2px", top: "-22px", background: "#ff5a3c", color: "#fff", fontFamily: '"Chalkboard SE","Comic Sans MS",ui-rounded,system-ui,sans-serif',
      fontSize: "11px", lineHeight: "16px", padding: "2px 7px", borderRadius: "6px 6px 6px 0", whiteSpace: "nowrap", boxShadow: "0 2px 4px rgba(0,0,0,.3)" });
    hl.appendChild(lab);
    pinsEl = document.createElement("div");
    layer.appendChild(pinsEl); layer.appendChild(hl);
    document.body.appendChild(layer);
  }

  // ── plain words for what got clicked ──
  function kindOf(el: Element): string {
    const t = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    const cls = (typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "").toLowerCase();
    if (t === "button" || role === "button" || (t === "input" && /^(button|submit|reset)$/.test((el as HTMLInputElement).type)) || /\b(btn|button)\b/.test(cls)) return "button";
    if (t === "a" && el.hasAttribute("href")) return "link";
    if (/^h[1-6]$/.test(t) || role === "heading") return "heading";
    if (t === "img" || t === "svg" || t === "picture" || t === "video" || t === "canvas" || role === "img" || /\b(avatar|logo|icon)\b/.test(cls)) return "picture";
    if (t === "input" || t === "textarea" || t === "select" || (el as HTMLElement).isContentEditable || role === "textbox" || role === "combobox" || role === "searchbox") return "field";
    if (role === "tab" || (t === "li" && el.closest("nav, [role=tablist]"))) return "tab";
    if (role === "tablist" || t === "nav" || role === "navigation" || role === "toolbar" || /\b(tabs|tabbar|navbar|toolbar|segment(ed)?)\b/.test(cls)) return "bar";
    if (/\b(card|tile|panel)\b/.test(cls) || t === "article") return "card";
    if (/\b(tag|badge|chip|pill|label)\b/.test(cls) || t === "label") return "label";
    const parentCls = (el.parentElement && typeof (el.parentElement as HTMLElement).className === "string" ? (el.parentElement as HTMLElement).className : "").toLowerCase();
    if ((t === "span" || t === "div" || t === "a") && (el.closest("[role=tablist], nav") || /\b(seg|segmented?|tabs?|tabbar|switcher)\b/.test(parentCls))) return "tab";
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim());
    return hasText ? "text" : "box";
  }

  function labelOf(el: Element, cs: CSSStyleDeclaration): string {
    let text = "";
    const t = el.tagName.toLowerCase();
    if (t === "input" || t === "textarea") text = (el as HTMLInputElement).placeholder || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "";
    else if (t === "img") text = (el as HTMLImageElement).alt || el.getAttribute("aria-label") || "";
    else if (t === "select") text = ((el as HTMLSelectElement).selectedOptions[0]?.textContent) || "";
    else text = el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.textContent || "";
    text = text.replace(/\s+/g, " ").trim();
    if (cs.textTransform === "uppercase") text = text.toUpperCase();
    return text.length > 80 ? text.slice(0, 79) + "…" : text;
  }

  // A short, mostly-unique CSS path: #id when it exists, else tag.class:nth-of-type up 4 levels.
  function cssPath(el: Element): string {
    const parts: string[] = [];
    let e: Element | null = el;
    while (e && e !== document.documentElement && parts.length < 5) {
      if (e.id && document.querySelectorAll("#" + CSS.escape(e.id)).length === 1) { parts.unshift("#" + e.id); break; }
      let sel = e.tagName.toLowerCase();
      const cls = (typeof (e as HTMLElement).className === "string" ? (e as HTMLElement).className : "").split(/\s+/).filter((c) => c && !/^[a-z]+-?\d{3,}|^css-|^sc-|^_/.test(c)).slice(0, 2);
      if (cls.length) sel += "." + cls.map((c) => CSS.escape(c)).join(".");
      const parent: Element | null = e.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === e!.tagName);
        if (same.length > 1) sel += `:nth-of-type(${same.indexOf(e) + 1})`;
      }
      parts.unshift(sel);
      e = parent;
    }
    return parts.join(" > ");
  }

  const rectOf = (el: Element) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };

  function targetOf(e: Event): Element | null {
    const el = e.target as Element | null;
    if (!el || !(el instanceof Element)) return null;
    if (el === document.documentElement || el === document.body) return null;
    if (layer && layer.contains(el)) return null;
    return el;
  }

  // ── hover outline ──
  function onMove(e: MouseEvent): void {
    if (!armed || !hl || !lab) return;
    const el = targetOf(e);
    if (!el) { hl.style.display = "none"; return; }
    const r = rectOf(el);
    css(hl, { display: "block", left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
    const low = r.y < 34;
    css(lab, { top: low ? "auto" : "-22px", bottom: low ? "-22px" : "auto", borderRadius: low ? "0 6px 6px 6px" : "6px 6px 6px 0" });
    lab.textContent = kindOf(el);
  }

  // ── a click becomes a pick ──
  function onClick(e: MouseEvent): void {
    if (!armed) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const el = targetOf(e);
    if (!el) return;
    const cs = getComputedStyle(el);
    const id = `p${Date.now().toString(36)}${(seq++).toString(36)}`;
    const data = {
      id, kind: kindOf(el), label: labelOf(el, cs), rect: rectOf(el),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      tag: el.tagName.toLowerCase(),
      cssPath: cssPath(el),
      html: el.outerHTML.slice(0, 8192),
      computed: {
        color: cs.color, background: cs.backgroundColor, fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight, margin: cs.margin, padding: cs.padding, radius: cs.borderTopLeftRadius, display: cs.display,
        width: cs.width, height: cs.height,
      },
    };
    picked.set(id, el);
    // Hide our own chrome before main photographs the spot, then hand it over.
    // (A plain timer backs up the frame callbacks: a page that isn't painting
    // right now must still deliver the pick.)
    if (layer) layer.style.display = "none";
    let sent = false;
    const go = () => { if (sent) return; sent = true; ipcRenderer.send("pointer:pick", data); };
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(go, 40)));
    setTimeout(go, 250);
  }
  const swallow = (e: Event) => { if (armed) { e.preventDefault(); e.stopImmediatePropagation(); } };

  // ── numbered pins for what is already in the tray ──
  let pinRaf = 0;
  function layoutPins(): void {
    pinRaf = 0;
    if (!pinsEl) return;
    pinsEl.replaceChildren();
    for (const p of pins) {
      const el = picked.get(p.id);
      if (!el || !el.isConnected) continue;
      const r = rectOf(el);
      if (!r.w && !r.h) continue;
      const d = document.createElement("div");
      css(d, { position: "fixed", left: (r.x - 3) + "px", top: (r.y - 3) + "px", width: (r.w + 6) + "px", height: (r.h + 6) + "px", boxSizing: "border-box",
        border: "2px dashed #ff5a3c", borderRadius: "4px", pointerEvents: "none" });
      const b = document.createElement("div");
      css(b, { position: "absolute", right: "-10px", top: "-10px", width: "22px", height: "22px", borderRadius: "50%", background: "#ff5a3c", color: "#fff",
        border: "2px solid #fff", fontFamily: '"Marker Felt","Chalkboard SE",ui-rounded,system-ui,sans-serif', fontSize: "13px", lineHeight: "18px",
        textAlign: "center", boxShadow: "0 2px 5px rgba(0,0,0,.4)", boxSizing: "border-box" });
      b.textContent = String(p.n);
      d.appendChild(b);
      pinsEl.appendChild(d);
    }
  }
  const schedulePins = () => { if (!pinRaf) pinRaf = requestAnimationFrame(layoutPins); };

  function setArmed(on: boolean): void {
    armed = on;
    ensureLayer();
    if (layer) layer.style.display = on || pins.length ? "block" : "none";
    if (hl && !on) hl.style.display = "none";
    if (document.documentElement) document.documentElement.style.cursor = on ? "crosshair" : "";
  }

  ipcRenderer.on("pointer:arm", (_e: unknown, on: boolean) => setArmed(!!on));
  ipcRenderer.on("pointer:pins", (_e: unknown, list: { id: string; n: number }[]) => {
    pins = Array.isArray(list) ? list : [];
    const keep = new Set(pins.map((p) => p.id));
    for (const id of Array.from(picked.keys())) if (!keep.has(id)) picked.delete(id);
    ensureLayer();
    if (layer) layer.style.display = armed || pins.length ? "block" : "none";
    layoutPins();
  });

  const install = () => {
    ensureLayer();
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseleave", () => { if (hl) hl.style.display = "none"; }, true);
    document.addEventListener("click", onClick, true);
    for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "contextmenu", "auxclick"]) document.addEventListener(t, swallow, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") ipcRenderer.send("pointer:escape"); }, true);
    window.addEventListener("scroll", schedulePins, true);
    window.addEventListener("resize", schedulePins);
    setArmed(armed);
    ipcRenderer.send("pointer:ready");
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
