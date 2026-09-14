// Probe: the player's live anchors and what belt-like entities are around each (FC-092 follow-up).
import { encodeCommand, parseReply } from "../../interfaces/src/index";
import { connectDevGame } from "../lib/devgame";
const dev = await connectDevGame();
const call = async (action: string, args: Record<string, unknown> = {}) => parseReply(await dev.rcon.exec(encodeCommand({ id: Date.now(), action, args }))).reply.data as any;
const d = await call("digest");
console.log("player:", JSON.stringify(d.player));
for (const from of ["character", "view"]) {
  const r = await call("find_entities", { types: ["transport-belt", "underground-belt", "splitter"], radius: 32, from });
  console.log(from, "center", JSON.stringify(r.center), "belt-type entities:", JSON.stringify(r.by_name), "not visible", r.not_visible);
}
dev.rcon.close();
