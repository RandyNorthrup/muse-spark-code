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
5. **Constants, not literals.** Tunables live in `src/shared/constants.ts`.
   `0`, `1`, `-1`, `2`, `100`, empty collections and array index 0 are fine
   inline.
   - **Text the user reads** lives in the English table
     `src/shared/l10n/en.ts` and is read as `UI_TEXT.key` when the code runs,
     never at module load (the gate fails it), so the installed language is
     the one shown (PLAN.md D33).
   - **A sentence around a value** is one template, `{duration}` in `Thought for {duration}`, filled with `fill`. **A count** is `forms({ one, other })`
     read with `plural`. Numbers, percentages, units and dates go through the
     `Intl` helpers in `src/shared/l10n/text.ts`.
   - **"Label: detail" and "Label (id)"** may stay spliced when the detail is
     technical.
   - **Text the model or Meta reads** is `MODEL_TEXT` in constants.ts and
     stays English.
   - **Adding or changing a key** means every table in `l10n/` gets it too,
     or `npm run check:l10n` fails.
6. **No dead code, no placeholders.** No commented-out code, unused exports,
   unused dependencies, TODO stubs, fake implementations, or mock data outside
   `test/**`. A function that cannot do its job throws or returns an explicit
   error; it never returns an empty success.
7. **Boundaries are validated.** Every message across postMessage, every MSP
   frame, every HTTP response is parsed with a zod schema before use.
8. **Secrets never leave SecretStorage.** No API keys in settings, logs,
   telemetry, tests, or fixtures. The pasted Model API key is never passed to
   any child process: the Muse Code CLI signs in on its own.
   - **Outside VS Code (the ACP agent, PLAN.md D61).** The operating
     system's credential store stands in for SecretStorage: it is the store
     VS Code's SecretStorage itself rests on. The key goes in only through
     `muse-spark-code-acp auth set`, from its standard input (the user's
     terminal, or a pipe into it); never from an environment variable, an
     argument or a file; and it is never passed to a child process
     (`muse serve`, a tool, a check). A `META_API_KEY` the user sets in the
     agent's own environment is theirs for Muse Code, not the stored key:
     as the extension's `muse serve` inherits it (PLAN.md D1), it reaches
     Muse Code's processes only, where it counts as Muse Code's credential.
     The agent takes every credential variable (`*_API_KEY` and the named
     ones hooks never get) out of its own environment at start, so no
     shell command, hook, git or helper it starts sees one.
   - **The one exception: M80's CI bootstrap** (PLAN.md M80, planned).
     GitHub hands a secret to a step only through its environment or its
     script, so the Action's own step shell is the one environment the key
     is ever in: that shell pipes it to `auth set`'s standard input and
     unsets it before `exec` starts. Nothing else is excepted.
   - **The CLI's credential file.** The extension reads only its structure
     (`src/core/backends/musecode/credentialFile.ts`): the schema version,
     which providers are named (only `meta` speaks for the sign-in), each
     one's `storage` lane, and whether `meta` has an `api_key` or
     `access_token` entry (the parse replaces the value with `true`). It
     also reads the file's size and modification time. Never a token
     value.
   - **When the structure cannot say**, the CLI answers `account/read`
     (PLAN.md D26). Its `label` (an e-mail address) and `avatarUrl` are
     never kept, logged or shown.
   - **Text the CLI chose.** A `loginCompleted` message, `muse serve` or
     `muse skills` stderr and an MSP error message never reach the log as
     sent: they can name a path under the user's profile or an account,
     and the redactor catches only keys. Log a protocol word through
     `wireWordForLog`, an MSP failure through `failureForLog`, stderr
     through `stderrForLog`, or fixed words.
   - **Logging.** Log through the `LogOutputChannel`; never `console.log`
     in the host.
9. **Dependencies are deliberate.** Before adding one: check peer ranges
   against the pins in `PLAN.md` §2 D3 (`npm info <pkg> peerDependencies`),
   check `npm audit`, pin the exact version (`.npmrc` enforces `save-exact`),
   and record the reason in `PLAN.md`. No global installs.
