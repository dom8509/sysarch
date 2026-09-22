import type {
  ArchitectureNode, CategoryStmt, ComponentNode, ComponentStmt, ConnectionNode, DefineNode,
  DefineStmt, DirectionStmt, PinsStmt, PinSpacingStmt, StackStmt, CountStmt, EndpointNode, GridCell, GridNode, GridRow, GroupStmt, HintStmt,
  Ident, IconStmt, ImportanceStmt, LabelStmt, LayoutStmt, MetaBlock, MetaEntry, ModeStmt,
  PinStmt, ShapeStmt, ShowStmt, SideBlock, SizeStmt, Statement, StringLit, SyntaxNode, SyntaxTree,
  SystemNode, ThemeStmt, Trivia, TypeStmt, ViewNode, ZoneNode, ZoneStmt,
} from "../ast/index.js";
import { diagnostic, withSuggestion, type Diagnostic, type ParseResult } from "../diagnostics/index.js";
import { lex, type Token, type TokenType } from "../lexer/index.js";
import {
  DIRECTIONS, IMPORTANCES, LAYOUT_MODES, PIN_DISPLAYS, SIDES, STACK_MODES, SIZES,
  type Arrow, type Direction, type Importance, type LayoutMode, type PinDisplay, type StackMode, type Side, type Size, type Span,
} from "../types.js";

/** Constructs from later versions (02-dsl.md §4.9) with the version that introduces them. */
const RESERVED: Readonly<Record<string, string>> = {
  use: "v0.2",
  interface: "v0.3",
  rule: "v0.3",
};

const ARROWS: readonly TokenType[] = ["->", "<-", "<->", "--"];

const ARCH_KEYWORDS = ["theme", "direction", "pins", "stack", "view", "layout", "zone", "system", "component", "external"];
const GROUP_KEYWORDS = ["label", "show", "system", "component", "external"];
const COMPONENT_KEYWORDS = ["label", "size", "importance", "category", "pin", ...SIDES, "hint", "count", "meta", "show"];
const DEFINE_KEYWORDS = ["label", "size", "category", "shape", "icon", "pin", ...SIDES];
const CONNECTION_KEYWORDS = ["label", "type", "show"];
const LAYOUT_KEYWORDS = ["mode", "pin", "grid"];

/** Thrown after a syntax error has been reported and caught at statement level. */
const BAIL = Symbol("bail");

/**
 * Error-tolerant recursive descent parser. Always returns a syntax tree; after an error it
 * synchronises on the next `}` or the next statement keyword.
 */
