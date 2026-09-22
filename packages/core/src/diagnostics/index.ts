import type { Span } from "../types.js";

export type Severity = "error" | "warning" | "info";

/** Stable codes, documented in docs/02-dsl.md §5. */
export const DIAGNOSTIC_CODES = [
  "E001", "E101", "E102", "E103", "E104", "E105", "E106",
  "E107", "E108", "E109", "E110", "E111", "E112",
  "W201", "W202", "W203", "W204", "W205", "W206",
  "I301",
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export interface Suggestion {
  label: string;
  replacement: string;
  span: Span;
}

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  span: Span;
  /** Suggestions for quick fixes in the editor, e.g. typos in pin names. */
  suggestions?: Suggestion[];
}

export interface ParseResult<T> {
  /** Always present, possibly incomplete. */
  value: T;
  diagnostics: Diagnostic[];
}

export function severityOf(code: DiagnosticCode): Severity {
  switch (code[0]) {
    case "E": return "error";
    case "W": return "warning";
    default: return "info";
  }
}

export function diagnostic(
  code: DiagnosticCode,
  message: string,
  span: Span,
  suggestions?: Suggestion[],
): Diagnostic {
  const d: Diagnostic = { code, severity: severityOf(code), message, span };
  if (suggestions && suggestions.length > 0) d.suggestions = suggestions;
  return d;
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[b.length]!;
}

/** Closest candidate, if it is near enough to the input value. */
export function closest(input: string, candidates: Iterable<string>): string | undefined {
  const limit = Math.max(2, Math.floor(input.length / 3));
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = Math.min(
      levenshtein(input, candidate),
      levenshtein(input.toLowerCase(), candidate.toLowerCase()) + 0.5,
    );
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= limit ? best : undefined;
}

/** Diagnostic with a "did you mean …?" suggestion, if a near candidate exists. */
export function withSuggestion(
  code: DiagnosticCode,
  message: string,
  input: string,
  span: Span,
  candidates: Iterable<string>,
): Diagnostic {
  const match = closest(input, candidates);
  if (match === undefined) return diagnostic(code, message, span);
  return diagnostic(code, `${message} — did you mean \`${match}\`?`, span, [
    { label: `Replace with \`${match}\``, replacement: match, span },
  ]);
}
