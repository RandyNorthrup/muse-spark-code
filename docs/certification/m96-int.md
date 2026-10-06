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

Before starting relocation, all nine complete lane-A/adjacent suites pass: pool/admission/ceilings 42,
meter/claims/ledger 59, workers-paid/features/consent 44. Host API and notices
are regenerated. The unchanged production build passes every cap, split,
host-global and notice check. Activation after this merge is 613,036 bytes;
the startup relocation and universal packaging proof follow below. A's
record retains its fired regression drills and live-cap adapter prerequisite;
this merge does not implement round 3b's production wiring.

The merge is `fb935dcc` (parents `46f3e700` and `273a9131`). Its running
lint-staged hook captured the beginning of the pending pricing relocation,
including async caller changes. It is a transitional commit, not a separately
certified build. Review the merge together with the completed follow-up below;
the final head is the validated source. No history is rewritten.

### Round 3a startup proof

`m96-int-round3a-results.json` records the module contributions, all owning
test files, byte-exact drill hashes, bundle bytes and universal member proof.
The pre-M96 baseline is rebuilt from the 201 source files at `e23ec61c`,
using the same production esbuild options, shared English fallback and
deferred entry resolver. Its **604,810 bytes** reproduce the previous
independent baseline. No main branch is merged, and this measurement does
not certify the separate 0.14.0 main diet to 600,000 bytes.

| Activation measurement               |   Bytes | Growth against pre-M96 |
| ------------------------------------ | ------: | ---------------------: |
| Pre-M96 `e23ec61c`                   | 604,810 |                      0 |
| Round 2                              | 611,874 |                  7,064 |
| Lane A integrated, before relocation | 613,036 |                  8,226 |
| Completed round 3a                   | 608,883 |                  4,073 |

The unchanged **4,096-byte growth target passes with 23 bytes remaining**.
The relocation saves 4,153 bytes against the A-integrated build, or 2,991
against round 2. The following table lists every positive activation
contribution delta before relocation; the JSON also records all negative
deltas and final contributions. Minified symbol allocation can cause tiny
deltas in otherwise unchanged modules; these are measurements, not claims
that every listed module contains new implementation.

| Module                                            | Added bytes before relocation |
| ------------------------------------------------- | ----------------------------: |
| `src/shared/teamView.ts`                          |                         1,735 |
| `src/host/conversation/conversationController.ts` |                         1,169 |
| `src/core/paid/paidConsent.ts`                    |                           960 |
| `src/shared/paid.ts`                              |                           931 |
| `src/shared/constants.ts`                         |                           860 |
| `src/core/paid/paidFeatures.ts`                   |                           814 |
| `src/host/mcpLoopback.ts`                         |                           716 |
| `src/shared/protocol.ts`                          |                           646 |
| `node_modules/zod/v4/core/schemas.js`             |                           468 |
| `src/core/backends/modelapi/sessionStore.ts`      |                           290 |
| `node_modules/zod/v4/mini/schemas.js`             |                           123 |
| `src/host/settings.ts`                            |                            73 |
| `src/host/paid/paidHost.ts`                       |                            37 |
| `src/core/backends/modelapi/client.ts`            |                            15 |
| `src/core/web/webFetch.ts`                        |                            14 |
| `src/host/html.ts`                                |                            14 |
| `src/host/auth/deviceSignIn.ts`                   |                             6 |
| `src/shared/agentEvents.ts`                       |                             6 |
| `src/host/backend/toolIo.ts`                      |                             2 |
| `src/core/verify/checkCommands.ts`                |                             1 |

The loopback helper replaces code in `ideMcpServer.ts`, which decreases
610 bytes; its net addition is 106 bytes before minifier overhead. The
remaining small negative deltas and generated overhead explain the total.

The real team-view validators now reside only in `team.js` for Node bundles.
`src/host/teamViewBundle.ts` supplies checked synchronous schema proxies;
ordinary item parsing does not load the bundle, while a present team payload
loads and uses the existing validator before consumption. The browser retains
its actual synchronous schemas. An outer optional and a pipe are necessary:
Zod consults a lazy getter's metadata even when an optional field is absent.
Compiled tests cover all six item payloads, valid/invalid tree and usage
messages, stripping unknown fields, and missing/malformed bundle factories.

