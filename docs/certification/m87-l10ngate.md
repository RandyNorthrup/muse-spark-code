# M87 — Localization count gate (L10NGATE)

Scope: 2026-10-03, worktree `mx-m87gate`, branch `m87/gate`.
The common brief's prerequisite merge used the newer local `origin/main`
because `integrate/m72-on-24ff` was absent; merge `417fb3d1` was clean.

## Rule and readiness

The existing gate delegates to `src/shared/l10n/check.ts`; its shared checker
is also the runtime table validator. No parallel checker or dependency was
added. For each locale and plural key, integers 0 through 200 are sampled
using `Intl.PluralRules`. If `one` includes a number other than 1, its form
must retain `{count}` even when English's `one` has no number. Existing
required slots, categories, code spans, bold markers and untranslated checks
are preserved. German may omit the count when English does; a count already
required by English remains required.

The corrected gate first exited 1 with exactly 21 problems:

| Language                       | Fixed `one` entries |
| ------------------------------ | ------------------- |
| Russian (`ru`)                 | 7                   |
| French (`fr`)                  | 7                   |
| Brazilian Portuguese (`pt-br`) | 7                   |

Each language's `stepSummary` keys `edited`, `read`, `searched`, `ran`,
`fetched`, `searchedWeb` and `used` now include its count in native wording.
French and Brazilian Portuguese need it for zero; Russian needs it for 21,
31 and other recurring singular-category counts. All 14 shipped tables were
checked. There is no Ukrainian table; its rule is covered by the tests.

## Tests and deliberate break

Every run used the brief's `rig-test.sh kubuntu` command, worktree
`C:/Users/Randy/Coding/mx-m87gate`, slot `gate`, and complete test file
`test/unit/l10n.test.ts`, without an extra `run` argument or test filtering.

| Run                          | Rig snapshot | Exit | Result              |
| ---------------------------- | ------------ | ---- | ------------------- |
| Baseline                     | `115a422f`   | 0    | 19 passed           |
| Rule reverted                | `76de4e96`   | 1    | 4 failed, 15 passed |
| Bytes restored               | `c12863aa`   | 0    | 19 passed           |
| After lint style corrections | `63ca9589`   | 0    | 19 passed           |

The mutation replaced the additional-count slot calculation with the old
English-only slots. The Russian, Ukrainian, French and Brazilian Portuguese
regressions all failed with `expected [] to deeply equal [ Array(1) ]`:
the missing-count form was accepted instead of reporting
`files.one: slots {count}, {path} expected, found {path}`. German's omission
test still passed. Restoring the source in `finally` gave identical SHA-256:

```text
before:  ff123390467e5d4971ec7731d8aeaaf2e1171418ba67478b42b8b672df003e65
mutated: 25a189f3a83537d4ad25d34f1e3c3e715b9386e24539bd49f098f39a78f42bd4
after:   ff123390467e5d4971ec7731d8aeaaf2e1171418ba67478b42b8b672df003e65
```

Subsequent style corrections renamed the boolean and constructed the added
slot as an array. They preserved the rule and all existing comparisons; the
final complete-file retest passed. The regressions also check loose runtime
validation, required non-count slots and markup, and German's required
`other` count.

## Boundaries

Local `npm run typecheck`, `npm run deadcode`, `npx jscpd` and
`npm run check:host-api` exited 0. Duplication found zero clones; the host
inventory reported zero problems. The first ESLint run found three style
issues (boolean name, ternary layout and literal placeholder interpolation),
which were corrected without any suppression.
The final changed-file ESLint run exited 0. The final localization gate
reported 14 tables, 107 manifest strings, 356 source files and zero problems.

`npm run build` exited 1 at the unchanged bundle-split gate. Every size cap
passed: extension 573.2/600 KiB, Model API 370.5/400 KiB, checkpoint store
137.5/225 KiB, webview 809.2/900 KiB, ACP 738.3/850 KiB, and every other
bundle within its cap. The reported missing dependencies are present in
the intended bundles' generated metafiles:

| Bundle      | Package               | Inputs | Bytes contributed |
| ----------- | --------------------- | ------ | ----------------- |
| pageWorker  | parse5                | 14     | 125807            |
| pageWorker  | entities              | 6      | 25867             |
| pageWorker  | html-encoding-sniffer | 1      | 4008              |
| pageWorker  | @exodus/bytes         | 16     | 23128             |
| agentImport | smol-toml             | 9      | 9064              |

The pre-existing dependency junction resolves their input paths to
`../mx-cli-live/node_modules/`; the split guard expects a prefix starting
`node_modules/`. The guard, build configuration and junction were preserved.
The lead must rerun with worktree-local dependencies; this remains a full
build blocker, recorded in PLAN §7.

Full `quality`, complete unit coverage, accessibility and hosted milestone
certification remain lead-owned, as the common brief requires. No UI code,
dependency, gate level, threshold, suppression or untranslated allowance changed.
The skill's structural snapshot validator reported
`plan: expected exactly one quality-ledger fence`. It remains deferred:
this canonical milestone plan is preserved without a competing ledger.
