# Audit: no stand-in tests in 0.19.0 (TONIGHT)

Date: 2026-10-19. Rig: macmini. Worktree: /Users/randy/lanes/AUDITTESTS.
Branch: audit/0190-tests-real. Audited HEAD: da685b341 (JOINC: release/0.19.0
with the features and dependency groups merged).

## Verdict

Two test files used stand-ins the eslint rule does not catch. Both are
rewritten onto real code in this change; the rest of the tree was swept and
kept with reasons below. One environmental block (this rig's sandbox denies
`/bin/ps`, which the report store's file-backed cache needs for its writer
lock) keeps three rewritten cases plus the sibling suite red here; they fail
identically on the untouched base and must go through hosted CI / an
unsandboxed run.

## Rewritten

- `test/unit/storeProject.test.ts` — `stubRegistry()` served a hand-built
  `{ version, url }` document for any npm URL, 404s for any gallery, and one
  case was named "reads the npm channel live" while nothing left the
  process. It now serves only the committed 2026-10-11 captures
  (`test/fixtures/m113/stores/{npm-latest,marketplace-extensionquery,
openvsx-extension}`, each byte-exact beside its receipt) keyed by the exact
  request the production transport must send, over the captured project
  (RandyNorthrup/muse-spark-code 0.17.0), the same composition
  `reportProductionTransport.test.ts` drives. The marketplace answers only
  the captured POST query form. Fire-proof: `github.calls` expected 999
  fails (`expected … to have a length of 999 but got 1`), reverted; the
  suite is 17/20 here, the 3 failures being the sandbox block below.
- `test/unit/pluginImport.test.ts` — the scan cases ran on
  `test/unit/helpers/memoryImportIo.ts`, a full in-memory filesystem behind
  the product's `ImportIo` port. They now plant real files (and one real
  symlink) in temp dirs and scan through the real `fileImportIo`, with a
  recording wrapper only noting which files were read. The link-escape case
  is `skipIf(win32)` (file links need a privilege Windows CI lacks; repo
  precedent in `privateDirectory.test.ts`). Fire-proof: `none:WRONG`
  fails (`expected … to include 'opencode user linked.js -> none:WRONG'`),
  reverted; 8/8 pass here.
- Deleted `test/unit/helpers/memoryImportIo.ts` (dead after the rewrite; no
  other references). Updated `readBoundChannelRows` in
  `test/unit/helpers/reportKindNetwork.ts` (its only caller is storeProject)
  to the captured rows.

## Sandbox block (reported, not worked around)

`/bin/ps: Operation not permitted` on this rig. The report store's
file-backed cache (`ReportStorage.transaction`, writing) takes the writer
lock, which needs this process's start time, which on darwin comes from
`/bin/ps -o lstart=`. So every stores read through the production
composition ends `unavailable (… store-response-invalid …)`. Measured:
direct capture fetch 200/JSON, adapter schemas parse 0.17.0, scrub is
identity — only the cache write fails, with `The report could not be saved.`
The sibling `reportProductionTransport.test.ts` fails the same 3 cases on
the untouched base (3 failed / 3 passed here). Blocked here: the 3
capture-read cases in storeProject; the routing, unbound, and all pure
parser cases pass (17/20). Needs hosted CI or an unsandboxed run.

## Kept, with reasons (read in full)

- `runtimePullRequestInterleavings.test.ts` — model-based test driving the
  real `PullRequestCheckoutProtocol` + real `createWorktreeRecordStore`;
  the registry/git models sit behind the product's own ports and the
  invariants (one owner, no orphan folder, no git after trust loss) fail
  when the protocol breaks.
- `macRss.test.ts` — recorders behind the product's `ResourceTreeRun` port
  pin the exact `/bin/ps` argv and refusal semantics over the real sampler;
  a second describe runs the real sampler on a live spawned child and real
  ps (blocked on this rig by the same sandbox ban; runs elsewhere).
- `providerPacing.test.ts` — recorded 2026-10-04 provider captures with
  provenance; the one live timestamp is justified in-file.
- `providerLoopbackFetch.test.ts`, `providerOAuthLoopback.test.ts` — real
  loopback sockets; the server is the probe target / the product itself,
  not a provider stand-in.
