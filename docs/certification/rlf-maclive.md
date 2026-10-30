# RLF-MACLIVE — three counted live checks on the Mac mini's Muse Code sign-in

Recovery lane. Base `int/recovery` at `d057bf203` (0.19.0), Mac mini,
2026-10-23. Merges (both `--no-ff`, conflicts resolved by meaning):

- `5bfc2e9c6` — `src/RLF-MACLIVE/01-rec-rlf-acpturns` (RLF-ACPTURNS:
  honest notices, quiet accounting, Retry). HEAD already carried
  RLWINFIX2 item 3's retryable words, so the merged
  `turnFailureError`/`hostExitError` keep HEAD's codes and words and
  add the branch's always-present `data.retryable`; the branch's
  omitted-judgment default (retryable unless the sign-in was lost) is
  kept and one HEAD mapping assertion updated to the merged contract.
- `4cbb4bae0` — `src/RLF-MACLIVE/02-rec-rlf-hosts2` (RLF-HOSTS2: M66
  Vim plugin, live drill, Xcode record). Only the generated ROADMAP
  conflicted; regenerated.

Follow-ups on this tree:

- `505387b7e` — F2: the ACP usage read is offered on Muse Code.
- `98e270460` — the Model API turn-failure handler reports every path
  (the Retry merge re-identified the catch; narrowed to REPORTED).
- Shared journal-rig refactor for the duplication gate (below).

`rec/rlusage` does not exist in the bare repo (checked 2026-10-23), so
there was nothing to reconcile before touching the accounting seam.

Part (c) (M48 `reopen`/`readResult` capture) was not run: the brief
conditions it on the owner's agreement, which is still pending.

## (a) F2: the ACP usage read is offered on Muse Code

`int/recovery` warned `ACP usage accounting is unavailable` once per
session on the Muse Code backend, because `serve` gated accounting to
the Model API backend (`isEnabled: () => isUsageHistoryOn &&
options.backend === 'modelApi'`). The gate's premise is stale:
Muse Code turns journal through the manager bundle's session writers
in ACP serve, with plan pricing and real token counts, so the read
succeeds and the warning was noise. `505387b7e` drops the backend
condition; only disabled history refuses the read now. `docs/acp.md`
(now: both backends report; Muse Code requests count as plan
requests) and the CHANGELOG move with it.

The new `test/unit/acpUsageRead.test.ts` drives the real chain
(recorded 2026-10-08 tokenUsage frames, real mapper, deltas,
recording, on-disk journal, real daily-ledger reader): the snapshot
is available with 2 plan-priced requests, counted input/output
tokens and `settledUsd '0'`; disabled history refuses with `Usage
history unavailable`. Red drill: negating the session filter fails
the snapshot case; restored byte-identical (SHA
`35e09db244c3873015da883b3b17d77e7f4fef38609815ea71a46ad640dddc8c`).

Live proof, packed agent
`dist/muse-spark-code-acp-0.19.0-darwin-x64.tgz` built from this tree,
Muse Code 1.4.11, empty workspaces, throwaway capital prompt:

- Neovim 0.12.5, headless, CodeCompanion 8611841 `muse_spark` ACP
  adapter (`auth_method muse-code-login`, model
  `muse-spark-1.3-contributor`), through a wire tap. Session
  `01a16950-773f-7890-8790-f81bcbefb6f1`: answer `The capital of
Australia is Canberra.` plus the notice as its own paragraph;
  `session/set_config_option` carries the contributor model on the
  wire; `end_turn` and `session_info_update` carry
  `museSpark.usage` available with 1 request, 25530/73 tokens,
  1 plan request, `$0` settled. Agent stderr: 13 lines, 4 routine
  warns, zero usage/accounting lines.
- Emacs 31.1 (`fac653279dcb`), agent-shell 0.89.1, acp.el 0.18.2,
  shell-maker 0.98.2, batch driver (`:needs-authentication`,
  `muse-code-login`, `:default-model-id` contributor), through the
  same tap. Session `01a1695f-b54f-7510-a094-afe795579bb9`: same
  answer; model set on the wire; `end_turn` usage available with
  1 request, 25529/96 tokens, 1 plan request, `$0` settled.
  The notice chunk carries its own `messageId` (F1, live on this
  tree). Agent stderr: 13 lines, 4 routine warns, zero
  usage/accounting lines.

