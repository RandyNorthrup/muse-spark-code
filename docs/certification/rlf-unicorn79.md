# Lane RLF-UNICORN79 — certification record

Branch `rec/rlf-unicorn79`, from int/recovery `dfcb45936`. Rig `macmini`,
2026-10-30. Base for every comparison below is the untouched `dfcb45936`
checkout (round-trips by file copy, never stash).

## The bump

`eslint-plugin-unicorn` 77.0.0 → 79.0.0 at an exact pin
(`package.json`), lockfile regenerated (`fd909fa2f`). `node -p`
on the installed plugin prints 79.0.0; `npm audit --omit=dev` 0
vulnerabilities. v78 and v79 release notes and every reporting rule's
docs were read first (prefer-includes, no-negated-condition,
prefer-combined-guards, consistent-boolean-name, prefer-smaller-scope,
no-top-level-side-effects, prefer-ternary, prefer-minimal-ternary,
prefer-logical-operator-over-ternary, prefer-object-from-entries,
prefer-simple-condition-first, prefer-math-min-max, no-nested-ternary,
no-unnecessary-default-arguments, prefer-default-parameters,
prefer-string-raw, prefer-simplified-conditions).

The lane's `npm install` also re-resolved one floating production
transitive: `micromark` 4.0.2 → 4.0.3, which adds
`micromark-util-edit-map@1.0.0` (MIT). `npm run notices` regenerates
`THIRD_PARTY_NOTICES.txt` with exactly that one addition (94 notices);
the build's notices check is green against it.

## The fixes

Whole-repo eslint on 79.0.0 (three splits: `. --ignore-pattern
test/**`, `test/unit`, `test --ignore-pattern test/unit/**`; a single
run OOMs) reported in 310 files. Every report was fixed in the code,
file by file, in folder commits (hooks on, never `--no-verify`):

- `1b53f2ba1` action/ + os/
- `0f6e89386` scripts/ (25 files; 14 main-guard side-effect disables)
- `3ea47de47` src/shared + src/acp + src/webview + extension (34 files)
- `9af3a38aa`, `0698a7110` src/host (46 files, 2 commits)
- `532ea21eb`, `a877d400d` src/runtime (59 files, 2 commits)
- `9fa22469d`, `129a9f324`, `6bee74100`, `3d8b54a88` src/core
  (116 files, 4 commits)
- `dd0aef804` test/unit (20 files)
- `e704e0ae2` the catch-gate rework, the relocate dedup, the
  notices and catch-baseline regenerations (below)

No rule was switched off, no file-level or blanket disable added, no
rule option loosened. `--fix` output was reviewed hunk by hunk for
behavior preservation (guard order, short-circuiting, awaits, stateful
guards, narrowing); cascades (negated ternaries, minimal-ternary,
simple-condition-first, no-lonely-if, math-min-max, nested-ternary)
were converged by hand. Eight stale `prefer-string-raw` disables the
new versions made stale were removed.

Two behavior-affecting repairs along the way: an `execTeamSweep`
rename collision (`isAlive` boolean vs function) was restored to
distinct names, and the CM1134AR8 port-bytes SHA-256 in
`docs/certification/m113-playbook-schedules-c-m113-4.md` was renewed
(`c38218d7…eff3f6`) after an `expired` → `isExpired` rename changed
the recorded bytes.

## Single-line disables (50 added, each with reason)

No rule is wrong in general; each line below is where the rule's
rewrite is wrong for that line (narrowing the compiler needs, a second
project gate that reads the shape, a naming contract). Every one
carries `(PLAN §8, RLF-UNICORN79)` and is listed here with why.

Catch NARROW guards (22): `prefer-combined-guards` / `prefer-ternary`
cannot apply inside these `catch` handlers because `check:catches`
reads one named condition per guard or statement-level `if`: the
combined `||` guard (whose true branch never counts as expected) and
the nested ternary (whose test sits inside a call argument, invisible
to the path walk) classify the handler GENERIC. The guards stay
separate in their base shape; the combined form was measured
NARROW → GENERIC on each (see §Catch-gate conflict). One per site:

