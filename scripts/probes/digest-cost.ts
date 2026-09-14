import { RconClient } from "../../server/src/rcon";
import { readRconSettings } from "../lib/factorio";
const rcon = await RconClient.connect({ ...(await readRconSettings())!, timeoutMs: 30_000 });
const sc = async (lua: string) => (await rcon.exec(`/sc ${lua}`)).trim();
// Worst single refresh step: time top_rates-equivalent for the biggest surface/category directly.
for (const cat of ["input", "output"]) console.log(await sc(`local f=game.forces.player local st=f.get_item_production_statistics(game.surfaces.nauvis) local p=helpers.create_profiler() local counts = "${cat}"=="input" and st.input_counts or st.output_counts local r={} for name in pairs(counts) do local v=st.get_flow_count{name=name,category="${cat}",precision_index=defines.flow_precision_index.one_minute} if v>0 then r[#r+1]={name=name,per_minute=v} end end table.sort(r,function(a,b) return a.per_minute>b.per_minute end) p.stop() rcon.print({"","refresh step nauvis ${cat}: ",p})`));
const times = [];
for (let i = 0; i < 6; i++) { const raw = await rcon.exec(`/companion ${JSON.stringify({ id: i, action: "digest", profile: true })}`); const [json, prof] = raw.split("\n"); times.push(prof?.replace("profile Duration: ", "")); if (i === 5) { const d = JSON.parse(json!); console.log(`digest ${json!.length} bytes; surfaces: ${d.data.surfaces.map((s: any) => `${s.name}(age ${s.age_ticks})`).join(", ")}; alerts: ${JSON.stringify(d.data.alerts)}`); await Bun.write("data/captures/digest.json", JSON.stringify(d.data, null, 2)); } }
console.log("digest Lua time:", times.join(" | "));
rcon.close();
