---
title: Bikini Bottom — DESIGN.md
status: final
created: 2026-07-12
updated: 2026-07-12
name: Bikini Bottom
description: Cozy SpongeBob-town skin for Claude Code — hand-painted diner warmth over deep-sea night, captured verbatim from the binding mockup (mockup/bikini-town.html).
colors:
  coral: '#ff5a3c'
  deep-sea: '#04222f'
  paper-top: '#f3dfa2'
  paper-mid: '#eed490'
  paper-bottom: '#e6c67a'
  paper-ink: '#241d0e'
  paper-sub: '#7a5c26'
  leader-ink: '#2a2213'
  title-red: '#8c1e12'
  wood-button: '#c98a4e'
  wood-button-border: '#7d4a1e'
  wood-button-shadow: '#6d3f19'
  wood-button-text: '#fff6e6'
  frame-wood: '#8a5a2c'
  frame-wood-dark: '#5d3a15'
  parchment: '#f6e6b8'
  parchment-stripe: '#f0dca4'
  bubble-you: '#bfe4f2'
  bubble-you-ink: '#11303e'
  bubble-you-border: '#23485c'
  bubble-them: '#fffaf0'
  bubble-them-ink: '#241d0e'
  bubble-them-border: '#3a2c14'
  input-bar: '#e6cd92'
  input-bar-border: '#c9a95e'
  speech-white: '#fffdf5'
  speech-ink: '#0d3746'
  caption-glow: '#cdeff7'
  accent-spongebob: '#f7b500'
  accent-squidward: '#4fb0a0'
  accent-patrick: '#f072a6'
  accent-sandy: '#8a6d3b'
  accent-krabs: '#c0392b'
  status-waiting: '#8c1e12'
  status-cooking: '#6b4a12'
  status-served: '#2e5c2a'
  status-burned: '#3a3a3a'
  status-scrapped: '#7a6a55'
  status-sent-back: '#7a6a55'
  harbor-blue: '#20455a'
typography:
  display:
    fontFamily: '"Chalkboard SE", "Comic Sans MS", ui-rounded, system-ui, sans-serif'
  painted:
    fontFamily: '"Marker Felt", "Chalkboard SE", ui-rounded, system-ui, sans-serif'
  body:
    fontFamily: 'ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif'
  menu-title:
    fontFamily: '"Marker Felt", "Chalkboard SE"'
    fontSize: 40px
    lineHeight: '1'
    letterSpacing: 1px
  menu-line:
    fontSize: 18px
    fontWeight: '700'
    letterSpacing: 0.4px
  menu-status:
    fontSize: 15px
    letterSpacing: 0.8px
  header-name:
    fontFamily: '"Marker Felt", "Chalkboard SE"'
    fontSize: 22px
    lineHeight: '1.1'
    letterSpacing: 0.5px
  chat:
    fontSize: 14px
    lineHeight: '1.45'
  bubble-tag:
    fontSize: 11px
    letterSpacing: 0.6px
  street-label:
    fontSize: 'clamp(10px, 1.3vw, 14px)'
rounded:
  sm: 4px
  md: 12px
  lg: 14px
  xl: 16px
  frame: 20px
  paper: 7px 10px 6px 9px
  full: 9999px
spacing:
  '1': 4px
  '2': 8px
  '3': 11px
  '4': 16px
  '5': 24px
