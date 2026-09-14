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
