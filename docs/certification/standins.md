# Stand-in classification (lane STANDINS, 2026-10-17)

Method: `git grep -l -i -E 'fake|stub|mock|scripted|stand-in|standin|dummy' -- test`
on branch `chore/no-standins`. This branch has 54 matching files (main's 52
plus drift); fixtures, helpers and harness files matched too and are
classified below. `test/unit/turnNotice.test.ts` (the Codex reviewer's case)
is already gone on this branch. Each file was read, not just grepped.
Supplemental sweeps: `vi.mock|doMock|stubGlobal|spyOn|useFakeTimers|setSystemTime`
(zero hits outside `scripts/test-overhaul/classify.mjs`), port-signal grep
(`satisfies .*Port`, `: .*Port =`, `as unknown as`), and a helper-name sweep.

Verdict meanings: REAL = the words appear but the test drives real code
(data values, recorded captures, "no fakes" assertions, loopback peers).
STAND-IN = a hand-written object, scripted port or local server pretending
to be one of our modules, a provider, the CLI, GitHub, an MCP server, the
editor API or a store. Stand-ins are named with what they pretend to be.

## STAND-IN (8 test files + 3 helpers)

- `test/e2e/schedulesStdio.e2e.test.ts` — STAND-IN, last case only. Writes
  `dist/schedules.js` exporting a hand-written `createRuntimeSchedules`
  object (`command`/`run`/`holdWorkspace`/`close`) pretending to be the
  scheduler bundle (our own module). First three cases are REAL (real CLI binary).
- `test/packaging/moduleExports.test.mjs` — STAND-IN, four `exercise()`
  branches. Hand-written provider `client` (`streamResponse` throws),
  model `resolved` record, host (`ensureHost`/`backendOf`/`pendingSessionIds`),
  `deps` (`newId`/`now`/`isStillAllowed`), a `Module._load` trap returning a
  `Proxy` for `vscode` (editor-API stand-in), and a `fetch` stub.
  Remaining branches (boundaries, hookRuntime, pluginHooks, modelApiTools)
  are REAL (real schemas/parsers with data).
- `test/unit/pluginDispatch.test.ts` — STAND-IN, cases using `host()` /
  `adapterWith()` with plugins. Shell scripts "standing in for bun",
  scripted `PluginHostDeps` (`containment`/`warn`/`now`), `noRunner.runHook`
  and `io.realPath`. Pure `pluginAnswer`/`pluginRequest` cases are REAL.
- `test/unit/teamPreview.test.ts` — STAND-IN, all `previewDraft` cases.
  `firstWithHeadroom` ("a test fake") plus inline `select`/`resolveDefault`
  stand in for lane A's selection strategy (our own module); PRICES invented.
  The `samples` case is REAL (real constants).
- `test/unit/marketplaceHook.test.mjs` — STAND-IN, whole file. `stats()`
  (`{ get }`) pretends to be the Workers KV store; the worker itself is real.
- `test/unit/teamResources.test.ts` — STAND-IN, cases via `drivenRegistry()`.
  `helpers/manualClock.ts` (`createManualClock`) is a hand-driven clock for
  the `RegistryClock` port: fake timers by hand. The `defaultResourceKind`
  cases are REAL (pure function, real constants).
- `test/unit/modelApiLegalScan.test.ts` — STAND-IN, the `runLegalScanCall`
  block. `runner()` (`{ run, calls }`), `failingScan` and the
  `as unknown as LegalScanRunner` double stand in for the scanner. The
  `legal_scan definition` block is REAL (real `toolDefinitions`).
- `test/unit/prompts.test.ts` — STAND-IN, one case. Inline
  `store: PromptStoragePort` (`list`/`write`/`remove`) pretends to be the
  prompt store. Fixable by inlining the arrays into `mergePromptScopes`.
- `test/unit/helpers/manualClock.ts` — STAND-IN helper (see teamResources).
- `test/unit/helpers/vault/windowsVaultMemoryHello.cs` — self-described
  "Test-only WinRT stand-ins" for the OS credential store. Zero references
  in test/src/scripts: orphaned. Delete with no claim withdrawn.
- `test/unit/helpers/vault/windowsVaultMemoryKsp.cs` — same as above
  ("The fake persists only in this process"). Orphaned. Delete.

## REAL (keyword appears, real code driven)

- `test/e2e/schedulesStdio.e2e.test.ts` (first 3 cases) — real built CLI binary.
- `test/integration/legal.test.ts` — real VS Code, real extension, real
  scanner bundle. The "fake transports" header comment is stale; the code
  wires the real loaded runner.
- `test/unit/hookFormats.test.ts`, `hookFormatsCline.test.ts`,
  `hookFormatsContracts.test.ts`, `hookFormatsEngine.test.ts` — pure
  stdin builders/parsers with data payloads; "Fake-only" means no vendor
  CLI or model call.
- `test/unit/providerRetry.test.ts` — pure `classifyRetry`/tables with
  synthetic failure descriptors as unit inputs, plus the existing Anthropic
  parser fixture. No module is doubled.
- `test/unit/pullRequestLinksStore.test.ts` — the real
  `createMemoryPullRequestLinkStore` from src; LINK is REST-shaped data.
- `test/unit/teamWorkerEnv.test.ts` — `/fake/...` values are hostile env
  data fed to the real scrubber.
- `test/unit/argumentPreview.test.ts`,
  `test/unit/helpers/argumentPreviewProbes.ts` — `dummy-*` secret-shaped
  data for the real redactor.
- `test/unit/chatShareFilter.test.ts` — `Allow fake@example.com` is
  decision data.
- `test/unit/legalEvidence.test.ts` — `Copyright 2026 Fake` is fixture text.
- `test/unit/shareContracts.test.ts` — `dummyAddedLater` is kind data.
- `test/unit/whatsNewContent.test.ts`, `test/unit/whatsNewHtml.test.ts` —
  `vscode-webview://fake` is CSP test data.
- `test/unit/vsixCompression.test.mjs` — "stub" appears only in a comment
  about using a complete real table.
- `test/unit/approvalSecrets.test.ts`,
  `test/unit/judgeSameAllowRules.test.ts`,
  `test/unit/museCodeProtectedWrites.test.ts`, `test/unit/vault/policy.test.ts` —
  "standing" is the standing grant/approval domain word.
- `test/unit/composerFocusOwnership.test.ts`, `test/unit/focusGate.test.ts`,
  `test/unit/questionAttentionOwnership.test.tsx` — "no mocks, no fake
  timers" assertions hold: real components, real DOM, handler props are
  plain callbacks, not module doubles.
- `test/unit/questionContracts.test.ts` — zod schema checks with fixture
  data. Its "behaviour against the fakes" comment refers to the fixture
  data builders, not module doubles.
- `test/unit/recordingLatest.test.ts` — real temp directories.
- `test/unit/resumedModel.test.ts` — cites the recorded restart-model doc.
- `test/unit/eval/evalTasks.test.ts` — `vi.stubEnv`/`unstubAllEnvs` mutate
  the real environment for a real verifier subprocess; no module is
  doubled. Gap noted: `stubEnv`/`unstubAllEnvs` are not in the lint gate's
  `vi.*` ban list, but they drive the real env mechanism, so no rule added.
- `test/unit/browserCheckLive.test.ts`, `test/unit/browserCheckR51.test.ts` —
  real pinned browser runtime, real owned proxy; loopback page/counter
  servers are the peer under test, not a listed stand-in. `vi.waitFor` is
  real-condition polling. Skipped without an installed runtime.
- `test/integration/webFetch.test.ts` — `recordingProxy` is a real loopback
  TCP peer standing in for the user's proxy config; the tunnel is never
  opened and nothing leaves the machine.
- `test/integration/questions.test.ts` — real renderer; the "test-only
  injected host" is built from real vscode APIs and posts real protocol
  messages; the driver clicks the real card. `EventEmitter` is the test's
  own answer channel.
- `test/unit/helpers/github/repositories.ts` — real git repos built by the
  real git CLI; "standing in for GitHub" is localhost transport of the real
  protocol with captured remote URLs.
- `test/unit/helpers/sharingFixtures.ts`,
  `test/unit/helpers/questions/fixtures.ts`,
  `test/unit/playbookSurfaceFixtures.ts`,
  `test/unit/helpers/cursorTabFixture.ts` — data builders only.
- `test/unit/helpers/stageRaceCapture.ts`,
  `test/unit/helpers/protectedWriteCapture.ts`,
  `test/unit/helpers/m46Capture.ts`, `test/unit/helpers/m79Capture.ts`,
  `test/unit/helpers/githubCapture.ts`,
  `test/unit/helpers/credentialShapes.ts` — recorded live exchanges with
  capture date and command; per the rule this is the allowed outside-world
  input. The "loopback fake of the Responses API" in stageRaceCapture
  describes how the capture was produced, not a double used by tests.
- `test/unit/helpers/inspectStart.ts` — a real `spawn`-based starter for
  the inspect port; "Fake-only tests" means tests that use no fakes.
- `test/unit/helpers/resourceLifecycle.c` — compiled and run for real; the
  zombie process is a genuine OS process read by the real tree readers.
- `test/unit/helpers/windowsScreenRecorderChecks.cs` — `fakeType` is a
  local reflection variable name, not a double.
- `test/unit/helpers/modelApiKeys.ts`,
  `test/unit/helpers/syntheticTokens.ts` — synthetic key/token shapes as
  validator/redactor input data, documented as such.
- `test/unit/helpers/teamHolders.ts` — holder data records.
- `test/unit/helpers/sparkHooks.ts` — calls the real `parseForeignHooks`.
- `test/unit/helpers/jobSource.ts` — reads through the production reader.
- `test/fixtures/golden-requests/`, `test/fixtures/models-activation-baseline/`,
  `test/fixtures/team-worker-certified/` — recorded wire exchanges and
  embedded sources (fixture data, not tests).
- `test/fixtures/msp/account-login-granted.json` — recorded frame with a
  redaction note naming its `someone@example.com` stand-in labels.
- `test/fixtures/tabHooks/completion.mjs` — a real executable hook script
  fixture (the outside-world input), not a double.
- `test/harness/*` — the scripted fake host is the sanctioned `ui:look`
  tooling (AGENTS.md), not a test; out of scope for deletion.

## Deletion plan (step 1 of the lane)

Delete the STAND-IN cases/files above; for each, record the withdrawn claim
and its real-use proof step in this file's follow-up section. Rewrite
`prompts.test.ts` to inline the arrays (no claim withdrawn). Extend the
no-fakes lint block to `test/**/*.mjs` and add `new Proxy` plus
`Module._load`/`_resolveFilename` interception rules with red drills.
