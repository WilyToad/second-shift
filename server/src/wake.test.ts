import { describe, expect, test } from "bun:test";
import { ModelWaker } from "./wake";

describe("ModelWaker", () => {
  test("pings once per gap, not while a ping is in flight or a turn is running", async () => {
    let t = 0;
    let busy = false;
    let release!: () => void;
    let pings = 0;
    const waker = new ModelWaker(() => { pings++; return new Promise<void>((r) => { release = r; }); }, () => busy, () => t);
    expect(waker.wake()).toBe(true);
    t = 2_000;
    expect(waker.wake()).toBe(false); // still in flight
    release();
    await Bun.sleep(0);
    t = 2_500;
    expect(waker.wake()).toBe(true);
    release();
    await Bun.sleep(0);
    t = 2_900;
    expect(waker.wake()).toBe(false); // too soon
    busy = true;
    t = 5_000;
    expect(waker.wake()).toBe(false); // a turn keeps it awake
    expect(pings).toBe(2);
  });

  test("a failed ping doesn't block the next", async () => {
    let t = 0;
    const waker = new ModelWaker(() => Promise.reject(new Error("oMLX 503")), () => false, () => t);
    expect(waker.wake()).toBe(true);
    await Bun.sleep(0);
    t = 1_500;
    expect(waker.wake()).toBe(true);
  });
});
