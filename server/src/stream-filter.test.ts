import { expect, test } from "bun:test";
import { ChartBlockFilter, stripChartBlocks } from "./stream-filter";

const streamed = (tokens: string[]) => {
  const f = new ChartBlockFilter();
  return tokens.map((t) => f.push(t)).join("") + f.end();
};

test("a chart block split across tokens never reaches the output", () => {
  const answer = "Makes 300/min.\n\n```rate_chart\nitem=electronic-circuit surface=nauvis window=30m\n``` Done.";
  // Every split point, including inside both fences.
  for (let i = 1; i < answer.length; i++) {
    expect(streamed([answer.slice(0, i), answer.slice(i)])).toBe("Makes 300/min.\n\n Done.");
  }
  expect(streamed([...answer])).toBe("Makes 300/min.\n\n Done.");
});

test("other code and inline backticks pass through, and an unfinished chart is dropped", () => {
  expect(streamed(["Use `iron-plate` and ", "```", "text\nx\n```"])).toBe("Use `iron-plate` and ```text\nx\n```");
  expect(streamed(["Here: ```rate_chart\nitem=x"])).toBe("Here: ");
  expect(streamed(["ends with a tick `"])).toBe("ends with a tick `");
  expect(stripChartBlocks("A.\n\n```rate_chart\nitem=x surface=y\n```\n\n")).toBe("A.");
});
