import { expect, test } from "bun:test";
import type { GameEvent } from "@companion/interfaces";
import { droppedEvents, events, lists, onMessage, thread } from "./store";

const alert = (seq: number): GameEvent => ({ seq, tick: seq * 60, kind: "alert", severity: "warning", type: "entity_under_attack" });

test("FC-170: 'New conversation' clears the alert feed with the thread", () => {
  onMessage({ type: "events", events: [alert(1), alert(2)], dropped: 3 });
  onMessage({ type: "lists", lists: [{ name: "packing", kind: "packing", items: [], updatedAt: 1 }], active: "packing" });
  expect(events.value).toHaveLength(2);
  expect(droppedEvents.value).toBe(3);

  onMessage({ type: "reset" });
  expect(thread.value).toEqual([]);
  expect(events.value).toEqual([]);
  expect(droppedEvents.value).toBe(0);
  // Lists belong to the conversation too: the server clears them and tells the page (FC-163).
  onMessage({ type: "lists", lists: [] });
  expect(lists.value.lists).toEqual([]);

  // New alerts still arrive afterwards.
  onMessage({ type: "events", events: [alert(9)] });
  expect(events.value.map((e) => e.seq)).toEqual([9]);
});

test("events are de-duplicated by sequence number, so a replay doesn't double up", () => {
  onMessage({ type: "reset" });
  onMessage({ type: "events", events: [alert(1), alert(2)], replay: true });
  onMessage({ type: "events", events: [alert(2), alert(3)] });
  expect(events.value.map((e) => e.seq)).toEqual([1, 2, 3]);
});
