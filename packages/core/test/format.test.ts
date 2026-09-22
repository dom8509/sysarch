import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile, format, lex, loadLibrary, standardLibrary } from "../src/index.js";

const root = join(import.meta.dirname, "..", "..", "..");
const sources = [
  ...readdirSync(join(root, "examples")).filter((f) => f.endsWith(".arch")).sort().map((f) => join("examples", f)),
  join("library", "automotive.archlib"),
];
const read = (file: string) => readFileSync(join(root, file), "utf8");

const fmt = (source: string) => {
  const { value, diagnostics } = format(source);
  expect(diagnostics).toEqual([]);
  return value;
};

/** Semantic model without source ranges — must be the same before and after formatting. */
function semantics(source: string): unknown {
  const strip = (value: unknown): unknown => {
    if (value instanceof Map) return [...value].map(([k, v]) => [k, strip(v)]);
    if (Array.isArray(value)) return value.map(strip);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
      Object.entries(value).filter(([k]) => k !== "span" && k !== "origin").map(([k, v]) => [k, strip(v)]),
    );
  };
  const result = source.includes("architecture")
    ? compile(source)
    : loadLibrary(source, [...standardLibrary().icons.values()]);
  return strip({ model: result.value, codes: result.diagnostics.map((d) => d.code) });
}

describe("format: examples and library", () => {
  it.each(sources)("%s is formatted canonically", (file) => {
    const source = read(file);
    expect(fmt(source)).toBe(source);
  });

  it.each(sources)("%s: comments before every token are preserved, the result is idempotent", (file) => {
    // Block comments without a line break do not change the meaning, but end up in every
    // conceivable place — including inside statements, endpoints and grid rows.
    const source = read(file);
    let noisy = "";
    let pos = 0;
    lex(source).tokens.forEach((t, k) => {
      noisy += source.slice(pos, t.span.start) + `/* c${k} */ `;
      pos = t.span.start;
    });
    noisy += source.slice(pos);

    const once = fmt(noisy);
    expect(fmt(once)).toBe(once);
    expect(semantics(once)).toEqual(semantics(source));
  });
});

describe("format", () => {
  const arch = (body: string) => `architecture "A" {\n${body}\n}\n`;

  it("orders theme › direction › pins › stack › layout › structure › connections, rest in source order", () => {
    const source = arch([
      "a -> b",
      "pins none",
      "stack identical",
      "component b",
      "direction TB",
      "layout { mode strict }",
      "zone z { component a }",
      "theme technical",
      "b -> a",
    ].join("\n"));
    expect(fmt(source)).toBe(arch([
      "    theme technical",
      "    direction TB",
      "    pins none",
      "    stack identical",
      "",
      "    layout {",
      "        mode strict",
      "    }",
      "",
      "    component b",
      "    zone z {",
      "        component a",
      "    }",
      "",
      "    a -> b",
      "    b -> a",
    ].join("\n")));
    expect(semantics(fmt(source))).toEqual(semantics(source));
  });

  it("puts the connections of a system last, in their own section", () => {
    const source = arch([
      "zone z {",
      "system ecu {",
      "mcu.CAN_TX -> trx.TXD { type can }",
      'component mcu { pin can CAN_TX }',
      'label "ECU"',
      "component trx: can_transceiver",
      "mcu -> trx",
      "}",
      "}",
    ].join("\n"));
    expect(fmt(source)).toBe(arch([
      "    zone z {",
      "        system ecu {",
      '            label "ECU"',
      "            component mcu {",
      "                pin can CAN_TX",
      "            }",
      "            component trx: can_transceiver",
      "",
      "            mcu.CAN_TX -> trx.TXD { type can }",
      "            mcu -> trx",
      "        }",
      "    }",
    ].join("\n")));
    expect(semantics(fmt(source))).toEqual(semantics(source));
  });

  it("keeps the `external` keyword and sorts it with the components", () => {
    const source = arch(["external  m:motor{label \"Motor\"}", "component a", "a -> m"].join("\n"));
    expect(fmt(source)).toBe(arch([
      '    external m: motor { label "Motor" }',
      "    component a",
      "",
      "    a -> m",
    ].join("\n")));
    expect(semantics(fmt(source))).toEqual(semantics(source));
  });

  it("writes count like hint, on its own as a single line", () => {
    expect(fmt(arch("component a {\n count   3\n}"))).toBe(arch("    component a { count 3 }"));
    expect(fmt(arch("component a { label \"A\" count 3 }"))).toBe(arch("    component a {\n        label \"A\"\n        count 3\n    }"));
  });

  it("writes single lines only for simple blocks", () => {
    const source = arch([
      'component a: block {   label "A"   }',
      "component b { size small importance primary }",
      "component c {}",
      "component d { pin can TX }",
      'a.X -> b { label "x"   type can }',
      'a.Y -> b { label "y" type can label "z" }',
      "c -> d {}",
    ].join("\n"));
    expect(fmt(source)).toBe(arch([
      '    component a: block { label "A" }',
      "    component b {",
      "        size small",
      "        importance primary",
      "    }",
      "    component c",
      "    component d {",
      "        pin can TX",
      "    }",
      "",
      '    a.X -> b { label "x" type can }',
      "    a.Y -> b {",
      '        label "y"',
      "        type can",
      '        label "z"',
      "    }",
      "    c -> d",
    ].join("\n")));
  });

  it("aligns inline blocks of connections, blank lines and multi-line blocks separate groups", () => {
    const source = arch([
      'a -> b { label "1" }',
      "long_name.PIN -> b",
      'b -> c { label "2" }',
      "",
      'c -> d { label "3" }',
    ].join("\n"));
    expect(fmt(source)).toBe(arch([
      '    a -> b { label "1" }',
      "    long_name.PIN -> b",
      '    b -> c { label "2" }',
      "",
      '    c -> d { label "3" }',
    ].join("\n")));

    const aligned = arch(['    x.OUT -> y.IN { label "1" }', '    y -> z        { label "2" }'].join("\n"));
    expect(fmt(aligned)).toBe(aligned);
  });

  it("writes side blocks with up to three unlabelled pins on one line and aligns them", () => {
    const source = [
      "define t {",
      "    left { pin power VIN pin digital EN }",
      "    right { pin power VOUT }",
      '    top { pin can TX "Transmit" }',
      "    bottom { pin ground GND pin ground AGND pin ground PGND pin ground DGND }",
      "}",
      "",
    ].join("\n");
    expect(fmt(source)).toBe([
      "define t {",
      "    left  { pin power VIN   pin digital EN }",
      "    right { pin power VOUT }",
      "    top {",
      '        pin can TX "Transmit"',
      "    }",
      "    bottom {",
      "        pin ground GND",
      "        pin ground AGND",
      "        pin ground PGND",
      "        pin ground DGND",
      "    }",
      "}",
      "",
    ].join("\n"));
  });

  it("wraps side blocks that would be wider than 80 characters", () => {
    const source = "define t {\n    left { pin analog CURRENT_SENSE_A pin analog CURRENT_SENSE_B pin analog CURRENT_SENSE_C }\n}\n";
    expect(fmt(source)).toContain("    left {\n        pin analog CURRENT_SENSE_A\n");
  });

  it("keeps `pin spacing` in the layout block", () => {
    const source = arch("layout {\nmode assisted\npin   spacing   3\n}");
    expect(fmt(source)).toBe(arch([
      "    layout {",
      "        mode assisted",
      "        pin spacing 3",
      "    }",
    ].join("\n")));
  });

  it("aligns grid columns", () => {
    const source = arch("layout {\ngrid {\nbattery|.|mcu\n.   |   regulator   |  wdg\n}\n}");
    expect(fmt(source)).toBe(arch([
      "    layout {",
      "        grid {",
      "            battery | .         | mcu",
      "            .       | regulator | wdg",
      "        }",
      "    }",
    ].join("\n")));
  });

  it("normalises blank lines, indentation, line endings and strings", () => {
    const source = '\n\n\r\narchitecture   "A \\"B\\"\\n\\\\"{\r\n\r\n\r\n\tcomponent a\r\n\r\n\r\n\r\n\tcomponent b\r\n\r\n}\r\n\r\n';
    expect(fmt(source)).toBe('architecture "A \\"B\\"\\n\\\\" {\n    component a\n\n    component b\n}\n');
  });

  it("writes empty blocks compactly", () => {
    expect(fmt('define t {}\narchitecture "A" { zone z { } }')).toBe('define t {}\n\narchitecture "A" {\n    zone z {}\n}\n');
  });

  it("leaves source with syntax errors unchanged", () => {
    const source = 'architecture "A" {\n  component a {\n';
    const { value, diagnostics } = format(source);
    expect(value).toBe(source);
    expect(diagnostics.map((d) => d.code)).toContain("E001");
  });

  it("formats files whose resolver reports errors", () => {
    expect(fmt('architecture "A" {\na -> unknown.X\n}')).toBe('architecture "A" {\n    a -> unknown.X\n}\n');
  });
});

