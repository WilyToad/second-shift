import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { RateChart, RecipeGraph, segments } from "./components";
import { send, thread, type ThreadItem } from "./store";

function AgentText({ text }: { text: string }) {
  return (
    <div class="msg agent">
      {segments(text).map((seg, i) =>
        seg.kind === "text" ? <span key={i}>{seg.text}</span>
        : seg.kind === "pending" ? <div key={i} class="vis-empty">Drawing chart…</div>
        : <RateChart key={i} spec={seg} />,
      )}
    </div>
  );
}

function Item({ item }: { item: ThreadItem }) {
  switch (item.kind) {
    case "user":
      return <div class="msg user">{item.text}</div>;
    case "agent":
      return (
        <>
          <AgentText text={item.text.value} />
          {item.plan.value && <div class="msg"><RecipeGraph plan={item.plan.value} /></div>}
          {item.meta.value && <div class="meta">{item.meta}</div>}
        </>
      );
    case "tool":
      return <div class="tool">{item.text}</div>;
    case "error":
      return <div class="msg error">{item.text}</div>;
    case "approval":
      return (
        <div class={`approval ${item.status.value ?? ""}`}>
          <div class="approval-title">{item.title}</div>
          <div class="approval-detail">{item.detail}</div>
          {item.status.value === null ? (
            <div class="row">
              <button class="confirm" onClick={() => send({ type: "approve", id: item.id })}>Confirm</button>
              <button class="cancel" onClick={() => send({ type: "decline", id: item.id })}>Cancel</button>
            </div>
          ) : (
            <div class="approval-result">{item.result}</div>
          )}
        </div>
      );
  }
}

export function Thread() {
  const ref = useRef<HTMLElement>(null);
  // Streaming tokens update text nodes directly (no re-render), so follow DOM changes to keep scrolled down.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const follow = new MutationObserver(() => { el.scrollTop = el.scrollHeight; });
    follow.observe(el, { childList: true, subtree: true, characterData: true });
    return () => follow.disconnect();
  }, []);
  return (
    <main id="thread" aria-live="polite" ref={ref}>
      {thread.value.map((item) => <Item key={item.key} item={item} />)}
    </main>
  );
}

export function Composer() {
  const text = useSignal("");
  const thinking = useSignal(false);
  const submit = () => {
    const value = text.value.trim();
    if (!value) return;
    send({ type: "ask", text: value, thinking: thinking.value });
    text.value = "";
  };
  return (
    <form id="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label for="ask" class="visually-hidden">Ask the companion</label>
      <textarea
        id="ask" rows={2} value={text.value} placeholder="Ask about your factory, e.g. “how many rails are near me on the right?”"
        onInput={(e) => (text.value = e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
      />
      <div class="bar">
        <label><input type="checkbox" id="thinking" checked={thinking.value} onChange={(e) => (thinking.value = e.currentTarget.checked)} /> Think it through</label>
        <span>
          <button type="button" class="cancel" onClick={() => send({ type: "reset" })}>New conversation</button>{" "}
          <button type="submit">Send</button>
        </span>
      </div>
    </form>
  );
}
