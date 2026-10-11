# M113 C-M113-6: store, workflow and release adapters — certification

Lane: C-M113-6 (Muse, kubuntu rig, worktree `/home/randy/lanes/CM1136`,
branch `c/m113-6` from `a0b69a03b`). Scope: Marketplace, Open VSX, npm,
GitHub Actions and releases from captured fixtures. No network calls were
made on this lane; every test serves bytes through the fake transport.

## What shipped (complete, tested)

- `src/core/reporting/sources/npmStore.ts`: `npmStoreAdapter(packageName)`,
  the default npm channel adapter, plus `encodeNpmPackageName`.
  - Request: credential-free `GET
https://registry.npmjs.org/<name>/latest` (no method, body or headers, so
    no token can travel; asserted exact-equal `{ url }`).
  - Wire schema reads only `version` (non-empty) from the version document
    and ignores every other field.
  - Scoped names use the captured `@scope%2Fname` form with a bare `@`.
  - Blank/whitespace names throw `npm-package-required` before any request.
- `test/unit/npmStoreAdapter.test.ts`: 14 tests (below).
- `CHANGELOG.md` `[Unreleased]` entry. No new UI strings (reason codes are
  machine codes), no `featureCatalog` rows (no new command, setting or
  feature surface), no new dependency, no bundle change (nothing in the
  shipped import graph imports the new module yet).

## Captured fixtures (certification basis)

- M97 lane R live capture, 2026-10-04 (`docs/certification/m97-r.md`):
  `GET https://registry.npmjs.org/is-even/1.0.0` answered a version document
  carrying `version: "1.0.0"`, kept verbatim (1,728 bytes) at
  `test/unit/fixtures/legalRegistry/npm-is-even-1.0.0.json`. Zero model
  attempts, zero capture requests on this lane: the bytes are reused, not
  re-captured. `GET <name>/latest` answers the same version-document shape
  for the newest release; only the captured `version` field is read.
- GitHub pulls/checks: M71's 2026-09-28 `gh api` capture
  (`test/unit/helpers/githubCapture.ts`, via `docs/certification/m71.md`),
  reused for the workflow/release-port honesty test.

## Acceptance 6 per source (this lane's evidence)

| Source                  | off → no request                                                                                                  | no sign-in gate                                                                                                 | floor/refusal names wait                                                                                                | 304 reuses cache                                         | no token                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| npm (new adapter)       | `makes no request when the network mode is off`                                                                   | n/a (public store: allowed under `whenSignedIn` without GitHub login, per existing `allows public stores` test) | `stops a refused registry dispatch and names the wait` (429 + `retry-after` → `Rate-limited until <ISO>`, one dispatch) | `reuses the captured fact on 304 with its output schema` | request exact-equals `{ url }`; `publicReportTransport` sends no `Authorization` |
| Marketplace / Open VSX  | inherited reader gate (existing `requires terminal opt-in`, `reports missing captured adapters explicitly` tests) | same as npm                                                                                                     | inherited                                                                                                               | inherited                                                | no adapter, no request                                                           |
| Actions runs / releases | `never reaches the workflow/release port when the network mode is off` (port not called, transport not called)    | existing `never dispatches when signed-in policy lacks a login`                                                 | existing `retains the reset time…` + `retains successful pulls when the floor stops…`                                   | inherited reader path                                    | port returns normalized facts, never credentials                                 |

