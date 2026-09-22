import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_CODES, closest, compile, levenshtein, type DiagnosticCode } from "../src/index.js";
import { arch } from "./helpers.js";

interface Case {
  name: string;
  source: string;
  /** Expected position "line:column" of the first diagnostic with this code. */
  at?: string;
  message?: string;
  suggestion?: string;
}

const cases: Record<DiagnosticCode, Case[]> = {
  E001: [
    { name: "missing token", source: 'architecture "A" {\n component : block\n}', at: "2:12" },
    { name: "wrong value for size", source: arch(" component a { size huge }"), message: "`small` | `medium` | `large`" },
    { name: "count less than 1", source: arch(" component a { count 0 }"), at: "3:22" },
    { name: "hint less than 1", source: arch(" layout { mode assisted }\n component a { hint row 0 }"), at: "4:25" },
    { name: "define after architecture", source: 'architecture "A" {}\ndefine x {}', at: "2:8" },
    { name: "unexpected character", source: arch(" component a;"), message: "unexpected character `;`" },
    { name: "show in a define", source: arch("", "define t { pin can TX { show in overview } }"), message: "not in `define`" },
    { name: "missing architecture", source: "define x {}" },
  ],
  E101: [
    { name: "duplicate component ID", source: arch(" zone z1 { component a }\n zone z2 { system a { component b } }\n zone z3 { component b }"), at: "4:19" },
    { name: "duplicate template", source: arch("", "define t {}\ndefine t {}"), at: "2:8" },
  ],
  E102: [
    { name: "in a connection", source: arch(" component mcu\n mcu -> mcx"), at: "4:9", suggestion: "mcu" },
    { name: "in the grid", source: arch(" component mcu\n layout { grid { mcu | drv } }"), at: "4:24" },
  ],
  E103: [
    {
      name: "typo in the pin name",
      source: arch(" component mcu { pin can CAN_TX }\n component trx: can_transceiver\n mcu.CAN_TXX -> trx.TXD"),
      at: "5:6",
      suggestion: "CAN_TX",
    },
  ],
  E104: [
    { name: "unknown template", source: arch(" component mcu: microcontroler"), at: "3:17", suggestion: "microcontroller" },
    { name: "unknown base template", source: arch(" component m: m2", "define m2 extends motr {}"), at: "1:19", suggestion: "motor" },
    { name: "cyclic inheritance", source: arch("", "define a extends b {}\ndefine b extends a {}") },
  ],
  E105: [
    { name: "duplicate pin", source: arch(" component a { pin power VDD\n pin power VDD }"), at: "4:12" },
    { name: "redeclaration with a different kind", source: arch(" component hb: half_bridge { right { pin analog IN } }"), at: "3:42" },
  ],
  E106: [
    { name: "component outside a zone", source: arch(" zone z { component a }\n component b\n system s { component c }"), at: "4:12" },
  ],
  E107: [
    { name: "cells of a component do not form a rectangle", source: arch(" component a\n component b\n layout { grid {\n a | b\n b | .\n } }"), at: "7:2" },
    { name: "cells with a gap", source: arch(" component a\n component b\n layout { grid {\n a | b | a\n } }"), at: "6:10" },
    { name: "rows of different width", source: arch(" component a\n component b\n layout { grid {\n a | b\n .\n } }"), at: "7:2" },
  ],
  E108: [
    {
      name: "grid violates zone order",
      source: arch(" zone z1 { component a }\n zone z2 { component b }\n layout { grid { b | a } }"),
      at: "5:18",
    },
    {
      name: "hint violates zone order",
      source: arch(" layout { mode assisted }\n zone z1 { component a { hint column 3 } }\n zone z2 { component b { hint column 2 } }"),
      at: "5:26",
    },
    {
      name: "TB checks rows",
      source: arch(" direction TB\n zone z1 { component a }\n zone z2 { component b }\n layout { grid {\n b\n a\n } }"),
      at: "7:2",
    },
  ],
  E109: [
    { name: "unknown signal kind", source: arch(" component a { pin powr VDD }"), at: "3:20", suggestion: "power" },
    { name: "unknown category", source: arch(" component a { category sensr }"), suggestion: "sensor" },
    { name: "unknown theme", source: arch(" theme automotive-lite"), at: "3:8", suggestion: "automotive-light" },
    { name: "unknown connection type", source: arch(" component a\n component b\n a -> b { type cann }"), suggestion: "can" },
  ],
  E110: [
    { name: "use", source: 'use "nxp.archlib"\narchitecture "A" {}', at: "1:1", message: "v0.2" },
    { name: "interface in define", source: arch("", "define s extends microcontroller { interface can CAN0 }"), message: "v0.3" },
    { name: "rule", source: 'rule no_direct_can { }\narchitecture "A" {}', at: "1:1" },
  ],
  E111: [
    { name: "unknown shape", source: arch("", "define t { shape hexagn }"), at: "1:18", suggestion: "hexagon" },
    { name: "unknown icon", source: arch(" component m: t", "define t extends motor { icon moter }"), at: "1:31", suggestion: "motor" },
  ],
  E112: [
    { name: "unknown view", source: arch(" view overview\n component a { show in overviw }"), at: "4:24", suggestion: "overview" },
    { name: "show in without any view", source: arch(" component a { show in overview }"), at: "3:24", message: "declares no `view`" },
  ],
  W201: [
    { name: "power → can", source: arch(" component a { pin power P }\n component b { pin can C }\n a.P -> b.C"), at: "5:2" },
  ],
  W202: [
    { name: "hint in strict", source: arch(" component a { hint row 1 }"), at: "3:16" },
  ],
  W203: [
    { name: "local define overrides the library", source: arch(" component m: motor", "define motor extends motor { icon window }"), at: "1:8" },
  ],
  W204: [
    {
      name: "pin outside the views of its component",
      source: arch(" view overview\n view detailed\n component a { show in overview\n pin can TX { show in detailed } }"),
      at: "6:15",
    },
    {
      name: "component outside the views of its zone",
      source: arch(" view overview\n view detailed\n zone z { show in overview\n component a { show in detailed } }"),
      at: "6:16",
    },
  ],
  W205: [
    { name: "view without a component", source: arch(" view overview\n view detailed\n component a { show in overview }"), at: "4:2" },
  ],
  W206: [
    {
      name: "endpoint outside the enclosing system",
      source: arch(" component out\n system ecu {\n component mcu\n mcu -> out\n }"),
      at: "6:9",
      message: "not part of system `ecu`",
    },
  ],
  I301: [
    { name: "pin without a connection", source: arch(" component a { pin power VDD }"), at: "3:16" },
  ],
};