10. **Docs move with code.** New command, setting, or script → `README.md`.
    Every meaningful change → `CHANGELOG.md` under `[Unreleased]`. Every
    command documented in the README must have been run successfully.
11. **Do not imply Meta endorsement.** The product is unofficial; keep the
    "(Unofficial)" suffix and never embed or ship a Meta API key.
12. **Anything that costs money is opt in and loud** (the owner's rule,
    PLAN.md D30, D34). A paid call runs only while `PaidFeatureGate.isOn`
    (`src/core/paid/paidFeatures.ts`) says so: its setting on, machine-scoped
    and off by default, and its price accepted in the confirmation. It is
    named in the composer's badge, shown as its own row marked paid
    (`paid` on the item), counted in `PaidUsage` for Account & usage, and
    billed to the Model API key: offered on the Model API backend, and on
    the Muse Code backend only while a key is stored and only through the
    extension itself (the `ide` server, M44; the key never reaches
    `muse serve`). Every use asks first in the paid-use popup (M58, D48:
    `PaidUseConsent` in `src/core/paid/paidConsent.ts`, Allow once / Allow
    always in this workspace / Deny), in every mode, Bypass included; a
    paid call never gets an approval card or a session rule. In the ACP
    agent (D62) a feature is on only with its flag, and the same question
    is the editor's permission prompt (`src/acp/paid.ts`). The
    subscription never pays for one. One exception to the key is planned
    (PLAN.md D50, M85, experimental): the TypeSafe assist is billed to the
    user's own TypeSafe key instead of the Model API key; every other part
    of this rule applies to it unchanged.
13. **Wire shapes come from a live capture.** A row, parser or schema for
    something Muse Code or the Model API sends is written from a captured
    frame (the certification record names the capture, its workspace and its
    counted model attempts), never from a guess; the tests use that shape.
    Anything the wire may add later (a goal status, an MSP field) is shown
    as it came rather than dropped (PLAN.md D36, M43).

## Layout

