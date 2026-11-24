# Plug & Glow

*Plan the lights. Plan the power.* (Formerly Wiring Sketchpad; repository: Holiday Wiring Diagram Builder.) **[Open the app](https://jacobmgoodnight.github.io/Holiday-Wiring-Diagram-Builder/)**

Fast, local-first planner for holiday display power wiring (Christmas and Halloween): tap
to build what plugs into what, see it as a clean diagram and on a photo of your house, then
install and tear it down from a checklist.

> **Planning aid only**, not an electrical inspection.

**Status: all phases complete except Phase 3 (load checks), deferred.** Build a plan by
typing or tapping, see it on a photo of your house with glowing lights, install and tear it
down from the Install tab, copy it for next year, print labels, and back it all up. See [PLAN.md](PLAN.md) for the architecture,
data model, phases and the decisions that need your review.

## Using it

* **Tap to build:** "+" on any item, or tap an "Unused socket", then pick an icon. The picker
  suggests what fits there (gear under outlets, "Another Spotlight" when filling a splitter).
  The item appears already plugged in.
* **Selected item:** a bar of one-tap actions: **+ Plug in**, **+ Into S01** (another item
  next to it), **Duplicate**, **Rename**, **Move…**, **Fold**, **Delete**. Details (kind, qty,
  length, status, tags, notes) are in the panel on the right, or under **Details** on a phone.
* **Keyboard (computer):** select an item, then <kbd>Tab</kbd> plug something in,
  <kbd>Enter</kbd> add another next to it, <kbd>Ctrl/⌘ D</kbd> duplicate, <kbd>F2</kbd> or
  double-click rename, arrows move around, <kbd>Space</kbd> fold, <kbd>Delete</kbd> remove,
  <kbd>/</kbd> find. ⋯ → Shortcuts and colours lists them all.
* **Find** (🔍 or <kbd>/</kbd>): jump to any item by ID, name, tag or storage spot, even on
  another outlet. **Fold** a branch to hide what is plugged into it; folds are remembered
  on this device. Exports always show everything.
* **Re-plug:** select an item → **Move…** → tap the new socket. On a computer you can also
  drag it, or drag a preset from the palette onto a socket.
* **Undo** with ↶, Ctrl/Cmd+Z, or the Undo button on the message after a change.
* **Tabs: Photo, Plan, Install.** The app opens on Photo the first time, then on the tab you
  used last.
* **Photo**: a new photo shows the steps (Measure → Outlets → Lights → Plug in)
  with a button for the next one; "+ Add item" starts with an outlet or measuring. ↶ ↷ undo
  and redo on the photo. Add a photo of your house (or the sample house), draw light runs
  along the roofline, drop items where they go, and press 🌙 Night to preview. Measure a
  known length once and every run shows its feet and bulb count.
  * **+ Plug in** on a selected item puts the new item on the photo with its cord drawn
    from that item. Something added with **+ Add item** asks what it plugs into right away.
    Cables take the colour of the cord in between (and name it, "C01"); they attach at the
    end female or the nearest point of a light run.
  * **🧲 Follow edges** (on while drawing, remembered): tap the roof's corners (eaves and
    peak) and the run lands on the roof edge between them, even if your taps are a little
    off. It ends on the edge nearest each tap (at the corner when you tap beside it), stays on
    one edge instead of hopping between the drip edge and the trim board, draws straight roof
    edges as straight lines, and keeps your line where the photo has no clear edge. "Undo
    point" takes back a traced stretch.
  * **Shapes** (while drawing): **▭ Outline** a window or door from two corners, **⌒ Arch**
    from three taps, **🌀 Wrap** a post or trunk, and a **Mega tree** fans its strands from
    the top.
  * **Phones**: press and hold to get a magnifier, and the point lands where you let go.
    While you draw or place, the photo gets the whole screen.
  * **Several photos** (front, back, sides): rename each from the photo's ⋯ menu; the
    shopping list can show everything or just what one photo needs (its items and the cords
    and gear feeding them).
  * **Draw lights**: pick a style, tap along the house, and set **bulb colours, spacing**
    (C9/C7 and ground stakes 12″ by default, minis 4″), **wire colour** and **Smooth
    curves** (rounded corners, on by default for ground stakes) while you draw. Bulbs are
    drawn as C9 glass, minis, stakes or icicle drops at real spacing.
  * **On bushes and trees**: net lights or a mini-light wrap; tap around the bush.
  * **End to end**: start drawing on the open female at the end of a strand (✓ Plugs into
    L01 end) and the new strand plugs into it. If a strand starts a gap away, plugging it
    in adds a green extension cord sized to the next common length (6, 9, 15, 25, 40, 50,
    100 ft) once the photo is measured. Turn that off in the photo's ⋯ menu.
  * **SPT-1 zip cord**: draw it along the beds or the eaves, past what it feeds. Females go
    where things plug in: tap the cord (or "+ Plug in" on it) and a vampire female is
    spliced in where the item is nearest; anything within 4 ft needs no extension cord. A
    selected zip cord offers **🔌 Plug in N nearby** to plug in every unplugged item along it
    in one tap (drawing one says when there are some). It starts with just the end female.
  * **Inline females**: select a zip cord or light string → **✂️ Add inline female** and
    tap where it goes. Drag a female to slide it; tap an open one to plug a strand or a new
    item into it (or remove it). Females keep what is plugged into them when renumbered.
  * **📸 Save picture**: the photo with its lights drawn on, day or night, as a JPEG to keep
    or (on a phone) share. Lights only for family; add items, labels and cords for whoever
    helps install.
  * New lights start with the **look you last chose** for that kind (C9s stay red if you
    made them red); "Use this look on all" in an item's details makes them all match.
  * **⇄ Swap plug and end** flips which end of a run is the plug (male) end; the plug shows
    as a small plug icon on the selected run.
  * **C9 roofline run vs C9 stringer**: pre-made strings come with bulbs and plugs; a
    stringer is wire with sockets, cut to length, with bulbs, plugs and females bought
    separately. The shopping list counts strings for one and a spool, bulbs by colour and
    plugs for the other.
  * **Measure** several things: they are combined into one scale and the photo says how well
    they agree (a big difference usually means they are at different distances).
  * **Measure** offers common sizes: double garage door 16 ft, single 8–9 ft, front door
    3 ft wide and 6 ft 8 in tall, a window often 3 ft (they vary from 2 to 4 ft). Lengths
    from a photo are estimates: things nearer or farther than what you measured scale
    differently, so measure before you buy.
