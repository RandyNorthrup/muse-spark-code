# RVINT9 — independent review of merge round 9 (2026-11-02)

Review lane with fix rights, on Grok, worktree `/Users/randy/lanes/RVINT9`,
branch `rv/int9`. Base is `cc/int9` at `5ec754534` (CC-INT9). Reviewed range:
`810b320fc..5ec754534` (26 first-parent commits) plus the tree as merged.
No work was merged by this lane. No Muse request and no paid call. The
vault suites and the OS credential-store suites were not run: no finding
needed them. `acpShutdown` was not run: it needs a real CLI and a
screenless login, and CC-INT9 did not get it green.

## Method

Read of the external-lead path (`src/host/team/externalOrchestrator.ts`,
the team MCP server, the stdio bridge), the worker fence and stop
mapping, the shutdown path, every `fix(int):` commit in the range, the
merged M111 desktop shell, and the claims in CHANGELOG, README, ROADMAP
and PLAN. The MHP re-freeze `62d320f63` was compared as a token delta of
the schema diff. Fixes below have a test that fails when the check is
removed and passes when it is restored. Refusals are sentences or
protocol errors, not a dropped request.

## Findings fixed

### P1. A desktop file path could leave the workspace through a link

`desktop/app/files.ts:20` (`confinedPath`) used to keep a name that
looked inside the root. `readFile` and `writeFile` then follow a symlink
or a Windows junction. A renderer read of `linked/secret.txt`, where
`linked` points at a directory outside the workspace, returned the
outside file's text. A write of a file that did not exist yet under that
link would have created it outside.

`confineToRoot` (`src/core/fs/confine.ts:37`) walks each component.
`isOutsideRoot` (`src/core/fs/confine.ts:12`) compares with `/`
separators, so a Windows relative path is judged the same way. A symlink
or junction (`isSymbolicLink`, which is also how Node reports a Windows
junction) is `realpath`'d and kept only when the target stays inside the
root. A dangling link is refused. A missing final name is kept only when
the directory already walked is inside the root, so the later
`writeFile` is never given the leaving name. An inside link is the file
it names. The listing skips a link before it treats the entry as a
directory (`desktop/app/files.ts:35`). The refusal is the existing
`DesktopFileError` (`outside-workspace`), with the relative name. The
editor opens a file through this same bridge
(`src/webview/desktop/DesktopApp.tsx:176`).

Fix commit `d72a76e250b2e2e866bcf8e502a2734da600b6e2`.

### P2. An external agent's file request had the same hole

`ExternalOrchestratorHost.confine` (`src/host/team/externalOrchestrator.ts:1146`)
now calls the same walk. A path that leaves comes back as the ACP error
`outside the workspace` (`externalOrchestrator.ts:1117` and `:1133`).
The absolute shape, including a not-yet-existing name under a leaving
link, is the `confineToRoot` suite.

Fix commit `d72a76e250b2e2e866bcf8e502a2734da600b6e2`.

### P2. The stdio team bridge would post its bearer to any URL it was given

`bridgeEndpoint` (`src/host/team/teamHttpBridge.ts:73`) used to accept
whatever `MUSE_TEAM_BRIDGE_URL` held. Node also rewrites
`http://0x7f000001/mcp` and `http://2130706433/mcp` so the hostname is
`127.0.0.1`, which would have passed a hostname-only check and posted to
port 80. The raw authority is checked (`teamHttpBridge.ts:46` and
`:51`): only `http` with `127.0.0.1` or `[::1]`, and an optional numeric
port. `localhost`, a lookalike host, `https`, userinfo, and the numeric
rewrites are refused. The refusal is `BridgeEndpointError` with the
fixed sentence at `teamHttpBridge.ts:13`. A JSON-RPC request gets that
sentence as an internal error and the address and the bearer are not
repeated. A notification with a bad URL gets no reply line. A missing
variable is still named. The built `dist/teamHttpBridge.js` is what the
spawned bridge runs.

