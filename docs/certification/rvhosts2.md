# RVHOSTS2 — independent review of RLF-HOSTS2

Lane `RVHOSTS2`, rig `linuxlt`, branch `rv/hosts2`. Starts at
`rec/rlf-hosts2` `8bd7eb960` (on `rv/hostsland` `566143f3a`). Model
attempts: **0**. Provider calls: **0**. Nothing pushed, rebased, stashed
or tagged. int was not merged. `/` is uid 0 (`root`) in this session, so
the host suites' supervision predicate is true and the supervised legs
ran.

## Findings

### P1 — a recording path could leave the root through `..` — fixed `41a2734c7`

`src/host/media/recordingLatest.ts:67` (`recordingTempAbsolute`).
`src/host/media/mediaProviders.ts:168`. The panel's recording root is
`src/runtime/panel/panelMedia.ts:128`.

Before the fix, `isRecordingTempPath` was a string prefix after `\` was
turned into `/`, with no collapse of `.` or `..`. When the prefix
matched, `createMediaSourceOpen` skipped workspace confinement,
protected-path and private-name checks and opened the raw spelling.
Node resolves `..`, so an absolute token
`<dataRoot>/recordings/../../secret.mp4` attached the file outside the
root once `recordings/` existed. (The first panel test false-passed
while that directory was missing: `lstat` failed before the kernel
walked `..`.)

A path that collapses outside the root is now confined like any other
file, and the open uses the collapsed spelling, so a symlink hop beside
`..` cannot select a different file. The panel says
`This private file cannot be attached.` (`src/shared/l10n/en.ts:3647`)
and does not read it. A video that really is inside the root still
attaches. An empty root, or a bare drive with no slash, matches nothing.

Drill. Red, before the fix: `npx vitest run test/unit/recordingLatest.test.ts test/unit/runtimePanelMedia.test.ts --maxWorkers=2`
exit 1, four failures (the predicate accepted a `..` escape on POSIX and
on a Windows spelling, the opener returned a handle, and the panel
attached `secret.mp4`). Green, same command, repository timeout: exit 0
(gate `vitest-recording`).

Residual, open, P3. An intermediate symlink that stays inside the
recording root, with no `..`, is still followed. That is a same-user
plant. A final symlink is still refused by `lstat`. A sibling such as
`recordings-evil` does not match the prefix.

### P2 — a foreign or expired GitHub lease was a machine code, or was sent — fixed `2659811ed`

`src/runtime/panel/nativeGitHub.ts:43`. Before the fix, lease ids lived
in a `Set`. A missing id threw `MHP_GITHUB_LEASE_REFUSED`, and
`GitHubClient`'s network failure text put that code in the sentence the
person sees. A lease past `GITHUB_LEASE_TTL_MS` (`src/shared/constants.ts:2932`,
15 minutes) was still proxied.

Leases are now a map of id to a local expiry,
`leaseExpiresAt(clock(), undefined)`. The editor's `expiresAt` is not on
the frozen result (`src/shared/hostApi/methods.ts:605` is
`{ leaseId }` only). The unwired mirror
`githubLeaseResultSchema` (`src/core/git/tokenSource.ts:131`) still
carries optional `expiresAt` and stays unwired. A missing, foreign, or
expired id throws `This GitHub sign-in is not valid for this window.`
(`src/shared/l10n/en.ts:2838`, all 14 tables). The id is not in the
sentence or the log.

The bearer the panel sends the host is the lease UUID, not an OAuth
token. The token stays in the editor. The lease `fetch` is `proxyFetch`;
device-flow and `gh` credentials use their own fetch, so a real token is
not sent through the lease set. Nothing on this path writes argv or
reaches a worker. `gh` is read only when the lease is absent and the
person's `museSpark.github.useGhLogin` global is on. No plugin in this
tree implements `auth/githubLease`.

Drill. Red: a foreign `currentUser` threw `MHP_GITHUB_LEASE_REFUSED`,
and the same lease after `GITHUB_LEASE_TTL_MS` still returned
`{login:lease-account,id:7}`. Green:
`npx vitest run test/unit/nativeGitHubLease.test.ts test/unit/runtimePanelGit.test.ts --maxWorkers=2`
exit 0 (3 lease tests, 7 panel-git tests; gate `vitest-lease`).

Residual, open, P3. `src/runtime/panel/nativeGitHub.ts:34` still throws
`MHP_GITHUB_ENDPOINT_REFUSED` when the origin is not `api.github.com`.
The panel's own GitHub calls use that origin. Left as the internal pin.

### P2 — unreleased notes claimed behaviour the tree does not do — fixed `615f7ee89`

`CHANGELOG.md` `[Unreleased]` said a native host can attach screen
captures, that an editor which already holds a GitHub credential signs
the panel in, and that a failed schedule hold waits for a decision.
Recording says it is not available yet. No plugin sends an attachment or
answers `auth/githubLease`. A failed hold shows a warning and a notice.
The notes now say that. Theme and the questions-count bullets were left:
they match the code below.

`docs/ide-compatibility/hosts.md` still underclaims JetBrains, Visual
Studio and Eclipse attach as metadata and tokens only. An underclaim is
not a false advertisement. Left. README's design line that the panel
follows the editor's theme had no commit in the RLF-HOSTS2 range and
was left. ROADMAP still says automatic schedule delivery stays disabled,
which matches the latch below. `npm run check:editor-matrix` exit 0
(10 editors, `docs/ide-compatibility/matrix.md` current).

### P2 — Linux host checks accepted any `node` — fixed `2f4306725`

Zed, Qt Creator, Emacs and Neovim required `argv[0]` to be `node` and
did not require this tree's `dist/acp.js` in the live argv. They do now.
There was no separate red run that injected an echo child: the launchers
already exec `dist/acp.js`, so the old check passed for the wrong
reason. The live runs after the assertion are in "Host suites" below.

### P2 — the Emacs supervised handshake parsed the agent log as JSON — fixed `6d9f95839`

`hosts/emacs/test/muse-spark-test.el`. `make-process` with a nil
`:stderr` mixes stderr into the protocol pipe. On a machine where
supervision can run, the first line is the product's display-language
log (`[info] Display language…` from `src/host/l10n.ts` via
`src/runtime/stderrLog.ts`), and the handshake dies with
`json-parse-error`. The prior record's "1 skipped" was the sandbox where
`/` was uid 65534. Here `/` is uid 0, the predicate is true, and the
test ran.

Drill. Red: ERT exit non-zero, `json-parse-error` on that log line.
Green, after stdout keeps the protocol and the log has its own buffer:
the full ERT selector `t` exit 0, 5 passed, 0 skipped. The skip
predicate remains for a machine where supervision is impossible. The
product log stays on stderr.

### P2 — the committed lazy registry omitted the panel bundles — fixed `bbbb55bba`

`src/shared/lazyBundles.generated.ts`. This branch's build emits
`runtimePanelMedia.js` and `runtimePanelSchedules.js`, and
`panelMedia.ts` / `panelSchedulesEntry.ts` load `media.js`,
`runtimeEngine.js` and `schedules.js`. The committed registry did not
name them. `npm run build` dies at the pre-existing team-bundle budgets
before `gen-lazy-registry.mjs --check`, so the earlier record did not
see it. `test/unit/packagedBundles.test.mjs` did, after that build.

Drill. Red, during `vitest related` on `en.ts`: two failures, five
registry rows differing from the build. Green, after
`npm run lazy-registry:generate`: that file 9 passed, exit 0;
`test/unit/lazyBundleFiles.test.ts` 17 passed, exit 0;
`npm run check:lazy-registry` exit 0. The diff is those rows only
(+33 lines).

### P3 — the recording-open catch kept its class and changed identity — recorded `09ff9fdb2`

`src/host/media/mediaProviders.ts:173`. The existing handler still
returns no handle when confinement throws ("An unreadable source refuses
the attach"). Wrapping it in `if (recording === undefined)` changed the
catch identity the ratchet stores. The CLEANUP count did not rise.
`node scripts/catch-inventory.mjs --write-baseline` replaced that one
identity. `npm run check:catches` exit 0 after that write.

## Reviewed, holding

Attachments. A workspace path or a chooser path goes through confinement.
`checkMediaLimits` (`src/core/media/limits.ts:117`) says
`This file exceeds {size}.` only when the person's `mediaMaxUploadMiB`
makes the bound greater than 0. The default is 0
(`src/shared/constants.ts:1387`), which admits any size (D121). There is
no attach count of ours. The provider's
`MODEL_API_MEDIA_PER_REQUEST` (`src/shared/constants.ts:2653`, 50)
applies when a Model API send is built
(`src/core/backends/modelapi/mediaBudget.ts:168`), not at attach. A
failed prepare throws `NativeAttachmentRefusal` with the reason
(`src/runtime/panel/panelMedia.ts:158`). JetBrains and Eclipse do not
call `attachments/attach`. The page attaches a minted token, not a raw
host path.

Theme. `window/didChangeTheme` is a notification. JetBrains
`PresentedHtml.admit` (`hosts/jetbrains/.../PresentedHtml.kt:29`) and
`seal` (`:43`) still run before the page is shown. Eclipse
`PresentedDocument.admit` / `compose`
(`hosts/eclipse/.../PresentedDocument.java:21` and `:37`) still run from
`MuseView.java:146`. Style text is assigned as text, not reparsed as
HTML. A font-family CSS hex escape was not executed in a DOM. It is not
recorded as a bug: the host already owns the webview, and the CSP on the
JetBrains seal has `script-src` nonce and `strict-dynamic`. Visual
Studio and Xcode send the message and were not run (no Windows host, no
Mac).

Schedules. `SCHEDULE_EDITOR_DELIVERY_CERTIFICATION.isReady` is false
(`src/shared/constants.ts:6481`). That latch is
`OPTIONAL_RUNTIME_AVAILABILITY.schedules` (`:1176`). While it is false,
`runtimeSchedulesBinding` clears both delivery ports
(`src/runtime/schedules/binding.ts:95`), the engine is not available,
and `holdSchedules` returns before a hold
(`src/runtime/panel/runtimeConversation.ts:326`). When a hold does run
it passes `this.options.attachments.workspaceRoot` (`:337`). No new
path spends money while delivery is uncertified. The panel test covers
a bundle-load failure degrading to a warning and the host-unavailable
notice, and close refusing another load.

Questions. `questionsStatusText` is the plural count sentence
(`src/runtime/panel/questionsStatus.ts:25`). Question text is not in
the frame. The count is published only when it changes.

Open, P3. A failed `ui/status` is `logRejection` only (`:52`). The
person is not told that this publish failed. The next count change
publishes again. Left: it is not a silent refusal of an attachment, a
lease, or a turn.

Neovim, open, P3. `hosts/neovim/test` has no supervised ACP handshake
and no supervision skip. `check.lua` proves the companion refusal
(`EPANEL_EXIT`) and `lsp.lua` proves the live `dist/acp.js` argv. A
skip was not invented. Sublime's in-editor harness, JetBrains
`./gradlew test` and Eclipse `mvn verify` were not re-run in this lane.

`estimatorPricePackaging` cannot fold `` `${PORTABLE_OUTDIR}/loader.js` ``
(`scripts/build.mjs:2154`) and throws before its assertions. That
template is not in this lane's diff. Left open. The production build
itself completed far enough to reach the size check.

## What the merge with int must carry

Do not merge int in this lane. Neither 1.5.1 commit is an ancestor of
this branch (`git merge-base --is-ancestor` exit 1 for both). This
branch is `mhp/1.6.0`, wire `1.6`, range exclusive `mhp/1.7.0`
(`src/shared/constants.ts:10771` and `:10808`). `npm run check:mhp`
exit 0. The frozen schema has no `quota`, no `limitKind`, and no
`"external"`.

Keep 1.6.0. Do not drop back to 1.5.1, and do not drop
`window/didChangeTheme` or `attachments/*`. Regenerate the frozen
contract, snapshots, locks and host copies together (D226) so 1.6.0 is
a superset of int's 1.5.1. The superset is exactly these two additions.

1. Quota detail from `cc3e845a0549066be24562e11112b231362b9dcf`. Optional
   `quota` on `turnCompleted` and `turnRetry`, in the panel schema and
   in `src/shared/agentEvents.ts`. The object requires `limitKind`
   (string) and `resetsAtMs` (number), `additionalProperties` false, and
   `quota` itself is not in the event's required list. This branch's
   events already have `retryable`, `durationMs`, and on `turnRetry`
   `maxAttempts`, `nextAttempt` and `httpStatus`. Those stay.

2. Host kind `external` (D250) from
   `62d320f63496e3b6ee6a32304ab15b76ae6c8cf2`. On that commit the string
   `"external"` occurs 18 times in `mhp-v1.1.schema.json`, on the panel
   `backend` and `sourceBackend` enums that were `museCode` | `modelApi`.
   This branch's TypeScript still uses
   `z.enum(['museCode', 'modelApi'])` in `src/shared/scheduleV2.ts`,
   `src/shared/questions.ts` and `src/shared/usageJournal.ts`. Those
   enums move with the schema or the wire and the runtime disagree.

Do not add `expiresAt` to the frozen `auth/githubLease` result while
doing that. That field is a version-lock change, and it is not part of
the 1.5.1 delta. The local lifetime above does not need it.

## Host suites on this machine

Each command uses this tree. No `--testTimeout`. Supervision ran.

| Suite                                                                                 | Result                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Emacs ERT selector `t`                                                                | exit 0, 5 passed, 0 skipped, after `6d9f95839`. The live argv includes `dist/acp.js`. `EPANEL_EXIT` / `EPANEL_STOP` on the way out are the product's refusal notices. |
| Zed `python3 -m unittest discover -s hosts/zed/test -p 'test_zed.py'`                 | LSP lifecycle exit 0. Supervised `test_acp_real_agent_handshake` ran and passed.                                                                                      |
| Qt Creator `python3 -m unittest discover -s hosts/qtcreator/test -p 'test_launch.py'` | LSP lifecycle exit 0. Supervised `test_stop_real_agent_says_its_outcome` ran and passed.                                                                              |
| Neovim `nvim --headless -u NONE -i NONE -n -l hosts/neovim/test/lsp.lua`              | exit 0. The linux child scan requires `dist/acp.js`.                                                                                                                  |
| Neovim `… -l hosts/neovim/test/check.lua`                                             | exit 0, 9 PASS lines, including the companion refusal `EPANEL_EXIT`.                                                                                                  |

The RLF-HOSTS2 sentence that every suite skipped one supervised case
described the uid-65534 sandbox, not this machine.

## Gates

First sweep, on `6d9f95839` plus the status line whose phrase was
`reviewed` (that phrase is not in the plan table; `check:plan` reported
`status-phrase: M60–M66: reviewed`). Repository timeouts.
`--maxWorkers=2`.

| Gate                                                                    | Exit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prettier `--check` on the touched sources, tests, changelog, plan, l10n | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| eslint `--max-warnings 0` on the touched sources and tests              | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run typecheck`                                                     | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `node scripts/check-l10n.mjs`                                           | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run check:reference`                                               | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run check:host-api`                                                | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run check:plan`                                                    | 1, then 0 after the phrase was `built`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run check:roadmap`                                                 | 1, only because plan drifted; 0 after the phrase fix (`244 entries`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run check:catches`                                                 | 1 (`mediaProviders.ts:173` new CLEANUP identity, count unchanged); 0 after `09ff9fdb2`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run duplication`                                                   | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run cycles`                                                        | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run deadcode`                                                      | 1. Unused files: `test/hostApi/listings.test.mjs`, `test/hostApi/vitest.config.mjs`, `test/unit/hostDrivers/cli.ts`, `test/unit/hostDrivers/runDriver.mjs`. Unused exports: `XCODE_HOST`, `XCODE_MODEL_TEXT`, `conformHost`. Five `@unwired` tag hints. None of these symbols are in this lane's diff.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run build`                                                         | 1. Budgets not raised. `dist/teamRunners.js` 78.4 KiB (budget 75), `dist/teamHost.js` 140.2 KiB (budget 130), `dist/teamScheduler.js` 76.5 KiB (budget 75). Same three figures the RLF-HOSTS2 record already reported. This lane does not change those entries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `npx vitest run` recording + panel media                                | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npx vitest run` lease + panel git                                      | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npx vitest related` `recordingLatest.ts`                               | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npx vitest related` `mediaProviders.ts`                                | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npx vitest related` `nativeGitHub.ts`                                  | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npx vitest related` `en.ts`                                            | 1. 30 failed tests. Three plan-reader failures and the real-plan snapshot failure were the status phrase; re-run after the phrase fix: `planReader.test.ts` 55 passed and `estimatorPlanSnapshotRealPlan.test.ts` 43 passed, exit 0. Two packaged-bundle failures were the stale registry; re-run after `bbbb55bba`: 9 passed, exit 0. The other failures are not in this lane's diff and were not re-run: repo-timeout (5 s) on `playbookSchedulesInputs`, `nodeFilesPage`, `resourceStatusCpu`, `teamPlaybookIntegration`; vault `vaultStoreScope` (2), `posixVaultPanelFlow` (2), `chatgptSubscriptionMigration` (3); `connectorStorageGuard` (3); `runtimeLsp` (3) at their own 240 s timeout; `providerSpend` catalogue date `2026-10-22` against vendor `fetchedAt` `2026-10-30`; `acpServeHandshake` expected the not-installed sentence and got the not-signed-in sentence; `createdRegistrySpaces` unsafe ownership and `createdRegistrySaveErrors` `unsafe` instead of `invalid`; `devicesPhase2Harness` QR panel; `serveHandshakeWait` one notice where the test wants two; `estimatorPricePackaging` as above. |
| `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`                  | 1. Scan completed, 693 rules, 5527 files, 6 blocking findings, none in this lane's diff: `os/build.py:79` dynamic urllib, `os/pi/compose.py:607` and `:609` mode `0o755`, `scripts/build-packs.mjs:2432` non-literal `RegExp`, `src/core/backends/modelapi/mcp/headers.ts:172` prototype loop, `src/runtime/node/keyStore.ts:86` GCM tag length. Timeouts warned on `ModelApiHost.ts` (3) and `conversationController.ts` (1). The registry commit landed after this scan and adds data rows only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run security:audit`                                                | 1. 10 advisories, 0 exceptions. The failing one is high `GHSA-mrwp-f3q8-3g9p` in `follow-redirects` (no fixed version; D29 would want a reviewed dated exception). This lane did not change dependencies.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `npm run check:mhp`                                                     | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run check:editor-matrix`                                           | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run check:lazy-registry`                                           | 0, after `bbbb55bba`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Still open, for the lead

1. Port lane A's `createRuntimeCheckout` when a checkout action lands.
   Not built here.
2. Companion transport is its own lane. `supervise panel --companion`
   is refused; the panel accepts only `--stdio`.
3. Extra editors (mhp-python, Jupyter, NetBeans / mhp-java, Spyder,
   RStudio) wait on (2). Visual Studio waits on a Windows machine.
   Xcode waits on a Mac. This lane did not re-run Sublime, JetBrains
   or Eclipse.
4. Do not put `expiresAt` on the frozen `auth/githubLease` result unless
   a version adoption is the point of that change. The local 15-minute
   lifetime is what this window enforces.
5. The three team-bundle budgets stay over by 3.4, 10.2 and 1.5 KiB.
   They were already over on the branch under review. Not raised.
6. The merge round in the section above. int was not merged here.