describe("diagnostics", () => {
  it("every code has at least one test", () => {
    for (const code of DIAGNOSTIC_CODES) expect(cases[code]?.length, code).toBeGreaterThan(0);
  });

  for (const code of DIAGNOSTIC_CODES) {
    describe(code, () => {
      it.each(cases[code])("$name", ({ source, at, message, suggestion }) => {
        const { diagnostics } = compile(source);
        const found = diagnostics.filter((d) => d.code === code);
        expect(found.length, JSON.stringify(diagnostics, null, 1)).toBeGreaterThan(0);
        const first = found[0]!;
        expect(first.severity).toBe(code.startsWith("E") ? "error" : code.startsWith("W") ? "warning" : "info");
        if (at) expect(`${first.span.line}:${first.span.column}`).toBe(at);
        if (message) expect(first.message).toContain(message);
        if (suggestion) expect(first.suggestions?.map((s) => s.replacement)).toContain(suggestion);
      });
    });
  }

  it("W201 is skipped with an explicit type", () => {
    const source = arch(" component a { pin power P }\n component b { pin can C }\n a.P -> b.C { type power }");
    expect(compile(source).diagnostics.map((d) => d.code)).not.toContain("W201");
  });

  it("hints in mode assisted produce no warning", () => {
    const source = arch(" layout { mode assisted }\n component a { hint row 1 }");
    expect(compile(source).diagnostics).toEqual([]);
  });

  it("diagnostics are sorted by source position", () => {
    const { diagnostics } = compile(arch(" component a: nope\n a -> b\n component c { pin powr X }"));
    const starts = diagnostics.map((d) => d.span.start);
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
  });
});

describe("suggestions", () => {
  it("levenshtein", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("suggests only near candidates", () => {
    expect(closest("CAN_TXX", ["CAN_TX", "CAN_RX", "VDD"])).toBe("CAN_TX");
    expect(closest("can_tx", ["CAN_TX", "VDD"])).toBe("CAN_TX");
    expect(closest("xyz", ["CAN_TX", "VDD"])).toBeUndefined();
  });
});
