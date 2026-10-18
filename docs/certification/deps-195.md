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
