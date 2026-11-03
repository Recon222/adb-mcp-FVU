# python-cli-review-template

A copy-me, multi-agent **review harness for Python CLIs** — interactive or machine-consumed. Drop it into any Python CLI repo, write one profile file, and you get two strict, high-signal slash commands:

- **`/plan-review`** — reviews your planning docs (architecture / implementation / test-spec) *before* you write code.
- **`/code-review`** — reviews implemented Python *after* you write it, with a `--fix-delta` resume mode.

Both fan out to specialist subagents in parallel, dedupe, surface conflicts, and return a strict BLOCK / REVISE / APPROVE decision. Every agent runs a **Pre-Report Gate** (cite file:line, prove HIGH/CRITICAL, zero-findings-is-valid) so the output is real findings, not LLM noise.

---

## Install

Copy the `.claude/` directory into the root of your Python CLI repo:

```bash
cp -r path/to/python-cli-review-template/.claude  your-python-cli/.claude
```

You now have `/plan-review` and `/code-review` and ten agents available in that repo.

## Configure (one file, the reuse seam)

Create **`cli-review-profile.md`** at your repo root. Every agent reads it and treats its **Hard rules** as always-HIGH and its **Accepted trade-offs** as false-positives-to-suppress. This is what makes ten fixed agents serve *your* CLI without editing any agent.

Skeleton:

```markdown
# cli-review-profile — <Your CLI>

## project_type
machine-consumed        # or: interactive   (or both, space-separated)

## Output contract
- stdout: <what goes on stdout — the machine payload>
- stderr: <logs / diagnostics>
- Exit codes: 0 = <success incl. empty results>; 1 = <runtime failure>; 2 = <usage error>
- Formats: <--format variants>; schema_version: <n>

## Hard rules (always-HIGH if violated)
- <invariant the reviewers must enforce>

## Accepted trade-offs (suppress as false-positives — do NOT flag)
- <deliberate decision the reviewers should not nag about>

## Architecture pointers
- <paths to your design docs>
```

`project_type` drives one dispatch decision: the **`tui-ux-reviewer`** lane only runs when your project depends on (and actually uses) an interactive / terminal-UI library — `rich`, `textual`, `prompt_toolkit`, `questionary`, `inquirer`, `blessed`, `urwid`, the stdlib `curses`, or interactive prompting via `click.prompt`/`typer.prompt` — **or** when `project_type` includes `interactive`. A pure machine CLI (even one that imports `click`/`typer`/`rich` only for arg-parsing or plain output) never pays for that lane.

## Use

```bash
/plan-review docs/plans/my-feature        # local dir of planning docs
/plan-review 57                           # a planning PR
/code-review                              # current-branch PR
/code-review 57                           # a specific PR
/code-review 57 --fix-delta               # re-review only the fix commits, resuming the same agents
```

Artifacts land in `docs/plan-reviews/` and `docs/code-reviews/`.

---

## The lanes

| Agent | Model | Dispatch | Single question |
|---|---|---|---|
| `plan-architect-reviewer` | opus | `/plan-review` (always) | Does this approach fit this Python CLI? |
| `plan-quality-checker` | sonnet | `/plan-review` (always) | Implementable from the doc alone? |
| `plan-test-spec-analyzer` | sonnet | `/plan-review` (always) | Would the specified tests catch real regressions? Does every ADR / Hard rule have a red-line test? |
| `plan-reality-checker` | sonnet | `/plan-review` (**brownfield only**) | Are the repo claims true? (skipped on greenfield — no codebase to verify against) |
| `python-reviewer` | sonnet | `/code-review` (always) | Bug / crash-on-bad-input / injection / convention violation? |
| `cli-contract-reviewer` | sonnet | `/code-review` (always) | Do args / exit codes / stdout-stderr / format schema hold? |
| `silent-failure-hunter` | sonnet | `/code-review` (always) | Where does a real failure go invisible? |
| `type-design-analyzer` | sonnet | `/code-review` (always) | Do the types let invalid states through? |
| `python-test-analyzer` | sonnet | `/code-review` (tests touched / untested code) | Would these tests catch a real regression? |
| `tui-ux-reviewer` | sonnet | `/code-review` (interactive deps only) | Does the terminal surface behave and restore cleanly? |

Grounded in mainstream Python CLI/TUI patterns (argparse, click, typer, rich, textual, prompt_toolkit) and core Python discipline — EAFP error handling with a typed exception hierarchy, type-driven design (dataclasses / `Enum` / `Literal` / `Protocol` / `NewType`), asyncio correctness (bounded fan-out, timeouts, no blocking on the loop), and pytest/hypothesis testing.
