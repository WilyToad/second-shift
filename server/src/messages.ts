// WebSocket messages between the server and the web page.
import type { Digest, GameEvent } from "@companion/interfaces";
import type { Checklist } from "./lists";
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
  | { type: "events"; events: GameEvent[]; dropped?: number; replay?: boolean }
  | { type: "digest"; digest: Digest; receivedAt: number }
  | { type: "series"; series: SeriesMap }
  | { type: "plan"; plan: Plan }
  | { type: "blueprint"; blueprint: BlueprintCard }
  | { type: "image"; url: string; caption: string }
  | { type: "transcript"; items: { kind: "user" | "agent"; text: string }[] }
  | { type: "reset" }
  // The player pressed the push-to-talk key in the game (FC-147).
  | { type: "talk" }
  // The lists the companion keeps for the player (FC-163); the player can't edit them, so this is display only.
  | { type: "lists"; lists: Checklist[]; active?: string }
  // Phrases to bias the recognizer toward where the browser supports that (FC-177), and the companion's name.
  // (The word list for rescoring alternatives went with FC-210: it never changed an answer for the better.)
  | { type: "vocabulary"; phrases: string[]; name?: string }
  // One quiet line from the background pass (FC-193): never spoken, never acted on, at most one per look.
  | { type: "note"; text: string; at: number; sinceMs: number }
  | { type: "watching"; on: boolean };

// What the console may send, validated on arrival (FC-200): the schema lives in `interfaces/` beside the game's.
export type { ClientMessage } from "@companion/interfaces";
