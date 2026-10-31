# RVINT6 — independent review of CC-INT6 (2026-10-31)

Grok review lane, worktree `/home/randy/lanes/RVINT6`, branch `rv/int6`, on the
test rig `linuxlt`. Started at CC-INT6 `339c1ec951ac312379444c2c8aeca3a83f13d9b0`
(on int/recovery `0a5ebd7189`; `docs/certification/cc-int6.md`: twelve lanes,
607 commits). Model attempts: **0**. Provider calls: **0**. Muse requests: **0**
(the allowance is out until 2026-11-02T00:00:00Z). Nothing was pushed, rebased,
stashed or tagged. Tests ran with the repository's own timeout and
`--maxWorkers=2`. No browser was started (no screen changed). The vault and
OS credential-store suites were not run. No product source changed.

## Findings

No P1, no P2, no P3. Nothing in the four review areas was a dropped behaviour,
a silent refusal, a limit of ours, a removed safety limit, or a weakened guard.
One already-open decision is restated at the end; this lane did not take it.

## 1. The three `-s ours` merges

Each ours merge has an empty tree against its first parent (`0633e654c`,
`1987745cd`, `19d43940a`). The lane's own commits were then applied as one
three-way patch. For every path in that own range, `git merge-file -p --diff3`
combined int at the ours commit, the lane's base, and the lane's tip, and that
result was compared with the patch commit and with `339c1ec95`. A clean
auto-merge that matches the patch is not a drop. A later edit is recorded as
`+LATER` and read on its own.

### rlf-maclive (merge 7)

Own range `4cbb4bae0..b6739143e` (four commits, 11 files). Patch
`0633e654c..f378b4430` (8 files). The usage read, `acpUsageRead`, the shared
journal rig and the usage-delta suite landed. Three flags:

- `src/core/backends/modelapi/ModelApiHost.ts` (`CONFLICT_2_TOOK_OURS`). The
  lane added `log.info(\`Model API turn ${turn.turnId} cancelled\`)` on the
person's Stop (`turn.abort.signal.aborted`) and hoisted `wasStoppedByHook`out of the failure log. At`339c1ec95` the Stop branch
(`ModelApiHost.ts:17402`) still sets `terminal = CANCELLED`, and every exit
emits `turnCompleted` with that terminal (`:17565`). A hook cancel still
warns (`:17401`); a failure still warns with fixed words (`:17469`). The
  person hears the cancelled turn. The missing info line is an internal log,
  not a silent refusal. Not restored.
- `test/unit/acpBackendNotice.test.ts` (`CONFLICT_1_TOOK_OURS`). Int's
  assertion already requires a fresh `messageId` inside `toEqual`
  (`acpBackendNotice.test.ts:53`, `expect.any(String)`). That is the
  RLF-ACPTURNS property the lane rewrote the assertion to check.
- `docs/ide-compatibility/host-api.md` (`CONFLICT_1_TOOK_OURS+LATER`). Generated.
  Later merges regenerated it. Not a behaviour drop.

`src/runtime/main.ts` merged clean, then nodeserve reshaped the node print
binding. `museJournalRig.ts` landed exact, then `dbabb62ce` branded the rig's
clock with `toEpochMs`.

### rlf-nodeserve (merge 10)

Own range `c10ba8805..79aee4ca8` (three commits, 46 files). Patch
`1987745cd..0bf9c7bcf` (44 files). `git diff 79aee4ca8 HEAD` of the serve
core is empty: `serve.ts`, `listener.ts`, `listenerGuard.ts`,
`listenerSocket.ts`, `stop.ts`, `web/files.ts`, `web/terminal.ts` and
`egress/policy.ts` match the lane tip. Flags that are not drops:

- `src/webview/main.tsx` and the rename of `bridges/nodeSurface.ts` to
  `webview/node/nodeSurface.ts` (`TOOK_OURS`). Int already spells the
  stylesheet `NODE_WORKSPACE_STYLESHEET` in `src/webview/bridges/nodeSurface.ts`.
  The test import stayed on that path (`nodeSurface.test.ts`).