Team price identity, formatted questions and scoped Always decisions move
from the eager paid modules into `src/core/team/teamPaid.ts`, exposed by the
existing `createTeamRuntime` factory. Every lazy factory installs the caller's
language and locale. A feature disabled during import is denied before using
a grant or showing a popup; ACP also checks prompt lifetime after the awaited
price question, before emitting a paid card or requesting permission.

Pure local factories let esbuild discard the unused role tool table and
immutable role-id copy. Identical scalar boundary validators share instances,
and team/best-of-N tally settlement shares the existing validation and update
logic without mixing counters. No payload field, constraint, price identity,
tool, role, budget or public tally is removed.

The production activation, Model API and ACP graphs exclude
`src/shared/teamView.ts`, `src/core/team/teamPaid.ts`, every
`src/core/team/**`/`src/host/team/**` module and `src/shared/team.ts`.
The named `teamStartup.test.mjs` uses the actual production resolver and
checks both the excluded inputs and the raw activation-byte growth limit.
Knip and cycle detection explicitly include the build-selected Node proxy.
Seven original golden blobs remain unchanged; all seven raw bodies pass
under nine single-model configurations (63 assertions plus six controls).

### Round 3a owning tests and failure drills

All **611 tests in 24 complete files** pass in eight sequential batches,
at most three files per invocation, with `--maxWorkers=3 --testTimeout=120000`.
Counts by batch: pool/admission/ceilings 42; meter/claims/ledger 59;
workers-paid/features/consent 46; startup/goldens/protocol-loading 77;
constants/tools/roster 89; protocol/paid-host/ACP-paid 152;
ACP-agent/activation-graph/declaration 113; Model-API-bundle/toolsets/roles 33.
After the drills and final immutable-copy correction, the complete guard
group passes 110 and the constants group passes 89 again. These repeats
are not added to the distinct 611 total. No cases are skipped or filtered.

Each deliberate regression runs a complete owning file, exits 1, and is
restored in `finally` with identical before/after SHA-256. The JSON preserves
the hashes and exact source/test names.

| Deliberate regression                                            | Failing cases |
| ---------------------------------------------------------------- | ------------: |
| Resolve Node team views back to their eager implementation       |             4 |
| Retain the unused role tool table                                |             2 |
| Skip bundle factory export validation                            |             2 |
| Skip the post-import paid feature gate                           |             1 |
| Skip installing the caller's locale in the compiled team factory |             1 |
| Skip ACP's post-question prompt-lifetime check                   |             2 |
| Retain the immutable role-id copy                                |             2 |

Both role-retention drills also fire the raw startup-byte assertion: 609,458
and 608,971 bytes respectively exceed the unchanged 608,906-byte limit.
The final restored production output is 608,883 bytes.

An eighth source drill restores the eager view resolver and runs the full
production build. The new bundle-split gate exits 1 and names the eager
validators in all three ordinary Node bundles. The resolver restores with
identical SHA-256; a fresh production build then passes all 18 caps, splits,
host-global checks and notices. This independently proves the CLI gate fires,
in addition to the seven complete-file test drills above.

### Round 3a gates and universal package

All five typecheck projects pass. Full JavaScript/CSS/PowerShell lint and
final changed-file ESLint pass; the rig's existing pinned PowerShell analyzer
uses a process-local module path only. Full prettier passes. Plain knip,
zero-clone duplication, localization (14 tables, 121 manifest strings, 470
source files, zero problems), cycles (411 files), regenerated host API and
check (271 VS Code APIs, 18 importing files, 24 Node built-ins, 59 theme
variables), regenerated notices (83 packages), and production build pass.
All **18 unchanged build caps**, bundle splits and host-global checks pass;
the result JSON lists each byte measurement. The aggregate browser JS is
919,786 bytes against 921,600. Full quality is intentionally not run under
the rig brief; round 3b production wiring and the lead's aggregate gate remain.

The published 0.13.0 VSIX's actual helper member is
`extension/native/darwin/muse-dictate`. Its 289,568 bytes are copied exactly
into the worktree's ignored native helper path. SHA-256 is
`f42e757a0d78a6bc6a6af22c3bcf34fc7d082eb9e8130d9336024a55c19f0f36`
in both the extracted file and the built package; its compressed member is
81,327 bytes. It is not committed or rebuilt on Windows.