- `modelApiLegalScan.test.ts` — the adapter (`runLegalScanCall`) is the
  subject; the scripted `LegalScanRunner` feeds its own port, and the
  invalid-result refusal proves validation is real.
- `credentialLease.test.ts` (`mapSecrets`) — a transparent async Map behind
  the 3-method `SecretStore` port, used only to prove lease gating (busy
  refusal, no owner.json residue) over real lock files; no other suite
  covers `credentialLeaseSecrets`, and no real SecretStorage exists outside
  VS Code.
- `pluginDispatch.test.ts` (`now: () => 0`, Node-as-bun fixture) — time is
  irrelevant to the dispatch/containment assertions; the fixture spawns a
  real child through real prlimit arg checks, and a gated block runs the
  real Bun where installed.
- `traceLogs`, `usageService`, `schedulePaidConsent`, `cx1r4Truth`,
  `fileLease`, `teamResources` clocks — deterministic time through the
  product's own `now` port to prove TTL/day-boundary/lease logic; the
  `neverReached` throwers fail loudly if an unreached port is reached.
- `sessionTransfer.test.ts`, `syntheticTokens.ts`, `modelApiKeys.ts` —
  token-shaped inputs for redactor/validator tests, joined/repeated so no
  real secret exists; the assertions (nothing leaks, counts) are behavioral.
- `githubCapture.ts`, `m46Capture.ts`, `m79Capture.ts`,
  `credentialShapes.ts`, `networkFacts.ts`, `sparkHooks.ts`,
  `cursorTabFixture.ts`, UI fixture builders — dated captures with the
  capturing command and certification note, or typed state for pure
  render/format functions; no module behavior hides behind them.
- `transcribeBatchHttp.test.ts` — real ffmpeg conversion; the batch send
  without a key is honestly recorded in `docs/real-life/unproven.md`.
- `acpSdkTransport.test.mjs` — the real `@agentclientprotocol/sdk` stream
  code over real web streams.
- `harnessInit.test.ts`, `lazyBundleFiles.test.ts` and the other
  `toBeDefined`/`existsSync` files — spot-checked: each pairs the weak
  assertion with production-validator or behavioral assertions; none is
  existence-only.
- `test/integration/*` — imports the real `vscode` module (runs inside VS
  Code); the `as vscode` hits are the imports themselves. NOT RUN here
  (needs a display/editor run; for the lead).
- `test/e2e/*live*` — opt-in real runs (owner key/subscription), correctly
  gated out of CI. `schedulesStdio`, `reports`, `estimatorPlanSnapshot`
  e2e drive real code paths. `test/harness`, `test/native`,
  `test/packaging`, `test/hosts`, `test/action/la-check.mjs` — harnesses,
  fixtures and scripts, no stand-ins.
- Sweeps with zero hits: `vi.mock/doMock/stubGlobal/stubEnv/
useFakeTimers/spyOn/fn`, `mock-fs/memfs/sinon/nock/msw`,
  `__mocks__/fake*/stub*` paths, `from 'vscode'` in unit, snapshots.

## Gates on the final tree

- `test/unit/pluginImport.test.ts`: 8/8 pass (real temp dirs, real host IO).
- `test/unit/storeProject.test.ts`: 17/20 pass; 3 fail only on the sandbox
  `/bin/ps` ban (same cause as the base sibling suite — measured above).
- Consumers of the touched helper all pass here:
  `marketplaceStoreAdapter` + `openVsxStoreAdapter` + `reportAdapterHosts`
  (17/17), `githubWorkflowReleases` + `githubWorkflowReleaseIsolation`
  (588/588), `npmStoreAdapter` (32/32).
- `npx prettier --check` on touched files: clean.
- `npx eslint` on touched files: zero warnings, zero errors. (Side fix:
  five multi-line `/** */` blocks in `reportKindNetwork.ts` already failed
  `unicorn/no-asterisk-prefix-in-documentation-comments` at HEAD — the
  unicorn-77 rule flags `*` continuations, and the missed file came with
  the dep group; converted to `//` per repo style. My new code added none.)
- `npm run typecheck` (all projects): exit 0.
- NOT RUN here: `test/integration` (needs VS Code), e2e live (needs keys),
  and the 3 sandbox-blocked capture-read cases — for hosted CI / the lead's
  unsandboxed run.
