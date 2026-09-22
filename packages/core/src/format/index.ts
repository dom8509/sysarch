import type {
  ArchitectureNode, CategoryStmt, ComponentNode, ConnectionNode, DefineNode, DirectionStmt, PinsStmt, StackStmt,
  EndpointNode, CountStmt, GridNode, GridRow, HintStmt, IconStmt, ImportanceStmt, LabelStmt, LayoutStmt,
  MetaBlock, MetaEntry, ModeStmt, PinSpacingStmt, PinStmt, ShapeStmt, ShowStmt, SideBlock, SizeStmt, StringLit, SyntaxNode,
  SyntaxTree, ThemeStmt, Trivia, TypeStmt, ViewNode, ZoneNode,
} from "../ast/index.js";
import { hasErrors, type ParseResult } from "../diagnostics/index.js";
import { lex } from "../lexer/index.js";
import { parse } from "../parser/index.js";

const INDENT = "    ";

/** Nodes that form a line (or block) of their own. */
type Statement = Exclude<SyntaxNode, SyntaxTree>;

/** Node kinds that sit inside a statement and never get a line of their own. */
const INLINE_KINDS = new Set(["Document", "Ident", "String", "Endpoint", "GridCell"]);

/** Properties that allow a component to be written on a single line. */
const COMPONENT_ONE_LINER_KINDS = new Set(["Label", "Size", "Importance", "Category", "Hint", "Count", "Show"]);

/** Side blocks with at most this many unlabelled pins fit on one line … */
const MAX_INLINE_PINS = 3;
/** … as long as the line does not grow wider than this without alignment. */
const MAX_WIDTH = 80;

/** Statements whose inline blocks are aligned with each other. */
const ALIGNED_KINDS = new Set(["Connection", "SideBlock"]);

/** Order of the statements in `architecture` (02-dsl.md §6). */
const ORDER: Readonly<Record<string, number>> = {
  Theme: 0, Direction: 1, Pins: 2, Stack: 3, View: 4, Layout: 5, Zone: 6, System: 6, Component: 6, Connection: 7,
};

/** Sections in `architecture`, separated by a blank line. */
const SECTION: Readonly<Record<string, number>> = {
  Theme: 0, Direction: 0, Pins: 0, Stack: 0, View: 1, Layout: 2, Zone: 3, System: 3, Component: 3, Connection: 4,
};

/** Order in a `system`: its own properties › structure › connections (§6). */
const SYSTEM_ORDER: Readonly<Record<string, number>> = {
  Label: 0, Show: 0, System: 1, Component: 1, Connection: 2,
};

/** Only the connections of a system form a section of their own, as in `architecture`. */
const SYSTEM_SECTION: Readonly<Record<string, number>> = {
  Label: 0, Show: 0, System: 0, Component: 0, Connection: 1,
};

interface Entry {
  node: Statement;
  /** Comments and blank lines on their own lines before the statement. */
  before: Trivia[];
  /** Comments that follow the statement on the same line in the source. */
  after: Trivia[];
}

/** Single-line form: head and an optional inline block `{ … }` whose `{` is aligned. */
interface OneLine {
  head: string;
  body?: string;
}

/**
 * Canonical formatting (02-dsl.md §6). On syntax errors the source stays unchanged and the
 * parser's diagnostics are returned. Comments are preserved.
 */