- The packaged mini-dist HTTPS serve case left `nodeBundle.test.ts`. The
  governor's bundles cannot ride that mini-dist. The same assertions are in
  `test/unit/nodeServeBinding.test.ts` (14 tests, green below). `serveEntry.ts`
  configures the governor when none is configured, then calls `serveNode`.
- Bundle caps: `nodeServe.js` is 100 KiB by D6 (measured 77.6; the lane's 75
  would fail). `nodeAuth.js` stays at int's 500 KiB cap (measured 470), tighter
  than the lane's 550. Neither cap was raised.

### rlf-m108 (merge 11)

Own range `d4761ac59..79f774baf` (sixteen commits, 94 files). Patch
`19d43940a..ae8bda858` (99 files). Summary flags: **0**. The extra patch paths
are the adaptations the record names (`accountsBundle.ts`, `accountsEntry.ts`,
the catch baseline, the webview bundle list, the split gate). Developer and
placement test titles on the lane tip are all present at HEAD. The one title
that reads differently, "names the unknown provider id…", is the same list-and-add
refusal under "names a missing accounts entry for list and add…"
(`accountErrorTruth.test.ts:277`): `anthropic-s2` list and add both print
`missingAccountsEntry` and exit 1. `placement.ts:104` returns false only for
`AccountStoreError` code `invalidProvidersFile` and rethrows anything else.
The developer badge uses `z.nullable(stringSchema)` (`protocol.ts`), the same
nullable string the lane wrote.

## 2. `fix(int):` commits, conflict resolutions, D121/D208, D229

First-parent `0a5ebd7189..339c1ec95`. Each `fix(int):` commit was read. None
adds a cap the person did not set, and none removes a retry, compare-and-swap,
republish, sweep or wait-to-survive-an-error limit.

| Commit      | What landed                                                                              | Review                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `d1cd9de41` | One import of `MSP_KNOWN_SCHEMA_FINGERPRINTS`                                            | Duplicate import only.                                                                                   |
| `dbabb62ce` | Journal rig uses `toEpochMs`; developer options passes the log                           | Types. The usage read still runs.                                                                        |
| `1f04fd2ed` | Shared fixtures; `serveEntry.ts` is a knip entry                                         | Assertions moved, not deleted (§1).                                                                      |
| `424b3372c` | VSIX archive keeps usage, what's new and the maker preview                               | The loose `!` lines had excluded chunks the package check requires.                                      |
| `a04283dda` | Archive excludes `portable/`                                                             | VS Code does not serve that graph; the bound is 4,000,000 decoded bytes. The ACP package still ships it. |
| `18cab8fc3` | Serial helper and Muse Code setup go through the guarded launcher                        | Workspace entries leave PATH, so a workspace `python3` is not the helper. Strengthens the spawn rule.    |
| `3382fb0f5` | Maker page is `machines panel`                                                           | Bare `panel` stays the MHP host (D84). Same action and flags.                                            |
| `f1050c484` | Arduino fixture lists `dist/devices.js`; workspace build pins `@codemirror/merge@6.12.3` | Follows int's packaging and the updeps pin.                                                              |
| `8593477c4` | Portable loader outfile is a named file                                                  | The packaging reader cannot resolve a template string. The path is unchanged.                            |
| `0a051b448` | Egress `lookup` uses `order: 'verbatim'`                                                 | §3. One line.                                                                                            |
| `d5376e9e4` | Stop label uses named entities                                                           | Superseded by the next row.                                                                              |
| `6ccc3e199` | Two int browser tests follow the exact-origin rule                                       | They fail the same way on rlm103's tip.                                                                  |
| `295a42ac4` | `resourceGovernorWindows.js` is in the container policy and the install layout           | The governor loads it by name.                                                                           |
| `33099cfb3` | Stop shell uses the lane's regex-and-lookup escape                                       | §3. Matches rlm103's tip, plus a `'devices'` surface from a closed union.                                |