* **Christmas runs**: an **SPT-1 zip cord** or **C9 stringer** can have inline females
  (vampire plugs) plus one at the end. Set them in the details (Females on this run); plug
  into "tap 1", "tap 2"… or "end". Outlets have a **Location** (Front porch, Left side…)
  that shows on the diagram.
* **Install** tab: **Put up** lists the plug-in order as numbered steps with big boxes to
  tick, the next one up top ("✓ L02 is up"); **Take down** runs it backwards, from the far
  end back to the wall, with where each thing is stored. For everything or one photo. Ticks
  update the same plan. The screen stays on while it is open. Shortcuts: tick off on the
  photo (**✅ Install mode**), print the install sheet, print the plan diagram.
* **Install sheet** (Install tab, ⋯ menu, or the photo's ⋯): prints or saves as PDF the photo
  with numbered items, the steps (put up or take down) with boxes to tick, what to buy, and
  the plan diagram. Leave out what you do not need (no shopping list when you already have
  everything); the choices are remembered.
* **Labels and zip ties**: from the Install tab (🏷 Labels), the ⋯ menu, a photo's ⋯ (that
  photo's items) or an item's details (🏷 Print a label for C05). Small labels with the ID
  big and one useful line: a cord's length on both ends (`C02 · 25 ft`), where lights and
  props go (`L02 · Garage peak`), or the gear's name; switch either to the name, or give any
  item its own label text. Optionally where it plugs in and the storage spot.
  * **Which:** everything, one outlet or one photo; all, new this year, or not printed yet
    (**✓ Mark these as printed** after printing); untick any item to leave it out.
  * **Paper:** plain paper (a flag that folds around a cord, small, large), **Avery 5160/8160**
    (30 per sheet) or **5167/8167** (80 small labels) with **Start at label #** for a partly
    used sheet, any custom size, or a label maker (copy, or CSV for P-touch / Dymo). Wide
    labels can be flags too. Bigger text if you like. Print sheets at 100% (actual size).
  * **Zip ties, both optional:** a colour for each outlet (everything it powers gets that
    colour; pick black, white or green to blend in), and one tie per story (1 = first floor,
    2 = second story). The sheet counts the labels and ties to get ready. The Install tab
    and install sheet show the same dots, and steps say "(2nd story)".
  * IDs are never reused, so a printed label stays right.
* **Print the plan diagram** (⋯ menu or the Install tab): one outlet per page, wide or tall,
  sideways or upright.
* **Cords that no longer reach**: once a photo is measured, an extension cord too short for
  the gap it spans is drawn red and dashed with "needs ~42 ft", and one tap swaps in a long
  enough one. The shopping list starts with these.
* **Shopping list** (⋯ menu, or the photo's ⋯): feet of lights by type, colour and spacing
  (bulb counts for C9s and stakes, plus 10% for corners), bushes with net counts, zip cord
  and its females, extension cords by length, gear and props. Lengths come from each item,
  or from the measured photo (~). "Only items marked New this year" lists what to buy.
  Copy as text or download a CSV; tap an ID to jump to that item.
* **⋯ menu**: Edit as text, Copy for next year, Changes since last year, Restore points,
  Labels and zip ties, Shopping list, Install sheet, Print the plan diagram, Download as Excel,
  Import from Excel, Download items as CSV, Device list for dashboard (JSON), Sync with other
  devices, Back up all displays (JSON), Import a backup, Delete.
* **My presets**: "Save as preset" on any item; it then shows in the picker.
* **Back up regularly**: one tap on **Back up** (💾 on a phone) in the top bar downloads every
  display as one JSON file; ⋯ → **Import a backup** restores it. Everything lives in this browser, and
  clearing site data deletes it; after a fair amount of work the app reminds you to back up.
  On iPhone, add it to the Home Screen so Safari keeps your plans (the app shows a one-time
  tip). When a new version is published, a note offers to reload.
* **Sync with other devices** (⋯ menu): turn it on and
  type the code on your other device, or open the sync link there. Plans and photos are
  scrambled (end-to-end encrypted) on your device before they are sent, with the code as the
  key; the server keeps only the scrambled copy and cannot read it. No account, no
  password, so keep the code private. An edit made on both devices at once keeps the other
  version in Restore points. **Nothing leaves your device unless you turn sync on.**
* **Plan** on a phone uses the **tall layout**: each item under what it plugs into, one step
  in, so it reads top to bottom without panning sideways. Switch between tall and wide in
  the diagram's ⋯ menu (remembered on this device). Phones open one outlet at a time; tap
  **Overall** for everything. **Fit** never shrinks text below readable size; pan instead.
* After the first visit it works offline, and can be added to the iPhone home screen.

## Excel

* **Download as Excel (.xlsx)**: an *Items* sheet with one row per item (id, kind, type, name,
  plugs_into, socket, watts, amps, length, sockets, location, circuit, storage, tags, notes…)
  in diagram order, and a *Display* sheet with the title, season and year. Text never turns
  into a formula.
* **Import from Excel…** always makes a **new display**; nothing already here changes. Edit
  the downloaded sheet and import it, or type your own: only a `name` column is required.
  Missing IDs and kinds are filled in as if you had typed the line; an unknown `plugs_into`
  or a loop leaves that item not plugged in and the message says which row.
* Excel holds items and wiring only. Photos, drawn runs and light looks are in the JSON backup,
  which stays the complete copy.

## Device file for other tools

**Device list for dashboard (JSON)** downloads `<display>-devices.json`, a flat list your
show-control dashboard (or anything else) can read, so devices are entered only here. It is
an export only; edit devices in this app.

```jsonc
{
  "format": "holiday-devices", "version": 1, "exportedAt": "2026-11-24T…Z",
  "display": { "id": "…", "title": "Christmas 2026", "season": "christmas", "year": 2026 },
  "devices": [
    { "id": "C02", "name": "black cord", "kind": "cord", "type": null,
      "outlet": "O01",          // wall outlet at the top of its power chain (null if unplugged)
      "plugsInto": "K01", "socket": "left", "link": "power",
      "zone": "Front porch",    // its Location, else the nearest one above it
      "location": null, "circuit": "Garage 15A", "watts": null, "amps": null, "qty": 1,
      "status": "planned", "retired": false, "storage": "Tote 3", "tags": [], "notes": null }
  ],
  "signals": [ { "from": "K03", "to": "L40", "type": "hdmi" } ]
}
```

`kind` is one of outlet, smartplug, cord, splitter, controller, enclosure, load; `type` is the
load category (c9, projector, inflatable…) or power subtype (spt, timer…). Watts and amps are
as entered (the total for that line). New fields may be added in version 1; anything that
changes meaning gets a new version number.

## Edit as text (⋯ menu)

For pasting a list or bulk edits, the plan can also be edited as an indented outline:

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
* `left:` `right:` `1:` `tap1:` `end:` name the socket. Without one, children are numbered in
  order (on runs: tap 1, tap 2… then end).
* `@15A`, `GFCI`, `10ft`, `~5ft` (approx), `x2`, `300W`, `2.5A` anywhere on a line.
  Watts and amps are the **total for the line**.
* `[cord]`, `[load]`, `[tote]` force the kind; `[installed]`, `[verified]`, `[new]`,
  `[retired]`; any other `[word]` is a tag.
* `~HDMI` / `~BLE` / `~WiFi` / `~AUX` at the start, or `(signal)` at the end, is a signal link.
  If it names exactly one existing item (or gives its ID), it links to that item.
* `Unused socket` records an empty socket. `#` lines are comments; a top-level `#` is a heading.
* IDs (`O01` outlet, `K01` smart plug, `C01` cord, `S01` splitter, `T01` tote, `P01`
  controller, `L01` load) are assigned automatically and never renumbered when you insert lines.

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
src/ui/OutlineEditor.tsx, TextSheet.tsx  "Edit as text": textarea with line gutter and error markers
src/ui/SelectionBar.tsx               one-tap actions for the selected item
src/ui/FindBox.tsx, HelpSheet.tsx     find; shortcuts and colour legend
src/model/navigate.ts                 arrow-key navigation, find
src/presets/suggest.ts                picker suggestions by context
src/ui/PresetPicker.tsx               icon picker (Recent, Favourites, search)
src/ui/NodePanel.tsx                  item details panel
src/model/actions.ts                  add / re-plug / unplug / delete / edit (pure, tested)
src/model/history.ts                  undo/redo shared by both editors
src/outline/sync.ts                   model → outline after diagram edits
src/presets/presets.ts                preset library
src/model/season.ts                   copy for next year, compare, restore-point retention
src/ui/InstallTab.tsx, Dialogs.tsx    install/take-down steps, restore/copy/changes dialogs
src/export/installSteps.ts            plug-in order and take-down order in words
src/ui/PlanDiagrams.tsx               printing the plan diagram
src/export/labels.ts, LabelSheet.tsx  labels and zip-tie marks (paper, flags, label maker)
src/export/csv.ts, backup.ts          CSV export, JSON backup and safe import
src/export/xlsx.ts, workbook.ts       Excel: small .xlsx reader/writer, items sheet export/import
src/export/devices.ts                 device list JSON for other tools (dashboard)
src/presets/custom.ts                 save as preset, outline autocomplete
src/photo/                            photo overlay: geometry, actions, editor, pane
src/store/db.ts                       IndexedDB (Dexie), serialized writes
public/sw.js                          offline app shell
tests/*.spec.ts                       Playwright: smoke, tap editing, O02 acceptance, plan keyboard/find/fold, field mode, library/labels/backup, photo
```