export function format(source: string): ParseResult<string> {
  const parsed = parse(source);
  if (hasErrors(parsed.diagnostics)) return { value: source, diagnostics: parsed.diagnostics };
  const tree = parsed.value;
  const lines: string[] = [];

  // ── Comments inside statements ───────────────────────────────
  // The parser attaches trivia to the following token. A comment before a token in the middle
  // of a statement (`pin /* x */ can TX`) does not show up in the syntax tree. Such comments
  // are hoisted in front of the innermost statement that encloses them.
  const attached = new Set<number>();
  const statements: Statement[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value !== "object" || value === null || !("kind" in value)) return;
    const n = value as SyntaxNode;
    for (const t of [...n.leadingTrivia, ...(n.closingTrivia ?? [])]) attached.add(t.span.start);
    if (!INLINE_KINDS.has(n.kind)) statements.push(n as Statement);
    for (const [key, child] of Object.entries(n)) {
      if (key !== "leadingTrivia" && key !== "closingTrivia" && key !== "span") walk(child);
    }
  };
  walk(tree);

  const sourceComments = lex(source).tokens.flatMap((t) => t.leadingTrivia).filter((t) => t.kind === "comment");
  const hoisted = new Map<SyntaxNode, Trivia[]>();
  const orphans: Trivia[] = [];
  for (const comment of sourceComments) {
    if (attached.has(comment.span.start)) continue;
    let owner: Statement | undefined;
    for (const s of statements) {
      const inside = s.span.start < comment.span.start && comment.span.start < s.span.end;
      if (inside && (!owner || s.span.end - s.span.start < owner.span.end - owner.span.start)) owner = s;
    }
    if (owner) hoisted.set(owner, [...(hoisted.get(owner) ?? []), comment]);
    else orphans.push(comment);
  }

  // ── Trivia ───────────────────────────────────────────────────

  /** Is the comment on the same line as the previous token? */
  const isTrailing = (t: Trivia): boolean => {
    if (t.kind !== "comment") return false;
    let p = t.span.start - 1;
    while (p >= 0 && (source[p] === " " || source[p] === "\t" || source[p] === "\r")) p--;
    return p >= 0 && source[p] !== "\n";
  };

  const splitTrivia = (trivia: readonly Trivia[]): { trailing: Trivia[]; rest: Trivia[] } => {
    let k = 0;
    while (k < trivia.length && isTrailing(trivia[k]!)) k++;
    return { trailing: trivia.slice(0, k), rest: trivia.slice(k) };
  };

  const hasComment = (trivia: readonly Trivia[] | undefined) => trivia?.some((t) => t.kind === "comment") ?? false;

  /** Does the node (or a child) contain comments? Then there is no single-line form. */
  const containsComments = (n: SyntaxNode, self = true): boolean => {
    if (self && (hasComment(n.leadingTrivia) || hoisted.has(n))) return true;
    if (hasComment(n.closingTrivia)) return true;
    return Object.entries(n).some(([key, child]) => {
      if (key === "leadingTrivia" || key === "closingTrivia" || key === "span") return false;
      const children = Array.isArray(child) ? child : [child];
      return children.some((c) => typeof c === "object" && c !== null && "kind" in c && containsComments(c as SyntaxNode));
    });
  };

  // ── Output ───────────────────────────────────────────────────

  const emit = (depth: number, text: string) => lines.push(INDENT.repeat(depth) + text);

  const appendTrailing = (comments: readonly Trivia[]) => {
    if (comments.length === 0) return;
    lines[lines.length - 1] += comments.map((c) => " " + c.text).join("");
  };

  const blankLine = () => {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
  };

  const trimBlankLines = () => {
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  };

  /** Comments on their own lines; blank lines only if `allowBlank` (at most one in a row). */
  const printTrivia = (depth: number, trivia: readonly Trivia[], allowBlank: boolean) => {
    for (const t of trivia) {
      if (t.kind === "blankLine") {
        if (allowBlank) blankLine();
      } else {
        emit(depth, t.text);
        allowBlank = true;
      }
    }
  };

  const str = (s: StringLit) => `"${s.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

  /** Assigns comments to a statement list: own lines before, same line after. */
  const toEntries = (items: readonly Statement[], closingTrivia: readonly Trivia[] | undefined) => {
    const header: Trivia[] = [];
    const entries: Entry[] = [];
    for (const node of items) {
      const { trailing, rest } = splitTrivia(node.leadingTrivia);
      (entries.length > 0 ? entries[entries.length - 1]!.after : header).push(...trailing);
      entries.push({ node, before: rest, after: [] });
    }
    const closing = splitTrivia(closingTrivia ?? []);
    (entries.length > 0 ? entries[entries.length - 1]!.after : header).push(...closing.trailing);
    return { header, entries, closing: closing.rest };
  };

  const componentHead = (c: ComponentNode) =>
    `${c.external ? "external" : "component"} ${c.id.name}${c.template ? ": " + c.template.name : ""}`;
  const endpoint = (e: EndpointNode) => e.component.name + (e.pin ? "." + e.pin.name : "");
  const connectionHead = (c: ConnectionNode) => `${endpoint(c.from)} ${c.arrow} ${endpoint(c.to)}`;

  /** Single-line form of a statement, if it has one. */
  const oneLine = (n: Statement, depth: number): OneLine | undefined => {
    const inline = (head: string, body: readonly Statement[] | undefined, fits: boolean, separator = " "): OneLine | undefined => {
      if (containsComments(n, false)) return undefined;
      if (!body || body.length === 0) return { head };
      if (!fits) return undefined;
      return { head, body: `{ ${body.map((s) => oneLine(s, depth + 1)!.head).join(separator)} }` };
    };
    switch (n.kind) {
      case "Theme": return { head: `theme ${(n as ThemeStmt).name.name}` };
      case "Direction": return { head: `direction ${(n as DirectionStmt).value}` };
      case "Pins": return { head: `pins ${(n as PinsStmt).value}` };
      case "Stack": return { head: `stack ${(n as StackStmt).value}` };
      case "Mode": return { head: `mode ${(n as ModeStmt).value}` };
      case "PinSpacing": return { head: `pin spacing ${(n as PinSpacingStmt).value}` };
      case "Label": return { head: `label ${str((n as LabelStmt).value)}` };
      case "Size": return { head: `size ${(n as SizeStmt).value}` };
      case "Importance": return { head: `importance ${(n as ImportanceStmt).value}` };
      case "Category": return { head: `category ${(n as CategoryStmt).value.name}` };
      case "Shape": return { head: `shape ${(n as ShapeStmt).value.name}` };
      case "Icon": return { head: `icon ${(n as IconStmt).value.name}` };
      case "Type": return { head: `type ${(n as TypeStmt).value.name}` };
      case "Count": return { head: `count ${(n as CountStmt).value}` };
      case "Show": return { head: `show in ${(n as ShowStmt).views.map((v) => v.name).join(", ")}` };
      case "View": {
        const v = n as ViewNode;
        return inline(`view ${v.id.name}`, v.body, v.body.length === 1);
      }
      case "Hint": {
        const h = n as HintStmt;
        return { head: `hint ${h.axis} ${h.value}` };
      }
      case "MetaEntry": {
        const e = n as MetaEntry;
        return { head: `${e.key.name} ${str(e.value)}` };
      }
      case "Pin": {
        const p = n as PinStmt;
        const head = `pin ${p.signal.name} ${p.name.name}${p.label ? " " + str(p.label) : ""}`;
        return inline(head, p.body, (p.body?.length ?? 0) <= 1);
      }
      case "SideBlock": {
        const s = n as SideBlock;
        const fits = s.pins.length <= MAX_INLINE_PINS && s.pins.every((p) => !p.label && !p.body);
        const form = inline(s.side, s.pins, fits, "   ");
        const tooLong = form?.body !== undefined && INDENT.length * depth + form.head.length + form.body.length + 1 > MAX_WIDTH;
        return tooLong ? undefined : form;
      }
      case "Component": {
        const c = n as ComponentNode;
        const fits = c.body?.length === 1 && COMPONENT_ONE_LINER_KINDS.has(c.body[0]!.kind);
        return inline(componentHead(c), c.body, fits);
      }
      case "Connection": {
        const c = n as ConnectionNode;
        return inline(connectionHead(c), c.body, (c.body?.length ?? 0) <= 2);
      }
      default: return undefined;
    }
  };

  /** Head line and children of a block that is always multi-line. */
  const blockOf = (n: Statement): { head: string; items: Statement[] } | undefined => {
    switch (n.kind) {
      case "Architecture": {
        const a = n as ArchitectureNode;
        return { head: `architecture ${str(a.title)}`, items: a.body };
      }
      case "Define": {
        const d = n as DefineNode;
        return { head: `define ${d.name.name}${d.extends ? " extends " + d.extends.name : ""}`, items: d.body };
      }
      case "Zone": case "System": {
        const g = n as ZoneNode;
        return { head: `${n.kind.toLowerCase()} ${g.id.name}`, items: g.body };
      }
      case "Layout": return { head: "layout", items: (n as LayoutStmt).body };
      case "View": return { head: `view ${(n as ViewNode).id.name}`, items: (n as ViewNode).body };
      case "Pin": {
        const p = n as PinStmt;
        return { head: `pin ${p.signal.name} ${p.name.name}${p.label ? " " + str(p.label) : ""}`, items: p.body ?? [] };
      }
      case "Meta": return { head: "meta", items: (n as MetaBlock).entries };
      case "SideBlock": return { head: (n as SideBlock).side, items: (n as SideBlock).pins };
      case "Component": return { head: componentHead(n as ComponentNode), items: (n as ComponentNode).body ?? [] };
      case "Connection": return { head: connectionHead(n as ConnectionNode), items: (n as ConnectionNode).body ?? [] };
      default: return undefined;
    }
  };

  const gridRowText = (row: GridRow, widths: readonly number[]) =>
    row.cells.map((c, k) => (c.id?.name ?? ".").padEnd(widths[k] ?? 0)).join(" | ").trimEnd();

  /** Writes a statement list. `sectioned`: a section change forces a blank line. */
  const printEntries = (
    depth: number,
    entries: readonly Entry[],
    options: { sections?: Readonly<Record<string, number>>; separated?: boolean; grid?: readonly number[] } = {},
  ) => {
    const lineForms = entries.map((e) => (options.grid ? undefined : oneLine(e.node, depth)));

    // Align the inline blocks of consecutive connections or side blocks with each other.
    const widths = new Array<number>(entries.length).fill(0);
    for (let k = 0; k < entries.length;) {
      const kind = entries[k]!.node.kind;
      if (!ALIGNED_KINDS.has(kind)) {
        k++;
        continue;
      }
      let end = k + 1;
      // Multi-line statements, blank lines and comments on their own line end the group.
      while (end < entries.length && entries[end]!.node.kind === kind && entries[end]!.before.length === 0
        && !hoisted.has(entries[end]!.node) && lineForms[end] && lineForms[end - 1]) end++;
      let width = 0;
      for (let j = k; j < end; j++) {
        const form = lineForms[j];
        if (form?.body !== undefined) width = Math.max(width, form.head.length);
      }
      for (let j = k; j < end; j++) widths[j] = width;
      k = end;
    }

    entries.forEach((entry, k) => {
      const { node } = entry;
      const first = k === 0;
      const sections = options.sections;
      const sectionChange = sections && !first && sections[node.kind] !== sections[entries[k - 1]!.node.kind];
      if (!first && (sectionChange || options.separated)) blankLine();
      printTrivia(depth, entry.before, !first);
      printTrivia(depth, hoisted.get(node) ?? [], true);

      if (options.grid) {
        emit(depth, gridRowText(node as GridRow, options.grid));
      } else if (lineForms[k]) {
        const form = lineForms[k]!;
        emit(depth, form.body === undefined ? form.head : form.head.padEnd(widths[k]!) + " " + form.body);
      } else {
        printBlock(depth, node);
      }
      appendTrailing(entry.after);
    });
  };

  const printBlock = (depth: number, n: Statement) => {
    if (n.kind === "Grid") {
      const grid = n as GridNode;
      const widths: number[] = [];
      for (const row of grid.rows) {
        row.cells.forEach((c, k) => (widths[k] = Math.max(widths[k] ?? 0, (c.id?.name ?? ".").length)));
      }
      const { header, entries, closing } = toEntries(grid.rows, grid.closingTrivia);
      emit(depth, "grid {");
      appendTrailing(header);
      printEntries(depth + 1, entries, { grid: widths });
      printTrivia(depth + 1, closing, true);
      trimBlankLines();
      emit(depth, "}");
      return;
    }
    const block = blockOf(n)!;
    const { header, entries, closing } = toEntries(block.items, n.closingTrivia);
    const order = n.kind === "Architecture" ? ORDER : n.kind === "System" ? SYSTEM_ORDER : undefined;
    // Sort only after assigning the comments (stable), so they stay with their statement.
    if (order) entries.sort((x, y) => order[x.node.kind]! - order[y.node.kind]!);
    if (entries.length === 0 && header.length === 0 && !hasComment(closing)) {
      emit(depth, block.head + " {}");
      return;
    }
    emit(depth, block.head + " {");
    appendTrailing(header);
    printEntries(depth + 1, entries, { sections: n.kind === "Architecture" ? SECTION : order && SYSTEM_SECTION });
    printTrivia(depth + 1, closing, true);
    trimBlankLines();
    emit(depth, "}");
  };

  // ── Document ─────────────────────────────────────────────────

  const top: Statement[] = [...tree.defines, ...(tree.architecture ? [tree.architecture] : [])];
  const { entries, closing } = toEntries(top, tree.closingTrivia);
  printEntries(0, entries, { separated: true });
  printTrivia(0, [...closing, ...orphans], true);
  trimBlankLines();
  const value = lines.length > 0 ? lines.join("\n") + "\n" : "";

  // Guard against data loss: every comment must appear exactly once in the output.
  const commentTexts = (text: string) =>
    lex(text).tokens.flatMap((t) => t.leadingTrivia).filter((t) => t.kind === "comment").map((t) => t.text).sort();
  if (commentTexts(value).join("\0") !== sourceComments.map((t) => t.text).sort().join("\0")) {
    throw new Error("format: comments do not match after formatting");
  }
  return { value, diagnostics: parsed.diagnostics };
}
