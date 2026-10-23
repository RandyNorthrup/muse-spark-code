# RLF-HYGIENE — Build and test defects found along the way (2026-10-22)

Rig: the owner's Windows PC (MINI-DT). Base: int/recovery at
397aca3ddb (main f3941b8548 plus 15 merged lanes). Branch `rec/rlf-hygiene`.

## 1. Build ignores gitignored leftovers

`npm run build` failed on three rigs on leftovers in ignored directories:
`.vscode-test/` downloads, `dist/test` dev bundles, stale `dist/`
metafiles, `dist/traffic-harness/*` harness output, and the phantom
lazy-registry rows regenerating on a dirty tree baked in.

### 1a. Lazy registry rows only what the build emits

`scripts/gen-lazy-registry.mjs` walked all of `dist/` for `.js` files and
rowed each one, so any leftover became a phantom row and `--check` failed.
Rows now come from metafile outputs that exist on disk plus the named
non-esbuild files (`dist/providerCatalog.js`, the only one
`scripts/build.mjs` writes); the walk is gone. The membership logic moved
to `scripts/lib/lazyRegistry.mjs` (`readMetafiles`, `knownBundleOutputs`,
`NON_ESBUILD_OUTPUTS`, `isStableBundle`, `forwardSlashes`, with
`scripts/lib/lazyRegistry.d.mts` declarations) and is pinned by a
maintained test over fixture metafiles in
`test/unit/lazyBundleFiles.test.ts`.

Drills (all on the production-built tree):

- Seed `dist/traffic-harness/{main,chunk-33ROSP3O,TrafficSurface-4KJ66RE3}.js`:
  `gen-lazy-registry.mjs --check` exit 1 before (3 phantom rows, the
  RLM110C failure and RLFINISH's 3 rows), exit 0 after.
- Seed `dist/test/integration/extension.test.js`: exit 1 before, exit 0
  after.
- Seed `dist/meta/stale-bundle.json` listing removed inputs/outputs: exit
  1 before, exit 0 after (`npm run build` itself wipes the meta
  directories first, so the chain was already self-healing there; the
  existence check guards direct runs).
- Generate mode on the seeded tree: no diff after (phantom rows no longer
  baked in); generate mode on the clean tree: byte-identical, no diff.
- Maintained test red drills: drop the existence check → 1 failed, exit
  1; drop the named non-esbuild outputs → 1 failed, exit 1; restored →
  16 passed, exit 0.

### 1b. Legal repo scan skips the checkout's regenerable artifacts

`scripts/check-legal-build-records.mjs` scans the whole repository; a
`.vscode-test/` with downloads blows the 20,000 directory-entry budget
(`scan stopped at limit`, exit 1). `createLegalSnapshot` takes
caller-named `exclude` directories (new optional `LegalScanRequest.exclude`,
threaded through `runLegalScan`), skipped like `.git` and `node_modules`
— expected, never incomplete reasons, outside the budget. Distribution
evidence admitted from the build records is unaffected, and absent
excludes the walk covers the whole workspace as before. The build names
its gitignored artifact dirs: `.vscode-test`, `coverage`,
`dist/acp-package`, `dist/test`, `dist/traffic-harness`, `harness-shots`,
`temp`. Pinned by a maintained `test/unit/legalScope.test.ts` case
(backslash and trailing-slash spellings included).

Drills:

- Seed `.vscode-test/vscode-seed` with 13,000 files (7,827 repo entries +
  13,000 > 20,000 budget, the shape of real VS Code downloads):
  `check-legal-build-records.mjs` exit 1 before (1 incomplete), exit 0
  after, with the same 149 info findings as the clean baseline.
- Maintained test red drill: drop the skip → 1 failed, exit 1; restored
  → 29 passed, exit 0.
- `dist/legalScan.js` 144.7 → 144.8 KiB, inside its 150 KiB budget.

## 2. M80 subcommand help text

`exec --provider` showed auth's sentence ("The provider the account
belongs to (auth set/status/clear).") and `scan-secrets --timeout` showed
the run's ("Set the run deadline in seconds … the run has no deadline of
its own."). Each route now names its own `referenceCliOptions` text
through the registry's `text` map (`exec-provider`, `scan-timeout`), in
English plus all 14 tables with real translations; the generated
reference changed exactly those two CLI rows. Pinned by a
`test/unit/cliHelp.test.ts` case asserting each subcommand shows its own
words and not the other's.

Drills: drop the text maps → 1 failed, exit 1; restored → 37 passed,
exit 0. Rendered help verified: exec `--provider` reads "Run on this
provider (Model API backend); --model is then <provider>/<model>." and
scan-secrets `--timeout` reads "Set the scan deadline in seconds; without
it the scan runs until it finishes." `check:l10n` 0 problems,
`check:reference` current.

## 3. connectorServe waits on the terminal receipt

`decidedSave` in `test/unit/connectorServe.test.ts` slept a fixed 250 ms
then read the operation state once (RLM106: 3/7 green), while the 2 s
`operation_get` poll floor forbids re-reading. It now waits on the
operation's terminal audit receipt (`settled`, `refused`, `cancelled`,
`failed`) in the connection's journal before the single read: the
settled receipt is durable before the state moves and a best-effort end
is noted after it, so the read that follows always sees the end. A
missing receipt fails loud after 4 s instead of asserting on a stale
state.

