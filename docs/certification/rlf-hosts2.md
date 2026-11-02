# RLF-HOSTS2 — real agents in every host suite, and the dropped A/B/C work

Lane `RLF-HOSTS2`, rig `linuxlt`, branch `rec/rlf-hosts2`. Base:
`rv/hostsland` `566143f3a` (RLF-HOSTSLAND plus RVHOSTS' peer-HTML seal).
Model attempts: **0**. Provider calls: **0**. Nothing pushed, rebased,
stashed or tagged. Production `node scripts/build.mjs --production`
exit 0; every suite below starts this tree's `dist/acp.js`.

## Inventory (2026-11-01, before any edit)

- The four shim suites (Emacs, Neovim, Zed, Qt Creator) still pass
  without the real agent, as RVHOSTS found: Emacs' child is `/bin/cat`,
  Neovim replaces `vim.system` and CodeCompanion, Zed and Qt Creator
  drive hand-written agent scripts, and Qt Creator's Lua suite doubles
  the Qt Lua API. Sublime has no suite at all.
- The real agent, probed with a scratch home and no credentials
  (`temp/probe-lsp.py`, `temp/probe-acp.py`, since removed): ACP
  `initialize` answers protocol 1 with `muse-spark-code-acp` 0.19.0;
  `session/new` refuses `-32000 authRequired` (no model call); LSP
  `initialize` answers its capabilities and `shutdown`/`exit` end 0.
- `supervise panel --companion`, which every shim's Panel command
  launches, is refused by this tree's CLI: `panel` accepts only
  `--stdio` (`src/runtime/cliOptions.ts` `PANEL_OPTIONS`). The loopback
  companion panel transport (M104 lane C) is not on int's contracts, so
  a shim's Panel command cannot succeed yet; the suites now prove the
  honest refusal and cleanup, and the transport itself is recorded in
  `docs/real-life/unproven.md`.
- `supervise` and `stop` refuse in this agent sandbox with
  `PrivateRootRefused`: `/` is uid 65534 here, and
  `verifyPosixAncestors` (`src/runtime/privateDirectory.ts`) admits
  only root or the caller. Proved by a diagnostic driver over
  `dist/supervise.js` (thrown stack, temp only). No workaround was
  built; supervised legs are written for a normal machine and named
  blocked here for the lead to run outside the sandbox.
- Dropped pieces, measured against this branch: lane A's
  `assemblePanelGit`/`gitEntry.ts` (this branch has lane B's
  `openPanelGit` wired in `panelSession`); lane B's
  `window/didChangeTheme` (initialize already carries `theme`; no
  notification, no relay); lane C's `attachments/*` (the companion
  adapter `src/runtime/companion/nativeAttachments.ts` exists but has
  no caller, and `MHP_METHODS` has no `attachments/` or `questions/`
  entry). MHP here is `mhp/1.5.0`; C moved it to 1.5.1, B to 1.6.
- WebKitGTK 4.1 is installed on this rig (`libwebkit2gtk-4.1.so.0`),
  so Eclipse's browser tests are runnable here after all.

## Done

Per host, each suite now starts this tree's real `dist/acp.js` through
the host's real launch path, with a scratch home, scrubbed credential
environment and no model call. Process-tree evidence: every suite
proves a live child whose `/proc`/`ps` identity is the node process
running `dist/acp.js` (and that no credential variable reached it),
speaks the real protocol (ACP `initialize` audit, `-32000`
`authRequired` refusal on `session/new`, LSP `initialize`/`shutdown`/
`exit` 0), and leaves no child behind.

- **Emacs** (`8b45db532`): the `/bin/cat` child and the fake transcript
  are gone. ERT 4 passed + 1 skipped (the supervised ACP leg; sandbox
  private-root refusal above). The Panel command proves the refused
  companion launch and `EPANEL_EXIT` cleanup.
- **Neovim** (`2fbee6654`): `vim.system`/CodeCompanion doubles deleted.
  `check.lua` 9 PASS + `lsp.lua` 1 PASS against the pinned Neovim
  0.12.6 with this tree's agent as both ACP and LSP child.
- **Zed** (`51e2f86b5`): 8 tests OK + 1 skipped (supervised). The Rust
  extension builds with the rig-installed Rust 1.99.1:
  `cargo build --release --target wasm32-wasip1` produces a 280,954
  byte wasm; `Cargo.lock` committed; `target/` ignored.
- **Qt Creator** (`7e7af725d`): 6 tests OK + 1 skipped (supervised).
  The Qt-Lua API-double suite (`check.lua`) is deleted; the bootstrap
  launches the real agent. The editor (18.0.2, offscreen) runs on this
  rig but has no headless Lua-action driver, so the in-editor Lua half
  stays in `docs/real-life/unproven.md`.
