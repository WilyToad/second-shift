# Work tracking

Sprints and backlog live here, in git, next to the code. `PLAN.md` says *what* we're building and
why; this folder says *what's being worked on now* and what's done.

Run `bun run board` for a progress summary, or `bun run board --check` to validate the files.

## Items

Every piece of work is one line with a stable ID. The ID never changes, even when the item moves
from the backlog into a sprint or rolls over to the next one.

```
- [ ] FC-024 Find and count entities near the player
  - Acceptance: "how many rails to my right?" returns a count and the area it searched
  - Notes: area-limited search only (PLAN §5)
```

| Marker | Status |
|---|---|
| `[ ]` | To do |
| `[~]` | In progress |
| `[x]` | Done |
| `[!]` | Blocked (say why in a sub-bullet) |
| `[-]` | Dropped (say why) |

- An item lives in exactly one file: `BACKLOG.md` or one sprint. Moving it means cutting the line
  and its sub-bullets, not copying.
- New items take the next unused number (`bun run board` prints it).
- Sub-bullets are free-form. `Acceptance:` is expected for anything non-trivial.

## Sprints

Sprints are **goal-based**: each has one demonstrable goal and ends when its acceptance test
passes, however long that takes. Only one sprint is active at a time.

Lifecycle:
1. **planned**: goal, acceptance test and items drafted, usually pulled from `BACKLOG.md`.
2. **active**: the player has agreed to the plan. Set `Started`.
3. **done**: the acceptance test passed. Set `Finished`, fill in *Review* (what shipped, what was
   measured, what moved back to the backlog) and link commits.

Unfinished items at the end of a sprint go back to `BACKLOG.md` or into the next sprint.

## Conventions

- Mark an item `[~]` when starting it, and `[x]` in the same commit that finishes it.
- Put item IDs in commit messages (`FC-024: …`).
- Measurements and decisions still go in `PLAN.md`; the sprint Review links to them.
