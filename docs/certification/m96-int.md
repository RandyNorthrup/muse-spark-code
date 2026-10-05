# M96 integration — Windows 11 rig

Round 1 is retained below. The round 2 record follows it, with machine-readable
evidence in [m96-int-round2-results.json](m96-int-round2-results.json).

Worktree `C:/lanes/M96INT`, branch `m96/int`, base `e23ec61c`,
2026-10-05. The rig brief authorizes integration of R/0, A, B, F and T
and their focused gates; W/I/U2/L/K and full quality remain with the lead.
Live model attempts, paid calls, credential reads and pushes: **0**.

## Merge order and resolutions

All five merges use `--no-ff`; no history was rewritten.

| Lane | Branch head | Merge commit | Resolution                                                                                                                                                                   |
| ---- | ----------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R/0  | `29353c29`  | `4057382b`   | Clean merge; round-4 plan retained.                                                                                                                                          |
| A    | `8901ea1b`  | `46d0ae45`   | Union changelog and untranslated-key records; use lane 0's constants. External default stays 2; its hard ceiling stays 4.                                                    |
| B    | `7571f711`  | `7c748bd2`   | Union PLAN gate/residual records and all 14 translation tables; keep lane 0's existing shared-label translation.                                                             |
| F    | `570d6a9c`  | `4a23c7db`   | Keep both message contracts where placeholders differ, with `Detail` keys for F's five templates and their real translations. Union untranslated records and PLAN additions. |
| T    | `271fbf46`  | `1d01e829`   | Clean merge; repair the resulting eager runtime imports below.                                                                                                               |

The owning plan-record test caught dropped Added entries. The final
changelog unions all distinct unreleased lane entries; its released tail
is byte-identical to `e23ec61c`.

## Integration repairs

The final entry uses named function references so knip can trace every
export, and drops two obsolete compatibility exports. A new parametrized
in-place case first failed in a single-model conversation with
`Error: team runtime was not prepared`. Its refusal now comes from a tiny
English bootstrap block shared with tool refusals, and never loads the
team. The full graph/golden/declaration group then passes **87 tests**;
tools/constants/MCP server pass **78**, and plain knip passes.

- Ordinary bundles use the synchronous decision in
  `src/shared/teamConversation.ts`. The old team import paths re-export
  the shared definitions for consumers of those lane interfaces.
- `ModelApiHost` loads `teamEntry` only for a team conversation, before
  its turn or compaction. Tool declarations are injected from that runtime;
  single-model calls use the existing declarations. Stored command claims
  remain data until the runtime loads, then restore into its registry.
- `dist/team.js` contains T's tools and roster, installs the caller's UI
  table and is included in both package manifests. The production resolver
  preserves its dynamic import. Split and host-global gates cover it.
- Lane-local tunables now read lane 0's central values, including intensity,
  role tool groups, typical tokens, minimum requests, learned-task count,
  preview estimates, model settings, effort and T's protocol limits.
  F's existing exported data shapes remain compatible.
- T's 51 model-facing text literals now live in `TEAM_MODEL_TEXT` without
  changing declared bytes. Equal duplicate English keys are removed;
  different placeholder contracts retain separate translated keys.

## Single-model proof

The ordinary esbuild graph test initially failed with four team modules.
After repair, activation, Model API and ACP graphs contain no
`src/core/team/**`, `src/host/team/**` or `src/shared/team.ts` runtime.
The separate bundle contains the tool, roster and entry modules.

The permanent raw-body suite runs seven scenarios under each of nine
single-model configurations, including duplicate identities after
`sameModel` deduplication, unloaded/failed probes and disabled key workers.
It checks additional HTTP traffic and now also checks that the lazy module
factory never loads. Conversation-mode/resume and enabled-team cases pass.

Independently built `ModelApiHost` from **95 source inputs read with
`git show e23ec61c:<path>`**, using an esbuild source-overlay plugin and
the unchanged installed dependencies. A temporary copy of the same raw
harness ran all seven scenarios against that base build: **10 tests pass**
(seven scenarios and three normalization controls). It compared against
the same unchanged original fixture strings; only direct generated item
ids are normalized, with one identity map across each scenario. The
temporary test was removed. Base build SHA-256:
`e9ae632db0e92b5956eae8ad3fdd4f3f44f33c73b66dc3988605085f1e392cb7`.

Same-options production source overlays also measured the base ordinary
bundles. Activation is **608,722 bytes**, against **604,810** at the base:
**+3,912 bytes**, below 4,096. Model API is 448,164 versus 440,468;
ACP is 822,153 versus 820,162. These comparisons externalize the shared
English table and the existing deferred entries exactly as the production
build does.

## Failure drills

