// FC-153: arithmetic an answer writes out ("7 × 25,000 = 1,250,000") is checked in code after the answer, and a wrong
// result gets a correction line. A calculator tool was the alternative, but every tool round pays another first token
// (1–2.5 s measured, PLAN §5), and the model would still have to decide to call it.

const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const OP = String.raw`(×|x|\*|times|\+|plus|÷|/|divided by)`;
/**
 * What says "and the answer is". An arrow is **not** one of them: in this game it means "produces", and a recipe
 * written tersely — "bioflux 15+12 → 4 per 6 s" — is ingredients and a yield, not a sum. Live 2026-09-20, that
 * earned the player a "Correction: 15 + 12 = 27, not 4." The same recipe with its item names in between was
 * already safe; without them the arrow was the only thing making it look like arithmetic.
 */
const IS = "(?:=|equals|is|are|makes|gives|comes to)";
const EXPR = new RegExp(String.raw`(?<![\w.,-])${NUM}\s*${OP}\s*${NUM}\s*${IS}\s*(about |roughly |around |~|≈)?${NUM}(?![\d,]*\.\d)`, "gi");

const value = (s: string) => Number(s.replace(/,/g, ""));
const show = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function arithmeticCorrections(text: string): string[] {
  const out: string[] = [];
  for (const m of text.replace(/\*\*|__|`/g, "").matchAll(EXPR)) {
    const [, a, op, b, approx, claimed] = m;
    const x = value(a!), y = value(b!), c = value(claimed!);
    const o = op!.toLowerCase();
    const expected = o === "+" || o === "plus" ? x + y : o === "÷" || o === "/" || o === "divided by" ? (y === 0 ? NaN : x / y) : x * y;
    if (!Number.isFinite(expected)) continue;
    const slack = Math.max(Math.abs(expected) * (approx ? 0.05 : 0.01), 0.05);
    if (Math.abs(c - expected) <= slack) continue;
    const symbol = o === "+" || o === "plus" ? "+" : o === "÷" || o === "/" || o === "divided by" ? "÷" : "×";
    out.push(`Correction: ${show(x)} ${symbol} ${show(y)} = ${show(expected)}, not ${show(c)}.`);
  }
  return [...new Set(out)];
}
