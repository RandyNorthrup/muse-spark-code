# Dependabot #195: dev-dependencies group, lint findings and their fixes

Pull request #195 (`dependabot/npm_and_yarn/dev-dependencies-506322c8a5`,
commit 8dceebacc4) bumps 13 dev dependencies. Its hosted run
(Actions run 39080420930) failed `static gates (lint)` and
`static gates (unit lint)` on Ubuntu, Windows and macOS. The three `quality`
jobs, `package (.vsix)` and `dictation helper (macos)` failed only on the
`CHECKS: failure` input those static gates feed them. Every other job passed,
the `build` static gate included.

## The failures, measured (2026-10-17)

Source: the Ubuntu job logs (`gh run view 39080420930 --job 117536072747
--log-failed` and `--job 117536072725`), parsed into one row per finding.
The `lint` job runs `run-s format:check lint:js:main lint:js:tests lint:css
lint:ps`: `format:check` passed ("All matched files use Prettier code
style!"), `lint:js:main` failed and stopped the chain, so `lint:js:tests`,
`lint:css` and `lint:ps` never ran there. They are measured locally below.

Every finding is an `eslint-plugin-unicorn` rule. `eslint.config.mjs` takes
`unicorn.configs.recommended.rules` whole, and the PR moves the plugin from
76.0.0 to 77.0.0. The cause column comes from the v77.0.0 release notes and a
diff of each rule's source between the 76.0.0 tarball (`npm pack
eslint-plugin-unicorn@76.0.0`) and the installed 77.0.0.

| Rule                                           |   `lint:js:main` | `lint:js:unit` | Cause in 77.0.0                                                                                                          |
| ---------------------------------------------- | ---------------: | -------------: | ------------------------------------------------------------------------------------------------------------------------ |
| `no-asterisk-prefix-in-documentation-comments` | 2916 (748 files) |  34 (20 files) | Was `off` in 76's `recommended`, now `error` (#3725). Flags each multi-line `/** */` comment whose lines start with `*`. |
| `no-unnecessary-array-flat-map`                |   102 (72 files) |    8 (6 files) | Now reports singleton array wrappers returned from a `flatMap` callback (#3782).                                         |
| `prefer-default-parameters`                    |    45 (31 files) |    4 (3 files) | Now reports bindings with a consistent fallback expression (#3780).                                                      |
| `prefer-type-error`                            |    22 (18 files) |     1 (1 file) | Now also reports a type-check `throw` in a braceless `if` body (rule source diff).                                       |
| `no-unnecessary-parameters`                    |    12 (12 files) |  30 (22 files) | New rule in `recommended` (#3784): a parameter that receives the same value, or `undefined`, at every call.              |
| `no-top-level-side-effects`                    |      3 (3 files) |              0 | Now checks `export default <call>()` (rule source diff).                                                                 |
| `prefer-single-object-destructuring`           |      3 (3 files) |              0 | Now inlines local sources (#3779).                                                                                       |
| `no-object-as-default-parameter`               |      3 (3 files) |              0 | Now sees through `as` / `satisfies` wrappers and parameter properties (rule source diff).                                |
| `prefer-literal-ascii`                         |       1 (1 file) |              0 | New rule in `recommended` (#3734).                                                                                       |
| `prefer-escaped-irregular-whitespace`          |                0 |    5 (4 files) | New rule in `recommended` (#3742).                                                                                       |
| **Total**                                      |         **3107** |         **82** |                                                                                                                          |

No other bumped package (eslint 10.12.0, typescript-eslint 8.71.1, prettier
3.9.10, stylelint 17.16.0, knip 6.41.0, jscpd 5.4.1 and the rest) produced a
finding in these jobs. The fixes go in the code: no rule is turned off,
lowered or ignored, and no package is held below the version the PR bumps it
to. The sections below record each fix as it lands.

Measured locally on the PR head before any fix (ESLint API, the same three
targets as `lint:js:main`, `lint:js:unit` and `lint:js:tests`): the same
3107 and 82 findings, rule for rule. `lint:js:tests`, the target CI never
reached, has 15 more: 12 `no-asterisk-prefix-in-documentation-comments` in
five files and 3 `no-unnecessary-array-flat-map` in
`test/e2e/live.e2e.test.ts:66,173,174` (counted by linting the PR head's
text of each changed file under its own path).

## The fixes

Each rule's own fix or suggestion was applied only where it keeps behaviour,
and every changed line was read. A suggestion that changes behaviour or does
not typecheck was replaced by a hand fix, listed here.

- **`no-asterisk-prefix-in-documentation-comments` (2962):** the rule's
  whitespace fix, alone. 773 files; each parses to the same
  comment-free AST as before (TypeScript printer, `removeComments`, file by
  file), and two blank comment lines that kept their indentation as trailing
  whitespace were emptied (`ModelApiHost.ts`, `nodeUsageFs.ts`).
- **`no-unnecessary-array-flat-map` (113):** the singleton array returned
  from a `flatMap` callback is returned bare (the rule's fix in JavaScript,
  its suggestion in TypeScript; `flatMap` treats a non-array value exactly as
  a one-element array). Fourteen of the results read `x === undefined ? [] : x`
  and took typescript-eslint's `prefer-nullish-coalescing` suggestion,
  `x ?? []`: each `x` is `T | undefined` with no `null`, or the playbook's
  `class`, a `z.enum` of non-empty names, so `??` is exact.
- **`prefer-default-parameters` (49):** a fallback that only ever replaces
  `undefined` moved into the parameter or destructuring default (array
  elements, optional parameters, `z.optional` fields). Hand fixes where a
  default would be wrong:
  - `src/host/backend/mcpProcess.ts`: Node's exit `signal` is
    `NodeJS.Signals | null`, and a default never replaces `null`. The close
    and exit events' pairs are merged at the one call site, so the phrase for
    "no signal known" is applied there, after both sources
    (`signal ?? processSignal ?? 'a signal'`); `exitDescription` takes the
    resolved name. Same text in every case.
  - `src/host/voice/voiceProcesses.ts`: the exit report names the signal when
    Node gives one, else the exit code. Node sets exactly one of the two
    (`lib/internal/child_process.js`, `onexit`: `signalCode` when a signal
    ended the process, `exitCode` otherwise), so every exit Node reports reads
    as before; only the pair Node never emits, both `null`, would now read
    `exit code null` instead of `signal unknown`.
  - `src/core/backends/modelapi/codecs/anthropic.ts`: `usage` is typed
    `Usage | null = null` (callers still pass `Usage | undefined`).
  - `src/webview/models/components/FilterBar.tsx`: the number input's
    `value` is typed by what it shows, `number | ''`, and each caller maps an
    unset facet to empty (`filter.contextMin ?? ''`); `''` cannot be the
    default of a `number` prop.
  - Two test loops over tuple literals typed `as const`, which removes the
    impossible `undefined` the fallbacks were there for
    (`modelapiChatCodec.test.ts`, `providersOverflow.test.ts`).
- **`prefer-type-error` (23):** in 22, `new Error` became `new TypeError` in
  a `typeof` / `instanceof` / `Array.isArray` / `Number.isSafeInteger`
  guard. Error classes are read only for log and report classification
  (`failureForLog`, `stackFrames`, whose vocabulary already lists
  `TypeError`); no code branches on these. `src/acp/media.ts` was not a type
  check: `decodeAcpBlob` returns bytes or a refusal string, and the method
  returns `TurnPart | string` and turns a thrown error back into its message.
  It now returns the refusal directly, as `translate.ts` does with the same
  result (lines 673 and 724).
- **`no-unnecessary-parameters` (42):** each parameter received one value at
  every call; it was removed and the value used in the body. Two were dead
  branches: `readJson` in `scripts/lib/localizationGate.mjs` never got a
  `maxOutputLength`, so its Brotli path never ran; the team check runner's git
  `input` was never given. Where the value was a narrowed `const` captured
  before its check, the comparison is computed once instead
  (`paidAuthority.ts`, `isSameAsPrevious`), or the controls moved into a child
  component that receives the defined value (`TrafficBoard.tsx`,
  `TaskControls`, same DOM, no state or hooks).
- **`no-top-level-side-effects` (3):** `eslint.config.mjs`,
  `vitest.config.ts` and `.vscode-test.mjs` bind the config to a `const` and
  export the binding. The rule's documentation puts declarations out of scope
  and reports `export default init()`.
- **`no-object-as-default-parameter` (3):** each default object is a complete
  value of its interface, now named as a module constant: `NODE_DISK_PORT`
  (`disk.ts`), `NO_UNDO` (`teamMerge.ts`), `OWN_ERROR_TYPES`
  (`conversationGit.ts`).
- **`prefer-single-object-destructuring` (3), `prefer-literal-ascii` (1),
  `prefer-escaped-irregular-whitespace` (5):** the rules' own fixes (same
  values: a destructure from the initializer, `` \` `` for `\u{60}`, and
  `\u{A0}`, `\u{200B}`, `\u{FEFF}` escapes for the raw characters in tests).

Linting the changed files after these fixes found 26 more, all fixed: the
fourteen `prefer-nullish-coalescing` above (three of them also reported by
`prefer-logical-operator-over-ternary`, gone with the same change), four
`no-inferrable-types` on new defaults, `prefer-optional-chain` and
`prefer-simple-condition-first` in `paidAuthority.ts`,
`prefer-logical-operator-over-ternary` in `networkPosture.ts`
(`!parsed.success || parsed.data`), one unused type import, and one
`no-unsafe-argument` from my first cut at `fail` in
`src/core/vault/broker/state.ts`, which removed the `outcome` parameter but
missed its second read. `outcome` is now a local `const` read in both places.

The build then failed once: `gen-lazy-registry --check` found
`src/shared/lazyBundles.generated.ts` stale, because the comment fix had
rewritten the header its generator emits. `scripts/gen-lazy-registry.mjs` now
emits the style the lint requires.

## Drill

`unicorn/no-asterisk-prefix-in-documentation-comments`, the rule with the
most findings, on the fixed tree: a planted `*` doc comment above
`isFlagOn` in `src/host/networkPosture.ts` made ESLint exit 1 with
`64:1 error Remove the asterisk prefix from this comment`; reverted, exit 0.
Hosted run 39080420930 is the red for every other rule in the table.

## Gates on the final tree (Windows 11, 2026-10-17)

| Gate                                                                                                                 |   Exit |
| -------------------------------------------------------------------------------------------------------------------- | -----: |
| `npm run lint` (`lint:js:main`, `lint:js:unit`, `lint:js:tests`, `lint:css`, `lint:ps`: PSScriptAnalyzer findings 0) |      0 |
| `npm run format:check`                                                                                               |      0 |
| `npm run typecheck` (all five projects)                                                                              |      0 |
| `check:badges`, `check:tokens`, `check:l10n`, `check:reference`, `check:host-api`, `check:plan`, `check:roadmap`     | 0 each |
| `deadcode`, `cycles`, `duplication`                                                                                  | 0 each |
| `npm run build` (every bundle within its cap; `dist/extension.js` 550.9 of 600 KiB)                                  |      0 |
| `npm run security:audit` (2 advisories: 1 listed exception, 1 low)                                                   |      0 |
| `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`                                                               |      1 |
| Unit suites touched (100 files: every changed test file and every test that imports a changed module)                |      0 |

The unit run: 100 files, 2895 tests passed, 15 skipped by their own platform
gates; the real-children suite of `pluginDispatch.test.ts` runs only off
Windows, so its helper edits are covered here by typecheck and lint, and on
Linux and macOS by hosted CI. The suites that read the lazy registry and the
activation budget (`packagedBundles`, `lazyBundleFiles`,
`modelsActivationBudget`): 22 passed; activation growth 2741 bytes against
the 3072-byte cap.

SAST: 9 `detect-child-process` findings, in `pluginHost.ts:367`,
`MuseCodeHost.ts:2773`, `toolIo.ts:1188`, `browserProcess.ts:119`,
`resourceJobHolder.ts:20`, `processLifetime.ts:879` (two),
`voiceProcesses.ts:69` and `checkout.ts:283`. The same semgrep run over a
byte-exact copy of those eight files at the PR head (8dceebacc4) reports the
same nine findings at the same lines, so this branch does not cause them.
The local semgrep is 1.177.0; CI installs the pinned 1.178.0
(`.github/semgrep/requirements.txt`), and `--config auto` takes the
registry's rules at scan time. Hosted `semgrep` passed on the PR head.

## Open

- `tseslint.config()` is deprecated in typescript-eslint 8.71.1 in favour of
  ESLint's `defineConfig()`. `eslint.config.mjs` still calls it (untouched
  here beyond the export); moving to `defineConfig()` is its own change.
- `unicorn/prefer-default-parameters` cannot see types: on a `null`-typed or
  differently typed binding its suggestion changes behaviour or does not
  compile. The four such sites above were fixed by hand; the next one will
  need the same reading.
- The local SAST result above, until semgrep here matches the CI pin.
