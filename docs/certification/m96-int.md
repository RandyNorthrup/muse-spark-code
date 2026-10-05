# M96 integration — Windows 11 rig

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
**+3,912 bytes**, below 4,096. Model API is 447,899 versus 440,468;
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
