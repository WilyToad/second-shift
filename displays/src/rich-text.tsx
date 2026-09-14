// Factorio rich text in names the player typed (space platforms, train stops): "[virtual-signal=signal-1]Rocket One".
// The page can't draw game icons yet, so tags become small badges with a readable label and formatting tags
// ([color=…], [font=…]) keep only their text. The raw name stays untouched in data (charts and prompts need it).
const TAG = /\[(\/?)([a-z-]+)(?:=([^\]]*))?\]/g;

export type RichPart = { kind: "text"; text: string } | { kind: "icon"; label: string; title: string };

function iconLabel(type: string, value: string): string {
  if (type === "virtual-signal") {
    const m = /^signal-(.+)$/.exec(value);
    if (m && m[1]!.length === 1) return m[1]!.toUpperCase(); // signal-1, signal-A
    return value.replace(/^signal-/, "").replace(/-/g, " ");
  }
  return value.replace(/-/g, " ");
}

export function parseRichText(text: string): RichPart[] {
  const parts: RichPart[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    if (m.index! > last) parts.push({ kind: "text", text: text.slice(last, m.index) });
    last = m.index! + m[0].length;
    const [, closing, type, value] = m;
    if (closing || type === "color" || type === "font" || !value) continue;
    parts.push({ kind: "icon", label: iconLabel(type!, value), title: `${type}: ${value}` });
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

/** Plain text for places that can't hold markup (titles, alt text). */
export function plainName(text: string): string {
  return parseRichText(text).map((p) => (p.kind === "text" ? p.text : `${p.label} `)).join("").replace(/\s+/g, " ").trim();
}

export function RichName({ text }: { text: string }) {
  return (
    <>
      {parseRichText(text).map((p, i) => (p.kind === "text" ? <span key={i}>{p.text}</span> : <span key={i} class="rt-icon" title={p.title}>{p.label}</span>))}
    </>
  );
}