Channel lag in Needs you: existing `collect.project.test.ts` (`puts owner
questions, lagging channels and failing default-branch CI first`, npm row
first under `1-` keys); this lane's `reports lag when the captured channel
is older` proves the lagging status the Needs-you selector reads
(`needsYou.ts` already surfaces every non-`current` channel row).

## Red drills (break the guard, see the named test fail, restore byte-exact)

Pre-drill SHA-256:

- `b20320ab0c4f988a109954a0ea4473465d17e38f7a68369f4e1ce6be47ad5b6b  src/core/reporting/sources/npmStore.ts`
- `4c4319bb122b14639325bdecadba9e6bbef5b1a1dde9f1ed061f81fc0912c308  test/unit/npmStoreAdapter.test.ts`

1. Version read → constant `"9.9.9"`: `parses the captured version document…`
   and `reports lag…` fail (2 failed, 12 passed). Restored; `sha256sum -c`
   OK for both files.
2. Factory guard → `void packageName`: all three `rejects …` cases fail (3
   failed, 11 passed). Restored; `sha256sum -c` OK for both files.

Post-drill final run: 14/14 pass at the repository's own timeout (no
`--testTimeout` flag).

## Neighbor suites (repository timeout, `--maxWorkers=3`)

- `npmStoreAdapter` + `storeReportSource` + `githubReportSource`: 64/64 pass.
- `collect.project`: 9/9 pass.
- `tsc -p tsconfig.json --noEmit` (host): clean.
  `tsc -p test/unit/tsconfig.json --noEmit`: clean after fixing one tuple
  index typing in the new test.
- `eslint --max-warnings=0` on both new files: clean after fixing one
  `unicorn/prefer-string-repeat`. `prettier --check`: clean.
- `node scripts/check-l10n.mjs`: 0 problems (no strings added).

## Stopped: true external blockers (no workaround invented)

No approved wire capture exists — and this lane was ordered to make no
network calls — for: Marketplace `extensionquery`, Open VSX `api/*`, GitHub
Actions workflow runs (`/actions/runs`), GitHub releases (`/releases`). No
default adapter for those four is shipped; their rows stay honestly
unavailable (`store-capture-required`, `workflow-release-capture-required`,
`workflow-releases-unavailable`). Only the four captures (lead-owned
N-captures handoff) remain for the lead; the npm binding is done (turn 2
above). Base files changed this lane, minimally:
`src/runtime/reporting/network.ts` (optional project parameter + npm
binding) and `src/runtime/reporting/engine.ts` (manifest read +
pass-through).

## Turn 2: engine binding (same lane, same branch)

- `src/core/reporting/sources/storeProject.ts` (new, owned): `reportStoreProject`
  parses workspace identity from the workspace package.json — name, publisher,
  `engines.vscode`, `private`, and the local `version` as the lag reference.
  Anything undeclared → `undefined` (stores stays unbound, as before). No
  registry or store shape is read here. `readStoreProject` wraps the failure
  policy (missing/unparsable manifest → unbound, never a failed report) so it
  is unit-testable without a built lazy bundle.
- `src/runtime/reporting/network.ts` (base, smallest change):
  `createReportingNetwork(context, git, project?)` binds `storesReportSource`
  with `[npmStoreAdapter(project.name)]` when a project is passed, else the
  previous unbound source. No caller changes: the parameter is optional.
- `src/runtime/reporting/engine.ts` (base, smallest change): the engine reads
  the workspace package.json through the report's confined `reportFileIo` and
  passes the parsed project into the network factory. One binding covers the
  editor, ACP and terminal paths (shared runtime engine).
- `test/unit/storeProject.test.ts` (new, owned): 17 tests — parser cases,
  `readStoreProject` failure policy, binding with/without a project (live npm
  lagging row beside `store-capture-required` rows, single npm request;
  unbound without a project with no dispatch).
- Session-only verification (not committed: the lazy `reportingNetwork.js`
  bundle loads from `dist/`, which unit-test ordering cannot assume): with a
  built tree, the exact engine glue sequence (confined package.json read →
  `readStoreProject` → `createReportingNetwork` with the real response cache)
  yields `partial` with an npm `lagging` row and honest Marketplace/Open VSX
  rows. A full `engine.reports.run` in unit tests cannot reach the network
  bundle by construction (`__dirname` is `src/`, not `dist/`), so the
  committed suite stops at the factory boundary.
- Bundle impact: `dist/reportingNetwork.js` 57.5 KiB against its 75 KiB
  budget (base: 54.1 KiB). `npm run build`'s size gate fails only on
  `dist/usagePanel.js` (75.1 KiB vs 75 KiB) — reproduced byte-identical on a
  scratch build of untouched base `a0b69a03b`, so pre-existing and out of
  this lane's scope; none of this lane's strings appear in that bundle.
- Red drills 3–4: parser forced to `undefined` fails the 3 named parser
  tests; binding forced unbound fails the named live-npm test. Both files
  restored byte-exact (`sha256sum -c` OK: storeProject
  `7d692a53…`, network `16986429…`, engine `5055c7d5…`, test `355227a1…`).

## Round 2: RVCM1136 findings, all fixed and shipped (lane CM1136R2, same branch)

Worktree `/home/randy/lanes/CM1136`, kubuntu rig, all tests at the
repository's own timeout (no `--testTimeout`). No new dependency, no widened
guard, no new UI string (`node scripts/check-l10n.mjs`: 0 problems).

| Finding                                                     | Fix (file)                                                                                                                                                                                                                                                                                           | Regression test (fails without it)                                                                                                                                                                                       | Red drill                                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| P1: npm bound but unreachable on every production transport | `src/runtime/reporting/network.ts`: `routeReportTransport` routes `api.github.com` to the surface lane (editor signed fetch / CLI `gh`) and `registry.npmjs.org` to credential-free `publicReportTransport`; anything else refused as before. GitHub sweep: its binding is unchanged, only addressed | `test/unit/storeProject.test.ts`: CLI shape (no transport) + editor `whenSignedIn` shape drive `createReportingNetwork` up to stubbed `fetch`; router test pins GitHub delegation and the `gh-endpoint-refused` fallback | Router forced npm onto the GitHub lane: 4 P1 tests fail. Restored byte-exact                              |
| P2: whitespace name fails the whole report                  | `src/core/reporting/sources/npmStore.ts`: invalid names (M97 `NPM_NAME_PATTERN` + 214 chars, beside the adapter) return a refused adapter; `src/core/reporting/sources/stores.ts`: `ReportStoreAdapter.refused` reports the row unavailable with its reason, no dispatch                             | `test/unit/npmStoreAdapter.test.ts` (refused table + row + source-reason tests), `test/unit/storeReportSource.test.ts` (refused row, no dispatch)                                                                        | Validity forced true: refused cases fail. Refused block removed: row test fails. Both restored byte-exact |
| P2: identity latched on first networked report              | `src/runtime/reporting/engine.ts`: manifest re-read and network rebound on every networked report (cache still shared by storage root)                                                                                                                                                               | `test/unit/reportEngineStores.test.ts`: version bump `1.0.0`→`1.1.0` and unbound→bound across two `generate()` calls (loader seam mocked, manifest read real)                                                            | Latch restored: both tests fail. Restored byte-exact                                                      |
| P3: encoder drops first char for any `/` name               | `encodeNpmPackageName`: scoped form only for a leading `@`; anything else is `encodeURIComponent` (`foo/bar` → `foo%2Fbar`)                                                                                                                                                                          | Property test over 7 scopes × 8 names + non-`@` cases                                                                                                                                                                    | Old encoder restored: `never borrows a scope` fails. Restored byte-exact                                  |
| P3: non-semver version blamed on the registry               | `stores.ts`: `isVersion` guards — bad local version → row/source reason `release-version-invalid`; bad served version → `store-response-invalid`                                                                                                                                                     | `it.each(['1.2','01.0.0','v1','latest'])` asserts `npm: release-version-invalid` and no `store-response-invalid`; served-invalid row test                                                                                | Guards removed: 4 version tests fail. Restored byte-exact                                                 |

Drill record: pre-drill `sha256sum` of all 8 touched files; each break ran
the named test file; every file verified `sha256sum -c OK` after restore
(final full check: 8/8 OK). Note: `prettier --write` after the drills
reformatted 4 files; the suite was re-run green afterwards.

Final runs (repository timeout, `--maxWorkers=3`): `npmStoreAdapter` +
`storeReportSource` + `storeProject` 72/72; `reportEngineStores` 2/2;
neighbors `githubReportSource` + `reportNetworkCache` + `reportEngine` 94/94;
`collect.project` + `reportNetworkBinding` + `reportsCommand` 26/26.
`tsc` host + unit clean; `eslint --max-warnings=0` clean; `prettier --check`
clean; `npm run build` clean — `dist/reportingNetwork.js` 58.8 KiB (budget
75 KiB), `dist/reporting.js` 148.1 KiB (budget 175 KiB).

## 0.17.1 truth-pass restore list

Nothing to restore: this feature was never surfaced (stores source unbound,
no Help row, command or setting removed). Once the captures land and the
engine binds project identity, surface the npm channel row with no new
wording beyond the existing channel table.