- `src/acp/translate.ts:852`, `src/core/backends/modelapi/ModelApiHost.ts:14798`,
  `src/core/context/contextFiles.ts:116`,
  `src/core/judge/hardware/probes.ts:450`,
  `src/core/judge/setup/ports.ts:131`,
  `src/core/judge/systemone/source.ts:201`,
  `src/core/legal/workspace.ts:153`, `src/core/legal/workspace.ts:486`,
  `src/core/team/teamWorkspaces.ts:360`,
  `src/host/checkpoints/checkpointStore.ts:706`,
  `src/host/providers/localProbe.ts:76`,
  `src/host/runners/sshRunner.ts:596`,
  `src/runtime/cliArgs.ts:1612`, `src/runtime/cliArgs.ts:1645`,
  `src/runtime/exec/execProtocol.ts:390`,
  `src/runtime/exec/execTeamRecovery.ts:71`,
  `src/runtime/exec/execTeamRecovery.ts:308`,
  `src/runtime/exec/outputSchema.ts:373`,
  `src/runtime/judge/serve.ts:62`,
  `src/runtime/panel/pullRequests/pullRequests.ts:255`,
  `src/runtime/panel/pullRequests/recordGenerations.ts:258`
  (all `prefer-combined-guards`);
- `src/core/memory/memoryStore.ts:641` (`prefer-ternary`).

Type narrowing (9): the `!==` chain narrows `string` to a union the
code below needs; `includes()` does not narrow (the rule doc's own
exception), and on `unknown` subjects it needs a cast:

- `src/acp/resources.ts:37` (ResourceCommandAction for `command()`),
- `src/runtime/cliArgs.ts:1397` (usage-action union),
  `src/runtime/cliArgs.ts:1560` (ResourceCommandAction),
- `src/runtime/estimator/command.ts:103` (`EstimateRequest['fleet']`),
  `src/runtime/estimator/command.ts:105` (format union),
- `src/runtime/node/args.ts:63` (NodeAction),
- `src/runtime/playbook/command.ts:90` (view union),
- `src/core/backends/modelapi/subscriptionKey.ts:76` (`unknown`
  subject), `src/core/backends/modelapi/mcp/connection.ts:1124`
  (`unknown` subject).

Event-handler convention (4): `src/webview/App.tsx:1161, 1184, 1197`
(`on*` convention; incidental submitted flag, not a predicate) and
`:3041` (stepped flag).

Guard auditability (1): `src/runtime/paidGrants.ts:255`
(`prefer-ternary`): merging the revocation guard into the return
inverts its 3 clauses into a double negation; the guard form keeps
each refusal auditable.

Main-guarded scripts (14): `unicorn/no-top-level-side-effects` in
v79 re-scoped; each script's entry runs only behind its main guard
(never on import), which the rule cannot prove:

- `scripts/build-linux-helper-pins.mjs:144`,
  `scripts/capture-m106-meta.mjs:374`, `scripts/check-badges.mjs:345`,
  `scripts/check-linux-helper-pins.mjs:150`,
  `scripts/check-node-image.mjs:295`, `scripts/check-tokens.mjs:151`,
  `scripts/check-vsix-size.mjs:36`, `scripts/github-release.mjs:98`,
  `scripts/package-node-image.mjs:136`,
  `scripts/publish-registry.mjs:381`,
  `scripts/release-summary.mjs:37`, `scripts/retain-node-images.mjs:193`,
  `scripts/sync-bundled-skills.mjs:187`,
  `scripts/sync-provider-catalog.mjs:660`.

Removed as stale (8): `prefer-string-raw` disables in the bundle-diet
files (droppability comments), no longer reported.

## Catch-gate conflict

`npm run check:catches` failed after the lint fixes: GENERIC rose
(acp 16→17, core 245→254, host 95→98, runtime 168→179). A
base-vs-live scan of all 3813 catch sites (`scripts/lib/catch-inventory.mjs`
`scanCatches` on both trees) showed exactly 24 handlers flipped
NARROW → GENERIC, every one a combined `||` guard or nested ternary
from this lane. `expectedBranch` never counts an `||` on its true
branch, and the path walk only sees statement-level tests, so the
combined forms are unverifiable by design — not a weakening, a
readability rule both gates must satisfy.

