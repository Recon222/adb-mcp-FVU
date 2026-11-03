---
description: Multi-agent review of a Python-CLI code PR (python + cli-contract + tests + silent-failure + type-design, optional tui-ux; strict decision). Two modes — initial (fresh agents, parallel fan-out) and fix-delta (resume previous reviewers via stored agent IDs).
argument-hint: [pr-number | pr-url | blank for current branch PR] [--fix-delta]
---

# /code-review

Comprehensive multi-agent review of an implemented **Python CLI** PR. Auto-skips lanes by what changed (no test files → maybe skip the test analyzer; no interactive deps → skip the TUI lane).

**Input**: $ARGUMENTS

Do **not** use this for planning PRs — use `/plan-review`. Those PRs contain prose; these agents are tuned for code.

---

## Mode Selection

| Input | Mode |
|---|---|
| Number (e.g. `57`) | **Initial — PR mode**: `gh pr view <n>`, fresh agents, parallel fan-out |
| URL | **Initial — PR mode**: extract number |
| Blank | **Initial — Current-branch PR mode**: `gh pr list --head $(git branch --show-current)` |
| Any of the above + `--fix-delta` | **Fix-delta mode**: read `docs/code-reviews/pr-<n>-review.md`, extract stored agent IDs, resume each via `SendMessage`, scope each to its own findings |

**Fix-delta requires the original review doc.** If `docs/code-reviews/pr-<n>-review.md` is missing or has no `## Agent IDs` section, abort and instruct the user to run the initial review first.

---

## Phase 1 — FETCH

```bash
gh pr view <NUMBER> --json number,title,body,author,baseRefName,headRefName,changedFiles,additions,deletions,files
gh pr diff <NUMBER> --name-only
```
If the PR is not found, stop with an error.

### Sanity gate
If the PR contains **only** planning artifacts (`docs/**/*.md` with no `.py` siblings), abort: "This PR has no code changes. Use `/plan-review` instead." A mix of code + docs is fine — agents scope themselves to the Python surface and ignore the docs.

---

## Phase 2 — TRIAGE

Classify every changed file into a lane and decide which agents to dispatch.

| File pattern | Lane | Agent |
|---|---|---|
| `*.py` (production) | Python | `python-reviewer` |
| `tests/**/*.py`, `test_*.py`, `*_test.py`, `conftest.py` | Tests | `python-test-analyzer` |
| build/generated (e.g. `build/`, `dist/`, `*.egg-info/`, `__pycache__/`, generated stubs) | Skip (orchestrator confirms structurally only) |