`npm.cmd run package -- --out temp/round3/m96int-universal.vsix` runs the
production prepublish build and produces **123 entries**. The manifest has
no target platform. Every release-workflow required member, both native
helper lanes, all 14 translated tables and the new `team.js` are present.
This is a size/member proof using the brief's released helper, not a fresh
native version/build or install certification: the worktree manifest remains
0.12.1 while the provided helper comes from 0.13.0.

**The universal size gate is red:**
`node scripts/check-vsix-size.mjs temp/round3/m96int-universal.vsix` exits 1
at **2,324,725 bytes**, exceeding the unchanged **2,252,800-byte cap** by
**71,925 bytes**. PLAN §7 records this remaining release blocker. No cap,
threshold, rule or ignore is weakened; neither this lane nor M96 is declared
shipped. The round 2 Windows-targeted package is not substituted for this
universal measurement.

Local commits use the unchanged serial lint-staged and gitleaks hooks. The
rig's existing `temp/hook-bin` wrapper is prepended to PATH for the commit
process only, then PATH is restored. No push, main merge, rebase, paid/live
call, installation, credential read or machine/user setting change occurs.

## Round 3b — macmini integration

Worktree `/Users/randy/lanes/M96INT3B`, branch `m96/int3b`, base
`32caf103`. The rig brief authorizes the six ordered merges, classifier
unification, X2 wiring, aggregate gates and a final full quality run.
No credential reads, live/paid model attempts or pushes.

R (`570c6922`) preserves both Unreleased entries and the immutable role
resolution, with 126 owning tests passing. B (`dc7f0970`) also brings its
inherited 0.13.0 release tree: compose shared validation with deferred team
schemas, retain both paid-gate availability policies and both UI features,
union translations while honouring removed obsolete keys, and regenerate
host API data. All five compiler projects, 108 resource/bridge/pool tests
and localization with zero problems pass. K (`4adf07c8`) preserves both
plan/residual records, keeps its notes under Unreleased, and passes 84
complete-file tests including native Mac process ownership/lifetime.

W retains I's canonical environment builder. Its real SSH regression
naturally failed when that builder selected the nonexistent refusing
executable (`unable to fork` instead of a clean transport refusal). Use W's
`false` SSH command in the canonical builder: no network is reached and
credentials/askpass remain disabled. Update literal expectations and retain
the real transport assertions. W fence/Muse/environment then pass 108 tests;
ACP/stdio/engine pass 94. Further final-tree receipts follow below.

The I merge is `37c2521d`: 161 fence/review/workspace and 55 merge/certificate
tests pass. Its SSH fixture omits a custom port so Git exercises the actual
refusing command instead of rejecting its guessed SSH variant first.
M96c preserves all nine region-only files and both schema contracts:
legacy `teamUsageSchema`/`teamTaskStateSchema` stay unchanged, and scheduler
attempts use `teamAttemptUsageSchema`/`teamBoardTaskStateSchema`. English
labels union both sets, with an exact 17-key assertion replacing the obsolete
11-key count. Scheduler/accounting/constants pass 78 tests, tools/roster/checks
27, and config/schema/text 40. The new config regression first failed with
`unknown key: sharedFiles`; the real reader now validates C's field while
retaining whole-file role restrictions. All five compiler projects pass;
localization has zero problems and host API is regenerated by script.

All six requested merge commits have the named branch as second parent:
R `570c6922`, B `dc7f0970`, K `4adf07c8`, W `7fd7613f`, I `37c2521d`,
M96c `7df88568`. No merge, rebase or push to main occurred.

The classifier now lives only in W's `workerFence.ts`; I's argv and exact
read-only invocation guards call/re-export it. Preserve W's read-only
worktree/branch listings and I's cluster, order-file, pagination, doubled-Git
and unknown-command refusals. The new comparison suite first failed three
inconsistent safe-listing cases; the combined classifier/I/W group passes
142 and Muse/ACP/environment adapters pass 113. A relocation typo in two
refusal branches was caught and corrected before the passing runs.

Six deliberate complete-file drills fail and restore identical SHA-256:
cluster scanning (3 failing cases), wrapper client (9), doubled Git (1),
global pagination (1), shared-files reader (1), exact state-label union (1).
Receipt: `m96-int-round3b-drills.json`. Both original lane regression suites
remain intact; no guard, assertion, timeout or platform gate was weakened.