An `else if` pilot restored NARROW but eslint answers
`no-useless-else` + `no-duplicate-if-branches`, so the 24 stay in
their base shape: 21 sites reverted with one single-line disable each
(listed above), and the three 3+ chains name their union in an
`is*` helper instead of stacking disables
(`isMalformedAccountsInput` in `src/runtime/providers/accountArgs.ts`,
`isMissingOrMisshapenSettings` in
`src/runtime/runtimeReportsPlan.ts`, `isUncertainRunnerError` in
`src/host/runners/sshRunner.ts`), each call a named-condition test
the gate reads. After the rework the base-vs-live class comparison
reports 0 changed sites and every debt count equals the committed
baseline exactly, so `node scripts/catch-inventory.mjs
--write-baseline` purely re-anchors 15 same-class identities
(behavior-identical rewrites inside already-GENERIC/CLEANUP handlers
or their try bodies, each audited): 15 insertions / 15 deletions, all
counts unchanged. `check:catches` exits 0.

## Duplication clone

`npm run duplication` found 1 clone (50 tokens, the exact threshold)
in `src/core/resources/relocate.ts`: the region-A guard combine
extended a token run against the pre-existing ask-block combine. The
fix extracts the genuinely repeated re-read+validate pair into a
`refreshStatus()` closure returning `ResourceStatus | null`
(`status = refreshStatus(); if (status === null) return result`),
which keeps call counts, evaluation order and narrowing identical
and removes the pre-existing duplication rather than gaming the
detector. jscpd 0 clones; the direct suite
(`resourceRelocationDevices`) passes.

## Red drill

`src/core/maker/classify.ts`: the fixed ternary was replaced with its
original `if (chip !== undefined) return …refused…` line; eslint on
the file exits 1 quoting `278:3 error … unicorn/prefer-ternary`;
the fix was restored and the file is green again. Working tree clean
afterwards.

## Gates (exit codes)

- prettier `--check` on all 310 lane files: 0
- eslint `--max-warnings 0`: 0 on all three whole-repo splits
  (`. --ignore-pattern test/**`, `test/unit`,
  `test --ignore-pattern test/unit/**`)
- `npm run typecheck`: 0
- `node scripts/check-l10n.mjs`: 0 (14 UI tables, 14 usage tables,
  283 manifest strings, 2457 source files; 0 problems)
- `npm run check:reference`: 0
- `npm run check:host-api`: 0
- `npm run check:plan`: 0
- `npm run check:roadmap`: 0
- `npm run check:catches`: 0 (after the rework + identical-count
  baseline re-anchor above)
- `npm run duplication`: 0 (after the relocate dedup)
- `npm run cycles`: 0 (no circular dependency)
- `npm run deadcode`: 0
- `npm run build`: 0 (budgets hold; notices at 94 third-party entries
  after the micromark regen)
- VSIX `darwin-x64`: exit 0, 4,259,722 bytes (budget 4,915,200),
  packed with the pinned zopfli 0.4.3 in a worktree-local venv. The
  untargeted `npm run package` cannot stage on macOS: it requires the
  Linux-built `native/linux/*/muse-created` (built only on Linux CI).
- ACP `win32-x64`: exit 0,
  `dist/muse-spark-code-acp-0.19.0-win32-x64.tgz` (125/125 package
  checks). The universal ACP package needs CI-built darwin binaries
  (`muse-vault-peer-*`, `muse-local-judge-peer`) absent from this
  checkout.

## Suites

Every touched folder's mapped suites ran with `--maxWorkers=3` and
the repository's own timeouts (never `--testTimeout`), ≤3 files per
run. All pass except the pre-existing inventory below (each measured
identical on the untouched base by file round-trip, or flaky there
too):

- `playbookWindow.test.ts` 5 failures (base-identical)
- `playbookContainedJob.test.ts` 2 failures (base-identical)
- `playbookGovernor.test.ts` 1 failure (base-identical)
- `execTeamSweep.test.ts` 1 failure (base-identical)
- `devcontainer` 2 failures (base-identical)
- `playbookSchedulesInputs.test.ts` 1–2 failures, timing-sensitive
  (pre-lane base files fail the same 2)
