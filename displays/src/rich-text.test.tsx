import { expect, test } from "bun:test";
import { parseRichText, plainName } from "./rich-text";

test("rich text tags in names become badges; formatting keeps only its text", () => {
  expect(parseRichText("[virtual-signal=signal-1]Rocket One")).toEqual([{ kind: "icon", label: "1", title: "virtual-signal: signal-1" }, { kind: "text", text: "Rocket One" }]);
  expect(plainName("[virtual-signal=signal-1]Rocket One")).toBe("1 Rocket One");
  expect(plainName("[item=iron-plate] Iron [color=red]drop[/color]")).toBe("iron plate Iron drop");
  expect(plainName("[virtual-signal=signal-check]Hub")).toBe("check Hub");
  expect(plainName("nauvis factory floor")).toBe("nauvis factory floor");
});