- **Sublime Text** (`2a64871de`): new in-editor harness. The shipped
  package is installed into a scratch home, the real Build 4200 runs
  under Xvfb, and a harness package drives the plugin's own commands:
  the bare Panel command spawns the real agent (refusal + cleanup) and
  the LSP launcher starts and stops the real child. 1 test OK.
- **MHP 1.6** (`a297f6dcd`): lane B's `window/didChangeTheme` and lane
  C's `attachments/*` entered in one wire revision 1.5.0 → 1.6.0 per
  D226 (C's intermediate 1.5.1 skipped deliberately; PLAN D226
  updated). The runtime holds the latest theme and replays it to each
  surface on `ready` and on change; the JetBrains and Eclipse hosts
  send their existing theme reads (their checks run here), and the
  Visual Studio and Xcode hosts send theirs (waiting machines).
  Every pin, schema, lock and vector moved together; `check:mhp`
  green.
- **Native attachments** (`934997674`): `attachments/*` is bound on
  the native panel runtime through a new lazy bundle
  `dist/runtimePanelMedia.js` (38,929 bytes; new budget 44 KiB). The
  committed suite proves the real port, validation, per-window
  registry isolation and every said refusal (29 tests), and a second
  suite proves routing over the panel's stdio both ways. A live
  screenshot attach is unproven (the native recorder needs XDG
  Desktop Portal and a DBus session this rig lacks — the refusal is
  said and asserted).
- **Questions count** (`4b763aa42`): the panel status item publishes
  the open-questions count exactly when it changes; 6 tests.
- **Scheduled prompts** (`a8997f370`): a native window's schedule hold
  resolves through the person's command in its own workspace. Live
  delivery certification (`SCHEDULE_EDITOR_DELIVERY_CERTIFICATION`)
  still reads not-ready on this tree, so holds degrade to a warning
  and a notice, as the VS Code bridge does today; the suite proves
  that path with the real loader. C-M115-9's native row therefore
  lands as the hold; the delivery flip stays with the M115 surface.
- **GitHub lease** (`4f2d2c2e3`): the editor's `auth/githubLease`
  credential signs the panel in ahead of device flow and `gh`, with
  the response `github/request` proxy; the token never reaches this
  process. Lane A's held pull request checkout is NOT ported: this
  branch's runtime pull-request adapter has no checkout action
  (nothing consumes `RuntimePullRequestCheckout` here). The checkout
  engine would be dead code until a checkout action lands; see Open
  questions.
- **Matrix** (`a56348b91`): every receipt regenerated from runs on
  this rig; Eclipse and JetBrains re-conform at `mhp/1.6.0`; Sublime
  Text stops being pending. Eclipse's full build ran with WebKitGTK
  present: 62 tests including the browser suite. JetBrains: 53 tests.
  Toolchains (Maven 3.9.11, Temurin 21) were installed under `temp/`,
  never system-wide.
- **Extra editors** (lane B's `hosts/mhp-python`, Jupyter, NetBeans/
  `mhp-java`, Spyder, RStudio): NOT ported. They target the
  `supervise --companion` loopback transport, which this tree's CLI
  refuses (see Inventory); their suites carry session/peer doubles
  that need the same real-agent rebuild this lane did for the five
  shims, against a transport that first has to land on int's current
  contracts. See Open questions.

## Waiting

- **Visual Studio**: the lead's Windows PC. **Xcode**: the Mac mini.
- **Supervised legs on this rig**: the sandbox private-root refusal
  above; the lead runs them outside the sandbox.

## Open questions (for the lead)

1. **Held pull request checkout** (lane A): port A's
   `createRuntimeCheckout` (records, holds, trust card) when a
   checkout action lands on the runtime pull-request adapter, or
   design the action first. Recommendation: action design + engine
   in one lane, so no core is unwired.
2. **Companion transport**: every shim's Panel command launches
   `supervise panel --companion`, which this tree's CLI refuses
   (`panel` accepts only `--stdio`). Lane A's loopback companion
   server never reached int. Recommendation: land the transport on
   int's contracts as its own lane; the suites already pin the
   refusal and cleanup and will flip to the live page.
3. **Extra editors** (B): port `mhp-python` plus Jupyter, NetBeans,
   Spyder and RStudio against the companion transport once (2) lands,
   rebuilding their suites on the real agent in the same pass.
   Recommendation: one follow-up lane after (2), not before.

## Red/green drills

Each new guard was broken on purpose, watched red, restored green.

- **Emacs credential scrub**: reverting the env bind failed ERT with
  the credential present in the child; restored, green.
