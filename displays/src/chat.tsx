import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { lastTypedAt } from "./warm";
import { BlueprintView, RateChart, RecipeGraph, segments } from "./components";
import { plainName } from "./rich-text";
import { send, thread, type ThreadItem } from "./store";
import { setSoundsOn, soundsOn } from "./sounds";
import { capturing, captureError, clipCount, lastClip, lastLocal, localStt, probeStt, sayTruth, setCapturing, setLocalStt, sttStatus } from "./capture";
import { markSpoken, spokenNow, takeInterrupted, phrasesRejected, chooseVoice, deviceStatus, preferOnDevice, setPreferOnDevice, elevenVoices, voiceChoice, heard, heardDetail, installOnDevice, listenState, talkRequests, readAloud, recognitionCtor, recognizedWhere, saveSetting, setSilenceSeconds, silenceSeconds, startTalking, stopSpeaking, stopTalking, talking, voiceError } from "./voice";

const SILENCE_CHOICES = [1, 1.5, 2, 3, 4, 5];

/** Bold and inline code the model writes in Markdown (`**1,493/min**`, `` `iron-plate` ``) render as such, not as raw marks (FC-125). */
export function Emphasis({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/);
  return <>{parts.map((p, i) => p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong>
    : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code>
    : p)}</>;
}

/** The answer's prose with the sentence and word being read aloud marked (FC-216); plain when nothing is. */
const interruptedField = () => { const it = takeInterrupted(); return it ? { interrupted: it } : {}; };

function SpokenText({ text }: { text: string }) {
  const marked = markSpoken(text, spokenNow.value);
  if (marked.length === 1 && !marked[0]!.mark) return <Emphasis text={text} />;
  return <>{marked.map((m, i) => (m.mark ? <mark key={i} class={`spoken ${m.mark}`}>{m.text}</mark> : <Emphasis key={i} text={m.text} />))}</>;
}

function AgentText({ text }: { text: string }) {
  return (
    <div class="msg agent">
      {segments(text).map((seg, i) =>
        seg.kind === "text" ? <span key={i}><SpokenText text={seg.text} /></span>
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
          {item.blueprint.value && <div class="msg"><BlueprintView card={item.blueprint.value} /></div>}
          {item.images.value.map((shot) => (
            <div class="msg" key={shot.url}>
              <figure class="vis shot">
                <img src={shot.url} alt={plainName(shot.caption)} loading="lazy" />
                <figcaption class="vis-note">{plainName(shot.caption)}<span class="tag"> · screenshot</span></figcaption>
              </figure>
            </div>
          ))}
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
              <button type="button" class="confirm" onClick={() => send({ type: "approve", id: item.id })}>Confirm</button>
              <button type="button" class="cancel" onClick={() => send({ type: "decline", id: item.id })}>Cancel</button>
            </div>
          ) : (
            <div class="approval-result">{item.result}</div>
          )}
        </div>
      );
  }
}

const FOLLOW_SLACK_PX = 48;

export function Thread() {
  const ref = useRef<HTMLElement>(null);
  // Streaming tokens update text nodes directly (no re-render), so follow DOM changes to keep scrolled down, but only
  // while the player is at the bottom: charts redraw on every snapshot, and following those pulled the player back
  // down whenever they scrolled up to read. A new question from the player always jumps to the bottom.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let stuck = true;
    const onScroll = () => { stuck = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX; };
    const follow = new MutationObserver((records) => {
      const asked = records.some((r) => [...r.addedNodes].some((n) => (n as HTMLElement).classList?.contains("user")));
      if (!stuck && !asked) return;
      el.scrollTop = el.scrollHeight;
      stuck = true;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    follow.observe(el, { childList: true, subtree: true, characterData: true });
    return () => { follow.disconnect(); el.removeEventListener("scroll", onScroll); };
  }, []);
  return (
    <main id="thread" aria-live="polite" ref={ref}>
      {thread.value.map((item) => <Item key={item.key} item={item} />)}
    </main>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" fill="currentColor" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  );
}

/** Where the voice goes, in the player's words (FC-062): the browser may send it to its speech service. */
export function whereLabel(where: string): string {
  return where === "on-device" ? "Voice is recognized on this device." : where === "speech-service" ? "Voice is sent to your browser's speech service to turn it into text." : "";
}

/** "That's not what I said": the ground truth a transcriber can be scored against (FC-188). */
export function TruthRow({ heard }: { heard: string }) {
  const editing = useSignal(false);
  const text = useSignal(heard);
  if (!editing.value) {
    return (
      <div class="voice-note" id="truth-row">
        Kept that clip as “{heard}”.{" "}
        <button type="button" class="link" id="fix-truth" onClick={() => { editing.value = true; text.value = heard; }}>Not what I said</button>
      </div>
    );
  }
  return (
    <div class="voice-note" id="truth-row">
      <label for="truth" class="visually-hidden">What you actually said</label>
      <input id="truth" value={text.value} onInput={(e) => (text.value = e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void sayTruth(text.value); editing.value = false; } if (e.key === "Escape") editing.value = false; }} />{" "}
      <button type="button" onClick={() => { void sayTruth(text.value); editing.value = false; }}>Save what I said</button>
    </div>
  );
}

