# 08 — Roadmap

## Milestones for v0.1

Every milestone is usable on its own and ends with green tests.

| # | Milestone | Result | Acceptance |
|---|-------------|----------|---------|
| M0 | Concept | this repository | concept reviewed |
| M1 | Language | `core`: lexer, parser, AST, resolver, diagnostics, `library/automotive.archlib`, icon build for `library/icons/` | all `examples/*.arch` parse without errors; every `E…`/`W…` diagnostic has a test; the parser returns a partial AST for broken input |
| M2 | Layout & SVG | `themes`, `layout` including the five shapes, `render-svg` including icons | golden files for all examples, every shape and every bundled icon in at least one golden file; property tests from [04](04-layout.md#testability) green |
| M3 | CLI | `apps/cli` with `render --format svg`, `check`, `fmt` | CI renders the examples; `fmt` is idempotent |
| M4 | Web app | editor + live preview + diagnostics + SVG export | preview SVG == CLI SVG (byte-identical) |
| M5 | Exports | PNG (browser + CLI), React Flow JSON | the React Flow export loads in a test app with custom nodes |
| M6 | Obsidian | code block rendering, context menu exports, light/dark | released via GitHub; manual test in a vault |
| M7 | Visual editing | selection, properties panel, EditCommands from [06](06-applications.md#visual-editing) | every action produces a minimal text diff; undo works |

## Explicitly not in v0.1

- A freely movable canvas as the primary layout
- Perfect automatic layout
- Views / levels of abstraction
- `use` for external libraries
- Freely drawn shapes, raster images or graphics embedded per diagram
- Plausibility checks
- A VS Code extension
- Collaboration, backend, accounts

## After that

### v0.2 — Reuse and views

- `use "nxp-s32k.archlib"` — project-specific libraries, resolvable relative to the file
  or within the Obsidian vault
- **Views — done.** `view <id>` and `show in <view>` restrict components, pins, groups and
  connections to a level of abstraction; `sysarch render` writes one file per view
  (`architecture-overview.svg`, `architecture-interface.svg`, `architecture-detailed.svg`
  from a single source), the web app and the Obsidian plugin offer a selector. Rules in
  [02 DSL](02-dsl.md), section 4.6.
- **External components — done.** `external <id>: <template>` marks motors, buses,
  connectors, sensors and test equipment as context: a dashed contour makes the system
  boundary visible without colour, `I301` stays silent on them, and later plausibility
  rules must not expect complete interfaces there. Rules in
  [02 DSL](02-dsl.md), section 4.2; example
  [`examples/system-context.arch`](../examples/system-context.arch).
- `sysarch render` for Markdown files with several code blocks
- Bus as a shared rail (`component can0: bus`) that several participants attach to
- Icons from project-specific libraries via `use`
- **Connections inside `system` blocks — done.** A `system` carries the connections between
  its own components, so that the wiring of an ECU stays with the ECU; `W206` asks for a
  connection that crosses the system boundary to move up. Rules in
  [02 DSL](02-dsl.md), section 4.5.

### v0.3 — Engineering semantics

- Building blocks with metadata and interfaces:
  ```sysarch
  define S32K344 extends microcontroller {
      meta { manufacturer "NXP"  family "S32K3"  voltage "3.3 V" }
      interface can CAN0
      interface can CAN1
      interface spi SPI0
  }
  ```
- Plausibility rules, e.g.:
  ```
  E401 mcu.CAN0_TX is connected directly to can_bus.
       Expected: MCU → CAN transceiver → CAN bus
  ```
- Rules declared in libraries themselves (`rule`)
- Export for the requirements/system engineering toolchain (interface list as CSV/JSON)

### Later

- VS Code extension (language server based on `core` + a preview webview)
- Further exports: PDF, PPTX shapes, draw.io
- Themes as a DSL (`theme … { }`), once teams need their own corporate styles
  ([D20](decisions.md))

---

## Idea backlog

Collected, not yet scheduled for a version. Sorted by the topic they belong to.

### Slices, groups and navigation

- **Slices** — an end-to-end cut through the architecture along a function: every
  component and connection a given function touches, from the sensor to the actuator.
  Declared on the function, comparable to `view` above, but selected by function instead
  of by hand.
- **Groups** — a named summary of several components (subsystem, domain, ECU family)
  that can be rendered as a single block, or expanded.
- **Browser** — a menu in the web app and the Obsidian plugin that lists all slices and
  groups of a file and navigates to them. The first navigation UI beyond a single
  diagram, and the reason slices and groups need stable names.

### Signals and pages

- **Named, unconnected signals** — as in a schematic: a signal gets a name at both ends
  instead of a drawn line, so components that belong together logically can be spread
  across several pages or diagrams. This is a rendering decision, not a model change —
  the connection stays in the model, only the view resolves it to a label. Belongs next
  to the views from v0.2.

### Starting from the schematic

- Allow an architecture to start at the schematic level — pins, nets and parts first —
  and grow upwards, instead of only being refined top-down from the system level.
- **Documentation:** a guide describing the whole path — schematic → system
  architecture → coarse block diagram for presentations — and how one source is
  condensed into the next level. This is the guide that ties slices, groups and views
  together; it should be written once those exist.

### Layout

- An easier way to express layout arrangements besides grids — rows, columns, stacks,
  chains along a signal flow — so that the common cases need no explicit grid
  coordinates. Related to [04](04-layout.md).

---

## Open questions

None at the moment. Answered questions are recorded in the
[decisions](decisions.md) D18–D22.