### Round 3b X2 package and final preflight

X2 adds callable `loadScheduler` and `loadRunners` factories behind the
existing team factory. They install the caller's table before use and load
`teamScheduler.js` (57.8/75 KiB) and `teamRunners.js` (44.6/75 KiB) only on
demand. Both packages contain their bundles and both native runner helpers.
The scheduler's JSON tool declarations are generated from its existing zod
boundaries, checked before every build, and unchanged in the owning tool
suite. The missing M95 Models & Agents shell and concrete window-owned
scheduler/accounting/launch/landing adapters block Traffic registration and
real team dispatch; no replacement runtime or working command is fabricated.

Lossless English encoding compares the compiled Node and browser tables,
including key order, plural forms, raw literals and joined text, with the
actual English export. uiText falls from 142.5 to 59.5/125 KiB; the initial
browser closure is 840,377 B (820.7/900 KiB). The independent 201-source
pre-M96 overlay again measures 604,810 B. Current activation is 596,609 B:
growth -8,201 B against the 4,096 B limit. All three ordinary metafiles carry
zero team/runner modules. The production resolver is shared with both startup
proofs and has an esbuild Plugin declaration rather than a type suppression.

The original seven fixtures are byte-identical to the starting branch.
However, 64 raw golden assertions fail: B inherits the main release's D78
change that offers recall_output only with packed observations and changes
cache keys. Preserve D78 pending the lead's decision; the old fixtures are
not rewritten. The single-model request proof is therefore red even though
the startup boundaries and growth proof pass.

The complete owning sweep runs 104 files in 35 batches of at most three:
2,079 pass, one fails, and two existing Windows-only runner cases skip.
The browser size drill is reconciled with the release's separate deferred
budget; its byte-restoration and green-build assertion remain intact. It
now fails at that final assertion because deferred JS is 56,885 B against
51,200 B. All other production caps pass. No existing cap, threshold,
assertion, timeout or platform guard is weakened.

The zero-clone gate found A/K settlement and two fake-journal overlaps.
One core settlement algorithm retains A's localized refusal and K's technical
failure codes; both original restart/acknowledgement suites remain. Test-only
day/refund helpers are shared. A repeat K test caught an end-write fault armed
after the real child could exit; arming the targeted fault before launch fixes
the race without changing production timing. The three settlement/lifetime
files pass 43; compiled package/startup/graph proofs pass seven. All five
compiler projects, scoped lint, deadcode, cycles, localization, host API,
zero-clone duplication, host globals, split inventory and notices pass.
PowerShell and Windows-native certification remain platform-gated for 3c.

Nine additional deliberate drills fail and restore identical SHA-256:
English decoder and expression guard, scheduler factory, generated-schema
freshness, scheduler split inventory, shared validation exports, unknown
liability, end-record retry and the single Traffic loader. With the six
reconciliation/classifier drills, there are 15. The retry mutation also produces four deliberately unhandled
errors; it is reverted byte-exact. Receipts are
`m96-int-round3b-x2-drills.json` and `m96-int-round3b-drills.json`.

The private helperless VSIX is 2,317,922 B, over the unchanged 2,252,800 B
cap by 65,122 B. It is not universal: the requested published 0.13.0 helper
is absent locally, and the shared network prohibition/artifact clarification
remains unresolved. Universal bytes are unmeasured. The private ACP archive
is 1,295,223 B; archive listings prove both new bundles and both runner helpers
are included. Neither archive is published. Machine-readable preflight:
`m96-int-round3b-results.json`. The mandatory full-quality invocation follows
the final local commit; its actual exit and tail are supplied in the final
report. This preflight does not claim full-quality certification.

The full accessibility matrix first returned no result for 17 pages: the
merged HTML loaded both the ordinary App and the Traffic root and lacked a
Traffic readiness predicate. The harness now loads one ESM entry per scenario
and waits for that surface's own marker. Five browser route regressions fail
before the fix and pass after it; deliberately restoring the competing App
loader fails all five again, then restores the HTML SHA-256 byte-exact. The
complete harness file passes 21 with only the unchanged deferred-cap failure.
The focused 20-page Traffic/runner accessibility matrix passes with zero
violations, undecided rules, exemptions or pages without a result; the full
596-page matrix passes on `db6edb6f`: 149 scenarios across four themes,
zero violations, undecided rules or missing results, and the eight existing
listbox exemptions unchanged. The harness compiler check also passes; the
final duplication scan covers 1,140 files with zero clones.

