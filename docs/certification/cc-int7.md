# CC-INT7 — merge round 7 on int/recovery: ten lanes, four of them security-reviewed (2026-10-30)

Claude Code lane `CC-INT7`, worktree `/Users/randy/lanes/CC-INT7`, branch
`cc/int7`, on the test rig `Macmini.ivettnet` (macOS 15.7.4, Intel x86_64,
Node 24.21.0, npm 11.19.0). Base: int/recovery `0a5ebd718` (CC-INT5's round,
`docs/certification/cc-int5.md`, whose known failures and CC-INT1 to CC-INT4's
are not counted against a merge here). CC-INT6 merges a different set from the
same base on another machine; the lead joins the two rounds. Provider calls:
**0**. Model attempts: **0**. Muse model requests: **0**. Nothing was pushed,
rebased, stashed or tagged. No credential was read: the rig's own
`~/.config/muse/auth.json` was never opened, and every run that needed a home
used a throwaway one under `temp/`.

## 1. The merges

Fetched with `git fetch ~/gates/muse.git "refs/heads/lanes/<name>:refs/remotes/<name>"`
(all ten refs were on this machine) and merged with `git merge --no-ff`, in
the brief's order, each lane's certification record read first
(`rlf-m124ro.md`, `rvnet.md`, `rlf-vaultundo.md`, `rvcred.md`, `rlf-m118.md`,
`rlf-maccred.md`, `rlf-harvest.md`, `rlf-m109.md`, `rlf-approvals.md`,
`rlf-safefix.md`, `cc-govfork.md`, `rlf-nostubs.md`, `rlf-lspbus.md`).
`lanes/rlf-m124ro`, `lanes/rlf-m118` and `lanes/rlf-maccred` were not merged
separately: `lanes/net`, `lanes/m118` and `lanes/maccred` contain them.

