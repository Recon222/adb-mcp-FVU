---
description: Multi-agent review of a Python-CLI planning PR or local planning docs (architect + quality + test-spec + reality-check, strict decision). Two modes — initial (fresh agents, parallel fan-out) and fix-delta (resume the prior reviewers via stored agent IDs to verify revisions).
argument-hint: [pr-number | pr-url | path/to/plan-dir-or-file | blank for current branch PR] [--fix-delta]
---

# /plan-review

Comprehensive review of **Python-CLI planning documents** (architecture docs, implementation/sliced plans, TDD test specs) **before** implementation begins. Catches architectural drift, vague slicing, and codebase-vs-plan inconsistencies while they are still cheap to fix.

**Input**: $ARGUMENTS

---

## When to Use

Run this when a PR or directory contains planning artifacts (architecture / implementation / TDD-spec markdown) and you want a structured review *before* shipping any Python. Do NOT use this for code — use `/code-review` instead. This command's agents are tuned for prose, not implementation.

---

## Mode Selection

| Input | Mode |
|---|---|
| Number (e.g. `55`) | **PR mode** — `gh pr view <n>` |
| URL (`github.com/.../pull/55`) | **PR mode** — extract number |
| Path (e.g. `docs/plans/arc-gis/`) | **Local mode** — review files in that path |
| Blank | **Current-branch PR mode** — `gh pr list --head $(git branch --show-current)` |
| Any of the above + `--fix-delta` | **Fix-delta mode** — read the prior review artifact, resume each reviewer via `SendMessage` (Phase 3-alt) to verify the author's revisions rather than re-reviewing from scratch |

---

## Phase 1 — FETCH

### PR mode
```bash
gh pr view <NUMBER> --json number,title,body,author,baseRefName,headRefName,changedFiles,additions,deletions
gh pr diff <NUMBER> --name-only
```
If the PR is not found, stop with an error.

Pull the changed planning files at PR head (markdown/text only).

**Filter the changed-file list to markdown / planning docs.** If the PR also contains code (`*.py`, `pyproject.toml` logic changes), stop and tell the user this command is for planning PRs — use `/code-review` instead.

### Local mode
If the argument is a directory, read every `.md` in it. If a file, read it.

### Sanity gate
Confirm the input is genuinely a planning artifact, not code. A planning artifact typically lives under `docs/`/`plans/`, contains phases/slices, file-path proposals, and a testing strategy, and has no `.py` siblings in the changeset. If it doesn't look like planning docs, **abort**: "This command is for planning documents. For code review, use `/code-review`."

---

## Phase 2 — CONTEXT

Build the shared brief the reviewer agents will need. Read these yourself (the orchestrator) so you can hand each agent a compact summary; the agents will *also* read source files directly as needed.

1. **Project profile** — `cli-review-profile.md` (output contract, hard rules, accepted trade-offs, architecture-doc pointers).
2. **Project rules** — `AGENTS.md` / `CLAUDE.md` if present.
3. **Manifest** — `pyproject.toml` (and/or `setup.cfg` / `setup.py` / `requirements*.txt`), including `[project.scripts]` entry points and optional-dependency extras, so the reality-checker's package/dependency claims have a baseline.
4. **The plan docs themselves** — every file the PR/path touches, read in full.
5. **PR metadata** — title, body, linked issues (PR mode only).

Cache these as a short "shared brief" so the agents don't all re-read the same thing.

---

## Phase 2.5 — GREENFIELD CHECK (gates the reality-checker)

`plan-reality-checker` verifies the plan's claims against an **existing** codebase. On a **greenfield** plan there is no codebase yet — the plan is almost entirely "we will create X," so the reality-checker has nothing real to verify and would misfire (treating proposed-to-create files as "missing"). So determine which case you're in **before dispatch**:

The plan usually names a build target (e.g. an architecture doc line like `Build target: …/arc-GIS-cli`). Check whether that target's package/project already exists:

```bash
# greenfield if the planned project doesn't exist yet (no manifest in the target tree):
{ test -f <target>/pyproject.toml || test -f <target>/setup.py || test -f <target>/setup.cfg; } \
  && echo "BROWNFIELD" || echo "GREENFIELD"
# fallbacks when the plan names no explicit build target:
#   - the proposed package path has no git history → greenfield for that area:
git log --oneline -1 -- <proposed/package/path> 2>/dev/null | grep -q . && echo "BROWNFIELD" || echo "GREENFIELD"
#   - or: every source path the plan proposes is new (nothing to verify against) → greenfield
```
If the signals disagree (e.g. a new sub-package inside an existing project), treat it as **brownfield
but scope `plan-reality-checker` to the pre-existing surfaces only** — it verifies claims about what
already exists and ignores the proposed-to-create files.

