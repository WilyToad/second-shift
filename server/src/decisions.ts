// Typed decisions (FC-244): the judgement calls this app makes — is this question about the world, is this finding
// worth saying, which prototype did the player mean — asked of TypeSafe's Jev when a key is present, and answered by
// the same code as before when it isn't.
//
// The player's rule (2026-09-20): "If a Jev key is available, we use Jev. If not, then we fall back to our current
// methods." So every question carries its local answer with it. Jev's answer replaces it only when the call comes
// back inside its budget and the answer is confident enough; there is no path where a missing key, a timeout, an
// error or an unsure answer costs anything but the code that ran before.
//
// Measured 2026-09-20 on the real endpoint: one question 203 ms, twenty in one call 156 ms (their "adding questions
// barely changes the response time" holds), against 3,757 ms for the same twenty sequentially. 706 input tokens for
// the twenty against 6,480, at $0.042 a million. So: batch everything a phase needs into one call, never loop.
//
// Never on the helmet rule, approvals, cards or the stop hotkey (PLAN §8): a probability is not a permission.
import { z } from "zod";

const API = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
/** Their docs: up to 255 options on a choice, 2–10 levels on a score. */
export const MAX_OPTIONS = 255;
const DEFAULT_BUDGET_MS = 1_200;
/** How sure Jev must be to override the local answer. Their guidance is 0.5 to act; this starts stricter (FC-247's
 *  week of logged findings is what sets the real numbers). */
const DEFAULT_THRESHOLD = 0.6;
/** Consecutive failures before the service stops trying, and how long it then waits (offline is normal here). */
const FAILURES_BEFORE_REST = 3;
const REST_MS = 60_000;

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A yes/no question. `local` is what the code decided before Jev was asked. */
export type Noul = { type: "noul"; instructions: string; local: boolean; threshold?: number };
/** One of a named set. `criteria` maps each option to what it means; `local` is the code's pick. */
export type Choice<K extends string = string> = { type: "choice"; instructions: string; criteria: Record<K, string>; local: K; threshold?: number };
/** A position on an ordered rubric, 2–10 levels. `local` is the code's level, 1-based. */
export type Score = { type: "score"; instructions: string; criteria: string[]; local: number; threshold?: number };
export type Question = Noul | Choice | Score;
export type Questions = Record<string, Question>;

type Value<Q> = Q extends Noul ? boolean : Q extends Choice<infer K> ? K : Q extends Score ? number : never;
export type Answer<T> = {
  value: T;
  /** Which path decided this one. */
  via: "jev" | "local";
  /** 0–1. For a noul, how far from a coin toss; for the others, Jev's own confidence. 0 when nothing was asked. */
  confidence: number;
  /** Jev's raw answer, when it answered: P(true), the probabilities, or the weighted level. */
  raw?: number | Record<string, number>;
};
export type Answers<Q extends Questions> = { [K in keyof Q]: Answer<Value<Q[K]>> };

/** What the endpoint sends back. Anything that doesn't parse is treated as a failed call, not a wrong answer. */
const ReplySchema = z.object({
  answers: z.record(
    z.string(),
    z.union([
      z.object({ type: z.literal("noul"), noul: z.number() }),
      z.object({ type: z.literal("choice"), choice: z.string(), probabilities: z.record(z.string(), z.number()).optional(), confidence: z.number().optional() }),
      z.object({ type: z.literal("score"), score: z.number(), probabilities: z.record(z.string(), z.number()).optional(), confidence: z.number().optional() }),
    ]),
  ),
  usage: z.object({ input_tokens: z.number().optional() }).optional(),
});

/** The key, from the gitignored `.env` Bun loads. Never logged, never sent anywhere but the endpoint. */
export function jevKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.JEV_KEY?.trim();
  return key ? key : null;
}

/**
 * `COMPANION_DECISIONS=local` pins everything to the code paths — what the eval scripts use for a baseline, and what
 * a comparison run needs so the answer doesn't depend on a paid service being up.
 */
export type Mode = "auto" | "local";
export function decisionsMode(env: Record<string, string | undefined> = process.env): Mode {
  return env.COMPANION_DECISIONS?.trim().toLowerCase() === "local" ? "local" : "auto";
}

/** Everything local, with no call: the shape a caller gets when there's no key. */
function allLocal<Q extends Questions>(questions: Q): Answers<Q> {
  const out = {} as Answers<Q>;
  for (const [name, q] of Object.entries(questions)) {
    (out as Record<string, Answer<unknown>>)[name] = { value: q.local, via: "local", confidence: 0 };
  }
  return out;
}

export class Decisions {
  private failures = 0;
  private restingUntil = 0;
  private said = false;
  /** Questions answered by each path since the server started, for the log line and the turn record. */
  readonly counts = { jev: 0, local: 0, calls: 0, errors: 0, inputTokens: 0 };

