# 02 — DSL

The DSL is deliberately small. It knows exactly these constructs:

`architecture` · `theme` · `direction` · `pins` · `stack` · `component` · `external` · `pin` ·
`zone` · `system` · connections · `layout` · `define` (including `shape` and `icon`) · `view` ·
`show in`

`view`, `show in` and `external` came with v0.2; everything else is v0.1. The rest (`use`, metadata
inheritance, consistency rules) is reserved for later versions — see
[Roadmap](08-roadmap.md).

File extensions: `.arch` for architectures, `.archlib` for libraries.
Obsidian code block language: `sysarch`.

---

## 1. Overview by example

```sysarch
architecture "Body Control Module" {
    theme automotive-light
    direction LR

    zone supply {
        label "Power"
        component battery: battery { label "KL30" }
        component regulator: power_supply { label "5 V Supply" }
    }

    zone processing {
        label "Processing"
        system ecu {
            label "BCM"
            component mcu: microcontroller {
                label "RH850"
                importance primary
                left {
                    pin power VDD
                    pin ground GND
                    pin analog CURRENT_SENSE
                }
                right {
                    pin pwm HB1_PWM
                    pin can CAN_TX
                    pin can CAN_RX
                }
            }
        }
    }

    zone actuation {
        label "Actuation"
        component hb1: half_bridge { label "Half Bridge 1" }
        component motor: motor { label "DC Motor" }
    }

    battery -> regulator.VIN      { label "KL30"  type power }
    regulator.VOUT -> mcu.VDD     { label "5 V"   type power }
    mcu.HB1_PWM -> hb1.IN         { label "PWM" }
    hb1.IS -> mcu.CURRENT_SENSE   { label "Current Sense" }
    hb1.OUT -> motor              { label "Motor Output" }
}
```

---

## 2. Lexical structure

| Element | Rule |
|---------|------|
| Comments | `// to end of line` and `/* block */` |
| Identifiers | `[A-Za-z_][A-Za-z0-9_]*`, plus `-` when a letter follows directly (`automotive-light`). Case-sensitive. |
| Strings | `"…"` with the escapes `\"`, `\\`, `\n` (line break inside the label) |
| Integers | `[0-9]+` (only for `hint`) |
| Operators | `->` `<-` `<->` `--` `.` `:` `,` `\|` `{` `}` |
| Line breaks | insignificant — except inside `grid { }`, where they separate rows |

Keywords are **context-sensitive**: `power` is a signal kind after `pin`, but may still be
used as a component id. The parser decides with at most two tokens of lookahead.

The rule for `-` in identifiers makes `a--b` unambiguous (`a`, `--`, `b`), and likewise
`a->b`.

---

## 3. Grammar (EBNF)

```ebnf
document      = { define } architecture ;

architecture  = "architecture" STRING "{" { arch_stmt } "}" ;
arch_stmt     = theme | direction | pins | stack | view | layout | zone | system | component | connection ;
                             (* `component` covers `external` — see below *)

theme         = "theme" IDENT ;
direction     = "direction" ( "LR" | "TB" ) ;
pins          = "pins" ( "all" | "connected" | "none" ) ;
stack         = "stack" ( "none" | "identical" ) ;

view          = "view" IDENT [ "{" { label } "}" ] ;
show          = "show" "in" IDENT { "," IDENT } ;

zone          = "zone" IDENT "{" { label | show | system | component } "}" ;
system        = "system" IDENT "{" { label | show | system | component | connection } "}" ;

component     = ( "component" | "external" ) IDENT [ ":" IDENT ] [ "{" { comp_stmt } "}" ] ;
comp_stmt     = label | size | importance | category | pin | side_block | hint | count | meta | show ;

pin           = "pin" IDENT IDENT [ STRING ] [ "{" { show } "}" ] ;  (* kind, name, label *)
side_block    = ( "left" | "right" | "top" | "bottom" ) "{" { pin } "}" ;

label         = "label" STRING ;
size          = "size" ( "small" | "medium" | "large" ) ;
importance    = "importance" ( "primary" | "secondary" ) ;
category      = "category" IDENT ;
hint          = "hint" ( "row" | "column" ) INT ;
count         = "count" INT ;                            (* ≥ 1 *)
meta          = "meta" "{" { IDENT STRING } "}" ;

connection    = endpoint arrow endpoint [ "{" { label | conn_type | show } "}" ] ;
endpoint      = IDENT [ "." IDENT ] ;
arrow         = "->" | "<-" | "<->" | "--" ;
conn_type     = "type" IDENT ;

layout        = "layout" "{" { mode | pin_spacing | grid } "}" ;
mode          = "mode" ( "strict" | "assisted" ) ;
pin_spacing   = "pin" "spacing" INT ;                    (* grid units, >= 1 *)
grid          = "grid" "{" grid_row { NEWLINE grid_row } "}" ;
grid_row      = cell { "|" cell } ;
cell          = IDENT | "." ;

define        = "define" IDENT [ "extends" IDENT ] "{" { def_stmt } "}" ;
def_stmt      = label | size | category | shape | icon | pin | side_block ;
shape         = "shape" ( "rect" | "rounded" | "circle" | "hexagon" | "cylinder" ) ;
icon          = "icon" IDENT ;                          (* "none" removes an inherited icon *)
```

