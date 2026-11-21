# Wiring Sketchpad

Fast, local-first sketchpad for holiday display power wiring (Christmas and Halloween).
Type an indented outline, or (from Phase 2) tap preset icons, and see the power tree.

> **Planning aid only**, not an electrical inspection.

**Status: Phase 4 (field mode and seasons) complete; Phase 3 (load checks) deferred.**
Build a plan by typing or tapping, install and tear it down from a checklist, and copy it
for next year. See [PLAN.md](PLAN.md) for the architecture,
data model, phases and the decisions that need your review.

## Outline in 30 seconds

```
# Christmas 2026
O01 Front porch outlet @15A GFCI
  K01 Kasa 2-port smart plug
    left: C02 black cord 10ft
      S02 4-way splitter
        Roofline C9 warm white  x2  300W
        3: Unused socket
    right: Porch spotlight 15W
      ~HDMI Epson 880 (signal)
```

* Two spaces of indentation = "plugged into the line above". Tabs count as two spaces.
* `left:` `right:` `1:` `tap:` `end:` name the socket. Without one, children are numbered in order.
* `@15A`, `GFCI`, `10ft`, `~5ft` (approx), `x2`, `300W`, `2.5A` anywhere on a line.
  Watts and amps are the **total for the line**.
* `[cord]`, `[load]`, `[tote]` force the kind; `[installed]`, `[verified]`, `[new]`,
  `[retired]`; any other `[word]` is a tag.
* `~HDMI` / `~BLE` / `~WiFi` / `~AUX` at the start, or `(signal)` at the end, is a signal link.
  If it names exactly one existing item (or gives its ID), it links to that item.
* `Unused socket` records an empty socket. `#` lines are comments; a top-level `#` is a heading.
* IDs (`O01` outlet, `K01` smart plug, `C01` cord, `S01` splitter, `T01` tote, `P01`
  controller, `L01` load) are assigned automatically and never renumbered when you insert lines.

## Using it

* **Tap to build:** "+" on any item, or tap an "Unused socket", then pick an icon. The item
  appears already plugged in; edit details in the panel only if you want to.
* **Re-plug:** select an item → **Move…** → tap the new socket. On a computer you can also
  drag it, or drag a preset from the palette onto a socket.
* **Undo** with ↶, Ctrl/Cmd+Z, or the Undo button on the message after a change.
* **Checklist** (top toggle): Install and Teardown lists, outlet by outlet, with big tick
  boxes. Ticks update the same plan the diagram shows.
* **⋯ menu**: Copy for next year, Changes since last year, Restore points, Delete.

* Phones open one outlet at a time; tap **Overall** for everything. Desktops open Overall.
* Tap an item in the diagram to highlight its outline line, or put the cursor on a line to
  highlight the item. **Fit** never shrinks text below readable size; pan instead.
* Everything saves automatically in this browser. Nothing is uploaded. Clearing site data
  deletes it, and JSON backup arrives in Phase 5.
* After the first visit it works offline, and can be added to the iPhone home screen.

## Develop

```
npm install
npm run dev      # local preview
npm test         # Vitest: parser, builder, serializer, ID stability, layout, export
npm run build    # type-check + static build in dist/
npm run test:e2e # Playwright smoke tests (desktop + phone) against the built app
```

Pushing to `main` runs tests, builds, and deploys to GitHub Pages (enable Pages with
**Source: GitHub Actions** first). The build uses a relative base path, so it works under any
repository name.

## Layout

```
fixtures/halloween-2026.outline.txt   acceptance fixture (real Halloween 2026 wiring)
fixtures/christmas-2026.outline.txt   example Christmas plan (not as-built)
src/model/types.ts                    data model
src/model/graph.ts                    socket numbering, unused sockets, stats
src/outline/parse.ts                  text → lines (total, never throws)
src/outline/build.ts                  lines → model, stable IDs, signal references
src/outline/serialize.ts              model → text (untouched lines kept verbatim)
src/outline/lineMatch.ts              line diff used to carry IDs across edits
src/diagram/layout.ts                 tree layout per outlet (pure, shared with export)
src/diagram/svg.ts                    standalone SVG export
src/diagram/Diagram.tsx               React Flow view, readable fit
src/ui/OutlineEditor.tsx              textarea with line gutter and error markers
src/ui/PresetPicker.tsx               icon picker (Recent, Favourites, search)
src/ui/NodePanel.tsx                  item details panel
src/model/actions.ts                  add / re-plug / unplug / delete / edit (pure, tested)
src/model/history.ts                  undo/redo shared by both editors
src/outline/sync.ts                   model → outline after diagram edits
src/presets/presets.ts                preset library
src/model/checklist.ts                install/teardown lists
src/model/season.ts                   copy for next year, compare, restore-point retention
src/ui/Checklist.tsx, Dialogs.tsx     field mode, restore/copy/changes dialogs
src/store/db.ts                       IndexedDB (Dexie), serialized writes
public/sw.js                          offline app shell
tests/*.spec.ts                       Playwright: smoke, tap editing, O02 acceptance, field mode
```