Fix commit `d72a76e250b2e2e866bcf8e502a2734da600b6e2`.

### P2. A protected write was missed when the path used backslashes

`isProtectedPath` splits on `/`. An external agent's resolved path on
Windows can use `\`, so `C:\repo\.git\config` was one segment and was
not treated as protected. `isExternalAgentProtectedWrite`
(`externalOrchestrator.ts:1452`) normalises to `/` first. The write
path and the approval card both use it. The refusal word is
`protected path` (`externalOrchestrator.ts:1134`).

Fix commit `d72a76e250b2e2e866bcf8e502a2734da600b6e2`.

## Red/green drills

Repository timeout. No `--testTimeout`. `--maxWorkers=2`. Each break was
restored and the file compared with the copy taken before the break.

- Desktop link. `confinedPath` put back to a lexical prefix check.
  `npx vitest run test/unit/desktop/shell.test.ts -t "refuses a symlink" --maxWorkers=2`
  failed: the read resolved
  `{ path: 'linked/secret.txt', text: 'top-secret' }` instead of
  rejecting. Vitest: 1 failed. The file was restored (a shell `status`
  assignment aborted the script before its own restore line; the copy
  was put back by hand and `cmp` matched). Green, full file:
  `npx vitest run test/unit/desktop/shell.test.ts --maxWorkers=2`,
  6 passed, exit 0.
- Bridge. The loopback condition was `if (false)`.
  `npx vitest run test/unit/team/teamHttpBridgeTarget.test.ts -t "refuses https" --maxWorkers=2`
  failed with `TypeError: Protocol "https:" not supported. Expected "http:"`
  at the post, so the request was attempted. `RED_DRILL_EXIT:1`.
  Restored. Green, full file: 8 passed, exit 0.
- Protected path. `isExternalAgentProtectedWrite` called
  `isProtectedPath` on the path as given, with no separator change.
  `npx vitest run test/unit/team/externalAgentPath.test.ts --maxWorkers=2`
  failed: `C:\repo\.git\config` was `false`, expected `true`
  (`externalAgentPath.test.ts:6`). `RED_DRILL_EXIT:1`. Restored (`cmp`
  matched, `git diff` empty). Green: 1 passed, `GREEN_EXIT:0`.

## What was reviewed and holds

- **Who can reach the team endpoint.** `TeamMcpServer` listens on
  `127.0.0.1` and an ephemeral port (`teamMcpServer.ts:269`). The
  conversation's bearer is compared with `timingSafeEqual`
  (`teamMcpServer.ts:91`). A POST without it is 401 and an empty body
  (`teamMcpServer.ts:216`), and the log line does not include the token.
  Anything that is not POST is 405 (`teamMcpServer.ts:210`). There is no
  CORS grant, the token is not a cookie, and it is not placed in argv.
  The listening URL is logged without the token (`teamMcpServer.ts:281`).
  A page cannot attach `Authorization`. Another user can open the port
  and is refused. A same-user process that can read the bridge child's
  environment (`MUSE_TEAM_BRIDGE_HEADERS`, which the agent receives in
  `session/new` and passes to the stdio server) can present the bearer.
  That is the accepted same-user boundary. An Origin or Host check was
  not added: the bearer is the proof, and a browser page already cannot
  send it.
- **Payer line, sign-in, cancel, child environment.** The payer sentence
  is `UI_TEXT.teamExternalLeaderNotice`, shown at
  `conversationController.ts:5329`. Sign-in stays the agent's:
  `signInSentence` (`externalOrchestrator.ts:113`) is thrown when the
  agent asks (`externalOrchestrator.ts:1273` and `:1332`), and
  `supportsTerminalAuth` is false (`externalOrchestrator.ts:1073`), so
  this host does not show another vendor's login and does not read
  another vendor's token files. `cancel` sends `session/cancel`
  (`externalOrchestrator.ts:720`). The agent is started with
  `spawnGuarded` and `workspaceChildEnvironment` of
  `withoutCredentials` (`externalOrchestrator.ts:1005`), so names that
  `isCredentialVariable` treats as keys, tokens, or secrets (ours and
  other providers') are not in the child's environment. The team bearer
  is the conversation's own header, given to that agent on purpose.
- **Workers.** `acpSpawnArgs` (`workerFence.ts:1042`) throws
  `AcpUserServersSwitchError` when a preset has neither a spawn switch
  nor `session/new` meta, and when the caller passes extra arguments
  that could undo the switch. Codex and Copilot have neither, so they
  do not start. Claude carries `strictMcpConfig`. Gemini carries
  `--allowed-mcp-server-names` with a name no server has. Our own agent
  carries `--no-user-mcp-servers`. `--allow-contributor-models` is added
  only when `isListedContributorModel` (`workerFence.ts:1030`) is true:
  the id ends with the contributor suffix and is a key of
  `MODEL_EFFORT_LEVELS`. `session/new` does not send a model id.
  `setModel` accepts only an id the agent advertised. `reportForStop`
  (`report.ts:61`) lets only `end_turn` carry a structured report.
  `max_turn_requests` and `max_tokens` are `capped`. Any other stop is
  `failed`. `f1e85e4d3` holds: a Muse Code turn that finished capped is
  `max_turn_requests`, not a finished report.
- **Shutdown.** `watchClientLeaving` (`serveLifetime.ts:12`) treats
  SIGTERM, SIGINT and SIGHUP as the client leaving and aborts. Stderr
  EPIPE is ignored; any other stderr error is rethrown
  (`serveLifetime.ts:25`). EOF is the stdin stream the agent connection
  reads (`main.ts:1915`); `connection.closed` is what ends the serve.
  Muse Code is stopped by the group this launch recorded, and only
  while that child has not already exited (`museResourceLaunch.ts:224`
  and `:233`). On Unix a pid is not reused until the parent reaps it.
  The external host's `close` (`externalOrchestrator.ts:1425`) returns
  when `exitCode` or `signalCode` is already set, and otherwise signals
  the process group of the child it spawned.
- **Second MHP re-freeze.** `62d320f63` touches `PLAN.md`,
  `mhp-v1.1.lock.json` and `mhp-v1.1.schema.json` only. The schema diff's
  token delta is `+18` of the word `"external"` and `+18` commas from
  wrapping those lines. No other token moved. The v1 schema was not in
  the commit.
- **M111 desktop.** The workbench window is
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  `webviewTag: false` (`desktop/app/main.ts:113`). `will-navigate` is
  cancelled (`main.ts:135`). A window open is denied, and
  `shell.openExternal` runs only when `isExternalUrlAllowed`
  (`main.ts:139`). The page CSP is `default-src 'self'; script-src 'self';
