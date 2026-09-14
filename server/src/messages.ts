// WebSocket messages between the server and the web page.
import type { Digest, GameEvent } from "@companion/interfaces";
import type { Plan } from "./planner";
import type { SeriesMap } from "./series";

/** A blueprint built in code, for the page: copyable string plus a top-down sketch in tiles. */
export type BlueprintCard = {
  label: string;
  string: string;
  summary: string;
  width: number;
  height: number;
  sketch: { name: string; kind: string; x: number; y: number; w: number; h: number; direction?: number }[];
};

export type ServerMessage =
  | { type: "status"; game: { connected: boolean; tick?: number; ageMs?: number; paused?: boolean; error?: string }; model: { state: "loading" | "ready" | "error"; error?: string } }
  | { type: "user"; text: string }
  | { type: "token"; text: string }
  | { type: "tool"; summary: string }
  | { type: "done"; ttftMs?: number; totalMs: number; promptTokens?: number; cachedTokens?: number; completionTokens?: number }
  | { type: "approval"; id: string; title: string; detail: string }
  | { type: "approval_result"; id: string; status: "done" | "declined" | "failed" | "expired"; message: string }
  | { type: "error"; message: string }
  | { type: "events"; events: GameEvent[]; dropped?: number }
  | { type: "digest"; digest: Digest; receivedAt: number }
  | { type: "series"; series: SeriesMap }
  | { type: "plan"; plan: Plan }
  | { type: "blueprint"; blueprint: BlueprintCard }
  | { type: "transcript"; items: { kind: "user" | "agent"; text: string }[] }
  | { type: "reset" };

export type ClientMessage =
  | { type: "ask"; text: string; thinking?: boolean }
  | { type: "approve"; id: string }
  | { type: "decline"; id: string }
  | { type: "reset" };
