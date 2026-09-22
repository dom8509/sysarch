import { describe, expect, it } from "vitest";
import { applyEdits, codeActions, compile, parse, type CodeAction } from "../src/index.js";
import { arch } from "./helpers.js";

/** Quick fixes for the first diagnostic with `code`. */
function actions(source: string, code: string): CodeAction[] {
  const { value, diagnostics } = compile(source);
  const d = diagnostics.find((x) => x.code === code);
  expect(d, `${code} expected`).toBeDefined();
  return codeActions(source, parse(source).value, value, d!);
}

const errors = (source: string) => compile(source).diagnostics.filter((d) => d.severity === "error");

describe("applyEdits", () => {
  it("applies edits regardless of their order", () => {
    expect(applyEdits("abcdef", [
      { start: 0, end: 1, newText: "A" },
      { start: 6, end: 6, newText: "!" },
      { start: 2, end: 4, newText: "" },
    ])).toBe("Abef!");
  });
});

describe("codeActions", () => {
  it("turns suggestions into replacements", () => {
    const source = arch(`    component mcu: microcontroller\n    component trx: can_transceiver\n    mcu -> trx.TXDD`);
    const [replace] = actions(source, "E103");
    expect(replace!.label).toBe("Replace with `TXD`");
    expect(errors(applyEdits(source, replace!.edits))).toEqual([]);
  });

  it("E103: creates the pin with the kind of the other side in a multi-line body", () => {
    const source = arch(`    component mcu: microcontroller {\n        label "MCU"\n    }\n    component trx: can_transceiver\n    mcu.TX_CAN -> trx.TXD`);
    const create = actions(source, "E103").at(-1)!;
    expect(create.label).toBe("Create pin `TX_CAN` (digital) in `mcu`");
    const fixed = applyEdits(source, create.edits);
    expect(fixed).toContain(`        label "MCU"\n        pin digital TX_CAN\n    }`);
    expect(errors(fixed)).toEqual([]);
  });

  it("E103: takes the connection's `type` and follows single-line, empty and missing bodies", () => {
    const cases: [string, string][] = [
      [`component a: block { label "A" }`, `component a: block { label "A"   pin can X }`],
      [`component a {}`, `component a { pin can X }`],
      [`component a: block`, `component a: block { pin can X }`],
    ];
    for (const [before, after] of cases) {
      const source = arch(`    ${before}\n    component b\n    a.X -> b { type can }`);
      const fixed = applyEdits(source, actions(source, "E103").at(-1)!.edits);
      expect(fixed).toContain(after);
      expect(errors(fixed)).toEqual([]);
    }
  });

  it("E103: finds components in zones and systems; without a hint it becomes `signal`", () => {
    const source = arch(`    zone z {\n        system s {\n            component a\n        }\n        component b\n    }\n    b -> a.IN`);
    const create = actions(source, "E103").at(-1)!;
    expect(create.label).toBe("Create pin `IN` (signal) in `a`");
    expect(applyEdits(source, create.edits)).toContain(`component a { pin signal IN }`);
  });

  it("E103: also fixes a connection written inside a system", () => {
    const source = arch(`    system ecu {\n        component mcu: microcontroller\n        component trx: can_transceiver\n\n        mcu.CAN0_TX -> trx.TXD\n    }`);
    const create = actions(source, "E103").at(-1)!;
    expect(create.label).toBe("Create pin `CAN0_TX` (digital) in `mcu`");
    expect(errors(applyEdits(source, create.edits))).toEqual([]);
  });

  it("other diagnostics without a suggestion have no quick fixes", () => {
    const source = arch(`    component a: nope_template`);
    const { value, diagnostics } = compile(source);
    const d = diagnostics.find((x) => x.severity === "error")!;
    expect(codeActions(source, parse(source).value, value, { ...d, suggestions: undefined } as never)).toEqual([]);
  });
});
