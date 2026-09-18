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
  // Words from this save, so the console can pick the transcript that matches them (FC-175), and phrases to bias
  // the recognizer toward where the browser supports that (FC-177).
  | { type: "vocabulary"; words: string[]; phrases?: string[]; name?: string }
  // One quiet line from the background pass (FC-193): never spoken, never acted on, at most one per look.
  | { type: "note"; text: string; at: number; sinceMs: number }
  | { type: "watching"; on: boolean };

export type ClientMessage =
  // `spoken` marks a question that came through speech recognition, which mis-hears words (FC-175).
  // `heard` is the diagnostic record of a spoken question (FC-185): what the engine offered, what was picked and
  // whether the phrases were accepted. Logged, never put in the prompt.
  | { type: "watch"; on: boolean }
  | { type: "ask"; text: string; thinking?: boolean; spoken?: boolean; heard?: { first: string; picked: string; alternatives: number; offered: string[]; phrases: number; where: string; carried: boolean } }
  | { type: "approve"; id: string }
  | { type: "decline"; id: string }
  | { type: "reset" }
  // The player is talking or typing a question: keep the model awake (FC-158).
  | { type: "wake" };
