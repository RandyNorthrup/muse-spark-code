# Certification — RLF-UPSDK (agent SDKs current, release wait removed)

Lane RLF-UPSDK, 2026-11-02, rig `macbook`, worktree
`/Users/user/lanes/RLF-UPSDK`, base `rv/int9` `72d8d5003`, branch
`rec/rlf-upsdk`. Currency table:
`docs/research/agents-sdks-2026-11-02.md`. Prior survey:
`docs/research/agents-sdks-2026-10-30.md` (§7 gap table; its briefs
B1/B2 are this lane's input).

The lane's first run could not execute any shell command (its
harness fence refused every `Bash` call), so it left file edits
only. This resumed run kept those edits, verified every one of
them against reality, corrected the parts reality disagreed with
(§3's unstable-methods list, the `sessionNotFound` placement), ran
every proof leg the first run had listed for the lead, and
committed with hooks on. Muse requests: the brief allowed up to
8 on the explicit `muse-spark-1.3-contributor` where a behaviour
needs a turn; **used: 0** — every behaviour below was proved over
the echo provider, raw ACP `initialize`, or the suites, none of
which spends a model turn. Rig fact for every git command below:
`git` itself fails on this rig until
`DEVELOPER_DIR=/Library/Developer/CommandLineTools` is set (the
default points at a missing Xcode); all git output here was taken
with that set.

## 1. The wait is gone (D260)

- `.npmrc`: `min-release-age=7` and its comment removed; the
  comment now states D260. Observed: `npm config get
min-release-age` prints `null` in this tree.
- PLAN.md §2 gains **D260** with the owner's words of 2026-11-02:
  no release wait while planned features are being built; a wait
  may return afterwards for non-agent dependencies only, by a new
  decision; it never applies to agent SDKs, adapters and CLIs.
- Current-rule sentences fixed: `.npmrc` (above); PLAN.md D3's
  `@muse-code/sdk` and `@agentclientprotocol/sdk` paragraphs and
  version rows; PLAN.md's M124-remote note ("wait for `.npmrc`'s
  seven-day release-age rule" → SDK 1.32.2 taken under D260);
  CHANGELOG's `qs` bullet ("waits for its fix to clear the
  seven-day window on 2026-11-03" → "is not yet in"; the `qs` bump
  itself stays RLF-UPDEPS2's). Dated records describing the old
  window (SDK142/SDK144/DEP138 entries, older certification
  records) are history and stand.
- No gate or test enforces the wait: searched `scripts/`,
  `.github/`, `test/`, `AGENTS.md`, `CONTRIBUTING.md`, `README.md`
  and `package.json` for `min-release-age` / `release-age` /
  `seven-day` on 2026-11-02 — no enforcing hit outside dated
  records (the judge config tests use synthetic `.npmrc` strings;
  README's seven-day hits are unrelated features). The wait lived
  only in `.npmrc`. The deleted workaround is the one-off
  `--min-release-age=0` install procedure itself: under D260 a
  plain pinned install is the procedure, and §2's install below
  used one.

## 2. Bumps (newest published 2026-11-02)

Verified twice: registry HTTPS JSON in the first run, then
`npm view <pkg> version` for all seven components in this run
(identical results). `npm install` (plain, no override) exit 0;
the lock diff touches exactly these three packages (plus ACP
2.4.0's new **optional** peer `@modelcontextprotocol/server
^2.4.0`, not installed — it serves the not-taken MCP-over-ACP
bridge, §3).

| Package                     | Was    | Now    | Installed, observed                                               |
| --------------------------- | ------ | ------ | ----------------------------------------------------------------- |
| `@muse-code/sdk`            | 1.4.12 | 1.4.14 | `node_modules` 1.4.14, peer `@types/node >=20`, zero runtime deps |
| `@agentclientprotocol/sdk`  | 2.0.1  | 2.4.0  | `node_modules` 2.4.0, integrity `sha512-7qJ8nnyj…`                |
| `@modelcontextprotocol/sdk` | 1.32.1 | 1.32.2 | `node_modules` 1.32.2 (test-only, M124 remote)                    |

PLAN.md D3's table and paragraphs carry the new pins and reasons.
External agents (full rows in the currency table): Claude adapter
`@agentclientprotocol/claude-agent-acp` 0.100.0, Codex adapter
`@agentclientprotocol/codex-acp` 2.5.0 and Gemini CLI 0.66.0 were
installed fresh into a scratch folder on 2026-11-02 and each
answered a raw ACP v1 `initialize` over stdio with its own
version in `agentInfo` (Claude `0.100.0`, Codex `2.5.0` with
`api-key`/`chat-gpt` auth methods, Gemini `0.66.0` with four auth
methods) — initialize only, no sign-in, no model turn. In
0.100.0's `dist/acp-agent.js`, `strictMcpConfig: true` still
stands in the session-rebuilding options table, so our
`session/new` `_meta.claudeCode.options.strictMcpConfig` is still
accepted; the comment in `src/core/team/workers/acpWorker.ts`
now records the 0.100.0 re-verification. Gemini 0.66.0's bundle
still carries `--allowed-mcp-server-names` (our
no-user-servers switch). The brief's `@zed-industries/codex-acp`
name is deprecated upstream in favour of the name we already
install. Copilot CLI newest is 1.0.105; we pin nothing (the
person's own CLI). Muse Code CLI rig pin 1.4.14-R7309.1
(`muse --version` observed; its `--help` for `muse`,
`muse serve`, `muse exec` and `muse usage` read the same day:
`usage` exists with `--json`, `serve --preset` names "an existing
preset for this host", `--disable-request-user-input` exists on
`serve`, `exec` and the TUI).

## 3. Took / named, per version

Package evidence is the tarball diffs of 2026-11-02
(old pins `npm pack`ed into the lane's `temp/`, diffed against
the installed new pins) plus the changelogs in the currency
table.

**Taken by pinning (behaviour rides the pin on entrypoints we
already use; no code of ours needed to change):**

- Muse SDK 1.4.12→1.4.14: only `facade/approval.js`,
  `facade/client.*`, `fingerprint.*`, `msp.d.ts` and
  `package.json` differ; the `connection/*` modules we import are
  byte-identical. `msp.d.ts` adds twelve types, removes none
  (listed in the research file). Our wire schemas keep unknown
  kinds and fields visible (D36), so nothing breaks on an older
  host. Muse 1.4.13's served fixes (fail-closed untrusted
  sessions, narrower resumed permissions) and 1.4.12's
  (`workspaceRoots` writes, `-c hooks.…`, `session/leave` races)
  apply to every served session. The snapshot `activeTurn`
  correction needs no code — we already consume it as
  `activeTurnId` (`LoadedSession.activeTurnId`,
  `sessionRecords.ts`).
- ACP SDK 2.0.1→2.4.0: the **stable v1 method table is
  byte-identical** (diffed) and `npm run typecheck` passes
  unchanged, so nothing we send or serve breaks. Taken: 2.0.2's
  CR line-ending fix in the stdio line buffer and per-request
  HTTP failure isolation; Rust-matching parsing (null lists,
  elicitation scope, 64-bit integers); refusal to print raw
  invalid messages; the pre-`initialize` request gate
  (`-32600`); schemas to v1.29.1; 2.4.0's
  stop-waiting-for-a-cancelled-request. Stream byte limits were
  already ours: we pass `ACP_MAX_MESSAGE_BYTES`
  (`src/shared/acpStream.ts`).
- MCP SDK 1.32.1→1.32.2: the diff is `server/mcp.js` plus
  explicit `| undefined` on `Transport`'s optional properties.
  Test-only for us; `connectorRemote.test.ts` and typecheck
  (including `test/unit/helpers/connectorSdkClient.ts`) pass.

**Taken in code:** the MSP schema fingerprint expectation and
its tests (§4, including the new served-capture fixture); the
`strictMcpConfig` version note in `acpWorker.ts`; and one
break found while proving the ACP pin, fixed at its cause:
`test/unit/acpServeHandshake.test.ts` scrubbed `PATH` by entry
_name_ (dropping entries containing "muse"), which cannot hide
a CLI living in `~/.local/bin` — on this rig the agent found the
CLI and answered "not signed in" where the test demanded "not
installed" (red before, §5 drill B). The test now drops every
entry that actually holds the CLI executable
(`MUSE_POSIX_EXECUTABLE` / `MUSE_CMD_FILE` from constants,
the same names `launch.ts` probes for), which is also what
Windows discovery keys on.

**Named, not taken — every new surface, with its reason:**

- ACP unstable methods new by 2.4.0 (method-table diff:
  `session/archive`, `session/unarchive`, `session/status`,
  `session/set_title`, `auth/status`, client notification
  `auth/status_update`). All are `@experimental` and
  capability-gated (`sessionCapabilities.archive` / `.status` /
  `.title`, `auth.status`); our agent advertises
  none of them, so a conforming client never calls them and a
  host without them sees no change. Per method: _archive /
  unarchive_ — neither backend has an archive state (MSP
  `msp.d.ts` has no archive concept at all; the Model API store
  has no archived flag or list filter), so honouring
  `archived` on `session/list` and `SessionInfo.archived` means
  inventing storage semantics: its own lane. _session/status_ —
  "open" vs "saved" without side effects needs a per-backend
  existence answer that does not load; the Muse side would
  answer from `session/list`, the Model API side from its store,
  each needing its own proof. _session/set_title_ — the spec
  demands any listed session be retitleable, stored before the
  response, never overwritten by an auto-title; Muse's
  `session/rename` is refused outright on some hosts (Windows,
  `MuseCodeHost.ts`) and its stored-before-response semantics
  are uncaptured. _auth/status + auth/status_update_ — our auth
  state is per backend and per account (Muse sign-in,
  stored Model API key, M108 accounts); one `state` plus a
  display accounts list needs an M108-aware design, and account
  labels are exactly what AGENTS.md rule 8 keeps out of view.
- `RequestError.sessionNotFound` / `treatSessionNotFoundAsSuccess`
  (`-32002`): available in 2.4.0, deliberately not adopted with
  the pin — it changes the wire shape of unknown-session errors
  the existing ACP suites pin, and its natural consumers are
  the not-taken methods above (their specs mandate `-32002`).
  It lands with whichever of them lands first.
- `PROXY_METHODS` (`proxy/initialize`, `proxy/successor`): the
  SDK's own doc says it "does not route them through the agent
  or client APIs" — conductor/proxy-chain plumbing; an agent
  has nothing to implement.
- MCP-over-ACP caller/provider + HTTP bridge (`dist/mcp/`,
  `v1/unstable/mcp`, optional peer `@modelcontextprotocol/server`):
  research brief B3, its own lane — proof needs a real editor
  handing us an ACP-transport MCP server.
- ACP experimental v2 entrypoints: unused, as before — no
  editor requires ACP v2.
- `muse usage` (1.4.13) for the subscription window before any
  turn. Confirmed present with `--json` on the pinned CLI.
  Today `MuseCodeHost.readUsage` uses MSP `usage/read`, which
  reports the last observed window ("absent until a turn has
  run"). Adopting the subcommand means a governed child process
  and a parser for its JSON — a wire shape to capture from a
  signed-in host first (this rig's scratch home is unsigned by
  design, and the owner's real home is not read for captures).
  B2's assessment item; named, not taken.
- `muse serve --preset` (1.4.12). On the pinned CLI it takes
  an _existing_ preset name for the host process (`--help`
  observed); the top-level CLI lists the built-ins
  (`native-basic`, `miniswe`, `empty`, `ac_orch`,
  `openai-apply-patch`). We pass no preset today; offering one
  is a product surface (who chooses, per host or per session)
  that needs its own design and a served capture of preset
  behaviour. B2; named, not taken.
- Async questions / `--disable-request-user-input` (1.4.13):
  confirmed on `serve`, `exec` and the TUI of the pinned CLI.
  Product-side deferral already exists (M112) and headless
  `exec` already declines questions; adding the flag to our
  `serve` spawn would withhold the tool from every main
  conversation, side chats aside — a behaviour decision for
  the M112 design, not a pin side effect. Named, not taken.
- Rendering the new MSP payloads (`cuaCardFacts`,
  `backgroundTerminalCompletion`, `blockedPrompt`,
  `checkpointBoundary`, `Task.executionMode`, `held`/`heldFor`,
  `earlierHistory`, `queuedInputs`, `reviewerReason`, session
  `worktree`/`spawnedBy`) — research brief B2. The kinds parse
  and show generically today (D36); proper rendering starts
  from echo-provider captures per field. The one capture this
  lane owed for its own claim — the served fingerprint — is
  filed (§4).
- Profile `network.local_ports` (1.4.12): nothing to take. We
  pass a profile name only and author no network targets; a
  person's saved local-port rules are the CLI's to accept or
  refuse in its own words.

## 4. The fingerprint

The pin moves
`sha256:cfdb6d2525601b9bac76584ccb0610ab3a5539b5e4f51141f079b99b39fcb4e0`
(SDK 1.4.12) →
`sha256:c94c3d1f2f51e6424074b9ec43eac3eedcf532d3dcd77351ec1383a87d3049c6`
(SDK 1.4.14). **What moved** is the stable MSP schema bundle:
the twelve additive types in §3. The value is corroborated
three ways, all observed 2026-11-02: (a) the installed SDK's
own `dist/src/fingerprint.js` carries it as
`EXPECTED_SCHEMA_FINGERPRINT`; (b) the first run had read the
same full value from the SDK repository's
`clients/sdk-ts/src/fingerprint.ts`, cross-checked against the
head/tail in the 2026-10-30 tarball diff; (c) **the pinned CLI
serves it**: `muse-bin-1.4.14-R7309.1 serve --provider echo
--no-session-log`, scratch `HOME`/`XDG_*` under the lane's
`temp/` (`museHome` in the result verified inside it), one
`initialize`, 0 model attempts — result filed verbatim as
`test/fixtures/m127/initialize-1.4.14.json` with provenance
`upsdk1414`, and a new test asserts the served fingerprint
equals the pin.

Effect: a 1.4.14 host — every rig's pinned 1.4.14-R7309.1, the
build whose starts logged the mismatch — now matches exactly
and logs nothing. `MSP_KNOWN_SCHEMA_FINGERPRINTS` is
unchanged: it names builds only from a served capture, no
capture exists for 1.4.12/1.4.13 builds, so those hosts keep
the visible mismatch warning until one is captured, and
1.4.11 hosts keep their named-build info line; the pin itself
needs no map entry (asserted). `test/unit/museCodeLatest.test.ts`
carries the 1.4.14 block (5 tests: pin silence, served-fixture
match, 1.4.12 now warns with no map entry, pin needs no own
entry, 1.4.11 still named).

## 5. Red / green drills (observed, logs in the lane's `temp/rlf-upsdk/`)

- **Drill A — fingerprint pin fires.** With the test's
  `SDK_1_4_14_FINGERPRINT` deliberately corrupted
  (`c94c…` → `0000…`), `npx vitest run
test/unit/museCodeLatest.test.ts --maxWorkers=3` exits **1**
  with exactly the 3 fingerprint assertions failing
  (`drill-red.log`). Restored byte for byte; the same command
  exits **0**, 60/60 (`drill-green.log`).
- **Drill B — handshake PATH scrub (a real red, then the fix).**
  Before the fix, `acpServeHandshake` in a 3-file run exits
  **1**: "expected 'Authentication required: Muse Code is not
  signed in…' to match /Muse Code is not installed/"
  (`run3.log`) — the name-based scrub left `~/.local/bin` on
  PATH, so the agent found the CLI. The inverse run with
  `~/.local/bin` removed from the outer PATH proves the other
  leg: the CLI-missing test passes and the signed-in test then
  fails on 'Invalid request: Muse Code is not installed…'
  (`run3b.log`) — both sentences are the live agent's at ACP
  2.4.0. After the executable-based scrub, the same file in
  `run4.log` exits **0**.
- **Drill C — the wait is really off.** `npm config get
min-release-age` in this tree prints `null` (was `7` under
  the old `.npmrc`), and the §2 install of all three pins —
  ACP 2.4.0 published the same day — completed with a plain
  `npm install`, no `--min-release-age=0` override.

## 6. Proof and gates actually run (this resumed run, 2026-11-02)

All test commands used the repository's own timeouts (never
`--testTimeout`), at most 3 files per run, `--maxWorkers=3`.

| Run                                                                          | Result                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `npm install` (plain)                                                        | exit 0; pins 1.4.14 / 2.4.0 / 1.32.2 in `node_modules`        |
| `museCodeLatest` (post-install, pre-fixture)                                 | 59 passed                                                     |
| `museCodeDecisions` + `mapNotification` + `acpSdkTransport`                  | 61 passed                                                     |
| `acpTeamContracts` + `acpServeHandshake` + `acpStableMethods`                | 61 passed, **1 failed** (drill B red)                         |
| `acpServeHandshake` with CLI truly off PATH                                  | 1 passed, 1 failed (drill B inverse)                          |
| `acpShutdown` + `connectorRemote` + `acpServeHandshake` (fixed)              | 19 passed, 12 skipped (acpShutdown platform skips)            |
| `museCodeLatest` + `sessionTitles` + `m106CaptureFixtures`                   | 71 passed                                                     |
| `acpTranslate` + `museCodeBundle`                                            | 51 passed                                                     |
| `museCodeLatest` drill red → green (§5A)                                     | exit 1 (3 failed) → exit 0 (60 passed)                        |
| `vitest related src/core/team/workers/acpWorker.ts --run` (12 files)         | 199 passed, 37 skipped, **12 failed — rig defect, see below** |
| Echo `initialize` capture (§4)                                               | served fingerprint = pin, exit 0                              |
| Adapter `initialize` probes (§2): Claude 0.100.0, Codex 2.5.0, Gemini 0.66.0 | all answered ACP v1, exit 0                                   |

The 12 related-run failures are all in
`teamProcessWorkers.test.ts` and every one carries the same
cause in its message: the suite's real `git` child exits 71,
"couldn't spawn '/Applications/Xcode.app/…/xcodebuild'" — this
rig's `xcode-select` points at a missing Xcode, and the
product's guarded child environment does not (and should not)
pass my shell's `DEVELOPER_DIR` workaround through. The only
change of mine in that file's dependency cone is a comment in
`acpWorker.ts`; the failure precedes any ACP traffic (it fires
while listing the worker tree's git config). Named for the
lead as a rig defect, not fixed here and not papered over in
the test: on a healthy rig (and in hosted CI) `git` needs no
such variable.

OS credential-store suites and vault suites: not touched, not
run on this MacBook, per the lane rules.

Gates (every exit code observed):

| Gate                                                         | Exit                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `npx prettier --check` (touched files)                       | 0                                                                                                 |
| `npx eslint --max-warnings 0` (touched sources/tests)        | 0                                                                                                 |
| `npm run typecheck`                                          | 0                                                                                                 |
| `node scripts/check-l10n.mjs` (no string changed)            | 0 (0 problems)                                                                                    |
| `npm run check:plan`                                         | 0 (250 milestones, 0 drift)                                                                       |
| `npm run check:reference`                                    | 0                                                                                                 |
| `npm run check:host-api`                                     | 0                                                                                                 |
| `npm run check:roadmap` (after `roadmap:generate`)           | 0                                                                                                 |
| `npm run check:catches`                                      | 0 (no count moved)                                                                                |
| `npm run duplication`                                        | 0                                                                                                 |
| `npm run cycles`                                             | 0                                                                                                 |
| `npm run deadcode`                                           | 0                                                                                                 |
| `npm run build` (sizes, split, host-globals, notices, legal) | 0 — every budget holds, none raised; `THIRD_PARTY_NOTICES.txt` unchanged (same packages/licences) |
| `npm run security:audit`                                     | 0 (2 moderate notes: `glob`, `minimatch` — neither is one of the three moved packages)            |

## 7. What a person notices, and what remains

CHANGELOG `[Unreleased]` gains one bullet (rides 1.4.14 +
newest protocol libraries; the warning is gone; agent releases
taken at publish). README and the feature catalog name no SDK
version, command, setting or flag that changed here, so neither
moves (`check:reference` 0 confirms coverage).

Remains, each already owned elsewhere: B2 rendering of the new
MSP payloads and the `muse usage` / `serve --preset`
assessments (named in §3 with what blocks each); B3
MCP-over-ACP serving; the experimental ACP methods when a real
client first needs one; a served 1.4.12/1.4.13 fingerprint
capture for the known-build map (needs a rig still on those
builds). D260's design record moves to
`docs/plan-archive/decisions.md` with `npm run plan:archive`
in this lane's second commit (the move names the commit its
lines refer to, so it follows the commit that adds D260).