- **GREENFIELD** (no existing target manifest / source tree): **do NOT dispatch `plan-reality-checker`.** Record in the report: "reality-checker skipped — greenfield; no existing codebase to verify claims against." Dispatch the other three agents.
- **BROWNFIELD** (the plan extends an existing CLI; target manifest/source exists): dispatch all four agents including `plan-reality-checker`.

State the determination (GREENFIELD/BROWNFIELD) explicitly in the report header.

---

## Phase 3 — DISPATCH (parallel fan-out)

Send all dispatched agents in a **single message with multiple `Agent` tool calls** so they run concurrently. Each agent gets: the plan-doc paths, a pointer to the shared brief (`cli-review-profile.md`, the manifest, plan docs), the PR title/number, and the GREENFIELD/BROWNFIELD determination from Phase 2.5.

| Agent | Model | Dispatch | Question it answers |
|---|---|---|---|
| `plan-architect-reviewer` | opus | always | Does the proposed approach fit this Python CLI's architecture? |
| `plan-quality-checker` | sonnet | always | Is this plan executable as written? |
| `plan-test-spec-analyzer` | sonnet | always | Would the specified tests catch real regressions, and does every ADR / Hard rule have a red-line test? |
| `plan-reality-checker` | sonnet | **brownfield only** (skip on greenfield, per Phase 2.5) | Do the plan's claims about the existing repo match reality? |

`plan-test-spec-analyzer` reviews the TDD spec / testing strategy for *design quality* (the planning mirror of code-side `python-test-analyzer`); `plan-quality-checker` owns test *presence/alignment* — keep the lanes distinct. If the plan has no test spec, `plan-test-spec-analyzer` reviews the testing-strategy sections and flags the absence.

Each returns findings in the standard severity-tagged format with the Pre-Report Gate enforced.

**Do not run them sequentially.** One message, N `Agent` blocks (3 on greenfield, 4 on brownfield).

### Capturing agent IDs for fix-delta
The `Agent` tool returns an `agentId`. **Capture every dispatched agent's ID** and write them into the report under `## Agent IDs` (Phase 6) so a later `--fix-delta` run can resume the same reviewers with their plan context intact. If the harness doesn't expose `agentId`, omit the section; fix-delta falls back to a fresh review.

---

## Phase 3-alt — DISPATCH (fix-delta mode)

Triggered by `--fix-delta`. The plan author has revised the docs (one or more commits) in response to a prior review. Skip Phase 3's fresh fan-out. Instead resume the **same agents** that produced that review — they carry the plan's full context, so they verify their *own* findings (referencing their original wording) instead of re-deriving, and they catch any regression the fixes introduced. This is faster and higher-fidelity than a fresh review.

**Fix-delta requires the prior review artifact.** Read the latest review for this plan in `docs/plan-reviews/` (the initial `…-plan-review.md` / `local-…​.md`, or the most recent `…-fixes-review*.md`). If it has no `## Agent IDs` section, **abort**: "No stored agent IDs in the prior review — run the initial `/plan-review` first," and offer a fresh re-review as fallback.

1. **Identify the delta.** Find the SHA the prior review covered (its header records the reviewed state / last fix commit). Run `git log <prior-sha>..HEAD --oneline` and `git show <sha> -- <plan-dir>` to capture exactly what changed.
2. **Map findings → fixes.** For each agent, build a table of its prior findings → the commit/hunk that addresses each (or "deferred").
3. **Scope the fan-out — resume only lanes with a stake.** A lane whose findings were *all* closed in a prior round **and** whose surface the new commits didn't touch needs no re-dispatch — carry its prior verdict forward and say so in the report. (Mirrors the initial-mode rule: skip a lane when its surface didn't change. Don't burn an agent re-confirming untouched work.)
4. **`SendMessage` each resumed agent in parallel** — single message, multiple `SendMessage` blocks, each addressed by its stored `agentId` — with a focused brief:

