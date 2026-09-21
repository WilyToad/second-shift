// The second shift: a quiet look at the factory while the player plays (FC-193).
//
// The name has promised this since S01 and the runtime only just made it affordable — FC-192 measured that a
// concurrent request leaves the player's cached prefix intact (`cached 4096` throughout) and costs them about
// 0.15 s of first token. So this can run *while* they ask their own questions rather than waiting for a gap.
//
// What it does not do: act, interrupt, or speak. It writes one short note into the console's feed and nothing
// else, because an unasked suggestion is offered in words and never performed (the approval model). It is off
// until the player turns it on.
//
// The findings are computed in code — the same `diagnose()` rules the turn already uses, plus what changed since
// the last look. The model is asked exactly one thing: which single finding is worth a line, and how to say it.
// That is the only judgement here a rule can't make.
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Digest } from "@companion/interfaces";
import type { Decisions, Score } from "./decisions";
import { diagnose } from "./prompt";

export type Finding = { kind: string; line: string };
export type Note = { text: string; at: number; sinceMs: number };

/** How often to look, and how long the same finding stays quiet once it's been said. */
export const LOOK_EVERY_MS = 5 * 60 * 1000;
export const REPEAT_AFTER_MS = 30 * 60 * 1000;
/**
 * And a floor under how often it says *anything*, as a multiple of the look interval. Without this, a healthy
 * factory that dips and recovers can produce a new finding every look — technically never repeating itself, and
 * still chattering. Anything genuinely urgent is an alert from the mod, not a line from here.
 */
const QUIET_LOOKS = 2;
/** A production drop worth a line. Below this it's noise, and the player is busy. */
const DROP = 0.3;

/**
 * How much a finding matters, as one ordered question (FC-247) — used **only to order them**, never to decide
 * whether to speak.
 *
 * Measured on ten real findings from the player's own save (2026-09-20, PLAN §5): a five-level score spreads its
 * probability, so confidence tops out at 0.44 and the levels compress into 1.2–3.3 — the top of the scale is never
 * used. It rated "the whole base is browning out: power satisfaction 41%" 3.30 and "a turret is out of ammo" 1.80.
 * Any absolute cut on that silences an emergency, so the rules that decide whether to speak are the ones that were
 * there before. What it does get right is the extremes: its top two and bottom two matched a person's, so the
 * finding offered first is the one that most likely deserves the line.
 *
 * Every verdict is written down either way. A week of play is what would make a real threshold possible (FC-236).
 */
const LEVELS = [
  "noise: the player would rather not have been told",
  "minor: only if nothing else is going on",
  "worth one line next time it's quiet",
  "they would want to know now, even mid-task",
  "the factory is losing something badly and they should act",
];
const LOCAL_LEVEL = 3;
/** Where the server keeps them: every finding and its verdict, said or not — the first labels of real play (FC-236). */
export const LABELS = new URL("../../data/labels/watch.jsonl", import.meta.url).pathname;

export type Triaged = Finding & { level: number; via: "local" | "jev"; confidence: number };

/**
 * How much each finding matters, all of them in one call. Never throws: without a key every finding comes back at
 * the local level and the watcher behaves as it did before.
 */
export async function triage(found: Finding[], decisions?: Decisions): Promise<Triaged[]> {
  const out: Triaged[] = found.map((f) => ({ ...f, level: LOCAL_LEVEL, via: "local", confidence: 0 }));
  if (!found.length || !decisions) return out;
  const questions: Record<string, Score> = {};
  found.forEach((f, i) => {
    questions[`f${i}`] = {
      type: "score",
      instructions: `A Factorio companion looked at the player's factory while they were playing and noticed: "${f.line}". The player did not ask. How much does this matter to them right now?`,
      criteria: LEVELS,
      local: LOCAL_LEVEL,
      // Ordering only, so an unsure answer is still worth having: it sorts beside the local level, harming nothing.
      threshold: 0,
    };
  });
  const answers = await decisions.decide("The player is playing Factorio and has not asked anything. The companion looks at their factory every few minutes and may say at most one short line.", questions);
  out.forEach((t, i) => {
    const a = answers[`f${i}`];
    if (!a) return;
    t.level = a.value;
    t.via = a.via;
    t.confidence = a.confidence;
  });
  return out;
}

const rate = (digest: Digest, item: string) =>
  digest.surfaces.reduce((n, s) => n + (s.produced.find((p) => p.name === item)?.per_minute ?? 0), 0);

/**
 * What's worth noticing right now: the turn's own root-cause rules, plus anything that has fallen away since the
 * last look. Deliberately arithmetic — a rule gets this right every time, and a model gets it right most of the time.
 */
