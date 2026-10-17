# DEFLAKE4 — Deferred-bundle split drills

Date: 2026-10-05. Base: `928a920059b9ddad9d86bb6b96adf2da8ac246a8`
(0.13.0), branch `fix/deferred-bundles-timeout`.

## Readiness and scope

The lane brief identifies two unchanged tests exceeding Vitest's 5-second
deadline on macos-latest, PR #121, shard 1, run 37338477474:
best-of-N 5,619 ms and paid reviewer 5,721 ms. These are the brief's hosted
observations; this lane does not independently recertify that hosted run.

The existing file already built once in `beforeAll`. Each of five drills
then spawned the entire split CLI twice, which repeatedly reads all
metafiles, bundle text and source files and parses the shared-validation
readers with TypeScript. Ten full scans were charged to individual tests.
Local original-file attempts additionally exceeded the unchanged 10-second
build-hook deadline; no individual local baseline timing was obtained.

Acceptance is PLAN.md D4-A through D4-D. The shared callable tooling module
is needed because importing the former CLI immediately performs unrelated
filesystem scans and can exit the process. Production declarations,
parent exclusions, destination requirements and diagnostic wording remain
canonical. The existing build imports the same three plugins as the tests.
No runtime feature, UI, wire shape, dependency, timeout, retry, platform
condition, coverage threshold or budget changes.

## Implementation

- Build real checked Node entries once per file with Esbuild's production
  plugins, minification, defines and target; ACP uses Node 22. Outputs stay
  in memory with `write: false`; support entries retain their real inline
  parser/fallback builds.
- Keep real metafile inputs and emitted bundle text as shared fixtures.
  Compile the emitted CommonJS support/activation modules with Node's VM;
  activation still proves neither action bundle is required at startup.
- Call `checkDeferredBundles` directly with cached pristine input maps and
  a fresh mutable metafile copy for each red drill. Reject the original five
  eager imports and a missing required reviewer input, restore the complete
  serialized metafile's SHA-256, then require green. After the suite, verify
  every pristine serialized fixture still matches its original bytes.

An intermediate fixture version wrote private bundles to disk: its parser
test exceeded 5 seconds, and a subsequent cached setup exceeded the hook
deadline. Keeping emitted files in memory removed that I/O. Those failed
attempts remain historical in `temp/deflake4/after-batch.json` and
`after-cached.json`; they are not passing evidence.

## Verification

### Windows parallel stress: passed

Machine: Intel Core i9-12900HK, 20 logical processors, 32 GiB RAM;
Node v24.20.0, Windows (`win32`). Ran the whole owning file 50 times,
each time concurrently with a second whole-file Vitest process. All 100
runs passed all 12 tests: 1,200 test executions, zero failures or skips.
Every pair's recorded process intervals overlap. No deadline or retry flag
was supplied. The original 5-second test and 10-second hook limits apply.

Each row has 50 measured main-run samples; durations are milliseconds:

| Test                                       | Maximum ms | Mean ms |
| ------------------------------------------ | ---------: | ------: |
| Shared parser and Node separation          |     139.33 |   52.04 |
| Activation without action bundles          |     941.15 |  708.94 |
| Board and best-of-N separation             |      11.26 |    5.59 |
| Code intelligence and voice separation     |      17.88 |    6.33 |
| Muse Code Auto reviewer separation         |      11.85 |    6.09 |
| Paid reviewer separation                   |       5.87 |    2.78 |
| Missing reviewer input red/restored        |      17.82 |    9.89 |
| bestOfNManager eager-import red/restored   |      65.12 |   32.62 |
| reviewerEntry eager-import red/restored    |      39.90 |   17.24 |
| codeIntelQuery eager-import red/restored   |      67.36 |   30.56 |
| museVoice eager-import red/restored        |      70.97 |   29.20 |
| museCodeReviewer eager-import red/restored |      51.22 |   26.03 |

The worst measured main-run test is 941.15 ms. Across all 100 main/load
runs, the maximum is 1064.19 ms; both lanes satisfy the 2-second
acceptance criterion for every test. The five eager-import split drills
range from 39.90 to 70.97 ms main-run maximum. The two brief-reported macOS
failures were 5,619 and 5,721 ms; the corresponding Windows maxima are
65.12 and 39.90 ms (means 32.62 and 17.24 ms). This is a cross-platform
observation, not a controlled speedup ratio. Local original-build-hook
failures are reported above.

Command: `node temp/deflake4/stress-final.mjs`, which invokes two concurrent
`node node_modules/vitest/vitest.mjs run test/unit/deferredBundles.test.ts
--reporter=json --outputFile=<per-run-report>` processes per iteration.
Raw reports, process overlap intervals and per-test samples are in
`temp/deflake4/stress-final/`; aggregate receipt is `summary.json`.
An earlier 50-pair development run also passed; this final table uses the
fresh run after the lint corrections. Source hashes are checked at every
pair and again at closure.

### Final source binding

