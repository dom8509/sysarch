import type {
  ComponentNode, ConnectionNode, EndpointNode, GridNode, GroupStmt, HintStmt, ShowStmt, SyntaxTree,
} from "../ast/index.js";
import { diagnostic, withSuggestion, type Diagnostic, type ParseResult } from "../diagnostics/index.js";
import {
  CATEGORIES, SIGNAL_GROUPS, THEMES, isOneOf,
  type Category, type Direction, type Importance, type LayoutMode, type PinDisplay, type StackMode, type Shape, type Side,
  type SignalKind, type Size, type Span,
} from "../types.js";
import { resolveDefines, type Library, type TemplateDef } from "./library.js";
import { declarePin, signalKind, type PinDraft } from "./pins.js";
import { Visibility } from "./views.js";

export type ComponentId = string;
export type GroupId = string;
export type PinAddress = `${ComponentId}.${string}`;

export interface ArchitectureModel {
  title: string;
  /** Name only; resolved during layout. */
  theme: string;
  direction: Direction;
  layoutMode: LayoutMode;
  /** How pins are shown; pins stay in the model, the layout hides them. */
  pins: PinDisplay;
  /** `identical`: layout and exports merge identically wired components (`stackIdentical`). */
  stack: StackMode;
  /** `layout { pin spacing N }`: pin distance in grid units; without it the theme decides. */
  pinSpacing?: number;
  grid?: GridSpec;
  /** Insertion order = declaration order. */
  components: Map<ComponentId, Component>;
  connections: Connection[];
  /** Root of the group tree; zones are direct children, if present. */
  root: Group;
  /** All zones and systems by ID. */
  groups: Map<GroupId, Group>;
  /** Declaration order; empty when the document knows no views. */
  views: View[];
}

/** A level of abstraction: `projectView` reduces the model to the elements it shows. */
export interface View {
  id: string;
  label: string;
  origin: Span;
}

export interface Component {
  id: ComponentId;
  /**
   * Declared with `external`: part of the context, not of the described system. Drawn with a
   * dashed contour; rules never expect a complete set of interfaces on it.
   */
  external: boolean;
  /** "block" if none is given. */
  template: string;
  shape: Shape;
  icon?: string;
  label: string;
  category: Category;
  size: Size;
  importance: Importance;
  /** Order = rendering order. */
  pins: Pin[];
  hints: { row?: number; column?: number };
  /** Number of identical elements (`count`), at least 1. */
  count: number;
  meta: Record<string, string>;
  /** E.g. ["processing", "ecu"]. */
  groupPath: GroupId[];
  /** `show in …`; missing = every view. */
  views?: string[];
  origin: Span;
}

export interface Pin {
  name: string;
  label: string;
  kind: SignalKind;
  side: Side;
  sideSource: "explicit" | "template" | "inferred";
  /** `show in …`; missing = every view in which the component is shown. */
  views?: string[];
  origin: Span;
}

export interface Endpoint {
  component: ComponentId;
  /** Missing → attaches to the component body. */
  pin?: string;
}

export interface Connection {
  /** Stable: "<source>-><target>#<n>". */
  id: string;
  source: Endpoint;
  target: Endpoint;
  direction: "forward" | "bidirectional" | "none";
  kind: SignalKind;
  kindSource: "explicit" | "inferred";
  label?: string;
  /** `show in …`; missing = every view in which both endpoints are shown. */
  views?: string[];
  origin: Span;
}

export interface Group {
  id: GroupId;
  type: "root" | "zone" | "system";
  label?: string;
  children: (GroupId | ComponentId)[];
  /** `show in …`; missing = every view in which the parent is shown. */
  views?: string[];
  origin: Span;
}

export interface GridSpec {
  /** null = ".". A component spanning several cells appears in each of them (always a rectangle). */
  rows: (ComponentId | null)[][];
  origin: Span;
}

const DEFAULT_THEME = "automotive-light";
const BLOCK: TemplateDef = { name: "block", category: "generic", size: "medium", pins: [], origin: { start: 0, end: 0, line: 1, column: 1 } };

