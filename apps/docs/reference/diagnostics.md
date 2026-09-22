# Diagnostics

Every diagnostic has a stable **code**, a **level**, a message and a position. The codes never
change, so that CI filters and tests can rely on them.

| Level | Prefix | Effect |
|-------|--------|---------|
| Error | `E…` | no diagram; the preview shows the last valid state; `check` exits with 1 |
| Warning | `W…` | the diagram is drawn; `check --max-warnings 0` fails |
| Hint | `I…` | information only; in the CLI only with `--verbose` |

## E001

**Syntax error** — a token is missing or in the wrong place.

```sysarch code-only
architecture "A" {
    component mcu microcontroller
}
```

Message: "unknown statement `microcontroller` in the architecture" — the colon before the
template is missing here. The parser recovers at the next statement and reports any further
errors.

## E101

**Duplicate ID** — a component, zone or system has the same name as another element, or a
template is defined twice.

```sysarch code-only
component mcu: microcontroller
component mcu: soc
```

IDs are unique across the whole document, across zones and systems too. Rename one of the
elements.

## E102

**Unknown component** in a connection, in the grid or in a hint.

```sysarch code-only
component mcu: microcontroller
mcu -> can
```

Create the component or fix the ID.

## E103

**Unknown pin** — with a suggestion if a similar name exists.

```sysarch code-only
component mcu: microcontroller { pin pwm MOTOR_PWM }
mcu.MOTOR_PMW -> driver.IN
```

Message: "component `mcu` has no pin `MOTOR_PMW` — did you mean `MOTOR_PWM`?" Unknown pins are
deliberately not created automatically. In the web app, the quick fix adds the pin with a
single click.

## E104

**Unknown template** or a cyclic `extends`.

```sysarch code-only
component mcu: microcontroler
```

Message: "unknown template `microcontroler` — did you mean `microcontroller`?" All templates
are listed in the [library](./library).

## E105

**Duplicate pin** or **redeclaration with a different kind**.

```sysarch code-only
component hb: half_bridge {
    right { pin digital VS }
}
```

`VS` is a `power` pin in the `half_bridge` template. A redeclaration may only change the side,
not the kind.

## E106

**Component outside a zone**, although the document uses zones.

Move the component into a zone, or drop zones altogether — see
[Zones and systems](/guides/zones-and-systems).

## E107

**Invalid grid** — the cells of a component do not form a gap-free rectangle, or the rows have
different widths.

```sysarch code-only
grid {
    a | b | a
}
```

A component may occupy several cells, but only adjacent ones that together form a rectangle.

## E108

**Grid or hint tears a zone apart.**

All components of one zone have to come before those of the next zone along the flow
direction. Adjust the grid to the order of the zones.

## E109

**Unknown signal kind, category or theme** — with a suggestion where possible.

```sysarch code-only
theme dark
component mcu: microcontroller { pin cann TX }
```

The valid values are listed in the [language reference](./language) and under
[themes](./themes).

## E110

**Reserved construct** from a later version: `use`, `view`, `show in`, `interface`, `rule`.

Message: "`use` is only available from v0.2 on" — see [roadmap](/concept/08-roadmap).

## E111

**Unknown shape or icon** — with a suggestion.

```sysarch code-only
define m {
    shape square
    icon motr
}
```

Shapes: `rounded`, `rect`, `circle`, `hexagon`, `cylinder`. Icons: see [icons](./icons).

## E112

**Unknown view in `show in`** — with a suggestion.

```sysarch code-only
view overview

component mcu: microcontroller {
    show in overviw
}
```

Only views declared with `view <id>` in the same architecture can be named. Without any
`view`, `show in` has nothing to refer to.

## W201

**Connection between incompatible signal kinds**, such as `power` → `can`.

Usually a swapped pin. If the connection is intentional, set `type` explicitly — the warning
then goes away.

## W202

**`hint` in `mode strict`** — the hint is ignored.

Set `layout { mode assisted }` or remove the hint.

## W203

**A local template overrides a library template** of the same name.

If you only want to extend the library, pick a new name and derive from it with `extends`.

## W204

**`show in` does not overlap with the views of the surroundings** — the element is shown
in no view at all.

```sysarch code-only
view overview
view detailed

component mcu: microcontroller {
    show in overview
    pin can CAN_TX { show in detailed }   // the component is not in `detailed`
}
```

`show in` only narrows: a pin is never shown without its component, a component never
without its zone. Widen the surroundings or narrow the element differently.

## W205

**A view shows no component.**

Either the `show in` statements never name this view, or every component that names it is
hidden by its surroundings. Rendering it would produce an empty diagram.

## W206

**A connection inside a `system` has an endpoint outside that system.**

A system carries the wiring between its own components; the named component is not one of
them. Move the connection to the architecture — a connection across the system boundary is
not the system's own business. See
[Zones and systems](/guides/zones-and-systems#connections-inside-a-system).

## I301

**Pin without a connection.**

A hint only: library templates often bring more pins than a diagram needs. With
`pins connected` or `pins none` the hint goes away — see
[Presentation views](/guides/presentation#hiding-pins).
