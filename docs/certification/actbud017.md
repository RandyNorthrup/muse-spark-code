# ACTBUD017 — modelsActivationBudget back under lane K's 3 KiB

Lane on `rel017/actbudget` (worktree `ACTBUD017`, from `rel017/ci-fixes`
`506ae2375`), 2026-10-08, on the Kubuntu rig. Input: REL017CI left
`modelsActivationBudget` open at +16,377 B over the immutable pre-K
baseline (allowance 3,072 B) once `1b85dc09e` made the test build with
production's plugin list (`scripts/lib/hostPlugins.mjs`). No cap, budget
line, timeout or test was changed or weakened; no model calls.

## Result

| Measure (production plugins)                    | Before    | After     |
| ----------------------------------------------- | --------- | --------- |
| `modelsActivationBudget` current bytes          | 577,228   | 552,679   |
| Growth over the pre-K baseline (560,851 B)      | +16,377   | −8,172    |
| `dist/extension.js` (`npm run build`)           | 563.7 KiB | 539.7 KiB |
| `dist/modelApi.js` (unchanged, cap 525 KiB)     | 515.8 KiB | 515.8 KiB |
| `dist/modelApiSessions.js` (new, budget 50 KiB) | —         | 37.1 KiB  |

## Module evidence

Method: `esbuild` metafiles of `src/extension.ts` built exactly as the
budget test builds it (`HOST_PLUGINS` plus the test's externals), for
(a) the 0.16.0 release tree (`4da4ef666`, `git archive` into `$TMPDIR`,
built with this head's plugins), (b) the test's own pre-K baseline and
(c) this head. Bytes are `bytesInOutput` in the activation bundle. The
`@muse-code/sdk` rows of the 0.16.0 diff net to zero (a symlinked
`node_modules` path artefact; the SDK's files are unchanged) and are left
out.

0.16.0 (515,738 B) → head before this lane (577,228 B), +61,490 B; the
modules that grew most:

| Module (activation path)               | 0.16.0 | Head   | Δ       | Why it grew (commits since 0.16.0)                                                                | Needed at activation?                                       |
| -------------------------------------- | ------ | ------ | ------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| core/backends/musecode/MuseCodeHost.ts | 28,918 | 39,826 | +10,908 | M108 account homes and command leases (`c578d50b9`, `889c8d11c`, `d29df2527`), M105 media ports   | Statically imported by extension.ts and the backend manager |
| core/schedules/sessionOwner.ts         | 0      | 4,308  | +4,308  | M115 scheduled-run owner, constructed by every MuseCodeHost (`7587dbaa3` …)                       | With MuseCodeHost                                           |
| host/processTree.ts                    | 4,735  | 9,000  | +4,265  | Playbook native hooks across worktrees (`f908a788d`)                                              | Yes (window process tree)                                   |
| extension.ts                           | 63,319 | 67,451 | +4,132  | M107 resource window/Show, schedule panel commands at activation (`04614250f`, `511e7ee86`)       | Yes                                                         |
| host/backend/fileSessionStore.ts       | 3,718  | 7,246  | +3,528  | M105 upload ownership, serialized saves and recovery (`886049603`, `10ff139c7`)                   | **No: read only by the lazy Model API host**                |
| core/context/recordingReader.ts        | 0      | 3,251  | +3,251  | M115 recorded fire context, via host/backend/environment.ts (`352ce3aa5`, `4b122bcfb`)            | Via the environment facts closure                           |
| host/backend/toolIo.ts                 | 11,527 | 14,685 | +3,158  | M105 media through read_file, M109 credential fence, exact paid caps (`e8496a1b3`, `b71be1ba7`)   | Yes (window tool io)                                        |
| host/resources/resourceWindow.ts       | 0      | 3,046  | +3,046  | M107 chip/status/Show adapter (`ed09e2b24` …), deliberately the only governor piece at activation | Yes, by design                                              |
| shared/constants.ts                    | 33,058 | 36,039 | +2,981  | INT0170/SECWINPATH/M107 constants                                                                 | Yes                                                         |
| host/settings.ts                       | 7,094  | 9,379  | +2,285  | Vault, reporting and accessibility settings (`fd0d0a580`, `33c369046`)                            | Yes                                                         |
| host/estimator/localFleet.ts           | 0      | 1,882  | +1,882  | M117 estimator ports (`cb32f94b4`)                                                                | Only in the first estimate's `ports()`                      |
| host/media/recordingLatest.ts          | 0      | 1,736  | +1,736  | M105 Linux latest-recording port (`bdd07f9f7`)                                                    | Only on a recording preview                                 |
| host/schedules/schedulesBridge.ts      | 0      | 1,499  | +1,499  | M115 schedule commands registered at activation (`04614250f`)                                     | Command registration yes                                    |
| host/media/mediaProviders.ts           | 0      | 1,393  | +1,393  | M105 media providers (`4899c7701`)                                                                | Mostly per use                                              |
| shared/l10n/exactUsd.ts                | 0      | 1,050  | +1,050  | Exact USD display (`ad8926a8e`, `b67acb738`)                                                      | Yes (paid state)                                            |
| core/vault/exec/fence.ts               | 0      | 1,048  | +1,048  | M109 credential fence (`b59bab7b2`, `889d0241f`)                                                  | Yes (spawn fence)                                           |
| core/backends/modelapi/sessionStore.ts | 5,690  | 6,680  | +990    | M105 media replay/vault provenance in stored sessions                                             | **No: with the file session store**                         |

Against the test's own baseline (pre-K `ad916bbc` sources), the largest
growth was the same MuseCodeHost (+17,807), the paid authority/consent
modules (+25 KB together), Tab's activation shim (+7,650), the browser
check's tool module (+5,846) and the file session store with its journal
(+4,677 / +2,922 / new 8,987 since K).

Exclusive bytes (what leaves the bundle if one module leaves the static
graph): MuseCodeHost 67,004; paidHost 26,741; **fileSessionStore 24,705**;
authService 16,693; cliFeatures 16,581; toolIo 15,745.

## Root fix (`f95e190a6`)

The Model API backend's file session store was built in activation
(`createFileSessionStore` in the `ModelApiBackendManager` deps) although only
the lazily loaded Model API host reads it, when that host is built.
Construction is pure (closures only), so building it at the host's first
build changes no behaviour. It could not join `dist/modelApi.js`: that
bundle has 9.2 KiB of headroom and the store with its journal is ~20 KiB
more there.

- `src/host/backend/fileSessionStoreEntry.ts` → `dist/modelApiSessions.js`
  (installs the caller's table, then builds the store).
- `src/host/backend/fileSessionStoreBundle.ts`: `lazyFileSessionStore`, the
  checked `lazyBundleLoader` binding; one store per window, made on the first
  call. A missing or damaged bundle refuses the build with
  `modelApiBundleUnavailable` (existing text, no l10n change) and the next
  build tries again.
- `ModelApiBackendManagerDeps.store` also accepts a function, called in
  `build()`; existing callers passing a store are unchanged. The best-of-N
  attempt host still gets no store.
- The process-wide session writer map (`sessionWriters`) moves with the only
  creator in the window, so writers stay shared within the window as before.
- Plumbing: build entry, size budget (37.1 KiB × 1.15 rounded up to 25 KiB =
  50 KiB, a new bundle's own budget; no existing cap touched), split guard,
  host-globals list, `.vscodeignore`, `REPORT_PACKAGE_FRAME_PATHS`, knip
  entry, notices header.

Removed from activation: fileSessionStore 7,246, sessionBudgetJournal 8,987,
modelapi/sessionStore 6,680, agentEvidence 1,103, goalRecord 375,
fifoLimiter 314; added the loader 367 (net −24,549 B).

Not done (not needed, each would touch another feature): the browser check's
call path into `dist/browserCheck.js` (~7.5–11 KB), estimator ports and the
Linux latest-recording port into their bundles (~4.6 KB), a lazy MuseCodeHost
bundle (67 KB, primary backend, needs its own failure text).

## Tests (Kubuntu rig, repository default timeout, no `--testTimeout`)

| Suite                                                                                                               | Result  |
| ------------------------------------------------------------------------------------------------------------------- | ------- |
| modelsActivationBudget, fileSessionStoreBundle (new), modelApiBackendManager                                        | 29/29   |
| teamStartup, webviewBundle, deferredBundles                                                                         | 175/175 |
| vsixPackaging, flightRecorder, resourceHostGlobals                                                                  | 140/140 |
| bundleSize, teamActivationGraph, fileSessionStore                                                                   | 81/81   |
| lazyBundle, integrationPackaging, teamHarness                                                                       | 43/43   |
| judgeActivation, gitActivationWiring, m106Wiring                                                                    | 27/27   |
| `npm run typecheck`, `npm run build`, `npm run deadcode`, `check:host-api`, jscpd, ESLint/Prettier on changed files | exit 0  |

## Drills

1. Split guard + budget: `fileSessionStoreBundle.ts` given a value import of
   `createFileSessionStore` → `npm run build` exit 1, "dist/extension.js
   carries src/host/backend/fileSessionStore.ts, which loads only with the
   Model API host"; `modelsActivationBudget` failed (growth 16,922). Restored,
   SHA-256 `cf0aee17…` verified.
2. Manager: `build()` passing `undefined` for a store function → the new
   "makes a lazy store when the host is built…" case failed (1 of 23).
   Restored, SHA-256 verified.

## For the lead

- No activation budget proposal: growth is −8,172 B against the pre-K
  baseline, 11,244 B under the allowance.
- Genuine activation growth since 0.16.0 remains +36,941 B (515,738 →
  552,679), mostly MuseCodeHost's M108/M115 fences, the process tree, the
  resource window and settings (table above); the 600 KiB cap has 60 KiB free.
- The common brief's "merge `integrate/m72-on-24ff` before finishing" step was
  not run: the rig note forbids merges this brief does not list.