| File                                | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `scripts/build.mjs`                 | `60ceeff2d8c5db08a1d55c2e5deebc2bf2b41a9f27f7e2dcd38de36efc902e25` |
| `scripts/check-bundle-split.mjs`    | `7d12564110d3e38702045c27b0bd7b97551b77e6944eb65f3da623e7d2218e24` |
| `scripts/lib/deferredBundles.mjs`   | `2261961c4ddebbfd44c10c30af04e80d005d4e3a578f6971dbc9089b6a7e0eac` |
| `scripts/lib/deferredBundles.d.mts` | `a82f6a91ec6568a6beec9402ff85f78e35f5f4c258e1c6e737114b8662cef7df` |
| `test/unit/deferredBundles.test.ts` | `2e38f7f83e3bef868e50b8949724fa1a1da72bdbbb3ab97d518112c3b144b0a0` |

### Guard-fire proof: passed on Mac mini

Mac mini, Node v24.21.0, the entire owning file without test-name filters:

| Deliberate production defect                                        | Intended observed failure                                                             | Restored result                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Replace the shared parent-input exclusion condition with `false`    | All five eager-import red drills fail their exact `carries …` assertions; exit 1      | Original helper bytes restored; all 12 tests pass, exit 0 |
| Replace the shared missing-destination-input condition with `false` | Missing reviewer-input test gets `[]` instead of its required diagnostic list; exit 1 | Original helper bytes restored; all 12 tests pass, exit 0 |

Helper before/after SHA-256 (both mutations):
`2261961c4ddebbfd44c10c30af04e80d005d4e3a578f6971dbc9089b6a7e0eac`.
Mutated hashes:
`54c7c3bbd959901260a98f9d1d89f29f6f8b525804e2e9079c9810de565acd11`
(parent),
`8d1f55bad5ff30f17539b672addd2505b1b7b595360a915df2dee43b06bb645a`
(destination). Restoration occurs in `finally`, including rejected receipts.
The first recorder invocation rejected the correct missing-input assertion
because Vitest JSON abbreviates the expected list as `[ Array(1) ]`; the
recorder was corrected to match that actual assertion and its unique test
identity. No production test expectation changed for this correction.

Also inject each of the original five eager inputs into the real production
metafile and run `node scripts/check-bundle-split.mjs`. Each case exits 1
with its specific original diagnostic, restores the metafile's original
bytes/SHA-256 in `finally`, and reruns the full CLI to exit 0. This proves
the production CLI remains wired to the directly tested guard.

Real `extension.json` before/after SHA-256:
`c5231627e3c52a11396d0f4ef27320ff7cfb3e9664959f5518becc12a7ca9def`.
Real `modelApi.json` before/after SHA-256:
`117b4d0ed83f8dc37c56f8b30625332c5025fbafdcea3742a072ccb9e060e0b5`.
All five mutations have distinct changed hashes in the receipt.

The rig harness snapshots this worktree into its private `deflake4` slot.
Logs and complete fingerprints: `temp/deflake4/macmini-drills-final.log`
and `macmini-drills.json`; remote detail is retained under the slot's
`temp/deflake4/`. Baseline and both restored whole-file runs pass 12/12.

### Scoped gates: passed

Mac mini, serial commands through the provided `rig-run.sh`:
`npm run typecheck` (all five projects), `npm run deadcode`,
`npx --no-install jscpd` (0 clones), `npm run check:l10n` (14 tables,
0 problems), `npm run check:host-api` (0 problems), and `npm run build`
(including size, full split, host globals and notices: all pass).
Logs: `temp/deflake4/macmini-*.log`, command/exit receipts `rig-gates.json`.

Production sizes (KiB), with unchanged caps:

| Bundle                                  |  Size | Cap |
| --------------------------------------- | ----: | --: |
| Extension                               | 582.1 | 600 |
| Model API                               | 429.3 | 475 |
| Checkpoint store                        |  89.0 | 225 |
| ACP                                     | 804.2 | 850 |
| Webview startup including static chunks | 877.3 | 900 |
| Shared English fallback                 | 119.3 | 125 |
| Shared validation                       |  39.5 |  50 |

Windows scoped ESLint (`--max-warnings=0`) passes for all five changed
code/declaration files. The initial two style findings were corrected to a
ternary and later constant declaration, preserving behavior. Final source
formatting is unchanged by Prettier. The fresh 50-pair Windows stress run
after those corrections passed with unchanged SHA-256 source bindings.

Merge preparation: `git merge --no-edit origin/main` returned
`Already up to date.`; the locally available `origin/main` is the named
0.13.0 base. No remote fetch, public push or pull-request mutation ran.

Full `npm run quality`, coverage and hosted macOS CI remain lead-owned under
common.md. The feature-delivery structural validator is deferred because
the canonical section-based roadmap has no `quality-ledger` fence; its
observed error was `expected exactly one quality-ledger fence`. This does
not count as a passing structural check or product certification.