components:
  actor:
    image-height: 'clamp(64px, 9vw, 120px)'
    emoji-size: 'clamp(26px, 3.4vw, 46px)'
    shadow: 'drop-shadow(0 4px 5px rgba(0,0,0,.5))'
    hover-scale: '1.12'
    label-color: '#ffffff'
  unseen-dot:
    size: 15px
    fill: '{colors.coral}'
    border: '2px solid #ffffff'
    glow: '0 0 10px {colors.coral}'
  speech-bubble:
    fill: '{colors.speech-white}'
    ink: '{colors.speech-ink}'
    radius: '{rounded.md}'
  top-button:
    fill: '{colors.wood-button}'
    ink: '{colors.wood-button-text}'
    border: '3px solid {colors.wood-button-border}'
    radius: '{rounded.md}'
    shadow: '0 4px 0 {colors.wood-button-shadow}'
    font: '{typography.display.fontFamily}'
  orders-board:
    paper: 'linear-gradient(178deg, {colors.paper-top}, {colors.paper-mid} 60%, {colors.paper-bottom})'
    radius: '{rounded.paper}'
    tilt: '-1.6deg'
    title-ink: '{colors.title-red}'
    line-ink: '{colors.paper-ink}'
    leader: '3px dotted {colors.leader-ink}'
    width: 'min(92%, 410px)'
  work-window:
    frame: '8px solid {colors.frame-wood}'
    outline: '3px solid {colors.frame-wood-dark}'
    radius: '{rounded.frame}'
    wall: '{colors.parchment}'
    wall-stripe: '{colors.parchment-stripe}'
    width: 'min(94%, 520px)'
    header-fill: 'per-Character accent'
  chat-bubble-you:
    fill: '{colors.bubble-you}'
    ink: '{colors.bubble-you-ink}'
    border: '2px solid {colors.bubble-you-border}'
    radius: '{rounded.xl}'
    tail-radius: '{rounded.sm}'
  chat-bubble-them:
    fill: '{colors.bubble-them}'
    ink: '{colors.bubble-them-ink}'
    border: '2px solid {colors.bubble-them-border}'
    radius: '{rounded.xl}'
    tail-radius: '{rounded.sm}'
  input-bar:
    fill: '{colors.input-bar}'
    top-border: '3px solid {colors.input-bar-border}'
    field-border: '2px solid {colors.frame-wood}'
    field-fill: '{colors.bubble-them}'
    radius: '{rounded.lg}'
  action-button:
    fill: 'per-Character accent'
    ink: '#ffffff'
    border: '2px solid rgba(0,0,0,.3)'
    radius: '{rounded.lg}'
    shadow: '0 3px 0 rgba(0,0,0,.25)'
    font: '{typography.painted.fontFamily}'
  chat-choice-button:
    fill: '{colors.wood-button}'
    ink: '{colors.wood-button-text}'
    border: '2px solid {colors.wood-button-border}'
    radius: '{rounded.lg}'
    shadow: '0 3px 0 {colors.wood-button-shadow}'
    font: '{typography.painted.fontFamily}'
---

## Brand & Style

Bikini Bottom looks like a hand-painted children's-show diner, not a developer tool. The binding visual reference is [mockup/bikini-town.html](../../../../mockup/bikini-town.html) — this document captures it; it does not reinterpret it. Four scene mocks illustrate single flows: [mock-handout.html](mockups/mock-handout.html) (Character picker), [mock-firstrun.html](mockups/mock-firstrun.html) (First Run), [mock-burned.html](mockups/mock-burned.html) (BURNED order + board line), [mock-sendback.html](mockups/mock-sendback.html) (serve + Send it back). **The spines win on conflict with any mock or import.** Three materials carry the whole world: **deep-sea night** ({colors.deep-sea}) as the page behind everything, **sun-bleached paper and parchment** for anything Maksym reads, and **rough-cut wood** for anything Maksym presses. Type is chalk and marker, never monospace. Every picture and sound is Maksym's own file in an Asset Slot; the app draws frames, paper, and wood around them and nothing else.

The anti-references are terminals, IDEs, and dashboards. If a surface could be mistaken for one — monospace columns, status pills, sidebars of file names — it is wrong, whatever else it gets right.

## Colors

