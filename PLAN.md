# Wiring Sketchpad: plan

Working title for the "Christmas Wiring Sketchpad". It serves Halloween and Christmas with the
same tooling, so the code and package are named `wiring-sketchpad`.

**Goal:** get a wiring idea down in under a minute by typing an indented outline or tapping
preset icons, see it as a clean left-to-right power diagram, then use it for load estimates
and install/teardown.

## Architecture

```
            ┌──────────── outline text (plain textarea + gutter overlay) ─────────────┐
 typing ──► │ parseOutline(text) ─► buildDisplay(parsed, previous) ─► Display model   │
            └────────────────────────────────────────────────────────────▲──────────┘
                                                                          │
 tapping ─► diagram actions (pure functions: plugInto, unplug, ...) ─────┘
                                                                          │
            Display model ─► serializeOutline(model) ─► outline text (unchanged lines kept verbatim)
            Display model ─► layout (tidy tree) ─► React Flow diagram + SVG/PNG export
            Display model ─► loads.ts (roll-ups, badges)  ─► Needs-attention view
            Display model ─► Dexie (IndexedDB) + restore points + JSON/CSV export
```

* **The model is the source of truth.** The outline is generated from the model and parsed
  back when edited. Both editors call the same pure functions and push the same undo stack.
* **Pure core, thin UI.** `src/outline/*` (parser, builder, serializer, keyword inference),
  `src/model/*` (types, graph actions, validation) and later `src/loads/*` are framework-free
  TypeScript with unit tests. React only renders and dispatches.
* **Static and offline.** Vite build with `base: './'` so it runs from any Pages path. A small
  hand-written service worker (no plugin dependency) caches the app shell in Phase 1.
* **No backend, no accounts.** IndexedDB via Dexie, JSON export/import for backup.

### Round-trip stability (how "two equal ways in" works)

1. Every node keeps the raw text of the outline line that created it (`src`).
2. The serializer re-parses that raw text; if it still describes the node exactly
   (same port, kind, label, numbers, tags, status), the raw line is emitted verbatim.
   Otherwise it emits a canonical line. So diagram edits only rewrite the lines they touched.
3. When the text changes, a line diff (LCS) against the previous text carries IDs over to
   unchanged and in-place-edited lines. Explicit IDs in the text always win. New lines get
   `max + 1` for their prefix, so inserting a line never renumbers anything.
4. Fields the outline cannot express (notes, photo, storage location, strand details,
   socket count when not in the label, ...) live only in the model and survive text edits.

## Data model (see `src/model/types.ts`)

| Kind | ID prefix | Notes |
|---|---|---|
| outlet | `O` | breaker amps (15 default / 20), GFCI, circuit label, location |
| smartplug | `K` | ports, schedule group; `timer` subtype |
| cord | `C` | length, gauge, colour; `multi-outlet` subtype has taps |
| splitter | `S` | socket count; subtypes `strip`, `stake`, `multi-way` |
| controller | `P` | WLED/ESP32, pixel PSU, Falcon |
| enclosure | `T` | tote; its children are its contents |
| load | `L` | watts/amps, qty, category, strand details |

* `Link` = `{ id, kind: 'power' | 'signal', from, to | null, port?, seq }`.
  `to: null` is an explicit "Unused socket". `seq` keeps outline order stable.
  Signal links (HDMI, VGA, BLE, Wi-Fi, AUX, DMX, data) are dashed and excluded from load math.
* `Comment` lines (`# ...`) are kept in place; a depth-0 `#` line is a section heading and the
  first one is the display title.
* Status: `planned | installed | verified`. Flags: `new`, `retired`. Free tags.
* A power output feeding more than one child, or an item with two power parents, is a
  **warning**, never blocked. Layout positions never change links.

## Outline grammar (Phase 0, implemented)

```
[indent][port:] [~TYPE ] [ID] text tokens...
```

* Two spaces per level; tabs become two spaces. Odd indentation and jumps of more than one
  level are warnings and are repaired (attached to the nearest sensible parent), never dropped.
* `port:` prefixes: numbers, `left`, `right`, `top`, `bottom`, `middle`, `tap`, `end`, `a`–`d`.
  Unprefixed children get the lowest unused number. `tap` may repeat (multi-outlet cords);
  any other repeated port is a warning.
