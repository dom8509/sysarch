import { describe, expect, it } from "vitest";
import { compile, loadLibrary, parse, resolve, standardLibrary } from "../src/index.js";
import { arch, problems } from "./helpers.js";

const model = (source: string) => {
  const result = compile(source);
  const errors = result.diagnostics.filter((d) => d.severity !== "info");
  expect(errors, JSON.stringify(errors, null, 1)).toEqual([]);
  return result.value;
};

describe("document settings", () => {
  it("sets default values", () => {
    const m = model('architecture "Title" {}');
    expect(m).toMatchObject({ title: "Title", theme: "automotive-light", direction: "LR", layoutMode: "strict" });
    expect(m.grid).toBeUndefined();
  });

  it("applies theme, direction, layout and grid", () => {
    const m = model(arch(" theme technical\n direction TB\n component a\n layout { mode assisted\n grid {\n a | .\n } }"));
    expect(m).toMatchObject({ theme: "technical", direction: "TB", layoutMode: "assisted" });
    expect(m.grid!.rows).toEqual([["a", null]]);
    expect(m.pins).toBe("all");
  });

  it("applies count, default 1", () => {
    const m = model(arch(" component a { count 4 }\n component b"));
    expect(m.components.get("a")!.count).toBe(4);
    expect(m.components.get("b")!.count).toBe(1);
  });

  it("applies pins and keeps the pins in the model", () => {
    const { value: m, diagnostics } = compile(arch(" pins connected\n component a: power_supply\n component b\n a.VOUT -> b"));
    expect(m.pins).toBe("connected");
    expect(m.components.get("a")!.pins.map((p) => p.name)).toEqual(["VIN", "EN", "VOUT", "GND"]);
    // Unconnected pins are not drawn, so no I301.
    expect(diagnostics.map((d) => d.code)).not.toContain("I301");
  });
});

describe("components", () => {
  it("label precedence: instance › template › id", () => {
    const m = model(arch(' component a: motor { label "Window" }\n component b: motor\n component c'));
    expect([...m.components.values()].map((c) => c.label)).toEqual(["Window", "Motor", "c"]);
  });

  it("takes shape, icon, category and size from the template", () => {
    const m = model(arch(" component m: motor\n component x"));
    expect(m.components.get("m")).toMatchObject({ template: "motor", shape: "circle", icon: "motor", category: "actuator", size: "small", importance: "secondary" });
    expect(m.components.get("x")).toMatchObject({ template: "block", shape: "rounded", category: "generic", size: "medium" });
    expect(m.components.get("x")!.icon).toBeUndefined();
  });

  it("instance overrides size, importance, category; stores meta", () => {
    const m = model(arch(' component a: motor { size large importance primary category power meta { voltage "12 V" } }'));
    expect(m.components.get("a")).toMatchObject({ size: "large", importance: "primary", category: "power", meta: { voltage: "12 V" } });
  });

  it("local templates inherit and remove icons with `icon none`", () => {
    const result = compile(arch(" component a: quiet\n component b: window_motor", "define quiet extends motor { icon none }\ndefine window_motor extends motor { icon window }"));
    expect(result.value.components.get("a")!.icon).toBeUndefined();
    expect(result.value.components.get("a")!.shape).toBe("circle");
    expect(result.value.components.get("b")!.icon).toBe("window");
  });

  it("builds the group tree with groupPath", () => {
    const m = model(arch(' zone z { label "Zone"\n system ecu { label "ECU"\n system inner { component a } }\n component b }'));
    expect(m.root.children).toEqual(["z"]);
    expect(m.groups.get("z")).toMatchObject({ type: "zone", label: "Zone", children: ["ecu", "b"] });
    expect(m.groups.get("ecu")).toMatchObject({ type: "system", label: "ECU", children: ["inner"] });
    expect(m.components.get("a")!.groupPath).toEqual(["z", "ecu", "inner"]);
    expect(m.components.get("b")!.groupPath).toEqual(["z"]);
  });

  it("marks components declared with `external`, everywhere `component` is allowed", () => {
    const m = model(arch(" zone z { system ecu { component mcu: microcontroller }\n external x1: connector }"));
    expect(m.components.get("x1")).toMatchObject({ external: true, template: "connector", groupPath: ["z"] });
    expect(m.components.get("mcu")!.external).toBe(false);
  });

  it("reports no unconnected pins on an external component", () => {
    const { diagnostics } = compile(arch(" component a: half_bridge\n external m: motor { left { pin power A   pin power B } }\n a.OUT -> m.A"));
    expect(diagnostics.filter((d) => d.code === "I301").map((d) => d.message)).not.toContain("Pin `m.B` is not connected");
    expect(diagnostics.filter((d) => d.code === "I301").length).toBeGreaterThan(0);
  });

  it("reads the pin spacing from `layout`, in grid units", () => {
    expect(model(arch(" layout { pin spacing 3 }\n component a")).pinSpacing).toBe(3);
    expect(model(arch(" component a")).pinSpacing).toBeUndefined();
  });

  it("stores hints only in mode assisted", () => {
    expect(model(arch(" layout { mode assisted }\n component a { hint row 2 hint column 3 }")).components.get("a")!.hints).toEqual({ row: 2, column: 3 });
    expect(compile(arch(" component a { hint row 2 }")).value.components.get("a")!.hints).toEqual({});
  });
});

