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
`workflow-releases-unavailable`). Binding the npm adapter into
`createReportingNetwork`/the engine needs workspace project identity (name,
publisher, engines, private, release-version reference) plumbed from the
report engine: no base file was changed for this lane, so that wiring — and
the four captures (lead-owned N-captures handoff) — remain for the lead.

## 0.17.1 truth-pass restore list

Nothing to restore: this feature was never surfaced (stores source unbound,
no Help row, command or setting removed). Once the captures land and the
engine binds project identity, surface the npm channel row with no new
wording beyond the existing channel table.
