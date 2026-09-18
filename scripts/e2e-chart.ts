// FC-042 check through the real server: a trend question gets a rate_chart block naming an item and
// surface the page has recorded history for. Needs bun run start + the dev save hosted.
import { parseSpec } from "../displays/src/components";
import { openConsole } from "./lib/console";
import type { ServerMessage } from "../server/src/messages";

const { ws, got, until } = await openConsole({ ready: "game", reset: true });
const series = (await until((m) => m.type === "series", 5000)) as Extract<ServerMessage, { type: "series" }> | null;
const keys = new Set(Object.keys(series?.series ?? {}));

let failures = 0;
for (const question of ["How is my science doing? Show me a chart.", "Is my iron plate production on the factory floor holding steady?"]) {
  const from = got.length;
  ws.send(JSON.stringify({ type: "ask", text: question }));
  const done = await until((m) => m.type === "done" || m.type === "error", 120_000, from);
  const answer = got.slice(from).filter((m) => m.type === "token").map((m) => (m as { text: string }).text).join("");
  const blocks = [...answer.matchAll(/```rate_chart[ \t]*\n?([^`]*?)```/g)].map((m) => parseSpec(m[1]!));
  const valid = blocks.filter((b) => b && keys.has(`${b.surface}/${b.source}/${b.item}`));
  const ok = done?.type === "done" && blocks.length > 0 && valid.length === blocks.length;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${question}\n      charts: ${blocks.map((b) => (b ? `${b.item}@${b.surface}${keys.has(`${b.surface}/${b.source}/${b.item}`) ? "" : " (no history!)"}` : "unparseable")).join(", ") || "none"} [${done?.type === "done" ? `${(done.totalMs / 1000).toFixed(1)} s` : "error"}]\n      ${answer.replace(/```rate_chart[\s\S]*?```/g, "[chart]").trim().slice(0, 300)}`);
}
ws.close();
process.exit(failures ? 1 : 0);
