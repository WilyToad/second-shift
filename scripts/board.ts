// Prints sprint progress from work/. `--check` validates the files and exits non-zero on problems.
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export type ItemStatus = "todo" | "doing" | "done" | "blocked" | "dropped";
export type Item = { id: string; title: string; status: ItemStatus; line: number };
export type Sprint = { file: string; code: string; title: string; status: string; goal: string; items: Item[] };

const MARKERS: Record<string, ItemStatus> = { " ": "todo", "~": "doing", x: "done", "!": "blocked", "-": "dropped" };
const ITEM = /^- \[(.)\] (FC-\d{3}) (.+)$/;

export function parseItems(text: string): { items: Item[]; errors: string[] } {
  const items: Item[] = [];
  const errors: string[] = [];
  text.split("\n").forEach((raw, i) => {
    if (!raw.startsWith("- [")) return;
    const m = raw.match(ITEM);
    const status = m ? MARKERS[m[1]!] : undefined;
    if (!m || !status) { errors.push(`line ${i + 1}: can't parse item "${raw}"`); return; }
    items.push({ id: m[2]!, title: m[3]!, status, line: i + 1 });
  });
  return { items, errors };
}

export function parseSprint(file: string, text: string): { sprint: Sprint; errors: string[] } {
  const { items, errors } = parseItems(text);
  const heading = text.match(/^# (S\d{2}) — (.+)$/m);
  const field = (name: string) => text.match(new RegExp(`^- \\*\\*${name}:\\*\\* (.+)$`, "m"))?.[1]?.trim() ?? "";
  if (!heading) errors.push(`missing "# Snn — Title" heading`);
  const status = field("Status");
  if (!["planned", "active", "done"].includes(status)) errors.push(`status must be planned, active or done (got "${status}")`);
  return { sprint: { file, code: heading?.[1] ?? "S??", title: heading?.[2] ?? file, status, goal: field("Goal"), items }, errors };
}

const bar = (done: number, total: number, width = 20) => {
  const filled = total ? Math.round((done / total) * width) : 0;
  return "█".repeat(filled) + "░".repeat(width - filled);
};

if (import.meta.main) {
  const workDir = resolve(import.meta.dir, "../work");
  const check = Bun.argv.includes("--check");
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const track = (items: Item[], where: string) => {
    for (const it of items) {
      if (seen.has(it.id)) problems.push(`${it.id} appears in both ${seen.get(it.id)} and ${where}`);
      seen.set(it.id, where);
    }
  };

  const sprints: Sprint[] = [];
  for (const file of readdirSync(join(workDir, "sprints")).filter((f) => f.endsWith(".md")).sort()) {
    const { sprint, errors } = parseSprint(file, await Bun.file(join(workDir, "sprints", file)).text());
    problems.push(...errors.map((e) => `sprints/${file}: ${e}`));
    track(sprint.items, `sprints/${file}`);
    sprints.push(sprint);
  }
  const backlog = parseItems(await Bun.file(join(workDir, "BACKLOG.md")).text());
  problems.push(...backlog.errors.map((e) => `BACKLOG.md: ${e}`));
  track(backlog.items, "BACKLOG.md");
  const active = sprints.filter((s) => s.status === "active");
  if (active.length > 1) problems.push(`more than one active sprint: ${active.map((s) => s.code).join(", ")}`);

  if (check) {
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log(`work/ OK: ${sprints.length} sprints, ${seen.size} items`);
    process.exit(0);
  }

  const current = active[0] ?? sprints.find((s) => s.status === "planned");
  if (current) {
    const live = current.items.filter((i) => i.status !== "dropped");
    const done = live.filter((i) => i.status === "done").length;
    console.log(`${current.code} ${current.title} (${current.status})`);
    console.log(`  ${bar(done, live.length)} ${done}/${live.length}`);
    console.log(`  goal: ${current.goal}`);
    const list = (label: string, status: ItemStatus) => {
      const xs = current.items.filter((i) => i.status === status);
      if (xs.length) console.log(`  ${label}: ${xs.map((i) => `${i.id} ${i.title}`).join("\n  " + " ".repeat(label.length + 2))}`);
    };
    list("in progress", "doing");
    list("blocked", "blocked");
    const next = current.items.find((i) => i.status === "todo");
    if (next) console.log(`  next up: ${next.id} ${next.title}`);
  } else {
    console.log("No active or planned sprint.");
  }

  const finished = sprints.filter((s) => s.status === "done");
  if (finished.length) console.log(`\nDone: ${finished.map((s) => `${s.code} ${s.title} (${s.items.filter((i) => i.status === "done").length} items)`).join(", ")}`);
  const open = backlog.items.filter((i) => i.status !== "done" && i.status !== "dropped").length;
  const maxId = Math.max(...[...seen.keys()].map((id) => Number(id.slice(3))));
  console.log(`Backlog: ${open} open items · next free ID: FC-${String(maxId + 1).padStart(3, "0")}`);
  if (problems.length) console.log(`\n⚠ ${problems.length} problem(s); run with --check`);
}
