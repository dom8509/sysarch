import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile, parse, type ComponentNode, type ConnectionNode, type GridNode, type LayoutStmt, type SystemNode, type ZoneNode } from "../src/index.js";

const examplesDir = join(import.meta.dirname, "..", "..", "..", "examples");
const examples = readdirSync(examplesDir).filter((f) => f.endsWith(".arch")).sort();

describe("examples/*.arch", () => {
  it("there are examples", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples)("%s parses and resolves without errors or warnings", (file) => {
    const source = readFileSync(join(examplesDir, file), "utf8");
    expect(parse(source).diagnostics).toEqual([]);
    const result = compile(source);
    expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(result.value.components.size).toBeGreaterThan(0);
  });
});

describe("parse", () => {
  it("builds the syntax tree with source ranges", () => {
    const source = 'architecture "A" {\n    component mcu: microcontroller { label "S32K3" }\n    mcu.PWM -> drv { type pwm }\n}';
    const { value, diagnostics } = parse(source);
    expect(diagnostics).toEqual([]);
    const [component, connection] = value.architecture!.body as [ComponentNode, ConnectionNode];
    expect(component).toMatchObject({ kind: "Component", id: { name: "mcu" }, template: { name: "microcontroller" } });
    expect(source.slice(component.span.start, component.span.end)).toBe('component mcu: microcontroller { label "S32K3" }');
    expect(component.span).toMatchObject({ line: 2, column: 5 });
    expect(connection).toMatchObject({ arrow: "->", from: { component: { name: "mcu" }, pin: { name: "PWM" } }, to: { component: { name: "drv" } } });
    expect(connection.body).toMatchObject([{ kind: "Type", value: { name: "pwm" } }]);
  });

  it("treats keywords depending on context", () => {
    const { value, diagnostics } = parse('architecture "A" {\n component power: block\n component theme\n power -> theme\n theme.X -- power\n}');
    expect(diagnostics).toEqual([]);
    expect(value.architecture!.body.map((s) => s.kind)).toEqual(["Component", "Component", "Connection", "Connection"]);
  });

  it("reads `external` as a component with the external flag", () => {
    const source = 'architecture "A" {\n zone z { external x1: connector\n system s { external m: motor } }\n component a\n}';
    const { value, diagnostics } = parse(source);
    expect(diagnostics).toEqual([]);
    const zone = value.architecture!.body[0] as ZoneNode;
    expect(zone.body.map((s) => (s as ComponentNode).external)).toEqual([true, undefined]);
    const system = zone.body[1] as SystemNode;
    expect(system.body[0]).toMatchObject({ kind: "Component", id: { name: "m" }, external: true });
    expect((value.architecture!.body[1] as ComponentNode).external).toBeUndefined();
  });

  it("reads connections inside a system, but not inside a zone", () => {
    const source = 'architecture "A" {\n zone z {\n system ecu {\n component mcu\n component trx\n mcu -> trx\n }\n }\n}';
    const { value, diagnostics } = parse(source);
    expect(diagnostics).toEqual([]);
    const zone = value.architecture!.body[0] as ZoneNode;
    const system = zone.body[0] as SystemNode;
    expect(system.body.map((s) => s.kind)).toEqual(["Component", "Component", "Connection"]);
    expect(system.body[2]).toMatchObject({ kind: "Connection", from: { component: { name: "mcu" } }, to: { component: { name: "trx" } } });

    const inZone = parse('architecture "A" {\n zone z {\n component a\n component b\n a -> b\n }\n}');
    expect(inZone.diagnostics.map((d) => `${d.code} ${d.span.line}:${d.span.column}`)).toEqual(["E001 5:2"]);
    expect(inZone.diagnostics[0]!.message).toContain("not allowed in a zone");
  });

  it("splits grid rows at line breaks", () => {
    const { value, diagnostics } = parse('architecture "A" {\n layout {\n  mode assisted\n  grid {\n   a | . | b\n   . | c | .\n  }\n }\n}');
    expect(diagnostics).toEqual([]);
    const layout = value.architecture!.body[0] as LayoutStmt;
    const grid = layout.body[1] as GridNode;
    expect(grid.rows.map((r) => r.cells.map((c) => c.id?.name ?? "."))).toEqual([["a", ".", "b"], [".", "c", "."]]);
  });

  it("preserves comments as trivia", () => {
    const { value } = parse('// head\narchitecture "A" {\n    // before mcu\n    component mcu\n    // at the end\n}\n// end of file\n');
    const a = value.architecture!;
    expect(a.leadingTrivia.map((t) => t.text)).toEqual(["// head"]);
    expect(a.body[0]!.leadingTrivia.map((t) => t.text)).toEqual(["// before mcu"]);
    expect(a.closingTrivia?.map((t) => t.text)).toEqual(["// at the end"]);
    expect(value.closingTrivia?.map((t) => t.text)).toEqual(["// end of file"]);
  });

  it("reads pins with a display label, side blocks, hints and meta", () => {
    const { value, diagnostics } = parse(`architecture "A" {
      component mcu {
        pin power VDD "Supply"
        left { pin can CAN_TX pin can CAN_RX }
        hint row 2
        meta { voltage "12 V" part "S32K344" }
      }
    }`);
    expect(diagnostics).toEqual([]);
    const body = (value.architecture!.body[0] as ComponentNode).body!;
    expect(body.map((s) => s.kind)).toEqual(["Pin", "SideBlock", "Hint", "Meta"]);
    expect(body[0]).toMatchObject({ signal: { name: "power" }, name: { name: "VDD" }, label: { value: "Supply" } });
    expect(body[1]).toMatchObject({ side: "left", pins: [{ name: { name: "CAN_TX" } }, { name: { name: "CAN_RX" } }] });
    expect(body[2]).toMatchObject({ axis: "row", value: 2 });
  });

  it("reads templates with extends, shape and icon", () => {
    const { value, diagnostics } = parse('define m extends motor {\n shape circle\n icon none\n right { pin power OUT }\n}\narchitecture "A" {}');
    expect(diagnostics).toEqual([]);
    expect(value.defines[0]).toMatchObject({ name: { name: "m" }, extends: { name: "motor" } });
    expect(value.defines[0]!.body.map((s) => s.kind)).toEqual(["Shape", "Icon", "SideBlock"]);
  });
});

