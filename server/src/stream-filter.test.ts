import { expect, test } from "bun:test";
import { ChartBlockFilter, RepeatFilter, stripChartBlocks } from "./stream-filter";

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

test("FC-130: an answer written twice is cut to one copy, however it's split into tokens", () => {
  const answer = "22 entities: 2 assembling-machine-2, 6 inserters and 14 belts. Both inputs keep up at 90/min; nothing looks wrong.";
  const stream = `${answer}\n\n${answer}`;
  for (const size of [1, 3, 7, 40]) {
    const f = new RepeatFilter();
    let shown = "";
    for (let i = 0; i < stream.length; i += size) shown += f.push(stream.slice(i, i + size));
    shown += f.end();
    expect(shown.trim()).toBe(answer);
    expect(f.repeated).toBe(true);
    expect(f.text()).toBe(answer);
  }
});

test("FC-130: restating the first words briefly isn't a repeat, and nothing is lost", () => {
  const text = "Iron plate is made in a stone furnace from iron ore at 3.2 s per plate. Iron plate is made faster in a steel furnace: 1.6 s per plate, same ore.";
  const f = new RepeatFilter();
  let shown = "";
  for (const ch of text) shown += f.push(ch);
  shown += f.end();
  expect(shown).toBe(text);
  expect(f.repeated).toBe(false);
});