```
Fix-delta review (plan-review)[ round N]. The author revised the docs in commit(s) <sha…> responding to your findings. Re-read the revised docs at <paths> and verify each of YOUR findings is CLOSED / REGRESSED / DEFERRAL-JUSTIFIED — and flag any NEW problem the fixes introduced. Exact diff: `git show <sha> -- <plan-dir>`.

## Your original findings → claimed fix
<table: finding | severity | claimed fix | what to verify>

## Also scrutinize (new decisions the fixes introduced)
<the design changes the fix added — a new type, a collapsed variant, a renamed/removed test — so a fix doesn't quietly open a new gap>

## Output
Title "## <Lane> Summary (Fix Delta[ Round N])". Per-finding: CLOSED / REGRESSED / DEFERRAL-JUSTIFIED + one-line cite. NEW findings listed separately, severity-tagged, Pre-Report Gate applies. End with a verdict and "Tally: C=<n> H=<n> M=<n> L=<n>" for NEW findings only.
```

If one commit touches multiple agents' findings, each agent gets the same SHA — expected; each evaluates from its own lens. **Cross-lane convergence** (two resumed lanes independently flag the same fix-introduced root cause) is a strong confirmation signal — surface it in Phase 4.

---

## Phase 4 — AGGREGATE

1. **Dedupe** — findings hitting the same doc line from two angles merge; keep the highest severity, list both perspectives.
2. **Surface conflicts** — if `plan-architect-reviewer` says "this approach is wrong" while `plan-quality-checker` says "but it's well-specified," that conflict belongs at the **top** of the report as an explicit "Disputed" section. Conflicts are usually more important than agreed findings.
3. **Rank by severity**, then by doc and line.
4. **Tally** per severity per agent.

---

## Phase 5 — DECIDE (strict mode)

| Condition | Decision |
|---|---|
| Any CRITICAL | **BLOCK** — revise the plan before implementation |
| Any HIGH (no CRITICAL) | **REVISE** — address before implementation |
| Only MEDIUM / LOW | **APPROVE** with comments |
| Zero findings | **APPROVE** (a clean review is valid) |

