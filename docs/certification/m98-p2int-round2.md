# M98 phase-2 integration, round 2 — G CLI/MCP (2026-10-05, macmini)

Worktree `/Users/randy/lanes/M98P2INT`, branch `m98/p2int`, starting at
`b689418aa8c047e583978251dfd25c10782df723`. Read the round-2 rig brief,
its shared `codex/common.md`, AGENTS, PLAN D77/M98, the round-1 integration
record and G's reviewed repair/certification records. The specific brief
overrides the common release-candidate merge and aggregate-quality rules.
No push, main merge, rebase, stash, external request, dependency install,
credential read or live/paid/local model call was made: **0 attempts, $0**.

## Merge and conflicts

Merge **`8a6dba1813ec0a8e92367a6107882e6256d6cecd`** has parents
`b689418a` and reviewed G tip
`e3459b9e7933cdee8de29fe2d8488cc0f97555d2`. It was started with
`git merge --no-ff --no-commit m98/g2fix` and completed as a merge commit
with both repository checks enabled. G includes its previously merged
0.13.0 release/README ancestry; retaining the required tip brings those
changes too. No additional main merge was performed.

Thirteen content conflicts were resolved by meaning:

- Build workflow, `.vscodeignore`, build, size/global checks, fake packager
  prerequisites and notice generator retain both judge and release entries.
  All existing caps are unchanged. Package scripts, SBOM, knip and cycle
  entries retain the shared validation, browser and What's New inventories.
- `package.json` unions both cycle entry lists. PLAN retains both budget
  rows, Z's integration scope, M92 and both gate/deferral histories, with a
  single section 7. PRIVACY retains the judge paragraph and the release's
  default-on reviewer wording. CHANGELOG retains both histories and keeps
  the unreleased judge boundary repairs under Unreleased.
- Generated notices and host API conflicts were resolved by running their
  generators, then reviewing the diff; neither snapshot was hand-assembled.

No lane source or translation file conflicted. G's `args.ts`,
`commands.ts`, `mcp.ts` and `cliArgs.ts` retain their reviewed branch bytes.
All English/translated tables retain G's merged union, including P0's
`separate`/`both` settings, with real translations and no new text keys.

The first merged production build exposed three reads of calibration's
existing `z.lt` that the release's shared mini-parser did not export. Adding
that existing API repairs the dependency without changing B's algorithm or
weakening the split guard; validation grows from **40,416 to 40,510 bytes**
under its unchanged 50 KiB cap. The initial activation run also exposed six
fixture failures: extracting the actual paid callback now included adjacent
default-on fields. The test now extracts only its callback and supplies
default-on/explicit opt-in state. All eight assertions pass; no product
activation or paid-setting behavior was changed for this repair.

## Factory and delivery

The existing factory now exposes G's `runJudgeCommand` and `runJudgeMcp`
beside B/CS/D. Runtime judge dispatch uses `judgeFeaturesLoader`; its type
boundary carries no judge implementation. Only an explicit judge command
loads `judge.js`. After CLI initialization loads the caller's language,
calling the factory again installs that table in the separate Node bundle
before its first response. Factory object identity and missing/malformed
module retries are preserved.

The split guard requires both G implementation files in the judge bundle
and rejects them in every other shipped bundle. The build/watch, globals,
VSIX/npm, notices, SBOM, knip and cycle inventories retain the factory and
release members. ACP's SBOM explicitly includes the shipped reviewer and
validation metafiles too. No new dependency or escape hatch was added.

No real source/admission or offline/surface command adapter is fabricated.
MCP initialization and tool listing work without inference; an unavailable
source remains a no-answer/exit-4 refusal. Calibration remains callable
through B's existing injected-limit library functions, without guessing a
CLI input envelope or algorithm defaults. GH/H/J/FU, then C/E/A/I/FP after
M95, remain future rounds. Canonical D78/FIXDEF admission, independently
measured sources/calibration, installed Windows ACLs and integrated host/live
receipts are still prerequisites for their owning product surfaces.

## Byte preservation

Saved SHA-256 and sizes for the 47 merged-release JS/CSS artifacts before
wiring, then compared the production build after wiring: **45/47 are
byte-identical**. This includes extension, Model API, English fallback,
all 21 browser chunks, browser startup and every other existing host/worker
bundle. The two changed artifacts are:

| Artifact        | Before  | After   | Reason                                     |
| --------------- | ------- | ------- | ------------------------------------------ |
| `dist/acp.js`   | 841,793 | 826,428 | G implementation moves to the lazy factory |
| `dist/judge.js` | 35,465  | 46,959  | G CLI/MCP joins B/CS/D                     |

The shared-parser repair above happened before that wiring comparison and
is separately measured against the raw merge. Literal round-1 compiled
bytes cannot survive G's required 0.13.0 ancestry; this receipt does not
claim that they do. The baseline question was presented to the user and,
after an opportunity to reply, the merged-release baseline was stated and
used. The factory remains lazy and every cap stays unchanged.

A trial adding the bundle filename to shared constants changed browser
chunk hashes despite being unused there. It was removed; constants retain
their merged branch bytes, and every browser artifact matches again.

## Deliberate controls

Before exposing G, the three new built-factory tests failed by name because
CLI/MCP members were absent (9 passed, 3 failed). After wiring, the whole
file passed 12/12. Five final-source mutations also each exited 1 at their
named rejection, restored the saved SHA-256, then passed the whole owning
check at exit 0:

| Control                        | Rejection / owning check                                        |
| ------------------------------ | --------------------------------------------------------------- |
| Remove CLI factory member      | Missing-source and paid-admission built-factory tests           |
| Remove MCP factory member      | Changed-language built-MCP refusal test                         |
| Skip CLI language installation | Real subprocess French MCP refusal test                         |
| Eagerly import judge schema    | Ordinary ACP schema-laziness subprocess test                    |
| Remove shared `lt` export      | Named calibration mini-parser API failure in the complete build |

Recipes, named rejections and matching original/restored hashes are in
[m98-p2int-round2-drills.json](m98-p2int-round2-drills.json). Existing B/CS/D/G
drill ledgers remain historical evidence; they are not counted as new runs.

The delivery suite mutates actual production artifacts: 33 root leaks
(11 files × extension/Model API/ACP), 11 missing implementations, two
English-table violations, oversize, host navigator, missing artifact/npm
prerequisite and VSIX allowlist removal. These are **50 artifact mutations
checking 51 named refusals**; missing judge.js is checked by both the size
gate and npm packager. Saved bytes are restored and each affected gate is
rerun green, with full SHA-256 restoration checks. No filters, skips, rule
suppression, coverage change or timeout/config relaxation was used.

Both CI inventory bodies also ran against actual archive listings. Each
passed, rejected removal of its required judge.js entry with the named
error, then passed after restoration; both archive SHA-256 values stayed
unchanged. The npm archive was extracted in ignored scratch storage. Its
production ACP executable prints 0.13.0 and completes MCP initialization
and tool listing at exit 0, with exactly one advisory judge tool, two valid
JSON-RPC frames and zero inference. Its shared factory exposes all ten
methods. Extraction/smoke does not claim installation, signed publication
or admitted-source support.

## Final gates and packages

All commands ran directly on macmini, Node **v24.21.0**, with one heavy
gate at a time. Whole owning Vitest files used `--maxWorkers=3
--testTimeout=120000`, at most three files per invocation:

| Owning files / lane                             | Tests passed |
| ----------------------------------------------- | ------------ |
| Calibration / B                                 | 48           |
| Shared phase-2 contract and activation / P0     | 17           |
| Serve, token file and lifecycle / CS            | 82           |
| Sampling and contrastive / D                    | 32           |
| CLI args, commands, dispatch and MCP / G        | 109          |
| Built factory and production delivery / Z       | 21           |
| **Total (14 whole files, no filters or skips)** | **309**      |

The final delivery rerun passes 9/9 with the missing-artifact restoration
hash checked explicitly. After sharing the repeated language-loading
operation, both affected subprocess controls were replayed against final
source hashes and the whole dispatch file passes 6/6. The five-project
typecheck and scoped JS/CSS lint were renewed after that change.

- ESLint **287 changed TS/TSX/MJS files**, `--max-warnings=0`, exit 0;
  final runtime/delivery-test lint also exits 0. Both changed CSS files
  pass stylelint at zero warnings. No suppression was introduced.
- Prettier **396 changed files**, exit 0; report/receipt formatting and
  final whitespace checks are included in the enabled commit checks.
- Plain knip exits 0 with only existing vendor/axe-core configuration
  hints. Duplication initially rejects the nine-line runtime clone; after
  sharing the actual operation it exits 0: **979 files, zero clones**.
- Localization exits 0: **14 tables, 138 manifest strings, 495 source
  files, zero problems**. Cycles exits 0: **468 files, no cycles**.
- Host API regeneration/check exit 0: **296 VS Code APIs, 24 adapters,
  25 Node built-ins and 61 theme variables**. PLAN §§7/9 close G's stale
  snapshot deferral while preserving the original historical failure.
- Complete production build, every unchanged size cap, split/model-text
  readers, shared English/validation, host globals and **83-package
  notices** pass. Exec schema verification passes. SBOM generation reports
  **82 extension / 20 ACP shipped dependency versions**.
- The universal macOS helper rebuilds both architectures with embedded
  **0.13.0**, ad-hoc signing and a passing disclaim/lifetime test. No OS
  permission grant or model call is part of that test.
- Universal VSIX: **2,195,321 / 2,252,800 bytes**. The actual staged
  localization check, production package, hard compressed-size gate and
  actual CI inventory all pass. Production npm archive: **1,111,247
  bytes**, with its actual inventory and extracted smoke passing.

| Artifact / budgeted total   | Bytes   | Cap bytes |
| --------------------------- | ------- | --------- |
| `dist/extension.js`         | 596,865 | 614,400   |
| `dist/modelApi.js`          | 439,833 | 486,400   |
| `dist/acp.js`               | 826,428 | 870,400   |
| Browser startup JS + chunks | 899,553 | 921,600   |
| `dist/judge.js`             | 46,959  | 76,800    |
| `dist/uiText.js`            | 123,120 | 128,000   |
| `dist/validation.js`        | 40,510  | 51,200    |
| `dist/checkpointStore.js`   | 91,162  | 230,400   |

Enabled commits use the repository's lint-staged ESLint/Prettier and staged
Gitleaks commands through a worktree-local hook, with only `--no-stash`
added to honor the lane's never-stash rule. No hook, scanner rule or machine
configuration is disabled or changed. Merge hooks passed (3.44 MB scanned,
no leaks). Assembly **`db0ed643`** passed scoped ESLint/Prettier and staged
Gitleaks (49.99 KB scanned, no leaks). After those hooks, all five source
restoration hashes, all 47 final artifact hashes and both actual archive
hashes still match the recorded receipts; the worktree was clean. This
closeout changes only this certification record, with its formatting,
whitespace and enabled hooks checked at commit time.
The full aggregate quality, coverage/a11y, hosted and installed-platform
certification remain lead gates under the explicit brief. No future-round
source, hook, lint, local judge, use, panel or embedding lane was implemented.
