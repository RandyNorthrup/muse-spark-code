# M98 phase 2 joins shipped phase 1 — Windows 11, 2026-10-05/06

Starting branch `m98/p2int`, `a5a1ccf7b98fdb9eede33e2b5f8174ffd937f02e`.
The explicit integration brief authorizes `git merge --no-ff main` at
`81a5ccfa7243a986a5a6901f934c89588b957bef` (0.14.1), its conflict resolutions
and adaptations to the shipped interfaces. It overrides the shared brief's
older merge and full-quality instructions. No additional merge, push, rebase,
manual stash, dependency installation, external network request, credential read,
inference, model pull or paid dispatch: **0 model attempts, $0**.

## Resolutions and callers

The merge has 57 conflicted paths. Preserve main's activation and webview
diet, shared wire/parser, English fallback regions, paid daily ledger, Tab,
support report and shipped Judge approval/UI behavior. Retain phase two's
reviewed calibration, sampling, contrastive, CLI/MCP, lint, hook, local and
use libraries with their existing evidence requirements.

- Both branches previously owned `dist/judge.js` with different factories.
  Keep phase one's `createWindowJudge` at that shipped path and phase two's
  `createJudgeFeatures` at `dist/judgeP2.js`. Adapt build/watch, split/global
  checks, runtime dispatch, notices, VSIX/ACP inventories, CI inventories and
  owning tests. Preserve the existing 100 KiB and 75 KiB caps respectively.
  Phase-two children and JSON Schema conversion remain separate lazy bundles.
- `ReviewedApprovals` retains the shipped `JudgeFence` and the separately
  admitted FU `JudgeCautionLatch`. Both are read at the synchronous reviewer
  fence, including when phase one already has caution. Either can turn ALLOW
  into a card; neither can grant approval. Preserve phase one's card note and
  discard both holders on replacement, changed subject, settlement and stop.
  Adapt the FU action to `hold.session.sessionId`, optional `turnId`, and the
  captured approval's `rawArgs` and `subject`. No production FU source is
  enabled by this seam.
- Standalone language loading uses the shipped `readUiTableFile` interface
  and compressed table archive instead of reading old loose JSON files.
  The parser entry re-exports main's shared validation surface, with phase
  two's lazy, checked JSON Schema writer retained.
- Borrowed `/workspace` foreign-hook fixtures explicitly bind their existing
  Linux platform and workspace root. Main's Windows refusal of ambiguous
  rooted POSIX paths stays intact; no wire field or schema is invented.
- The installed-Node lifecycle fixture uses IPC to exercise registered
  SIGINT/SIGTERM handlers on Windows, where `child.kill` is a force kill.
  POSIX retains real OS-signal delivery. Both platforms retain the real hard
  kill, stale private bearer and same-port restart test; Windows handler
  coverage does not certify graceful OS-signal delivery.
- Retain both phase-one and phase-two fence suites under distinct filenames.
  Keep main's isolated deferred-bundle fixtures and retain phase two's real
  production lazy-converter proof separately.
- Union the active English/translated/manifest keys with real translations.
  Remove phase two's retired `acpUsageSetup` key, which has no installed
  English/runtime reader. Preserve passive `separate`/`both`/`separate.id`
  declarations while phase one's mode resolver remains the shipped one.
- Preserve all released changelog bytes from main. PLAN is additive; move its
  inherited misplaced M98 section into milestones and consolidate its two
  Gates headings, preserving every main line after whitespace normalization.
  Regenerate notices and host inventory with their scripts.

## Gate and regression receipts

The adjacent JSON records the complete scoped sweep: **101 whole files,
3,221 distinct passing tests and 93 existing platform-inapplicable skips**.
Reruns and source drills are not added to the distinct test total. Every run
executes whole files with at most three files and
`--maxWorkers=3 --testTimeout=120000`, serially on this Windows 11 rig.
Platform-specific Linux/macOS skips remain the suites' existing conditions;
they are not Windows evidence.

| Required static check            | Final result                                                           |
| -------------------------------- | ---------------------------------------------------------------------- |
| Typecheck                        | All five projects exit 0                                               |
| Scoped ESLint and Prettier       | Exit 0; 254 supported changed/owning files in the formatting inventory |
| Cycles                           | 617 analyzed files; no cycle                                           |
| Plain knip                       | Exit 0; existing vendor/axe configuration hints only                   |
| Duplication                      | 1,281 files; zero clones                                               |
| Localization                     | 14 tables, 168 manifest strings, 644 source files; zero problems       |
| Host API regeneration and check  | Exit 0; reviewed against main                                          |
| Production build                 | All caps, splits, host globals and notices exit 0                      |
| Windows PSScriptAnalyzer and CSS | Both exit 0                                                            |

