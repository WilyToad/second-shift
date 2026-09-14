// Prompt assembly. Order is fixed so the model's prefix cache survives between turns:
//   1. system rules (never changes)
//   2. conversation history, stored exactly as sent (append-only)
//   3. the new question with the latest game snapshot, always last
import type { Digest } from "@companion/interfaces";
import type { ChatMessage } from "./model";

export const SYSTEM_RULES = `You are Factorio Companion, an assistant riding along in the player's helmet in a live, heavily modded Factorio 2.0 game (Space Age plus mods such as maraxsis, Cerys, factorissimo-2).

Rules:
- Ground every claim in the game state given with the question. If the state doesn't contain what's needed, say what's missing instead of guessing.
- Your memory of Factorio recipes is vanilla and may be wrong for this save. Don't state recipe details unless they appear in the provided data.
- You can't take actions in the game yet. Describe what the player could do.
- Be brief and concrete: numbers with units (per minute), surface names, item names.`;

const round = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
const rates = (list: { name: string; per_minute: number }[]) =>
  list.length ? list.map((r) => `${r.name} ${round(r.per_minute)}`).join(", ") : "none";

/** Compact text form of a digest; kept small because it's the uncached tail of every prompt. */
export function formatSnapshot(digest: Digest, ageMs: number): string {
  const lines = [`[game state at tick ${digest.tick}, ${Math.round(ageMs / 1000)} s old]`];
  if (digest.player) lines.push(`player: ${digest.player.name} on ${digest.player.surface} at (${digest.player.position.x}, ${digest.player.position.y})`);
  const r = digest.research;
  lines.push(`research: ${r.current ? `${r.current} ${Math.round(r.progress * 100)}%` : "nothing researching"}${r.queue.length > 1 ? `; queued: ${r.queue.slice(1).join(", ")}` : ""}`);
  for (const s of digest.surfaces) {
    const label = s.platform ? `${s.name} (platform ${s.platform})` : s.name;
    lines.push(`${label} produced/min: ${rates(s.produced)}`);
    lines.push(`${label} consumed/min: ${rates(s.consumed)}`);
  }
  lines.push(`urgent alerts: ${digest.alerts.length ? digest.alerts.map((a) => `${a.type} x${a.count} on ${a.surface ?? "?"}`).join(", ") : "none"}`);
  return lines.join("\n");
}

export function userTurn(question: string, snapshot: string | null): ChatMessage {
  return { role: "user", content: snapshot ? `${question}\n\n${snapshot}` : `${question}\n\n[game state unavailable: the game isn't connected]` };
}

export function buildMessages(history: ChatMessage[], nextUser: ChatMessage): ChatMessage[] {
  return [{ role: "system", content: SYSTEM_RULES }, ...history, nextUser];
}