Conflict resolutions inside merges 6, 8, 9 and 12 match `cc-int6.md` §2 on the
files read for this review: maker names kept beside int's maker, D6 budgets not
raised (`modelApi.js` back at 525 KiB, `reportingPanel.js` at 50, new
`modelApiShell.js` at 25), OS2 work kept over older cherry-picks, D229 kept as
the setup decision, the portable chat mount carries int's reload flush.

**D229.** Source and tests that install Meta's CLI say D229
(`os/check.py:39`, `os/addons/lib/checkAddon.mjs:29`,
`src/runtime/node/firstBoot/installMuseCode.ts:1`, `constants.ts:7737`,
`nodeOsMuseSetup`, `nodeToolset`, `osImageBuild`). Remaining D227 hits are the
teams-off-until-a-second-model rule (`teamAvailability.ts:1`, `PLAN.md:9434`).
The renumber did not leave a setup check citing the teams decision.

**D121 / D208.** `stopNode` (`stop.ts:75`) polls until the recorded pid is gone
or the caller's signal aborts (`NODE_STOP_POLL_MS` is 100). That wait is the
stop contract, not a cap on the person's work, and the file is the lane's.
`cliMain` aborts it on SIGINT/SIGTERM. A corrupt lock throws
`UI_TEXT.nodeErrors.failed`, which `runNodeArgs` does not treat as a node
refusal, so the CLI reports the failed word and exits 1. Not silent.

## 3. Security as merged

### Node serve

TLS 1.3 only (`listener.ts:218`, `minVersion: 'TLSv1.3'`). The listen address
is `nodeLanAddressSchema` (`node.ts:51`): loopback, RFC1918, ULA and link-local,
refusing `0.0.0.0`, `::`, public addresses, and the metadata addresses
`169.254.169.*` / `169.254.170.*`. It is not loopback-only. RVNET already
accepted that, and this merge did not widen it. `listen` is exclusive
(`listener.ts` `server.listen`). `guardNodeRequest` (`listenerGuard.ts:97`)
requires a single Host in `browserNames:port`, Origin `https://${host}`,
Sec-Fetch-Site `same-origin`, mode `cors`/`same-origin` (or `websocket`), dest
`empty` (or `websocket`), and no Cookie. A duplicate raw header throws
`forbidden` (`nodeHeader`). File reads stay in the workspace: `NODE_PATH_PATTERN`
(`constants.ts:583`) rejects a leading slash, `..`, a dot segment and a
backslash; `checkedPath` (`files.ts:56`) realpaths the root and the file, and
the open uses `O_NOFOLLOW` (`files.ts:96`). The WebSocket upgrade
(`listener.ts:251`) runs that guard first. `upgradeNodeTerminal`
(`listenerSocket.ts:62`) accepts only `GET /node/terminal/stream`, version 13,
a well-shaped key, and refuses an Authorization header and a subprotocol
(`:72`). The bearer is the first frame, with deadline `NODE_WS_AUTH_MS`.
`serveNode` (`serve.ts:617`) closes the listener and shuts the service down
when the caller's signal aborts. Privileged git, maker and auth methods answer
`unavailable`. `nodeServeBinding.test.ts` (14) passed on this tree. This lane
did not repeat RVNET's live probe. An authenticated body over 2 MiB still
needs passkey enrollment; CC-INT6 §8 item 9 already leaves that, and the named
waits, open.

`keyStore.ts` matches the GCM fix `c6929ca78` (empty diff). Decrypt passes
`authTagLength: NODE_VAULT_TAG_BYTES` (`keyStore.ts:86`) before `setAuthTag`.
`nodeKeyStore.test.ts` (7) passed. Node 24 would otherwise decrypt a short tag.

### Egress `order: 'verbatim'`