---

## 4. Semantics

### 4.1 Components

```sysarch
component <id>[: <template>] { … }
```

- `id` is unique across the whole document — across zones and systems too.
- Without a template the type is `block` (rounded rectangle, category `generic`, no icon).
- **Shape and icon** come from the template only (see 4.8). An instance cannot set them;
  if a component needs a different appearance, derive a local template
  (`define window_motor extends motor { icon window }`).
- **Label precedence:** instance `label` › template `label` › `id`.
- `size` and `importance` are the **only** knobs for size and weight. The theme turns them
  into a minimum width, a border width and a font weight.
- `category` picks the color family in the theme (`power`, `controller`, `communication`,
  `sensor`, `actuator`, `software`, `external`, `generic`). Templates set a default.
- `count 4` stands for several identical elements (e.g. four half bridges). The component
  is drawn as a stack — one offset card behind it at 2, two from 3 on — and shows the count
  as "×4" to the right of the label. Pins, connections and layout stay those of a single
  component; in the React Flow export the count is in `data.count`.
- **Stack automatically:** `stack identical` (architecture level, default `none`) merges
  identically wired components into one multi-element without `count` having to be written.
  Components are merged when they share
  - the same **name stem**: the label without its running number ("Half Bridge 1" …
    "Half Bridge 4" → "Half Bridge", "HB1" → "HB", "Current A" → "Current"). A number is at
    most two digits or a single letter after a separator; "Temperature" and "Current" always
    stay apart, "S32K344" stays whole.
  - the same template, the same group (zone/system), the same pins, properties and `meta`,
    and the same side of the system boundary (`external` never merges with `component`),
  - the same connections: same pins, signal kind, direction and label towards peers that are
    themselves wired identically. Chains therefore merge as well (`hb1 → m1` … `hb4 → m4`
    gives "Half Bridge ×4 → Motor ×4").

  The first component stays (id, grid slot), takes the name stem as its label and the sum of
  the counts; the connections of the others drop out as duplicates and their grid cells go
  empty. The semantic model stays complete, `check` sees every component; the view applies to
  layout, SVG/PNG and the React Flow export.
- `meta { voltage "12 V" }` stores free-text metadata. In v0.1 it is **not** rendered, but
  it is exported (React Flow `data.meta`). Metadata sits in a block of its own on purpose,
  so that a typo like `lable "x"` stays an error instead of silently passing as metadata.

### 4.2 External components

```sysarch
external <id>[: <template>] { … }
```

An architecture does not end at the circuit board: motors, valves, connectors, vehicle
buses, test equipment belong to the picture, but they are **not part of the system being
described**. `external` says exactly that — otherwise they would look like scope of their
own.

```sysarch code-only
external window_motor: motor { label "Window motor" }
external can_body: bus       { label "Body CAN" }
external x1: connector

hb.OUT -> window_motor.A
```

- `external` is a **keyword in place of `component`**, not a category and not a shape: being
  outside the system is a property of the element, not a way of drawing it. Everything a
  `component` can do, an `external` can do too — template, pins, `meta`, `count`, `show in`,
  grid cells and hints — and it is allowed wherever a `component` is allowed. A vehicle bus
  is therefore external *and* a bus at the same time (`external can_body: bus`).
- `define` knows no `external`: a template describes a building block, not which side of the
  system boundary it ends up on. The same motor template serves an in-house motor and a
  supplied one.
- **Appearance:** the contour is dashed (`component.externalDash` in the theme), everything
  else — shape, icon, category colour — stays as it is. The system boundary is therefore
  visible without colour, in `technical` too.
- **Never fully specified:** an external component has no inner structure, and a pin it does
  not use is normal, not an omission. `I301` ("pin without a connection") therefore does not
  apply to it, and later plausibility rules must not expect a complete set of interfaces
  there either.
- **Position:** externals belong at the edge of the diagram. The layout does not enforce
  that in v0.2 — place them with `grid` or `hint` (see 4.7).
