# RLF-QUOTA certification — a spent subscription window is said honestly, with its reset

Lane RLF-QUOTA, recovery release. Worktree
`/Users/user/lanes/RLF-QUOTA`, branch `rec/rlf-quota`, from
int/recovery at `0a5ebd718` (CC-INT5). Rig `macbook`.
Built 2026-10-31.

Decision number: the decision this record calls D229 is **D252** on int (numbered
D229 on its branch; CC-INT6 gave D229 to RLF-MUSESETUP; renumbered by CC-INT8,
2026-10-31). The same renumbering is in PLAN.md and in the code comments the
lane added.

Expected call count, stated first: 1 model request on
`muse-spark-1.3-contributor` by its explicit name, for the packed-ACP
normal-path proof. Spent: 1. No other paid or live call anywhere in
this lane; the quota path itself is proven fixture-first and never by
exhausting a window.

Found by the lead, 2026-10-30, in every Muse lane at once (the
published 0.19.0 ACP agent driven over ACP): each turn ended with the
JSON-RPC error message, verbatim, `Internal error: API error 429
[request_id=e7eccfac-6e60-4252-8972-babf4e1d672e]: Subscription
quota exhausted. Your usage window resets at
2026-10-30T19:42:18Z. (rate_limit_error)`. A known, timed condition
answered as an internal error (-32603), the reset buried in text,
nothing a client can act on.

## What landed

| Change                                            | Commit      | Shape                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D252 + milestone + roadmap entry                  | `ed87a9c29` | PLAN.md §2 decision, §6 status; ROADMAP regenerated (245 entries)                                                                                                                                                                                                                                                                  |
| Fixture, wire detail, shared words, l10n          | `bb9724563` | `test/fixtures/musecode-quota/observed-acp-error.json` with provenance; `quota` on `turnCompleted`/`turnRetry` (`src/shared/agentEvents.ts`); CLI mapping (`mapNotification.ts`); `quotaTurnFailureText`/`quotaWaitText` (`src/shared/turnFailure.ts`); `-32014` (`ACP_ERROR_CODES.quotaExhausted`); 2 keys in English + 14 tables |
| Panel words, no resend, opt-in continue + setting | `7e63c8f6f` | Error/announcement rows (`src/webview/state/uiState.ts`); `holdForQuotaReset` + quota-aware resend wait (`conversationController.ts`); `museSpark.museCodeQuotaContinue`, default off, machine scope, through settings/compose/package/catalogue/reference/README                                                                  |
| ACP error, outbound gate, docs                    | `f1ccf345a` | `turnFailureError` quota branch; `quota_exhausted` kind with `retryable` + `resetsAt` (`src/acp/agent.ts`); wire contract tests; `docs/acp.md`                                                                                                                                                                                     |
| Exec/CLI/headless words + envelope                | `9bac9ea3f` | `execQuotaOutcome` in `src/runtime/exec/runExec.ts`                                                                                                                                                                                                                                                                                |
| MHP 1.5.1 carries the quota detail                | `cc3e845a0` | D226 adoption (`--adopt-version=mhp/1.5.1`); schemas + locks regenerated; contract tests; README + panel doc                                                                                                                                                                                                                       |
| CHANGELOG                                         | `7415c77bb` | Added + Fixed entries in the person's words                                                                                                                                                                                                                                                                                        |
| One resend arm, one shared live-turn rig          | `deae0cd14` | `armResendWait`; `test/unit/helpers/museLiveTurn.ts`; 0 clones                                                                                                                                                                                                                                                                     |

## Quota semantics, as shipped (D252)

- A spent subscription window is its own turn outcome — never
  "internal" (-32603), never transient. Detected only by the CLI's
  typed `TurnError.quota` (verified in the CLI 1.4.10 offline schema
  export); presence-only branching; the instant must be usable
  (`Number.isFinite`, `>= 0`) so no `Invalid Date` ever surfaces.
- Every surface says it in words with the reset in the person's local
  time: the panel error row and announcement, the ACP error message,
  exec stderr and result envelope. The raw 429 (`request_id`,
  `rate_limit_error`) is never shown. A 429 without a reset stays
  what it is today.
