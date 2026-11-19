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
| 2 | "+" on nodes/sockets, icon picker (Recent/Favorites/search), node panel, drag to re-plug, two-way sync, undo/redo (50+) | O02 branch rebuilt with taps only in < 1 min at phone size (Playwright) |
| 3 | Load roll-ups, 80 % circuit badges, shared circuits, rating warnings, pixel helper, Needs-attention view | Fixture + Christmas fixture show correct estimates |
| 4 | Field mode checklist, statuses, restore points, copy-from-last-year, tags, new-this-year | |
| 5 | Custom presets, equipment library autocomplete, label sheet, JSON/CSV, storage locations | |
| 6 | Optional photo overlay (seam: per-node `position` map keyed by view id) | |

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