describe("error tolerance", () => {
  it("returns a partial AST for broken input", () => {
    const source = `architecture "A" {
    component mcu: microcontroller {
        label "MCU"
        pin power
        pin can CAN_TX
    }
    component drv:
    component motor: motor
    mcu.CAN_TX -> motor
}`;
    const { value, diagnostics } = parse(source);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.code === "E001")).toBe(true);
    const body = value.architecture!.body;
    const mcu = body[0] as ComponentNode;
    expect(mcu.id.name).toBe("mcu");
    // The broken pin is dropped, the rest of the component stays.
    expect(mcu.body!.map((s) => s.kind)).toEqual(["Label", "Pin"]);
    expect(body.map((s) => s.kind)).toContain("Connection");
    expect(body.filter((s) => s.kind === "Component").map((c) => (c as ComponentNode).id.name)).toContain("motor");
  });

  it("parses `pin spacing` and rejects values below 1", () => {
    const { value, diagnostics } = parse('architecture "A" {\n layout { pin spacing 3 }\n}');
    expect(diagnostics).toEqual([]);
    const layout = value.architecture!.body[0] as LayoutStmt;
    expect(layout.body).toMatchObject([{ kind: "PinSpacing", value: 3 }]);
    expect(parse('architecture "A" {\n layout { pin spacing 0 }\n}').diagnostics.map((d) => d.code)).toEqual(["E001"]);
  });

  it("returns a partial AST when the closing brace is missing", () => {
    const { value, diagnostics } = parse('architecture "A" {\n component a\n component b\n a -> b');
    expect(diagnostics.map((d) => d.code)).toEqual(["E001"]);
    expect(value.architecture!.body.map((s) => s.kind)).toEqual(["Component", "Component", "Connection"]);
  });

  it("synchronises on the next keyword in the same line", () => {
    const { value, diagnostics } = parse('architecture "A" {\n component a { size huge label "A" }\n}');
    expect(diagnostics.map((d) => d.code)).toEqual(["E001"]);
    expect((value.architecture!.body[0] as ComponentNode).body!.map((s) => s.kind)).toEqual(["Label"]);
  });

  it("skips unknown statements with a suggestion", () => {
    const { value, diagnostics } = parse('architecture "A" {\n component a {\n  lable "x"\n  size small\n }\n}');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("did you mean `label`?");
    expect(diagnostics[0]!.suggestions).toMatchObject([{ replacement: "label" }]);
    expect((value.architecture!.body[0] as ComponentNode).body!.map((s) => s.kind)).toEqual(["Size"]);
  });

  it("terminates on arbitrary garbage without crashing", () => {
    for (const source of ["}", "{{{", "architecture", 'architecture "x" { a -> }', "-> <- | : .", "define", 'architecture "A" { layout { grid { a | } } }']) {
      const { value, diagnostics } = parse(source);
      expect(value.kind).toBe("Document");
      expect(diagnostics.length).toBeGreaterThan(0);
    }
  });

  it("keeps the preview alive even mid-typing", () => {
    const source = readFileSync(join(examplesDir, "body-control-module.arch"), "utf8");
    for (let cut = 0; cut <= source.length; cut += 7) {
      const result = compile(source.slice(0, cut));
      expect(result.value.components).toBeInstanceOf(Map);
    }
  });
});