```
src/extension.ts      activation: the view, the panel, the commands, the openers
src/host/**           VS Code adapters (views, conversation, backend managers,
                      the Model API bundle's entry (dist/modelApi.js, loaded
                      when that backend first starts), the plan reader's
                      (dist/planMarkdown.js, loaded on the first plan action),
                      code intelligence's `ide` answers (dist/codeIntel.js,
                      loaded on the first call) and voice's drivers
                      (dist/voice.js, loaded on the first recording),
                      the search worker and web fetch's page converter worker
                      (dist/pageWorker.js, started for each page), the
                      bundled skills' Muse Code installer (skills/,
                      dist/bundledSkills.js, loaded on first use),
                      commands, auth, settings, mentions,
                      editor tracking, usage trace logs, voice, the IDE tool
                      MCP server (diagnostics, code intelligence, images, web
                      fetch), VS Code's language services, the MCP servers'
                      spawner, the network posture, web fetch's pinned
                      transport and the verify loop's editor side: settled
                      diagnostics, format on edit and turn checkpoints' shadow repository)
src/core/**           backend-agnostic logic; must not import `vscode`
                      (MSP host, Model API client and tools, the MCP client,
                      context (rules, skills, custom agents), Muse Code's
                      memory, export, worktrees, usage,
                      dictation, Muse Voice, the paid gate, network failures,
                      code intelligence and the repo map, web fetch's
                      public-address checks and HTML converter, the verify
                      loop's check commands, diagnostics report and the files
                      it never opens because tools run them, the checkpoint
                      restore plan, the paired efficiency evaluation,
                      observation packing)
src/acp/**            the ACP agent (D62): the ACP side of a session and the
                      translation of the engine's events; must not import
                      `vscode`
src/runtime/**        the agent's process: arguments, backends outside VS Code,
                      the OS credential store (D61), `auth` and `login`
src/shared/**         constants + zod protocol shared by host and webview
src/shared/l10n/**    the English table (en.ts), fill/plural/Intl helpers, the
                      table checks and the list of translated languages
l10n/                 translated tables (ui.<language>.json) and the names the
                      localization gate lets stay English
package.nls.json      the manifest's text (commands, settings, walkthrough)
src/webview/**        React 19 app (browser project, own tsconfig)
native/windows/**     dictate.ps1, the Windows dictation helper; capture.ps1,
                      Muse Voice's recorder; the job helpers' C#
                      (MuseSparkJob.cs, MuseSparkMcpLauncher.cs and the
                      shared MuseSparkMcpJob.cs), compiled on first use
native/darwin/**      Dictation.swift, Info.plist, build.sh, check-disclaim.sh:
                      the macOS helper (built and checked in CI), with
                      Muse Voice's `--capture` mode
resources/            the walkthrough
test/unit/**          vitest (node + jsdom via docblock); `vscode` is mocked
test/e2e/**           the fake Muse Code CLI driven through the real backend;
                      the opt-in live drills (the Muse Code CLI; the Model
                      API sweep and the M75 evaluation, which bill the
                      owner's key)
test/integration/**   @vscode/test-cli, runs inside VS Code, over the workspace
                      test/fixtures/workspace (code-intel/ is a TypeScript
                      project its language service reads)
test/harness/         the webview behind a fake host, for screenshots and the
                      accessibility gate; themes/ holds VS Code's four themes
test/hosts/           the extension and the ACP agent in other editors
                      against the fake CLI, one script per host (hosts.yml)
scripts/**            esbuild build; bundle-size, bundle-split, host-globals,
                      notices, audit, PSScriptAnalyzer, semgrep, accessibility,
                      localization and host API gates; theme capture, the
                      pseudo-locale, harness screenshots, image rendering,
                      changelog notes, VS Code versions for CI, the ACP
                      agent's package
docs/certification/   per-milestone gate-fire records and screenshots
docs/ide-compatibility.md, docs/ide-compatibility/
                      the plan for editors beyond VS Code (D60), the
                      generated record of what the extension asks of its host,
                      and hosts.md, what each editor was tested at
docs/acp.md           the ACP agent's guide, shipped as its package's README
media/                icons, banner, social preview, README screenshots
```

## Commands

| Task                           | Command                                  |
| ------------------------------ | ---------------------------------------- |
| All gates (local)              | `npm run quality`                        |
| The gates CI runs everywhere   | `npm run quality:gates`                  |
| Accessibility gate             | `npm run test:a11y`                      |
| Localization gate              | `npm run check:l10n`                     |
| Host API record (D60)          | `npm run check:host-api` (`-- --write`)  |
| Panel in the pseudo-locale     | `npm run harness:shots -- --lang=pseudo` |
| Unit tests with coverage       | `npm run test:unit`                      |
| Integration tests              | `npm run test:integration`               |
| Dev build / watch              | `npm run build:dev` / `npm run watch`    |
| Production build + size budget | `npm run build`                          |
| Package `.vsix`                | `npm run package`                        |
| Package the ACP agent (D62)    | `npm run package:acp`                    |
| Host checks (hosts.yml)        | `sh test/hosts/run-<host>.sh`            |

## Toolchain pins that matter

- `typescript` stays on **6.0.x** until `typescript-eslint` declares support
  for 7 (`npm info typescript-eslint peerDependencies`). Upgrading early
  silently disables every type-aware lint rule.
- `knip.jsonc` must stay `.jsonc`; knip 6 rejects pseudo-comment keys.
- Cycle detection is `dpdm`, not an ESLint rule; `import-x/no-cycle` and knip's
  `cycles` are known to report nothing.
- Run knip as plain `knip`; `--strict` implies production mode and, without
  `!`-suffixed entries, analyses nothing while exiting 0 (verified M0).