describe("format: comments", () => {
  const cases: [string, string, string][] = [
    [
      "comments on their own lines move with their statement",
      '// file\n\narchitecture "A" {\n    a -> b\n\n    // component\n    component a\n}\n',
      '// file\n\narchitecture "A" {\n    // component\n    component a\n\n    a -> b\n}\n',
    ],
    [
      "comments at the end of a line stay on their line, even after reordering",
      'architecture "A" { // title\n    a -> b // connection\n    theme technical // theme\n}\n',
      'architecture "A" { // title\n    theme technical // theme\n\n    a -> b // connection\n}\n',
    ],
    [
      "a comment inside the block prevents the single line",
      'architecture "A" {\n    component a { label "A" // label\n    }\n    a -> b { /* x */ type can }\n}\n',
      'architecture "A" {\n    component a {\n        label "A" // label\n    }\n\n    a -> b { /* x */\n        type can\n    }\n}\n',
    ],
    [
      "comment at the end of a block and of the file",
      'architecture "A" {\n    component a {\n        label "A"\n\n        // end\n\n    }\n}\n// end of file\n',
      'architecture "A" {\n    component a {\n        label "A"\n\n        // end\n    }\n}\n// end of file\n',
    ],
    [
      "empty block with a comment",
      'architecture "A" {\n    component a { // nothing\n    }\n    zone z {\n        // empty\n    }\n}\n',
      'architecture "A" {\n    component a { // nothing\n    }\n    zone z {\n        // empty\n    }\n}\n',
    ],
    [
      "comments in the middle of a statement move in front of it",
      'architecture "A" {\n    component /* id */ a: /* t */ block\n    a.X /* arrow */ -> b\n}\n',
      'architecture "A" {\n    /* id */\n    /* t */\n    component a: block\n\n    /* arrow */\n    a.X -> b\n}\n',
    ],
    [
      "comments in grid rows",
      'architecture "A" {\n    layout {\n        grid {\n            a | /* empty */ . // row 1\n            // row 2\n            b | c\n        }\n    }\n}\n',
      'architecture "A" {\n    layout {\n        grid {\n            /* empty */\n            a | . // row 1\n            // row 2\n            b | c\n        }\n    }\n}\n',
    ],
  ];

  it.each(cases)("%s", (_, source, expected) => {
    expect(fmt(source)).toBe(expected);
    expect(fmt(expected)).toBe(expected);
  });
});
