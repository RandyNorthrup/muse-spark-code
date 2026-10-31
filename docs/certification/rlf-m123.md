# RLF-M123 — M123 open rows int can carry: the runtime lease source and the push's kept routes (2026-10-30)

Lane `rec/rlf-m123`, worktree `/Users/user/lanes/RLF-M123`, branch
`rec/rlf-m123`, on the test rig `macbook` (macOS, Node 24.21.0, npm
11.19.0). Base: int/recovery `0a5ebd718` (CC-INT5's tree;
`docs/certification/cc-int5.md`, whose known failures are not counted
against this lane). Model attempts: **0**. Provider calls: **0**. Muse
requests: **0** (the brief names no real use). No GitHub call of any
kind: the git half is proved on real local repositories (real `git`,
bare remotes in temp dirs) and the PR half by the exact request the
real client builds before it is sent, answered with M71's recorded
captures. Nothing was pushed, rebased, stashed or tagged. No browser or
GUI app was started. Scratch files lived in the worktree's ignored
`temp/` (drill backups and logs) and the lane's `$TMPDIR` (two base
worktrees for measurements, both removed). `git` and every test run
needed `DEVELOPER_DIR=/Library/Developer/CommandLineTools`: the rig's
`xcode-select` points at a broken `/Applications/Xcode.app` whose
binaries refuse execution (§7, item 1).

## 1. What int already had, by row (read in the code, not the status lines)

