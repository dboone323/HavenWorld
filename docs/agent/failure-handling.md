# Failure handling — from error to issue to PR

## When a gate, build, or test fails

1. Stop. Read the actual log; identify the failing step and the failure
   signature (test name / error class / gate step).
2. Search open GitHub issues for the same signature.
   - **Found:** comment with the new evidence (run date, log excerpt, PR or
     branch link). Do not duplicate the issue.
   - **Not found:** file one issue — `[Problem]` title, `type: problem` +
     `gate-failure` labels; body: the exact command run, the failing step, a
     log excerpt, and a link to the PR or branch.
3. Warnings are different: lint warnings update the single standing
   `tech-debt` issue. They never spawn new issues.
4. Report the failure as-is. Never weaken, skip, or gate a test to get green.

## Classification

- **Test failure (assertion):** a real signal until proven flaky. Flaky means:
  the same test passes solo twice and fails in the suite, with timings
  recorded in the issue.
- **Log errors with zero failed tests:** still a failure. Counts are not the
  log — file it.
- **Environment failure (Docker, network, credentials):** name the layer that
  failed. One bounded retry at most, then report; never retry in a loop.
- **Blocked harness / tooling:** files as its own `[Problem]` (issue #16 is
  the pattern).

## Triage

- **now** — blocks a merge or a deadline.
- **next** — scheduled this cycle.
- **backlog** — everything else.

WIP limits: max 3 active fix branches, about 5 open PRs. At the limit,
finishing work outranks starting new work.

## Follow-ups

A new problem found while reviewing or verifying a fix becomes a NEW issue
labeled `follow-up`, linked to the original issue. The current PR's scope
does not grow.

## Deploy failures

Same flow, label `deploy`, and the deploy stops until Daniel decides.