export function parse(source: string): ParseResult<SyntaxTree> {
  const lexed = lex(source);
  const tokens = lexed.tokens;
  const diagnostics: Diagnostic[] = [...lexed.diagnostics];
  let i = 0;
  let lastErrorAt = -1;

  // ── Token access ─────────────────────────────────────────────

  const peek = (k = 0): Token => tokens[Math.min(i + k, tokens.length - 1)]!;
  const previous = (): Token => tokens[Math.max(i - 1, 0)]!;
  const next = (): Token => {
    const t = peek();
    if (t.type !== "eof") i++;
    return t;
  };
  const at = (type: TokenType, k = 0) => peek(k).type === type;
  const atWord = (word: string, k = 0) => peek(k).type === "ident" && peek(k).text === word;

  const describe = (t: Token): string => {
    switch (t.type) {
      case "eof": return "end of file";
      case "ident": return `\`${t.text}\``;
      case "string": return `string ${t.text}`;
      case "int": return `number ${t.text}`;
      case "invalid": return `unexpected character \`${t.text}\``;
      default: return `\`${t.text}\``;
    }
  };

  const report = (d: Diagnostic) => {
    // Only one syntax error per position, so follow-up errors do not cascade.
    if (d.span.start === lastErrorAt) return;
    lastErrorAt = d.span.start;
    diagnostics.push(d);
  };

  const fail = (expected: string, t: Token = peek()): never => {
    report(diagnostic("E001", `Expected ${expected}, found ${describe(t)}`, t.span));
    throw BAIL;
  };

  const expect = (type: TokenType, expected: string): Token => (at(type) ? next() : fail(expected));

  const expectWord = <T extends string>(words: readonly T[]): T => {
    const t = peek();
    if (t.type === "ident" && (words as readonly string[]).includes(t.text)) {
      next();
      return t.text as T;
    }
    const expected = words.map((w) => `\`${w}\``).join(" | ");
    if (t.type === "ident") {
      report(withSuggestion("E001", `Expected ${expected}, found ${describe(t)}`, t.text, t.span, words));
      throw BAIL;
    }
    return fail(expected);
  };

  // ── Nodes ────────────────────────────────────────────────────

  const spanFrom = (start: Token): Span => ({
    start: start.span.start,
    end: Math.max(previous().span.end, start.span.end),
    line: start.span.line,
    column: start.span.column,
  });

  const node = <N extends SyntaxNode>(start: Token, fields: Omit<N, "span" | "leadingTrivia">): N =>
    ({ ...fields, span: spanFrom(start), leadingTrivia: start.leadingTrivia }) as N;

  const ident = (): Ident => {
    const t = expect("ident", "an identifier");
    return { kind: "Ident", name: t.text, span: t.span, leadingTrivia: [] };
  };

  /**
   * Identifier inside a statement that has already begun. If a keyword appears on a new line,
   * the next statement probably starts there — the current one is incomplete.
   */
  const operand = (keywords: readonly string[]): Ident => {
    const t = peek();
    if (t.type === "ident" && t.newlineBefore && keywords.includes(t.text)) fail("an identifier");
    return ident();
  };

  const string = (): StringLit => {
    const t = expect("string", "a string");
    return { kind: "String", value: t.value, span: t.span, leadingTrivia: [] };
  };

  // ── Blocks and error handling ────────────────────────────────

  const skipBalanced = () => {
    let depth = 0;
    do {
      const t = next();
      if (t.type === "{") depth++;
      else if (t.type === "}") depth--;
    } while (depth > 0 && !at("eof"));
  };

  /** Skips ahead to just before the next `}` or the start of the next statement. */
  const recover = (statementStart: number, keywords: readonly string[]) => {
    while (!at("eof") && !at("}")) {
      const t = peek();
      if (i > statementStart && t.type === "ident" && (t.newlineBefore || keywords.includes(t.text))) return;
      if (t.type === "{") skipBalanced();
      else next();
    }
  };

  /**
   * Reads `{ item* }` (the opening brace has already been consumed). An error in one item
   * discards only that item. If the closing brace is missing, the block is kept.
   */
  const block = <T>(
    parseItem: () => T | undefined,
    keywords: readonly string[],
  ): { items: T[]; closingTrivia: Trivia[] } => {
    const items: T[] = [];
    while (!at("}") && !at("eof")) {
      const statementStart = i;
      try {
        const item = parseItem();
        if (item !== undefined) items.push(item);
      } catch (e) {
        if (e !== BAIL) throw e;
        recover(statementStart, keywords);
      }
    }
    const closingTrivia = peek().leadingTrivia;
    if (at("}")) next();
    else report(diagnostic("E001", "Expected `}`, found end of file", peek().span));
    return { items, closingTrivia };
  };

  const withClosing = <N extends SyntaxNode>(n: N, closingTrivia: Trivia[]): N => {
    if (closingTrivia.length > 0) n.closingTrivia = closingTrivia;
    return n;
  };

  const isReserved = (): boolean => {
    const t = peek();
    if (t.type !== "ident" || !Object.hasOwn(RESERVED, t.text)) return false;
    const following = peek(1).type;
    return following !== "." && following !== ":" && !ARROWS.includes(following);
  };

  /** Reports a reserved construct and skips it to the end of the line or block. */
  const skipReserved = (): undefined => {
    const t = next();
    report(diagnostic("E110", `\`${t.text}\` is only available from ${RESERVED[t.text]} on`, t.span));
    while (!at("eof") && !at("}") && !peek().newlineBefore) {
      if (at("{")) skipBalanced();
      else next();
    }
    return undefined;
  };

  const unknownStatement = (keywords: readonly string[], context: string): never => {
    const t = peek();
    if (t.type !== "ident") return fail(`a statement in ${context}`);
    report(withSuggestion("E001", `Unknown statement \`${t.text}\` in ${context}`, t.text, t.span, keywords));
    throw BAIL;
  };

  // ── Shared statements ────────────────────────────────────────

  const label = (): LabelStmt => {
    const start = next();
    return node<LabelStmt>(start, { kind: "Label", value: string() });
  };

  const size = (): SizeStmt => {
    const start = next();
    return node<SizeStmt>(start, { kind: "Size", value: expectWord<Size>(SIZES) });
  };

  const category = (): CategoryStmt => {
    const start = next();
    return node<CategoryStmt>(start, { kind: "Category", value: ident() });
  };

  /** `show in overview, detailed` — at least one view, separated by commas. */
  const show = (): ShowStmt => {
    const start = next();
    expectWord(["in"] as const);
    const views: Ident[] = [ident()];
    while (at(",")) {
      next();
      views.push(ident());
    }
    return node<ShowStmt>(start, { kind: "Show", views });
  };

  /** `allowShow`: pins in `define` have no `show in` — views belong to the instance. */
  const pin = (allowShow = true): PinStmt => {
    if (!atWord("pin")) return unknownStatement(["pin"], "a side block");
    const start = next();
    const signal = operand(COMPONENT_KEYWORDS);
    const name = operand(COMPONENT_KEYWORDS);
    const pinLabel = at("string") ? string() : undefined;
    const n = node<PinStmt>(start, { kind: "Pin", signal, name, ...(pinLabel && { label: pinLabel }) });
    if (!at("{")) return n;
    if (!allowShow) {
      report(diagnostic("E001", "`show in` is only allowed in a component, not in `define`", peek().span));
      throw BAIL;
    }
    next();
    const pinStmt = (): ShowStmt => {
      if (atWord("show")) return show();
      return unknownStatement(["show"], "a pin");
    };
    const { items, closingTrivia } = block(pinStmt, ["show"]);
    return withClosing(node<PinStmt>(start, { ...n, body: items }), closingTrivia);
  };

  const sideBlock = (allowShow = true): SideBlock => {
    const start = next();
    const side = start.text as Side;
    expect("{", "`{`");
    const { items, closingTrivia } = block(() => pin(allowShow), ["pin"]);
    return withClosing(node<SideBlock>(start, { kind: "SideBlock", side, pins: items }), closingTrivia);
  };

  // ── Components ───────────────────────────────────────────────

  const hint = (): HintStmt => {
    const start = next();
    const axis = expectWord(["row", "column"] as const);
    const value = expect("int", "a number ≥ 1");
    const n = Number(value.text);
    if (n < 1) {
      report(diagnostic("E001", `Expected a number ≥ 1, found ${value.text}`, value.span));
    }
    return node<HintStmt>(start, { kind: "Hint", axis, value: Math.max(1, n) });
  };

  const count = (): CountStmt => {
    const start = next();
    const value = expect("int", "a number ≥ 1");
    const n = Number(value.text);
    if (n < 1) {
      report(diagnostic("E001", `Expected a number ≥ 1, found ${value.text}`, value.span));
    }
    return node<CountStmt>(start, { kind: "Count", value: Math.max(1, n) });
  };

  const meta = (): MetaBlock => {
    const start = next();
    expect("{", "`{`");
    const entry = (): MetaEntry => {
      const keyToken = peek();
      const key = ident();
      return node<MetaEntry>(keyToken, { kind: "MetaEntry", key, value: string() });
    };
    const { items, closingTrivia } = block(entry, []);
    return withClosing(node<MetaBlock>(start, { kind: "Meta", entries: items }), closingTrivia);
  };

  const componentStmt = (): ComponentStmt | undefined => {
    if (isReserved()) return skipReserved();
    const t = peek();
    if (t.type === "ident") {
      switch (t.text) {
        case "label": return label();
        case "size": return size();
        case "importance": {
          const start = next();
          return node<ImportanceStmt>(start, { kind: "Importance", value: expectWord<Importance>(IMPORTANCES) });
        }
        case "category": return category();
        case "pin": return pin();
        case "left": case "right": case "top": case "bottom": return sideBlock();
        case "hint": return hint();
        case "count": return count();
        case "meta": return meta();
        case "show": return show();
      }
    }
    return unknownStatement(COMPONENT_KEYWORDS, "a component");
  };

  /** `component id` and `external id` differ only in the keyword. */
  const component = (): ComponentNode => {
    const start = next();
    const external = start.text === "external";
    const statementKeywords = [...ARCH_KEYWORDS, ...GROUP_KEYWORDS];
    const id = operand(statementKeywords);
    let template: Ident | undefined;
    if (at(":")) {
      next();
      template = operand(statementKeywords);
    }
    const n = node<ComponentNode>(start, { kind: "Component", id, ...(external && { external: true as const }), ...(template && { template }) });
    if (!at("{")) return n;
    next();
    const { items, closingTrivia } = block(componentStmt, COMPONENT_KEYWORDS);
    return withClosing(node<ComponentNode>(start, { ...n, body: items }), closingTrivia);
  };

  // ── Zones and systems ────────────────────────────────────────

  /** `connections`: only a system carries them — a zone is a layout band (02-dsl.md §4.5). */
  const groupStmt = (context: string, connections: boolean) => (): GroupStmt | undefined => {
    const following = peek(1).type;
    if (at("ident") && (following === "." || ARROWS.includes(following))) {
      if (connections) return connection();
      report(diagnostic("E001", "Connections are not allowed in a zone — write them in a `system` or in the architecture", peek().span));
      throw BAIL;
    }
    if (isReserved()) return skipReserved();
    if (atWord("label")) return label();
    if (atWord("show")) return show();
    if (atWord("system")) return system();
    if (atWord("component") || atWord("external")) return component();
    if (atWord("zone")) {
      report(diagnostic("E001", "Zones are only allowed at the top level of the architecture", peek().span));
      throw BAIL;
    }
    return unknownStatement(GROUP_KEYWORDS, context);
  };

  const system = (): SystemNode => {
    const start = next();
    const id = ident();
    expect("{", "`{`");
    const { items, closingTrivia } = block(groupStmt("a system", true), GROUP_KEYWORDS);
    return withClosing(node<SystemNode>(start, { kind: "System", id, body: items }), closingTrivia);
  };

  const zone = (): ZoneNode => {
    const start = next();
    const id = ident();
    expect("{", "`{`");
    const { items, closingTrivia } = block(groupStmt("a zone", false), GROUP_KEYWORDS);
    return withClosing(node<ZoneNode>(start, { kind: "Zone", id, body: items as ZoneStmt[] }), closingTrivia);
  };

  // ── Connections ──────────────────────────────────────────────

  const endpoint = (): EndpointNode => {
    const start = peek();
    const componentId = ident();
    let pinId: Ident | undefined;
    if (at(".")) {
      next();
      pinId = ident();
    }
    const n = node<EndpointNode>(start, { kind: "Endpoint", component: componentId, ...(pinId && { pin: pinId }) });
    n.leadingTrivia = [];
    return n;
  };

  const connection = (): ConnectionNode => {
    const start = peek();
    const from = endpoint();
    if (!ARROWS.includes(peek().type)) fail("`->`, `<-`, `<->` or `--`");
    const arrow = next().type as Arrow;
    const to = endpoint();
    const n = node<ConnectionNode>(start, { kind: "Connection", from, arrow, to });
    if (!at("{")) return n;
    next();
    const connectionStmt = (): LabelStmt | TypeStmt | ShowStmt => {
      if (atWord("label")) return label();
      if (atWord("show")) return show();
      if (atWord("type")) {
        const typeStart = next();
        return node<TypeStmt>(typeStart, { kind: "Type", value: ident() });
      }
      return unknownStatement(CONNECTION_KEYWORDS, "a connection");
    };
    const { items, closingTrivia } = block(connectionStmt, CONNECTION_KEYWORDS);
    return withClosing(node<ConnectionNode>(start, { ...n, body: items }), closingTrivia);
  };

  // ── Layout ───────────────────────────────────────────────────

  const grid = (): GridNode => {
    const start = next();
    expect("{", "`{`");
    const rows: GridRow[] = [];
    const skipLine = () => {
      while (!at("eof") && !at("}") && !peek().newlineBefore) next();
    };
    while (!at("}") && !at("eof")) {
      const rowStart = peek();
      const cells: GridCell[] = [];
      try {
        for (;;) {
          const t = peek();
          if (t.type === ".") {
            next();
            cells.push({ kind: "GridCell", span: t.span, leadingTrivia: [] });
          } else if (t.type === "ident") {
            const id = ident();
            cells.push({ kind: "GridCell", id, span: t.span, leadingTrivia: [] });
          } else {
            fail("a component ID or `.`");
          }
          if (!at("|") || peek().newlineBefore) break;
          next();
          if (at("}") || peek().newlineBefore) fail("a cell after `|`");
        }
        if (!at("}") && !at("eof") && !peek().newlineBefore) fail("`|` or a line break");
      } catch (e) {
        if (e !== BAIL) throw e;
        skipLine();
      }
      if (cells.length > 0) rows.push(node<GridRow>(rowStart, { kind: "GridRow", cells }));
    }
    const closingTrivia = peek().leadingTrivia;
    expect("}", "`}`");
    return withClosing(node<GridNode>(start, { kind: "Grid", rows }), closingTrivia);
  };

  /** `pin spacing N` — distance between neighbouring pins in grid units. */
  const pinSpacing = (): PinSpacingStmt => {
    const start = next();
    expectWord(["spacing"] as const);
    const value = expect("int", "a number ≥ 1");
    const n = Number(value.text);
    if (n < 1) {
      report(diagnostic("E001", `Expected a number ≥ 1, found ${value.text}`, value.span));
    }
    return node<PinSpacingStmt>(start, { kind: "PinSpacing", value: Math.max(1, n) });
  };

  const layout = (): LayoutStmt => {
    const start = next();
    expect("{", "`{`");
    const layoutStmt = (): ModeStmt | PinSpacingStmt | GridNode => {
      if (atWord("mode")) {
        const modeStart = next();
        return node<ModeStmt>(modeStart, { kind: "Mode", value: expectWord<LayoutMode>(LAYOUT_MODES) });
      }
      if (atWord("pin")) return pinSpacing();
      if (atWord("grid")) return grid();
      return unknownStatement(LAYOUT_KEYWORDS, "`layout`");
    };
    const { items, closingTrivia } = block(layoutStmt, LAYOUT_KEYWORDS);
    return withClosing(node<LayoutStmt>(start, { kind: "Layout", body: items }), closingTrivia);
  };

  // ── Views ────────────────────────────────────────────────────

  const view = (): ViewNode => {
    const start = next();
    const id = operand(ARCH_KEYWORDS);
    const n = node<ViewNode>(start, { kind: "View", id, body: [] });
    if (!at("{")) return n;
    next();
    const viewStmt = (): LabelStmt => {
      if (atWord("label")) return label();
      return unknownStatement(["label"], "a view");
    };
    const { items, closingTrivia } = block(viewStmt, ["label"]);
    return withClosing(node<ViewNode>(start, { ...n, body: items }), closingTrivia);
  };

  // ── Architecture ─────────────────────────────────────────────

  const archStmt = (): Statement | undefined => {
    const following = peek(1).type;
    if (at("ident") && (following === "." || ARROWS.includes(following))) return connection();
    if (isReserved()) return skipReserved();
    const t = peek();
    if (t.type === "ident") {
      switch (t.text) {
        case "theme": {
          const start = next();
          return node<ThemeStmt>(start, { kind: "Theme", name: ident() });
        }
        case "direction": {
          const start = next();
          return node<DirectionStmt>(start, { kind: "Direction", value: expectWord<Direction>(DIRECTIONS) });
        }
        case "pins": {
          const start = next();
          return node<PinsStmt>(start, { kind: "Pins", value: expectWord<PinDisplay>(PIN_DISPLAYS) });
        }
        case "stack": {
          const start = next();
          return node<StackStmt>(start, { kind: "Stack", value: expectWord<StackMode>(STACK_MODES) });
        }
        case "view": return view();
        case "layout": return layout();
        case "zone": return zone();
        case "system": return system();
        case "component": case "external": return component();
        case "define":
          report(diagnostic("E001", "`define` must come before `architecture`", t.span));
          throw BAIL;
      }
    }
    return unknownStatement(ARCH_KEYWORDS, "the architecture");
  };

  const architecture = (): ArchitectureNode => {
    const start = next();
    const title = string();
    expect("{", "`{`");
    const { items, closingTrivia } = block(archStmt, ARCH_KEYWORDS);
    return withClosing(node<ArchitectureNode>(start, { kind: "Architecture", title, body: items }), closingTrivia);
  };

  // ── Templates ────────────────────────────────────────────────

  const defineStmt = (): DefineStmt | undefined => {
    if (isReserved()) return skipReserved();
    const t = peek();
    if (t.type === "ident") {
      switch (t.text) {
        case "label": return label();
        case "size": return size();
        case "category": return category();
        case "shape": {
          const start = next();
          return node<ShapeStmt>(start, { kind: "Shape", value: ident() });
        }
        case "icon": {
          const start = next();
          return node<IconStmt>(start, { kind: "Icon", value: ident() });
        }
        case "pin": return pin(false);
        case "left": case "right": case "top": case "bottom": return sideBlock(false);
        case "importance": case "hint": case "meta":
          report(diagnostic("E001", `\`${t.text}\` is only allowed in a component, not in \`define\``, t.span));
          throw BAIL;
      }
    }
    return unknownStatement(DEFINE_KEYWORDS, "`define`");
  };

  const define = (): DefineNode => {
    const start = next();
    const name = ident();
    let base: Ident | undefined;
    if (atWord("extends")) {
      next();
      base = ident();
    }
    expect("{", "`{`");
    const { items, closingTrivia } = block(defineStmt, DEFINE_KEYWORDS);
    return withClosing(
      node<DefineNode>(start, { kind: "Define", name, ...(base && { extends: base }), body: items }),
      closingTrivia,
    );
  };

  // ── Document ─────────────────────────────────────────────────

  const defines: DefineNode[] = [];
  let arch: ArchitectureNode | undefined;

  while (!at("eof")) {
    const statementStart = i;
    try {
      if (atWord("define")) {
        const d = define();
        if (arch) report(diagnostic("E001", "`define` must come before `architecture`", d.name.span));
        defines.push(d);
      } else if (atWord("architecture")) {
        const t = peek();
        const a = architecture();
        if (arch) report(diagnostic("E001", "A document contains exactly one `architecture`", t.span));
        else arch = a;
      } else if (isReserved()) {
        skipReserved();
      } else if (at("}")) {
        fail("`define` or `architecture`");
      } else {
        unknownStatement(["define", "architecture"], "the file");
      }
    } catch (e) {
      if (e !== BAIL) throw e;
      if (at("}")) next();
      else recover(statementStart, ["define", "architecture"]);
    }
  }

  const tree: SyntaxTree = {
    kind: "Document",
    span: { start: 0, end: source.length, line: 1, column: 1 },
    leadingTrivia: [],
    defines,
    ...(arch && { architecture: arch }),
  };
  const trailing = peek().leadingTrivia;
  if (trailing.length > 0) tree.closingTrivia = trailing;
  return { value: tree, diagnostics };
}
