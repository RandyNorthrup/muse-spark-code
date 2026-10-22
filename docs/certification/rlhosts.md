# RLHOSTS certification — M62b, M63c, M65, M66, M94b (PLAN.md D60, D62, D73)

Recorded 2026-10-22, lane `rec/rlhosts` on the linuxlt rig, base main at
0.19.0 (`f3941b8548`). No model was called and no backend credentials were
used anywhere on this lane: every run below is install, activation and UI,
never a conversation.

## M94b — next edit suggestions, built ready and switched off

Stable `vscode.d.ts` through `@types/vscode` 1.140.0 (checked 2026-10-22
from the published tarball) carries no `isInlineEdit`/`showRange`, and the
`inlineCompletionsAdditions` proposal is still a proposal on vscode main,
so no stable release carries next edit suggestions. `src/host/tab/nextEdit.ts`
builds the proposal-shaped items (`isInlineEdit: true` plus `showRange`)
and switches them on only at or past `TAB_NEXT_EDIT_STABLE_SINCE`, which
names no release. `test/unit/tabNextEdit.test.ts` proves the shipped
switch stays off on the engine floor (1.99.0), this stable (1.139.0) and
the latest verified stable (1.140.0), proves the comparison (including a
pre-release of the stable release itself, which does not count), and
proves the emitted shape once the API is stable.

Red/green drill: with the constant temporarily set to `'1.99.0'`, the
stays-off case fails (`1 failed | 3 passed`, exit non-zero); with it
restored to `undefined`, all 4 pass. When a stable release carries the
API, it names itself in the constant and the provider branch lands with
it; nothing proposal-shaped leaves the provider until then.

## M63c — the ACP Registry entry, refreshed to 0.19.0 for PR #661

The owner's submission (agentclientprotocol/registry PR #661, open, at
0.17.1) defines the entry. `registry/muse-spark-code/` refreshes it to
0.19.0 byte for byte except the version and the npm pin; the name,
description, website and icon stay the pull request's own. The agent is
distributed through npm (`muse-spark-code-acp@0.19.0`, no arguments: the
command serves ACP on stdio by default).

Proof, all against the published package with the registry's own tooling
(registry cloned 2026-10-22):

- `build_registry.py` with the entry staged: `Added agent:
muse-spark-code v0.19.0` (schema, npm existence, icon). Its first run
  refused an XML comment in the icon ("break MDX embedding"); the comment
  was removed and the re-run adds the agent.
- `verify_agents.py --auth-check --agent muse-spark-code`: `Passed: 1,
Failed: 0. All tests passed!` The published agent answers the
  checker's terminal-auth announcement with `type: "terminal"` methods.
- An independent probe sending the checker's exact `initialize` shows the
  same terminal methods, plus `agentInfo.name muse-spark-code-acp`.

Still to come: pushing the refresh to PR #661's branch, and the merge
itself (theirs to do).

## M62b — tried for real

All three runs below install the lane's own `linux-x64` 0.19.0 VSIX. No
run held a conversation: the rig carries no backend credentials.

**Devin Desktop 3.10.67 (VS Code 1.126.0).** `test/hosts/run-fork.sh
devin-desktop` under xvfb: the VSIX installs with its CLI and lists
(`randynorthrup.muse-spark-code@0.19.0`), and the integration suite
passes 48 with 3 failing. The same suite in stock VS Code 1.139.0 on this
rig passes the same 48 and fails the same 3 (`scheduleBackground`,
"Schedules are unavailable in this host. The runtime scheduler binding is
required"): the sandbox has no user systemd bus (`systemctl --user`
cannot connect), so the failure is environmental, not a Devin gap.

**code-server 4.141.0 (Code 1.141.0).** The VSIX installs with its CLI
and lists. With the workbench booted in Playwright's Chromium, the
extension host logs `ExtensionService#_doActivateExtension
RandyNorthrup.muse-spark-code ... activationEvent: 'onStartupFinished'`,
our channel logs `Activating Muse Spark 0.19.0 (VS Code 1.141.0, Node
24.21.0, linux)` and `Activated in 674 ms` with no errors, and the
activity bar carries the Muse Spark container. (The workspace is
untrusted, so the extension runs in limited mode; voice honestly reports
itself unavailable in a remote window.)

**Eclipse Theia 1.76.0.** The browser example built from npm (`@theia/cli`
1.76.0; the two unpublished sample packages dropped, the puppeteer
browser download skipped: both build-only, neither ships). The unpacked
VSIX deploys as its plugin (`Deploy batch of 1 accepted plugins`;
Theia does not unpack a `.vsix` itself here). From the palette, "Muse
Spark: Open in Sidebar" is offered and runs, the side panel shows "Muse
Spark: Chat", and one webview iframe renders with no page errors.

Waiting: Firebase Studio (Google account), Eclipse Che (a cluster) and
GitHub Codespaces (a GitHub account).

## M65 and M66 — blocked and waiting

- M65 (NetBeans, native JupyterLab 4 / Notebook 7, Spyder, RStudio) waits
  on RLM104's MHP: `rec/rlm104` is still at the base commit, so there is
  no contract to build the natives on. Nothing was built on a guessed
  protocol.
- Kate 25.08.1 (on the rig, runs under xvfb): its ACP client merge
  request is still open (kate!2155, "Add an ACP client"), so no Kate
  release has an ACP client.
- Classic Vim is not on the rig (`vim` runs Neovim 0.10.4); its route
  stays the terminal beside it, with no Vim-side piece built. The agent
  itself runs (see M63c's stdio proof).
- Xcode 26.3's external route needs macOS; MATLAB needs a licence;
  Replit, StackBlitz, CodeSandbox and Ona need accounts; vscode.dev and
  github.dev need the browser entry and remote runtime M104 designs.

## Gates (final tree, exit codes)

- prettier --check on touched files: 0
- eslint --max-warnings 0 on touched files: 0
- `npm run typecheck`: 0
- `node scripts/check-l10n.mjs`: 0
- `npm run check:reference`: 0
- `npm run check:host-api`: 0
- `npm run check:plan`: 0 (222 milestones, 0 drift)
- `npm run check:roadmap`: 0 (ROADMAP.md current)
- `npm run check:catches`: 0
- `npm run duplication`: 0
- `npm run cycles`: 0
- `npm run deadcode`: 0
- `npm run build`: 0 (every budget holds)
- `npx vitest related src/host/tab/nextEdit.ts --run`: 0 (1 file, 4 passed)
- tab suites (`tabConstants`, `tabReply`): 0 (2 files, 36 passed)
- SAST (`SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`): 0 (533 rules, 3998 files, 0 findings)
- `npm run security:audit`: 0 (4 advisories, 2 exceptions)

`npm run build` failed once on this lane for a lane-made reason: the
legal scan refuses incomplete checks (exit 2), and three IPC socket files
the code-server/Theia probes left under worktree `temp/` could not be
scanned. The sockets were removed and the rebuild is green. `npm run
package` (untargeted) also fails here for a pre-existing reason: the
universal stage requires the arm64 Linux helpers, which this x64 rig does
not build; the `linux-x64` targeted package used for every install above
packs (its zopfli recompress step wants the pinned pip package, so the
VSIX in these runs is vsce-packed but not recompressed: identical
content, slightly larger file).