export function Composer({ onAsk = (text: string, thinking: boolean, spoken = false) => send({ type: "ask", text, thinking, ...(spoken ? { spoken: true, ...(heardDetail() ? { heard: heardDetail()! } : {}), ...interruptedField() } : {}) }), recognition = recognitionCtor() }: { onAsk?: (text: string, thinking: boolean, spoken?: boolean) => void; recognition?: ReturnType<typeof recognitionCtor> } = {}) {
  const text = useSignal("");
  const thinking = useSignal(false);
  const submit = () => {
    const value = text.value.trim();
    if (!value) return;
    stopSpeaking();
    onAsk(value, thinking.value);
    text.value = "";
    lastTypedAt.value = 0;
  };
  const on = talking.value;
  const listening = on && listenState.value === "listening";
  const waiting = on && listenState.value === "waiting";
  // Talk starts a session that keeps listening until Talk is clicked again (FC-149).
  const toggleMic = (fromGame = false) => {
    if (talking.peek()) stopTalking();
    // The third argument marks it as speech, so the turn reads an odd word as a mis-hear (FC-175).
    else startTalking((said: string) => onAsk(said, thinking.value, true), recognition, undefined, { fromGame });
  };
  useEffect(() => { void probeStt(); }, []);
  // Push to talk from the game (FC-147): each press toggles, like clicking Talk.
  const seenTalk = useRef(talkRequests.peek());
  useEffect(() => {
    if (!recognition || talkRequests.value === seenTalk.current) return;
    seenTalk.current = talkRequests.value;
    toggleMic(true);
  }, [talkRequests.value]);
  // Option+V (Alt+V) toggles talking from anywhere on the page; Escape ends it without sending and stops speech.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (recognition && e.altKey && e.code === "KeyV") { e.preventDefault(); toggleMic(); }
      if (e.key === "Escape") { stopTalking({ send: false }); stopSpeaking(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  return (
    <form id="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label for="ask" class="visually-hidden">Ask the companion</label>
      <textarea
        id="ask" rows={2} value={listening && heard.value ? heard.value : text.value} placeholder={listening ? "Listening…" : waiting ? "Waiting for the answer, then listening again…" : "Ask about your factory, e.g. “how many rails are near me on the right?”"}
        onInput={(e) => { text.value = e.currentTarget.value; lastTypedAt.value = Date.now(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
      />
      <div class="bar">
        <span class="voice">
          <label><input type="checkbox" id="thinking" checked={thinking.value} onChange={(e) => (thinking.value = e.currentTarget.checked)} /> Think it through</label>
          <label title="Short sounds for listening, alerts, research and cards"><input type="checkbox" id="sounds" checked={soundsOn.value} onChange={(e) => setSoundsOn(e.currentTarget.checked)} /> Sounds</label>
          <label title="Writes each spoken question to disk as audio, so a local transcriber can be tested against your own voice. Nothing is sent anywhere."><input type="checkbox" id="keep-audio" checked={capturing.value} onChange={(e) => void setCapturing(e.currentTarget.checked)} /> Keep my audio</label>
          {recognition && sttStatus.value?.available && (
            <label title="Your voice is transcribed on this Mac by whisper (FC-230). Off, the browser's speech engine does it as before."><input type="checkbox" id="local-stt" checked={localStt.value} onChange={(e) => setLocalStt(e.currentTarget.checked)} /> Transcribe on this Mac</label>
          )}
          <label title="Reads each answer aloud as it arrives"><input type="checkbox" id="read-aloud" checked={readAloud.value} onChange={(e) => { readAloud.value = e.currentTarget.checked; saveSetting("second-shift.readAloud", readAloud.value); if (!readAloud.value) stopSpeaking(); }} /> Read answers aloud</label>
          {readAloud.value && elevenVoices.value.length > 0 && (
            <label title="ElevenLabs voices send the answer text to ElevenLabs">
              <span class="visually-hidden">Voice</span>
              <select id="voice" value={voiceChoice.value} onChange={(e) => chooseVoice(e.currentTarget.value)}>
                <option value="browser">This Mac's voice</option>
                <optgroup label="ElevenLabs (online)">
                  {elevenVoices.value.map((v) => <option key={v.id} value={`eleven:${v.id}`}>{v.name}</option>)}
                </optgroup>
              </select>
            </label>
          )}
        </span>
        <span>
          <button type="button" class="cancel" onClick={() => send({ type: "reset" })}>New conversation</button>{" "}
          {recognition && (
            <label title="How long a pause sends what you said">
              <span class="visually-hidden">Send after a pause of</span>
              <select id="silence" value={String(silenceSeconds.value)} onChange={(e) => setSilenceSeconds(Number(e.currentTarget.value))}>
                {SILENCE_CHOICES.map((sec) => <option key={sec} value={String(sec)}>send after {sec} s</option>)}
              </select>
            </label>
          )}{" "}
          {recognition && (
            <button type="button" id="mic" class={`mic${listening ? " listening" : ""}${waiting ? " waiting" : ""}`} aria-pressed={on} title="Talk (Option+V): keeps listening and sends after each pause. Click again to stop; Escape stops without sending." onClick={() => toggleMic()}>
              <MicIcon /> {listening ? "Listening" : waiting ? "Waiting" : "Talk"}
            </button>
          )}{" "}
          <button type="submit">Send</button>
        </span>
      </div>
      {recognition && (voiceError.value || on) && (
        <div class={`voice-note${voiceError.value ? " error" : ""}`} role="status">{voiceError.value ?? whereLabel(recognizedWhere.value)}</div>
      )}
      {recognition && !voiceError.value && deviceStatus.value === "downloadable" && (
        <div class="voice-note">
          Voice goes to your browser's speech service.{" "}
          <button type="button" class="link" id="on-device" onClick={() => void installOnDevice(recognition)}>Recognize on this device instead</button>
        </div>
      )}
      {/* Once the on-device model is there, the player picks which engine hears them (FC-174). */}
      {recognition && deviceStatus.value === "available" && (
        <div class="voice-note" id="engine-choice">
          <label for="engine">Recognize with</label>{" "}
          <select id="engine" value={preferOnDevice.value ? "device" : "service"} onChange={(e) => setPreferOnDevice(e.currentTarget.value === "device")}>
            <option value="service">Your browser's speech service — the audio leaves your Mac</option>
            <option value="device">This device — nothing leaves your Mac</option>
          </select>
        </div>
      )}
      {recognition && sttStatus.value?.available && localStt.value && (
        <div class="voice-note" id="local-stt-note" role="status">
          Transcribed on this Mac{sttStatus.value.ready ? "" : " once whisper has loaded"}{lastLocal.value ? ` — last one in ${Math.round(lastLocal.value.ms)} ms` : ""}; the browser's transcript is the fallback.
        </div>
      )}
      {capturing.value && (
        <div class="voice-note" id="keeping-audio" role="status">
          Your voice is being written to <code>data/captures/voice/</code> on this Mac — nothing is sent anywhere.
          {clipCount.value ? ` ${clipCount.value.clips} clip${clipCount.value.clips === 1 ? "" : "s"} kept, ${clipCount.value.withTruth} with your own wording.` : ""}
        </div>
      )}
      {captureError.value && <div class="voice-note error" role="status">{captureError.value}</div>}
      {/* Said once, quietly: the S31 experiment's answer for this engine (FC-206). */}
      {phrasesRejected.value && <div class="voice-note" id="phrases-rejected" role="status">This speech engine doesn't take a phrase list, so the save's words aren't biasing it — recognizing without them.</div>}
      {/* Said right after hearing it go wrong, while they still remember what they said (FC-188). */}
      {capturing.value && lastClip.value && <TruthRow heard={lastClip.value.heard} />}
      {recognition && !voiceError.value && deviceStatus.value === "downloading" && (
        <div class="voice-note" id="on-device-downloading">
          Chrome is downloading on-device speech recognition. It shows no progress here; to check, open chrome://components
          and look for "Speech On-Device API (SODA)". Talk still works meanwhile through the speech service, and this
          switches to on-device when the download finishes.
        </div>
      )}
    </form>
  );
}