Planning issues that survive into implementation cost ~10x more. A REVISE is the cheap version. **Special cases:** draft PR → still decide, soften framing. **Fix-delta:** a NEW HIGH/CRITICAL *introduced by the fixes* flips the decision back to REVISE/BLOCK (the original finding was right but the revision regressed — don't paper over it). The aggregate decision is the strictest across the resumed lanes plus any carried-forward verdicts.

**Agent conflicts — adjudicate, don't reflex-escalate.** Opposing positions go to the "Disputed" section. If the conflict is **factual** (a checkable claim about the plan or the repo — "the doc contradicts itself at X", "the cited class already exists"), the orchestrator **verifies it** (read the doc lines, Grep the repo) and adjudicates; a claim shown false becomes an advisory note, not an auto-REVISE. Escalate to ≥REVISE only for a genuine **judgment split** that verification can't settle (e.g. architect says "wrong approach" while quality-checker says "well-specified" — that's a real, unresolvable-by-fact split → REVISE).

---

## Phase 6 — REPORT

Create the artifact at `docs/plan-reviews/pr-<NUMBER>-plan-review.md` (PR mode) or `docs/plan-reviews/local-<YYYY-MM-DD>-<slug>.md` (local mode). Create `docs/plan-reviews/` if absent.

```markdown
# Plan Review: <PR #N or local path> — <TITLE>

**Reviewed**: <YYYY-MM-DD>
**Branch**: <head> → <base>   (PR mode)
**Project type**: GREENFIELD (reality-checker skipped) | BROWNFIELD
**Docs reviewed**: <count> files (<list>)
**Decision**: BLOCK | REVISE | APPROVE
**Conflicts surfaced**: <count>
**Test-spec coverage**: <M>/<N> critical behaviors (ADRs / Hard rules) pinned by a red-line test
**Plan grounding**: <N>/<M> reality-checker claims verified against the codebase  (BROWNFIELD only; "n/a — greenfield" otherwise)

## Summary
<2-3 sentences. Lead with the decision rationale.>
<Second paragraph: state plan grounding as a confidence statement — the reality-checker's "N of M verifiable claims check out" is the single strongest statement of a plan's accuracy. If N=M, say so plainly; if N<M, name the failed claims in a phrase.>

## Disputed Findings (Agent Conflicts)
<Findings where two agents took opposing positions. Highest priority. Or "None.">

## Findings

### CRITICAL
<list or "None.">
### HIGH
<list or "None.">
### MEDIUM
<list or "None.">
### LOW
<list or "None.">

## Per-Agent Tallies

| Agent | CRITICAL | HIGH | MEDIUM | LOW |
|---|---|---|---|---|
| plan-architect-reviewer | N | N | N | N |
| plan-quality-checker | N | N | N | N |
| plan-test-spec-analyzer | N | N | N | N |
| plan-reality-checker | N | N | N | N  (or "skipped — greenfield") |
| **Total (after dedupe)** | **N** | **N** | **N** | **N** |

## Files Reviewed
<list with line counts>

## Next Steps
<contextual suggestions based on decision>

## Agent IDs
<!-- Used by /plan-review --fix-delta to resume reviewers via SendMessage. Omit this section if the harness doesn't expose agentId. -->
- plan-architect-reviewer: <agentId or "not dispatched">
- plan-quality-checker: <agentId or "not dispatched">
- plan-test-spec-analyzer: <agentId or "not dispatched">
- plan-reality-checker: <agentId or "skipped — greenfield">
```

Each finding entry:
```
[SEVERITY] <short title>
Source agent: <agent-name>
Doc: <path>:<line range>
Issue: <concrete failure mode at implementation time>
Fix: <specific change to make>
```

### Fix-delta mode → `docs/plan-reviews/<base>-fixes-review.md` (and `-fixes-review-round2.md`, … for later rounds)
Write a **separate, self-contained** artifact (the implementing instance shouldn't need to reread the original). Include: the decision; the fix commit SHA(s) reviewed; each resumed agent's findings → **CLOSED / REGRESSED / DEFERRAL-JUSTIFIED** with one-line cites; any **NEW** findings the fixes introduced (severity-tagged, full entry format); **carried-forward verdicts** for lanes that weren't re-dispatched (and why); an updated test-spec coverage count; a **cumulative status table** across all passes (initial → each fix round); and a refreshed `## Agent IDs` so the *next* round can resume again. Name successive rounds `-fixes-review.md`, `-fixes-review-round2.md`, ….

---

## Phase 7 — OUTPUT

Report back in the terminal turn (not just the artifact):
```
<PR #N or local path>: <TITLE>
Decision: <BLOCK|REVISE|APPROVE>

Findings: <C> critical, <H> high, <M> medium, <L> low
Conflicts: <count> disputed
Docs reviewed: <count>

Artifact: docs/plan-reviews/<file>

Top 3 things to address:
  1. <highest-impact finding>
  2. <next>
  3. <next>
```
Keep it tight — full detail is in the artifact.

### Fix-delta
```
<plan path or PR #N>: <TITLE> — Fix Delta[ Round N]
Decision: <BLOCK|REVISE|APPROVE>

Closed: <count>/<original>   New: <count>   Carried: <lanes not re-dispatched>
Test-spec coverage: <M>/<N> critical behaviors pinned
Artifact: docs/plan-reviews/<file>
<one-line state — "ready to implement" or "one more pass: <thing>">
```

---

## Edge Cases

- **No `gh` CLI**: PR mode falls back to instructing the user to check out the branch locally and re-run with the docs directory path.
- **Mixed PR (code + plans)**: Stop — this command is for planning-only PRs; use `/code-review`.
- **No `docs/plan-reviews/`**: Create on first run; committing is the user's call.
- **Agents return errors**: Continue with the agents that succeeded; surface the failure in the summary.
- **Empty plan PR (rename/move only)**: Approve with a note — nothing substantive to review.
- **Fix-delta with no stored agent IDs**: Fall back to a fresh initial review; warn the user the plan context will be re-derived (slower, possibly a different verdict).
- **Fix-delta finds a new HIGH/CRITICAL introduced by the fixes**: Decision back to REVISE/BLOCK — the revision regressed; don't paper over it (see Phase 5).
- **Multiple fix rounds**: Resume from the *latest* artifact's `## Agent IDs`; name each round `-fixes-review-roundN.md`; the cumulative table carries every prior pass.
- **A lane with no stake in the delta** (all its findings closed, surface untouched by the new commits): don't re-dispatch — carry its prior verdict forward and note it.

---

## Confidence Rule (inherited by every agent)

Every dispatched agent runs with: confidence ≥ 80% before reporting; the Pre-Report Gate (cite exact doc line, name the concrete failure mode, prove HIGH/CRITICAL with snippet + scenario); and "zero findings is a valid clean review." If the agents return noise, tighten the agent persona files — don't relax the gate.
