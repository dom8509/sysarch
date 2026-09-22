# Language

An overview of every construct of the language. The full specification, with grammar
and all the rules, is in [02 DSL](/concept/02-dsl).

File extensions: `.arch` for architectures, `.archlib` for libraries. Code block language in
Markdown and Obsidian: `sysarch`.

## Structure of a document

```sysarch code-only
// Comments: // to the end of the line, or /* block */

define <template> [extends <base>] { … }    // any number of them, before the architecture

architecture "Title" {
    theme <name>                 // automotive-light | automotive-dark | presentation | technical
    direction LR                 // LR | TB
    pins all                     // all | connected | none
    stack none                   // none | identical

    view <id> { label "…" }      // levels of abstraction, see below

    layout { … }                 // mode, pin spacing, grid

    zone <id> { … }              // label, system, component
    system <id> { … }            // label, system, component, connections
    component <id>[: <template>] { … }
    external <id>[: <template>] { … }   // context, not part of the system

    <a>[.<PIN>] -> <b>[.<PIN>] { label "…" type <kind> show in <view> }
}
```

## Architecture

| Statement | Values | Default | Guide |
|-----------|-------|----------|-----------|
| `theme` | `automotive-light`, `automotive-dark`, `presentation`, `technical` | `automotive-light` | [Themes](./themes) |
| `direction` | `LR`, `TB` | `LR` | [Layout](/guides/layout#flow-direction) |
| `pins` | `all`, `connected`, `none` | `all` | [Presentation](/guides/presentation#hiding-pins) |
| `stack` | `none`, `identical` | `none` | [Presentation](/guides/presentation#stacking-automatically-with-stack-identical) |

## Component

```sysarch code-only
component <id>[: <template>] {
    label "Display name"
    size small | medium | large
    importance primary | secondary
    category power | controller | communication | sensor | actuator | software | external | generic
    count 4
    hint row 2
    hint column 3
    meta { voltage "12 V" }

    show in <view>[, <view>]

    pin <kind> <NAME> ["Label"] { show in <view> }
    left { pin … }   right { pin … }   top { pin … }   bottom { pin … }
}
```

- The ID is unique across the whole document. Without a template, the type is `block`.
- **Label:** instance `label` before template `label` before ID.
- `size` and `importance` are the only knobs for size and emphasis.
- `meta` is not drawn, but it is exported to React Flow (`data.meta`).
- Shape and icon only come from the template — see [Custom templates](/guides/templates).

## External components

```sysarch code-only
external window_motor: motor { label "Window motor" }
external can_body: bus       { label "Body CAN" }
external x1: connector
```

`external` replaces `component` and marks everything that belongs to the picture but not to
the system being described — motors, valves, connectors, vehicle buses, test equipment.

- Everything a `component` offers works here too: template, pins, `meta`, `count`,
  `show in`, grid cells and hints. A vehicle bus is external *and* a bus.
- It is drawn with a **dashed contour**; shape, icon and category stay as they are, so the
  system boundary is visible even without colour.
- An external component is never fully specified: an unconnected pin on it does **not**
  report [I301](./diagnostics#i301).
- `define` knows no `external` — the same template serves an in-house part and a supplied
  one.

See [External components](/guides/external).

## Pins and signal kinds

<!--@include: ../_generated/signal-kinds.md-->

Choosing sides, order and redeclaration:
[Pins and connections](/guides/pins-and-connections).

## Connections

| Syntax | Meaning |
|--------|-----------|
| `a -> b` | directed from `a` to `b` |
| `a <- b` | directed from `b` to `a` |
| `a <-> b` | bidirectional |
| `a -- b` | undirected |

Properties: `label "…"` and `type <kind>`. Without `type`, the kind is derived from the pins.

## Zones and systems

```sysarch code-only
zone <id> {
    label "…"
    system <id> {
        label "…"
        component …

        a.X -> b.Y               // wiring inside the system
    }
    component …
}
```

Zones only at the top level; systems nested as deeply as you like. Once zones are used, every
component lives in a zone.

A `system` also carries the connections between its own components — where a connection is
written changes nothing about the diagram, only where it is read. Both endpoints must belong
to the system, nested systems included, otherwise that is
[W206](./diagnostics#w206); a connection across the system boundary belongs to the
architecture. A `zone` carries no connections. See
[Zones and systems](/guides/zones-and-systems).

## Views

```sysarch code-only
view overview { label "Overview" }
view detailed

zone z { show in overview, detailed }
component mcu: microcontroller {
    show in overview, detailed
    pin can CAN_TX { show in detailed }
}
a.X -> b.Y { show in detailed }
```

- `view <id>` declares a level of abstraction; `label` names it, otherwise the ID is used.
- `show in` restricts zones, systems, components, pins and connections to the listed views —
  it is not allowed in `define`.
- Without `show in` an element is shown everywhere its surroundings are shown; `show in`
  only narrows. If nothing is left, that is [W204](./diagnostics#w204).
- Without any `view` in the document nothing changes — there is exactly one diagram.
- `sysarch render` writes one file per view (`architecture-overview.svg`); `--view <name>`
  picks a single one. The web app and the Obsidian plugin show a selector.

See [Views](/guides/views).

## Layout

```sysarch code-only
layout {
    mode strict | assisted
    pin spacing 2              // distance between pins in grid units (>= 1)
    grid {
        a | b | c
        . | d | d
    }
}
```

Without `pin spacing`, the `pinPitch` of the theme applies. The spacing also holds for
connections that dock on the body of a component; components grow until every attachment
point has that much room.

See [Controlling the layout](/guides/layout).

## Templates

```sysarch code-only
define <name> [extends <base>] {
    label "…"
    category <category>
    size small | medium | large
    shape rounded | rect | circle | hexagon | cylinder
    icon <icon> | none
    pin … / left { … } / right { … } / top { … } / bottom { … }
}
```

See [Custom templates](/guides/templates), [library](./library) and [icons](./icons).

## Reserved for later versions

`use "file.archlib"` · `interface` · `rule` — the parser reports
[E110](./diagnostics#e110).