style-src 'self'; img-src 'self' data:; connect-src 'none'`
  (`desktop/app/index.html:7`). There is no custom protocol. The
  permission handler allows only `clipboard-sanitized-write`
  (`src/shared/desktop/workbench.ts:136`); a denial is written out.
  File IPC goes through the window record and the confined read and
  write. The preload is a frozen bridge and says no Electron or Node
  object crosses it (`desktop/app/preload.ts:1`). The desktop and editor
  webview sources have no `node:` import, `innerHTML`, or
  `dangerouslySetInnerHTML`. Lane ED reads files through that bridge.
  Lane IN's generated Rust and QML tables were regenerated in
  `3679dbb0e`. `node scripts/check-l10n.mjs` reports 5 rust files, 3 qml
  files, 0 problems. Those generated strings were not re-read line by
  line beyond that gate.
- **`fix(int):` commits.** The MHP schema, the connector storage guard
  (`00c7c543b`) and the guarded external spawn (`633b3e2ea`) were
  diff-read. The storage guard resolves the anchor when the data folder
  does not exist yet, so a link above the anchor (macOS `/var`) is the
  path the system uses; a missing anchor stays as given; anything other
  than ENOENT is rethrown. The spawn change replaces a raw
  `child_process` spawn with `spawnGuarded` and the workspace child
  environment. Neither removes a safety limit. `f1e85e4d3` is the capped
  stop above. `11663376e` is the host-api count; this lane's new
  `node:fs/promises` import moved it from 241 to 242, recorded in
  `dcf9fd271`. The rest (`5fb118e35`, `fd48af664`, `b62b5d4a8`,
  `a2fc8f7aa`, `a057eb5cc`, `125886546`, `b10e6f7fb`, `dabb0985d`,
  `3679dbb0e`, `c7b1353c9`, `e892d8075`, `a91136652`) are a shared test
  helper, a guard-list entry, a label lookup, entry-point scripts, one
  English key, narrowed editor catches, held claims, an RVINT6 docs
  merge, regenerated language tables, the host version string, knip
  entries, and a model-text split so existing bundle budgets hold.
  None of those messages drops a behaviour or removes a safety limit.
  Catches stayed on the baseline. No budget was raised.
- **Claims.** CHANGELOG `[Unreleased]` `### Security` has two bullets:
  the link refusal (including a file that is not there yet, and an
  inside link being the file it names) and the loopback-only bridge
  (the address is not repeated). README was not given an external-lead
  sentence or an `exec --vault` sentence. ROADMAP was not edited
  (`check:roadmap` is current). The ORCHEXT and TEAMWORKERS sentences
  held by `b10e6f7fb` stay held. No packed team run is claimed. PLAN's
  M96 and M111 status lines dated 2026-11-02 point at this record.

