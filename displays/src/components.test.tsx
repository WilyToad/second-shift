import { beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

beforeAll(() => {
  const window = new Window({ url: "http://127.0.0.1:5170/" });
  Object.assign(globalThis, { window, document: window.document, MutationObserver: window.MutationObserver, requestAnimationFrame: (f: () => void) => setTimeout(f, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
});

test("segments split text and chart specs, and hide an unfinished block", async () => {
  const { segments } = await import("./components");
  const done = segments("Science stalled.\n```rate_chart\nitem=automation-science-pack surface=nauvis window=1h\n```\nQueue research.");
  expect(done.map((s) => s.kind)).toEqual(["text", "rate_chart", "text"]);
  expect(done[1]).toMatchObject({ item: "automation-science-pack", surface: "nauvis", windowMin: 60, source: "science" });
  expect(segments("Stalled.\n```rate_chart\nitem=auto").map((s) => s.kind)).toEqual(["text", "pending"]);
});

test("rate chart draws from recorded series, and says so when there is none", async () => {
  const { render } = await import("preact");
  const { RateChart } = await import("./components");
  const { series } = await import("./store");
  series.value = { "gleba/produced/bioflux": Array.from({ length: 20 }, (_, i) => ({ t: 60_000 * i, v: 30 + i })) };
  const root = document.createElement("div");
  render(<>
    <RateChart spec={{ kind: "rate_chart", item: "bioflux", surface: "gleba", windowMin: 30, source: "produced" }} />
    <RateChart spec={{ kind: "rate_chart", item: "carbon", surface: "vulcanus", windowMin: 30, source: "produced" }} />
  </>, root);
  expect(root.querySelector(".chart-line")?.getAttribute("d")?.split("L").length).toBe(20);
  expect(root.textContent).toContain("49/min");
  expect(root.textContent).toContain("No recorded history for carbon on vulcanus yet.");
});

test("recipe graph draws steps, raw inputs and edges from a computed plan", async () => {
  const { render } = await import("preact");
  const { RecipeGraph } = await import("./components");
  const root = document.createElement("div");
  render(<RecipeGraph plan={{
    item: "electronic-circuit", perMinute: 120, notes: ["no modules"],
    raw: { "iron-plate": 120, "copper-plate": 180 },
    steps: [
      { item: "electronic-circuit", recipe: "electronic-circuit", machine: "assembling-machine-2", machineSpeed: 0.75, productivity: 0, unlocked: true, perMinute: 120, machines: 1.33, inputs: ["iron-plate", "copper-cable"] },
      { item: "copper-cable", recipe: "copper-cable", machine: "assembling-machine-2", machineSpeed: 0.75, productivity: 0, unlocked: true, perMinute: 360, machines: 2, inputs: ["copper-plate"] },
    ],
  }} />, root);
  expect(root.querySelectorAll(".graph-node").length).toBe(4);
  expect(root.querySelectorAll(".graph-node.raw").length).toBe(2);
  expect(root.querySelectorAll(".graph-edge").length).toBe(3);
  expect(root.textContent).toContain("1.33× assembler 2");
  expect(root.textContent).toContain("180/min input");
});

test("a wide recipe graph scales to fit its card before it scrolls", async () => {
  const { render } = await import("preact");
  const { RecipeGraph } = await import("./components");
  const root = document.createElement("div");
  const step = (item: string, inputs: string[]) => ({ item, recipe: item, machine: "assembling-machine-3", machines: 1, perMinute: 60, inputs, unlocked: true });
  render(<RecipeGraph plan={{ item: "e", perMinute: 60, raw: { a: 60 }, steps: [step("b", ["a"]), step("c", ["b"]), step("d", ["c"]), step("e", ["d"])], notes: [] } as any} />, root);
  const svg = root.querySelector("svg")!;
  const width = Number(svg.getAttribute("width"));
  expect(svg.style.width).toBe("100%");
  expect(svg.style.minWidth).toBe(`${Math.round(width * 0.8)}px`);
  // Machine lines are trimmed to fit inside a node.
  expect([...root.querySelectorAll(".graph-sub")].every((t) => (t.textContent ?? "").length <= 20)).toBe(true);
  expect(root.textContent).toContain("1× assembler 3");
});