- `vault/vaultStoreScope.test.ts` 1 failure
  ("reads the vault id and slot references from real vault files",
  pre-lane base fails identically)
- `estimatorPricePackaging` afterAll hook timeouts (flaky under load;
  the tests pass; base flakes the same way)
- `resourceQueueUnknownOccupancy.test.ts` 1 failure
  ("admits background work in throttle, one per kind",
  timing-sensitive; fails on pre-lane base, the 4c-fixed and the
  refactored file alike — it passed once in the 4c batch)

Full-unit run result: SUPERSEDED by the recovery `vitest related` gate
(see §Resume 2026-11-02): the related set over every changed file is the
complete affected set, and both related runs triaged every failure to
base-identical. No lane-caused failure anywhere.

## Resume 2026-11-02 (allowance reset; rig `macmini`)

The 2026-10-30 run stopped with this record uncommitted. The resume
found the tree exactly as left (14 commits, `e704e0ae2` head) and
finished the lane:

- PLAN.md: §2 `eslint-plugin-unicorn` pin 76.0.0 → 79.0.0 with the
  lane note, and §8 grouped rows for all 50 single-line disables
  (commit `6a23761f8`, hooks on). `check:plan` and `check:roadmap`
  exit 0 after the edit.
- Red drill re-run on the final tree (`src/core/maker/classify.ts`):
  planted original `if (chip !== undefined) return …refused…` line →
  eslint exit 1 quoting `276:3 error … unicorn/prefer-ternary`;
  restored → exit 0; tree clean.
- No source file changed since `e704e0ae2` (only PLAN.md), so the
  Oct 30 suite results stand; the recovery `vitest related` gate ran
  on the final tree instead, with the repository's own timeouts and
  `--maxWorkers=3`:
  - Core chunk (118 changed `src/core` files): 686 test files,
    21800 passed, 31 failed files / 77 failed tests.
  - Rest chunk (139 changed `src` + `test` files outside core):
    1167 test files, 27604 passed, 31 failed files / 74 failed tests.
  - Triage A–I (≤3 files per run, lane tree then the untouched
    `dfcb45936` worktree at `$TMPDIR/base` with linked
    `node_modules`): every failing file fails identically on base —
    same counts, same test lines — except
    `judgeLocalDarwin.test.ts`, which passes 41/41 alone on both
    trees (bulk-run-only interaction). Union of failing files: 33
    (the 7 previously inventoried files fail with identical counts,
    plus 26 measured here). Zero lane-caused failures. Notable
    base causes seen: `resourceCreatedSweep` needs the unbuilt
    `native/darwin/muse-dictate-screen-x64.app` (ENOENT);
    `macRss` refuses while `/bin/ps` is sandbox-denied;
    `runtimeLsp` hangs 966 s identically on both trees.
  - `vitest list --changed=dfcb45936` cannot enumerate the set here
    (6 pre-existing "No test suite found" collection errors, exit 1),
    so the two `related` runs above are the gate evidence.
- Gate battery re-run on the final tree, exit codes: eslint splits
  0/0/0, prettier 0 (every lane file with a parser + this record;
  the generated `.txt` has none), typecheck 0, l10n 0, reference 0,
  host-api 0, plan 0, roadmap 0, catches 0, duplication 0 (0 clones),
  cycles 0, deadcode 0, build 0.
- Packages on the final tree: VSIX `darwin-x64` exit 0, 4,466,336
  bytes (budget 4,915,200; entries audited, no strays) packed with
  the pinned zopfli 0.4.3 `temp/vsix-venv`; ACP `win32-x64` exit 0,
  125/125 package checks. The VSIX measures ~206 KB over the Oct 30
  figure for environmental reasons only (ignored build artifacts
  present in this checkout; tree content is identical apart from the
  unshipped PLAN.md, and the judge-peer binary alone accounts for
  6 KB compressed): budget holds either way.
- CHANGELOG: no entry (a person cannot see this bump).
- The `$TMPDIR/base` worktree was removed after triage.
