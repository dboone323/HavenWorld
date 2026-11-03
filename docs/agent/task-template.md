# Standard task template

Every dispatched task is expanded into this shape before it reaches an agent.

## Header

**Type:** Goal / Problem / Feature
**Objective:** one sentence
**Done when:** the checkable end state

## Context

The goal, repo state (branch / HEAD), relevant files, and prior decisions the
agent cannot see from the repo alone.

## Scope

- **In:** exactly what this task covers.
- **Out:** everything else. Out-of-scope finds become GitHub issues with
  evidence, not extra work in the current PR.

## Acceptance criteria

Observable, testable statements. For a Problem: the red/green pair that proves
the fix. For a Feature: the live behavior a person can click through.

## Gate sequence (mandatory ending)

1. Targeted tests for the changed area.
2. Live smoke where applicable (real browser, real clicks).
3. Full gate: `make ci-docker`, run solo, full output saved to a log file in
   the repo.
4. Lint totals read from that log.

## Report format

- Files changed.
- Gate totals recomputed from the raw log (not from the terminal summary).
- Log scan: errors counted separately from test failures.
- Screenshots / artifacts where the task produced them.
- Leftovers and scope check: anything found but not done, with its issue
  number.

## Git

Branch per task; PR on the first commit; update the same PR with later
commits; no merges (Daniel's only); `Fixes #n` when the PR closes an issue.
Always `git --no-pager`, bounded output, bounded-timeout pushes.
