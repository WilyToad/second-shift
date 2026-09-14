import { beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

beforeAll(() => {
  const window = new Window({ url: "http://127.0.0.1:5170/" });
  Object.assign(globalThis, { window, document: window.document, MutationObserver: window.MutationObserver, requestAnimationFrame: (f: () => void) => setTimeout(f, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
});

test("thread renders streaming answers, tool lines and approval cards from server messages", async () => {
  const { render } = await import("preact");
  const { Thread } = await import("./chat");
  const { onMessage, thread } = await import("./store");
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(<Thread />, root);

  onMessage({ type: "user", text: "Mark the rails to my right" });
  onMessage({ type: "tool", summary: "Found 8 rails within 32 tiles to the right (east)." });
  onMessage({ type: "token", text: "Confirm " });
  onMessage({ type: "token", text: "in the card." });
  onMessage({ type: "approval", id: "a1", title: "Mark 8 rails for deconstruction?", detail: "Highlighted in-game." });
  onMessage({ type: "done", totalMs: 1200, ttftMs: 800 });
  await new Promise((r) => setTimeout(r, 10));

  const text = root.textContent ?? "";
  expect(text).toContain("Mark the rails to my right");
  expect(text).toContain("Found 8 rails");
  expect(text).toContain("Confirm in the card.");
  expect(root.querySelectorAll(".approval button").length).toBe(2);
  // The tool line sits above the streamed answer.
  expect(text.indexOf("Found 8 rails")).toBeLessThan(text.indexOf("Confirm in the card."));

  onMessage({ type: "approval_result", id: "a1", status: "done", message: "Marked 8 entities." });
  await new Promise((r) => setTimeout(r, 10));
  expect(root.querySelector(".approval.done")?.textContent).toContain("Marked 8 entities.");
  expect(root.querySelectorAll(".approval button").length).toBe(0);
  expect(thread.value.length).toBe(4);
});

test("a built blueprint shows a layout sketch and copies its string", async () => {
  const { render } = await import("preact");
  const { Thread } = await import("./chat");
  const { onMessage } = await import("./store");
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(<Thread />, root);
  let clipboard = "";
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (t: string) => { clipboard = t; } }, configurable: true });
  Object.assign(globalThis, { navigator: window.navigator });

  onMessage({ type: "user", text: "Make me a blueprint for 90 gears per minute" });
  onMessage({ type: "blueprint", blueprint: {
    label: "iron-gear-wheel 90/min (1 assembling-machine-2)", string: "0eNqrVkrKLCjJzM9TsqpWKs7PS8nMS1eyMjA0MDEyMzQwMzQyNjM2MzUyMDEwMzQ2NjAwMDKsBQCnvhFt",
    summary: "1 assembling-machine-2 · 180/min iron-plate in", width: 3, height: 7,
    sketch: [
      { name: "transport-belt", kind: "transport-belt", x: 0, y: 0, w: 1, h: 1, direction: 4 },
      { name: "inserter", kind: "inserter", x: 1, y: 1, w: 1, h: 1, direction: 0 },
      { name: "assembling-machine-2", kind: "assembling-machine", x: 0, y: 2, w: 3, h: 3 },
      { name: "medium-electric-pole", kind: "electric-pole", x: 0, y: 1, w: 1, h: 1 },
    ],
  } });
  onMessage({ type: "token", text: "One assembler makes 90/min." });
  onMessage({ type: "done", totalMs: 900, ttftMs: 400 });
  await new Promise((r) => setTimeout(r, 10));

  const card = root.querySelector(".blueprint")!;
  expect(card.querySelectorAll("rect").length).toBe(4);
  expect(card.querySelectorAll("line").length).toBe(2); // direction ticks on the belt and inserter
  expect(card.textContent).toContain("1 assembling-machine-2 · 180/min iron-plate in");
  (card.querySelector("button") as unknown as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 10));
  expect(clipboard).toStartWith("0eNq");
  expect(card.querySelector("button")!.textContent).toBe("Copied");
});

test("a big pasted blueprint's sketch shrinks its tiles to stay panel-sized", async () => {
  const { render } = await import("preact");
  const { BlueprintView } = await import("./components");
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(<BlueprintView card={{ label: "rail loop", string: "0eNq", summary: "2 entities · pasted", width: 400, height: 20, sketch: [
    { name: "straight-rail", kind: "straight-rail", x: 0, y: 0, w: 2, h: 2 },
    { name: "straight-rail", kind: "straight-rail", x: 398, y: 18, w: 2, h: 2 },
  ] }} />, root);
  await new Promise((r) => setTimeout(r, 10));
  // 760 / 400 tiles → 2 px per tile (the minimum), plus 6 px padding each side.
  expect(root.querySelector("svg")!.getAttribute("width")).toBe(String(400 * 2 + 12));
});

test("a page that connects later shows the conversation so far", async () => {
  const { render } = await import("preact");
  const { Thread } = await import("./chat");
  const { onMessage } = await import("./store");
  onMessage({ type: "reset" });
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(<Thread />, root);
  onMessage({ type: "transcript", items: [{ kind: "user", text: "What's the recipe for carbon fiber?" }, { kind: "agent", text: "Carbon and yumako mash." }] });
  await new Promise((r) => setTimeout(r, 10));
  expect(root.querySelector(".msg.user")?.textContent).toBe("What's the recipe for carbon fiber?");
  expect(root.textContent).toContain("Carbon and yumako mash.");
  // A second replay (another page connecting) doesn't duplicate the thread.
  onMessage({ type: "transcript", items: [{ kind: "user", text: "What's the recipe for carbon fiber?" }, { kind: "agent", text: "Carbon and yumako mash." }] });
  await new Promise((r) => setTimeout(r, 10));
  expect(root.querySelectorAll(".msg.user").length).toBe(1);
});

test("a screenshot shows as an image with its caption", async () => {
  const { render } = await import("preact");
  const { Thread } = await import("./chat");
  const { onMessage } = await import("./store");
  onMessage({ type: "reset" });
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(<Thread />, root);
  onMessage({ type: "user", text: "Show me my spot" });
  onMessage({ type: "image", url: "/shots/shot-5-1.jpg", caption: "Your spot: 64 tiles across around (9, 0) on gleba" });
  onMessage({ type: "done", totalMs: 900 });
  await new Promise((r) => setTimeout(r, 10));
  const img = root.querySelector(".shot img")!;
  expect(img.getAttribute("src")).toBe("/shots/shot-5-1.jpg");
  expect(img.getAttribute("alt")).toBe("Your spot: 64 tiles across around (9, 0) on gleba");
});