## Still open

- **P3. Same-user team bearer.** Stays open on purpose. See the endpoint
  note above. Another user and a page cannot drive the team. A process
  of the same user that can read the bridge environment can.
- **P3. A wonder id can be offered as a standard Muse Code model.**
  `modelApiPaidTier` returns `'wonder'` for a wonder id
  (`src/shared/paidBoundary.ts:146`), not `undefined`. The registry
  drops a Muse Code model only when the tier is `undefined`
  (`teamModelRegistry.ts:210`, reason `capture`) and labels every other
  non-contributor tier `'standard'` (`teamModelRegistry.ts:152` and
  `:177`). The contributor spawn flag is not added for it. There is no
  separate refusal if an agent advertises a wonder id and the pool
  names it. This lane does not invent that refusal, and it started no
  Muse session. Recommendation: leave it for a lane whose brief is that
  refusal, and say the refusal. Do not guess one here.
- **P3. The person's desktop terminal strips only `*_API_KEY`.**
  `desktop/app/terminals.ts:22`. Other credential names stay so tools
  the person starts keep working. The external agent's child is the
  path that uses `withoutCredentials`. The comment used to claim the
  wider strip; it now says what the code does, and the shell test locks
  `GITHUB_TOKEN` staying. Recommendation: leave the person's shell as
  it is.
- **P3. `open-workspace` accepts any directory the renderer names.**
  `desktop/app/main.ts:212`. That is the open-folder command. The new
  window's file bridge is confined to the root it opened. Not removed.
- **P3. A hard link is not a symlink.** `confineToRoot` does not look at
  `nlink`. A hard link to an outside file is the same inode and is not
  refused. Symlinks and junctions are the hole this lane closed.
- **P3. A pid could be reused between the exit check and the signal.**
  `externalOrchestrator.ts:1433` reads `exitCode` / `signalCode` and
  then `process.kill(-child.pid)`. The child is the one this host
  spawned. On Unix the pid is not reused until this parent reaps it.
  The window is theoretical and stays open. Muse Code's own stop sets
  `hasExited` from the exit promise before a later signal
  (`museResourceLaunch.ts:318`).
- **P3. A permission request with no session is cancelled without a card.**
  `onPermissionRequest` returns undefined when no session owns the call
  (`externalOrchestrator.ts:1044`). `settlePermission` maps that to
  `{ outcome: 'cancelled' }` (`acpProcess.ts:452`), which is what the
  agent is told. The person may not see a card. Stays open. It is not
  silent toward the agent.

## Gates

