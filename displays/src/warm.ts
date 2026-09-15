// FC-158: keeps the local model awake while the player is putting a question together. It idles ~3 s after a request
// and then adds 1.5–2.7 s to the next first token; the server turns each "wake" into a 1-token request.
import { signal } from "@preact/signals";

/** How often to ask while the player is talking or typing: under the ~2–3 s it takes the model to idle. */
export const WAKE_EVERY_MS = 1_200;
/** Typing counts as putting a question together for this long after the last keystroke. */
export const TYPING_WINDOW_MS = 10_000;

/** When the player last typed in the composer (0 once the question is sent). */
export const lastTypedAt = signal(0);

export function composing(state: { listening: boolean; heard: string; lastTypedAt: number }, now: number): boolean {
  return (state.listening && state.heard.trim() !== "") || (state.lastTypedAt > 0 && now - state.lastTypedAt < TYPING_WINDOW_MS);
}

/** Calls `wake` at most every WAKE_EVERY_MS while `active()` holds. Returns a stop function. */
export function keepWarm(active: (now: number) => boolean, wake: () => void, now: () => number = Date.now, every = WAKE_EVERY_MS): { tick(): boolean; stop(): void } {
  let last = -Infinity;
  const tick = () => {
    const t = now();
    if (!active(t) || t - last < every) return false;
    last = t;
    wake();
    return true;
  };
  const timer = globalThis.setInterval?.(tick, 300);
  return { tick, stop: () => globalThis.clearInterval?.(timer) };
}