- The ACP error carries machine-readable data:
  `data = {kind: quota_exhausted, resetsAt: ISO, retryable: false}`
  on code `-32014`, so a client can wait until the reset.
- Automatic resend never fires before the reset. "Continue when the
  window resets" is the person's opt-in (`museCodeQuotaContinue`,
  off by default, machine scope, live-read at the decision and
  mid-wait): it waits the whole provider interval (`max(0,
resetsAtMs - now())`, no cap of ours — a past reset waits 0 ms,
  Stop aborts), then resubmits once through the resend path bounded
  by the person's `museCodeMaxRetries` (D228, D121).
- Other backends audited, unchanged: Model API quota/usage-limit
  refusals, Copilot quota and the ChatGPT plan limit already name
  their condition honestly. The TUI renders no turn errors, so it
  carries no quota words.

## Proof: real-code tests over the observed fixture

The fixture keeps the observed bytes verbatim (message, `resetsAtMs`
`1793389338000`, `limitKind` `tierLimit`, `kind` `modelError`) with
its provenance; every suite below drives the real error path, zero
model calls:

- `test/unit/museCodeQuotaExhausted.test.ts` (14 tests): CLI mapping
  (quota detail parsed, instant guard, 429-without-reset untouched)
  plus the shared words in local time.
- `test/unit/acpTurnFailure.test.ts` (11 tests): the ACP wire
  contract — code, message, `data` shape, `retryable` both ways.
- `test/unit/museCodeAutoResend.test.ts` (8 tests): quota never
  resends by default; the opt-in waits until the reset (live-wire
  panel through the shared `museLiveTurn.ts` echo rig).
- `test/unit/mhpContract.test.ts` + `test/unit/mhpPanelContract.test.ts`
  (60 tests): the 1.5.1 snapshots with the quota detail.

## Red/green drills (each: break on purpose, non-zero exit, restore, green)

1. Mapping drop (quota detail not parsed): red exit 1 — expected
   `{limitKind, resetsAtMs}`, got undefined. Restored: 14 passed,
   exit 0.
2. Resend-gate drop (quota hold removed): red exit 1 — 2 failed.
   Restored: 14 passed, exit 0. Weakness recorded: `waits until the
reset` passed under this break (it asserts the wait, which the
   un-held path still performs once); the hold itself is covered by
   the default/off/past-reset cases.
3. Panel words drop: red exit 1 — 3 failed. Restored green, exit 0.
4. ACP branch drop: red exit 1 — 3 failed, reproducing the original
   -32603 bug on the wire. Restored: 11 passed, exit 0.
5. Outbound `retryable` drop: red exit 1 — 3 failed. Restored
   green, exit 0.
6. Exec outcome drop: red exit 1 — 1 failed. Restored green, exit 0.

## Proof: the packed agent's normal path still works

The pack is `dist/muse-spark-code-acp-0.19.0-darwin-x64.tgz`,
`node scripts/package-acp.mjs --target darwin-x64`, exit 0, after the
repository's own native-helper builds (`native/darwin/build.sh` and
`build-local-judge.sh`, both exit 0). It was packed from the
budget-red build below (size gates, not correctness); the proof is
the normal path working, which budgets cannot change.

A fresh HOME (`$TMPDIR/rlf-proof/home`), a fresh empty workspace, the
product's environment from `productEnvironment` with only
`XDG_CONFIG_HOME` pointed at the real config home so the product
reads the rig's real Muse Code sign-in itself (the real
`auth.json` is untouched afterwards: still 1083 bytes, still
2026-10-17). Driver: the real-life editor harness (`startEditor`),
initialize, `session/new`, model asserted to be
`muse-spark-1.3-contributor` by name before anything was sent, one
`session/prompt` ("What is the capital of Australia? Reply in one
short sentence, no tools needed.").

- `stopReason: end_turn`, 0 permissions asked. The answer: "The
  capital of Australia is Canberra." followed by the turn-finished
  notice — the same shape rlf-acpturns recorded.
- No quota triggered: the normal path, as required.
- Real count from the records: the product usage journal
  (`usage/v1/days/2026-10-30/`) holds exactly 1 entry,
  `{"kind": "turn", "model": "muse-spark-1.3-contributor"}`. Muse
  Code's own session record (fresh home, session
  `01a19054-f425-7f51-af9b-d71899413087`) shows the same single
  request (input 24843 / output 149 tokens, recorded twice: turn
  and cumulative); its two subagent records hold no roles at all —
  setup only, zero model calls. Stated 1, spent 1.