* `Unused socket` (or `unused`) on a line records an empty socket, not a node.
* Tokens anywhere: `@15A`/`@20A` breaker, `GFCI`, `10ft` / `~5ft` (approx) length,
  `x2` quantity, `300W` and `2.5A` (line totals, see decision D1), `[tag]` in brackets.
  `12-ft Skelly` style hyphenated sizes stay part of the name.
* `[kind]` override (`[cord]`, `[load]`, `[tote]`, ...), `[installed]`/`[verified]` status,
  `[new]`/`[retired]` flags, `[spotlight]` style load category; anything else is a tag.
* Kind inference order: explicit `[kind]` → ID prefix → keywords → depth 0 means outlet
  (unless a load keyword matched) → load.
* **Signal links:** a leading `~TYPE` or a trailing `(signal)`. If the text names exactly one
  existing power-tree item (or gives its ID), the line is a reference to that item, not a new
  one; otherwise it creates a new signal-only item. Wiring itself is never inferred.

## Phases

| # | Scope | Done when |
|---|---|---|
| 0 ✅ | Scaffold, CI, Pages workflow, model types, parser/builder/serializer, tests | Halloween fixture parses to the expected node and link counts and round-trips byte-for-byte |
| 1 ✅ | Live split view (stacked on phone), tree layout, outlet clusters, kind colours, socket labels, PNG/SVG export, inline error gutter, IndexedDB autosave, offline shell | Fixture renders recognisably like the Halloween diagram |
| 2 ✅ | "+" on nodes/sockets, icon picker (Recent/Favorites/search), node panel, drag to re-plug, two-way sync, undo/redo (50+) | O02 branch rebuilt with taps only in < 1 min at phone size (Playwright) |
| 3 ⏸ | *Deferred at your request (not focusing on watts/load).* Load roll-ups, 80 % circuit badges, shared circuits, rating warnings, pixel helper, Needs-attention view | Fixture + Christmas fixture show correct estimates |
| 4 ✅ | Field mode checklist, statuses, restore points, copy-from-last-year, tags, new-this-year | |
| 5 ✅ | Custom presets, equipment library autocomplete, label sheet, JSON/CSV, storage locations | |
| 6 ✅ | Photo overlay (seam: per-node `position` map keyed by view id) | |

## Decisions made (tell me if any are wrong)

* **D1. Watts and amps on a line are the line total**, including `x2`. Typing "this run
  draws 300W" is faster than per-item maths. Presets in Phase 2 multiply per-item watts by
  quantity when they fill this in.
* **D2. Top-level lines are outlets** unless a load keyword says otherwise (so
  `Garage window` → outlet, `Inflatable snowman` at the top → unplugged load).
* **D3. Loads get `L` IDs** internally. They are not written into the outline unless you
  type one, matching your diagrams.
* **D4. New IDs are max + 1 per prefix**, not "fill the gap", so a gap (e.g. S05) that is a
  real physical splitter elsewhere is never reused by accident.
* **D5. Signal references by unique name** (`~BLE 6.5-ft Ultra Skelly` links to the existing
  Skelly). Two `~HDMI Dukane 8120WIA` lines stay two projectors because neither is in the power tree.
* **D6. No PWA plugin.** A ~40-line service worker instead of adding `vite-plugin-pwa`.
* **D7. `@types/node`** added as a dev dependency (types only) for the Vite config and for
  tests that read fixture files.
* **D8. No dagre.** It reordered sibling sockets to reduce crossings, so socket 1 could land
  below socket 3. A power tree needs no crossing minimisation: a ~40-line tidy-tree layout
  keeps outline order exactly and is deterministic. Dependency removed.
* **D9. Phones open one outlet at a time; desktops open Overall.** Fit never zooms below
  0.9, so text stays readable; you pan instead of squinting. When the view is too tall it
  opens on the outlet.
* **D10. Export is drawn from the layout**, not screenshotted, so SVG/PNG need no extra
  library and always look the same (light, print-friendly, with the planning note).
* **D11. Crash-recovery copy.** Each edit is also written synchronously to localStorage
  until IndexedDB confirms the save, because a tab closed right after typing can cut off an
  IndexedDB write.

## Phase 1 status