On `d72a76e25` (the product fix), then again on `dcf9fd271` where a gate
reads the whole tree. The product sources did not change between those
commits. `npx vitest related` and the dist bridge suite ran once, on
`d72a76e25`, whose bridge and confine sources are the ones still in the
tree. The later production build of that same bridge stayed inside the
same budgets.

| Gate                                                                                                                                                                      | Exit                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prettier --check (touched files, both commits; the hook re-ran it)                                                                                                        | 0                                                                                                                                                                          |
| eslint --max-warnings 0 (touched files; the hook re-ran it)                                                                                                               | 0                                                                                                                                                                          |
| npm run typecheck                                                                                                                                                         | 0                                                                                                                                                                          |
| node scripts/check-l10n.mjs                                                                                                                                               | 0                                                                                                                                                                          |
| npm run check:reference                                                                                                                                                   | 0                                                                                                                                                                          |
| npm run check:host-api                                                                                                                                                    | 0 (was 1 on `d72a76e25`: `node:fs/promises` 241 vs 242; `dcf9fd271` records 242)                                                                                           |
| npm run check:plan                                                                                                                                                        | 0                                                                                                                                                                          |
| npm run check:roadmap                                                                                                                                                     | 0                                                                                                                                                                          |
| npm run check:catches                                                                                                                                                     | 0 (baseline matched; no SWALLOW, GENERIC or CLEANUP rise)                                                                                                                  |
| npm run duplication                                                                                                                                                       | 0 (was 1 on `d72a76e25`: 2 clones; `dcf9fd271` shares the setup)                                                                                                           |
| npm run cycles                                                                                                                                                            | 0                                                                                                                                                                          |
| npm run deadcode                                                                                                                                                          | 0 (pre-existing knip tag hints only)                                                                                                                                       |
| npm run build                                                                                                                                                             | 0. `dist/teamHttpBridge.js` 3.2 KiB (budget 25). `dist/externalOrchestrator.js` 211.9 KiB (budget 250). `dist/desktop/main.mjs` 918.4 KiB (budget 1050). No budget raised. |
| SAST (`SSL_CERT_FILE=/etc/ssl/cert.pem SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`)                                                                             | 0 (0 findings). Semgrep printed its known segfault-handler warning and rule timeouts in four pre-existing files.                                                           |
| npm run security:audit                                                                                                                                                    | 0 (2 moderate advisories noted, 0 exceptions)                                                                                                                              |
| npx vitest related --run --maxWorkers=2 on confine.ts, teamHttpBridge.ts, teamHttpBridgeEntry.ts, externalOrchestrator.ts, desktop/app/files.ts, desktop/app/terminals.ts | 0 (5 files, 30 tests)                                                                                                                                                      |
| npx vitest run test/unit/team/teamHttpBridge.test.ts --maxWorkers=2                                                                                                       | 0 (3 tests, including the built bridge refusing a public URL and not repeating it)                                                                                         |
| npx vitest run test/unit/fsConfine.test.ts test/unit/desktop/shell.test.ts test/unit/team/teamHttpBridgeTarget.test.ts --maxWorkers=2                                     | 0 (19 tests), after the shared helpers                                                                                                                                     |
| npx vitest run test/unit/tabByo.test.ts --maxWorkers=2                                                                                                                    | 0 (5 tests). This is the provider wire helper's body reader, after it moved.                                                                                               |
| npx vitest run test/unit/team/externalAgentPath.test.ts --maxWorkers=2                                                                                                    | 0 (1 test), the green half of the third drill                                                                                                                              |

## Commits

- `d72a76e250b2e2e866bcf8e502a2734da600b6e2` — the link walk, the loopback
  bridge, the Windows protected-path check, the two CHANGELOG bullets,
  the PLAN status lines.
- `dcf9fd2712b14f974c27992446b1d24ea777ada7` — host-api count 242, and
  the two test helpers that remove the clones.
- The commit that adds this record.

Hooks were the repository's (`.husky/_`). Nothing was pushed.