- **Deep Sea ({colors.deep-sea})** — the page background around the Town scene and the tint of every overlay scrim (`rgba(4,25,34,.55)` behind the Orders Board, `.62` behind Work Windows). The world floats on it; nothing else uses it.
- **Coral ({colors.coral})** — the Unseen Dot, exclusively. It is the only alarm color on the street and must never be diluted by decorative use elsewhere.
- **Galley paper ({colors.paper-top} → {colors.paper-mid} 60% → {colors.paper-bottom}, 178deg)** — the Orders Board menu, with {colors.paper-ink} for job lines, {colors.paper-sub} for the small subtitle, and {colors.leader-ink} for the dotted leaders.
- **Title Red ({colors.title-red})** — the hand-painted "Today's Orders" title (with `text-shadow: 1px 2px 0 rgba(60,10,5,.25)`) and the WAITING status. Red on this menu means "needs a human," matching the mockup's usage.
- **Board statuses** — WAITING {colors.status-waiting} (red), COOKING {colors.status-cooking} (brown), SERVED {colors.status-served} (green), BURNED {colors.status-burned} (charcoal — [ASSUMPTION]: the mockup has no BURNED style; ~#3a3a3a reads as "charred" against the paper without clashing with {colors.title-red}), and the retired pair SCRAPPED {colors.status-scrapped} (cancelled or scrapped orders) and SENT BACK {colors.status-sent-back} (undone orders) — one shared muted gray-brown, faded-pencil ink [ASSUMPTION: no mockup style; #7a6a55 reads as yesterday's writing against the paper]. {colors.harbor-blue} is the mockup's spare deep-blue status ink (`s-new`); it is kept as a token but unassigned in v1.
- **Wood ({colors.wood-button} / {colors.wood-button-border} / {colors.wood-button-shadow})** — pressable planks: the 📋 Orders button and any street-level control. {colors.frame-wood} / {colors.frame-wood-dark} are the darker timbers of the Work Window frame and input-field borders.
- **Parchment ({colors.parchment}, striped every 24px with {colors.parchment-stripe})** — the Work Window's inner wall.
- **Chat inks** — Maksym's bubbles: {colors.bubble-you} on {colors.bubble-you-ink} with a {colors.bubble-you-border} outline. Character bubbles: {colors.bubble-them} on {colors.bubble-them-ink} with {colors.bubble-them-border}. The cartoon outline (2px, dark) is what keeps bubbles feeling drawn, not rendered.
- **Per-Character accents** — SpongeBob {colors.accent-spongebob}, Squidward {colors.accent-squidward}, Patrick {colors.accent-patrick}, Sandy {colors.accent-sandy}, Mr. Krabs {colors.accent-krabs}. Used for the Work Window header, the input focus ring, that Character's input-bar send button, and the picker chip's selected ring — nowhere on the street itself, and never on in-bubble choice buttons (those are wood).
- **Speech White ({colors.speech-white} / {colors.speech-ink})** — the nudging street speech bubble. **Caption Glow ({colors.caption-glow})** — small helper text on the deep-sea background.
- **Contrast** — load-bearing text/background pairs target ≥4.5:1 where the hand-drawn style allows [ASSUMPTION: single known user; formal WCAG audit out of scope].

## Typography

Three families, straight from the mockup:

- **Display ({typography.display.fontFamily})** — Chalkboard SE: street labels, wooden-button labels. The chalk voice of the street.
- **Painted ({typography.painted.fontFamily})** — Marker Felt: the Orders Board (title {typography.menu-title.fontSize}, lines {typography.menu-line.fontSize} bold, statuses {typography.menu-status.fontSize} uppercase), Work Window header names ({typography.header-name.fontSize}), bubble sender tags ({typography.bubble-tag.fontSize} uppercase), and action-button labels. The hand-painted diner voice.
- **Body ({typography.body.fontFamily})** — SF Pro Rounded / ui-rounded: chat text ({typography.chat.fontSize}, line-height {typography.chat.lineHeight}), input fields, street speech bubbles. Warm, round, and readable — never monospace, anywhere.

Street labels ("Patrick · working…") are {typography.street-label.fontSize} Display in white with `text-shadow: 0 1px 5px rgba(0,0,0,.9)`. Board lines get a hand-set feel: odd lines rotate −0.4°, even +0.35°; the title rotates −1°.

## Layout & Spacing

One main window. The Town scene is a single image-proportioned block, max-width **1100px**, corners {rounded.lg}, centered on {colors.deep-sea} with ~14px page padding. Actors sit at absolute percentage positions over the background (from the mockup: Patrick 16%/74%, Sandy 31%/79%, Squidward 47%/76%, Mr. Krabs 63%/79%, SpongeBob 80%/74%), each anchored by `translate(-50%,-50%)`; labels hang 4px below, speech bubbles float above (bottom 118%).

Overlays center inside the scene: the Orders Board easel at `min(92%, 410px)` rotated −1.6°, paper padded {spacing.5} (24px 26px 26px); the Work Window at `min(94%, 520px)`, max-height 88%. Chat bubbles cap at 82% width, padded 9px 14px, stacked with {spacing.3} gaps inside a {spacing.4}-padded conversation. Wooden top buttons pin 14px from the scene corners (📋 Orders top-right).

## Elevation & Depth

Depth is theatrical, not material-design. Big soft drops lift whole set pieces off the deep sea: the scene (`0 20px 50px rgba(0,0,0,.5)`), the menu paper (`0 18px 44px rgba(0,0,0,.55)` plus an aging `inset 0 0 70px rgba(150,110,40,.28)`), the Work Window (`0 24px 60px rgba(0,0,0,.6)`). Actors get a `drop-shadow(0 4px 5px rgba(0,0,0,.5))`; street bubbles `0 5px 12px rgba(0,0,0,.4)`.

Pressables use **hard offset shadows** — wood, not glass: top buttons `0 4px 0 {colors.wood-button-shadow}`, in-bubble choice buttons `0 3px 0 {colors.wood-button-shadow}`, the send action button `0 3px 0 rgba(0,0,0,.25)`. The Unseen Dot glows: `0 0 10px {colors.coral}`. No blur-heavy hover halos, no translucency-as-hierarchy.

## Shapes

Nothing is a perfect rectangle and nothing is a pill. Corners: {rounded.sm} for chat-bubble tails (the flattened corner that points at the speaker), {rounded.md} for wooden buttons and street bubbles, {rounded.lg} for the scene, inputs, and action buttons, {rounded.xl} for chat bubbles, {rounded.frame} for the Work Window frame. The menu paper is deliberately hand-cut: {rounded.paper} — four different corner radii so it reads as torn paper. The Unseen Dot and the close button are {rounded.full} circles. The board paper carries two nail heads (12px radial-gradient circles, #9a9a9a → #3c3c3c) at its top corners; small crooked rotations (board −1.6°, title −1°, lines ±0.4°) are part of the shape language.

## Components

- **Town scene** — the background Asset Slot image fills the block (opacity transitions 0.3s if swapped); actors, top buttons, and overlays are absolutely positioned children. No chrome beyond the wooden buttons.
- **Actor** — Asset Slot picture at {components.actor.image-height} (or emoji stand-in at {components.actor.emoji-size}), {components.actor.shadow}, hover scales to {components.actor.hover-scale}. Below: the street label in Display. Above, when Calling: the speech bubble ({components.speech-bubble.fill} on {components.speech-bubble.ink}, {rounded.md}, 7px triangle tail) animating `nudge` (1s, ±3px vertical). **Animations belong to emoji stand-ins only** — `workbob` .7s (Working), `sway` 4s (Idle), `hop` 1s (Calling); the mockup's `.who:has(img){animation:none}` rule is law: real pictures are shown exactly as-is, gifs bring their own motion.
- **Unseen Dot** — {components.unseen-dot.size} circle, {colors.coral} fill, white 2px border, coral glow, pinned to the actor's top-right; `ping` animation 1.3s (scale 1→1.25, opacity 1→.8). Under reduced motion it stops pulsing but stays visible.
- **Wooden top button** — per {components.top-button}: Display-font label on {colors.wood-button}, 3px {colors.wood-button-border} border, {rounded.md}, hard shadow. Hover brightens 6%. Used for 📋 Orders and the mute/volume control [ASSUMPTION: mute lives top-left where the mockup's demo 🎭 button sat; the 🎭 preview itself does not ship].
- **Orders Board** — dimmed scrim over the Town; tilted easel; the Galley-Grub paper per {components.orders-board}: nailed corners, {colors.title-red} title "TODAY'S ORDERS", small {colors.paper-sub} subtitle, then one line per Job: Character emoji/portrait · plain-language title (truncating with ellipsis at 58%) · dotted leader · uppercase status in its status color (WAITING / COOKING / SERVED / BURNED / SCRAPPED / SENT BACK). BURNED line in situ: [mock-burned.html](mockups/mock-burned.html).
- **Work Window** — the wooden talk frame per {components.work-window}: 8px {colors.frame-wood} frame with 3px {colors.frame-wood-dark} outline, {rounded.frame}. Header: Character portrait (52px, drop-shadowed), name in Painted 22px + small role line (11px, 92% opacity), on that Character's accent with a 3px `rgba(0,0,0,.25)` bottom rule; round ✕ button at right. Wall: striped parchment. Bubbles per {components.chat-bubble-you} / {components.chat-bubble-them}, each topped by an uppercase Painted sender tag at 65% opacity. Input bar per {components.input-bar}: parchment-toned field, wood border, accent focus ring, and a "Go" action button per {components.action-button}.
- **In-chat choice buttons (Allow / Deny, Try again / Scrap it, Send it back, collision choices)** — rendered inside a Character bubble as a pair of {components.chat-choice-button} buttons: Painted font 16px, {colors.wood-button-text} text, {rounded.lg}, hard 3px shadow, pressed state sinks the shadow to 0 1px. **Every in-bubble choice is plain wood** — the only accent-filled button is the input bar's send button ({components.action-button}), as the binding mockup shows. Illustrated: [mock-burned.html](mockups/mock-burned.html), [mock-sendback.html](mockups/mock-sendback.html).
- **Character picker chip (Home Base)** — circular emoji/portrait on a small {colors.parchment} card ({rounded.md}, hard wood shadow); selected: a 3px ring in that Character's accent; unavailable: grayscale portrait with the state word beneath in {typography.bubble-tag.fontSize} caps. Confirm is a wooden {components.chat-choice-button}. Illustrated: [mock-handout.html](mockups/mock-handout.html).
- **Cancel this order** — a small wooden link-button in the input-bar area ({colors.wood-button} family, {typography.bubble-tag.fontSize} caps, quieter than the send button), visible only while that Character's order is COOKING or WAITING [ASSUMPTION: placement and visibility window].
- **Folded technical detail** — a single quiet plain-language activity line inside a Character bubble ("rummaging through the kitchen…") in {typography.bubble-tag.fontSize} caps at 65% opacity; expanding reveals the raw text on a slightly darker parchment inset ({colors.parchment-stripe}, {rounded.sm} corners) in the body font — still never monospace chrome around it. Behavior in EXPERIENCE.md Component Patterns. [ASSUMPTION: not in the mockup; styled to disappear into the bubble.]
- **Notification content** — native macOS notification, delivered silent (the Voice Line is the sound). Title: the Character's name + verb ("SpongeBob finished!"); body: one plain-language line. No badges, counts, or technical words. The app icon is an Asset Slot like everything else.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Keep every surface in one cohesive SpongeBob world — wood, paper, parchment, chalk | Mix franchises, or add any chrome that reads as terminal, IDE, or dashboard |
| Show real pictures and gifs exactly as provided — no added wiggle, filters, or motion | Animate Maksym's assets; only emoji stand-ins get `sway`/`workbob`/`hop` |
| Use {colors.coral} for the Unseen Dot only | Reuse coral decoratively, or signal state with labels/pills as the primary channel |
| Draw every picture and sound from a Maksym-provided Asset Slot, with a clearly-labelled stand-in when absent | Fetch, generate, or bundle any show artwork or audio — ever |
| Use per-Character accents only inside that Character's Work Window and on the picker chip's selected ring | Flood the street with accent colors, or color-code beyond the five accents |
| Keep statuses in painted diner caps (WAITING / COOKING / SERVED / BURNED / SCRAPPED / SENT BACK) in their status colors | Introduce progress bars, spinners, percentages, or monospace anywhere |
| Honor `prefers-reduced-motion`: stop `ping`/`nudge`/stand-in loops, keep the dot and bubble visible | Let the accessibility fallback hide the "needs you" signal |
