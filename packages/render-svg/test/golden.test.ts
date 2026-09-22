import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, projectView, SHAPES, standardLibrary } from "@sysarch/core";
import { layout } from "@sysarch/layout";
import { getTheme } from "@sysarch/themes";
import { describe, expect, it } from "vitest";
import { renderSvg } from "../src/index.js";
import type { ArchitectureModel } from "@sysarch/core";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const golden = (file: string) => join(root, "tests", "golden", file);
const examples = readdirSync(join(root, "examples")).filter((f) => f.endsWith(".arch")).sort();

function render(model: ArchitectureModel) {
  const scene = layout(model, getTheme(model.theme));
  return { scene, svg: renderSvg(scene) };
}

function build(file: string) {
  const { value, diagnostics } = compile(readFileSync(join(root, "examples", file), "utf8"));
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return { model: value, ...render(value) };
}

// Update with `npx vitest run -u` — changes show up as a diff in review.
describe("golden files", () => {
  for (const file of examples) {
    const name = basename(file, ".arch");
    it(name, async () => {
      const { model, scene, svg } = build(file);
      await expect(JSON.stringify(scene, null, 2) + "\n").toMatchFileSnapshot(golden(`${name}.scene.json`));
      await expect(svg).toMatchFileSnapshot(golden(`${name}.svg`));
      // `sysarch render` writes one file per view; CI compares those against these files.
      for (const view of model.views) {
        await expect(render(projectView(model, view.id)).svg).toMatchFileSnapshot(golden(`${name}-${view.id}.svg`));
      }
    });
  }

  it("cover every shape and every bundled icon at least once", () => {
    const svgs = examples.map((f) => build(f).svg).join("\n");
    for (const shape of SHAPES) expect(svgs, `shape ${shape}`).toContain(`sa-shape-${shape}`);
    for (const icon of standardLibrary().icons.keys()) expect(svgs, `icon ${icon}`).toContain(`<symbol id="sa-icon-${icon}"`);
  });
});