Works: live outline → diagram (both fixtures), one cluster per outlet, kind colours,
socket labels, unused sockets drawn, signal links dashed (including across outlets),
Overall / one-outlet views, tap an item ↔ outline line highlight, inline line markers for
warnings and errors, Tab/Shift+Tab indent, multiple displays saved in IndexedDB, SVG/PNG
export, light/dark/auto theme, offline after first load, installable on iPhone home screen.
Not yet: Needs-attention view (Phase 3), print-friendly PDF (use the browser's print of the
SVG for now; a print stylesheet comes with the label sheet in Phase 5), dragging items.

## Risks

* **Round-trip drift.** Mitigated by raw-line preservation and a property test that
  canonical output re-parses to the same fields.
* **Keyword inference surprises** (e.g. "LED strip" vs "power strip"). Inference only picks
  a *kind*; `[kind]` always overrides, and the node panel shows what was inferred.
* **Phone text editing.** A plain textarea is the most reliable on iOS; a line-number gutter
  and error markers are overlaid rather than using a heavy editor component.
* **Layout of wide displays.** Outlet clusters stacked vertically, one cluster per outlet,
  with "One outlet" view for phone readability.
* **Estimates read as certainty.** Every number carries `entered` vs `estimate` provenance
  and the app shows a planning-aid disclaimer.

## Phase 2 status

Works: "+" on every item and every unused socket opens the icon picker (Recent,
Favourites, search, Enter picks the first match); one tap adds the item already plugged
into that socket, with no form first. The details panel opens alongside (name, kind,
qty, watts with an estimate flag, length, sockets, breaker/GFCI, status, new-this-year,
tags, notes) and writes only the edited outline line. Move… then tap a target re-plugs
(phones); on desktop, drag an item onto a socket or item, or drag a preset from the
palette. Unplug, Delete, and Delete with everything below. Loops are refused with a
message; a taken socket is a warning, not a block. Undo/redo (100 steps) covers typing and
diagram edits together (Ctrl/Cmd+Z, Shift+Z, toolbar, and Undo on every toast).

Acceptance: Playwright rebuilds the O02 branch at iPhone 13 size with **20 taps and 2
pans** (~25 gestures; well under a minute by hand), and checks the resulting outline exactly.

Decisions:

* **D12. Touch uses Move… instead of drag.** On a phone almost every touch on the canvas
  starts on an item, so drag-to-re-plug would turn ordinary panning into accidental
  rewiring. Desktop (fine pointer) gets real drag with a highlighted drop target.
* **D13. Emoji icons** for presets: zero assets, readable on iPhone, easy to replace with
  drawn icons later.
* **D14. Preset watts are written as estimates (`~40W`)** in the outline, so the text
  itself shows which numbers were entered and which were guessed.
* **D15. Edits made while another display is opening are dropped** (the outline is
  read-only for that moment), so text can never land in the wrong display.

Not yet: "Save as preset" and the equipment library (Phase 5), restore points (Phase 4),
adding signal links from the diagram (type them in the outline for now).

## Phase 3: deferred

You asked not to focus on watts or load, so load roll-ups, circuit badges and rating
warnings are not being built. Watt estimates were also removed from the presets and the
picker; a watts field remains (optional, under "More details") and `300W` in the outline
still parses, but nothing is ever guessed or totalled.

## Phase 4 status

Works:

* **Checklist (field mode)**: Plan / Checklist toggle. Install runs outlet by outlet from
  the wall outwards; Teardown runs each outlet back to the wall and shows each item's
  storage spot. Ticking sets status (install) or packed (teardown) on the same model the
  diagram uses, and writes `[installed]` / `[verified]` into the outline. Hide done,
  per-outlet progress, "Show on diagram" for any row, Clear packed.
* **Copy for next year** (⋯ menu): same items, IDs and wiring; every status planned; new
  and packed cleared; notes and storage kept; year bumped in the title. Items added to the
  copy are marked new automatically. **Changes since last year** lists added, re-plugged,
  renamed and removed items by ID.
* **Restore points** (⋯ menu): automatic (first edit after opening, then at most every
  10 minutes; newest 20 kept) and manual (kept). Restoring saves the current state first
  and is undoable. Stored only on this device.
* **Tag filter**: fades every item without the chosen tag.

Decisions:

* **D16. Removing an item keeps its neighbours' socket numbers.** Deleting socket 2's item
  used to renumber socket 3 to 2 in the outline. Later siblings now get their number
  written (`3: Fog machine`), so nothing appears to move that did not.
