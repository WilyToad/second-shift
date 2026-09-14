import { beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

beforeAll(() => {
  const window = new Window({ url: "http://127.0.0.1:5170/" });
  Object.assign(globalThis, { window, document: window.document, MutationObserver: window.MutationObserver, requestAnimationFrame: (f: () => void) => setTimeout(f, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
});

const digestMsg = (tick: number, rate: number) => ({
  type: "digest" as const, receivedAt: 1000 + tick,
  digest: {
    tick, player: { name: "p", surface: "gleba", position: { x: 9, y: 0 } },
    research: { current: "carbon-fiber", progress: 0.62, queue: ["carbon-fiber", "stack-inserter"] },
    surfaces: [{ name: "gleba", produced: [{ name: "bioflux", per_minute: rate }], consumed: [], science: [{ name: "agricultural-science-pack", per_minute: 0, per_minute_10h: 15.6 }], age_ticks: 0 }],
    alerts: [{ surface: "gleba", type: "entity_destroyed", count: 1 }],
  },
});

test("alert feed and live panel render events, research, rates and stalled science", async () => {
  const { render } = await import("preact");
  const { AlertFeed, LivePanel } = await import("./console");
  const { onMessage } = await import("./store");
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(<><AlertFeed /><LivePanel /></>, root);

  onMessage(digestMsg(3600, 30));
  onMessage(digestMsg(3720, 38));
  onMessage({ type: "events", events: [
    { seq: 1, tick: 3000, kind: "research_finished", severity: "info", research: "bioflux-processing" },
    { seq: 2, tick: 3600, kind: "alert", severity: "critical", type: "entity_destroyed", surface: "gleba", entity: "stone-wall", position: { x: 21, y: 12 }, count: 1 },
  ] });
  await new Promise((r) => setTimeout(r, 10));

  const text = root.textContent ?? "";
  expect(text).toContain("stone wall: entity destroyed");
  expect(text).toContain("Research complete: bioflux processing");
  expect(text.indexOf("stone wall")).toBeLessThan(text.indexOf("Research complete")); // newest first
  expect(root.querySelector('.alert[data-sev="critical"]')).not.toBeNull();
  expect(text).toContain("carbon fiber");
  expect(text).toContain("62%");
  expect(root.querySelector(".rate-row .spark path.line")).not.toBeNull(); // sparkline drawn from 2 points
  expect(root.querySelector(".delta-down")?.textContent).toContain("0 · 15.6"); // stalled science flagged
});