**Co-located tests & doctests:** Python tests usually live in their own `test_*.py` files, so one file is normally one lane. Two exceptions:
- **Doctests** in a production module's docstrings — tell `python-reviewer` to review the code and ignore the `>>>` example blocks, and tell `python-test-analyzer` the doctests are part of its surface.
- A repo that keeps tests **beside** the code (a `def test_*` in a production module) — brief by **region, not file**: `python-reviewer` reviews the production functions (so it doesn't flag `assert` / bare-`except` in test bodies), `python-test-analyzer` owns the `test_*` functions. Don't route the whole file to one lane.

**Always dispatched** (every Python CLI has these surfaces):
- `python-reviewer` (there is always `.py`)
- `cli-contract-reviewer` (args / exit codes / stdout-stderr / output schema)
- `silent-failure-hunter` (errors swallowed anywhere)
- `type-design-analyzer` (types across the change)

**Conditionally dispatched:**
- `python-test-analyzer` — if any test file changed OR non-trivial production code landed without tests.
- `tui-ux-reviewer` — **only if** the project has an interactive/terminal-UI surface. Detect with:
  ```bash
  grep -E "\b(rich|textual|prompt_toolkit|prompt-toolkit|questionary|inquirer|PyInquirer|blessed|urwid)\b" \
    pyproject.toml setup.cfg setup.py requirements*.txt 2>/dev/null
  # plus a usage check (a project may depend on rich/click/typer only for non-interactive output):
  grep -REn "curses|tty\.setraw|termios|\.isatty\(|click\.(prompt|confirm)|typer\.(prompt|confirm)|questionary\.|inquirer\.|prompt_toolkit|textual" \
    --include='*.py' . 2>/dev/null | head
  ```
  …OR `cli-review-profile.md` `project_type` includes `interactive`. A dependency on `click`/`typer`/`rich` **for arg-parsing or plain output only** is NOT interactive. If neither the interactive libs nor actual prompting/raw-mode usage is present, **skip** this lane (skipping is correct, not under-coverage).

**Never dispatched by default** (no TypeScript lane exists in this system — a CLI consumed by a TS app is a separate concern). Record the lane decision; report it under "Reviewer lanes."

---

## Phase 3 — PRE-FLIGHT

Run the Python gates and surface pass/fail as **context** for the reviewers — don't abort the review on infra failures unless tests genuinely don't run.

```bash
pytest -q                              # or the changed package: pytest tests/<area> -q
# advisory (do not block):
ruff check .
ruff format --check .
mypy <package>                         # if the project uses mypy / pyright
# optional security gates (advisory, only if configured/installed):
command -v bandit   >/dev/null && bandit -q -ll -r <package> || true
command -v pip-audit >/dev/null && pip-audit || true
```

**Detect the project's actual toolchain** from `pyproject.toml` / `setup.cfg` / config files before assuming — a repo may use `flake8`/`pylint` instead of `ruff`, `black --check` instead of `ruff format`, `pyright` instead of `mypy`, or `nox`/`tox` to drive everything. Run what the repo declares; fall back to the modern defaults above.

**Filter ruff/mypy output to findings *new to this PR*** (vs pre-existing repo debt) so `python-reviewer` doesn't waste a finding on repo-wide warnings. Record the count of pre-existing failures unrelated to this PR.

### Pre-flight status payload (handed to each agent)
- `pytest`: pass/fail counts + any new-to-this-PR failures (and collection errors, if any)
- `ruff` / `mypy`: new-to-this-PR warnings on the changed surface only
- `ruff format`: whether the changed files are formatted

**Run the gates ONCE here; agents consume the payload, they don't re-run them.** Re-running `pytest`
/ `mypy` per lane re-pays slow test collection and a cold type-check N times. Brief each agent: "the
gates already ran — trust the payload; use `ruff check <file>` / `mypy <file>` / a quick `python -c`
parse only to confirm a *specific* claim, never re-run the whole suite." (The agents' own diagnostic
sections are scoped to this.)

---

## Phase 4 — DISPATCH (initial mode)

**Send all dispatched agents in a single message with multiple `Agent` tool calls** so they run concurrently. Each agent gets:
1. The list of changed files in its lane.
2. A pointer to project rules + `cli-review-profile.md`.
3. The pre-flight status payload.
4. PR metadata (number, title, slice-N-of-M context if known).
5. **Slice boundary briefing**: which features are intentionally absent because they belong to a later slice — so reviewers don't flag intentional gaps.

### Capturing agent IDs for fix-delta
The `Agent` tool returns an `agentId`. **Capture every agent's ID** and write them into the artifact under `## Agent IDs` so fix-delta can resume them. If the harness doesn't expose `agentId`, omit the section; fix-delta falls back to fresh dispatch.

### Lane briefing template (terse — each agent carries its full persona)
```
Code review for PR #<N> — <title>.
This is <slice N of M> in <feature>. <one-line slice scope>.
<one-line out-of-scope note: what's intentionally NOT in this PR>

## Files in your lane
<list>

## Out of your lane (other agents handle)
<short list>

## Pre-flight status
<the Phase-3 payload>

## Project context to load
cli-review-profile.md, AGENTS.md / CLAUDE.md, plus the feature's architecture doc.

Begin. Follow your persona's discipline (Pre-Report Gate, HIGH/CRITICAL proof, zero-findings-is-valid).
```

