# BADGES — release README badge refresh

Scope: `ci/refresh-badges`, starting at `928a92005`, clean worktree. The lane
brief and `common.md` require a small, credential-free, warning-only final
release job. Existing `release-summary.mjs` provides the all-published decision;
reuse it rather than duplicate channel success policy. No UI or dependency change.

Readiness review: the three BADGES criteria in PLAN.md cover public propagation,
badge caches and GitHub camo. Missing-secret skips must not start the job. HTTP
errors, invalid public metadata and stale badges warn; requests have deadlines.
Cache-busting success cannot establish freshness of the original badge URL, so
check that original URL again and report any remaining stale answer.

Local context: Windows, Node 24.20.0, npm 11.19.0. The installed feature-delivery
inventory succeeded. Its structural snapshot validator reported
`plan: expected exactly one quality-ledger fence`: the repository's established
milestone plan predates that format. Structural readiness/closure validation is
deferred; migrating the entire plan exceeds this lane. Keep its canonical format.

## Behavior and gate-fire evidence (2026-10-05)

Mac mini slot `badges`, snapshot `eb73f147`: the two owned test files
`refreshBadges.test.mjs` (31 tests) and `releaseMajorTag.test.mjs` (9 tests)
passed, 40/40. The latter's step extractor now stops at the next step/job,
so appending a job cannot accidentally append YAML to its shell fixture.
The fixture fetch replaces only public HTTP; the actual orchestration, parsing,
comparison, polling, retry decisions and warning paths run.

The lane's temporary drill runner used the same two complete test files for
baseline, each mutation and restored-green. Each red exited 1 for the named
behavior, and the baseline/restored runs exited 0 with 40 tests. Every mutation
was restored in `finally`, byte-for-byte, confirmed independently by SHA-256.

| Mutation                                          | Failure observed                                              |
| ------------------------------------------------- | ------------------------------------------------------------- |
| Accept every image hostname                       | Image inventory/allowlist assertion; unwanted image requested |
| Accept HTTP images                                | Image allowlist assertion                                     |
| Accept credential-bearing URLs                    | Image allowlist assertion                                     |
| Accept `data-src` as `src`                        | Actual-attribute parsing assertion                            |
| Compare versions lexically                        | `0.9.9` incorrectly ordered after `0.10.0`                    |
| Treat a newer public version as the target        | Future npm version skipped the required polling               |
| Retry every mismatched badge version              | Newer badge fetched three times instead of once               |
| Shorten propagation to 14 minutes                 | 840,000 ms instead of 900,000 ms                              |
| Omit original-URL stale warning                   | Unchanged original badge reported no stale warning            |
| Replace validated Open VSX answer with the target | Malformed response wrongly accepted                           |
| Throw from badge failure handler                  | Warning-only invocation rejected                              |
| Replace camo PURGE with GET                       | Request-method assertion                                      |
| Omit unsuccessful camo status warning             | HTTP 503 warning missing                                      |
| Invert workflow all-published condition           | Workflow wiring assertion; static proof only                  |

Restored script SHA-256:
`317d9a348f96713719bfb1fe700c19dc7e93c41b69d587d9261c61b67f301ea3`.
Restored workflow SHA-256:
`bf4451682c119665cf93e496dce9bba9a75ae61beefa06178b6552de05ecd229`.
Detailed lane output and runner: `temp/badges-drills.log` and
`temp/badges-drills.mjs` in the named worktree (gitignored).

Marketplace request fields and response projection follow the already pinned
vsce `PublicGalleryAPI` and `GalleryInterfaces`; no new Muse/Model API wire
parser was introduced. The other public registry projections are covered by
fake responses, not a claimed live capture. Lane rules forbid live public-service
calls and full quality runs. The next hosted release must verify all four
public APIs, original badge freshness and camo PURGE responses. Aggregate
release certification belongs to the lead. No model attempts or spend.

Focused gates passed on the Mac mini, snapshot `72637831`, Node 24.21.0 and
npm 11.19.0: `npm run typecheck` (all five projects), `npm run deadcode`,
`npx --no-install jscpd` (933 files, zero clones), `npm run check:l10n`
(14 tables, zero problems), `npm run check:host-api` (zero problems), and
`npm run build` (all size, split, globals and notices checks passed).
Sizes: extension 582.1/600 KiB, Model API 429.3/475 KiB, checkpoint store
89.0/225 KiB, webview 877.3/900 KiB, ACP 804.2/850 KiB.
Local changed-file ESLint, Prettier and actionlint passed.

## Upstream integration and final scope

Integrated `origin/main` at `8c894b60a` (the brief's release candidate). Keep
both Unreleased entries in the changelog: BADGES Changed and the upstream
README Fixed entry. The final merged-worktree snapshot `ed692c1e` passed the
same 40 tests, all five typechecks, deadcode, duplication (934 files, zero
clones), localization, host API and production build. All listed bundle sizes
remain unchanged. Script/workflow fingerprints still match the drill record.
The only subsequent changes are this evidence record and the plan's receipt.

The worktree lacked Husky's generated `.husky/_` launcher, so initial commit
`284c39346` did not invoke hooks. Scoped ESLint/Prettier had passed; a separate
redacted `gitleaks git --log-opts=284c39346^..284c39346` scan of that commit
also passed (one commit, no leaks). Restored the launcher using the installed
Husky, without changing dependencies. The final merge commit uses the normal
serial lint-staged and staged gitleaks hook.

Lane acceptance is implemented and verified with fake HTTP. Live cache/API
proof, full aggregate quality and the established-plan structural-validator
deferral remain explicitly open for the lead; no publishing or push performed.
