import { expect, test } from "bun:test";
import { blueprintsIn, decodeBlueprintString, encodeBlueprintString, looksLikeBlueprintString } from "./blueprint";

const record = { blueprint: { item: "blueprint", label: "test", version: 562949958139904, entities: [{ entity_number: 1, name: "assembling-machine-2", position: { x: 1.5, y: 1.5 }, recipe: "iron-gear-wheel" }] } };

test("encode/decode round-trips and books are flattened", () => {
  const s = encodeBlueprintString(record);
  expect(looksLikeBlueprintString(s)).toBe(true);
  expect(decodeBlueprintString(s)).toEqual(record);
  const book = { blueprint_book: { item: "blueprint-book", label: "smelting", blueprints: [{ index: 0, ...record }, { index: 1, blueprint_book: { label: "inner", blueprints: [{ index: 0, ...record }] } }] } };
  const all = blueprintsIn(decodeBlueprintString(encodeBlueprintString(book)));
  expect(all.map((b) => b.path)).toEqual(["smelting", "smelting / inner"]);
});

test("rejects things that aren't blueprint strings", () => {
  expect(looksLikeBlueprintString("hello world, this is not a blueprint")).toBe(false);
  expect(() => decodeBlueprintString("0notbase64zlib!!")).toThrow("Not a valid blueprint string");
});

test("a real string from the dev save round-trips losslessly", async () => {
  const file = Bun.file(new URL("../../data/captures/blueprint-gleba.txt", import.meta.url));
  if (!(await file.exists())) return; // captures are local-only
  const original = decodeBlueprintString(await file.text());
  expect(decodeBlueprintString(encodeBlueprintString(original))).toEqual(original);
  expect(blueprintsIn(original)[0]!.blueprint.entities.length).toBe(49);
});
