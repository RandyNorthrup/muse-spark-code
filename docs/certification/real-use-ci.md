# Real-use CI (workflow that spends the Meta key secret) — 2026-10-17

Lane REALUSECI, branch `ci/real-use`. Outcome: `.github/workflows/real-use.yml`
(`workflow_dispatch` only), run by the owner by hand, driving the real packed
product from any ref against the real provider on the contributor model by its
explicit name, under a dollar cap and an expected-calls guard, publishing a
transcript artifact. No local server, recorded fake or mock anywhere.

## Jobs

| Job       | What it does                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package` | Checks out the input ref, `npm ci`, `npm run package:acp`, records commit/name/SHA-256, uploads the tarball (`muse-spark-code-acp-real-use`, 30 days).                                                                                                                    |
| `realuse` | Verifies the tarball is the ref's commit (name + SHA-256 match), plants the `BASH_ENV`/`ENV`/`NODE_OPTIONS` startup traps, runs one trusted launcher step that holds the key, then writes the receipt summary and runs the check script. Uploads the transcript artifact. |

One paid run at a time (`concurrency: real-use`, no cancel), Ubuntu, job
timeouts 20/30 min.

## Inputs (`workflow_dispatch` only)

| Input            | Meaning                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ref`            | Git ref to test (branch, tag or SHA). The workflow file itself always runs from the default branch; only the product package comes from this ref.                                                                                                                                                |
| `steps-file`     | Path in the repository, under `docs/real-use/`, default `docs/real-use/rc-2026-10-17.json`. Each step names one `exec` prompt (plus `plan`/`acceptEdits` mode) and the text a person must see. Read from the ref's tree as untrusted prompt data, exactly as the live Action treats the PR diff. |
| `expected-calls` | Stated number of model calls. The launcher passes the remaining calls as `--max-requests` to every step and stops before a step that would pass the count.                                                                                                                                       |
| `max-budget-usd` | Hard dollar cap (default `1.00`, the contributor recipe in `docs/ci.md`). The launcher passes the remaining dollars as `--max-budget-usd` to every step; the product's own ledger enforces it.                                                                                                   |

## Key handling (action-live.yml pattern, kept exactly)

Pinned actions, `contents: read` (+ `pull-requests: read` nowhere needed —
no PR), every checkout `persist-credentials: false`, owner-only gate
(`actor == owner && triggering_actor == owner && ref == default branch`) on
both jobs. Only the launcher step receives `secrets.MUSE_MODEL_API_KEY` in
one variable; the launcher deletes it before any child starts, masks it,
holds it in memory only, clears it in `finally`, and sends it over private
stdin solely to `exec --key-stdin` children (prompts travel by
`--prompt-file`: stdin prompt conflicts with `--key-stdin`). Nothing is
written to a file or a log; the transcript carries counts, dollars and prose
only, never the key. The check step asserts no trap fired and no key-shaped
or sentinel string in any published file.

## Calls and dollars from the product's own records

Every step runs `exec --output json`; the launcher sums
`result.usage.requests` and `result.usage.costUsd.total` across steps and
compares against the stated inputs in the transcript (PASS/FAIL per step:
completed, exit 0, expected text present in the final message — the full
prose is kept so a person can overrule).

## Tonight's steps file

`docs/real-use/rc-2026-10-17.json`. The brief names its source as
`docs/certification/rc-2026-10-17.md` §4 on `train/rc-2026-10-17`: **that
branch and file are not in this worktree** (no remotes configured; `git log
--all` has no rc commit), so the lead's train run-in will confirm or replace
the steps. Until then the file carries the CLI/ACP-runnable subset closest to
a recorded real use: the `quince` one-word turn from
`docs/real-life/pr176-2026-10-17.md` (empty workspace, contributor model),
one `acceptEdits` file-writing turn in the empty workspace, and one refusal
probe (`--max-budget-usd` below the model minimum, refused before dispatch,
0 requests). Expected calls and cap stay workflow inputs, not file contents.

## First dispatch must show

`realuse` summary: ref commit, package name + SHA-256, steps file, per-step
PASS/FAIL with the visible prose, stated vs actual calls and dollars, model
`muse-spark-1.3-contributor`, breach false, transcript artifact name; check
step green.
