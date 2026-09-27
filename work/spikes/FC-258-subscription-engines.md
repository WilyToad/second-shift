# FC-258 — Running the companion on a Claude or ChatGPT subscription

**Question (player, 2026-09-27):** "Create the option to use `claude -p` and whatever the chatgpt/codex equivalent is.
And APIs as well." Asked what the CLIs were for, the answer was **"use my subscription"** — a live engine billed to the
player's plan rather than an API key.

The constraint that decides it: a live engine sits inside an agent loop that must stay the only thing able to act. The
helmet rule and "named actions only" mean the model gets our tools and nothing else — no shell, no file access. Both
CLIs are *agents* that ship their own tools, so each was tested on exactly that: locked down as far as it goes, from an
empty folder containing one planted file, asked to run `ls` and read it.

## `claude -p` — viable

Locked down with `--tools ""` (no built-in tools), `--strict-mcp-config` (no MCP), `--setting-sources project` run
from an empty folder (none of the player's settings, plugins or auto-memory — the player has `autoMemoryEnabled` on,
which would otherwise read their Claude Code memories into the companion or write Factorio chatter into them),
`--no-session-persistence`, `--disable-slash-commands`, and `--system-prompt` replacing Claude Code's own ~9k-token
prompt. `--bare` would be tidier but skips the login, so it can't authenticate ("Not logged in").

- **Can't act.** Asked to run `ls` and read the planted file, it wrote the command out as text — one turn, nothing
  executed, never saw the file.
- **Calls our tools.** Every model tested, asked "Find the rails near me", answered with
  `<tool_call>{"name": "find_entities", "arguments": {"what": "rail"}}</tool_call>` — the exact form the server already
  recovers (`toolCallsFromText`, FC-184). Tool calls go in as text; our loop stays the one running them, with every
  guard, card and correction it already has.
- **Fast enough, on Sonnet.** First words / total, three questions each, a ~5 KB system prompt:

| model | first words | total |
|---|---|---|
| Haiku 4.5 | 3.1–8.2 s | 4.0–9.4 s |
| **Sonnet 5** | **1.1–2.3 s** | 2.2–4.1 s |
| Opus 5.5 (`opus`) | 2.1–6.2 s | 3.0–8.6 s |

Sonnet 5 lands in the range oMLX gives today (1.0–1.5 s), because Anthropic caches the prefix server-side
(`cache_read_input_tokens` 9,080 on a repeat). Each tool round is a new process with the whole transcript — stateless,
like an API call — so multi-round tool use works; its cost is one spawn per round.

## `codex exec` — not viable as a live engine

- **Acts on the machine.** In its tightest documented setting (`--sandbox read-only`), from the empty folder, it ran
  `/bin/zsh -lc ls`, then `cat -- SENTINEL-if-you-can-read-this.txt`, and reported the contents. 17.3 s, 45,547 input
  tokens (its own instructions).
- **Switching the shell off isn't enough.** With the feature flags `shell_tool`, `unified_exec`, `browser_use`,
  `browser_use_external`, `computer_use`, `apps`, `code_mode_host` and others set to false, it said shell execution was
  unavailable — and then made three MCP calls through a bundled plugin (`codex-app-tools`) looking for "terminal/Finder
  access", stopped only because they weren't approved. 44.1 s, 86,273 input tokens.
- **No single "no tools" switch.** Where `claude -p` has one flag, Codex has shell, browser, computer control, apps and
  plugins to disable one at a time, and each release can add another route. It also loads the player's own
  `~/.codex/AGENTS.md`.
- **Too slow regardless.** 17–44 s a round; a turn with tool calls would run past two minutes.

So Codex isn't wired in as an engine. The ChatGPT route is the OpenAI API, which is billed per token — not the ChatGPT
subscription — and needs an API key the player doesn't have yet.

## The APIs

Anthropic's Messages API (official `@anthropic-ai/sdk`, per the Claude API reference) and OpenAI's Chat Completions
(the wire format the oMLX client already speaks). Both built behind the same one-method `ChatModel` the agent already
uses. Neither can be tested live yet: no `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set.

**What leaves the Mac, with any of these:** the whole turn — the system prompt with the save's mods, the retrieved
lines, the live snapshot, the history, every question. Not the narrow slice Jev sees. oMLX stays the default, and the
README says so plainly.

## Through the real server (2026-09-27)

`COMPANION_ENGINE=claude-cli` on a second server (port 5171, its own sessions and turn log, `COMPANION_DECISIONS=local`),
the player's own server left running on oMLX.

- **Grounding, game closed (replayed digest): 10/10**, first words median 1.95 s, max 4.81 s; answers median 84 tokens.
  The prompt is ~5.7k tokens with 4,617 cached — smaller than oMLX's because the block padding is skipped (it only
  helps oMLX's 2,048-token blocks; a hosted engine would just pay for it).
- **Ratios: 7/8.** Every machine count right; on "60 maraxsis glass panes" it summarised raw inputs (limestone, iron
  ore) and left out the sand line the check looks for. oMLX passed all 8 on its last two runs.
- **Asking before acting, dev save hosted: 18/18.** Real multi-round tool use through the agent loop — find the rails,
  then mark them behind a card; paste only when asked. Tool turns took 6.3–7.7 s (first words 4.5–6.8 s: one spawn
  per round), plain answers 2.9–5.0 s.
- Warm-up works (3.0 s), and the tone is terser and less in character than Flash-Next's — no "back in orbit" closers.

Not run live: `anthropic` and `openai`, for want of keys. Their request shapes are covered by unit tests against the
SDK's own types (Anthropic) and the Chat Completions fields (OpenAI).