describe("Pins", () => {
  it("template pins first, then instance pins; sides from template and block", () => {
    const m = compile(arch(" component hb: half_bridge { top { pin digital EN } }")).value;
    const pins = m.components.get("hb")!.pins;
    expect(pins.map((p) => `${p.name}:${p.side}:${p.sideSource}`)).toEqual([
      "VS:left:template", "IN:left:template", "OUT:right:template", "IS:bottom:template", "GND:bottom:template", "EN:top:explicit",
    ]);
  });

  it("redeclaring with the same kind moves the pin, its position stays", () => {
    const pins = compile(arch(' component hb: half_bridge { right { pin digital IN "Input" } }')).value.components.get("hb")!.pins;
    expect(pins[1]).toMatchObject({ name: "IN", side: "right", sideSource: "explicit", label: "Input" });
  });

  it("derives sides from connections (LR)", () => {
    const m = compile(arch(" component a { pin digital OUT pin digital IN pin digital FREE pin digital BI }\n component b\n a.OUT -> b\n b -> a.IN\n a.BI <-> b")).value;
    const sides = Object.fromEntries(m.components.get("a")!.pins.map((p) => [p.name, `${p.side}:${p.sideSource}`]));
    expect(sides).toEqual({ OUT: "right:inferred", IN: "left:inferred", FREE: "left:inferred", BI: "left:inferred" });
  });

  it("derives sides from connections (TB)", () => {
    const m = compile(arch(" direction TB\n component a { pin digital OUT pin digital IN }\n component b\n a.OUT -> b\n a.IN <- b")).value;
    expect(m.components.get("a")!.pins.map((p) => p.side)).toEqual(["bottom", "top"]);
  });

  it("the pin label defaults to the name", () => {
    const pins = compile(arch(' component a { pin power VDD pin ground GND "Ground" }')).value.components.get("a")!.pins;
    expect(pins.map((p) => p.label)).toEqual(["VDD", "Ground"]);
  });
});

