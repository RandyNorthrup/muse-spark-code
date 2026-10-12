# M113 CM1136R3: store, workflow and release adapters — certification

Lane: CM1136 round 3 (Muse, kubuntu rig, worktree `/home/randy/lanes/CM1136`,
branch `c/m113-6`). Continues round 2 (npm adapter, review fixes); the
round-2 review covers rounds 2 and 3 together. No sub-agents. Hooks on,
explicit paths, commit output to files under `temp/`.

No network calls were made on this lane: every test serves captured bytes
through the fake transport. No paid or live model calls.

## Capture provenance (AGENTS.md rule 14)

The lead's N-captures handoff, 2026-10-11 (`~/lanes/_captures/README.md`,
receipts beside each body): 10 public unauthenticated HTTPS requests for
this lane (Marketplace extension query, Open VSX extension record, GitHub
Actions runs pages 1–2, release-workflow runs, GitHub releases pages 1–2
plus latest, GitHub tags, npm latest). This lane made 0 HTTP requests and 0
model attempts; the folders were copied byte-exact to
`test/fixtures/m113/stores/` (verified with `cmp` per folder) and every
body is checked against its receipt SHA-256 by
`test/unit/storeCaptures.test.ts`. `.prettierignore` covers the folder so
lint-staged cannot rewrite the bodies. No workspace ran (requests came from
the lead's session scratchpad; the extension did not run).

## What shipped

| Adapter                                                                                                                                                                                                                                                                                                                            | Capture used                                                                                                                                                                                                                                 | Tests                                                                                                                                                                                                                                                                                                                                                  | Drill                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketplaceStoreAdapter` (`src/core/reporting/sources/marketplaceStore.ts`): query-form POST (`?api-version=3.0-preview.1`, body filterType 7 / flags 513 with the workspace `<publisher>.<name>`), reads `results[0].extensions[0].versions[0].version`                                                                          | `marketplace-extensionquery`                                                                                                                                                                                                                 | `marketplaceStoreAdapter.test.ts` (7): exact request equals the captured request body; captured answer reads `0.17.0`; lag vs `0.17.1`; empty extensions refuses `marketplace-not-listed`; three bad shapes blame the document                                                                                                                         | D1: version read → constant `9.9.9`: 2 failed, 5 passed; restored, SHA OK                                                                                       |
| `openVsxStoreAdapter` (`src/core/reporting/sources/openVsxStore.ts`): `GET /api/<publisher>/<name>`, reads `version` only                                                                                                                                                                                                          | `openvsx-extension`                                                                                                                                                                                                                          | `openVsxStoreAdapter.test.ts` (4): exact GET; captured record reads `0.17.0`; 404 refuses as `http-404` with no body parsed; version-less body blames the document                                                                                                                                                                                     | covered by D1's sibling path (same `version`-only contract as npm, drilled R2)                                                                                  |
| `githubWorkflowReleasesPort` (`src/core/reporting/sources/githubWorkflowReleases.ts`): tags to commits; final releases (`version` = verbatim `tag_name`, `at` = `published_at`, asset names; commit joined from `/tags`, `target_commitish` ignored); `release.yml` runs as `release-tag` CI (`head_branch` joined to a known tag) | `github-tags-page1`, `github-releases-page1`, `github-workflow-release-runs` (byte bodies; `/releases-latest` asserted equal to page 1 `[0]`; R4 also parses the `github-releases-page2` body in `parses the second captured releases page`) | `githubWorkflowReleases.test.ts` (7): captured read gives `v0.16.0`/`v0.17.0` releases with tag commits and 16/12 assets plus both `Release` runs as `release-tag` facts; exact page-number URLs (`tags 100`, `releases 30`, `runs 100`); no page 2 requested; page-bound refusal past the shared budget; five refused shapes each with its own reason | D2: dropped null-conclusion throw: 1 failed, 6 passed; restored, SHA OK. D5: releases page size 30 → 100: exact-URL test failed; restored, SHA OK               |
| npm row decision (`src/core/reporting/sources/stores.ts`): the row means the workspace's own published package (PLAN M113 §6); a private manifest publishes none under its own name, so its row refuses `npm-private-manifest` with no request, even when an adapter is bound                                                      | `npm-latest` (proves the published name `muse-spark-code-acp` comes from the ACP agent's generated manifest, which is not in the workspace to read, so no hard-coded rename)                                                                 | `storeReportSource.test.ts`: private extension shows the refused npm row beside working gallery rows with 2 transport calls                                                                                                                                                                                                                            | D3: removed the refusal: 1 failed, 19 passed; restored, SHA OK                                                                                                  |
| Hosts: allowlist unchanged (the four hosts already cover every adapter)                                                                                                                                                                                                                                                            | all ten (no new host requested)                                                                                                                                                                                                              | `reportAdapterHosts.test.ts` (6): each adapter's request form dispatches; an unlisted host refuses `endpoint-refused`; a POST off the gallery query path refuses `read-method-refused`                                                                                                                                                                 | existing reader-gate tests unchanged and green                                                                                                                  |
| Fixture integrity                                                                                                                                                                                                                                                                                                                  | all ten folders                                                                                                                                                                                                                              | `storeCaptures.test.ts` (12): exact folder list; every body vs receipt SHA-256 + byte count; `/latest` equals page 1 `[0]`                                                                                                                                                                                                                             | D4: one-byte tag change in the releases body: receipt test and latest-equality test failed (2 failed, 10 passed); restored from the captures with `cmp`, SHA OK |

Supporting changes: `REPORT_NETWORK_MAX_PAGES` 3 → 10 (one github read
shares the budget across pulls, three check scopes, tags, up to three
release pages and runs; past it refuses `page-bound`), new
`GITHUB_TAGS_PAGE_SIZE` 100 / `GITHUB_RELEASES_PAGE_SIZE` 30 /
`GITHUB_WORKFLOW_RUNS_PAGE_SIZE` 100 (a 100-record release page at the
larger captured size would exceed the 2 MiB bound), `github.ts` keeps a
refused shape's own reason instead of the generic
`workflow-releases-unavailable`, production `network.ts` binds every
adapter and the port, README/CHANGELOG updated (the "await captures"
lines are now false).

## Refused shapes (owed captures, never guessed)

- A workflow run with a null conclusion → `run-conclusion-required`.
- A release-workflow run on something that is not a known tag →
  `run-release-tag-required`.
- A draft release → `release-draft-refused`; a prerelease →
  `release-prerelease-refused`.
- A release whose tag names no commit → `release-commit-required`.
- The Marketplace not-listed answer → `marketplace-not-listed` (only the
  empty-extensions array of the captured shape is asserted).
- An Open VSX 404 → `http-404` (reader status; the 404 body was not
  captured and is never parsed).

## Kind-table rows now real, and what 0.17.1 withdrew

PLAN M113 §6 D93.4 rows that consume these adapters:

- `project`: the channels section reads live Marketplace / Open VSX / npm
  versions with lag, and the releases section gains GitHub release
  candidates beside git, changelog and plan.
- `release <version>`: every channel carries its served version, the
  assets section carries GitHub asset names with tag commits, and CI on
  the tag reads the release workflow's runs (previously impossible twice
  over: no port existed, and the release-tag check-runs query always lost
  the page budget).
- `quality`: the all-runs CI section additionally lists release-workflow
  runs. `changes` and `milestone` keep their existing pulls/checks
  behavior.

What 0.17.1 withdrew (base `35d7b6f54`, the 0.17.1 base), to restore when
this lane is accepted:

1. Production `createReportingNetwork` bound the stores source as fully
   `unbound` (`network.ts:140`) and built the github source with no
   `additional` port, so every project/release channels section rendered
   unbound and every networked github read carried
   `workflow-release-capture-required`. This lane rebinds both in
   `network.ts` (`storeAdapters`, `additional: githubWorkflowReleasesPort()`).
2. The source-level refusal pins stay valid and green: unbound channels
   still report `store-capture-required`
   (`storeReportSource.test.ts`), and a missing port still reports
   `workflow-release-capture-required` (`githubReportSource.test.ts:182`).
   Only production behavior changes.
3. Nothing else in the 0.17.1 tree pins unavailability: no README,
   reference or truth assertion beyond the composition and the two unit
   pins above was found (`git grep` over the base).

## Neighbor suites and gates (repository timeout, `--maxWorkers=3`)

- New files: storeCaptures 12/12, marketplace 7/7, openvsx 4/4,
  workflowReleases 7/7, adapterHosts 6/6.
- Neighbors: storeReportSource + npmStoreAdapter + githubReportSource
  88/88; storeProject + reportEngineStores + storeCaptures 34/34.
- `tsc -p tsconfig.json --noEmit`: clean.
  `tsc -p test/unit/tsconfig.json --noEmit`: clean.
- `eslint --max-warnings=0` on all touched files: clean.
  `prettier --check` on all touched files: clean.
- `node scripts/check-l10n.mjs`: no strings added (reason codes are
  machine codes, as in round 2).
- Bundle caps unchanged and unraised. `npm run build` reaches the size
  gate with every reporting bundle inside budget (`reportingNetwork.js`
  58.8 → 61.9 KiB of 75; extension 550.7 of 600; modelApi 515.8 of 525)
  but exits 1 on a pre-existing overage: `dist/usagePanel.js` 75.1 KiB
  against its 75 KiB budget, byte-identical at the lane base `de8c8559d`
  (scratch build in `$TMPDIR`, same `OVER` line; the bundle contains none
  of this lane's constants). Recorded as a finding for the lead, not a
  lane regression: no cap was raised and no reporting bundle is over.
- `npm run check:reference`: no new command, setting or feature surface
  (adapters are data bindings, not surfaces); catalog untouched.

## Red-drill record

Pre-drill hashes in `temp/cm1136r3-drill-sha.txt`; every file verified
with `sha256sum -c` after its restore (5/5 OK), and the tampered fixture
with `cmp` against the rig captures.

1. D1 `marketplaceStore.ts` version → `"9.9.9"`: `reads the served
version…` and `reports lag…` fail (2 failed, 5 passed).
2. D2 `githubWorkflowReleases.ts` null-conclusion throw removed: the
   null-conclusion refusal test fails (1 failed, 6 passed).
3. D3 `stores.ts` private-npm refusal removed: `refuses npm for a private
extension…` fails (1 failed, 19 passed).
4. D4 `github-releases-page1/response.body.json` one-byte tag change: the
   receipt-hash and latest-equality tests fail (2 failed, 10 passed).
5. D5 `GITHUB_RELEASES_PAGE_SIZE` 30 → 100: the exact-URL read test fails
   (1 failed, 6 passed).

No `eslint-disable`, `@ts-expect-error`, `any` or non-narrowing `as`
added (test casts narrow `JSON.parse` output exactly like the existing
`NPM_CAPTURED_DOC as object`); no PLAN §8 row owed. No l10n, reference,
roadmap or host-API change. Time box held.

## R4 (RVCM1136B fixes, 2026-10-11)

Lane CM1136R4, same worktree/branch (`c/m113-6`). Every RVCM1136B finding
(P1, P2, P3) is fixed with no residuals; no guard widened, no new
dependency. No network calls on this lane; no paid or live model calls.

| Finding                                                                    | Fix                                                                                                                                                                                                                                                                                                                                                                             | Regression test (fails without it)                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1: Marketplace and Open VSX bound but refused by the production transport | `routeReportTransport` (`src/runtime/reporting/network.ts`) sends `marketplace.visualstudio.com` and `open-vsx.org` down the credential-free public fetch beside npm (hosts exported from the adapter modules; reader allow-list, gallery-POST rule, consent and size bounds unchanged; GitHub keeps its lane so no editor credential reaches a gallery)                        | `test/unit/reportProductionTransport.test.ts` (6): one table-driven read of every bound store, workflow and release adapter through `createReportingNetwork` with only fetch faked by the committed captures, asserting a parsed row per adapter plus the exact captured Marketplace POST with no credential |
| P2: one refused release or run dropped every release row                   | `githubWorkflowReleasesPort` skips each refused/unparseable record with its own reason (new `release-response-invalid`, `run-response-invalid` beside the five existing codes) while the other rows stay; a failed runs read keeps the parsed releases with the fetch reason; the port returns its distinct reasons and `githubReportSource` joins them into its partial reason | `test/unit/githubWorkflowReleases.test.ts`: seven one-bad-record cases spliced into the full captures, a 404 runs read keeping both releases, and the page-bound case keeping both releases                                                                                                                  |
| P3: this record said no second release page was captured                   | Correction: `test/fixtures/m113/stores/github-releases-page2/` (`per_page=2`, receipt hash-checked) existed all along. What stays uncovered is multi-page _assembly_ across two fetched pages: both captured release pages are short at the production size of 30, so pagination never advances past page 1 in the suite                                                        | `parses the second captured releases page`: the page-2 body parses (v0.15.0 with its tag commit and 8 assets; v0.14.5 names no captured tag, so that row is partial with `release-commit-required` while v0.15.0 stays)                                                                                      |

Fallout of the P1 fix, same round: `storeProject.test.ts` now serves
gallery 404s from its fake fetch (the channels reach the network and are
honestly missing there, instead of refused before it) and asserts all
three public-fetch URLs; the GitHub-lane test additionally pins the
gallery POST form through the router.

## R4 red-drill record

Pre-drill hashes kept under `$TMPDIR`; every file restored byte-exact
(`sha256sum` match after restore).

1. D6 `network.ts` gallery hosts removed from the public route: the new
   production-transport suite fails 4/6 and `storeProject` fails 4/20
   (the npm row goes too, because every row is then unavailable).
2. D7 `githubWorkflowReleases.ts` draft refusal back to a throw: `a draft
release keeps the other rows…` fails (1 failed, 10 passed).
3. D8 `parses the second captured releases page` expected version forced
   to `v9.9.9`: the test fails (proving the new assertion fires).

No `eslint-disable`, `@ts-expect-error`, `any` or non-narrowing `as`
added. No l10n, reference, roadmap or host-API change.

## R5 (RVCM1136D fixes, 2026-10-11)

Lane CM1136R5, same worktree/branch (`c/m113-6`). Every RVCM1136D finding
(P2, P3) is fixed with no residuals; the read is redesigned instead of
patched. No network calls on this lane; no paid or live model calls. No
new dependency; no guard widened.

Correction to R4: its "no residuals" sentence overclaimed the tag-page
path (RVCM1136D P2). The contract below replaces it: the suite now fails
a failed second tag page on purpose and keeps the page-1 rows.

| Finding                                                                                                                                                | Fix                                                                                                                                                                                                                                                                                                                                                | Regression test (fails without it)                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2: a failed later tag page threw before `/releases` and the runs read, blanking every release and release-run row                                     | `readElements` returns per-page results instead of throwing: each tag, release and run page records its own paged refusal (`tags-page-2: http-500`) and pagination continues past it; only the shared page bound ends the walk. The assembly keeps rows from every request that succeeded (`src/core/reporting/sources/githubWorkflowReleases.ts`) | `test/unit/githubWorkflowReleaseIsolation.test.ts`: ONE property test over 6 requests × 5 ways (HTTP error, invalid JSON, oversize body, timeout, refused host) asserting the surviving rows stay and the partial reason names exactly the failed page; plus the request-list gate (a new request without a case fails `covers exactly the read's own request list`) |
| P3: an unparseable tag was dropped with no reason of its own (surfaced, if at all, as `release-commit-required` on another record)                     | Tag page reasons join the port's own; tag names are read off corrupt elements, and a release or run whose tag was corrupt or whose tag page failed is skipped silently — its cause already named — never with a substitute blame                                                                                                                   | `a corrupt tag keeps its own reason…` (review scenario verbatim) and `a corrupt extra tag…is partial, never ok`                                                                                                                                                                                                                                                      |
| Unconfirmed note: a row passing the loose port shape but failing the strict fact shape threw away the whole section as `workflow-releases-unavailable` | `githubReportSource` validates each additional row against the strict shape and skips failures with `release-response-invalid` / `run-response-invalid`; only a misshapen envelope stays generic (`src/core/reporting/sources/github.ts`)                                                                                                          | `a row failing the strict fact shape is skipped…` via a stub port                                                                                                                                                                                                                                                                                                    |

## R5 red-drill record

Pre-drill hashes in `temp/cm1136r5-drill-sha.txt` (removed after the
round); every file verified with `sha256sum -c` after its restore (3/3
OK each round).

1. D9 `githubWorkflowReleases.ts` tag throw restored: all 10 tag-page
   property cases fail (10 failed, 24 passed); restored, SHA OK.
2. D10 tag page reasons dropped from the port's list: the 10 tag-page
   property cases plus both P3 cases fail (12 failed, 22 passed);
   restored, SHA OK.
3. D11 `github.ts` assembly back to one whole-parse: the strict-assembly
   test fails (1 failed, 33 passed); restored, SHA OK.

Neighbor suites green at the repository timeout (`--maxWorkers=3`):
`githubWorkflowReleases` + `githubReportSource` +
`reportProductionTransport` 53/53; `storeReportSource` +
`storeProject` + `reportEngineStores` 42/42; new isolation file 34/34.
`tsc` (src and unit), `eslint --max-warnings=0`, `prettier --check` and
`node scripts/check-l10n.mjs` clean; no user-visible strings added
(reason codes are machine codes). `npm run build`: every reporting
bundle inside budget (`reportingNetwork.js` 61.9 → 63.3 KiB of 75;
extension 550.7 of 600; modelApi 515.8 of 525) with the same
pre-existing `dist/usagePanel.js` 75.1 KiB overage R3 recorded
(no file this lane touches feeds it).

No `eslint-disable`, `@ts-expect-error`, `any` or non-narrowing `as`
added (test casts narrow `JSON.parse` output exactly like the existing
suites). No l10n, reference, roadmap or host-API change. Time box held.

## R6 (RVCM1136E fixes, 2026-10-11, Kubuntu)

The R5 preservation and request-coverage claims were too broad. Its property
suite raised the request cap to twelve and compared requests with a separate
URL table, so it missed both cross-endpoint budget theft and a missing fault
case. This round first wrote the invariant over the source's actual reader,
record, adapter, validation and bound boundaries, and observed the original
code fail (118 failed, 7 passed). Source changes followed that red run.

A failed page now ends its endpoint immediately. Previously accepted facts
and reasons remain; unknown later pages are not probed, and healthy endpoints
keep the ten-request production allowance. Ordinary stream and decode errors
are the failed page's shape refusal, including TypeError and invalid UTF-8.
The same admission rule covers sibling pulls/checks and the additional port:
records validate independently, a null/undefined facet is named unavailable,
valid adapter reasons survive malformed neighboring reasons, conflicting facts
keep the first accepted fact with a conflict reason, and rows beyond bounds
are refused at admission. The final source schema retains its original strict
validation and row caps; it no longer discovers an oversized accepted array.
No shared transport, timeout, cap, dependency, hook or gate is widened.

| Finding                                                             | Fix                                                                                                                                                          | Regression                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2 body/decoder failure discarded successful workflow/release pages | `readElements` catches every page read/decode failure and returns its page reason with accepted rows                                                         | Every observed request × HTTP, JSON, byte bound, transport exception, null body, invalid envelope, invalid UTF-8, stream TypeError and egress refusal in `githubWorkflowReleaseIsolation.test.ts`                                                                                                    |
| P2 a failed page spent another endpoint's allowance                 | Failed endpoint stops immediately; the property uses production's ten requests, HEAD on two pages and default-branch checks                                  | `a failed releases-page-2 (...) keeps the other rows and names exactly it`: 100 earlier workflow rows plus both healthy captured second-page runs remain                                                                                                                                             |
| P3 request-list coverage missed removed cases                       | Compare actual transport URLs with CASES targets and assert both case and request uniqueness; count reader/parser call sites from a TypeScript AST inventory | `covers exactly the read’s own request list`; `inventories every reader and validation call from the code`                                                                                                                                                                                           |
| Same-class sibling boundaries                                       | Strict row admission, independent adapter facets/reasons, first-fact conflict retention, page row admission and bounded final assembly in `github.ts`        | Every record position in every result; every cache read/write; absent/failed adapter; missing facets; malformed reason record; combined runs/release row limits; conflicting facts; invalid check pagination metadata; every shared request cutoff; two simultaneous failures retaining both reasons |

The synthetic pages extend captured field shapes solely to drive pagination;
no new upstream field or shape is claimed. The fixtures and receipts remain
unchanged. The source inventory counts repeated calls, so another call to an
existing reader/parser still requires a case. The request gate uses the cases
that actually generate faults, so removing a case fails it. Per-record tests
are separate default-timeout cases sharing one healthy baseline: an exploratory
loop-based version exceeded 5 seconds and was split without raising a timeout.

No new assertion escape hatch, lint suppression or dependency. The two changed
portable modules apply unchanged to VS Code, CLI/ACP and native bridge report
composition; no host-specific code or UI surface was added.

The final-validation sweep also found a valid empty additional facet being
marked unavailable when all baseline readers failed. The new `retains a valid
empty adapter facet beside failed readers` test failed before the correction
(1 failed, 497 passed), then the source marks a validated empty facet as an
observation while retaining all earlier reasons. The inventory includes the
three array-facet validations and all final array bounds, alongside reader and
parser calls; adding another such boundary requires a matching case.

The tag sweep strengthens every record-position case to require only its own
`tag-response-invalid` reason when the refused tag has no readable name.
Before the correction, 102 cases blamed healthy dependent releases/runs as
`release-commit-required` / `run-release-tag-required` (102 failed, 484 passed).
A nameless refusal now marks the join incomplete, preserving the accepted
rows and its own reason. Every asset position inside both synthetic and
captured release pages is also faulted; an unparseable release record is
refused on its own while every neighboring fact remains.

The page-bound assertions also require the surviving rows and exact reasons,
not merely a bound label. Before correction, 8/10 oversized-page cases spent
another endpoint's allowance or probed an unknown page (8 failed, 578 passed).
Each endpoint now admits only its bounded prefix, records its page row bound,
and stops. An oversized tag page marks the join incomplete, preventing false
blame on missing tag joins. All production request/byte/row caps remain fixed.

The conflict sweep also proves distinct tuple identities whose text contains
`/`: two valid run facts previously collapsed into one conflicting key
(1 failed, 586 passed). Keys now serialize the complete identity tuple, so
separators in a tag/workflow cannot discard an independent accepted fact.

## R6 final drills and certification

Implementation commit: `087ae77a7561d7cde6f991869b75b157cd765992`.

Each mutation below ran the complete isolation file at the repository timeout
and failed a named assertion. D22 also ran `githubReportSource.test.ts`.
After every run, both source modules and the isolation test were restored
byte-exact and checked with SHA-256 (3/3 matches for each of the 17 drills).
The subsequent dependent-suite run rechecked the restored implementation.

| Drill            | Deliberate break                                                    | Named failing assertion (representative)                                      | Red result                          |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| D12-body         | Rethrow ordinary stream/decode failures                             | a failed tags-page-1 (invalid-utf8) keeps the other rows and names exactly it | Tests 31 failed / 556 passed (587)  |
| D13-budget       | Continue a failed endpoint, retaining its page-bound stop           | a failed tags-page-1 (http-error) keeps the other rows and names exactly it   | Tests 59 failed / 528 passed (587)  |
| D14-cases        | Remove the tags-page-1 fault case while retaining its transport URL | covers exactly the read’s own request list                                    | Tests 1 failed / 472 passed (473)   |
| D15-row-bound    | Allow one extra assembled row before refusal                        | enforces the $field row bound on admission before final validation            | Tests 2 failed / 585 passed (587)   |
| D16-facets       | Reject the complete adapter envelope for one missing facet          | isolates the runs adapter facet including null/undefined                      | Tests 4 failed / 583 passed (587)   |
| D17-records      | Throw on one invalid strict fact instead of refusing that row       | a row failing the strict fact shape is skipped while the other rows stay      | Tests 1 failed / 586 passed (587)   |
| D18-page-bound   | Remove the workflow/release page row-bound guard                    | enforces the page row bound at tags-page-1                                    | Tests 6 failed / 581 passed (587)   |
| D19-conflicts    | Throw on a conflicting fact instead of keeping the first fact       | names conflicting facts without discarding the accepted rows or reasons       | Tests 1 failed / 586 passed (587)   |
| D20-count        | Drop the malformed check-count reason                               | preserves check records when their pagination count is invalid                | Tests 1 failed / 586 passed (587)   |
| D21-inventory    | Add an allowed-reader call without an inventory case                | inventories every reader and validation call from the code                    | Tests 1 failed / 586 passed (587)   |
| D22-snapshot     | Remove the refusal when every source lacks a valid observation      | has no successful snapshot when every HTTP source fails validation            | Tests 1 failed / 622 passed (623)   |
| D23-reasons      | Throw on one invalid adapter reason record                          | retains valid reason records beside an invalid one                            | Tests 1 failed / 586 passed (587)   |
| D24-empty        | Remove valid-empty adapter facet observation marks                  | retains a valid empty adapter facet beside failed readers                     | Tests 1 failed / 586 passed (587)   |
| D25-wire-records | Throw on one invalid wire element                                   | a corrupt tag keeps its own reason and is never blamed on another record      | Tests 327 failed / 260 passed (587) |
| D26-unnamed-tag  | Mark a nameless refused tag as a complete join                      | isolates record 0 at tags-page-1                                              | Tests 102 failed / 485 passed (587) |
| D27-bound-stop   | Continue an oversized page in all paginated endpoints               | enforces the page row bound at pulls-page-1                                   | Tests 8 failed / 579 passed (587)   |
| D28-identity     | Restore slash-spliced run identity keys                             | keeps distinct facts whose identity text contains separators                  | Tests 1 failed / 586 passed (587)   |

The first exploratory D13 mutation also continued after the terminal page
bound, creating a nonterminating loop. Its own Vitest processes were stopped
and all three files restored and hash-checked. That aborted attempt is not
credited as a red drill; D13 above is the corrected, terminating mutation.

Restored SHA-256 values:

- `src/core/reporting/sources/github.ts`: `b4e790d1430b30a46a08ceb451f2bca861dffd84688cdcc962e6055181e49774`.
- `src/core/reporting/sources/githubWorkflowReleases.ts`: `d12eacd312103d15ac4dd1a79f45b69d53851a8fb2c0697febb1cf36b684067b`.
- `test/unit/githubWorkflowReleaseIsolation.test.ts`: `58c26bb71e6b5fabfaa72b36f36c8c963de21f77b60b3a5a473136882416d323`.

All verification below ran directly on Kubuntu, with one Vitest/tsc/eslint/build
process at a time, at most three Vitest files/workers per run and no timeout
override. No paid/live calls
or real editor application launches were made.

- Owning suites: 634/634 passed (`githubWorkflowReleaseIsolation` 587,
  `githubReportSource` 36, `githubWorkflowReleases` 11).
- `npm run typecheck`: all five projects passed before the implementation
  commit (host, webview, unit, e2e and integration).

| Final suite batch | Result                                                              | Exit |
| ----------------- | ------------------------------------------------------------------- | ---- |
| related-1         | Test Files 3 passed (3); Tests 69 passed (69)                       | 0    |
| related-2         | Test Files 3 passed (3); Tests 634 passed (634)                     | 0    |
| related-3         | Test Files 1 failed / 2 passed (3); Tests 1 failed / 29 passed (30) | 1    |
| network-hosts     | Test Files 3 passed (3); Tests 72 passed (72)                       | 0    |
| host-surfaces     | Test Files 3 passed (3); Tests 32 passed (32)                       | 0    |
| panel-engine      | Test Files 3 passed (3); Tests 48 passed (48)                       | 0    |
| reports-e2e       | Test Files 1 passed (1); Tests 22 passed (22)                       | 0    |

The three related shards are the complete selection for
`npx vitest related --run src/core/reporting/sources/github.ts
src/core/reporting/sources/githubWorkflowReleases.ts --shard=N/3 --maxWorkers=3`.
All nine dependent unit files ran: `githubReportSource`,
`githubWorkflowReleaseIsolation`, `githubWorkflowReleases`, `npmStoreAdapter`,
`paidMoneyStructure`, `reportNetworkBinding`, `reportPosting`,
`reportProductionTransport` and `storeProject`.
Additional unit batches ran `reportNetworkCache`, `reportAdapterHosts`,
`storeCaptures`; `reportsHost`, `acpReports`, `reportsCommand`;
`reportingPanel`, `reportEngineStores`, `storeReportSource`.
The end-to-end file was `test/e2e/reports.e2e.test.ts`.
These cover the shared network,
captured stores, editor panel, VS Code host, ACP and CLI/runtime host bindings,
report composition and the fake-only end-to-end reports path.

| Scoped gate       | Exit |
| ----------------- | ---- |
| eslint            | 0    |
| prettier          | 0    |
| deadcode          | 0    |
| duplication       | 1    |
| l10n              | 0    |
| host-api          | 0    |
| reference         | 0    |
| roadmap           | 0    |
| build             | 1    |
| dedup-typecheck   | 0    |
| dedup-isolation   | 0    |
| dedup-eslint      | 0    |
| dedup-duplication | 1    |
| bundle-split      | 0    |
| host-globals      | 0    |
| notices           | 0    |

The final duplication gate exposed one new repeated damaged-page setup.
It was extracted into the existing isolation file without changing any
assertion, guard or case. The full 587-case file and all five typechecks
were rerun after that cleanup. A byte-exact base-file comparison proves
the project already had 23 test clones; the final full gate retains 19
inherited clones and no new clone from this round. PLAN §7 records this
bounded integration deferral without changing the zero-clone threshold.
The SHA-256 values above identify the exact pre-cleanup drill restores;
the later test cleanup is separately verified by the final test run.

The only nonzero related result is the inherited exact-money guard in
`paidMoneyStructure.test.ts`, on existing core/usage numeric money fields
(`journalStore.ts` apiEquivalentUsd/usd and `reportingAmount.ts` capUsd/
spentUsd/uncertainUsd). Those modules were not changed. The build retains the
inherited `usagePanel.js` overage: 76,938 bytes versus its 76,800-byte cap
(138 bytes). Both are explicitly outside this review-fix lane per the brief.
No caps, thresholds, hooks, dependencies or test timeouts were changed.
`npm run quality` was not run, as required by the shared lane rules; overall
release gates are not claimed green.

Measured production bundles (unchanged caps):

- `dist/reportingNetwork.js`: 64.6 KiB / 75 KiB.
- `dist/reporting.js`: 148.1 KiB / 175 KiB.
- `dist/extension.js`: 550.7 KiB / 600 KiB.
- `dist/modelApi.js`: 515.8 KiB / 525 KiB.
- `dist/usagePanel.js`: 76,938 bytes / 76,800 bytes (inherited overage).

Source/test and certification commits used the installed `.husky/_` hooks
and explicit paths. Staged and committed diffs were re-read after each commit.
The implementation hook produced no diff changes. No push, merge or rebase.
