import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IconError, convertIcon, loadStandardLibrary } from "../src/index.js";

const libraryDir = join(import.meta.dirname, "..", "..", "..", "library");
const svg = (body: string, attrs = 'viewBox="0 0 24 24" fill="none" stroke="currentColor"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

describe("library/automotive.archlib", () => {
  const { value, diagnostics } = loadStandardLibrary();

  it("loads without diagnostics", () => {
    expect(diagnostics).toEqual([]);
  });

  it("contains the base templates", () => {
    for (const name of ["block", "microcontroller", "half_bridge", "motor", "can_transceiver", "power_supply"]) {
      expect(value.templates.has(name), name).toBe(true);
    }
  });

  it("inherits defaults and pins", () => {
    expect(value.templates.get("ldo")).toMatchObject({ label: "LDO", icon: "regulator", category: "power", extends: "power_supply" });
    expect(value.templates.get("ldo")!.pins.map((p) => p.name)).toEqual(["VIN", "EN", "VOUT", "GND"]);
    expect(value.templates.get("battery")).toMatchObject({ icon: "battery", category: "power", size: "small" });
  });

  it("every icon SVG is built", () => {
    const files = readdirSync(join(libraryDir, "icons")).filter((f) => f.endsWith(".svg"));
    expect([...value.icons.keys()].sort()).toEqual(files.map((f) => f.replace(/\.svg$/, "")).sort());
  });

  it("contains the bundled set from 05-rendering-export.md", () => {
    const expected = [
      "battery", "power", "regulator", "fuse", "relay", "ground",
      "chip", "soc", "memory", "watchdog", "clock",
      "can", "lin", "ethernet", "switch", "bus", "connector",
      "driver", "bridge", "motor", "window", "valve", "lamp", "heater",
      "sensor", "temperature", "current", "position",
      "ecu", "software", "cloud", "vehicle",
    ];
    expect([...value.icons.keys()].sort()).toEqual(expected.sort());
  });
});

describe("convertIcon", () => {
  it("converts all allowed elements into paths", () => {
    const icon = convertIcon("t", svg(
      '<g><path d="M1 1h2"/><circle cx="12" cy="12" r="2"/><rect x="1" y="2" width="4" height="6"/>' +
      '<rect x="0" y="0" width="10" height="10" rx="2"/><line x1="0" y1="1" x2="3" y2="4"/>' +
      '<polyline points="1,1 2,2 3,1"/><polygon points="1 1 2 2 3 1" fill="currentColor"/></g>',
    ));
    expect(icon.elements).toEqual([
      { d: "M1 1h2", mode: "stroke" },
      { d: "M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z", mode: "stroke" },
      { d: "M1 2h4v6h-4Z", mode: "stroke" },
      { d: "M2 0h6a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2Z", mode: "stroke" },
      { d: "M0 1L3 4", mode: "stroke" },
      { d: "M1 1L2 2L3 1", mode: "stroke" },
      { d: "M1 1L2 2L3 1Z", mode: "fill" },
    ]);
  });

  it("inherits fill from groups and removes fixed colours", () => {
    const icon = convertIcon("t", svg('<g fill="#ff0000"><path d="M0 0h1"/></g><path d="M0 0h2" stroke="red"/>'));
    expect(icon.elements).toEqual([{ d: "M0 0h1", mode: "fill" }, { d: "M0 0h2", mode: "stroke" }]);
    expect(JSON.stringify(icon)).not.toMatch(/red|#ff0000/);
  });

  it.each([
    ["wrong viewBox", svg('<path d="M0 0"/>', 'viewBox="0 0 32 32"')],
    ["image", svg('<image href="x.png"/>')],
    ["text", svg("<text>A</text>")],
    ["use", svg('<use href="other.svg#a"/>')],
    ["style element", svg("<style>path{}</style>")],
    ["style attribute", svg('<path d="M0 0" style="fill:red"/>')],
    ["script", svg("<script>alert(1)</script>")],
    ["filter", svg('<filter id="f"/>')],
    ["gradient", svg('<linearGradient id="g"/>')],
    ["mask", svg('<mask id="m"/>')],
    ["transform", svg('<path d="M0 0" transform="scale(2)"/>')],
    ["empty", svg("")],
    ["no svg", '<path d="M0 0"/>'],
  ])("rejects %s", (_, source) => {
    expect(() => convertIcon("t", source)).toThrow(IconError);
  });
});