| Deliberate regression                                               | Observed failure                                                                                | Restoration                                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Prepare the team runtime unconditionally at the start of every turn | All 63 single-model raw scenarios fail the zero-loader assertion; six other tests pass. Exit 1. | ModelApiHost restored byte-exact.                                                              |
| Eagerly import and use `isTeamTool` from the team runtime           | The ordinary graph guard fails. Exit 1.                                                         | Same SHA-256 before/after: `64c3de5758a9cb7db175f7e1ae6a4d22e9962f0c10d47471f2f5036dd05759f0`. |

The new production bundle checks also fired independently: enlarge
`team.js` to 75 KiB plus one byte; plant a team-directory input in the
activation metafile; remove the tools input from the team metafile; and
append a `navigator` reference to `team.js`. Each named guard exits 1.
Every artifact is restored byte-exact; the result JSON records its SHA-256.

Hashes identify the bytes at each drill, before subsequent text relocation
and formatting. The restored graph/golden suites passed together (80 tests,
including the independent base proof), and tools/roster/goldens passed
after text relocation (97 tests). No rule, ignore, threshold, timeout or
test selection within a file was weakened.

The integrated golden source now uses R's `isSameTeamModel`, including a
whitespace-padded duplicate model on another backend. The entire
graph/golden/declaration group passes after the final lint repairs (86).
The central effort ladder retains F's `readonly string[]` type so unknown
provider tiers can still enter the fallback; its 73 owning tests pass.

Repeated the source drills after the refusal repair: unconditional loading
fails 63 cases; the eager import fails the graph; returning the missing-runtime
error fails exactly the new single-model in-place case; removing R's trimming
fails 28 golden cases. Every source is restored byte-exact; final drill
hashes and commands are in the result JSON. The complete three-file group
passes afterward (87 tests).

## Owning unit coverage

**1,562 tests pass in 50 files; 0 pending.** Every run contains at most
three files, with `--maxWorkers=3 --testTimeout=120000`, directly on win11.
The file inventory and per-run counts are recorded in
`m96-int-results.json`. It includes every test file changed by the five
merged branches and the adjacent custom-agent, protocol, localization,
paid-gate, MCP, instruction, tool and session-store suites.

Before the aggregate run, focused seam runs passed A's pool/ceiling/constants
(73 tests), B's resources/bridge/IDE server (67), and all seven F files
(94). The plan-record failure in the aggregate was fixed by restoring
changelog entries; that complete three-file group then passed (31).

## Final gates and bundles

All required checks exit **0**: all five typechecks; full JavaScript/CSS/
PowerShell lint; prettier; plain knip; jscpd (0 clones); localization
(14 tables, 121 manifest strings, 450 source files, 0 problems); dpdm;
host API generation and check; production build, split, host-global and
83-package notices checks. The built lazy entry also works through native
Node dynamic import (five tools and a fresh registry). ACP notices cover
the new bundle and produce seven package notices.

PowerShell initially could not find its pinned analyzer. The rig already
has PSScriptAnalyzer 1.25.0 at
`C:/Users/Randy/gates/tools/psmodules/PSScriptAnalyzer/1.25.0`.
Prepending its module root to **this process's** `PSModulePath` lets the
unchanged full lint command pass with 0 findings. The prior value is
restored in `finally`; no installation or machine/user setting changes.

The duplication gate caught F's independently copied tool-set table after
the merge. Compact expected strings retain the independent assertions.
Removing research's `webFetch` from the canonical source fails its owning
test (1 failed, 11 passed), then SHA-256 restoration and all 12 tests pass.
Ten localization exceptions were listed in both the shared and locale
lists; removing the redundant locale entries preserves every allowed key.
No ignore or threshold changed. The changed test also passes focused lint
and the unit compiler after the aggregate checks.

| Production artifact |   Bytes | Cap bytes |
| ------------------- | ------: | --------: |
| extension.js        | 608,722 |   614,400 |
| modelApi.js         | 448,164 |   486,400 |
| review.js           |  45,143 |    51,200 |
| sessionBoard.js     |  64,641 |    76,800 |
| reviewer.js         |  57,012 |    76,800 |
| team.js             |  44,558 |    76,800 |
| planMarkdown.js     | 142,363 |   153,600 |
| checkpointStore.js  | 139,890 |   230,400 |
| agentImport.js      | 119,384 |   128,000 |
| bundledSkills.js    |  24,373 |    51,200 |
| codeIntel.js        |  79,468 |   102,400 |
| voice.js            |  36,470 |    51,200 |
| museCodeReviewer.js |  44,697 |    76,800 |
| uiText.js           | 121,692 |   128,000 |
| searchWorker.js     |  18,571 |    51,200 |
| pageWorker.js       | 208,040 |   307,200 |
| webview/main.js     | 897,026 |   921,600 |
| acp.js              | 822,153 |   870,400 |