**Do not run agents sequentially.** One message, N `Agent` blocks.

---

## Phase 4-alt — DISPATCH (fix-delta mode)

Skip Phase 4's fresh dispatch. Instead:
1. Read `docs/code-reviews/pr-<n>-review.md`.
2. Extract agent IDs from `## Agent IDs`.
3. For each agent, map which of its original findings have fix commits, and which were deferred (via a tracking doc, if any).
4. **`SendMessage` each agent in parallel** (single message, multiple `SendMessage` blocks) with a focused brief:

```
Fix-delta review for PR #<N>.
You raised <N> findings (<breakdown>). <M> have direct fixes; <K> were deferred.

## Pre-flight status (re-verified)
<pytest / ruff / mypy counts>

## Your original findings → fix commits
| Finding | Severity | Fix commit | Type |
|---|---|---|---|
<table mapping THIS agent's findings to fix SHAs, or "DEFERRED">

## What to verify
<per-finding: confirm closed / regressed / deferral-justified>

## Output format
Same as initial. Title it "## <Lane> Summary (Fix Delta)". Per-finding status. Summary table + verdict.
Begin.
```

If a fix commit touches multiple agents' findings, each agent gets the same SHA in its brief — expected; each evaluates from its own lens.

---

## Phase 5 — AGGREGATE

1. **Dedupe** — when two agents identify the same root cause from different angles (e.g. `cli-contract-reviewer` catches stdout contamination; `silent-failure-hunter` catches the swallowed write behind it), merge into one finding and note both. Cross-lane independent identification is a strong signal — call it out in "Pipeline notes."
2. **Surface conflicts** — opposing positions go to a top-of-report "Disputed" section.
3. **Rank by severity**, then file then line.
4. **Tally** per severity per agent.

---

## Phase 6 — DECIDE (strict mode)

| Condition | Decision |
|---|---|
| Any CRITICAL | **BLOCK** |
| Any HIGH (no CRITICAL) | **REVISE** |
| Only MEDIUM / LOW | **APPROVE** with comments |
| Zero findings from all agents | **APPROVE** |

**Special cases:** draft PR → still decide, soften framing; fix-delta with one new finding from one lane → REVISE on that lane, other APPROVEs stand.