/** Resolves templates, checks IDs and pins, derives sides and types. */
export function resolve(tree: SyntaxTree, library: Library): ParseResult<ArchitectureModel> {
  const diagnostics: Diagnostic[] = [];
  const arch = tree.architecture;

  // ── Templates ────────────────────────────────────────────────

  for (const define of tree.defines) {
    if (library.templates.has(define.name.name)) {
      diagnostics.push(diagnostic("W203", `Local template \`${define.name.name}\` overrides the library template`, define.name.span));
    }
  }
  const templates = new Map(library.templates);
  for (const [name, def] of resolveDefines(tree.defines, library.templates, library.icons, diagnostics)) {
    templates.set(name, def);
  }

  const model: ArchitectureModel = {
    title: arch?.title.value ?? "",
    theme: DEFAULT_THEME,
    direction: "LR",
    layoutMode: "strict",
    pins: "all",
    stack: "none",
    components: new Map(),
    connections: [],
    views: [],
    root: { id: "root", type: "root", children: [], origin: arch?.span ?? tree.span },
    groups: new Map(),
  };

  if (arch === undefined) {
    diagnostics.push(diagnostic("E001", "Expected `architecture`, found end of file", { start: tree.span.end, end: tree.span.end, line: 1, column: 1 }));
    return { value: model, diagnostics };
  }

  // ── Document settings ────────────────────────────────────────

  const viewIds = new Map<string, Span>();
  let gridNode: GridNode | undefined;
  for (const stmt of arch.body) {
    switch (stmt.kind) {
      case "View": {
        const id = stmt.id.name;
        if (viewIds.has(id)) {
          diagnostics.push(diagnostic("E101", `View ID \`${id}\` is already in use`, stmt.id.span));
          break;
        }
        viewIds.set(id, stmt.id.span);
        let label = id;
        for (const item of stmt.body) label = item.value.value;
        model.views.push({ id, label, origin: stmt.span });
        break;
      }
      case "Theme":
        if (THEMES.includes(stmt.name.name)) model.theme = stmt.name.name;
        else diagnostics.push(withSuggestion("E109", `Unknown theme \`${stmt.name.name}\``, stmt.name.name, stmt.name.span, THEMES));
        break;
      case "Direction":
        model.direction = stmt.value;
        break;
      case "Pins":
        model.pins = stmt.value;
        break;
      case "Stack":
        model.stack = stmt.value;
        break;
      case "Layout":
        for (const item of stmt.body) {
          if (item.kind === "Mode") model.layoutMode = item.value;
          else if (item.kind === "PinSpacing") model.pinSpacing = item.value;
          else gridNode = item;
        }
        break;
    }
  }

  // ── Views ────────────────────────────────────────────────────

  /** Spans of the `show in` statements, for `W204`. */
  const showSpans = new Map<string, Span>();

  /** Validated view list of a `show in`; unknown names are dropped and reported. */
  const viewList = (stmts: readonly ShowStmt[], key: string): string[] | undefined => {
    if (stmts.length === 0) return undefined;
    const names: string[] = [];
    for (const stmt of stmts) {
      showSpans.set(key, showSpans.get(key) ?? stmt.span);
      for (const view of stmt.views) {
        if (!viewIds.has(view.name)) {
          diagnostics.push(model.views.length === 0
            ? diagnostic("E112", `Unknown view \`${view.name}\` — the architecture declares no \`view\``, view.span)
            : withSuggestion("E112", `Unknown view \`${view.name}\``, view.name, view.span, viewIds.keys()));
          continue;
        }
        if (!names.includes(view.name)) names.push(view.name);
      }
    }
    return names;
  };

  // ── Group tree and components ────────────────────────────────

  const hasZones = arch.body.some((s) => s.kind === "Zone");
  const usedIds = new Map<string, Span>();
  const zoneOf = new Map<ComponentId, number>();
  const hintSpans = new Map<ComponentId, Partial<Record<"row" | "column", Span>>>();
  let zoneIndex = -1;

  const claimId = (id: string, span: Span, what: string): boolean => {
    if (usedIds.has(id)) {
      diagnostics.push(diagnostic("E101", `${what} ID \`${id}\` is already in use`, span));
      return false;
    }
    usedIds.set(id, span);
    return true;
  };

  const addComponent = (node: ComponentNode, group: Group, path: GroupId[], inZone: boolean) => {
    const id = node.id.name;
    if (!claimId(id, node.id.span, "Component")) return;
    if (hasZones && !inZone) {
      diagnostics.push(diagnostic("E106", `Component \`${id}\` is outside any zone, although the document uses zones`, node.id.span));
    }
    const component = resolveComponent(node, path);
    model.components.set(id, component);
    group.children.push(id);
    if (inZone) zoneOf.set(id, zoneIndex);
  };

  const resolveComponent = (node: ComponentNode, groupPath: GroupId[]): Component => {
    const templateName = node.template?.name ?? "block";
    let template = templates.get(templateName) ?? (templateName === "block" ? BLOCK : undefined);
    if (template === undefined) {
      diagnostics.push(withSuggestion("E104", `Unknown template \`${templateName}\``, templateName, node.template!.span, templates.keys()));
      template = templates.get("block") ?? BLOCK;
    }

    const component: Component = {
      id: node.id.name,
      external: node.external === true,
      template: template.name,
      shape: template.shape ?? "rounded",
      ...(template.icon && { icon: template.icon }),
      label: template.label ?? node.id.name,
      category: template.category ?? "generic",
      size: template.size ?? "medium",
      importance: "secondary",
      pins: [],
      hints: {},
      count: 1,
      meta: {},
      groupPath,
      origin: node.span,
    };

    const shows: ShowStmt[] = [];
    const pins: PinDraft[] = template.pins.map((p) => ({
      ...p,
      ...(p.side && { sideSource: "template" as const }),
      origin: node.id.span,
      declaredHere: false,
    }));
    const hints: Partial<Record<"row" | "column", Span>> = {};

    for (const stmt of node.body ?? []) {
      switch (stmt.kind) {
        case "Label":
          component.label = stmt.value.value;
          break;
        case "Size":
          component.size = stmt.value;
          break;
        case "Importance":
          component.importance = stmt.value;
          break;
        case "Category":
          if (isOneOf(CATEGORIES, stmt.value.name)) component.category = stmt.value.name;
          else diagnostics.push(withSuggestion("E109", `Unknown category \`${stmt.value.name}\``, stmt.value.name, stmt.value.span, CATEGORIES));
          break;
        case "Pin":
          declarePin(pins, stmt, undefined, "explicit", diagnostics);
          break;
        case "SideBlock":
          for (const pin of stmt.pins) declarePin(pins, pin, stmt.side, "explicit", diagnostics);
          break;
        case "Hint":
          applyHint(component, stmt, hints);
          break;
        case "Count":
          component.count = stmt.value;
          break;
        case "Meta":
          for (const entry of stmt.entries) component.meta[entry.key.name] = entry.value.value;
          break;
        case "Show":
          shows.push(stmt);
          break;
      }
    }

    const views = viewList(shows, component.id);
    if (views) component.views = views;
    component.pins = pins.map((p) => ({
      name: p.name,
      label: p.label ?? p.name,
      kind: p.kind,
      side: p.side ?? "left",
      sideSource: p.side ? p.sideSource ?? "explicit" : "inferred",
      ...(p.views && { views: viewList(p.views, `${component.id}.${p.name}`) ?? [] }),
      origin: p.origin,
    }));
    hintSpans.set(component.id, hints);
    return component;
  };

  const applyHint = (component: Component, stmt: HintStmt, spans: Partial<Record<"row" | "column", Span>>) => {
    if (model.layoutMode === "strict") {
      diagnostics.push(diagnostic("W202", `\`hint ${stmt.axis}\` is ignored in \`mode strict\` — set \`layout { mode assisted }\``, stmt.span));
      return;
    }
    component.hints[stmt.axis] = stmt.value;
    spans[stmt.axis] = stmt.span;
  };

  /** Document order; a connection inside a `system` knows the system it was written in. */
  const connectionNodes: { node: ConnectionNode; system?: GroupId }[] = [];

  const walkGroup = (body: readonly GroupStmt[], group: Group, path: GroupId[], inZone: boolean) => {
    for (const stmt of body) {
      switch (stmt.kind) {
        case "Label":
          group.label = stmt.value.value;
          break;
        case "Show": {
          const views = viewList([stmt], group.id);
          group.views = [...new Set([...(group.views ?? []), ...(views ?? [])])];
          break;
        }
        case "System": {
          if (!claimId(stmt.id.name, stmt.id.span, "System")) break;
          const system: Group = { id: stmt.id.name, type: "system", children: [], origin: stmt.span };
          model.groups.set(system.id, system);
          group.children.push(system.id);
          walkGroup(stmt.body, system, [...path, system.id], inZone);
          break;
        }
        case "Component":
          addComponent(stmt, group, path, inZone);
          break;
        case "Connection":
          // Only a system reaches this point — the parser rejects connections in a zone.
          connectionNodes.push({ node: stmt, system: group.id });
          break;
      }
    }
  };

  for (const stmt of arch.body) {
    switch (stmt.kind) {
      case "Zone": {
        zoneIndex++;
        if (!claimId(stmt.id.name, stmt.id.span, "Zone")) break;
        const zone: Group = { id: stmt.id.name, type: "zone", children: [], origin: stmt.span };
        model.groups.set(zone.id, zone);
        model.root.children.push(zone.id);
        walkGroup(stmt.body, zone, [zone.id], true);
        break;
      }
      case "System":
        walkGroup([stmt], model.root, [], false);
        break;
      case "Component":
        addComponent(stmt, model.root, [], false);
        break;
      case "Connection":
        connectionNodes.push({ node: stmt });
        break;
    }
  }

  // ── Connections ──────────────────────────────────────────────

  const incoming = new Map<PinAddress, number>();
  const outgoing = new Map<PinAddress, number>();
  const connected = new Set<PinAddress>();
  const connectionCount = new Map<string, number>();

  const resolveEndpoint = (node: EndpointNode): { endpoint: Endpoint; pin?: Pin } | undefined => {
    const componentId = node.component.name;
    const component = model.components.get(componentId);
    if (component === undefined) {
      diagnostics.push(withSuggestion("E102", `Unknown component \`${componentId}\``, componentId, node.component.span, model.components.keys()));
      return undefined;
    }
    if (node.pin === undefined) return { endpoint: { component: componentId } };
    const pin = component.pins.find((p) => p.name === node.pin!.name);
    if (pin === undefined) {
      diagnostics.push(withSuggestion(
        "E103",
        `Unknown pin \`${node.pin.name}\` on component \`${componentId}\``,
        node.pin.name,
        node.pin.span,
        component.pins.map((p) => p.name),
      ));
      return undefined;
    }
    return { endpoint: { component: componentId, pin: pin.name }, pin };
  };

  const address = (e: Endpoint) => (e.pin === undefined ? e.component : `${e.component}.${e.pin}`);

  /** A connection written inside a system describes that system's own wiring (§4.5). */
  const checkInside = (system: GroupId, node: EndpointNode) => {
    const component = model.components.get(node.component.name);
    if (component === undefined || component.groupPath.includes(system)) return;
    diagnostics.push(diagnostic(
      "W206",
      `\`${node.component.name}\` is not part of system \`${system}\` — write this connection in the architecture`,
      node.component.span,
    ));
  };

  for (const { node, system } of connectionNodes) {
    const from = resolveEndpoint(node.from);
    const to = resolveEndpoint(node.to);
    if (from === undefined || to === undefined) continue;
    if (system !== undefined) {
      checkInside(system, node.from);
      checkInside(system, node.to);
    }

    const [source, target] = node.arrow === "<-" ? [to, from] : [from, to];
    const direction = node.arrow === "<->" ? "bidirectional" : node.arrow === "--" ? "none" : "forward";

    let label: string | undefined;
    let explicitKind: SignalKind | undefined;
    let invalidKind = false;
    const shows: ShowStmt[] = [];
    for (const stmt of node.body ?? []) {
      if (stmt.kind === "Label") {
        label = stmt.value.value;
      } else if (stmt.kind === "Show") {
        shows.push(stmt);
      } else {
        const before = diagnostics.length;
        const kind = signalKind(stmt.value.name, stmt.value.span, diagnostics);
        if (diagnostics.length === before) explicitKind = kind;
        else invalidKind = true;
      }
    }

    let kind: SignalKind;
    if (explicitKind) {
      kind = explicitKind;
    } else if (source.pin && target.pin) {
      kind = source.pin.kind;
      if (SIGNAL_GROUPS[source.pin.kind] !== SIGNAL_GROUPS[target.pin.kind] && !invalidKind) {
        diagnostics.push(diagnostic(
          "W201",
          `Connection between incompatible signal kinds \`${source.pin.kind}\` and \`${target.pin.kind}\` — set \`type\` explicitly if this is intended`,
          node.span,
        ));
      }
    } else {
      kind = source.pin?.kind ?? target.pin?.kind ?? "signal";
    }

    const key = `${address(source.endpoint)}->${address(target.endpoint)}`;
    const n = (connectionCount.get(key) ?? 0) + 1;
    connectionCount.set(key, n);
    const id = `${key}#${n}`;
    const views = viewList(shows, id);

    model.connections.push({
      id,
      source: source.endpoint,
      target: target.endpoint,
      direction,
      kind,
      kindSource: explicitKind ? "explicit" : "inferred",
      ...(label !== undefined && { label }),
      ...(views && { views }),
      origin: node.span,
    });

    for (const [end, counter] of [[source.endpoint, outgoing], [target.endpoint, incoming]] as const) {
      if (end.pin === undefined) continue;
      const pinAddress = address(end) as PinAddress;
      connected.add(pinAddress);
      if (direction === "forward") counter.set(pinAddress, (counter.get(pinAddress) ?? 0) + 1);
    }
  }

  // ── Derive pin sides, report unconnected pins ────────────────

  for (const component of model.components.values()) {
    for (const pin of component.pins) {
      const pinAddress: PinAddress = `${component.id}.${pin.name}`;
      if (pin.sideSource === "inferred") {
        const inCount = incoming.get(pinAddress) ?? 0;
        const outCount = outgoing.get(pinAddress) ?? 0;
        const towardsEnd = outCount > inCount;
        pin.side = model.direction === "LR" ? (towardsEnd ? "right" : "left") : (towardsEnd ? "bottom" : "top");
      }
      // With `pins connected|none` unconnected pins are not drawn — no hint needed.
      // External components are never fully specified: a loose pin is the normal case there.
      if (!connected.has(pinAddress) && model.pins === "all" && !component.external) {
        diagnostics.push(diagnostic("I301", `Pin \`${pinAddress}\` is not connected`, pin.origin));
      }
    }
  }

  // ── Views: nothing shown anywhere? ───────────────────────────

  if (model.views.length > 0) {
    const visibility = new Visibility(model);
    const used = new Set<string>();
    const check = (key: string, declared: readonly string[] | undefined, views: readonly string[], what: string) => {
      const span = showSpans.get(key);
      if (declared === undefined || views.length > 0 || span === undefined) return;
      diagnostics.push(diagnostic("W204", `${what} is not shown in any view — its \`show in\` does not overlap with the views of its surroundings`, span));
    };

    for (const group of model.groups.values()) {
      check(group.id, group.views, visibility.group(group.id), `${group.type === "zone" ? "Zone" : "System"} \`${group.id}\``);
    }
    for (const component of model.components.values()) {
      const componentViews = visibility.component(component);
      for (const view of componentViews) used.add(view);
      check(component.id, component.views, componentViews, `Component \`${component.id}\``);
      for (const pin of component.pins) {
        check(`${component.id}.${pin.name}`, pin.views, visibility.pin(component, pin), `Pin \`${component.id}.${pin.name}\``);
      }
    }
    for (const connection of model.connections) {
      check(connection.id, connection.views, visibility.connection(connection), `Connection \`${connection.id}\``);
    }
    for (const view of model.views) {
      if (!used.has(view.id)) {
        diagnostics.push(diagnostic("W205", `View \`${view.id}\` shows no component`, view.origin));
      }
    }
  }

  // ── Grid ─────────────────────────────────────────────────────

  /** Position along the main axis, 1-based; `end` > `value` for spanned cells. */
  const position = new Map<ComponentId, { value: number; end: number; span: Span }>();
  const mainAxis = model.direction === "LR" ? "column" : "row";

  if (gridNode) {
    // Collect cells per component; listed several times = spanned, if they form a rectangle.
    const cellsOf = new Map<ComponentId, { row: number; column: number; span: Span }[]>();
    const rows = gridNode.rows.map((row, rowIndex) =>
      row.cells.map((cell, columnIndex) => {
        if (cell.id === undefined) return null;
        const id = cell.id.name;
        if (!model.components.has(id)) {
          diagnostics.push(withSuggestion("E102", `Unknown component \`${id}\` in the grid`, id, cell.id.span, model.components.keys()));
          return null;
        }
        if (!cellsOf.has(id)) cellsOf.set(id, []);
        cellsOf.get(id)!.push({ row: rowIndex, column: columnIndex, span: cell.id.span });
        return id;
      }),
    );
    for (const [id, cells] of cellsOf) {
      const top = Math.min(...cells.map((c) => c.row));
      const bottom = Math.max(...cells.map((c) => c.row));
      const left = Math.min(...cells.map((c) => c.column));
      const right = Math.max(...cells.map((c) => c.column));
      const rectangle = cells.length === (bottom - top + 1) * (right - left + 1) &&
        rows.slice(top, bottom + 1).every((row) => row.slice(left, right + 1).every((cell) => cell === id) && row.length > right);
      if (!rectangle) {
        diagnostics.push(diagnostic("E107", `Cells of \`${id}\` in the grid do not form a contiguous rectangle`, cells[1]!.span));
        for (const row of rows) row.forEach((cell, k) => { if (cell === id) row[k] = null; });
        continue;
      }
      position.set(id, mainAxis === "column"
        ? { value: left + 1, end: right + 1, span: cells[0]!.span }
        : { value: top + 1, end: bottom + 1, span: cells[0]!.span });
    }
    const width = rows[0]?.length ?? 0;
    gridNode.rows.forEach((row, rowIndex) => {
      if (row.cells.length !== width) {
        diagnostics.push(diagnostic("E107", `Grid row ${rowIndex + 1} has ${row.cells.length} cells, expected ${width}`, row.span));
      }
    });
    model.grid = { rows, origin: gridNode.span };
  }

  for (const component of model.components.values()) {
    const value = component.hints[mainAxis];
    const span = hintSpans.get(component.id)?.[mainAxis];
    if (value !== undefined && span !== undefined) position.set(component.id, { value, end: value, span });
  }

  // ── Zone contiguity ──────────────────────────────────────────

  if (hasZones) {
    const placed = [...position.entries()].filter(([id]) => zoneOf.has(id));
    const axisName = mainAxis === "column" ? "column" : "row";
    const zoneIds = arch.body.filter((s) => s.kind === "Zone").map((z) => z.id.name);
    for (const [id, pos] of placed) {
      const zone = zoneOf.get(id)!;
      // Exactly one message per pair, at the element of the later zone.
      const conflict = placed.find(([otherId, other]) => zoneOf.get(otherId)! < zone && other.end >= pos.value);
      if (conflict === undefined) continue;
      const [otherId, other] = conflict;
      diagnostics.push(diagnostic(
        "E108",
        `\`${id}\` (zone \`${zoneIds[zone]}\`, ${axisName} ${pos.value}) is not after \`${otherId}\` (zone \`${zoneIds[zoneOf.get(otherId)!]}\`, ${axisName} ${other.end}) — zones must stay contiguous and in declaration order`,
        pos.span,
      ));
    }
  }

  return { value: model, diagnostics };
}
