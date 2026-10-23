# RLF-REFRESHLOCK — one refresh lock for the editor and the CLI (ChatGPT and Grok)

Lane `rec/rlf-refreshlock` on rig `macbook`, 2026-10-23. Base `int/recovery`
at 0.19.0 (`d057bf2038`, with RLGROKAUTH); merged
`src/RLF-REFRESHLOCK/01-rec-rvsec` (RVSEC's callback and refresh fixes plus
RLM109) as commit `31a30d952`, then built the unification RVSEC left as a
residual on top.

## What changed

The shipped split: the editor serialized subscription refresh with a
file lock in global storage (`chatgpt.refresh.lock` /
`grok.refresh.lock`) while the runtime CLI and ACP agent used a named
lock (pipe on Windows, socket on POSIX). An editor window and a CLI
process refreshing in the same seconds were not mutually excluded; with
rotating refresh tokens the loser's refresh could read
`sign-in-required`.

Both surfaces now take the same person-scoped named lock on the same
names, built once in `grantLockNames` (`src/runtime/namedLock.ts`):

- New `src/host/providers/subscriptionRefreshLock.ts`: the editor
  wrapper with per-provider ChatGPT and Grok bindings. Contention past
  the deadline fails closed as the provider's `lock-busy`; an
  unopenable lock keeps the provider's existing local sentence.
- `src/host/providers/chatgptSignIn.ts` and `grokSignIn.ts` use it for
  `withRefreshLock`; the file-lock options, owner ids and (for Grok)
  the global-storage path are gone.
- Deleted `src/host/providers/subscriptionFileLock.ts`; its
  `fileErrorCode` helper moved unchanged into
  `src/host/providers/subscriptionCallback.ts`.
- `src/runtime/subscriptionRefreshLock.ts` builds its names through
  `grantLockNames` too (mechanical; behavior identical). The sign-in
  cores are untouched, so the loser still re-reads under the lock: it
  waits, then reads the winner's rotated grant instead of refreshing.

Tests: new `test/unit/crossSurfaceRefreshLock.test.ts` with worker
`test/hosts/refresh-lock-worker.mjs` over bundle entry
`test/unit/refreshLockWorkerEntry.ts`; `test/unit/grokHostPorts.test.ts`
rewired to the shared lock; shared `lockDirectory` (short socket-safe
dirs) in `test/unit/helpers/temporaryFolders.ts`, shared
`readFetchCall` in `test/unit/helpers/grokDiscoveryFetch.ts`, and
shared `bundleWorker` in `test/unit/helpers/workerBundle.ts` (also
adopted by `namedLockRace` and `runtimeChatGptLock`).

No live sign-in anywhere: discovery is the recorded Grok document
(`test/fixtures/grok/discovery.json`, captured 2026-10-22) and the
token endpoint answers one standard-OAuth refresh shape (RFC 6749
section 5.1, opaque placeholders, no identity token); anything else
refuses.

## Red drills

1. Pre-change split (scratch test on the untouched tree, deleted
   after): the parent held the editor file lock while a runtime child
   attempted the named lock. The child acquired:
   `expected 'worker-outcome:acquired\n' to contain
'worker-outcome:grok.lock-busy'` — no exclusion. Red shown.
2. Committed drill against diverged lock files (`split-<file>` in the
   editor wrapper): 4 failed — both contend children acquired
   (`worker-outcome:acquired`), the race posted twice (`expected 2 to
be 1`), and the editor factory returned a token instead of
   `lock-busy`. Restored: green. (A first break with a `.split`
   suffix stayed green on the process tests because the contender
   scan is prefix-based; the `split-` prefix diverges truly.)
3. Committed drill against a diverged lock folder: only the
   production-names test failed; the four isolated-directory tests
   stayed green, proving the coverage split (isolated tests pin the
   mechanism and file; the production test pins the construction).
   Restored: green.

## Green drill

`npx vitest run test/unit/crossSurfaceRefreshLock.test.ts`
(repo default timeout, no override): 5 passed — ChatGPT and Grok
contend fail `lock-busy` across real processes, the editor and
runtime meet on the production Grok names, the refresh race posts
exactly one token refresh while both sides return the winner's
rotated access token, and the editor factory fails `lock-busy` on a
runtime-held lock. Slowest test ~1 s.

## Suites

All green at the lane head (repo default timeout):

- `grokSignIn` (22), `grokHostPorts` (13), `grokRuntimeHost` (13),
  `grokProviderCommands` (27), `grokPlan` (56),
  `grokClientIdSetting` (2)
