# Agent instructions — Muse Spark Code (Unofficial)

These rules apply to every AI coding agent and every human working in this
repository. They are project-local; do not copy them into global settings.

## What this project is

A VS Code extension giving a Claude-Code-style chat panel for Meta's Muse Spark
model. Two backends sit behind the `AgentHost` and `AgentSession` interfaces
(`src/core/agent/agentBackend.ts`): the Muse Code CLI over the Muse Session
Protocol (`@muse-code/sdk`, primary) and the Meta Model API over HTTPS
(bring-your-own key, secondary). Read `PLAN.md`
before changing anything: it holds the decisions, the research that justifies
them, the milestone plan, and the certification checklist.

## Working rules

1. **Plan first.** Work milestone by milestone as laid out in `PLAN.md` §6.
   New scope goes into `PLAN.md` before code. Open questions go in §3, not in
   code comments.
2. **Gates are not optional.** `npm run quality` must exit 0 before a commit is
   proposed. Never weaken a gate (thresholds, rule levels, ignores) to get
   green; fix the code or record a justified deferral in `PLAN.md` §7.
3. **Prove new gates and tests fire.** A test or lint rule that has never been
   seen to fail is a decoration. Break the thing on purpose, watch it fail,
   revert, and note it in the milestone's certification record under
   `docs/certification/`.
4. **Escape hatches are logged.** Any `eslint-disable`, `@ts-expect-error`,
   `as` cast that is not a narrowing the compiler can verify, or `any` needs an
   inline reason **and** a row in `PLAN.md` §8.
5. **Constants, not literals.** Tunables and user-visible strings live in
   `src/shared/constants.ts`. `0`, `1`, `-1`, `2`, `100`, empty collections
   and array index 0 are fine inline.
6. **No dead code, no placeholders.** No commented-out code, unused exports,
   unused dependencies, TODO stubs, fake implementations, or mock data outside
   `test/**`. A function that cannot do its job throws or returns an explicit
   error; it never returns an empty success.
7. **Boundaries are validated.** Every message across postMessage, every MSP
   frame, every HTTP response is parsed with a zod schema before use.
8. **Secrets never leave SecretStorage.** No API keys in settings, logs,
   telemetry, tests, or fixtures. The pasted Model API key is never passed to
   any child process: the Muse Code CLI signs in on its own, and the
   extension only checks that its credential file exists. Log through the
   `LogOutputChannel`; never `console.log` in the host.
9. **Dependencies are deliberate.** Before adding one: check peer ranges
   against the pins in `PLAN.md` §2 D3 (`npm info <pkg> peerDependencies`),
   check `npm audit`, pin the exact version (`.npmrc` enforces `save-exact`),
   and record the reason in `PLAN.md`. No global installs.
10. **Docs move with code.** New command, setting, or script → `README.md`.
    Every meaningful change → `CHANGELOG.md` under `[Unreleased]`. Every
    command documented in the README must have been run successfully.
11. **Do not imply Meta endorsement.** The product is unofficial; keep the
    "(Unofficial)" suffix and never embed or ship a Meta API key.

## Layout

```
src/extension.ts      activation: the view, the panel, the commands, the openers
src/host/**           VS Code adapters (views, conversation, backend managers and
                      the search worker, commands, auth, settings, mentions,
                      editor tracking, usage trace logs, voice, the diagnostics
                      MCP server)
src/core/**           backend-agnostic logic; must not import `vscode`
                      (MSP host, Model API client, tools, context, export,
                      worktrees, usage, dictation)
src/shared/**         constants + zod protocol shared by host and webview
src/webview/**        React 19 app (browser project, own tsconfig)
native/windows/**     dictate.ps1, the Windows dictation helper
native/darwin/**      Dictation.swift, Info.plist, build.sh, check-disclaim.sh:
                      the macOS helper (built and checked in CI)
resources/            the walkthrough
test/unit/**          vitest (node + jsdom via docblock); `vscode` is mocked
test/e2e/**           the fake Muse Code CLI driven through the real backend;
                      the opt-in live drill
test/integration/**   @vscode/test-cli, runs inside VS Code
test/harness/         the webview behind a fake host, for screenshots and the
                      accessibility gate; themes/ holds VS Code's four themes
scripts/**            esbuild build; bundle-size, host-globals, notices, audit,
                      PSScriptAnalyzer and accessibility gates; theme capture,
                      harness screenshots, image rendering, changelog notes
docs/certification/   per-milestone gate-fire records and screenshots
media/                icons, banner, social preview, README screenshots
```

## Commands

| Task                           | Command                               |
| ------------------------------ | ------------------------------------- |
| All gates (local)              | `npm run quality`                     |
| The gates CI runs everywhere   | `npm run quality:gates`               |
| Accessibility gate             | `npm run test:a11y`                   |
| Unit tests with coverage       | `npm run test:unit`                   |
| Integration tests              | `npm run test:integration`            |
| Dev build / watch              | `npm run build:dev` / `npm run watch` |
| Production build + size budget | `npm run build`                       |
| Package `.vsix`                | `npm run package`                     |

## Toolchain pins that matter

- `typescript` stays on **6.0.x** until `typescript-eslint` declares support
  for 7 (`npm info typescript-eslint peerDependencies`). Upgrading early
  silently disables every type-aware lint rule.
- `knip.jsonc` must stay `.jsonc`; knip 6 rejects pseudo-comment keys.
- Cycle detection is `dpdm`, not an ESLint rule; `import-x/no-cycle` and knip's
  `cycles` are known to report nothing.
- Run knip as plain `knip`; `--strict` implies production mode and, without
  `!`-suffixed entries, analyses nothing while exiting 0 (verified M0).
