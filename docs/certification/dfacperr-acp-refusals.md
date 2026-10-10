# Certification: DFACPERR — ACP reports refusals honestly, not as "Internal error"

Lane DFACPERR, branch `fix/acp-refusal-honesty`, from 82d50d5e4 (v0.17.0).
Scope is the lane brief (no PLAN milestone text exists for it; the brief is the spec).

## What was wrong

The ACP SDK turns any non-`RequestError` thrown by a request handler into
`-32603 Internal error`, dropping the message. The agent threw plain `Error`s
for product-defined refusals (empty share) and used `RequestError.internalError`
for typed refusal/unavailable states, so clients saw `Internal error: Accounts
are unavailable…`, `Internal error: The broker cannot start…`, and a bare
`Internal error` for an empty new conversation's share.

## Fix (no new strings; no new commands, settings or features)

- `src/acp/agent.ts`: new `refusalError()` helper (`RequestError.invalidRequest`,
  -32600, carrying the refusal's own message). Nine sites converted from
  `internalError`: `accountRequestError`'s unavailable branch, `acpNoModels`,
  `legalScanUnavailable`, both `accounts.unavailable` sites (prompt `/accounts`
  and `set_config_option`), both `vault.brokerBlocked` sites (absent binding
  and failing command), `answerNotAccepted`, and `requireReady`'s unavailable
  branch (covers `session/new|load|resume|list` and `authenticate`).
  `startAccounts()` now maps a dead account service through `accountRequestError`,
  so a failing `session/new` setup reports the refusal instead of `-32603`.
- `src/acp/sharing.ts`: `createAcpSharing().execute` shapes its own errors.
  Argument failures (bad flags, unknown actions, another session's chat) become
  `-32602 invalid params` with their reason; the product's sharing refusal
  sentences (including `exportNothing`, the CLI's "There is no conversation to
  export yet.") become `-32600` with that sentence. Anything unrecognized
  rethrows, so an unexpected failure still surfaces as internal error with no
  message leaked.

Deliberately unchanged: `questionQueueCommitFailed`, backend turn-failure
reasons and `hostExited` (genuine internal failures, not defined refusals);
schedules/estimate/reports/playbook-unbound paths (already honest chat text,
not errors); backend I/O errors in `hostFor`/`resumeSession`/etc. (genuine
internal from ACP's view); `getQuestions()`' declined-registry throw
(unreachable: every caller guards on the registry, verified by inspection).

## Tests (repository timeouts, no `--testTimeout`)

New, per handler (`-32600` + message unless noted):

- `test/unit/acpAgent.test.ts`: unbound `/accounts` prompt and account option;
  `session/new` with zero usable models; failing `/legal` scan; backend
  refusing a turn (`answerNotAccepted`); `authenticate` on unavailable backend.
- `test/unit/acpSharing.test.ts`: empty share (CLI sentence), confidential
  workspace, three bad-argument cases (`-32602`), cross-session share
  (`-32602` + `Unknown argument`).
- `test/unit/acpAccounts.test.ts`: dead account service fails `session/new`
  with the refusal.
- Updated pins: auth/readiness (`-32603` → `-32600`), two unbound-account
  assertions, unavailable-selection code, vault refusal strengthened to
  code + message.

Results (macmini, this worktree): acpSharing 33/33, acpAccounts 29/29,
acpVault 20/20, acpAgent 145/146. The one failure
(`exposes all three ChatGPT actions…`, `chatgpt-status` verify rejecting
"temporarily unavailable") also fails on pristine HEAD 82d50d5e4 in a
separate worktree, so it is pre-existing and unrelated.

## Red drills (byte-exact restores, SHA-256 verified)

1. Restored `requireReady` to `internalError`: the auth test failed as
   expected; file restored to
   `510bc12d670838997813d533cef22f2e081eaa667fdcfa02a0c5ff30cc275940`.
2. Removed `exportNothing` from the sharing refusal set: the empty-share test
   failed as expected; file restored to
   `97c8b3406fa7408e7f9e66ec3d794daf875c6b02864c0b6aed148e69339be48d`.

## Gates

`tsc -p tsconfig.json --noEmit` 0; `eslint --max-warnings=0` on changed files
0 (one `unicorn/prefer-ternary` and one `no-empty-function` fixed, plus a
`consistent-function-scoping` refactor that also cleared `jscpd` back to
0 clones); `prettier --check` clean; `check:l10n` 0 problems (no new text);
`check:host-api` 0 problems; `npm run build` exit 0, all budgets ok
(`dist/acp.js` 477.2 KiB); `deadcode` exit 0.

## Notes for the lead

- No `featureCatalog`/reference change: no new command, setting or feature.
- No PLAN.md section exists for this lane; CHANGELOG `[Unreleased] → Fixed`
  carries the entry. README untouched (no user-visible surface change beyond
  honest error text).
- The common.md merge step (`integrate/m72-on-24ff`) was skipped: the rig note
  forbids merges the brief does not list, and this brief lists none.
- Editors/OS: the change is ACP-protocol-level (SDK JSON-RPC shapes) and
  locale-reads at use time, so every editor and Windows/macOS/Linux get it;
  no path comparisons were added.