`npm run quality` was not run, as the rig brief explicitly prohibits it.
The D78 production adapter, late-terminal observation residual and remaining
lanes retain their existing owners; no integration claim marks M96 shipped.

## Round 2 — T/W/I/U2/L review branches

2026-10-05, `C:/lanes/M96INT`, branch `m96/int`, starting at `0e6686f3`.
Validated source commit: `149f6bac`. This supersedes round 1's deferral of
W/I/U2/L. A's second fixes, K, M96c, main 0.13.0/0.14.0 and full quality
remain outside the rig brief. Live model attempts, paid calls, credential
reads and pushes remain **0**.

| Lane | Branch head | Merge commit | Resolution                                                                                                                                                             |
| ---- | ----------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T    | `bc03485b`  | `3424bfa8`   | Union PLAN/CHANGELOG; keep deferred runtime while retaining durable pending claims, cancellation and structured team tool data.                                        |
| W    | `a0b38c0d`  | `f061093f`   | Union docs; use native file URLs and Windows path rules in ACP process fixtures.                                                                                       |
| I    | `56fa6af4`  | `07108533`   | Union docs; regenerate host API; normalize Git's alternates paths in the test and retain conservative PowerShell argument parsing.                                     |
| U2   | `c0a3adf3`  | `1a33c8b6`   | Union English and all 14 real translation tables, both switch-reason vocabularies and localization exceptions; keep the final view contract and aggregate browser cap. |
| L    | `00c601c8`  | `257fc3d6`   | Union CHANGELOG; retain `done` in both validated ledger contracts for successful tasks needing no merge.                                                               |

All are two-parent `--no-ff` merges in the required order. Correction
`fd86cc9c` aligns installed chat-tree validation with U2's `slot` view;
the separate workspace-role `teamAgentsUpdate` contract remains intact.
The unreleased changelog retains every distinct lane entry and one Added/
Fixed heading; its released tail remains identical to the starting record
after Git's line-ending normalization.

### Integration repairs and Windows proof

W's worker environment now delegates to I's canonical fence, with W's
safe runtime names retained. Profile passthrough cannot restore loaders,
Git configuration or SSH/askpass transports. Both Git config stores are
disabled, and credential/helper/askpass pins remain enforced. The strengthened
environment regression first failed on the separate implementation and
passes on the shared implementation.

The combined browser initially measured **905.7 KiB**, failing the unchanged
900 KiB gate. The build now shares the pinned TypeScript grammar's exact
embedded JavaScript function with its standalone grammar, verifying both
declaration cardinality and byte equality before substitution. It preserves
every TypeScript addition and emits UTF-8 modules. Six representative
samples across seven language aliases produce the same highlighted HTML
as the original grammars. Missing, duplicate and differing declarations
refuse. No dependency, grammar, feature, notice or cap was removed.

Full owning suites cover the final tree. I's four files pass **166 cases**:
ref fence 89, workspaces 26, merge 35 and review gate 16. Both expressly
Windows-only junction bodies execute here, and common link tests select
native junctions. The additional case test resolves an uppercase storage
spelling to the same native directory, then proves cleanup rejects that
noncanonical spelling while retaining the task. Charter write-path case
restrictions still apply on Windows. The ACP worker fixtures also pass
using `fileURLToPath` and native path modules.

### Units and single-model invariant

**2,208 tests pass across 75 files; 0 failed or pending.** The inventory
contains every merged lane's owning tests and round 1's adjacent coverage.
Runs use no more than three files and three workers, with the unchanged
120-second timeout. Initial batches are superseded by complete reruns for
the final vendor-shape and Windows cases; the result JSON records those
counts and all post-drill runs.

The restored graph/golden/declaration group passes **91 tests**; the
protocol/environment/highlighter group passes **15**. Seven original
fixture blobs are identical to `6cfb19e4`. Their raw request bodies pass
under all nine single-model configurations (**63 assertions**, with six
additional controls), using only the established generated-item-id
normalization. Key order, escaping and whitespace stay intact. Round 1's
independent pre-M96 source build remains the baseline proof.

Final production activation, Model API and ACP metafiles contain **0**
`src/core/team/**`, `src/host/team/**` or `src/shared/team.ts` inputs.
Shared bootstrap constants/conversation decisions and the webview transport
schemas remain ordinary inputs; the team tools, registry and roster load
from `dist/team.js`. The browser owning suite retains its theme/320px,
nonce, real dynamic-import, packaged-chunk and aggregate-byte checks.

### Eight source failure drills

Each runs a complete owning test file and exits 1. Every source restores
with identical before/after SHA-256; hashes and named failures are in the JSON.