| #   | Branch (tip)                        | Built on    | Commits | Merge commit | Conflicts and how they were resolved                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------- | ----------- | ------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `lanes/net` (`9eb9f5f39`)           | `f53ef168f` | 4       | `0ea2f1f87`  | 14: `.gitleaksignore`, `CHANGELOG.md`, `PLAN.md`, `SECURITY.md` (both sides), `package.json` (both devDependency sets), `scripts/build.mjs` (int's `src/host/vscode/prompts` path, the lane's remote bundle), `acpBundles.mjs`, `third-party-notices.mjs`, `runtime/main.ts`, `connectorStorageGuard.test.ts` (int's `usingPrivateDir`); `package-lock.json`, `host-api.md` and the reference files regenerated, never hand-merged |
| 2   | `lanes/cred` (`c615f37ec`)          | `f53ef168f` | 7       | `c276ca683`  | 4: `PLAN.md` (both sides), `ROADMAP.md` and `host-api.md` regenerated, `host/vscode/vault/vaultPanelEntry.ts` (the lane edited `src/host/vault/vaultPanelEntry.ts`, which int moved: int's imports plus the lane's two)                                                                                                                                                                                                            |
| 3   | `lanes/m118` (`7a88f5806`)          | `f53ef168f` | 4       | `4cc565c63`  | 2: `CHANGELOG.md` (both entries), `core/git/github.ts` (the request method type takes `PATCH` from int and `DELETE` from the lane)                                                                                                                                                                                                                                                                                                 |
| 4   | `lanes/maccred` (`221f50197`)       | `b781451b9` | 6       | `d5f6fcb97`  | 1: `CHANGELOG.md` (both). RLF-HARVEST's three commits ride beneath it                                                                                                                                                                                                                                                                                                                                                              |
| 5   | `lanes/rlf-m109` (`47943b96a`)      | `d057bf203` | 14      | `d47585e5c`  | 15: see §3.4                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 6   | `lanes/rlf-approvals` (`5f2223a92`) | `b781451b9` | 9       | `001f8d1c8`  | 2: `CHANGELOG.md`, `test/unit/helpers/museReplay.ts` (`startLiveHost(answer, features, wires, timeouts)`: int's wires parameter, the lane's timeouts after it)                                                                                                                                                                                                                                                                     |
| 7   | `lanes/rlf-safefix` (`4019ec698`)   | `b781451b9` | 4       | `da9027bce`  | 2: `CHANGELOG.md`, `PLAN.md` (both)                                                                                                                                                                                                                                                                                                                                                                                                |
| 8   | `lanes/rlf-govfork` (`681869547`)   | `94b15b376` | 4       | `5a3d0597c`  | 1: `ROADMAP.md`, regenerated                                                                                                                                                                                                                                                                                                                                                                                                       |
| 9   | `lanes/rlf-nostubs` (`bb9461bf5`)   | `94b15b376` | 13      | `b346cacf2`  | 4: `CHANGELOG.md`, `docs/roadmap/entries.json` (both), `ROADMAP.md`, `modelApiRetryNoCount.test.ts` (int's D228 values, 0.5 s base and 8 s ceiling, inside the lane's real jitter window)                                                                                                                                                                                                                                          |
| 10  | `lanes/rlf-lspbus` (`59246df81`)    | `dfcb45936` | 3       | `db73e1f49`  | 14: the UI tables (the `supervision` block: int's fork-protection words, then the lane's two refusal sentences, in the English table's order; `check-l10n` 0 problems). `vscode-jsonrpc` 10.0.0 merged clean; `npm ci` installs it                                                                                                                                                                                                 |

Dependencies that arrived: `oidc-provider` 9.12.2 and `@types/oidc-provider`
9.12.1 (the connector's authorization server) and `@modelcontextprotocol/sdk`
1.32.1 (devDependency, the tests' client) from `lanes/net`, with
`body-parser` 2.4.0 in the lock and `vendor/koa-compose/LICENSE`;
`vscode-jsonrpc` 9.0.3 to 10.0.0 (test-only) from `lanes/rlf-lspbus`. The lock
was regenerated with `npm install --package-lock-only --ignore-scripts` after
the merge, and `npm ci --ignore-scripts` then installed it clean (exit 0, 1,101
packages).

## 2. Decision numbers

`### D<n>` headings each lane adds, against int's `PLAN.md` and
`docs/plan-archive/decisions.md`. Int's numbers stay; a lane decision whose
number int already holds takes the next number from D240, in merge order, with
its heading naming the number it had on its branch (as D226 and D227 do).

| Lane          | On its branch                                                | On int   | Int's own holder of the branch number             |
| ------------- | ------------------------------------------------------------ | -------- | ------------------------------------------------- |
| `net`         | D217, the connector's remote endpoint on the person's own PC | **D240** | D217, the judge fast path's `stat`                |
| `cred`        | D217, undo for a retired vault item                          | **D241** | D217                                              |
| `m118`        | D217, then D218 after RVCRED, the Share-time gist scope      | **D242** | D218, the team runner's playbook board            |
| `rlf-m109`    | D216, agent secret use (lanes T and X)                       | **D243** | D216, the Model API backend on the Muse Code plan |
| the other six | none                                                         | none     |                                                   |

Every reference the lanes added was renumbered by a script that changes only
lines the lane itself added (merge base to tip) and that are not lines of int's
own copy of the file: 40 lines for D240, 35 for D241 (34, plus one in RLF-M109's
PLAN text about the vault undo), 28 for D242 (26, plus RVCRED's two references to
the gist decision), 85 for D243, across `PLAN.md`, `AGENTS.md`, `SECURITY.md`,
`CHANGELOG.md`, `docs/`, code comments and tests. The sentences that talk about
the numbering itself were rewritten by hand (the decisions' numbering notes in
`PLAN.md`, `rvcred.md` and `rlf-m118.md`). The script follows files by path, so
five D217 comments in RLF-VAULTUNDO's panel files, which int moved to
`src/host/vscode/vault/`, were found by a search afterwards (`af4e3935e`). Now
`D217` appears only in int's own heading and in the numbering notes of D227,
D228, D240, D241 and D242 and the CC-INT7 statuses. CC-INT6 uses D229 to D239; this round
uses D240 to D243.

## 3. What each merge needed

Each interaction is its own `fix(int):` commit naming its merge.

### 3.1 `lanes/net`

`2c5e19e4b`. The lane's revoke case (`connectorRemote`: "ends every sign-in
when the connection grant is revoked") failed 2 of 5 alone runs and once in the
related run on this Mac mini (`expected 200 to be 401`), and passed on the
lane's linuxlt. Cause, measured: `verifyAccessToken` read the authority's cached
grant, which a revoke from another terminal updates only when the store's file
watcher fires, and macOS delivers those late; the registry itself refreshes
before every call. `reconcile` now refreshes first, so "revoking the grant ends
its tokens at once" holds. Eight alone runs of that case: 4 failed without the
refresh, 0 with it (§8). The lane's other suites need a temp folder the
connector's storage guard accepts: under macOS's default `/var/folders/...` the
guard says "The connector folder is not private to your account" (the guard
working; `connectorStorageGuard`'s three cases fail the same way on the base),
so they ran with `TMPDIR` inside the worktree.

### 3.2 `lanes/cred`

`RVCRED` left `dist/vaultMigration.js` at 46.7 KiB against 45. On the merged
tree it is **41.1 KiB (42,084 B) of 45** (int's base: 39,222 B, 38.3 KiB): the
46.7 was measured on the lane's older base. The undo is in the bundle
(`undoRetired`, `retiredUndo*` sentences) and no budget moved. The vault suites
that need a broker with the OS credential store were not run (§9).

### 3.3 `lanes/m118`, `lanes/maccred`, `lanes/rlf-approvals`

`dc7e71e2f`: `museCodeLatest.test.ts` imported `MSP_KNOWN_SCHEMA_FINGERPRINTS`
twice (int's RLF-UPAGENT and RLF-HARVEST both added it). `eb12f3a56`: the
approval-persistence suite passed its settle window as `startLiveHost`'s third
argument; on int that slot is `wires`.

### 3.4 `lanes/rlf-m109` (D243): nine commits

The 15 conflicts: `CHANGELOG.md` and `PLAN.md` (both sides' text, D243 after
int's decisions); `scripts/build.mjs`, `check-bundle-size.mjs` and
`check-bundle-split.mjs` (int's bundles and the lane's, and the split rule that
lets both migration chunks carry the codecs' schemas); `chatgpt.ts`,
`migrateCredentials.ts` and `vaultMigrationBundle.ts` (int's text, which keeps
the optional `shell` the palette undo needs); `runtime/main.ts` and
`runtimeServices.ts` (the runtime hands its one owned secret store to the
accounts through int's openEntry-or-secrets input); the two broker suites (the
runtime-slot case beside int's undo cases, the destructive reset case last);
`ROADMAP.md`, `host-api.md` and `catch-baseline.json` taken from int and
regenerated or checked. Then:

- `8712c3f12`: `deviceOwnerVaultUses` builds a `VaultBroker` whose identity port
  gained `verifyFeeder`.
- `8c4e7196e`: **the lane raised two existing budgets** (`dist/vaultBroker.js`
  189.2 to 218.0 KiB, `dist/vaultBrokerBindings.js` 37.2 to 44.7 KiB) from sizes
  measured on its own base. On the merged tree they measure 177.6 and 34.8 KiB,
  inside int's budgets, so the raises are reverted: no existing budget moves.
- `4d3684561`: three new CLEANUP catch sites (core 236 to 237, host 90 to 91,
  runtime 130 to 131 against int's baseline). The feeder-lease finish now ends
  the connection's teardown (`.catch(close)`, as the adjacent
  `closeConnection(...).catch(close)` does); a refused delegation records the
  fixed word `vault-exec-delegation-refused` on the host's stderr; the feeder's
  main records `vault-exec-refused <error name>` (name only, never text). No
  SWALLOW, GENERIC or CLEANUP count is above int's: host GENERIC 95 to 93,
  runtime SWALLOW 30 to 29; the baseline is written lowered, with the churned
  identities of the moved connector and vault sites.
- `928c16ea7`: knip reads `vaultExecEntry.ts`, `vaultExecHostEntry.ts` and
  `vaultPolicyEntry.ts` as entries.
- `bd6843ff7`: three clones (`jscpd` exit 1). `VaultBrokerClient.connectVerified`
  holds the connect-and-verify flow once (`open` sends `hello` after it; the
  feeder sends none), `windowsVaultPipeDial` holds the Windows dialer once, and
  `feederClient.ts` is gone. The flow is unchanged line for line.
- `238ebbec7`: `vaultExecSpawn.ts` imported `{ type ShellTimeLimit }`, which
  esbuild keeps as a side-effect import, so `dist/vaultExec.js` and
  `dist/vaultExecHost.js` carried the Model API tools and their
  `TOOLCHAINS_MODEL_TEXT` (the bundle-split gate failed four ways). It is
  `import type` now: **94.3 and 34.0 KiB** (the lane's 121.6 and 64.0), and the
  lane's own new budgets are lowered to measured plus 15% (110 and 40 KiB), with
  PLAN D6's rationale. Existing budgets untouched.
- `da18e6dd2`: M109's roadmap row lost the sentence `cx1r2Truth` requires of
  dormant work ("is in progress."); it says agent secret use is in progress.
- `a4a303044`: the host API record follows `windowsPipeRelay.ts` importing
  `node:net`.
- `cb618c454`: **the lane's real broker and feeder suite could not run** on a
  ps-capable Mac as shipped, and now does (§6.2).

### 3.5 `lanes/rlf-govfork`

`8b66c751c`: on a ps-capable Mac the four POSIX fork-protection cases run (the
lane's rig denied `ps`). The 521-process flood needs 6 to 8 s here (fill, stop,
group death), past the repository's 5 s and past its own 4 s inner waits; it
carries a named 30 s timeout and 20 s waits with their reasons. The other
three cases and `superviseGoverned` pass unchanged. `96493a653`: the host API
record counts the supervisor's governed spawn.

### 3.6 `lanes/rlf-nostubs`, `lanes/rlf-lspbus`, `lanes/rlf-safefix`

Clean beyond §1. `runtimeLsp`: six cases pass; the three that serve through the
supervisor refuse with the lane's new sentence ("the agent's data folder path is
too long for this system's control socket"), because on macOS a temporary HOME
puts the data folder past the 103-byte socket path limit whatever `TMPDIR` is
(measured with the default, a worktree and a short worktree folder). That is the
fix working (the lane's first finding was the same refusal printed as
`Run failed: Error`), and the cases need a short HOME on macOS (§9, item 6).

### 3.7 Gate regenerations and records

`ROADMAP.md`, `docs/ide-compatibility/host-api.md`, the reference files and the
lock were regenerated, never hand-merged. `13e8df233` adds the dated
integration statuses to `PLAN.md` (M124, M109, M118, RLFGOVFORK, the safefix
section, RLFNOSTUBS).

## 4. Proof on the final tree

Every exit code is the command's own; the tree is `af4e3935e` (a comment-only
change on `13e8df233`, which the gates ran on) plus this record.

| Command                                                                                                         | Exit    | Result                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install --package-lock-only --ignore-scripts`, then `npm ci --ignore-scripts`                              | 0, 0    | lock agrees with `package.json`; 1,101 packages installed                                                                                                                                                                                                                                                                                                                                                                        |
| `prettier --check --ignore-unknown` on the 264 files changed since `0a5ebd718`, this record included            | 0       |                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `eslint --max-warnings 0` on the 183 changed JS and TS files                                                    | 0       |                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `npm run typecheck`                                                                                             | 0       | all projects                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `node scripts/check-l10n.mjs`                                                                                   | 0       | 14 UI tables, 14 usage tables, 285 manifest strings, 2516 source files; 0 problems                                                                                                                                                                                                                                                                                                                                               |
| `npm run check:reference`                                                                                       | 0       | current                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run check:host-api`                                                                                        | 0       | 392 VS Code APIs, 57 files importing vscode, 30 Node built-ins, 76 theme variables; 0 problems                                                                                                                                                                                                                                                                                                                                   |
| `npm run check:plan`                                                                                            | 0       | 247 milestones; 0 drift                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run check:roadmap`                                                                                         | 0       | 247 entries; `ROADMAP.md` current                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run check:catches`                                                                                         | 0       | no SWALLOW, GENERIC or CLEANUP count above int's; two fell (host GENERIC 95 to 93, runtime SWALLOW 30 to 29) and the baseline was written lowered                                                                                                                                                                                                                                                                                |
| `npm run cycles`                                                                                                | 0       | no circular dependency                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm run deadcode`                                                                                              | 0       | knip clean (5 configuration hints, 6 tag hints: the same 6 `@unwired` hints as the base)                                                                                                                                                                                                                                                                                                                                         |
| `npm run duplication`                                                                                           | 0       | 0 clones                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **`npm run build`**                                                                                             | **1**   | **the base's four rows OVER, no fifth, no budget raised.** `dist/teamHost.js` 140.2 of 130 KiB (143,574 B; base 143,526), `dist/teamRunners.js` 78.4 of 75 (80,329 B; same), `dist/teamScheduler.js` 76.5 of 75 (78,313 B; same), `dist/uiText.js` 126.2 of 125 (**129,202 B; base 128,341, +861 B**). 264 other rows hold; tightest `dist/wire.js` 74.9 of 75, `dist/validation.js` 49.8 of 50, `dist/modelApi.js` 522.1 of 525 |
| the rest of the build chain: `check-tokens`, `check-bundle-split`, `gen-lazy-registry --check`                  | 0, 0, 0 | tokens 0 problems; split passes; 189 bundles, 296 loads resolved, current                                                                                                                                                                                                                                                                                                                                                        |
| `check-host-globals`, `third-party-notices`, `check-legal-build-records`                                        | 0, 0, 0 | 136 notices (no regeneration); legal: 0 incomplete, 0 blockers, 0 should-fix                                                                                                                                                                                                                                                                                                                                                     |
| `node scripts/package-vsix.mjs --target win32-x64` (zopfli 0.4.3 in a venv under `temp/`), after the full build | 0       | **`VSIX: 4630087 bytes (budget 4915200)`**: 285,113 under the budget (CC-INT5: 4,362,815). A packaging earlier in this lane, before the full build chain had run, measured 4,416,632; the final number is the one to compare                                                                                                                                                                                                     |
| `npm run package:acp -- --target win32-x64` and `--target darwin-x64`                                           | 0, 0    | **146 of 146** packaged-bundle checks each (CC-INT5: 141); the darwin-x64 package needed `native/darwin/build.sh` and `build-local-judge.sh` run first (gitignored outputs)                                                                                                                                                                                                                                                      |
| `npm run security:audit`                                                                                        | 1       | 9 advisories, 0 exceptions: one high, `follow-redirects` 1.16.1 (via `ovsx`, a dev tool; fixed in 1.16.2). **The untouched base fails identically** (10 advisories, same high, lock entry identical): a newly published advisory, not this round's (§9, item 3)                                                                                                                                                                  |
| `npm run security:sast` (semgrep 1.180.0 in the venv; `SSL_CERT_FILE=/etc/ssl/cert.pem`)                        | 1       | 688 rules, 5300 files: the **same 6 blocking findings as CC-INT1 to CC-INT5**, in `os/build.py`, `os/pi/compose.py` (2), `scripts/build-packs.mjs`, `src/core/backends/modelapi/mcp/headers.ts`, `src/runtime/node/keyStore.ts`; none is a file this round changed                                                                                                                                                               |

## 5. Each lane's own suites, final tree, repository timeouts

`--maxWorkers=3`, three files at a time, no raised timeout anywhere in this
lane (`TMPDIR` inside the worktree for the connector suites, the default for
the rest).

| Lane          | Suites                                                                                                                     | Exit | Result                                                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `net`         | `connectorRemote`, `connectorRemoteIssuer`, `connectorStorageGuard`                                                        | 1    | 21 passed, 3 failed: the three `connectorStorageGuard` cases, which fail identically on the base (§7). `connectorRemote` 13/13 in all seven full runs after the fix, and its revoke case alone 8 of 8 |
| `cred`        | `vaultRetiredUndo`, `vaultMigrationList`, `vaultViewMachine`                                                               | 0    | 23 passed (real render; the broker-backed undo and reset cases are hosted CI's, §9)                                                                                                                   |
| `m118`        | `gistShare`, `githubGist`, `gistGrantStore`                                                                                | 0    | 31 passed                                                                                                                                                                                             |
| `maccred`     | `credentialFile`, `cliCredentialFile`, `museCodeLatest`; `authFastSignIn`, `cliPeek`                                       | 0    | 95 and 7 passed                                                                                                                                                                                       |
| `rlf-m109`    | `vaultPersonPolicy`, `vaultExecEnvelopeDigest`, `vaultHeadlessDeny`; `policy`, `vaultExecSpawn`, `migrationCodecRoundTrip` | 0    | 7 and 34 passed                                                                                                                                                                                       |
| `rlf-m109`    | **`vaultExecDelegated`** (real broker, real feeder process, real native peer helper)                                       | 0    | **3 of 3 in each of five runs** (§6.2)                                                                                                                                                                |
| `approvals`   | `museCodeApprovalPersistence`, `museCodeAutoResend`                                                                        | 0    | 10 passed                                                                                                                                                                                             |
| `rlf-safefix` | `scheduleDeferredRetry`, `watchdogQuotedAck`, `contributorGuard`; the three `watchdog*` suites                             | 0    | 9 and 28 passed                                                                                                                                                                                       |
| `rlf-govfork` | `resourceForkProtection`, `superviseGoverned`                                                                              | 0    | 5 passed, 3 skipped (the Windows job object)                                                                                                                                                          |
| `rlf-nostubs` | its 18 suites, six batches                                                                                                 | 0    | 249 passed, 20 skipped (Windows-only cases)                                                                                                                                                           |
| `rlf-lspbus`  | `runtimeLsp`, `superviseRefusal`                                                                                           | 1    | 8 passed, 3 failed: the three supervisor cases, by the macOS socket-path limit, with the lane's new sentence (§3.6)                                                                                   |

## 6. Real use

### 6.1 The packed agent: `initialize`, then `session/new`

The merged tree's `dist/acp.js`, packed (`npm run package:acp -- --target
darwin-x64`, 146 of 146 checks) and extracted into an empty folder, in an empty
workspace with a fresh HOME. Expected calls: **0 model requests** (no prompt is
ever sent). The client is a short script of this lane (`temp/real-acp.cjs`,
JSON-RPC lines over stdio).

- **Fresh HOME, nothing signed in:** `initialize` answered (protocol 1, five
  auth methods, session capabilities list/resume/close). `session/new` answered
  at once with a said refusal, not a redacted internal error: `-32000`
  "Authentication required: Muse Code is not signed in; sign in and try again."
  (`data.kind: authRequired`). No `muse serve` was started.
- **Fresh HOME with a placeholder sign-in** (`test/fixtures/maccred/v1-auth-set.json`
  copied to the throwaway HOME's `.config/muse/auth.json`, every proxy variable
  at the dead `127.0.0.1:9`, so nothing could leave the machine): the agent read
  the file as `inline`, spawned `muse serve --disable-shell` and logged "Still
  waiting: muse serve starting (1m… 2m)"; `session/new` never answered in 170 s.
  **Cause, measured, and it is this machine and the CLI, not the agent:**
  `sample` of the CLI (Muse Code 1.4.11-R6667.1) showed its main thread in
  `SecItemAdd` > `StorageManager::defaultKeychainUI` > `makeLoginAuthUI` >
  `AuthorizationCopyRights` > `xpc_connection_send_message_with_reply_sync`: the
  CLI writes a Keychain item at startup, the fresh HOME has no default
  keychain, and macOS waits for an authorization dialog that a session without
  a screen can never show. A direct `muse serve` with the same environment, no
  agent in front, stuck the same way for 40 s with nothing on stdout or stderr.
- RLF-SAFEFIX's redacted internal error in adoption code did not reproduce on
  the merged tree with a fresh HOME (the first case). With a real signed-in
  HOME the CLI would use the owner's keychain, which this lane must not touch.
- **Two observations on the agent itself** (the CLI stuck in that wait):
  closing the agent's standard input did not end it within 25 s, and SIGTERM to
  the agent left `muse serve` running as an orphan (two orphans, found by
  `lsof`/`ps` and stopped by pid). The startup wait does not follow shutdown
  (§9, item 5).
- The three `muse serve` starts (two through the agent, one direct) were
  against throwaway homes with a dead proxy: **0 model attempts, 0 network
  requests**. The brief's embargo (no Muse request "until 2026-10-25 17:00
  Pacific") had passed by this machine's clock (Fri Oct 30 19:16 PDT 2026); I
  read it as ended and, because of the dead proxy, nothing would have reached
  Muse either way. If the lead means it to hold longer, these three starts are
  the step to name. Once, `sample` wrote its 96 KB report to `/tmp` (its
  default); I deleted it at once.

### 6.2 RLF-M109's real broker and feeder suite, run here

`ps` works on this machine, so `test/unit/vault/vaultExecDelegated.test.ts`
could be run, and as shipped it could not (§3.4, `cb618c454`). What it needed:
the broker as a bundled fixture child
(`test/unit/helpers/vault/execBrokerChild.ts`, the product's file anchor and
OS-store slot over file records, so it writes no keychain item; this lane read
the code and ran no keychain command), the host's admission configured the way
`posixPanelFixture` configures it, the person's ceiling written before the
session registers (the broker reads it at registration), the lock issued only
once the command is running and proved by the vault's state, and every long
wait named with its reason. It passes **3 of 3 in each of five runs** on this
Mac mini (darwin x64, ps working, 48 to 51 s a run): ceiling refusals in words
(none, then a ceiling for another workspace), environment and stdin runs
through the feeder with only the value's length and a redacted echo reaching
the host, a git use refused at the host port, a delegation to the wrong process
identity refused by the broker, a tainted use denied as tainted, a redemption
on the requester socket and an `execRedeem` frame refused, and a lock ending a
running `sleep 30` in about 5 s. The darwin helper builds it needs are
gitignored outputs of `native/darwin/build.sh`.

### 6.3 Not run through the product

`exec --vault` end to end (it needs a model turn), `mcp serve-http` through the
packed product, the MCP Inspector and the dual-era client, any hosted-CI leg,
the Windows packages (they do not run on macOS).

## 7. `npx vitest related` over the round's changed sources, and the base

The 112 `src/` and `scripts/` files changed since `0a5ebd718`, without
`src/shared/constants.ts`, `src/shared/l10n/en.ts` and `src/extension.ts` (their
`related` closure is the whole battery; the l10n, reference, catch and build
gates stand for them), in three runs of about 38 files, the repository's own
timeouts, `--maxWorkers=3`: **497 test files, 6,071 tests: 5,847 passed, 184
skipped, 40 failed in 20 files** (plus one file whose hook timed out), 1,652 s.
Excluded, as in CC-INT5: `keyringParts`, `keystoreOwner`, `credentialLease`,
`providerHeadersStore`, `test/unit/vault/**`, `deviceOwnerVaultUses`,
`deviceOwnerBind*`, `devicePairKeyDpapi`, `keystoreSingleFlight` (real OS
credential stores or vaults), `runtimeLsp` (§3.6) and `devicesPhase2Harness` (a
browser suite). Each failing file was then run alone here and on an extracted
copy of the untouched base (`git archive 0a5ebd718` under `temp/base`,
`node_modules` linked, built with `node scripts/build.mjs --production`, the
same `TMPDIR`):

| #   | Files (tests)                                                                                                                                                                                                                                                                                                                                                                                                | Merged tree alone                                                              | Untouched base alone | Class                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `acpServeHandshake` (1), `connectorStorageGuard` (3), `nodeTerminalPage` (6), `playbookGovernor` (1), `playbookSchedulesInputs` (2; 3 in the loaded run), `providerSpend` (1), `resourceStatusCpu` (1), `scheduleFireFailures` (6), `teamCrossBranchAdvisories` (1), `teamEnginePorts` (5), `teamLandingKilled` (1), `teamLandingPause` (1), `teamPlaybookIntegration` (1), `teamWorkerCreateBundle.mjs` (1) | the same 31 tests                                                              | the same 31 tests    | **Base.** Measured identical on the untouched base on this rig. Several are CC-INT1 to CC-INT5's rows (5 s default, APFS case-insensitivity, `connectorStorageGuard`, the team landing suites); the rest are new to the list but identical on the base here, causes UNMEASURED |
| 2   | `cx1r2Truth` (1)                                                                                                                                                                                                                                                                                                                                                                                             | 1 failed, then **18 of 18** after `da18e6dd2`                                  | passes               | **From the merge**, fixed: M109's roadmap row (§3.4)                                                                                                                                                                                                                           |
| 3   | `connectorRemote` (1: the revoke case)                                                                                                                                                                                                                                                                                                                                                                       | 2 of 5 alone runs failed, then 12 of 12 passed                                 | (not on the base)    | **From the merge**, fixed in `2c5e19e4b` (§3.1, §8)                                                                                                                                                                                                                            |
| 4   | `connectorRemoteIssuer` (3)                                                                                                                                                                                                                                                                                                                                                                                  | 3 failed under the default macOS `TMPDIR`; **3 of 3** with a worktree `TMPDIR` | (not on the base)    | The connector's storage guard refusing macOS's default temp chain, as `connectorStorageGuard` does on the base                                                                                                                                                                 |
| 5   | `bestOfN` (1), `nodeBrowserWorkspace.mjs` (hook timeout), `resourceNoLimits` (1), `resourceQueueUnknownOccupancy` (1)                                                                                                                                                                                                                                                                                        | pass alone (the last two 3 of 3 runs)                                          | pass alone           | Load only: timing cases in the loaded 3-worker run                                                                                                                                                                                                                             |

After the fixes the merged tree's red set equals the base's.

## 8. Red/green drills

Each: one edit, the owning gate or suite, the non-zero exit, restored (`cmp`
against a copy), the same command green.

| Break                                                                                           | Caught by                                                                                           | red           | green  |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------- | ------ |
| `vaultPolicy.ts`: a registered requester with no ceiling entry gets `'ask'` instead of `'none'` | `vaultExecDelegated` "refuses without a person ceiling, in words"                                   | 1             | 0      |
| `constants.ts`: `RESOURCE_TREE_PROCESS_CAP` 512 put at 4096                                     | `resourceForkProtection` "stops a tree past 512 alive processes, and only that tree"                | 1             | 0      |
| `channel.ts`: the feeder-lease finish back to a commented empty `.catch(() => {})`              | `npm run check:catches` ("core: CLEANUP rose from 236 to 237")                                      | 1             | 0      |
| `vaultExecSpawn.ts`: `import type { ShellTimeLimit }` back to `import { type ShellTimeLimit }`  | `check-bundle-split` (4 problems: `TOOLCHAINS_MODEL_TEXT` in `vaultExec.js` and `vaultExecHost.js`) | 1             | 0      |
| `oauth/server.ts`: the grant refresh in `reconcile` removed                                     | `connectorRemote` revoke case, 8 alone runs                                                         | 4 of 8 failed | 0 of 8 |

Not deterministic, so counted instead of a single exit: the last row. Natural
red to green during the round, kept as evidence: `cx1r2Truth` (1 failed, then
18 of 18), `check:catches` (1, 0), `deadcode` (1, two unused files and seven
unused exports in used namespaces, then 0), `duplication` (1, three clones, then
0), `check:host-api` (1, 0, twice) and `check-bundle-split` (1, 0). The lanes'
own drills are in their records and ran on their bases.

## 9. Not run, and open decisions

Not run, with the reason:

- The VS Code integration suites (Electron cannot start on a macOS lane), the
  browser suites, `ui:look`.
- The vault and OS credential-store suites (rule): `test/unit/vault/**` except
  the pure ones named in §5 and `vaultExecDelegated`, `keyringParts`,
  `keystoreOwner`, `credentialLease`, `providerHeadersStore`,
  `keystoreSingleFlight`, `deviceOwner*`, `devicePairKeyDpapi`. That includes
  RLF-VAULTUNDO's broker-backed undo, killed-undo and reset cases and
  RLF-M109's runtime-slot cases: hosted CI's.
- Windows-only code and suites; the Windows feeder (refuses in words by design).
- Any model request, real conversation, paid provider call, real team run,
  `exec --vault` through the packed product, `mcp serve-http` through the
  packed product.

Open decisions for the lead:

1. **The four base bundle budgets stay red, and the round grew `uiText.js`.**
   `dist/uiText.js` is 129,202 B (base 128,341, **+861 B**: the connector's, the
   vault undo's, the gist's, the feeder's and the supervision sentences, in the
   English fallback), so the fit lane's target for it is now −1,202 B, not
   −341; `dist/teamHost.js` grew 48 B (143,574; base 143,526); `teamRunners.js`
   and `teamScheduler.js` are unchanged. No merge added a fifth row, no budget was
   raised, and `dist/vaultMigration.js` fits (41.1 of 45 KiB). Recommendation: the
   "fit the team bundles" lane of CC-INT5's item 1, counting `uiText.js` at this
   round's size.
2. **RLF-M109's CHANGELOG lines claim headless use of vault secrets** ("Headless
   runs can use vault secrets in shell commands, behind your ceiling" and the
   keys moving into the vault in the terminal agent). Proven now: the engine path
   through the real broker and the real feeder on a Mac (§6.2) and the key-store
   migration by the lane's pure suites. Not proven: `exec --vault` through the
   packed product, Windows, Linux. Options: (a) keep the lines (the rule on
   claims asks for real use through the packed product); (b) hold the two lines
   until the real-life run includes an `exec --vault` shell call on a Mac or
   Linux. Recommendation: (b), with PLAN's "built" status as it stands.
3. **`npm run security:audit` is red on the base and the merged tree alike**
   (high `follow-redirects` 1.16.1 via `ovsx`, fixed in 1.16.2; published after
   CC-INT5's round, which had 7 advisories and none needing an exception).
   Options: bump or override to 1.16.2, or a reviewed dated exception.
   Recommendation: the override, as its own change.
4. **RLF-M109's raised budgets were reverted** (§3.4) and its two new budgets
   lowered; if the lead wants the lane's exact-bytes convention for
   `vaultBroker.js` kept anyway, the measured sizes on this tree are 177.6 and
   34.8 KiB.
5. **The agent does not follow shutdown while `muse serve` is starting.** With
   the CLI stuck (§6.1), closing the agent's standard input leaves it running and
   SIGTERM orphans the CLI. Cause beyond the observation is UNMEASURED.
   Recommendation: a small lane making the startup wait end on stdin close and
   on SIGTERM, and stop the CLI it spawned.
6. **`runtimeLsp`'s three supervisor cases cannot pass on macOS** with a
   temporary HOME (the data folder path is over the 103-byte socket limit
   whatever `TMPDIR` is). Options: give those cases a short HOME on darwin, or
   skip them there with a said reason. Recommendation: the short HOME, by the
   lspbus owner; whether hosted CI's macOS leg runs the file decides urgency.
7. **The Muse Code CLI blocks in `SecItemAdd` when the default keychain is
   missing** (§6.1): upstream, not ours. Recommendation: file it with the
   `sample` stack summarised there, next to RLF-APPROVALS' U1 (also the lead's to
   file).
8. **Still open from the lanes, unchanged by this round:** RLF-M124RO's owed
   packed-product, Inspector and dual-era checks; RLF-VAULTUNDO's terminal
   `vault undo` (not built); RLF-M118's missing surface and live GitHub run;
   RLF-MACCRED's empty version-2 keychain case (uncaptured); RLF-M109's git,
   askpass, sudo and SSH surfaces, Windows feeder containment and lanes S and O;
   RLF-GOVFORK's fork caps (an internal resilience default, not person-set, by
   its record); RLF-LSPBUS's endpoint-too-long sentence (unproven end to end);
   CC-INT5's items 2 to 6 and CC-INT4's dated ones (Marketplace publishing off
   the personal access token **by 2026-12-01**; ACP SDK 2.0.2 past its 7-day
   window on 2026-10-31).
9. **Joining CC-INT6:** the expected conflict surfaces are `PLAN.md`,
   `CHANGELOG.md`, `ROADMAP.md` with `docs/roadmap/entries.json`,
   `docs/ide-compatibility/host-api.md`, `scripts/catch-baseline.json`,
   `scripts/check-bundle-size.mjs`, `knip.jsonc`, `package.json` with the lock,
   and the reference files; the generated ones regenerate. This round's decision
   numbers are D240 to D243, CC-INT6's D229 to D239.

## 10. Commits

`0a5ebd718` to this record: the ten merges (`0ea2f1f87`, `c276ca683`,
`4cc565c63`, `d5f6fcb97`, `d47585e5c`, `001f8d1c8`, `da9027bce`, `5a3d0597c`,
`b346cacf2`, `db73e1f49`), the lanes' own commits beneath them, fifteen
`fix(int)` commits (`2c5e19e4b`, `dc7e71e2f`, `8712c3f12`, `8c4e7196e`,
`4d3684561`, `928c16ea7`, `bd6843ff7`, `238ebbec7`, `da18e6dd2`, `a4a303044`,
`cb618c454`, `eb12f3a56`, `8b66c751c`, `96493a653`, `af4e3935e`), `13e8df233`
(`docs(plan)`) and the commit carrying this record (264 files changed before
the record, +26,982 / −2,637).
