import type { ComponentNode, ConnectionNode, GroupStmt, Statement, SyntaxTree } from "../ast/index.js";
import type { Diagnostic } from "../diagnostics/index.js";
import type { ArchitectureModel } from "../resolve/index.js";
import { SIGNAL_KINDS, isOneOf, type SignalKind } from "../types.js";

/** Replaces `source[start, end)` with `newText`; `start === end` is an insertion. */
export interface TextEdit {
  start: number;
  end: number;
  newText: string;
}

/** Quick fix in the editor: a label and the text edits that apply it. */
export interface CodeAction {
  label: string;
  edits: TextEdit[];
}

/** Applies non-overlapping edits; the order within the array does not matter. */
export function applyEdits(source: string, edits: readonly TextEdit[]): string {
  let result = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
  }
  return result;
}

/**
 * Quick fixes for a diagnostic: the diagnostic's suggestions as a replacement and, for `E103`,
 * additionally "create pin" (D18) — the pin is inserted into the component as a text edit.
 */
export function codeActions(
  source: string,
  tree: SyntaxTree,
  model: ArchitectureModel,
  d: Diagnostic,
): CodeAction[] {
  const actions: CodeAction[] = (d.suggestions ?? []).map((s) => ({
    label: s.label,
    edits: [{ start: s.span.start, end: s.span.end, newText: s.replacement }],
  }));
  if (d.code === "E103") {
    const create = createPinAction(source, tree, model, d.span.start);
    if (create) actions.push(create);
  }
  return actions;
}

function createPinAction(source: string, tree: SyntaxTree, model: ArchitectureModel, offset: number): CodeAction | undefined {
  const connection = tree.architecture && findConnection(tree.architecture.body, offset);
  if (!connection) return undefined;
  const [endpoint, other] = connection.from.pin?.span.start === offset
    ? [connection.from, connection.to]
    : [connection.to, connection.from];
  const component = findComponent(tree.architecture!.body, endpoint.component.name);
  if (!component || !endpoint.pin) return undefined;

  const explicit = connection.body?.find((s) => s.kind === "Type")?.value.name;
  const otherPin = other.pin && model.components.get(other.component.name)?.pins.find((p) => p.name === other.pin!.name);
  const kind: SignalKind = explicit !== undefined && isOneOf(SIGNAL_KINDS, explicit)
    ? explicit
    : otherPin?.kind ?? "signal";
  const pin = `pin ${kind} ${endpoint.pin.name}`;
  return {
    label: `Create pin \`${endpoint.pin.name}\` (${kind}) in \`${component.id.name}\``,
    edits: [insertIntoComponent(source, component, pin)],
  };
}

/** The connection one of whose pins starts at `offset` — also inside a `system`. */
function findConnection(body: readonly (Statement | GroupStmt)[], offset: number): ConnectionNode | undefined {
  for (const stmt of body) {
    if (stmt.kind === "Connection" && (stmt.from.pin?.span.start === offset || stmt.to.pin?.span.start === offset)) return stmt;
    if (stmt.kind === "Zone" || stmt.kind === "System") {
      const found = findConnection(stmt.body, offset);
      if (found) return found;
    }
  }
  return undefined;
}

function findComponent(body: readonly (Statement | GroupStmt)[], id: string): ComponentNode | undefined {
  for (const stmt of body) {
    if (stmt.kind === "Component" && stmt.id.name === id) return stmt;
    if (stmt.kind === "Zone" || stmt.kind === "System") {
      const found = findComponent(stmt.body, id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Inserts a statement as the last one in the body, following its shape (none, single-line or multi-line). */
function insertIntoComponent(source: string, component: ComponentNode, stmt: string): TextEdit {
  const end = component.span.end;
  if (component.body === undefined || source[end - 1] !== "}") {
    return { start: end, end, newText: ` { ${stmt} }` };
  }
  const close = end - 1;
  const lineStart = source.lastIndexOf("\n", close - 1) + 1;
  const beforeClose = source.slice(lineStart, close);
  if (beforeClose.trim() !== "") {
    // Single line `{ label "A" }` or `{}`
    const open = source.lastIndexOf("{", close);
    const empty = source.slice(open + 1, close).trim() === "";
    const at = source.slice(0, close).trimEnd().length;
    return { start: at, end: close, newText: `${empty ? " " : "   "}${stmt} ` };
  }
  const indent = beforeClose + "    ";
  return { start: lineStart, end: lineStart, newText: `${indent}${stmt}\n` };
}