Stderr scan drill (`grep -iE 'usage accounting|accounting.*unavailable'`
over both editors' agent stderr): silent on both (exit 1); a planted
`[warn] ACP usage accounting is unavailable` in a copy trips it
(exit 0); silent again afterwards. Proof stderrs untouched
(SHA `980206…` Neovim, `25ebef…` Emacs — full SHAs in the lane log).

Wrong-tier run, reported: the first Neovim run (session `01a1694d`,
1 call) served on the default `muse-wonder-1.0` because the tap
omitted `--allow-contributor-models`, without which the contributor
model is not listed and the client cannot select it. Its tier and
cost are unknown. The tap was fixed, the flag verified with a
zero-call `session/new` (contributor listed), and the run repeated.

## (b) The Vim live drill is green live

`MUSE_LIVE_VIM=1
MUSE_LIVE_VIM_TARBALL=dist/muse-spark-code-acp-0.19.0-darwin-x64.tgz
npx vitest run test/e2e/vim.live.e2e.test.ts`: 4/4 pass in 52 s
(Vim 9.1, session `01a16960-8951-7753-9561-d278fce3f7f1`). The two
drill checks RLF-HOSTS2 fixed in-tree and validated offline pass on
the live backend. Offline `sh test/hosts/vim.sh` on the installed
package: PASS (`session /whatsnew /new /close`). Xcode:
`xcode-attach` ok; the mcpbridge probe stays BROKEN (dyld AppSandbox
SIGABRT, as RLF-HOSTS2 recorded).

## Counts

Every call below is counted from its CLI session log
(`model_response_created`/`model_completed`), and every session the
lane opened is listed; a same-window shard audit attributes all
other model activity to harness sessions (other lanes' agents).

| run                                             | session       | calls | model                          |
| ----------------------------------------------- | ------------- | ----- | ------------------------------ |
| smoke, packed agent                             | 01a1694a-eb76 | 0     | —                              |
| smoke, worktree agent                           | 01a16949-3f54 | 0     | —                              |
| smoke, RLF-ACPTURNS agent (tree-vs-state check) | 01a16945-b296 | 0     | —                              |
| contributor-flag check                          | 01a16950-3dac | 0     | —                              |
| Neovim run 1 (missing flag)                     | 01a1694d-ff8b | 1     | muse-wonder-1.0 (unknown tier) |
| Neovim run 2 (proof)                            | 01a16950-773f | 1     | muse-spark-1.3-contributor     |
| Emacs attempt 1 (driver setup)                  | 01a16959-bf70 | 0     | —                              |
| Emacs attempt 4 (mid-turn driver kill)          | 01a1695d-8f2e | 1     | muse-spark-1.3-contributor     |
| Emacs attempt 5 (proof)                         | 01a1695f-b54f | 1     | muse-spark-1.3-contributor     |
| Vim live drill                                  | 01a16960-8951 | 4     | contributor ×4                 |
| total                                           |               | 8     | 7 contributor + 1 unknown-tier |

Allowances were stated before each run (at most 4 per editor, at
most 4 for Vim) and held: Neovim 2, Emacs 2, Vim 4. Expected
metered spend was $0.00 per run (subscription; every contributor
snapshot settles `$0`); no priced request appeared. The one
unknown-tier call's cost is unknown and is reported, not hidden.

## Gates

- Typecheck (all five projects), eslint (every touched file),
  prettier, l10n, reference, host-api (regenerated: `node:crypto`
  256→257 for the notice ids), roadmap: green.
- Unit: merge-affected suites green (acpBackendNotice 2,
  acpTurnFailure 5, acpTranslate 46, mapNotification, acpNoticeUpdates,
  acpResources, acpSignInLoss, modelApiFailureRetryable, turnRetryPanel,
  turnRetryButton, turnRetryResubmit, acpUsageRead 2, museUsageDeltas:
  13 files, 136 tests, repo timeouts). Red drill on the F1 test:
  dropping the notice's `messageId` fails the fallback case
  (1 failed | 3 passed); restored byte-identical, 4 green.
- Related sweep over every changed source (`vitest related`, 18
  files): exit 1 — 40 failed files / 88 failed tests of 955 files /
  25,315 tests. Every failing file was rerun alone on this tree and
  on the untouched base `d057bf203`: 28 fail identically on base
  (byte-identical, including the handshake's generic-refusal
  message and the real-plan estimator's 8), 8 pass on a quiet tree
  (sweep-load flakes), and 4 flake with 5 s timeouts on both sides
  (same totals). Zero failures are attributable to this lane.
- `check:catches` red, as on the untouched base: net rises of 64
  on `d057bf203` and 63 here (base `core GENERIC … to 284`,
  tree `… to 283`; every other rise line identical). A site-level
  diff of the two inventories shows zero debt sites added and one
  removed: the merge re-identified one Model API turn-failure
  catch, narrowed to REPORTED on this tree (cancel path records
  its end; the hook-stop judgment is hoisted out of the log call),
  so the lane adds zero catch debt. The stale baseline is the
  lead's integration work; §7 defers it.
- Duplication red on base (6 clones) and tree (6): the new
  usage-read suite's rig is shared with the deltas suite through
  `test/unit/helpers/museJournalRig.ts`, removing this lane's 3.
- SAST (with the machine cert bundle): 5 findings, all one
  `replaceAll` HTML-escaping audit in
  `src/host/backend/deviceWorkerDarwin.ts`, a file this lane does
  not touch (identical to base). The 3 rule timeouts on
  `ModelApiHost.ts` reproduce on base with 0 findings on both.
  Pre-existing.
- `security:audit` red with byte-identical output on base and tree
  (exit 1 both): 6 unhandled HIGH advisories (msal-node, 4 undici,
  zod), the stale braces exception and the markdown-it exception
  that expired 2026-10-24; no dependency file touched.
  Pre-existing.
- `npm run build` red on 8 bundle budgets before and after
  (paired measurement, KiB):

  | bundle                    | base  | tree  |
  | ------------------------- | ----- | ----- |
  | reportInputs.js (101)     | 101.0 | 101.0 |
  | reportingPanel.js (50)    | 50.2  | 50.2  |
  | resourceGovernor.js (125) | 126.9 | 126.9 |
  | resourceAdmission.js (25) | 25.1  | 25.1  |
  | modelApi.js (525)         | 533.3 | 533.5 |
  | vaultActions.js (25)      | 25.0  | 25.0  |
  | estimateContracts.js (25) | 25.0  | 25.0  |
  | wire.js (75)              | 75.9  | 76.0  |

  The lane's delta is +0.2 on `modelApi.js` (the landed Retry
  predicate plus the REPORTED narrowing) and +0.1 on `wire.js`
  (the merged retryable/event changes); no budget is raised and
  shrinking the over-budget bundles belongs to their owning
  lanes. §7 defers it.

- `check:plan` red before and after (3,725,714 bytes on base,
  past 85% of the budget; this lane adds its status line and
  deferrals only). §7 defers it per the recovery pattern: the
  lead archives at integration.
- Knip: no finding in any lane file. Cycles: none. Dead
  exports/files reported are outside this lane's files.