Proof: `test/unit/connectorServe.test.ts` green 10 times in a row
(exits 0,0,0,0,0,0,0,0,0,0; 6/6 each, 37–50 s per run) under this
shared rig's load with the repo's worker cap, plus one 5-file connector
batch green (29 passed).

## 4. Integration suite on stable and minimum: no change needed

The two deterministic minimum-only failures in
`test/integration/extension.test.ts` (`creates AGENTS.md in the workspace
root and opens it (D15)`; `Focus Input from a file brings the chat panel
forward (panel-focus)`) reproduce on the untouched main f3941b8548 in a
separate worktree (2 full-suite runs plus 1 file-alone run, same 2
failures each) and are gone on this base — no test or product change was
needed or made.

Mechanism, measured on main with a disposable probe and the extension
host log: test 1's `muse init` is refused mid-command when the first
`muse serve` spawn bumps the backend generation (`exit -1`, `Cancelled`
from the resource admission), and the template fallback write is refused
by the same guard; `registerLoggedCommand` swallows the failure, so the
command resolves with no file and the test dies on ENOENT. Test 2 fails
independently (still fails with test 1 skipped): the focus assertion
after a passed tab wait. Focus host code is byte-identical between main
and this base; the merged lanes' product changes resolved both.

Proof on this base: full suite green on minimum twice (52 passing,
1 pending — the intentional win32 `test.skip` in `scheduleBackground` —
0 failing) and on stable once (same totals).

## Finding for an owner (not this lane)

During the `en.ts` related run, a literal `%SystemDrive%/ProgramData/
Microsoft/Windows/Caches/` directory appeared at the repo root holding
~1 MB of copies of the real Windows font-cache files (cversions.2.db
16,384 bytes, two `{GUID}.2.ver…db` files of 309,072 and 662,488 bytes,
same sizes as `C:\ProgramData\Microsoft\Windows\Caches\`). This shell
session has no `SystemDrive` variable, so a child that leaves an unknown
`%VAR%` literal (Python `expandvars`, .NET
`ExpandEnvironmentVariables`) would resolve it against the repo root —
but no test or helper source names that path, so the writer is
UNMEASURED. Removed; needs an owner to find which suite (or child it
spawns) materializes system files outside `temp/`.

## Pre-existing, not this lane

- `npm run build` on the untouched base stops at `check-bundle-size`
  with three over-budget bundles (identical before and after this lane;
  none of this lane's code is in them): `dist/resourceAdmission.js`
  25,639 bytes against 25,600 (+39), `dist/modelApi.js` 540,355 bytes
  against 537,600 (+2,755), `dist/vaultActions.js` 25,606 bytes against
  25,600 (+6). Reported, never raised; every other step is green,
  including on leftover-seeded trees.
- `check:plan` is over budget (3,669,659 bytes against 3,565,158; this
  lane's status lines add ~700) and stays with the lead's archive pass.

## Gate exit codes (final tree)

- prettier --check on touched files: 0
- eslint --max-warnings 0 on touched files: 0
- `npm run typecheck` (all projects): 0
- `node scripts/check-l10n.mjs`: 0 (0 problems)
- `npm run check:reference`: 0 (current)
- `npm run check:host-api`: 0
- `npm run check:plan`: 1 (pre-existing over-budget, see above)
- `npm run check:roadmap`: 0 (current)
- `npm run check:catches`: 0 (no count rose)
- `npm run duplication`: 0 (0 clones)
- `npm run cycles`: 0
- `npm run deadcode`: 0
- `npm run build`: 1 (only the three pre-existing budget overages above;
  production build and every other step green, on a tree carrying
  `dist/test` and `.vscode-test/` leftovers from the integration runs)
- `npx vitest related` over the scripts/legal/cliOptions sources: 0
  (46 files, 11,854 passed, 5 skipped)
- `npx vitest related src/shared/l10n/en.ts`: 1 — 11 failed of 23,257,
  all independent of this lane: 6 EPERM symlink (this account's limit,
  named per the lane rules), 1 vaultActions budget assertion (the
  pre-existing +6 B overage), and 4 (vault broker timeout, vault
  anchor, ACP handshake message, runner EBUSY) that fail identically
  with this lane's two `en.ts` keys reverted, so no part of this diff
  causes them; their underlying cause on this shared rig is UNMEASURED
  and stays with hosted CI
- `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`: 2 — tool
  failure, not a finding (`semgrep-core rule validation failed`,
  semgrep 1.180.0 on this rig); no finding was reported
- `npm run security:audit`: 0

Commits: `e6ddb957f6` (lazy registry), `fca1b16e14` (legal excludes),
`67fdf475a5` (M80 help), `8104c819a9` (connectorServe), plus the records
commit below.