  constructor(
    private readonly opts: {
      key?: string | null;
      mode?: Mode;
      fetch?: Fetch;
      log?: (line: string) => void;
      now?: () => number;
    } = {},
  ) {}

  private get key(): string | null {
    return this.opts.key === undefined ? jevKey() : this.opts.key;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  /** Is Jev going to be asked at all? False with no key, pinned local, or while resting after failures. */
  available(): boolean {
    return Boolean(this.key) && (this.opts.mode ?? decisionsMode()) !== "local" && this.now() >= this.restingUntil;
  }

  /** One line for the server log at startup, so which way it's running is never a guess. */
  describe(): string {
    if (!this.key) return "Decisions: local (no JEV_KEY in .env).";
    if ((this.opts.mode ?? decisionsMode()) === "local") return "Decisions: local (COMPANION_DECISIONS=local).";
    return "Decisions: Jev, with the local paths as the fallback.";
  }

  /**
   * Answers every question in one call, or hands back the local answers. Never throws: a caller can always use what
   * comes back. `budgetMs` is the whole call including connecting, because "offline" is a normal state on a laptop.
   */
  async decide<Q extends Questions>(state: string, questions: Q, { budgetMs = DEFAULT_BUDGET_MS }: { budgetMs?: number } = {}): Promise<Answers<Q>> {
    const names = Object.keys(questions);
    const out = allLocal(questions);
    if (!names.length || !this.available()) {
      this.counts.local += names.length;
      return out;
    }
    const body = {
      model: MODEL,
      state,
      questions: Object.fromEntries(
        Object.entries(questions).map(([name, q]) => [
          name,
          q.type === "noul"
            ? { type: "noul", instructions: q.instructions }
            : q.type === "choice"
              ? { type: "choice", instructions: q.instructions, criteria: q.criteria }
              : { type: "score", instructions: q.instructions, criteria: q.criteria },
        ]),
      ),
    };
    const fetcher = this.opts.fetch ?? fetch;
    const started = performance.now();
    let reply: z.infer<typeof ReplySchema> | null = null;
    this.counts.calls++;
    try {
      const res = await fetcher(API, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(budgetMs),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      reply = ReplySchema.parse(await res.json());
      this.failures = 0;
      this.said = false;
    } catch (e) {
      this.counts.errors++;
      this.counts.local += names.length;
      this.failures++;
      if (this.failures >= FAILURES_BEFORE_REST) {
        this.restingUntil = this.now() + REST_MS;
        this.failures = 0;
        if (!this.said) {
          this.said = true;
          this.opts.log?.(`Decisions: Jev didn't answer (${(e as Error).message}); using the local paths for the next ${REST_MS / 1000} s.`);
        }
      }
      return out;
    }
    this.counts.inputTokens += reply.usage?.input_tokens ?? 0;
    const asked = names.length;
    for (const [name, q] of Object.entries(questions)) {
      const answer = reply.answers[name];
      const threshold = q.threshold ?? DEFAULT_THRESHOLD;
      const slot = (out as Record<string, Answer<unknown>>)[name]!;
      if (!answer || answer.type !== q.type) {
        this.counts.local++;
        continue;
      }
      if (answer.type === "noul") {
        // A noul carries no confidence of its own: how far it is from a coin toss is the confidence.
        const confidence = Math.abs(answer.noul - 0.5) * 2;
        if (confidence >= threshold) Object.assign(slot, { value: answer.noul >= 0.5, via: "jev", confidence, raw: answer.noul });
        else Object.assign(slot, { confidence, raw: answer.noul });
      } else if (answer.type === "choice" && q.type === "choice") {
        const confidence = answer.confidence ?? 0;
        // An option Jev invented is not an option: the criteria are ours.
        if (confidence >= threshold && answer.choice in q.criteria) Object.assign(slot, { value: answer.choice, via: "jev", confidence, raw: answer.probabilities });
        else Object.assign(slot, { confidence, raw: answer.probabilities });
      } else if (answer.type === "score" && q.type === "score") {
        const confidence = answer.confidence ?? 0;
        if (confidence >= threshold) Object.assign(slot, { value: answer.score, via: "jev", confidence, raw: answer.probabilities });
        else Object.assign(slot, { confidence, raw: answer.probabilities });
      }
      this.counts[slot.via]++;
    }
    const byJev = Object.values(out as Record<string, Answer<unknown>>).filter((a) => a.via === "jev").length;
    this.opts.log?.(`Decisions: ${asked} question${asked === 1 ? "" : "s"} in ${(performance.now() - started).toFixed(0)} ms — ${byJev} by Jev, ${asked - byJev} left to the code.`);
    return out;
  }
}

/** How many of a batch Jev actually decided, for a log line or a turn record. */
export function viaCounts(answers: Record<string, Answer<unknown>>): { jev: number; local: number } {
  const values = Object.values(answers);
  const jev = values.filter((a) => a.via === "jev").length;
  return { jev, local: values.length - jev };
}
