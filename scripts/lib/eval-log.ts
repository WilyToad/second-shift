// Test tooling: every eval/e2e run keeps its checks and full answers in data/eval/, so a model miss can be read
// afterwards instead of only its first line in the terminal (FC-113).
import { mkdirSync } from "node:fs";

export type EvalCheck = { name: string; ok: boolean; detail?: string };

export async function saveEvalRun(name: string, checks: EvalCheck[], answers: Record<string, string>): Promise<string> {
  const dir = new URL("../../data/eval/", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  const path = `${dir}${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await Bun.write(path, JSON.stringify({ name, at: new Date().toISOString(), passed: checks.filter((c) => c.ok).length, total: checks.length, checks, answers }, null, 2));
  return path;
}

export const asChecks = (results: [string, boolean, string][]): EvalCheck[] => results.map(([name, ok, detail]) => ({ name, ok, ...(detail ? { detail } : {}) }));
