import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, projectView, SIDES } from "@sysarch/core";
import { layout } from "@sysarch/layout";
import { getTheme } from "@sysarch/themes";
import { describe, expect, it } from "vitest";
import { bodyHandle, toReactFlow, type ComponentNode, type ReactFlowExport } from "../src/index.js";
import type { ArchitectureModel } from "@sysarch/core";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const examples = readdirSync(join(root, "examples")).filter((f) => f.endsWith(".arch")).sort();

const exportModel = (model: ArchitectureModel): ReactFlowExport =>
  toReactFlow(model, layout(model, getTheme(model.theme)));

function compileSource(source: string): ArchitectureModel {
  const { value, diagnostics } = compile(source);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return value;
}

const exportSource = (source: string): ReactFlowExport => exportModel(compileSource(source));

const readExample = (file: string) => readFileSync(join(root, "examples", file), "utf8");
const exportExample = (file: string) => exportSource(readExample(file));

/** Absolute position of a node via the parent chain. */
function absolute(flow: ReactFlowExport, id: string): { x: number; y: number } {
  const node = flow.nodes.find((n) => n.id === id)!;
  const parent = node.parentId === undefined ? { x: 0, y: 0 } : absolute(flow, node.parentId);
  return { x: parent.x + node.position.x, y: parent.y + node.position.y };
}

const size = (n: ReactFlowExport["nodes"][number]) =>
  "style" in n ? n.style : { width: n.width, height: n.height };

describe("React Flow export", () => {
  // Update with: `npx vitest run -u`
  for (const file of examples) {
    const name = basename(file, ".arch");
    it(`${name} matches the golden file`, async () => {
      const model = compileSource(readExample(file));
      await expect(JSON.stringify(exportModel(model), null, 2) + "\n")
        .toMatchFileSnapshot(join(root, "tests", "golden", `${name}.reactflow.json`));
      // `sysarch render --format reactflow` writes one file per view; CI compares those too.
      for (const view of model.views) {
        await expect(JSON.stringify(exportModel(projectView(model, view.id)), null, 2) + "\n")
          .toMatchFileSnapshot(join(root, "tests", "golden", `${name}-${view.id}.reactflow.json`));
      }
    });

    it(`${name} is loadable: parents first, handles present, geometry fits`, () => {
      const flow = exportExample(file);
      const ids = flow.nodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(flow.edges.map((e) => e.id)).size).toBe(flow.edges.length);

      flow.nodes.forEach((node, index) => {
        if (node.parentId === undefined) return;
        const parentIndex = ids.indexOf(node.parentId);
        expect(parentIndex, `${node.id}: parent node before the child`).toBeGreaterThanOrEqual(0);
        expect(parentIndex).toBeLessThan(index);
        const parent = size(flow.nodes[parentIndex]!);
        const own = size(node);
        expect(node.position.x).toBeGreaterThanOrEqual(0);
        expect(node.position.y).toBeGreaterThanOrEqual(0);
        expect(node.position.x + own.width).toBeLessThanOrEqual(parent.width);
        expect(node.position.y + own.height).toBeLessThanOrEqual(parent.height);
      });

      for (const edge of flow.edges) {
        for (const end of ["source", "target"] as const) {
          const node = flow.nodes.find((n) => n.id === edge[end]) as ComponentNode | undefined;
          expect(node, `${edge.id}: ${end}`).toBeDefined();
          const handle = end === "source" ? edge.sourceHandle : edge.targetHandle;
          const [px, py] = end === "source" ? edge.data.points[0]! : edge.data.points[edge.data.points.length - 1]!;
          const at = absolute(flow, node!.id);
          const pin = node!.data.pins.find((p) => p.id === handle);
          if (pin) {
            const expected = pin.side === "left" ? [at.x, at.y + pin.offset]
              : pin.side === "right" ? [at.x + node!.width, at.y + pin.offset]
              : pin.side === "top" ? [at.x + pin.offset, at.y]
              : [at.x + pin.offset, at.y + node!.height];
            expect([px, py], `${edge.id}: route ends at pin ${handle}`).toEqual(expected);
          } else {
            expect(SIDES.map(bodyHandle), `${edge.id}: Handle ${handle}`).toContain(handle);
          }
        }
      }
    });
  }

  it("exports the same view as the image when stack identical is set", () => {
    const flow = exportSource(`architecture "A" {
    stack identical
    component mcu: microcontroller
    component l1: load { label "Lamp 1" }
    component l2: load { label "Lamp 2" }
    mcu -> l1
    mcu -> l2
}
`);
    expect(flow.nodes.map((n) => n.id)).toEqual(["mcu", "l1"]);
    expect((flow.nodes[1] as ComponentNode).data).toMatchObject({ label: "Lamp", count: 2 });
    expect(flow.edges).toHaveLength(1);
  });

  it("marks external components in the node data", () => {
    const flow = exportSource(`architecture "A" {
    component a: microcontroller
    external m: motor
}
`);
    const [a, m] = flow.nodes as ComponentNode[];
    expect("external" in a!.data).toBe(false);
    expect(m!.data.external).toBe(true);
  });

  it("exports count only for multiple elements", () => {
    const flow = exportSource(`architecture "A" {
    component a { count 3 }
    component b
}
`);
    const [a, b] = flow.nodes as ComponentNode[];
    expect(a!.data.count).toBe(3);
    expect("count" in b!.data).toBe(false);
  });

  it("attaches edges to the body when pins are hidden", () => {
    const flow = exportSource(`architecture "A" {
    pins none
    component psu: power_supply
    component mcu: microcontroller { pin power VDD }
    psu.VOUT -> mcu.VDD
}
`);
    const [edge] = flow.edges;
    expect(SIDES.map(bodyHandle)).toContain(edge!.sourceHandle);
    expect(SIDES.map(bodyHandle)).toContain(edge!.targetHandle);
    for (const node of flow.nodes as ComponentNode[]) expect(node.data.pins).toEqual([]);
  });

  it("maps body connection points, directions and metadata", () => {
    const flow = exportSource(`architecture "A" {
    zone z {
        label "Zone"
        system s {
            component a: microcontroller {
                pin can CAN_TX
                meta { part "S32K344" }
            }
        }
    }
    zone y {
        component b
        component c
    }
    a.CAN_TX <-> b
    b -- c
}
`);
    expect(flow.nodes.map((n) => [n.id, n.type, n.parentId])).toEqual([
      ["z", "group", undefined], ["s", "group", "z"], ["a", "microcontroller", "s"], ["y", "group", undefined], ["b", "block", "y"], ["c", "block", "y"],
    ]);
    const a = flow.nodes[2] as ComponentNode;
    expect(a.data).toMatchObject({ category: "controller", meta: { part: "S32K344" }, icon: { name: "chip" } });
    const [ab, bc] = flow.edges;
    expect(ab).toMatchObject({
      sourceHandle: "CAN_TX", targetHandle: "__body_left",
      markerStart: { type: "arrowclosed" }, markerEnd: { type: "arrowclosed" },
      className: "sa-edge sa-group-bus sa-kind-can",
    });
    expect(bc).not.toHaveProperty("markerEnd");
    expect(bc!.data.direction).toBe("none");
  });
});
