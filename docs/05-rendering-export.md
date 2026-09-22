# 05 — Rendering & Export

## Principle: SVG is the only rendering

```
                         ┌─► preview (inline SVG in the DOM)
DSL → Model → Scene ─► SVG ┼─► .svg file / clipboard
                         └─► PNG (rasterised SVG)
               │
               └────────► React Flow JSON
```

The brainstorming phase foresaw an additional canvas renderer for the preview.
**Decision:** the preview shows exactly the SVG string that is also exported.
A second renderer would be precisely the source of "it looks different in the editor than
in the PNG" that we want to avoid. Canvas is used only for rasterising.

When inserting into the DOM, `scopeSvg` (`@sysarch/editor`) renames the embedded font
family and all `id`s per diagram (`Inter` → `sa3-Inter`, `sa-icon-chip` →
`sa3-icon-chip`). `@font-face` and `id` are global within an HTML document: without a
prefix, a diagram's font subset would replace the identically named UI font, and two
diagrams on one page would reference each other's icon symbols. Geometry and appearance
stay the same; exports and `Analysis.svg` use the unchanged, byte-identical SVG
([D23](decisions.md)).

---

## Themes

v0.1 ships four themes as design tokens (see [the theme type](03-domain-model.md#4-theme)):

| Theme | Use |
|-------|-----|
| `automotive-light` | default, documentation, Obsidian light |
| `automotive-dark` | Obsidian dark, screen |
| `presentation` | larger type, heavier lines, wider spacing — for projectors |
| `technical` | black and white, print-optimised, distinguished by line style only |

Rules for every theme:

- **Colour is never the only carrier of information.** Signal groups always differ in line
  weight, dash pattern or end marker as well. `technical` is the test for this: the
  diagram must be fully readable without colour.
- Text/background contrast at least WCAG AA.
- Type: **Inter** (OFL licence) in weights 400, 500 and 600 — metrics (advance widths,
  GPOS kerning) and TrueType outlines are produced by `scripts/build-font.ts` and checked
  in. For each weight used, the SVG export embeds a TrueType file generated per call, via
  `@font-face`, containing exactly the characters used and their kerning pairs (`kern`
  table).

Example `automotive-light` (excerpt):

```ts
categories: {
  power:         { fill: "#FFF4D6", border: "#D69E00", text: "#3D2E00" },
  controller:    { fill: "#EAF2FF", border: "#316BD6", text: "#0F2A5C" },
  communication: { fill: "#E7F7EF", border: "#23875B", text: "#0D3B26" },
  // …
}
```

## Line styles

| Signal group | Kinds | Line | End marker |
|--------------|-------|------|------------|
| Supply | `power` | thick (2.5 px), solid | arrow |
| Supply | `ground` | thick, solid | ground symbol at the target |
| Single signal | `signal` `digital` `analog` `pwm` | normal (1.5 px), solid | arrow |
| Bus | `bus` `can` `lin` `spi` `i2c` `uart` `ethernet` | double line | arrow (both ends with `<->`) |
| Diagnostics | `diagnostic` `debug` | normal, dashed | arrow |

Arrowheads follow `direction`: `forward` → at the target, `bidirectional` → at both ends,
`none` → none. If a connection ends at a pin, the head sits in front of the pin marker so
that it stays fully visible. At crossings, the horizontal line hops over the vertical one.

## Component rendering

The renderer knows only **primitives**: shape (five fixed shapes), path, text, marker
(arrow, ground, pin, junction) and icon. A component's appearance follows entirely from
its template: shape, icon, category (colour), label and pins.

```
┌──────────────────────┐            ╭───────╮
│  ⚡ Half Bridge 1     │          ●─┤   ⟳   │     ← circle: stub from the
│                      │            │ Motor │        contour to the hull edge
● VS              OUT  ●            ╰───────╯
● IN                   │
└────────●────●────────┘
         IS   GND
```

### The system boundary

An `external` component is drawn with the **same** shape, icon and category colour as any
other, but with a **dashed contour** (`component.externalDash` per theme). That way the
boundary between the described system and its context is readable without colour — in
`technical` too — and no shape is spent on it. In the SVG the element additionally carries
the class `sa-external`, in the React Flow export the flag `data.external`.

### Shapes

`rounded` · `rect` · `circle` · `hexagon` · `cylinder` — geometry and pin attachment in
[04 Layout](04-layout.md#shapes-and-pins). A shape is a pure path; fill, border and border
weight still come from the category and `importance`.

### Icons

**Source:** `library/icons/<name>.svg` — one icon per file, file name = icon name.

**Rules for icon files** (checked at build time, violations break the build):

- `viewBox="0 0 24 24"`, single colour, no fixed colours (they are stripped)
- allowed elements: `path`, `circle`, `rect`, `line`, `polyline`, `polygon`, `g`
- forbidden: `image`, `text`, `use` with external references, `style`, `script`,
  filters, gradients, masks
- everything is converted to pure path data (`IconDef`) at build time

An icon therefore cannot break the visual language: it takes colour and stroke weight from
the theme, has a size determined by the theme (`icon.size[size]`) and works equally well
in light, dark and `technical`.

**Bundled set in v0.1** (drawn in house, same stroke weight and grid):

| Area | Icons |
|------|-------|
| Supply | `battery`, `power`, `regulator`, `fuse`, `relay`, `ground` |
| Compute & memory | `chip`, `soc`, `memory`, `watchdog`, `clock` |
| Communication | `can`, `lin`, `ethernet`, `switch`, `bus`, `connector` |
| Power & actuation | `highside`, `lowside`, `bridge`, `motor`, `window`, `valve`, `lamp`, `heater` |
| Sensing | `sensor`, `temperature`, `current`, `position` |
| Other | `ecu`, `software`, `cloud`, `vehicle` |

**A team's own icons:** drop the SVG into `library/icons/` and build. From v0.2 they can
come from project-specific libraries via `use`.

**No images:** raster images (PNG/JPG), URLs and graphics embedded per diagram are ruled
out (decision D17).

---

## SVG export

- A standalone SVG 1.1 without external references.
- `viewBox` in scene graph units, `width`/`height` in px.
- Shapes as `<path>` or `<rect>`, stubs as separate `<path>` elements.
- Every icon used exactly once as `<symbol id="sa-icon-<name>">` in `<defs>`, used via
  `<use href="#sa-icon-<name>">` with the category's `color`. Unused icons are not
  embedded.
- Stable classes and `data-ref` attributes (`data-ref="pin:mcu.CAN_TX"`) for hit testing
  in the preview and for post-processing.
- Deterministic output: fixed attribute order, numbers rounded to two decimals, no
  generated IDs other than those derived from model IDs.
- `<title>` from the architecture title for accessibility.
- Connection labels sit on a rectangle in the background colour (halo) so that the spaces
  between words also cover the line.
- Double lines are two coincident paths: the outer one in the line colour, the inner one a
  third as wide in the background colour.

## PNG export

**Browser / Obsidian** (no library):

```ts
const img = new Image();
img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
await img.decode();
const canvas = new OffscreenCanvas(scene.width * scale, scene.height * scale);
canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
const blob = await canvas.convertToBlob({ type: "image/png" });
```

- Scale 1×, 2× (default), 3×.
- The font is embedded in the SVG; `document.fonts.ready` is awaited before rasterising.

- Implemented as `svgToPng(svg, scale)` in `@sysarch/export-png`; without
  `OffscreenCanvas` it falls back to a `<canvas>` element.

**CLI** (Node has no canvas): rasterising with `@resvg/resvg-js`. This is the only
rendering dependency in the project and lives exclusively in `apps/cli`.

- resvg does not support `@font-face`. The CLI therefore writes the same font subsets that
  the SVG embeds (`fontSubsets` from `render-svg`) into a temporary directory and loads
  only those (`loadSystemFonts: false`) — PNGs from the CLI and the browser show the same
  type.

## React Flow export

The goal is a `ReactFlowJsonObject` (`{ nodes, edges, viewport }`) that can be loaded into
a React Flow application with matching custom nodes. The exporter itself needs **no**
React Flow dependency — it only produces JSON.

`toReactFlow(model, scene)` in `@sysarch/export-reactflow` reads the geometry from the
scene graph (via `ref`) and the semantics from the model; the JSON therefore matches the
SVG exactly. Golden files: `tests/golden/*.reactflow.json`.

| sysarch | React Flow |
|---------|------------|
| `Component` | node, `type` = template name, `position` from the scene graph |
| `Pin` | entry in `data.pins`, becomes `<Handle id=NAME>` in the custom node |
| `Connection` | edge with `sourceHandle`/`targetHandle`, `type: "step"` |
| `zone` / `system` | group node; members get `parentId` and a relative position |
| `SignalKind` | `edge.data.kind`, styled via `className` |

```json
{
  "nodes": [
    {
      "id": "processing",
      "type": "group",
      "position": { "x": 320, "y": 0 },
      "style": { "width": 288, "height": 400 },
      "data": { "label": "Processing", "groupType": "zone" }
    },
    {
      "id": "mcu",
      "type": "microcontroller",
      "parentId": "processing",
      "extent": "parent",
      "position": { "x": 32, "y": 64 },
      "width": 224,
      "height": 176,
      "data": {
        "label": "RH850",
        "category": "controller",
        "importance": "primary",
        "shape": "rounded",
        "icon": { "name": "chip", "viewBox": "0 0 24 24", "elements": [{ "d": "M7 7h10v10H7z", "mode": "stroke" }] },
        "pins": [
          { "id": "VDD", "label": "VDD", "kind": "power", "side": "left", "offset": 48 },
          { "id": "HB1_PWM", "label": "HB1_PWM", "kind": "pwm", "side": "right", "offset": 48 }
        ],
        "meta": {}
      }
    }
  ],
  "edges": [
    {
      "id": "mcu.HB1_PWM->hb1.IN#0",
      "source": "mcu",
      "sourceHandle": "HB1_PWM",
      "target": "hb1",
      "targetHandle": "IN",
      "type": "step",
      "label": "PWM",
      "markerEnd": { "type": "arrowclosed" },
      "className": "sa-edge sa-group-single",
      "data": { "kind": "pwm", "direction": "forward", "points": [[256, 112], [320, 112], [320, 240], [384, 240]] }
    }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

- Body attachments get virtual handles `__body_<side>`; the side is the one where the
  routed line reaches the hull.
- Parents come before their children in `nodes` (required by React Flow); nested systems
  hang off their zone or system.
- `markerEnd` with `forward`, plus `markerStart` with `bidirectional`, none with `none`.
  The ground symbol has no React Flow equivalent — the target application recognises it
  from `data.kind`.
- `data.icon` contains the full path data so that the target application can render the
  icon without access to the sysarch library. `data.shape` and the pins' `offset` refer to
  the hull.
- `data.points` contains the routed geometry so that a custom edge can adopt the path
  exactly instead of routing it again.
- **Acceptance:** `apps/reactflow-test` (React 19, `@xyflow/react` 12) loads every example
  or a JSON exported by the CLI, with custom nodes (shape, icon, pins as `<Handle>`) and a
  custom edge that adopts `data.points`. The status bar compares the drawn nodes and edges
  with the JSON and shows every `onError` message from React Flow.
- In addition, a reference package `@sysarch/reactflow-nodes` (later) will ship the
  matching custom nodes with theme CSS — separate from the core.