The complete-history secret scan exits 1 with seven findings in inherited
commits across two certification records and historical auth-source tests.
Only rule/file/line/commit metadata is retained. Matched text is never copied;
no scanner ignore or historical rewrite is introduced. This remains a
lead-owned release blocker, distinct from staged hook scanning.

## M96INT round 3c preflight (2026-10-05, macmini)

Branch `m96/int3c`, base `30105e49`. W final fixes at `71baf294` merge
as `9dcd95cc`; the package diet merge retains parent `be00b172`. W remains
the shared Git classifier owner, including I's earlier stricter option
regressions. No live model attempts, paid calls or pushes.

Every one of the inherited 64 runtime failures is a pre-D78 fixture
expectation. D78 FIXDEF explicitly offers packed recall only after an
observation is packed, preserving the unused request and cache key.
The product already follows that rule; nine fixtures now follow it too.
Only the unused recall declaration and its derived cache key change in
16 request bodies. Raw equality, packed recall, compaction, the team-disabled
zero-loader proof and the request builder all remain enforced. The complete
69-test golden file passes. The exact case table and request-index evidence
are in `m96-int-round3c-d78.md` and `.json`.

TeamUi lazily groups tree, cards, worker labels and the team usage section.
Shared dependencies stay charged to startup or ordinary deferred UI. The
new 25 KiB team entry follows D6; every existing cap stays fixed. Browser
startup is 875,810/921,600 B, team UI 16,088/25,600 B and ordinary deferred
51,098/51,200 B. Runtime and browser proofs use the same production
shared-wire/deferred resolver; no alternate classifier or resolver is kept.
The row rendering retains the order, values, formatting and controls.
React review checks module-scope lazy declarations, Suspense boundaries,
stable hooks, semantic dl/dt/dd pairs and existing UI accessibility checks.

Five-project typecheck passes. Focused checks pass 76 MCP, 45 paid consent,
51 team/runtime-package, 92 transcript/report/card and 22 browser tests;
the English/region/VSIX packaging batch passes 59. The combined golden,
UsageDialog and startup batch passes 116. Localization reports 14 tables,
165 manifest strings, 693 source files and zero problems. Host API and
third-party notices regenerate against the integrated tree.

The unconditional-recall drill fails exactly 64 tests; exact source
restoration returns all 69 to green. Omitting TeamTree from the accounted
team output fails the new split row, and exact metadata restoration passes.
The browser size drill pads the team chunk, sees the team UI cap fail,
restores its SHA exactly, and passes. SHA receipts and machine-readable
preflight results are in `m96-int-round3c-results.json`.

Brotli 11 took 8.9 seconds for the combined translation bytes and exceeded
the existing staging deadline. Level 10 took 3.5 seconds with a 10 KB larger
archive. Exact values, source digests, native CommonJS export discovery,
test deadlines and size caps remain unchanged. The 59-test packaging batch
passes with level 10; actual package bytes and final quality follow below.

Windows-native proof is the REDWINI96 host lane's responsibility and is
merged in round 3d. This Mac receipt does not certify Windows. The inherited
M95 Models & Agents shell and concrete runtime/accounting/launch/landing
binding prerequisites remain documented in the earlier integration record.

Round 3c package measurements pass the unchanged 2,252,800 B VSIX cap:
helperless 2,121,414 B; universal 2,204,233 B (48,567 B headroom).
The universal helper is built locally from the integrated Swift source,
contains arm64 and x86_64 slices, embeds package version 0.14.0, and passes
the real disclaimed-process SIGTERM check (143). It is not represented as
the published 0.13.0 helper. The private ACP tarball is 1,088,885 B.
Both VSIX packages include team/teamScheduler/teamRunners, the solid code
archive, both runner helpers and the emitted TeamUi browser chunk. Native
Node import and require proofs pass all 37 VSIX and 18 ACP modules. Package
SHA-256 and inventories are recorded in round3c-results; archives stay in
OS temporary storage, outside lint's repository traversal.