`0a051b448` changes one option: `{ all: true, verbatim: true }` to
`{ all: true, order: 'verbatim' }` (`egress/server.ts:268`). On this rig,
`dns.lookup` of `localhost`, `127.0.0.1` and `::1` returns the same answers
and order for both option shapes. Order cannot bypass the allow-list:
`selectUsableAnswers` (`policy.ts:221`) refuses the whole connection when any
answer is metadata or not public, and `dialAnswer` (`server.ts:104`) connects
to that IP, not the name. A name that answers with one public address and one
private or metadata address is refused before any dial. `webFetcher.ts:23`
already used `order: 'verbatim'` (with `hints: ADDRCONFIG`). The egress call
does not pass `hints`; that does not skip the all-answers check.

### Browser rule and the Stop shell

`browserPolicy.ts` is identical to rlm103's tip `8864b7635`. `placeBrowserUrl`
(`:176`) refuses a non-public host unless `isExplicitDevOrigin` (`:131`) finds
that exact `url.origin` in the set, and still refuses a maker companion port
and a machine UI. `isAllowedRequest` (`:213`) maps `ws`/`wss` with
`replace(/^ws/, 'http')`, so `wss` becomes `https`. `browserTool.ts` differs
from that tip only by an import split. `browserPolicy.test.ts` (26) passed,
including decimal and hex loopback, machine UI on an allowlisted origin, and
lookalike names. This is stricter than loopback-by-default. It stays the open
decision below; this lane did not restore the old default.

`html.ts:39` escapes `&`, `<` and `>` with named entities in one replace
callback (`:75`). The label is button text. `data-surface` is interpolated
only from `'tasks' | 'devices'`. `html.test.ts` (28) passed, including a label
`<Stop & machines>`.

### Five SAST suppressions

The GCM finding is gone with the tag length above. The five that remain match
the code they annotate:

- `os/build.py:79` — `urlopen` of a repo-pinned URL. `check()` requires https;
  the composer allows `file://` for fixtures. `expected is None` is only the
  InRelease trust root (`compose.py:865`), which `verify_signature` checks
  against the manifest-pinned fingerprint (`:870`). Every other fetch is
  digest-pinned (`:873`, `:885`). The size bound still applies (`build.py:86`).
- `os/pi/compose.py:607` and `:610` — `0o755` on directories. The execute bit
  is how a directory is traversed. The mode grants no write outside the owner.
- `scripts/build-packs.mjs:2433` — the tag is `cp` plus the pinned
  `uvPython` major.minor (`:2426`, `3.15.1` becomes `cp315`). Dots become
  `[.]`. The pattern is linear. It only chooses among sha256-verified files.
- `src/core/backends/modelapi/mcp/headers.ts:172` — the walk reads
  `node[key]` after `Object.hasOwn` and never assigns. The keys are tool-schema
  property names.

## 4. The fifteen bumps

`48ecd584a..46043f6b9` on `package.json`, lockfile regenerated. Zod stays
`4.6.7`. Production `src/` does not import `ink` or `useInput`. Ink 8 drops
unknown control sequences from `useInput`; the TUI decodes raw input itself
(`src/runtime/tui/controller.ts`) and renders through `InkBinding`. The only
`ink` import is the test harness `test/harness/tui/renderer.ts`. `@napi-rs/keyring`
2.1.1 to 2.1.2 is the packaging fix in `docs/certification/rlf-updeps.md` (no
API change). The image-packaging test writes a synthetic `package.json` that
still says `2.1.0` (`nodeImagePackaging.test.mjs:34`); that file is fixture
input, not the product pin (`package.json` `2.1.2`). No bumped default weakens
a guard. `qs` stayed inside its seven-day window, as that record says.

Pins: coverage-v8 5.0.5, eslint 10.13.0, jscpd 5.4.2, jsdom 30.1.3, knip
6.42.1, npm-run-all2 9.0.4, ovsx 1.3.0, playwright-core 1.64.1, react and
react-dom 19.3.1, typescript-eslint 8.72.0, vitest 5.0.5, serialize-javascript
7.1.3, `@codemirror/merge` 6.12.3, keyring 2.1.2, ink 8.0.0. typescript-eslint
8.72.0 is what flagged the old `verbatim` option.

