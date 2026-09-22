# Decisions

Settled design decisions. Changing one requires a new entry that explicitly supersedes the
old one.

| # | Decision | Rationale | Rejected |
|---|--------------|------------|-----------|
| D1 | **Text is the source of truth**; every other rendering is derived from it | diffable, reviewable, CI-ready; no two data models | canvas state as the source, JSON as the source |
| D2 | **Our own DSL** instead of a Mermaid extension | pins, zones, systems and templates do not fit Mermaid's model | Mermaid plugin, YAML/JSON format |
| D3 | **No pixels, no colours, no font sizes in the DSL** — only `size`, `importance`, `category` | a consistent appearance across all authors | free-form styling attributes |
| D4 | **One scene graph, SVG as the only rendering**; preview = export SVG | WYSIWYG without a second renderer | a separate canvas renderer for the preview |
| D5 | **Core without runtime dependencies**, our own layouter and router | determinism, full control over the rules, small bundles | Dagre, ELK.js, Graphviz |
| D6 | **Embedded font metrics** instead of `measureText` | identical geometry in the browser, Obsidian and Node | DOM measurement, a headless browser in the CLI |
| D7 | **Orthogonal routing** exclusively | technical readability | Bézier curves, free polylines |
| D8 | **`zone` = layout band, `system` = semantic boundary**, a strict tree | layout stays solvable; semantics stay expressible | a generic `group` for both; overlapping groups |
| D9 | **`theme` at document level, `category` at component level** | in the brainstorming both were called `style` — ambiguous | `style` for both |
| D10 | **Overrides only declarative** (`grid`, `hint row/column`) | robust against changes, no pixel drift | stored x/y coordinates |
| D11 | **Lossless AST + TextEdits** for visual editing | comments/formatting survive, minimal diffs | AST → reprint the whole file |
| D12 | **Templates in the DSL itself** (`define`), the library as `.archlib` | teams extend it without TypeScript | components hard-coded in the renderer |
| D13 | **Signal kinds as a fixed set** with groups, shared by pins and connections | line style and later rules need fixed semantics | free-form strings |
| D14 | **Metadata only in the `meta { }` block** | typos in keywords stay errors | arbitrary keys directly in the component |
| D15 | **Framework-free editor** (DOM + CodeMirror 6) | the same editor in the web app and in Obsidian | a React-based editor |
| D16 | **React Flow export without a React Flow dependency**, routed points included | the core stays free; the target application adopts the exact geometry | export via a React Flow instance |
| D17 | **Shapes from a fixed list, icons only from the library** — both only in the template, never per instance; no raster images | recognisability without style breaks; layout knows every contour; the export stays standalone and deterministic | freely defined SVG shapes, image URLs, an icon per instance |
| D18 | **Unknown pins are an error** (`E103` with a suggestion); the editor offers the quick fix "Create pin" as a TextEdit | typos do not silently create new pins; the text stays complete (D1, D11) | implicit creation in a sketch mode |
| D19 | **Inter as the only font in v0.1**; the font metrics generator is built font-agnostic | determinism with a single metrics set (D6); further fonts per theme remain possible without a rewrite | a corporate font per theme from v0.1 |
| D20 | **Themes as TypeScript design tokens in v0.1**; a theme DSL follows only once teams need their own corporate styles | keeps the language and M1/M2 small | `theme … { }` in `.archlib` from v0.1 |
| D21 | **Product and repository are named `sysarch`** | one name everywhere, renamed while nothing points at the old repository yet | repository name `architecture-sketch` until release |
| D22 | **MIT licence** | short, permissive, common in the TypeScript/Obsidian ecosystem | Apache-2.0, MPL-2.0 |
| D23 | **Inline SVG in the DOM with a prefix per diagram** (font family, `id`s); exports stay unchanged | `@font-face` and `id`s are document-wide — several diagrams in one note and the UI font of Obsidian or the web app must not overwrite each other | `<img>` with a data URL (loses DOM access for selection in M7), unique IDs already in the renderer (would break byte equality and the golden files) |
| D24 | **`external` as a keyword in place of `component`**, not a category and not a shape; the difference is shown by a dashed contour | being outside the system is a property of the element, orthogonal to template, category and shape — a vehicle bus is external *and* a bus; a category would have collided with the colour families (D9) and a shape with the fixed five (D17) | a library category `external`, a sixth shape, a property `external true` inside the component block |
| D25 | **Connections are allowed inside `system`, never inside `zone`**; where they are written does not change the model, but both endpoints must belong to the system (`W206`) | a system is the semantic boundary, and its internal wiring belongs with it — in a large document the connection list otherwise says nothing about which ECU it describes; a zone is a layout band (D8) and carries no semantics | connections in every group block including `zone`, free placement without a locality rule, a separate `wiring` block |