export function findings(now: Digest, before: Digest | null): Finding[] {
  const out: Finding[] = diagnose(now).map((line) => ({ kind: line.split(":")[0]!.trim(), line }));
  if (before) {
    const items = new Set(now.surfaces.flatMap((s) => s.produced.map((p) => p.name)));
    for (const item of items) {
      const then = rate(before, item);
      const nowRate = rate(now, item);
      if (then > 10 && nowRate < then * (1 - DROP)) {
        out.push({ kind: `drop:${item}`, line: `${item} is down from ${Math.round(then)} to ${Math.round(nowRate)} a minute since I last looked` });
      }
    }
  }
  return out;
}

export type WatchDeps = {
  digest: () => Digest | undefined;
  /** Typed decisions (FC-247). Absent, every finding is judged at the local level and the quiet floor rules. */
  decisions?: Decisions;
  /** Where the verdicts are written. Nothing is written unless a caller asks for it, so a unit test can't. */
  labels?: string;
  /** Asks the model for one short line. Returns null when it has nothing worth saying. */
  say: (findings: Finding[], sinceMs: number) => Promise<string | null>;
  emit: (note: Note) => void;
  now?: () => number;
};

/**
 * Looks every few minutes while it's on, and says at most one thing per look. Everything about it is "at most":
 * one finding, one line, and nothing at all when the factory is fine — which is most of the time, and is the
 * behaviour that makes it tolerable to leave on.
 */
export class Watcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastLookAt = 0;
  private lastNoteAt = 0;
  private quietMs = LOOK_EVERY_MS * QUIET_LOOKS;
  private before: Digest | null = null;
  private said = new Map<string, number>();
  private looking = false;
  private readonly now: () => number;

  constructor(private readonly deps: WatchDeps) {
    this.now = deps.now ?? Date.now;
  }

  get on(): boolean {
    return this.timer !== null;
  }

  start(every = LOOK_EVERY_MS): void {
    if (this.timer) return;
    this.quietMs = every * QUIET_LOOKS;
    this.lastLookAt = this.now();
    this.before = this.deps.digest() ?? null;
    this.timer = setInterval(() => void this.look(), every);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.before = null;
    this.said.clear();
    this.lastNoteAt = 0;
  }

  /** One look. Safe to call directly; that's what the tests do. */
  async look(): Promise<Note | null> {
    if (this.looking) return null; // a slow answer must never queue up a second look
    const digest = this.deps.digest();
    if (!digest) return null;
    this.looking = true;
    try {
      const sinceMs = this.now() - this.lastLookAt;
      const fresh = findings(digest, this.before).filter((f) => {
        const said = this.said.get(f.kind);
        return said === undefined || this.now() - said > REPEAT_AFTER_MS;
      });
      this.before = digest;
      this.lastLookAt = this.now();
      if (!fresh.length) return null;
      // How much each one matters, all in one call (FC-247), and the worst first — so the line the player gets is
      // the thing most likely to deserve it, rather than whatever the rules happened to list first. Whether to
      // speak at all is still the quiet floor's call: measured, the scores are not sound enough to overrule it.
      const judged = (await triage(fresh, this.deps.decisions)).sort((a, b) => b.level - a.level);
      const speaking = !this.lastNoteAt || this.now() - this.lastNoteAt >= this.quietMs;
      await this.label(judged, speaking);
      if (!speaking) return null;
      const text = await this.deps.say(judged, sinceMs);
      if (!text) return null;
      // Everything judged this look stays quiet for a while, said or not: they were all looked at.
      for (const f of judged) this.said.set(f.kind, this.now());
      this.lastNoteAt = this.now();
      const note = { text, at: this.now(), sinceMs };
      this.deps.emit(note);
      return note;
    } finally {
      this.looking = false;
    }
  }

  /** One line per finding per look, with what was decided about it. Never throws: a label is not worth a crash. */
  private async label(judged: Triaged[], spoken: boolean): Promise<void> {
    const path = this.deps.labels;
    if (!path || !judged.length) return;
    try {
      await mkdir(dirname(path), { recursive: true });
      const at = new Date(this.now()).toISOString();
      await appendFile(path, judged.map((t, i) => JSON.stringify({ at, kind: t.kind, line: t.line, level: t.level, via: t.via, confidence: t.confidence, spoken: spoken && i === 0 })).join("\n") + "\n");
    } catch {
      // A label file that can't be written changes nothing about the watch.
    }
  }
}

/** How long ago the last look was, in the words a person uses. */
export function howLongAgo(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "a minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "an hour ago" : `${hours} hours ago`;
}
