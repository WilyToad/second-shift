import { expect, test } from "bun:test";
import { parseItems, parseSprint } from "./board";

test("parses items with each status marker and reports bad lines", () => {
  const { items, errors } = parseItems([
    "- [ ] FC-001 Todo", "  - Acceptance: nested lines are ignored", "- [~] FC-002 Doing",
    "- [x] FC-003 Done", "- [!] FC-004 Blocked", "- [-] FC-005 Dropped", "- [?] FC-006 Bad",
  ].join("\n"));
  expect(items.map((i) => i.status)).toEqual(["todo", "doing", "done", "blocked", "dropped"]);
  expect(errors).toHaveLength(1);
});

test("parses sprint header fields", () => {
  const { sprint, errors } = parseSprint("S09-x.md", "# S09 — Example\n\n- **Status:** active\n- **Goal:** Ship it\n\n## Items\n\n- [x] FC-100 Thing\n");
  expect(errors).toEqual([]);
  expect(sprint).toMatchObject({ code: "S09", title: "Example", status: "active", goal: "Ship it" });
  expect(sprint.items[0]!.id).toBe("FC-100");
});

test("rejects an unknown sprint status", () => {
  expect(parseSprint("S01.md", "# S01 — X\n- **Status:** someday\n").errors[0]).toContain("status must be");
});