* **D17. "+ Plug something in" without a socket fills the first written "Unused socket"**
  before adding a new one, so a 3-way stake never grows a fourth socket by accident.
* **D18. Copies keep retired items** (grey, struck through) rather than deleting them, since
  deleting would change wiring. Delete them yourself when they are gone.
* **D19. Packed and storage spot are model-only** (not written into the outline): they are
  seasonal field state, not part of the plan you type.

## Phase 5 status

Works:

* **Save as preset** (item panel): kind, name, length, colour and socket count, never
  connections or status. Your presets appear first in the picker ("My presets", removable),
  in the desktop palette, and as **outline autocomplete**: type two or more letters on a
  line and tap a suggestion to fill it in (indentation and socket prefix are kept).
* **Cord and plug labels** (⋯ menu), in your style: `C02: K01-left → S02`. Options: also
  lights and props, both ends of each cord (`C02 plug → K01-left`, `C02 end → S02`),
  storage spot. Formats: plain paper small (≈2 × 0.75 in) or large (≈3.5 × 1.25 in) with
  dashed cut lines (Print prints only the labels), or label maker: one line per label to
  copy, or a CSV to import into P-touch Editor / Dymo Connect.
* **CSV of items**: one row per item with what it plugs into, socket, link type, status,
  qty, length, sockets, tags, storage, flags and notes. Cells that a spreadsheet would run
  as a formula are neutralised.
* **JSON backup / import** of every display (outline + model, full fidelity). Import is
  validated with a readable reason when a file is wrong, and never overwrites: a display
  that already exists here comes in as "(imported)".

Decisions:

* **D20. Label-maker output is text, not a device driver.** One line per label works with
  any label maker app; the CSV works with the "database" import in P-touch Editor and
  Dymo Connect. Tape width can be chosen there once you pick a printer.
* **D21. Walls are not labelled**, and loads only on request: cords and gear are what get
  mixed up at teardown.
* **D22. Restore points are not in the JSON backup**: they are a short local undo history;
  the backup is the durable copy.

Not yet: photo per item (listed under Christmas fields), signal links from the diagram,
Phase 6 photo overlay.

## Phase 6 status: photo overlay

Designed after the popular holiday-light planner apps, but every mark on the photo is an
item of the same plan (same IDs, same panel, same undo), not a separate drawing.

* **Photo mode** (Plan / Photo / Checklist). "📷 Add a photo" opens the camera or library on
  a phone; "Try it with a sample house" loads an illustration. Photos are shrunk to 2048 px
  JPEG and stored on this device. Several photos per display (front, back yard…).
* **Draw lights**: pick C9, mini, icicle, pixel, pathway or tree lights and tap along the
  house; Done. Bulbs are drawn along the run in colours from the name (warm white, red and
  green, multicolor…), with icicle drops for icicles. Zoomed out, every Nth bulb is drawn so
  each stays visible.
* **Night** darkens the photo and makes the bulbs glow. **Wiring** draws dashed lines from
  each item to the nearest placed item it is plugged into.
* **+ Add item** (picker; lights go straight to drawing) and **Place from plan** (everything
  not on this photo yet) place with one tap. Drag markers and run corners to adjust
  (corners show on the selected run).
* **Measure**: tap both ends of something you know (a 16 ft garage door) and enter the
  length. Runs then show "~49 ft", and the panel offers "Use ~49 ft as length".
* **Plug in from the photo**: select an item, Move…, tap what it plugs into.
* Pinch or scroll to zoom, drag to pan, Fit. Undo covers every photo change.

Decisions:

* **D23. Placements are model-only fields** (`placements[viewId]` as 0..1 fractions), so they
  never touch the outline, survive text edits and photo resizing, and are copied for next
  year with the views.
* **D24. New items added on the photo start "not plugged in yet"**; wiring is never guessed.
* **D25. Instructions get their own strip above the photo** and the item panel docks below
  it, so neither ever covers a spot you need to tap.
* **D26. Photos are stored once and shared** by copies and restore points; removing a photo
  view keeps the image until the display is deleted (so Undo can bring it back). JSON
  backups (format v2) include the photos; v1 backups still import.

## Plan experience round (after Phase 6)

