// Capture tooling (FC-121): drives the console in a headless Chromium with its own temporary profile and records
// timestamped screencast frames, so clips don't depend on the real screen (or show anything else on it).
// Needs a Chromium headless shell: CHROME=/path/to/chrome-headless-shell, or Playwright's under ~/Library/Caches/ms-playwright.
import { mkdirSync, rmSync } from "node:fs";
import { spawn } from "bun";

const SHELL = process.env.CHROME ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
export const OUT = new URL("../../data/captures/media", import.meta.url).pathname;

export async function session(name: string, opts: { width?: number; height?: number; scale?: number } = {}) {
  const { width = 1440, height = 900, scale = 2 } = opts;
  const dir = `${OUT}/${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = `${OUT}/.profile-${port}`;
  const proc = spawn([SHELL, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", `--window-size=${width},${height}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 100 && !target; i++) {
    await Bun.sleep(100);
    target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l: any[]) => l.find((t) => t.type === "page")).catch(() => undefined);
  }
  if (!target) throw new Error("headless shell didn't start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const frames: { file: string; t: number }[] = [];
  let recording = false;
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  ws.onmessage = async (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m.result ?? m.error); pending.delete(m.id); return; }
    if (m.method === "Page.screencastFrame") {
      send("Page.screencastFrameAck", { sessionId: m.params.sessionId });
      if (!recording) return;
      const file = `${dir}/f${String(frames.length).padStart(5, "0")}.jpg`;
      frames.push({ file, t: m.params.metadata.timestamp });
      await Bun.write(file, Buffer.from(m.params.data, "base64"));
    }
  };
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }))?.result?.value;
  const s = {
    dir, frames, send, evaluate,
    async open(url = "http://127.0.0.1:5170/") { await send("Page.navigate", { url }); await s.waitFor("document.fonts.status === 'loaded' && !!document.querySelector('.topbar')", 15000); await Bun.sleep(1500); },
    async start() { recording = true; await send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 }); await Bun.sleep(300); },
    async stop() { await Bun.sleep(300); recording = false; await send("Page.stopScreencast"); },
    async waitFor(expression: string, ms: number) { const end = performance.now() + ms; while (performance.now() < end) { if (await evaluate(expression)) return true; await Bun.sleep(100); } return false; },
    async type(selector: string, text: string, cps = 28) {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      for (const ch of text) { await send("Input.insertText", { text: ch }); await Bun.sleep(1000 / cps * (ch === " " ? 1.4 : 1)); }
    },
    async enter() { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined }); },
    async click(expression: string) { await evaluate(`(${expression}).click()`); },
    async still(file: string) { const r = await send("Page.captureScreenshot", { format: "png" }); await Bun.write(file, Buffer.from(r.data, "base64")); },
    async close() { ws.close(); proc.kill(); await Bun.sleep(300); rmSync(profile, { recursive: true, force: true }); await Bun.write(`${dir}/frames.json`, JSON.stringify(frames)); },
  };
  return s;
}