- `chatGptCallback` (3), `chatGptHostId` (16), `chatGptHost` (4),
  `chatGptAddNewAccount` (4), `chatGptLocalFailures` (20),
  `chatGptGrantProvenance` (2), `modelsSubscriptionsBundle` (3)
- `runtimeChatGptLock` (9 passed, 2 platform-skipped),
  `namedLock` (3), `namedLockRace` (5, race 19.6 s of its named
  180 s budget), `keystoreOwner` (platform-skipped here),
  `crossSurfaceRefreshLock` (5)
- `npx vitest related` over every changed source file: 851 passed;
  19 failures in 16 files, each measured identical on the untouched
  base (same files, same test names): git/xcode breakage
  (`gitMetadata`, `governedCheckoutGit`, `nativeProcessDefaults`,
  `treeSyncNoDeadline`), browser launch EPERM
  (`devicesPhase2Harness`, `teamWorkerCreate`,
  `teamWorkerCreateBundle`, `evalFreezeLayout`,
  `treesLifecycleNative`), storage-guard environment
  (`connectorStorageGuard`), `ps` denied (`vaultStoreScope`,
  failed before any store access — no keychain write),
  `acpServeHandshake`, `resourceStatusCpu`,
  `schedulePauseAfterFailures`, `playbookSchedulesInputs`,
  `lintStagedBatching`.

## Gates

| Gate                                      | Exit    | Note                                                                                                                                                                                                    |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck`                               | 0       | all projects                                                                                                                                                                                            |
| `eslint --max-warnings 0` (touched files) | 0       |                                                                                                                                                                                                         |
| `prettier --check` (touched files)        | 0       |                                                                                                                                                                                                         |
| `check-l10n`                              | 0       | 0 problems; no new strings                                                                                                                                                                              |
| `check:reference`                         | 0       | no catalog change                                                                                                                                                                                       |
| `check:host-api`                          | 0       | record regenerated (import removals)                                                                                                                                                                    |
| `check:roadmap`                           | 0       | after `roadmap:generate`                                                                                                                                                                                |
| `catch-inventory --check`                 | 0       | new catch is NARROW; counts match                                                                                                                                                                       |
| `duplication`                             | 1       | 5 clones, byte-identical on the untouched base (other lanes' files); this lane's 5 removed via `grantLockNames`, `readFetchCall`, `bundleWorker` and local helpers                                      |
| `cycles`                                  | 0       | no circular dependency                                                                                                                                                                                  |
| `deadcode`                                | 1       | findings byte-identical on the untouched base; this lane adds none                                                                                                                                      |
| `build` (size)                            | 1       | 8 OVERs, same files and sizes on the untouched base; `subscriptions.js` 29.7/50, `subscriptionCommands.js` 46.9/75, `modelsSubscriptions.js` 30.8/50 KiB (base 28.6) all hold                           |
| `check-bundle-split`                      | 1       | 3 `chatgptRecord` problems, identical on the untouched base (RLM109's merged file); 8 further base-side lines are a symlinked-`node_modules` measurement artifact — the four bundles are byte-identical |
| `check-host-globals`                      | 0       |                                                                                                                                                                                                         |
| `check:plan`                              | 1       | 85% budget exceeded on the untouched base too; archiving is the lead's                                                                                                                                  |
| `security:audit`                          | 1       | same 3 advisories on the untouched base; no new dependency                                                                                                                                              |
| `security:secrets`                        | 0       | no leaks (also on both commits via the hook)                                                                                                                                                            |
| `security:sast`                           | NOT RUN | semgrep absent on this MacBook; pip refuses (PEP 668 externally-managed); `uvx` fails building `cryptography` (no Rust toolchain). Hosted CI runs it at integration                                     |
| `test:a11y`                               | NOT RUN | no browser on this MacBook                                                                                                                                                                              |
| `test:integration`                        | NOT RUN | Electron cannot start on macOS                                                                                                                                                                          |
| real-life run                             | NOT RUN | not named by this brief; no paid calls                                                                                                                                                                  |

## Residuals

- The editor ChatGPT factory imports the `vscode` module, so no unit
  test constructs it (same as before this lane); its lock wiring is
  verified by inspection — the same five lines as the drilled Grok
  factory — and its binding is drilled at the wrapper level in two
  real processes. Hosted CI's integration suites cover the factory.
- The red/green base-vs-lane gate comparisons above stand in for any
  claim about pre-existing state; nothing else is claimed.