## Stays open (already recorded, not a new defect)

**PLAN's browser sentence vs the exact-origin rule.** `PLAN.md:36611` still
says the check's proxy allows plain HTTP to loopback or a widened host.
`browserPolicy.ts:176` and README "Where a page may go" refuse loopback unless
the exact origin is in user-level `browserCheckExtraHosts`. CC-INT6 §8 item 4
already offers the lead two options: amend that sentence to the exact-origin
rule (this lane's recommendation; the rule is tested and stricter), or restore
loopback-by-default. This lane did not edit the threat-model sentence and did
not restore the old default.

CC-INT6 §8 items 1–3 and 5–10 stay as that record left them (team bundle
budgets, `machines panel`, unwired VS Code maker host, macOS-only maker
failures, Windows PowerShell, serial `python3`, `judgeP2Delivery` cost, RVNET's
remaining serve items, D230–D239 free). `npm run build` is red on this base for
`teamRunners.js`, `teamHost.js` and `teamScheduler.js`. No budget was raised.

## Proof

Targeted suites, repository timeout, `--maxWorkers=2`, two runs of at most
three files. No drill: no product line changed, so nothing was broken and
restored.

| Command                                                                                                               | Exit | Result                                                                |
| --------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| `npx vitest run test/unit/browserPolicy.test.ts test/unit/html.test.ts test/unit/nodeKeyStore.test.ts --maxWorkers=2` | 0    | 26 + 28 + 7 passed                                                    |
| `npx vitest run test/unit/nodeEgressPolicy.test.ts test/unit/nodeServeBinding.test.ts --maxWorkers=2`                 | 0    | 7 + 14 passed                                                         |
| `dns.lookup` `{all:true, verbatim:true}` vs `{all:true, order:'verbatim'}`                                            | 0    | `localhost`, `127.0.0.1` and `::1` each returned the same answer list |

Every exit below is the command's own, on this tree, after the record and the
PLAN status. No test timeout was raised. `npx vitest related` is skipped: no
source file changed, so there is no related set. The targeted suites above are
the suites this review ran. ESLint has no configuration for `PLAN.md` or this
record; `npx eslint --max-warnings 0` on those two paths exits 1 with two
ignore warnings and zero errors. No TypeScript file was touched, so there was
no lint target. `npm run build` exits 1 for the three team bundles already
over on this base (`teamRunners.js` 78.7/75, `teamHost.js` 140.2/130,
`teamScheduler.js` 76.5/75). No budget was raised.

| Command                                         | Exit | Result                                                                 |
| ----------------------------------------------- | ---- | ---------------------------------------------------------------------- |
| `prettier --check` on this record and `PLAN.md` | 0    |                                                                        |
| `eslint --max-warnings 0` on the touched files  | —    | skipped: both files are outside ESLint's configuration                 |
| `npm run typecheck`                             | 0    | host, webview, unit, e2e, integration, faults                          |
| `node scripts/check-l10n.mjs`                   | 0    | 14 UI tables, 14 usage tables, 285 manifest strings, 2660 source files |
| `npm run check:reference`                       | 0    | 93 features, 69 commands, 112 settings, 33 slash, 374 CLI              |
| `npm run check:host-api`                        | 0    | 404 VS Code APIs, 62 files importing vscode, 30 Node built-ins         |
| `npm run check:plan`                            | 0    | 244 milestones; 0 drift                                                |
| `npm run check:roadmap`                         | 0    | 244 entries; current                                                   |
| `npm run check:catches`                         | 0    | counts match the baseline                                              |
| `npm run duplication`                           | 0    | 0 clones                                                               |
| `npm run cycles`                                | 0    | no circular dependency                                                 |
| `npm run deadcode`                              | 0    | knip clean (configuration hints only)                                  |
| `npm run build`                                 | 1    | the base's three team bundles, over by the amounts above               |
| `npx vitest related` on changed sources         | —    | skipped: no source file changed                                        |
