import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneShots, SHOT_NAME, waitForShot } from "./screenshots";

test("waits until the game has finished writing, then returns the file name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fc-shots-"));
  mkdirSync(join(dir, "companion"));
  const file = join(dir, "companion", "shot-10-1.jpg");
  setTimeout(() => writeFileSync(file, "part"), 50);
  setTimeout(() => writeFileSync(file, "partial and then the rest"), 70);
  expect(await waitForShot(dir, "companion/shot-10-1.jpg", 2000)).toBe("shot-10-1.jpg");
  await expect(waitForShot(dir, "companion/shot-11-2.jpg", 200)).rejects.toThrow("didn't write the screenshot");
});

test("keeps only the newest screenshots and ignores other files", () => {
  const dir = mkdtempSync(join(tmpdir(), "fc-shots-"));
  for (let i = 0; i < 25; i++) {
    writeFileSync(join(dir, `shot-${i}-${i}.jpg`), "x");
    utimesSync(join(dir, `shot-${i}-${i}.jpg`), i + 1000, i + 1000);
  }
  writeFileSync(join(dir, "probe-1024.png"), "x");
  expect(pruneShots(dir, 20)).toBe(5);
  const left = readdirSync(dir);
  expect(left.filter((n) => SHOT_NAME.test(n))).toHaveLength(20);
  expect(left).toContain("probe-1024.png");
  expect(left).not.toContain("shot-0-0.jpg");
  expect(SHOT_NAME.test("../../secret.jpg")).toBe(false);
});