describe("connections", () => {
  const conn = (body: string) => compile(arch(body)).value.connections;

  it("normalises directions", () => {
    const c = conn(" component a\n component b\n a -> b\n a <- b\n a <-> b\n a -- b");
    expect(c.map((x) => `${x.source.component}>${x.target.component}:${x.direction}`)).toEqual([
      "a>b:forward", "b>a:forward", "a>b:bidirectional", "a>b:none",
    ]);
  });

  it("assigns stable IDs per endpoint pair", () => {
    const c = conn(" component a { pin digital X }\n component b\n a.X -> b\n a -> b\n a.X -> b\n b <- a.X");
    expect(c.map((x) => x.id)).toEqual(["a.X->b#1", "a->b#1", "a.X->b#2", "a.X->b#3"]);
  });

  it("derives the type", () => {
    const c = conn(` component a { pin power P pin pwm PWM pin analog AN }
 component b { pin power P pin digital D }
 a.P -> b.P
 a.PWM -> b.D
 b.D <- a.AN
 a.PWM -> b
 b -> a.AN
 a -> b
 a -> b { type can label "CAN" }`);
    expect(c.map((x) => `${x.kind}:${x.kindSource}`)).toEqual([
      "power:inferred", "pwm:inferred", "analog:inferred", "pwm:inferred", "analog:inferred", "signal:inferred", "can:explicit",
    ]);
    expect(c[6]!.label).toBe("CAN");
  });

  it("takes connections from system blocks, in document order", () => {
    const m = model(arch(` component sensor
 system ecu {
 component mcu
 system core { component cpu }
 mcu -> cpu
 }
 sensor -> mcu`));
    expect(m.connections.map((c) => c.id)).toEqual(["mcu->cpu#1", "sensor->mcu#1"]);
  });

  it("warns about an endpoint outside the enclosing system", () => {
    const source = arch(" component sensor\n system ecu {\n component mcu\n sensor -> mcu\n }");
    expect(problems(source)).toEqual(["W206 6:2"]);
    // The connection itself stays in the model — where it is written changes nothing.
    expect(compile(source).value.connections.map((c) => c.id)).toEqual(["sensor->mcu#1"]);
  });

  it("discards connections with invalid endpoints entirely", () => {
    const result = compile(arch(" component a { pin digital X }\n component b\n a.Y -> b\n c -> b\n a.X -> b"));
    expect(result.value.connections.map((c) => c.id)).toEqual(["a.X->b#1"]);
  });
});

describe("invariants on errors", () => {
  it("every component appears exactly once in the group tree, even with duplicate IDs and E106", () => {
    const m = compile(arch(" zone z { component a\n component a }\n component b")).value;
    const all: string[] = [];
    const walk = (children: string[]) => {
      for (const child of children) {
        const group = m.groups.get(child);
        if (group) walk(group.children);
        else all.push(child);
      }
    };
    walk(m.root.children);
    expect(all.sort()).toEqual([...m.components.keys()].sort());
  });

  it("the grid contains only existing components", () => {
    const m = compile(arch(" component a\n layout { grid { a | ghost } }")).value;
    expect(m.grid!.rows).toEqual([["a", null]]);
  });

  it("spanned cells stay in the grid", () => {
    const { value: m, diagnostics } = compile(arch(" component a\n component b\n layout { grid {\n a | a | b\n a | a | .\n } }"));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(m.grid!.rows).toEqual([["a", "a", "b"], ["a", "a", null]]);
  });

  it("spanned cells count for zone contiguity up to the last column", () => {
    const { diagnostics } = compile(arch(" zone z1 { component a }\n zone z2 { component b }\n layout { grid {\n a | a | .\n . | b | .\n } }"));
    expect(diagnostics.map((d) => d.code)).toContain("E108");
  });

  it("an unknown template falls back to block", () => {
    const m = compile(arch(" component a: nope")).value;
    expect(m.components.get("a")).toMatchObject({ template: "block", shape: "rounded" });
  });
});

describe("library", () => {
  it("resolve accepts a custom library", () => {
    const lib = loadLibrary("define box { shape rect category external left { pin can C } }", []);
    expect(lib.diagnostics).toEqual([]);
    const result = resolve(parse(arch(" component x: box")).value, lib.value);
    expect(result.value.components.get("x")).toMatchObject({ shape: "rect", category: "external", label: "x" });
    expect(result.value.components.get("x")!.pins).toMatchObject([{ name: "C", side: "left" }]);
  });

  it("reports architectures inside libraries", () => {
    expect(loadLibrary('architecture "x" {}', []).diagnostics.map((d) => d.code)).toEqual(["E001"]);
  });

  it("the standard library is loaded only once", () => {
    expect(standardLibrary()).toBe(standardLibrary());
  });
});