- **Qt Creator refusal masking**: the first drill was inert because a
  missing opener masked the refusal; the suite now installs a
  succeeding opener, and breaking the refusal path goes red.
- **Zed LSP exec race**: reading the child's environment before the
  Python launcher execs node failed; the suite now waits until argv0
  is node.
- **MHP version pins**: a deliberately stale pin fails `check:mhp`
  (observed during the 1.6.0 adoption; restored by re-adopting).
- **Attachments routing**: sending `attachments/record` with `{}`
  failed schema validation red; the suite now sends the real payload.
  A museCode-gated session refuses said ("needs Model API"), proving
  the gate words reach the host.
- **Schedule hold degrade**: with delivery certification not-ready,
  the hold warns and notices; breaking the degrade to a silent no-op
  fails the suite.
- **Lease order**: removing the lease from the source order makes the
  lease test fall through to device flow and time out red; restored.
- **Catches inventory**: the attachments fallthrough initially raised
  GENERIC; `check:catches` went red, the catches became reported,
  baseline regenerated, green.
- **Duplication**: the three new suites' shared log helper tripped
  jscpd (3 clones); shared helper → 0 clones.

## Gates

| Gate                                                                                      | Exit                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node scripts/build.mjs --production`                                                     | 0                                                                                                                                                                                                                                                                                                            |
| `npm run typecheck`                                                                       | 0                                                                                                                                                                                                                                                                                                            |
| prettier `--check` (touched src/scripts/tests/md)                                         | 0                                                                                                                                                                                                                                                                                                            |
| eslint `--max-warnings 0` (touched)                                                       | 0                                                                                                                                                                                                                                                                                                            |
| `node scripts/check-l10n.mjs`                                                             | 0                                                                                                                                                                                                                                                                                                            |
| `npm run check:reference`                                                                 | 0                                                                                                                                                                                                                                                                                                            |
| `npm run check:host-api` (after `--write`)                                                | 0                                                                                                                                                                                                                                                                                                            |
| `npm run check:plan`                                                                      | 0                                                                                                                                                                                                                                                                                                            |
| `npm run check:roadmap`                                                                   | 0                                                                                                                                                                                                                                                                                                            |
| `npm run check:catches` (baseline regenerated)                                            | 0                                                                                                                                                                                                                                                                                                            |
| `npm run check:mhp`                                                                       | 0                                                                                                                                                                                                                                                                                                            |
| `npm run check:editor-matrix`                                                             | 0                                                                                                                                                                                                                                                                                                            |
| `npm run duplication`                                                                     | 0                                                                                                                                                                                                                                                                                                            |
| `npm run cycles`                                                                          | 0                                                                                                                                                                                                                                                                                                            |
| `npm run deadcode`                                                                        | 1 — pre-existing findings only (unused files/exports/tags present on the base `566143f3a`); every lane-introduced finding removed                                                                                                                                                                            |
| `npm run build` budgets                                                                   | new bundles fit new budgets; pre-existing team bundle overage unchanged (`teamRunners.js` 78.4/75 KiB, `teamHost.js` 140.2/130 KiB, `teamScheduler.js` 76.5/75 KiB), reported, never raised                                                                                                                  |
| Emacs ERT                                                                                 | 0 (4 passed, 1 skipped)                                                                                                                                                                                                                                                                                      |
| Neovim headless (check + lsp)                                                             | 0                                                                                                                                                                                                                                                                                                            |
| Zed unittest + cargo wasm build                                                           | 0 (8 OK, 1 skipped)                                                                                                                                                                                                                                                                                          |
| Qt Creator unittest                                                                       | 0 (6 OK, 1 skipped)                                                                                                                                                                                                                                                                                          |
| Sublime in-editor unittest                                                                | 0 (1 OK)                                                                                                                                                                                                                                                                                                     |
| JetBrains `./gradlew test`                                                                | 0 (53 tests)                                                                                                                                                                                                                                                                                                 |
| Eclipse `mvn -B verify`                                                                   | 0 (62 tests, browser included)                                                                                                                                                                                                                                                                               |
| unit suites (media 29, conversation 4, questions 6, schedules 2, git 7, MHP contracts 61) | 0                                                                                                                                                                                                                                                                                                            |
| `npx vitest related` over changed sources                                                 | 1 — 27,567 passed; the 71 failures are sandbox-bound suites (M100 device journal, M124 connector, verified-runner, supervised LSP) and were reproduced identically on the untouched base `566143f3a` in a temp worktree (same 8 failures in `deviceJournal` + `connectorStorageGuard`, names compared equal) |

Model requests used: **0** of the allowed 4.
