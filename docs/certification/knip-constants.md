# KNIPC — shared constants dead-export gate

Date: 2026-10-05. Rig: macmini, worktree `/Users/randy/lanes/KNIPC`,
branch `fix/knip-constants`, release base `7820bd30`. Knip 6.38.0,
Node 24.21.0. All commands ran directly in this worktree; no network,
live model, paid call, merge, rebase or push was used.

## Root cause and correction

Two independent module-graph effects hid unused exports:

1. `test/unit/execSchema.test.ts` imported `* as constants`, enumerated
   `Object.entries(constants)` and then filtered names by `EXEC_`. Knip's
   `typescript/visitors/calls.js` marks a namespace passed to `Object.entries`
   as an opaque import. Its graph then considers every export referenced,
   including unrelated constants. Filtering the resulting entries does not
   restrict that reference. The trace omits the opaque import's edge, so it
   can say `(no imports found)` and still mark an unused export as used.
2. Three checkpoint tests use `import type * as constants` to type their
   partial mocks. After removing the enumeration, Knip classifies unused
   constants as `nsExports` and unused types as `nsTypes`. Both are excluded
   from Knip's default issue set. Setting only their rule severity to `error`
   does not enable analysis: `get-included-issue-types.js` must include them.

The exec schema test now names the 11 exports it actually checks. Its
existing value checks remain; the whole-module inventory/count assertion
is removed. `knip.jsonc` adds `include: ["nsExports", "nsTypes"]` and explicit
error severities. Knip 6 treats an include list containing only these add-on
types as an extension of its default set. All 17 non-cycle issue types remain
enabled; cycles still belong to dpdm. No ignore or entry exemption was added.

Plain Knip reports no unused constants after this change. **Exports removed:
none.** Every existing export remains referenced; `src/shared/constants.ts`
is unchanged. No test was deleted.

## Bisection and controls

A scratch copy inside the worktree retained complete top-level statements.
An isolated entry reproduced the namespace enumeration with an unused plant
outside `EXEC_`. Repeated halving tested 1,055, 527, 263, 131, 65, 32, 16,
8, 4, 2, 1 and 0 original statements. Every probe exited 0 and hid the plant;
the last probe contained only `export const KNIPC_UNUSED_EXPORT_DRILL = 1`.
Replacing enumeration with a named import of a used `PRODUCT_NAME` made
the unused plant report and exit 1. All scratch source/config files were
removed after the probes.

Temporary local instrumentation of Knip's graph showed constants was
neither an entry nor skipped for export analysis, and had 1,056 direct
exports before planting. The opaque importer was `execSchema.test.ts`.
After named imports, the opaque edge disappeared, but the checkpoint tests'
type namespace remained. Instrumentation was restored byte-exact, with
SHA-256 `64269863bbc69b9ebc38159f88ee81ec669722f5b9087c7cad72606ef14e52c8`.

The configuration has no tag filter (`tags: [[], []]`); constants has no
ignore/public/internal JSDoc tag, top-level declare, BOM, CR, U+2028 or
U+2029. Its longest line is 938 characters. Its browser-constants star
re-export and UI-text named re-export are not causal: the minimal probe
has neither. File size, declaration syntax, cycles, `as const satisfies`
and parser failure are excluded by the same minimal reproduction.

Unlike the earlier report, this rig's trace lists the existing exports.
Trace mode is diagnostic only: Knip's CLI returns before error counting
when `isTrace` is on, so trace exit 0 is never gate-green evidence. The
following drills used **plain Knip**, with no trace, strict, cache or filter.

## Gate-fire drills

The value and type plants were added together, outside any real import:

```ts
export const KNIPC_UNUSED_EXPORT_DRILL = 1
export type KnipcUnusedTypeDrill = { value: string }
```

| State                                        | Plain Knip exit | Observed result                       |
| -------------------------------------------- | --------------- | ------------------------------------- |
| Release config and original enumeration test | 0               | Both plants missed                    |
| Named imports, release config                | 0               | Both plants missed by namespace rules |
| Named imports and additive namespace checks  | 1               | Value `nsExports` and type `nsTypes`  |
| Both plants removed                          | 0               | No dead-code issues                   |

The red report named `KNIPC_UNUSED_EXPORT_DRILL` at constants line 4096
and `KnipcUnusedTypeDrill` at line 4097. No genuine unused export was
present in the restored file. Both namespace guards fired in this drill.
The preexisting `vendor/**` and `axe-core` configuration hints remain hints;
their settings were not changed.

Constants was restored byte-exact, with SHA-256
`7147b380c88fc4bb2d94ca04f12c82dd37a123d6fae42e6be0af15b30e7e4ee1`.
The fixed test and config were also restored byte-exact after the control
drills; no planted code ships.

## Verification scope

The lane brief assigns full quality, aggregate coverage, accessibility,
integration/platform acceptance and integration merges to the lead. Those
remain required after integration; no gate or threshold is weakened. This
change introduces no runtime behavior, dependency, command, setting, wire
shape, user-facing string or escape hatch.

- `npx vitest run test/unit/execSchema.test.ts --maxWorkers=3 --testTimeout=120000`:
  26 tests passed. The deterministic committed schema check passed too.
- `npm run typecheck`: all five projects passed.
- `npx eslint --max-warnings=0 test/unit/execSchema.test.ts`: passed.
- `npx prettier --check CHANGELOG.md PLAN.md README.md knip.jsonc test/unit/execSchema.test.ts docs/certification/knip-constants.md`:
  passed, respecting the existing changelog formatting exclusion.
- `git diff --check`: passed.
- `npm run deadcode`: passed with no dead-code issues.
- `npx jscpd`: 933 files analyzed, zero clones.
- `npm run check:l10n`: 14 tables, 474 source files, zero problems.
- `npm run check:host-api`: 296 VS Code APIs, zero problems.
- `npm run build`: all production budgets, bundle splits, host globals and
  third-party notices passed. No cap was changed.

| Artifact                      | Measured KiB | Existing cap KiB |
| ----------------------------- | ------------ | ---------------- |
| Activation                    | 582.1        | 600              |
| Model API                     | 429.3        | 475              |
| Webview startup, eager chunks | 877.3        | 900              |
| Webview deferred JS           | 38.6         | 50               |
| Checkpoint store              | 89.0         | 225              |
| ACP                           | 804.2        | 850              |
| Shared English                | 119.3        | 125              |
| Shared validation             | 39.5         | 50               |

Packaging and installed-host checks are outside this scoped lane; no VSIX
size or installed-editor pass is claimed.
