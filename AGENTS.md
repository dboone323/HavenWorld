# HavenWorld — Agent Guide

Single source of truth for every AI agent and tool working in this repo
(Cline, Antigravity, GitHub Copilot, Hermes, Ollama-driven sessions, Monarch).
Per-tool shim files point here; if a shim and this file disagree, this file wins.

## The project

- Browser game. Monorepo: `apps/client` (BabylonJS + Vite + TypeScript),
  `apps/server` (Express + Socket.IO + Prisma / Supabase Postgres),
  `packages/shared`.
- Live client: https://havenworld-game.pages.dev
- Server health: https://147-224-184-148.nip.io/health
- Local repo: /Users/danielstevens/Developer/HavenWorld · GitHub: dboone323/HavenWorld

## The loop (how all work moves)

1. **Build** — one branch per task, named `feat/<slug>`, `fix/<slug>`, or
   `chore/<slug>` (include the issue number when there is one, e.g.
   `fix/18-chibi-flag-default`). Open the PR on the first commit; update the
   same PR with later commits.
2. **Test** — the canonical gate is `make ci-docker` (5 steps: client lint,
   client tests, client build, server lint, server tests). It is the whole
   definition of "tests pass" in this repo.
3. **Issue** — a gate failure, error, or out-of-scope problem becomes a GitHub
   issue (rules below) instead of a chat message that gets lost.
4. **Triage** — now / next / backlog. WIP limits: max 3 active fix branches,
   about 5 open PRs. At the limit, finishing outranks starting.
5. **Fix → PR** — the PR body carries the evidence and `Fixes #n` when it
   closes an issue.
6. **Review** — Daniel reviews and merges. **No agent merges, ever.**
   A new problem found in review becomes a new issue labeled `follow-up`,
   never scope creep inside the PR.
7. **Deploy** — only from `main`, only via `make deploy-server-quick` /
   `make deploy-client`, only with Daniel's explicit go. A deploy failure
   files an issue labeled `deploy`.

## Typing rule (every prompt, every issue)

State the type up front, with an objective and done criteria:

- **Goal** — an outcome to reach; done when the end state itself is verified.
- **Problem** — something broken; done when there is red/green proof (the
  failing test or reproduction first, then passing), a regression test, and a
  green gate.
- **Feature** — something new; done when it works live in the real product
  (actually clicked through in a real browser, not just unit-tested), plus
  tests and a green gate.

Titles read `[Goal] ...`, `[Problem] ...`, `[Feature] ...` with matching
labels `type: goal` / `type: problem` / `type: feature`.

## Issue rules

- One issue per distinct failure signature. Before filing, search open issues
  for the same signature; if one exists, comment there instead of duplicating.
- Labels: the `type:` label above, plus area labels as they apply:
  `verification`, `ops`, `security`, `flow`, `gate-failure` (from the gate),
  `tech-debt`, `follow-up`, `deploy`.
- Lint warnings never get individual issues: they roll into one standing
  `tech-debt` issue.
- Every issue states: what failed, the exact command, the failing step, and a
  log excerpt. No issue without evidence.

## Gate discipline

- Gates run **solo** — never two heavy runs at once (overlapping runs caused
  a Docker out-of-memory failure on 2026-10-30). Before starting, check for
  running builds/gates and wait for them to finish.
- Save the full gate output to a log file and read it back. Report totals
  from the log, never from memory or from a summary. Zero failed tests is
  not zero errors — scan the log for errors separately.
- Never skip the gate (`PUSH_CI_SKIP` and friends are forbidden), and never
  skip, gate, or weaken a test to force a green run. A failing or flaky test
  is reported as-is; the decision about it is Daniel's.
- Git commands: always `git --no-pager`, bounded output, bounded-timeout pushes.

## Evidence standard

- "Done" is a claim about the world, not the diff. Verify from the actual
  file, log, screenshot, or live product — never from another agent's summary.
- If you report that you wrote, appended, or changed something, re-read it
  and confirm before reporting.
- Features are verified by using them: real clicks through the real UI.

## Hard rules

- No agent merges a PR. No agent deploys without Daniel's explicit go.
- No secrets in code, issues, PRs, or chat. Credential values are never
  written down; rotations happen in the provider's dashboard.
- Free models only in Cline (Free tab; "Input: Free / Output: Free").
  Never enable usage-based billing or click "Add Credits".
- Stay inside the task's scope. An out-of-scope find becomes an issue, not
  extra work in the current PR.

## Current state pointers (update as these close)

- GitHub Actions cannot execute on this account (all runs stuck at Queued;
  appeal pending). Until that changes, the local `make ci-docker` gate IS
  the CI. When Actions runs again, the pr-check workflow takes over the
  test step and a workflow step auto-files gate failures.
- Open queue: issues #15–#25 (Nov 3, 2026) hold the current backlog;
  PRs #11–#14 hold the current merge queue.

## How each tool loads these rules

| Tool | File | Notes |
| --- | --- | --- |
| Cline | `.clinerules` | Shim: core rules + this file |
| GitHub Copilot | `.github/copilot-instructions.md` | Shim: core rules + this file |
| Antigravity | `AGENTS.md` natively + `.agents/rules/havenworld-loop.md` | Shim references this file |
| Hermes | `AGENTS.md` natively | No shim — do NOT add `.hermes.md` (it would override this file) |
| Ollama sessions | via Cline | Uses Cline's `.clinerules` |

Task briefs follow `docs/agent/task-template.md`; failure handling and the
report format live in `docs/agent/failure-handling.md`.

## Long-run protocol (no timer polling)

Runs that take minutes (gates, builds, deploys) are never watched on a timer.

1. **Sentinel + exit code.** Every long-running command writes its log to a fixed path AND, on completion, a sentinel file beside it (`<log-name>.done`) containing the exit code and a completion timestamp. The gate/report scripts write the sentinel themselves; ad-hoc runs wrap the command so the sentinel is written on both success and failure.
2. **Blocking waits only.** A supervisor that must wait makes ONE blocking wait for the sentinel, sized to the run's expected duration (gates: ~7–10 min). Polling on a 30-second (or any short) timer across model turns is prohibited — each poll burns a full model turn to learn nothing.
3. **Checkpointed reports.** The worker writes a checkpoint line to the task's report file at each phase boundary (RED done / implementation done / gate started / gate done with totals) and the completion section as its final action. The supervisor reads the report when the worker's turn ends — the turn ending is the completion event.
4. **Failure reading.** If a run dies mid-phase, diagnose from the last checkpoint + the log tail. Never re-run just to watch it.