## Gates

| Gate                                               | Result                                              |
| -------------------------------------------------- | --------------------------------------------------- |
| `prettier --check` (touched files)                 | 0                                                   |
| `eslint --max-warnings 0` (touched files)          | 0                                                   |
| `npm run typecheck`                                | 0                                                   |
| `node scripts/check-l10n.mjs`                      | 0 (14 UI tables, 0 problems)                        |
| `npm run check:reference`                          | 0                                                   |
| `npm run check:host-api`                           | 0                                                   |
| `npm run check:plan`                               | 0 (245 milestones, 0 drift)                         |
| `npm run check:roadmap`                            | 0 (245 entries, current)                            |
| `npm run check:mhp`                                | 0 (schemas match)                                   |
| `npm run check:catches`                            | 0 (baseline matches)                                |
| `npm run duplication`                              | 0 (0 clones)                                        |
| `npm run cycles`                                   | 0                                                   |
| `npm run deadcode`                                 | 0                                                   |
| `node scripts/exec-schema.mjs --check`             | 0                                                   |
| `npm run build`                                    | **1 — five budgets OVER, reported not raised**      |
| touched suites (quota 14, ACP 11, resend 8)        | 0 (33 passed)                                       |
| MHP suites (contract 34, panel 26)                 | 0 (60 passed)                                       |
| `vitest related` A (ACP, mapping, events)          | 0 (~233 files)                                      |
| `vitest related` B (conversation, settings)        | 0 (27 files, 256 tests)                             |
| `vitest related` C2 (exec, constants, turnFailure) | **1 — 65 environmental failures, attributed below** |
| `vitest related` D (uiState, catalog, en)          | **1 — 64 environmental failures, attributed below** |
| `vitest related` E (generated reference)           | 0 (5 files, 84 tests)                               |
| `package-acp --target darwin-x64`                  | 0                                                   |

Build OVERs, measured on this machine against a clean-base build of
`0a5ebd7189` (base: exit 1 with 4 OVERs; team bundles byte-identical
in both):

- `dist/teamHost.js` 140.2/130 KiB, `dist/teamRunners.js` 78.4/75,
  `dist/teamScheduler.js` 76.5/75 — pre-existing (cc-int5 §8 item 1).
- `dist/uiText.js` 128,437/128,000 B (+96 B on this lane; the new
  keys live in reader bundles, not this file — no quota string in
  either build — so the delta is build-shape noise from the en.ts
  growth; base already 341 B over).
- `dist/wire.js` 76,819/76,800 B (+82 B on this lane: the
  `turnQuotaSchema` plus its two event refs; base headroom was 63 B,
  so the lane's honest schema tips it 19 B over).

Related-run failures (C2: 1127 files, 27097 passed / 65 failed;
D: 1137 files, 27165 passed / 64 failed): zero quota/ACP/panel/exec
mentions in any failure — every quota-named suite passes in-run
— and every failure reason is the sandbox or the base tree:
`spawnSync /bin/ps EPERM` (`ps` is denied on macOS lanes), `cc`
toolchain failures, unbuilt `muse-dictate` helper, missing
xcodebuild, `EMEDIA_RSS_UNAVAILABLE`, lease/link races under the
1100-file parallel load, and the stale `models-dev` vendor snapshot
date (`providerSpend`). All five of this lane's suites pass inside
both runs.

One procedural note: the first C run was launched without excludes
and pulled the vault and credential-store suites the brief forbids
on this MacBook. This sandbox has no default keychain at all (both
`security` and `@napi-rs/keyring` report none), and the run's own
process tree inherited that, so no Keychain write could have
landed; the win32-gated suites skipped, and the run was replaced by
the compliant C2/D runs above with all five forbidden paths
excluded. No credential value was read, printed or stored at any
point.
