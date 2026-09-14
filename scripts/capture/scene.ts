// One console clip (server running, dev save hosted): bun scripts/capture/scene.ts <name> "<question>" [--confirm] [--select] [--timelapse secs]
// --confirm approves the card and records an in-game timelapse of (55, 40) meanwhile; --select reviews a selection made by test tooling.
import { session } from "./console";
import { connectDevGame } from "../lib/devgame";
import { encodeCommand, parseReply } from "../../interfaces/src/index";
const [name, question = "", ...flags] = Bun.argv.slice(2);
const has = (f: string) => flags.includes(f);
const s = await session(name!);
await s.open();
await s.click(`[...document.querySelectorAll("button")].find((b) => b.textContent === "New conversation")`);
await Bun.sleep(1200);
await s.start();
await Bun.sleep(900);
const dev = await connectDevGame();
let timelapse: ReturnType<typeof Bun.spawn> | undefined;
if (has("--select")) {
  const r = parseReply(await dev.rcon.exec(encodeCommand({ id: Date.now(), action: "debug_select_area", args: { radius: 10 } }))).reply;
  console.log("selected", JSON.stringify(r.data));
} else {
  await s.type("#composer textarea", question);
  await Bun.sleep(500);
  await s.enter();
}
const answered = await s.waitFor(`!!document.querySelector("#thread .meta")`, 90000);
if (has("--confirm")) {
  const card = await s.waitFor(`!!document.querySelector(".approval:not(.done) button")`, 5000);
  await Bun.sleep(1800);
  const secs = flags[flags.indexOf("--timelapse") + 1] ?? "60";
  timelapse = Bun.spawn(["bun", `${import.meta.dir}/timelapse.ts`, name!, secs, "55", "40", "1.4", "4"], { stdout: "inherit" });
  await Bun.sleep(1500);
  if (card) await s.click(`[...document.querySelectorAll(".approval button")].find((b) => b.textContent === "Confirm")`);
  await s.waitFor(`!!document.querySelector(".approval.done, .approval.failed")`, 20000);
  console.log("approval", await s.evaluate(`document.querySelector(".approval")?.className + " " + document.querySelector(".approval-result")?.textContent`));
}
await Bun.sleep(3000);
await s.stop();
await s.still(`${s.dir}/end.png`);
console.log(name, "answered", answered, s.frames.length, "frames");
await s.close();
dev.rcon.close();
if (timelapse) await timelapse.exited;