You asked to drop the text/list input from the Plan screen and make planning faster, after
what other tools do well. The closest relatives of a "what plugs into what" tree are
mind-map apps (MindNode, XMind) and diagram tools (Lucidchart, draw.io, Miro); on phones,
map-style apps put actions for the selected thing in a bottom sheet.

* **The canvas gets the screen.** The outline pane is gone from Plan (and Photo). The text
  editor still exists under ⋯ → **Edit as text…** for pasting a list; it applies live with
  undo, highlights the selected item's line and keeps autocomplete.
* **Selection bar** for the selected item: + Plug in, + Into <parent> (sibling), Duplicate,
  Rename, Move…, Fold/Unfold, Delete. Phones: a bottom bar plus a Details sheet. Wide
  screens: an always-present inspector on the right (so selecting never resizes the canvas);
  narrower windows: it floats over the canvas while something is selected.
* **Mind-map keyboard**: Tab child, Enter sibling, Ctrl/⌘+D duplicate, F2/double-click
  rename on the canvas, arrows navigate (left = what it plugs into), Space fold, Delete,
  / find, Esc. Shortcuts and a colour legend are under ⋯ → Shortcuts and colours.
* **Picker suggestions by context** ("Suggested here"): gear under outlets and plugs,
  splitters after cords, "Another <item>" when filling a splitter or adding beside, another
  run under a light string that daisy-chains.
* **Find** by ID, name, tag or storage spot; jumping unfolds and switches outlet as needed.
* **Fold branches**; a "+N" pill unfolds. Remembered per display on this device. Exports
  (SVG/PNG) always include folded items.
* **Overview minimap** on large screens, only when the plan cannot fit at readable size
  (toggle in ⋯).

Decisions:

* **D27. The outline is no longer on screen** (your call); "Edit as text" keeps the
  paste/bulk path and the round-trip guarantees.
* **D28. Duplicate is a new physical item** (new ID) into the parent's next free socket;
  status, notes, photo spots and anything plugged into the original are not copied. When the
  splitter is full it still adds (socket N+1) and says so.
* **D29. Delete removes only the item**; what was plugged into it stays, unplugged, and the
  selection moves to its parent. "Delete with N below" in the details removes a branch.
* **D30. Selecting only scrolls when the item is hidden**; after adding, the view also
  frames the column to its right (its free sockets). Moving the canvas under the pointer
  broke double-click.

Bugs fixed along the way: dialogs (Edit as text, Copy for next year) stole focus back on
every keystroke; the details panel covered photo markers; the minimap covered items.

## Christmas lights round

You asked for a plan tailored to Christmas lights: SPT-1 with inline females and C9 roofline
females, outlet locations, a visible cord when plugging in on the photo, light colour and
spacing (12″ default), a realistic look, rounded corners for ground stakes, and lights on
bushes.

* **Runs with inline females.** A cord of subtype `spt` (SPT-1/2/3, zip cord) or
  `multi-outlet`, and light strings (C9, minis, icicles, ground stakes), are "runs". With a
  known socket count their sockets are `tap1`…`tapN` plus `end`; `endFemale: false` drops the
  end one. The details show a "Females on this run" stepper and a "Female at the end" box.
  Empty sockets on runs show as "Open female". New presets: SPT-1 zip cord (2 inline + end),
  C9 stringer, Net lights (bush), Bush wrap (minis); C9s, minis, icicles and ground stakes
  now come with an end female.
* **Outlet location** (model-only): chips for Front porch, Back porch, Left side, Right side,
  Garage, Front yard, Backyard, Inside, or typed. It shows on the outlet's diagram box, in its
  group title and in the CSV (`location` column). Other items have it under More details.