The first post-move typecheck/lint pass catches an unused factory-proof
import. Remove that import and rerun all five typecheck projects and the
complete scoped lint/format inventory green. No gate configuration changes.

The regenerated host record keeps **332 VS Code API identifiers**, **31 direct
adapter files** and **61 theme variables**. Node built-ins increase from 25
to 27 through the phase-two `events` and `readline` readers; owning import
counts reflect both phases. The record is reviewed against main, rather than
hand edited.

Four source controls deliberately short-circuit FU's read when phase one
returns caution, omit its read when phase one returns none, remove the
phase-one factory's expected export and eagerly load the schema writer.
Each whole owning file fails its named assertion, then passes after
byte-exact source restoration. The production delivery matrix also
deliberately removes and leaks implementations, exceeds unchanged caps, adds
a host global and removes package allowlist entries, checking named failures
and SHA-256 restoration.

The first full sweep runs 92 whole files. Its three failed batches expose
the borrowed POSIX fixtures, the Windows signal-driver mismatch, four grouped
eleven-control tests exceeding the unchanged 120-second deadline, and a
missing fallback guard for phase two. Keep every control but parameterize
each parent leak and missing implementation individually. Extend the existing
English fallback/import guard to the phase-two parent and all four children,
with both deliberate faults for each bundle. No timeout is raised and no
control is skipped or removed. Corrected hook and lifecycle reruns pass.
The final delivery file passes all **93 cases** in **2,680.58 seconds**,
including every new parent/child fallback fault. All **43** fixed artifact
hashes match the pristine successful production build afterward. Final
delivery/static-gate receipts are recorded in the adjacent JSON.

The synthetic Windows native lifetime check passes with 427 real replacement
processes, the nearest OS PID eight away from the exited process, and the
retained native lease refusing at exit 1. It starts no inference. The macOS
native PID file remains platform-inapplicable on this rig.

## Measured production caps

All 37 fixed artifact caps from main are byte-identical. Phase two retains its
75 KiB parent and its child/writer caps. Main's newer plugin-hooks cap remains
50 KiB, below phase two's historical 75 KiB. No cap is raised. The adjacent
JSON records all 43 fixed artifacts' exact byte lengths, caps and SHA-256s.

| Artifact                          | KiB   | Cap KiB |
| --------------------------------- | ----- | ------- |
| Extension                         | 438.5 | 600     |
| Model API                         | 446.9 | 475     |
| ACP                               | 820.6 | 850     |
| Checkpoint store                  | 76.9  | 225     |
| Phase-one `judge.js`              | 47.0  | 100     |
| Phase-two `judgeP2.js`            | 52.0  | 75      |
| `judgeLint.js`                    | 38.7  | 50      |
| `judgeHook.js`                    | 68.9  | 100     |
| `judgeLocal.js`                   | 49.7  | 75      |
| `judgeUses.js`                    | 16.2  | 25      |
| Shared validation                 | 40.5  | 50      |
| Lazy schema writer                | 22.3  | 50      |
| Browser startup including imports | 792.5 | 900     |
| Deferred webview JS               | 49.7  | 50      |

Full `npm run quality` is explicitly reserved for the 0.16.0 train by this
lane's brief; no aggregate quality result is claimed here.

## Release work that remains outside this lane

- The lead runs the full quality/coverage/accessibility and hosted CI matrix
  once on the final 0.16.0 tree, plus installed-editor and supported-platform
  receipts.
- This Windows tree has no built universal macOS dictation or local-peer
  helper. The integrated universal VSIX and its unchanged raw size cap still
  need verification with both native artifacts. The prior round-four size
  overage is historical evidence, not a measurement of this integrated tree.
- Phase-two C/E/A/I/FP, M95 integration and each source/use's required live,
  paired and borrowed-golden adoption evidence remain as recorded in PLAN and
  the prior phase-two receipts. Libraries do not imply release support.
- The shared rule's help-reference catalog/generator has not landed on either
  parent (`src/shared/featureCatalog.ts`, `scripts/gen-reference.mjs` and
  `check:reference` are absent). The existing PLAN ENVFENCE-HELPREF dependency
  remains for the release train; this integration does not invent that lane.