- If the document uses zones, an external component sits in a zone like any other
  (`E106`); a context band of its own at the start or the end of the flow direction is the
  usual pattern.

### 4.3 Pins

```sysarch
pin <kind> <NAME> ["Display Label"]
```

- A pin's address: `<component>.<NAME>` — e.g. `mcu.CAN_TX`.
- Pin names are unique per component.
- **Side:**
  1. The pin sits in a `left`/`right`/`top`/`bottom` block → that side.
  2. Otherwise: the side from the template.
  3. Otherwise: derived from the connections. With `direction LR`, pins with mostly
     incoming connections move left, those with outgoing connections right (with `TB`,
     top/bottom accordingly). A tie and unconnected pins → left, or top.
- **Order** on a side = declaration order (template pins first).
- An instance may redeclare a template pin of the same kind in order to move it to another
  side. Redeclaring it with a different kind is an error.

**Signal kinds** (one shared set of values for pins and connections, fixed in v0.1):

| Group | Kinds |
|--------|-------|
| Supply | `power`, `ground` |
| Single signal | `signal`, `digital`, `analog`, `pwm` |
| Bus | `bus`, `can`, `lin`, `spi`, `i2c`, `uart`, `ethernet` |
| Diagnostics | `diagnostic`, `debug` |

**Pin rendering** (`pins`, at architecture level, default `all`):

| Value | drawn |
|------|------------|
| `all` | every pin |
| `connected` | only pins that have a connection |
| `none` | no pins |

Meant for presentation views built on library templates. Hidden pins stay in the semantic
model (addressing, kind inference and side selection work unchanged); the layout measures
the component without them, and connections to a hidden pin dock like body connections. In
the React Flow export hidden pins are missing as handles and the edge hangs on the body
handle. `I301` does not apply with `connected` and `none`.