* **Photo cables.** Each placed item gets a sagging cable to the nearest placed item
  upstream, coloured like the cord in between (that cord's ID is shown on it), or the item's
  own lead. On a light run it attaches at the end for `end`, otherwise at the nearest point.
  "+ Plug in" on the photo places (or draws) the new item and plugs it in; "+ Add item" asks
  what it plugs into straight after placing ("Later" skips).
* **Light look.** Bulb colours (palettes or any colour), spacing in inches, wire colour and
  Smooth curves are set while drawing (live preview) and in the details. Only choices that
  differ from the item's defaults are stored, so naming a string "red" still makes it red.
  Bulbs are drawn as C9/C7 glass in sockets, minis, ground stakes, icicle drops or pixels;
  real size and spacing once the photo has a scale, never too small to see; at night they get
  a lit gradient, a halo and a soft wash.
* **Rounded corners** cut inside each corner (up to halfway along the neighbouring segments),
  so a few taps make one smooth curve and nothing bulges outside what you drew.
* **Bushes**: a new `area` placement (closed outline, 3+ points, always rounded). Net lights
  draw a diamond mesh clipped to the bush; other lights are wrapped through it.

Decisions:

* **D31. Inline females are socket names, not separate items.** A vampire plug on SPT-1 is
  part of the run; what plugs into it is a child on `tapN`. Taps are not placed on the photo
  individually; the cable attaches at the nearest point of the run.
* **D32. Unknown socket counts stay unknown.** Existing C9/multi-outlet items without a count
  keep their old behaviour; nothing is guessed for them.
* **D33. Wire colour and light options are model-only** (like notes and placements) and
  survive text edits.

## Photo builder round

You asked what other tools offer, for inline females at a chosen spot, and for joining the
end of one strand to the next with an automatic extension cord.

What others do (Nov 2026): Bright Home Designer traces the roofline on a photo, previews
styles with adjustable bulb spacing and estimates footage from one known dimension;
LumiSketch does photo mockups for permanent RGB lighting; LightQuoter and QuoteIQ measure
rooflines on satellite images; Clipa turns footage by difficulty into proposals. All of
them note that lengths from a flat photo are estimates.

* **Inline females on the photo.** A path placement can hold `taps` (0..1 along the run);
  females without a stored spot spread evenly after the last stored one. Females show as
  small socket icons (white = open) on the selected run, on zip cords while Wiring is on,
  and on every run while plugging in or drawing. ✂️ Add inline female splices one in where
  you tap; dragging slides it; tapping an open one plugs a strand or a new item into it.
  Renumbering (tap1, tap2… from the plug end) moves what is plugged in with its female.
* **Zip cord on the photo.** SPT and multi-outlet cords are drawn as runs (a plain wire in
  the cord colour), like lights.
* **End to end.** Starting a drawing within reach of an open female snaps to it and plugs
  the new run in there. Plugging a strand in (or into a female on a run) where the ends do
  not meet adds a green extension cord, sized with ~15% slack plus a foot to the next of
  6, 9, 15, 25, 40, 50, 75, 100 ft once the photo has a scale; unsized without one. Markers
  plugged into markers (an inflatable into an outlet) never get one. Off switch: photo ⋯.
* **Cables** to the selected item show their straight-line length once measured. In
  "Tap what it plugs into", tapping a run picks its nearest open female.
* **Measure** has size chips (double/single garage door, front door width and height,
  window).

Decisions:

* **D34. Female positions are per photo.** Reordering females on one photo resets custom
  spots on the run's other photos to even spacing, so numbers and spots never disagree.
* **D35. Auto cords only where a strand is involved** and the gap is over 1.5 ft; they are
  ordinary items (undo removes them, delete or re-plug like any cord).

## Shopping list and saved pictures

The two gaps you picked from the photo builder round.

* **Shopping list** (`src/export/takeoff.ts`, pure). Lights drawn as runs are grouped by
  type, colours and spacing: feet (the item's length, else measured on a photo, marked ~),
  bulbs for C9/C7 and ground stakes (split by colour as they repeat along the run), and
  "buy ~N ft with 10% for corners". Lit bushes list their size and, for nets, how many
  4×6 ft nets cover the front. Zip cord: feet plus inline and end females. Extension cords
  by length and colour; splitters, timers, controllers and props by name. Retired items are
  left out; "Only New this year" keeps just the purchases. Copy as text, CSV, IDs jump.
* **Save picture** (`src/photo/Picture.tsx`). The overlay is rendered once more as a
  standalone SVG at the photo's own size (as if shown 1400 px wide, so bulbs stay visible),
  drawn over the photo on a canvas, darkened for the night look, and saved as JPEG. Share
  appears where the browser can share files (phones). Bulb sockets now take the wire colour
  from the stroke instead of a CSS variable, so the same shapes work inside an image.

Decisions:

* **D36. Lights only by default** in pictures (no IDs, markers or cords): it is the picture
  you show people. Zip cord drawn along the house counts as wiring and shows with cords.
* **D37. Multicolor means red, green, blue, orange, yellow** everywhere (the name and the
  palette now agree).

## Photo guide round

You asked for the first step on an empty photo to be an outlet or measuring, the difference
between a C9 roofline run and a C9 stringer, remembering the last colours, a swap ends
button, more accurate measuring, and what else is missing.

* **Step guide** on each photo: Measure → Outlets → Lights → Plug in, with the next step's
  button (place O01, draw lights, plug L03 in…). Measuring can be skipped; the strip can be
  hidden (per photo, on this device). "+ Add item" opens with "Start here" (place the
  outlet, measure the photo) until the photo has both.
* **C9 strings vs stringers**: picker hints, and the shopping list counts 25-bulb strings
  (bulbs included) for pre-made runs, and a spool, bulbs by colour, male plugs and females
  for stringers (a C9 run named "stringer", "spool" or "bulk").
* **Remembered looks** (`display.lightLooks`, model-only, per kind of light, bushes apart):
  new lights from built-in presets take the last look chosen for their kind, while drawing
  or in the plan; your own presets keep their colours. "Use this look on all N" matches them.
* **Swap plug and end** reverses a drawn run; inline females keep their spots and renumber,
  plugs move with their female. A plug icon marks the male end of the selected run.
* **Several measurements** (`view.measures`): the scale is total feet over total pixels;
  the banner lists them (remove any) and shows the spread, warning above 6%.
* **Undo and redo** buttons on the photo; the message after a change no longer blocks taps.

Decisions:

* **D38. The guide points, it does not block.** Measuring is optional (Skip) because a photo
  is useful without lengths; the steps stay visible until done or hidden.
* **D39. A remembered look belongs to the display**, so it travels with backups and "Copy
  for next year", and a different house keeps its own colours.

## Trace and photos round

* **Follow edges** (`src/photo/edges.ts`): the photo is shrunk to about 640 px, turned grey,
  blurred lightly and run through a Sobel filter once per photo. A tap snaps to the
  strongest edge within 10 screen px; between taps the run is the cheapest path along edges
  (Dijkstra on 8 neighbours, cost low on strong edges) inside a corridor of 12% of the
  distance around the straight line, simplified with Douglas-Peucker. If the found path is
  not mostly on edges, the straight line stays. A toggle in the drawing bar, on by default.
* **Shopping list per photo**: "What <photo> needs" lists items on that photo plus
  everything upstream of them; lengths come from that photo first. Opened from a photo, the
  list starts there. Photos can be renamed (Front of house, Back of house, Left side…).

Decisions:

* **D40. Tracing stays near your taps.** A wider search would also find the gutter, the wall
  or a window; tapping each corner (eaves and peak) is more reliable than guessing.
* **D41. No new libraries**: edge finding is ~200 lines of plain TypeScript.

## Replacing Holiday Display Blueprint

This app is now the one planner; Holiday Display Blueprint is retired (no data migrated: it
held only test entries). From the Blueprint we took only what was worth it:

* **Excel export and import** (`src/export/workbook.ts`): an Items sheet plus a Display sheet.
  Import builds the model from the rows and writes the outline with `syncFromModel`, the same
  path as diagram edits, so IDs and model-only fields (location, circuit, storage, notes)
  survive. Tested as a round trip on both fixtures: export → import → outline → export gives
  the same sheet.
* **Device list for other tools** (`src/export/devices.ts`, `holiday-devices` v1), so the
  show-control dashboard reads this app's items instead of keeping a third inventory.
* **One-tap Back up** in the top bar (the existing JSON backup).

Not taken (already here, or not wanted): the property layout and zone-map editor, photo
galleries, multi-page navigation, encrypted cloud sync, the separate lighting stock catalog,
Field Mode (the Checklist is the field mode), the iOS companion plans. Load totals, quick-edit
and season duplicate were offered and declined for now.

Decisions:

* **D42. Our own .xlsx code instead of SheetJS.** The npm build of SheetJS (0.18.5) has
  unfixed security advisories and newer builds are not on npm. A ~200-line reader/writer on
  `fflate` (8 KB, the one new dependency) covers text and number cells, shared strings and
  inline strings, and is loaded only when you use Excel.
* **D43. Excel import never merges.** It always creates a new display, like a backup import of
  a display that already exists; merging rows into a live plan could silently rewire it.
* **D44. The device file is export-only and versioned.** Readers should check `format` and
  `version`; watts and amps are as entered, never estimated.