| Row                                                              | On int                         | Where                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lane 0 contracts                                                 | yes                            | `src/core/git/tokenSource.ts` (order, TTL, scopes, client id, gh rule); `src/core/git/runtimeGit.ts` (`RuntimeGitDeps`, unchanged `ConversationGitPort`); `museSpark.github.useGhLogin` contributed, machine scope                                                                                            |
| Lane 0 fakes                                                     | no (deleted)                   | main's test overhaul deleted the fake servers and the fake-driven suites; the brief forbids stand-ins, so they stay deleted                                                                                                                                                                                   |
| Lane G native git                                                | yes, on                        | `src/runtime/panel/git/` (service, adapter, transaction, LOCKLIB lease, seal); on for VS Code-family hosts without `vscode.git` (`conversationGitEntry.ts`); `dist/nativeGit.js`                                                                                                                              |
| Lane A sign-in                                                   | yes                            | `src/core/git/githubSignIn.ts`, `src/runtime/github/` (device flow, gh), `auth github` CLI, panel GitHub card, palette rows, `/github-login`, `/github-logout`                                                                                                                                                |
| Lane P pull requests                                             | yes, except checkout           | `src/runtime/panel/pullRequests/pullRequests.ts` (prepare/create/status) wired into the native adapter; `checkout.ts` (held checkout protocol) complete and tested but with **no production importer**                                                                                                        |
| Lane L editor leases                                             | **no**                         | MHP rows `auth/github`, `auth/githubLease`, `github/request` frozen in `src/shared/hostApi/methods.ts`; no runtime client and no per-editor provider anywhere (`lanes/rlf-hostsland` has none either)                                                                                                         |
| Lane U panel/strings                                             | VS Code yes; bridges no        | `GitPanel.tsx`, card, 15 tables, catalogue; the three M104d bridges are on `lanes/rlf-hostsland`, not int                                                                                                                                                                                                     |
| Lane Q receipts                                                  | **no**                         | no host carries `panel --stdio`; the conformance harness is on `lanes/rlf-hostsland`; `test/hostApi/` does not exist on int                                                                                                                                                                                   |
| Lane D docs                                                      | partial                        | README/SECURITY/PRIVACY name the shipped VS Code-family and terminal sign-in; nothing for the hostless panel route                                                                                                                                                                                            |
| Acceptance 1 (full path per editor)                              | VS Code-family + terminal only | msm71m123's record; every other editor waits for hosts                                                                                                                                                                                                                                                        |
| Acceptance 2 (VS Code unchanged)                                 | yes (unit)                     | M71's unit suites pass (§5); integration needs Electron, screenshots need Chrome: neither runs on this MacBook                                                                                                                                                                                                |
| Acceptance 3 (device flow)                                       | partial                        | client + review fixes in; no recorded device-flow exchange exists (needs the lead's live sign-in, §6 step 1)                                                                                                                                                                                                  |
| Acceptance 4 (sources)                                           | partial                        | order, gh default-off + scope rule, 401 drop: in and tested. Lease expiry: the 15-minute TTL cap is in; the `expiresAt` MHP field waits for a versioned revision (§7, item 4). Missing-`repo` naming: `missingScopes` exists but has no caller — GitHub's `X-OAuth-Scopes` header is not captured (§6 step 2) |
| Acceptance 5 (rule 8 drills)                                     | partial                        | lane reviews' grep drills stand; no lease-frames drill existed — this lane adds the lease shape to the panel proof instead (§3)                                                                                                                                                                               |
| Acceptance 6 (held checkout)                                     | VS Code yes; runtime no        | `heldCheckoutCore` + RV71c refusals in VS Code; the runtime protocol awaits the trust-card surfaces (§7, item 5)                                                                                                                                                                                              |
| Checklist: Q-M123                                                | answered                       | the public client id in `GITHUB_OAUTH_CLIENT_ID` (`src/shared/constants.ts:2868`)                                                                                                                                                                                                                             |
| Checklist: lane 0 contract frozen                                | **open**                       | the row carries `leaseId` only; see §7, item 4                                                                                                                                                                                                                                                                |
| Checklist: receipts, VS Code, greps, drills, live check, reviews | as the rows above              | —                                                                                                                                                                                                                                                                                                             |

## 2. What this lane built (on int's existing modules, no parallel path)

1. **The runtime lease client, `src/runtime/panel/nativeGitHub.ts` (new,
   lane L's planned path).** `editorLeaseSource` is D104's source (a) for
   the runtime panel: `auth/githubLease` (`ask`/`silent` pass through) for
   the opaque lease id, then each REST call as `github/request`. One
   `randomUUID` owner per connection binds every lease to it. The
   credential's `fetch` sends address, method, body and signal only — the
   REST client's `Authorization` header is dropped structurally (MHP has no
   header field). A `null` lease is no credential (falls through to the
   device flow); a 401 drops the lease (it lives only in the credential)
   and the next call asks again; sign-out is the editor's. Expiry is
   `leaseExpiresAt` (now wired): grant + TTL while the frozen row carries
   no `expiresAt`. GET/POST only, api.github.com `/user` and `/repos/…`
   only, envelope cap: the rows' own schemas refuse the rest locally
   before anything is sent (verified at `connection.ts` `callable()`).
   Known lease limits, in the module comment: answers arrive without
   headers, so a 403 for a spent rate limit reads `invalid` (the log line
   only — the user's words come from GitHub's body either way; 429 and 401
   classify by status as before) and scope gaps stay unnamed.
2. **Wired behind the offered capability.** `panelSession.ts` passes
   `editorLeaseOffered: connection.offers('auth')` (the panel asks only
   for what the host offered); `panelGit.ts` prepends the lease source in
   D104's order when set. No host offers `auth` on int yet, so no
   production path changes until one does — and a host that does not
   offer it can never see a lease ask fail in `ask` mode (the asked-first
   source would otherwise surface instead of the device flow).
3. **The push/fetch environment fix.** `panelGit.ts` now reads
   `runtimeGitUserEnvironment()` (the Git routes the agent's entry kept at
   start) instead of the bare process environment, which the entry
   stripped of every credential variable: a panel push authenticating over
   `GH_TOKEN`/`GITHUB_TOKEN` kept failing. The VS Code route is
   unaffected (its extension-host environment is never stripped, and the
   service re-filters to the allow-list at the spawn either way).
4. **Two `@unwired` tags retired** (`leaseExpiresAt`,
   `runtimeGitUserEnvironment`); `githubLeaseResultSchema` keeps its tag
   with the precise wait (a versioned MHP revision). No new command,
   setting, UI string, bundle or MHP row: `dist/nativeGit.js` 106.4 of
   125 KiB, `uiText.js` byte-identical to the base (125.3 KiB, still over
   its budget from the base — §7, item 2).

## 3. Proof: real-code tests (repository timeouts, `--maxWorkers=3`)

- `test/unit/runtimePanelGitLease.test.ts` (new, 4 tests): the real
  `panel --stdio` from the production build over real MHP, the test
  editor serving `auth/githubLease` + `github/request` (the established
  lane-B driver pattern), every REST body M71's recorded capture:
  1. prepare links the open PR (#56) instead of a second one, then its
     state and checks read over the lease; asserts the **exact six
     requests** the client builds (`/user`, the repository, the
     `head=RandyNorthrup:main` list, `/pulls/56`, check-runs, status),
     one stable owner, all asks silent, and the strip naming
     `editorLease`/`RandyNorthrup`;
  2. a 401 says `GitHub answered 401`, and the retry borrows a fresh
     lease (2 asks, then 4) and opens the form;
  3. a `null` lease falls through (modes `silent` then `ask`), the
     credential store never read, no REST call, one said sentence;
  4. a host that serves the methods but offers no `auth` is never asked
     (both call lists empty); the device flow is asked instead.
- `test/unit/gitUserEnvironment.test.ts` (new, 2 tests): the kept Git
  routes come back, every other credential stays out, a later keep
  replaces the earlier one.
- `test/unit/helpers/panelGitRepo.ts` (new): the one repository fixture
  both panel git suites build from (the duplication gate refused the
  copy: 7 clones → 0).
- M71's unit suites re-run here: `conversationGitBundle`,
  `heldCheckoutCore`, `pullRequestDiscoveryAbort`,
  `pullRequestLinksStore`, `pullRequestRef`, `pushPlan`,
  `runtimePullRequestInterleavings`, `runtimePullRequestProcessBirth`,
  `nativeCheckout` — all pass (§5).

What is **not** covered, and why: POST-create success over a lease (no
recorded POST exchange exists — §6 step 3 records the live capture);
end-to-end delivery of `GH_TOKEN` into a panel push child (needs a live
push — §6 step 4); the GET/POST guard and the header drop (no caller
sends PATCH; the drop is structural — the MHP params have no header
field).

## 4. Red/green drills (break, non-zero exit, byte-exact restore, green)

| Break                                                     | Caught by                                                     | Red exit | Green |
| --------------------------------------------------------- | ------------------------------------------------------------- | -------- | ----- |
| `nativeGitHub.ts`: the credential never uses a live lease | lease suite tests 1–2 fail (3–4 pass: the null/no-auth paths) | 1        | 0     |
| `nativeGitHub.ts`: a fresh owner per call                 | test 1: the owner-stability assertions                        | 1        | 0     |
| `panelSession.ts`: `editorLeaseOffered: false`            | tests 1–3 fail (test 4 passes)                                | 1        | 0     |
| `nativeGitHub.ts`: `ask` never reaches the editor         | test 3: `['silent','silent']` vs `['silent','ask']`           | 1        | 0     |
| `gitUserEnvironment.ts`: the keep filter dropped          | env unit: `SOME_API_KEY` comes back                           | 1        | 0     |

## 5. Suites run, final tree, repository timeouts

`DEVELOPER_DIR=/Library/Developer/CommandLineTools` (rig §7 item 1),
`--maxWorkers=3`, at most 3 files per run. `vitest related` over the
changed sources finds nothing: the panel suites load the production
bundles from `dist/`, not the sources — so every affected suite is named
explicitly below.

| Suites                                                                                | Exit | Result                                                                                                                                                        |
| ------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtimePanelGitLease`, `gitUserEnvironment`                                          | 0    | 6 passed                                                                                                                                                      |
| `runtimePanelGit`                                                                     | 0    | 6 passed (after the fixture-helper refactor)                                                                                                                  |
| `runtimePanel`, `runtimePanelConversation`, `runtimePanelSessions`                    | 0    | 28 passed                                                                                                                                                     |
| `runtimeReview`, `runtimePlans`, `runtimePortableBundles`                             | 1    | `runtimeReview`: the same 2 tests fail with `spawnSync git EPERM` on this tree **and** on the untouched base (§7, item 1); the other two files pass (9 tests) |
| `runtimeSettingsStore`, `runtimeTransfer`, `wireEntry`                                | 0    | 19 passed                                                                                                                                                     |
| `acpPaidGrants`, `nativeGitAdapter`, `nativeGitCore`                                  | 0    | 39 passed                                                                                                                                                     |
| `nativeGitPullRequestReads`, `nativeGitPullRequests`, `nativeGitService`              | 0    | 26 passed                                                                                                                                                     |
| `githubClientAbort`, `githubClientFailure`, `githubRemote`                            | 0    | 38 passed                                                                                                                                                     |
| `conversationGitBundle`, `heldCheckoutCore`, `pullRequestDiscoveryAbort`              | 0    | 11 passed                                                                                                                                                     |
| `pullRequestLinksStore`, `pullRequestRef`, `pushPlan`                                 | 0    | 46 passed                                                                                                                                                     |
| `runtimePullRequestInterleavings`, `runtimePullRequestProcessBirth`, `nativeCheckout` | 0    | 33 passed, 3 skipped                                                                                                                                          |

Not run: the VS Code integration suites (Electron cannot start on a
macOS lane), `test:a11y`/`ui:look` (no Chrome), the vault and real
OS-credential-store suites (rule), `runtimeLsp` (cannot pass under a
macOS temp folder), any Muse request or paid call.

## 6. Live GitHub steps for the lead's real-life run (all on the owner)

None was run in this lane. Each names its capture for AGENTS.md rule 14.

1. **One device-flow sign-in** (`panel --stdio` under an editor that
   offers no `auth`, or the terminal's `auth github login`): record the
   device-code reply, one `authorization_pending` reply and the token
   reply's shape (values masked) with the date. Unblocks acceptance 3's
   recorded exchange.
2. **Capture `X-OAuth-Scopes`.** `gh api -i /user` (or one panel PR
   prepare behind a proxy that logs headers): record the response
   header's exact value shape with the date. Unblocks wiring
   `missingScopes` before a write (acceptance 4).
3. **One draft PR on a throwaway repository over a lease** (needs a host
   that offers `auth`): record the POST request and creation reply
   (values masked) with the date. Unblocks the lease create-path test and
   acceptance 1's lease row.
4. **One panel push authenticating over `GH_TOKEN`** with the panel
   process started in an environment holding it: proves the kept routes
   reach the push child end to end (§2 item 3).
5. **One held checkout of another account's PR in the runtime panel**
   (needs the trust-card surfaces, §7 item 5): proves the hold, the card
   and the release outside VS Code.

## 7. Not run, and open rows for the lead

1. **This rig's Xcode git is broken, and two suites fail for it.**
   `xcode-select` points at `/Applications/Xcode.app`, whose
   `.../usr/bin/git` refuses execution (`EPERM`, reproduced in a shell
   and in node, no repo code involved). `fixtureGitEnvironment`
   resolves `xcrun --find git` with a bare environment, gets that path,
   and `runtimeReview`'s setup spawns fail. Measured on the untouched
   base worktree: the same 2 tests, the same `spawnSync git EPERM`.
   Not this lane's to fix (machine-wide configuration). Hosted CI is
   unaffected (Linux/Windows).
2. **`npm run build` is red from the base's four over-budget rows,
   byte-identical to CC-INT5's record:** `teamHost.js` 140.2/130,
   `teamRunners.js` 78.4/75, `teamScheduler.js` 76.5/75, `uiText.js`
   125.3/125 KiB. This lane's bundles hold (`nativeGit.js` 106.4/125;
   no new bundle, no new UI key). The "fit the team bundles" lane from
   CC-INT5 §8 item 1 is still the fix; no budget raised here.
3. **`npm run security:audit` fails on a new `high` advisory,
   GHSA-mrwp-f3q8-3g9p in `follow-redirects`** (transitive via `ovsx`,
   overridden): 10 advisories where CC-INT5 saw 7. `package.json` and
   the lockfile are untouched by this lane, so the base fails the same
   way today — the advisory data is live from the registry. A
   dependency bump is D3's deliberate process and not M123 scope;
   needs a deps lane.
4. **`check:mhp` fails on the base's stale v1.1 lock** (same
   `MHP_VERSION_LOCK` digest on this tree and the untouched base; none
   of the script's inputs differ). Separately: lane 0's additive
   `expiresAt` on `auth/githubLease` now needs a versioned MHP revision
   (bump + `--adopt-version` + regen of every schema, lock and host
   together, D226) — it cannot land from an M123 lane while the nine
   hosts live on `lanes/rlf-hostsland`. Until then the lease runs out
   at grant + TTL, which the client enforces.
5. **Open M123 rows and what each waits for:** per-editor lease
   providers (JetBrains/VS/Eclipse/native — need host code; hostsland
   has none yet); `missingScopes` wiring (§6 step 2); the runtime held
   checkout + trust card (needs per-editor surfaces; wiring checkout
   without the hold UI would be incomplete and unsafe, so `checkout.ts`
   stays test-only); lane Q receipts (need hosts + the conformance
   harness on hostsland); lane U bridges (M104d, on hostsland);
   `githubLeaseResultSchema`, `pullRequestFetchEnvironment`,
   `quietPullRequestEnvironment`, `isRepositoryRoot` keep their
   `@unwired` tags for those rows.
6. **SAST not run:** semgrep is not installed, and installing it fails
   (`metadata-generation-failed`, needs a Rust toolchain). Hosted CI
   runs it.
7. **No CHANGELOG entry:** nothing a person can reach changed — no host
   offers `auth` yet and no host carries the panel (the same precedent
   as M104 lane B's hostless panel work).

## 8. Gates (exit codes on the final tree)

| Command                                    | Exit | Note                                                                                                                                                                                  |
| ------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check` on touched files        | 0    |                                                                                                                                                                                       |
| `eslint --max-warnings 0` on touched files | 0    | 4 errors found and fixed during the lane (nested ternary, unused param, boolean name, prefer-ternary)                                                                                 |
| `npm run typecheck` (all projects)         | 0    | no `error TS`                                                                                                                                                                         |
| `node scripts/check-l10n.mjs`              | 0    | 0 problems                                                                                                                                                                            |
| `npm run check:reference`                  | 0    | current                                                                                                                                                                               |
| `npm run check:host-api`                   | 0    | regenerated: `node:crypto` 326→327 (this lane's import)                                                                                                                               |
| `npm run check:mhp`                        | 1    | base failure, measured identical (§7 item 4)                                                                                                                                          |
| `npm run check:plan`                       | 0    | 244 milestones; 0 drift                                                                                                                                                               |
| `npm run check:roadmap`                    | 0    | regenerated after the M123 status line                                                                                                                                                |
| `npm run check:catches`                    | 0    | no new catch site; baseline untouched                                                                                                                                                 |
| `npm run duplication`                      | 0    | 0 clones (7 found and fixed at the root during the lane)                                                                                                                              |
| `npm run cycles`                           | 0    |                                                                                                                                                                                       |
| `npm run deadcode`                         | 0    | knip clean (4 tag hints; the base had 5–6)                                                                                                                                            |
| `npm run build`                            | 1    | the base's 4 over-budget rows (§7 item 2); the rest by hand: `check-tokens` 0, `check-bundle-split` 0, `gen-lazy-registry --check` 0, `check-host-globals` 0, `third-party-notices` 0 |
| `npm run security:audit`                   | 1    | the new `follow-redirects` high (§7 item 3)                                                                                                                                           |
| `npm run security:sast`                    | —    | not run (§7 item 6)                                                                                                                                                                   |

## 9. Commits

- `1726da4ee` `feat(m123): the editor's GitHub lease in the runtime panel, and the push's kept Git routes`
- `ecf83aeb6` `fix(m123): one panel-git fixture helper for both suites; host-api record regenerated`
- (this record and the PLAN status follow as the third commit; the roadmap regen wrote no diff)