| Deliberate regression                                               | Failing cases |
| ------------------------------------------------------------------- | ------------: |
| Load the team runtime in every ordinary turn                        |            63 |
| Eagerly import and use a team runtime tool predicate                |             1 |
| Remove the durable-claim callback from the lazy registry factory    |             2 |
| Install the old draft tree schema instead of U2's final view schema |             1 |
| Allow profile passthrough to restore worker loader variables        |             1 |
| Skip vendor grammar declaration cardinality checks                  |             3 |
| Skip vendor grammar source equality                                 |             1 |
| Normalize the Windows storage alias before checking canonicality    |             1 |

The restored Windows workspace file passes all **26** cases. The new
grammar group passes **15** across its three files. The original merged
static checks also fired: full lint found a nested ternary and scratch
scripts; knip found unused pipeline exports; duplication found eight test
clones. Argument tables and shared test setup remove the repetition, unused
exports are deleted, and scratch scripts move to this task's OS temp folder.
No rule, ignore, timeout or threshold changed.

### Final gates and artifact bytes

All required static gates exit **0**: five compiler projects, full
JavaScript/CSS/PowerShell lint, full prettier, plain knip, jscpd with zero
clones, localization (14 tables, 121 manifest strings, 468 source files,
zero problems), dpdm, regenerated host API plus check, regenerated notices,
production build, split and host-global checks. After the native case test,
the unit compiler, changed-file lint/format and zero-clone gate pass again.
ACP notices regenerate with seven packages; extension notices cover 83.

Commits run the unchanged lint-staged and gitleaks hooks. Portable Git has
no bash, so a process-local temporary `npx` wrapper invokes the installed
`npx-cli.js`; PATH is restored afterward. Full PowerShell lint uses the
rig's existing pinned analyzer through the child's `PSModulePath` only.
No machine/user settings or installations change.

| Production artifact    |     Bytes | Cap bytes |
| ---------------------- | --------: | --------: |
| extension.js           |   611,874 |   614,400 |
| modelApi.js            |   452,044 |   486,400 |
| review.js              |    45,158 |    51,200 |
| sessionBoard.js        |    66,968 |    76,800 |
| reviewer.js            |    57,027 |    76,800 |
| team.js                |    48,760 |    76,800 |
| planMarkdown.js        |   142,363 |   153,600 |
| checkpointStore.js     |   139,905 |   230,400 |
| agentImport.js         |   119,399 |   128,000 |
| bundledSkills.js       |    24,388 |    51,200 |
| codeIntel.js           |    79,483 |   102,400 |
| voice.js               |    36,485 |    51,200 |
| museCodeReviewer.js    |    44,712 |    76,800 |
| uiText.js              |   123,611 |   128,000 |
| searchWorker.js        |    18,571 |    51,200 |
| pageWorker.js          |   208,040 |   307,200 |
| webview, all JS chunks |   921,336 |   921,600 |
| acp.js                 |   824,068 |   870,400 |
| win32-x64 VSIX         | 2,243,169 | 2,252,800 |

The actual Windows VSIX is created by
`npm.cmd run package -- --target win32-x64 --out temp/m96int-round2-win32-x64.vsix`
and passes `node scripts/check-vsix-size.mjs temp/m96int-round2-win32-x64.vsix`.
All 18 build caps and this package cap pass. The browser has **264 bytes**
of remaining room; the Windows package has **9,631 bytes**.

Two broader M96 acceptance items remain explicit in PLAN §7. Activation
is **+7,064 bytes** against round 1's independently measured pre-M96 base
of 604,810, exceeding the separate **4,096-byte growth target** by 2,968
while staying within its hard cap. That target is unchanged and cannot
be certified by this record. This rig also lacks the compiled macOS helper,
so the **universal** VSIX is unverified; the Windows package proof does
not include it. Neither residual marks M96 shipped. Full quality remains
the lead's gate, as explicitly required by this rig brief.

## Round 3a — final lane A merge

2026-10-05, Windows 11 rig, starting at `46f3e700`. Integrated
`m96/afix2` at `273a9131` with `--no-ff`. Five conflicts preserve both
intents: union PLAN and CHANGELOG records; keep L's `done` round-trip test
and A's ledger regressions; keep the central team constants and add A's
bounded retry constant once; apply A's absent/partial provider-limit fix
using the canonical `TEAM_ORCHESTRATOR_HEADROOM` constant.

All nine complete lane-A/adjacent suites pass: pool/admission/ceilings 42,
meter/claims/ledger 59, workers-paid/features/consent 44. Host API and notices
are regenerated. The unchanged production build passes every cap, split,
host-global and notice check. Activation after this merge is 613,036 bytes;
the startup relocation and universal packaging proof follow below. A's
record retains its fired regression drills and live-cap adapter prerequisite;
this merge does not implement round 3b's production wiring.
