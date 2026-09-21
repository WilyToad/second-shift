import { expect, test } from "bun:test";
import { HiddenBlockFilter, RepeatFilter, stripChartBlocks } from "./stream-filter";

const streamed = (tokens: string[]) => {
  const f = new HiddenBlockFilter();
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

test("FC-184: a tool call written as text never reaches the player, however it's split", () => {
  const answer = "Looking.\n<tool_call>\n<function=find_entities>\n<parameter=what>\nenemy\n</parameter>\n</function>\n</tool_call>\nFound none.";
  for (let i = 1; i < answer.length; i++) {
    expect(streamed([answer.slice(0, i), answer.slice(i)])).toBe("Looking.\n\nFound none.");
  }
  expect(streamed([...answer])).toBe("Looking.\n\nFound none.");
  // Cut off mid-block (the model stopped, or the round ended): the markup is dropped, not shown.
  expect(streamed(["<tool_call>\n<function=find_ent"])).toBe("");
  // Prose that merely names a tool is untouched.
  expect(streamed(["I'd use find_entities for that."])).toBe("I'd use find_entities for that.");
});

test("FC-202: a chart-allowed turn still hides a tool call written as text, and lets the chart through", () => {
  const f = new HiddenBlockFilter({ charts: true });
  const answer = "Steady.\n```rate_chart\nitem=jelly surface=gleba window=30m\n```\n<tool_call>\n<function=find_entities>\n</function>\n</tool_call>\nDone.";
  let out = "";
  for (const ch of answer) out += f.push(ch);
  out += f.end();
  expect(out).toContain("```rate_chart");
  expect(out).not.toContain("<tool_call>");
  expect(out).toContain("Done.");
});

test("FC-226: a bare HTML tag on its own line, or trailing the answer, never reaches the page", () => {
  // Verbatim shape from the player's session: an answer that ended with a line holding only "</br>".
  const answer = "Nearest accumulator is 29 tiles west at (-16, 86).\n</br>";
  for (let i = 1; i < answer.length; i++) expect(streamed([answer.slice(0, i), answer.slice(i)])).toBe("Nearest accumulator is 29 tiles west at (-16, 86).\n");
  expect(streamed([...answer])).toBe("Nearest accumulator is 29 tiles west at (-16, 86).\n");
  expect(streamed(["Done.\n<br/>\nNext."])).toBe("Done.\nNext.");
  // Text that merely contains angle brackets, or a tag in code, is untouched.
  expect(streamed(["x < y and y > z"])).toBe("x < y and y > z");
  expect(streamed(["Use `<br>` for a line break."])).toBe("Use `<br>` for a line break.");
  expect(streamed(["The pipe <-> the tank"])).toBe("The pipe <-> the tank");
});

test("FC-219: a later paragraph that reports the list is cut with everything after it; the first paragraph always streams", async () => {
  const { TailCutFilter, LIST_REPORT } = await import("./stream-filter");
  const run = (pieces: string[]) => { const f = new TailCutFilter(LIST_REPORT); let out = ""; for (const p of pieces) out += f.push(p); out += f.end(); return { out, cut: f.cut, text: f.text() }; };
  // The live answer, token by token.
  const live = "I don't dwell on it. There's a hauler in a crater.\n\nWhat's on your plate: 200 belts, 16 assembling machine 1 still short, and no free bots.".match(/.{1,7}/gs)!;
  expect(run(live)).toEqual({ out: "I don't dwell on it. There's a hauler in a crater.\n\n", cut: true, text: "I don't dwell on it. There's a hauler in a crater." });
  expect(run(["The manifest is what I miss.\n\nPacking list is 3 of 11 ticked; foundries still unaccounted."]).cut).toBe(true);
  // A bare mention on the end is the same bug wearing a friendlier face (live, 2026-09-20).
  expect(run(["I was flying when it came down.\n\nWhenever you're ready, the packing list is waiting."]).cut).toBe(true);
  // His own words for the job are not the list: "manifest" is Ballast's, and it stays.
  expect(run(["I don't dwell on it.\n\nI keep the manifest level now instead — same job, different cargo."]).cut).toBe(false);
  // An innocent second paragraph is released once its first sentence is in, and the rest streams.
  const fine = run(["No rails near you.\n\nThe nearest ", "patch is west", ". Want it marked?"]);
  expect(fine).toEqual({ out: "No rails near you.\n\nThe nearest patch is west. Want it marked?", cut: false, text: "No rails near you.\n\nThe nearest patch is west. Want it marked?" });
  // A colon is not the end of the sentence being judged (live, 2026-09-20).
  expect(run(["I keep the loads level.\n\nBack to work: you're still short on the outpost kit, and there's an hour of daylight."]).cut).toBe(true);
  // A first paragraph that mentions the list is the answer itself and is never cut.
  expect(run(["The list is 3 of 11 done."]).cut).toBe(false);
  expect(run(["Your list is 3 of 11 done.\n\nThe belts are what's left."]).cut).toBe(false);
});