The group determines the line style (see [05 Rendering](05-rendering-export.md#line-styles)),
the concrete kind determines label defaults and, later, consistency rules.

### 4.4 Connections

| Syntax | Meaning | Semantic model |
|--------|-----------|----------------|
| `a -> b` | directed, a to b | `source=a, target=b, direction=forward` |
| `a <- b` | directed, b to a | normalized to `source=b, target=a, direction=forward` |
| `a <-> b` | bidirectional | `direction=bidirectional` |
| `a -- b` | undirected | `direction=none` |

- An endpoint without a pin (`motor`) connects to the **body** of the component. The layout
  picks a virtual port for it on the side that matches the flow direction.
- **Kind inference** when `type` is missing:
  1. both endpoints are pins of the same kind → that kind,
  2. both are pins of different kinds in the same group → the kind of the source pin,
  3. exactly one endpoint is a pin → its kind,
  4. otherwise `signal`.
- Pins from different groups (e.g. `power` → `can`) produce `W201`, unless the connection
  sets `type` explicitly.
- In v0.1, connections only exist at `architecture` level.
- Several connections between the same endpoints are allowed and are routed in parallel.

### 4.5 Zones and systems

Both group components, but they serve different purposes:

| | `zone` | `system` |
|---|---|---|
| Purpose | **layout** band along the flow direction | **semantic** boundary (ECU, domain, vehicle) |
| Nesting | top level only | anywhere, including inside zones |
| Appearance | labeled band with a subtle background | labeled frame |

- The structure is a tree: `architecture › zone › system* › component`.
- Zones are arranged in declaration order along `direction` (LR: columns left to right,
  TB: rows top to bottom).
- If zones are used, **every** component must sit in a zone.
- A component belongs to the innermost block it is defined in. There are no references to
  components defined elsewhere in v0.1.
- A `system` also carries the connections between its own components, so that the wiring of
  an ECU stays with the ECU:

  ```sysarch code-only
  system ecu {
      label "BCM"
      component mcu: microcontroller { pin can CAN_TX }
      component trx: can_transceiver

      mcu.CAN_TX -> trx.TXD
  }
  ```

  Where a connection is written changes nothing about the model: IDs are unique across the
  whole document, and the connection is laid out, routed and exported exactly as if it stood
  in the architecture. Both endpoints must belong to the system, nested systems included —
  otherwise `W206` asks for the connection to move up. A connection that crosses the system
  boundary belongs to the architecture, and a `zone` never carries connections: it is a
  layout band, not a semantic boundary ([D8](decisions.md)).

### 4.6 Views

```sysarch
architecture "Body Control Module" {
    view overview { label "Overview" }
    view detailed

    component mcu: microcontroller {
        pin digital CAN_TX { show in detailed }
    }
    component trx: can_transceiver { show in detailed }

    mcu.CAN_TX -> trx.TXD { show in detailed }
}
```

A `view` is a level of abstraction of the **same** source: one model, several diagrams.

- `view <id>` declares a view; `label` gives it a display name, otherwise the ID is used.
  View IDs have their own namespace — a view may be called like a component.
- Views are ordered as declared. The order decides the order of the rendered files and of
  the entries in the selectors of the web app and the Obsidian plugin.
- `show in <view>[, <view>]` restricts an element to the listed views. It is allowed on
  `zone`, `system`, `component`, `pin` and connections — not in `define`: a template
  describes a building block, not where it is shown.
- An element **without** `show in` is shown in every view its surroundings are shown in.
  Without any `view` in the document, nothing changes: there is exactly one diagram.
- `show in` only ever **narrows**, it never widens: a pin is never visible without its
  component, a component never without its zone. If the two do not overlap, nothing is
  shown and the element reports `W204`.
- A connection appears where **both** of its components appear; `show in` narrows that
  further. If the pin of an endpoint is hidden in a view, the connection docks on the body
  of the component, exactly as with `pins none`.
- Zones and systems without visible content disappear in that view, and so do empty rows
  and columns of a `grid`.
- A view that shows no component reports `W205`.

The semantic model always stays complete: `check` sees every component, no matter which
view shows it. Views are a matter of rendering, `render` produces one file per view
(`architecture-overview.svg`, `architecture-detailed.svg`).

### 4.7 Layout control

```sysarch
layout {
    mode assisted
    pin spacing 2
    grid {
        battery | regulator | mcu | hb1
        .       | .         | wdg | motor
    }
}
```

- `direction LR | TB` — main flow direction, default `LR`.
- `mode strict` (default): the renderer decides everything; `hint`s raise a warning and are
  ignored; the visual editor allows no dragging.
- `mode assisted`: components may be dragged in the editor. The result is written back into
  the DSL as `hint row N` / `hint column N` — never as pixels.
- `grid` fixes column and row in the **finished image** (independently of `direction`).
  `.` is an empty cell. Components that are not listed are placed automatically by the
  layout.
- **Spanning:** if the same id appears in several adjacent cells, the component occupies all
  of them and is stretched to their width or height. The cells must form a gapless
  rectangle. Typical for presentation views with one central building block:

  ```sysarch
  layout {
      grid {
          .   | can | eth  | lin | .
          sbc | mcu | mcu  | mcu | comcu
          .   | hb  | temp | cur | .
      }
  }
  ```

  Pinless connections to the components above and below dock exactly opposite each other and
  run straight (full example: [`examples/mcu-hub.arch`](../examples/mcu-hub.arch)).
- `hint row|column` (1-based) means the same for a single component.
- Grid and hints must not break zone cohesion (otherwise error `E108`).
- `pin spacing N` sets the distance between two neighbouring pins to **N grid units**
  (`N ≥ 1`); without it the `pinPitch` of the theme applies. The unit is the grid, not a
  pixel value — the spacing therefore scales with the theme. The same distance applies to
  connections that dock on the body of a component (`pins none` or an endpoint without a
  pin).
- **Components grow on their own** when their pins or docking connections need more room
  than `size` provides: a side needs `(number of attachment points + 1) × spacing`, so no
  two connections ever share an attachment point. `size` therefore stays a minimum, not a
  cap.

### 4.8 Templates (`define`)

```sysarch
define half_bridge {
    label "Half Bridge"
    category power
    size medium
    left   { pin power VS   pin digital IN }
    right  { pin power OUT }
    bottom { pin analog IS   pin ground GND }
}
```

- Templates describe defaults for label, category, size, shape, icon and pins —
  **no geometry**.
- `extends` inherits pins and defaults; pins are appended, defaults are overridden.

#### Shapes

`shape` picks from a **fixed list**. Every shape has a defined outline for pins to dock on
and an inner area for label and icon
(details in [04 Layout](04-layout.md#shapes-and-pins)).

| Shape | Appearance | typical use |
|------|-------------|---------------------|
| `rounded` | rectangle with the theme radius (default) | ECUs, controllers, drivers |
| `rect` | rectangle without radius | external systems, connectors |
| `circle` | circle (square bounding box) | motors, sensors, ground |
| `hexagon` | hexagon, points left/right | software components, gateways |
| `cylinder` | cylinder | memory, data stores |

#### Icons

`icon <name>` references an icon from the **icon library** (`library/icons/`). Icons are
single-color symbols; the theme paints them in the text color of the category. The diagram
cannot embed image files, URLs or custom graphics
(see [05 Rendering](05-rendering-export.md#icons)).

```sysarch
define motor extends actuator {
    label "Motor"
    shape circle
    icon motor
}

define window_motor extends motor {
    icon window
}
```
- The bundled library ([`library/automotive.archlib`](../library/automotive.archlib)) is
  itself written in this syntax and is loaded before every document.
- Document-local `define`s go before `architecture` and override library names with a
  warning.

### 4.9 Reserved constructs (the parser reports "available from v0.x")

`use "file.archlib"` · `interface` · `rule`

---

## 5. Diagnostics

Every diagnostic has a code, a severity, a message and a source range (line/column, from–to).
Codes are stable and documented so that CI filters and tests can build on them.

| Code | Level | Trigger |
|------|-------|----------|
| `E001` | error | syntax error (expected token, found token) |
| `E101` | error | duplicate id (component, zone, system) or template defined twice |
| `E102` | error | unknown component in a connection, grid or hint |
| `E103` | error | unknown pin — with a Levenshtein suggestion ("did you mean `CAN_TX`?") |
| `E104` | error | unknown template or cyclic `extends` |
| `E105` | error | duplicate pin name, or redeclaration with a different kind |
| `E106` | error | component outside a zone although zones are used |
| `E107` | error | the grid cells of a component do not form a gapless rectangle, or grid rows differ in width |
| `E108` | error | grid/hint breaks zone cohesion |
| `E109` | error | unknown signal kind, category or theme |
| `E110` | error | construct reserved for a later version |
| `E111` | error | unknown shape or icon — with a Levenshtein suggestion |
| `E112` | error | unknown view in `show in` — with a Levenshtein suggestion |
| `W201` | warning | connection between pins of incompatible groups (e.g. `power` → `can`) |
| `W202` | warning | `hint` in `mode strict` |
| `W203` | warning | local `define` overrides a library template |
| `W204` | warning | `show in` does not overlap with the views of the surroundings — the element is shown nowhere |
| `W205` | warning | a view shows no component |
| `W206` | warning | a connection inside a `system` has an endpoint outside that system (4.5) |
| `I301` | info | pin without a connection — not on `external` components (4.2) |

**Error tolerance:** after an error the parser synchronizes on the next `}` or the next
statement keyword and returns a partial AST. The preview shows the last error-free state
plus the diagnostics — it never goes blank just because someone is typing.

---

## 6. Canonical formatting

`sysarch fmt` produces one unambiguous spelling. The visual editor uses the same rules for
the text it inserts.

- **Indentation** 4 spaces, one space between tokens, `\n` as the line ending, exactly one
  line break at the end of the file.
- **Order inside `architecture`:** `theme` › `direction` › `pins` › `stack` › views ›
  `layout` › zones/systems/components › connections. Within those groups and in every other block the
  source order is kept — it carries meaning (pin and zone order).
- **Order inside `system`:** `label`/`show` › systems/components › connections, with a blank
  line before the connections. Inside a `zone` the source order is kept.
- **Blank lines:** at most one in a row, none at the start or end of a block. Between the
  sections (`theme`/`direction`/`pins`/`stack`, views, `layout`, structure, connections) and
  between `define`s there is always one.
- **Single-line** `head { … }`, as long as the block contains no comments:
  - connections with at most two properties: `a.X -> b { label "x" type can }`
  - components with exactly one property (`label`, `size`, `importance`, `category`,
    `hint`, `count`, `show`): `component kl30: battery { label "KL30" }`
  - views and pins with at most one property: `view overview { label "Overview" }`,
    `pin can CAN_TX { show in detailed }`
  - side blocks with at most three pins without a display label, separated by three spaces,
    as long as the line stays within 80 characters: `left { pin power VS   pin digital IN }`
  - empty blocks are dropped on components and connections; otherwise `zone z {}`.
  - `layout`, `grid`, `meta`, zones, systems, `define` and `architecture` are always
    multi-line.
- **Alignment:** consecutive single-line connections and side blocks align their `{`; a blank
  line, a comment on its own line or a multi-line block starts a new group. Grid columns are
  padded to the widest cell.
- **Strings** are rewritten with the escapes `\"`, `\\` and `\n`.
- **Comments are preserved.** A comment on its own line belongs to the statement that follows
  and moves with it when statements are reordered; a comment at the end of a line stays behind
  the statement in front of it. Comments in the middle of a statement (`pin /* x */ can TX`)
  end up on their own line before the statement.
- Files with **syntax errors** are left untouched; resolver errors (e.g. unknown pins) do not
  prevent formatting.
- `fmt` is idempotent and does not change the semantic model (verified by a test across all
  examples).
