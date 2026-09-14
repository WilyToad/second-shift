// WebSocket messages between the server and the web page.
import type { Digest, GameEvent } from "@companion/interfaces";
import type { SeriesMap } from "./series";

export type ServerMessage =
  | { type: "status"; game: { connected: boolean; tick?: number; ageMs?: number; error?: string }; model: { state: "loading" | "ready" | "error"; error?: string } }
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
  | { type: "reset" };

export type ClientMessage =
  | { type: "ask"; text: string; thinking?: boolean }
  | { type: "approve"; id: string }
  | { type: "decline"; id: string }
  | { type: "reset" };