Initial global lint identified nine merge issues, all repaired without rule
changes: existing async paidUseQuestion callers now await/reject correctly;
ACP retains its runner-directory copy import; set difference and tuple-array
syntax follow the project rules. Reuse the hook-consent test's existing
setup instead of duplicating the team-consent setup. The affected paid suites
pass all 50, deadcode/cycles pass, and jscpd reports zero clones across 1,365
files. Production build, every size/split/host-global gate and notices pass.
The copied vendor documentation fixture remains byte-exact despite its
inherited whitespace; no citation source or formatting ignore changes.

The completed diet merge is `bd7a08be` with parents `9dcd95cc` and
`be00b172`. All eight committed worker source hashes bind the refreshed
W record, and the plan/startup/hash batch passes eight. The integrated
production bundles measure extension 437.9/600 KiB, Model API 454.3/475,
team 47.7/75, scheduler 58.2/75, runners 45.0/75 and checkpoints 76.7/225.

Own-history gitleaks passes both forms with redaction and no ignores:
`gitleaks git --redact --no-banner .` on an isolated, verified HEAD-only
bundle import in OS temporary storage (1,091 commits, zero findings), and
`gitleaks git --redact --no-banner --log-opts=HEAD .` in the worktree
(1,091 commits, zero findings). The imported HEAD equals `bd7a08be`; the
isolated repository excludes unrelated shared rig refs without modifying
any shared metadata. The ordinary command in the shared rig repository
still reaches seven historical findings, all contained only by fourteen
`refs/archive/2026-10-05/rt-*` refs, never this integration's HEAD. Archive
refs remain in `--all` even after leaving `refs/heads`. Their exact names
are in round3c-results. Shared rules restrict changes to this worktree;
the request to export/remove those shared refs remains pending. No history,
ignore, gate or shared ref is changed. The mandatory full-quality command
runs unchanged and its result follows; own-history green does not imply
that shared-repository gate is green.

## M96INT round 3c full run and late repairs (2026-10-05, macmini)

The sole requested `VITEST_MAX_WORKERS=3 npm run quality` tested
`2622fb44` and exited 1 at the coverage test stage. Format, global JS/CSS
lint, five typecheck projects, localization, host API, deadcode, cycles and
duplication passed first. The test tail is 16 failed / 573 passed / 8 skipped
files; 69 failed / 12,514 passed / 151 skipped assertions; 934.55 seconds.
It never reached build, audit, accessibility, history secrets or SAST.
This is a red full run, with no second invocation and no gate changes.

The inherited D78 failures are all closed and pass in that full run. Its
new failures and suite setup errors are separately enumerated in
`m96-int-round3c-late.json`. Two product omissions are repaired: the report's
strict packaged-frame allowlist now includes the three shipped team Node
bundles, and the paid worker palette row uses the existing localized price
consent template as its tooltip. Strict tests stay intact.

The fixture repairs add the real final TeamUi/deferred-team inventory,
an inert test-owned ACP package probe, D75's explicit team paid row, and
the async consent boundary. Portable plugin-dispatch fixtures exercise the
Linux transport with Node and its real heap limit instead of asking Darwin
to launch a Bun host that the production policy refuses; the production
Darwin refusal and the existing actual-Linux/Bun cases remain enforced.
Native retirement still uses real owned processes, signals and cleanup,
but advances only the deadline's test clock. Changing the production
5,000 ms deadline to 4,999 fails the new exact-boundary assertion; restoring
the byte-identical source passes all 17 native lifetime tests.

The remaining failures are full-profile test/hook deadlines under concurrent
coverage. Their complete prescribed scoped suites pass with at most three
files, three workers and the brief's 120,000 ms test timeout; the staging
hook keeps its original 10,000 ms deadline. No profile, isolation, coverage,
rule, skip, cap or hook deadline is weakened. The late matrix passes 510
distinct assertions across 20 files, with two existing actual-Bun platform
skips. This proves the repaired cases in the prescribed rig profile, and
does not certify a future full-profile run. PLAN §7 records that deferral.

Static checks, final packages and the unreached standalone gates are recorded
with their actual final source commit in `m96-int-round3c-results.json`.
Windows remains REDWINI96/round 3d's dependency. Shared archived refs remain
outside this worktree's authorized mutation scope while permission is pending.