**Agent conflicts — adjudicate, don't reflex-escalate.** Two lanes taking opposing positions on the same code go to the "Disputed" section. Then:
- If the conflict is **factual** (one lane's premise is checkable — "this regresses X", "Y is introduced by commit Z", "the handler fires before the guard"), the orchestrator **verifies it** (`git show`, read the source, run the case) and adjudicates. A claim shown false is downgraded to an advisory note, NOT auto-escalated — a verifiably-wrong REVISE must not gate the PR. State the verification in the Disputed entry.
- If the conflict is a genuine **judgment split** that verification can't settle, **then** escalate to ≥REVISE and say why it's unresolved.
(Worked example: a lane flags something as a "regression introduced here"; `git show <parent>` proves the same condition pre-existed the PR → the correct outcome is a pre-existing advisory, not a REVISE that gates the PR.)

---

## Phase 7 — REPORT

### Initial mode → `docs/code-reviews/pr-<NUMBER>-review.md` (create dir if needed)
```markdown
# PR <N> — Aggregate Code Review

**PR:** [#<N>](<URL>) — <title>
**Branch:** <head> → <base>
**Reviewer lanes (fresh fan-out):** <dispatched agents + which were skipped and why>
**Date:** <YYYY-MM-DD>

## Verdict
**<BLOCK | REVISE | APPROVE>.** <2-3 sentences, lead with rationale.>

## Pre-flight gates
<table: gate / result>

## Reviewer verdicts at a glance
<table: agent / C / H / M / L / verdict>

## Disputed (agent conflicts)
<or "None.">

## Findings (deduped, ranked)
### CRITICAL
### HIGH
### MEDIUM
### LOW

## Invariants checked & confirmed
<positive confirmations — what's working well>

## Recommended next steps
<contextual>

## Agent IDs
<!-- Used by /code-review --fix-delta to resume reviewers via SendMessage. -->
- python-reviewer: <agentId or "not dispatched">
- cli-contract-reviewer: <agentId or "not dispatched">
- silent-failure-hunter: <agentId or "not dispatched">
- type-design-analyzer: <agentId or "not dispatched">
- python-test-analyzer: <agentId or "not dispatched">
- tui-ux-reviewer: <agentId or "not dispatched">

## Pipeline notes (optional)
<cross-lane dedupes, coverage gaps, etc.>
```

### Fix-delta mode → `docs/code-reviews/pr-<NUMBER>-fixes-review.md` (separate file)
Self-contained (the implementing instance shouldn't need to reread the original). Include: verdict; re-verified pre-flight gates; fix-commit → original-finding mapping; per-finding closed/regressed/deferral-justified status; any new findings introduced by the fixes; re-verified invariants; next steps.

---

## Phase 8 — OUTPUT

### Initial
```
PR #<N>: <TITLE>
Decision: <BLOCK | REVISE | APPROVE>

Findings: <C> critical · <H> high · <M> medium · <L> low
Lanes dispatched: <list>   |   skipped: <list + reason>
Conflicts: <count> disputed

Artifact: docs/code-reviews/pr-<N>-review.md

Top 3 to address:
  1. <highest-impact — file:line + 1-line fix>
  2. <next>
  3. <next>
```

### Fix-delta
```
PR #<N>: <TITLE> — Fix Delta
Decision: <BLOCK | REVISE | APPROVE>

Closed: <count>/<original>   Deferral-justified: <count>   New: <count>
Artifact: docs/code-reviews/pr-<N>-fixes-review.md
<one-line state — "ready for merge" or "single mechanical commit needed">
```

Keep the terminal output tight — full detail is in the artifact.

---

## Edge Cases

- **No `gh` CLI**: PR mode falls back to local checkout + re-run after `git fetch`.
- **PR contains only planning docs**: Stop. Suggest `/plan-review`.
- **No `docs/code-reviews/`**: Create on first run.
- **Agents return errors**: Continue with the survivors; mark the lane "errored" in the summary table.
- **Fix-delta with no agent IDs**: Fall back to fresh dispatch; warn the user context will be re-derived (slower, possibly different verdict).
- **Fix-delta finds new HIGH introduced by the fixes**: Verdict back to REVISE — the original was right but the fixes regressed. Don't paper over.
- **Cross-lane independent identification of one root cause**: Strong signal — note it in Pipeline notes; dedupe but credit both lanes.
- **Mid-slice PR (N of M)**: Brief each agent with the slice boundary so they don't flag intentional absences.

---

## Confidence Rule (inherited by every agent)

Every dispatched agent runs with: confidence ≥ 80% before reporting; the Pre-Report Gate (cite exact file:line, name the concrete failure mode, prove HIGH/CRITICAL with snippet + scenario); and "zero findings is a valid clean review." If the agents return noise, tighten the agent persona files — don't relax the gate.

## Pipeline lessons

- **Fresh agents for initial reviews, resume for fix-delta.** Resume preserves context (agents reference their own original wording) and runs faster than fresh dispatch.
- **Cross-lane independent identification is a strong signal.** When two lanes catch the same root cause from different angles, it's confirmation — surface it.
- **Skip a lane when its surface didn't change.** No `.py` is impossible here, but skipping `tui-ux-reviewer` on a non-interactive CLI, or `python-test-analyzer` when no tests/behavioral code changed, is correct — not under-coverage.
- **Triage ruff/mypy into new-vs-pre-existing before briefing**, or reviewers waste findings on repo-wide noise.
