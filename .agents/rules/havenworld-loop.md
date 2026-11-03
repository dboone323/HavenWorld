# HavenWorld loop rules (Antigravity)

The full rules live in the repo-root `AGENTS.md`, referenced here:

@../../AGENTS.md

Core rules, in force even if the reference is not followed:

- Canonical gate: `make ci-docker` (5 steps). Gates run SOLO — check for
  running builds/gates first and wait. Save the full gate output to a log
  file and report totals from the log.
- Never skip the gate (no PUSH_CI_SKIP), and never skip, gate, or weaken a
  test to force a green run.
- Every task and issue is typed: [Goal], [Problem], or [Feature], with an
  objective and done criteria. Problems need red/green proof plus a
  regression test. Features must be verified live in the real UI.
- Branch per task (`feat/`, `fix/`, `chore/` + slug). PR on the first
  commit; update the same PR afterwards. Never merge a PR — merges are
  Daniel's only.
- A failure or out-of-scope problem becomes a GitHub issue (one per distinct
  failure signature, evidence + log excerpt required). Lint warnings roll
  into the standing tech-debt issue.
- No secrets in code, issues, PRs, or chat. No deploys without Daniel's
  explicit go.
- Verify from files, logs, and the live product — never from summaries.
