# M101 evaluation arms and frozen long-context tasks (kubuntu, 2026-10-10)

Lane C-M101-2. The M75 harness gains its frozen arms and long-context tasks
before any counted model call. All service responses below come from the
existing canonical fake Model API; there were zero live or paid model
attempts. No wire shape, credential source, dependency, gate threshold or
ignore changes. Production stays inactive: `IS_AUTO_COMPACTION_EVALUATED`
remains `false` and the arm's evaluation admission is a test double, which
cannot certify the D78 integration (lane E binds the real guard and ledger).

## Frozen set

`EVAL_ARMS` (`src/core/eval/mechanisms.ts`): baseline, packing (M73),
auto-compaction (M74), strict-tools (M101 item 24), in run order.
Sixteen tasks (`src/core/eval/tasks.ts`): nine accept, seven held-out —
the twelve previous tasks unchanged, plus per split one long-context
compaction task (`isLongContext`) and one two-defect multi-edit task.

Frozen digest (`evalHarnessDigest`, SHA-256 over each arm's name,
mechanism and change source with every task id, split, title, prompt,
file, verifier, long flag and resolved window, in run order, beside the
verifier prelude, the window rule's source, the held-deps list, the
frozen window and approval-mode defaults, and the arms' source closure:
every harness-owned file the arms reach, by bytes, plus every outside
binding they draw, by canonical value — `src/core/eval/armSources.ts`
walks the static import graph instead of a hand-kept list, and fails
closed on anything it cannot cover):

`9cfc4744b831524577ec068d8079830f4a1f1b24a29690210a442f4983786278`

`test/unit/eval/evalFrozen.test.ts` pins the arm list, the task list and
the digest. Any arm or task change breaks it on purpose; re-freeze by
recording the new digest here and in that test, never by weakening it.
Lane E's counted run recomputes the digest and compares it to this value.
(2026-10-10 R4 re-freeze: review RVCM1012C findings 1–4. The previous
digest `80d6fd00…ea95959` walked imports with a pattern scanner and hashed
outside bindings by their current runtime values; the scanner missed
edges, the values missed accessor implementations, and its directory
resolution disagreed with the build. The redesign below replaces both
with the real resolver. Details in `docs/certification/m101.md`.
2026-10-10 R5 re-freeze: review RVCM1012D finding 1. The previous digest
`630ffa83…f4fc1f` refused non-literal loads with a regular-expression
strip pass that replaced every template with `""`, so ``import(`${name}`)``
and `import("pre" + name)` read as literals and indirect spellings
(`module.require`, `require?.()`, aliases, `createRequire(…)(…)`,
`require.call`, `new Worker(…)`) were never refused. The refusal below is
parsed with the TypeScript compiler. Details in the R5 section.
2026-10-10 R6 re-freeze: review RVCM1012E findings 1–2. The previous
digest `d277f9d0…fa4c0b9` named only eight loader shapes, so the same
class stayed open (`import.defer`, function-local aliases, comma-sequence
and destructured loaders, `require` through element access and through
`call` on `module.require`, renamed/namespaced `createRequire` and
`Worker`, `require.resolve` reads, two-argument `new URL`, and
`import.meta.resolve`). The rule below refuses every runtime load unless
the metafile placed its target in the closure. Details in the R6
section.)

## Why the closure runs the real resolver (R4 redesign, not a patch)

The fourth round on this module redesigns how the frozen digest finds the
arms' import closure instead of patching the pattern scanner again. Each
arm root is bundled by esbuild (already a build dependency, never shipped:
no production bundle imports the evaluation harness) with `bundle: true,
write: false, metafile: true`, and every input file the metafile reports
contributes its exact bytes (sorted path + content). Every runtime edge
the bundler follows is therefore covered — static imports, re-exports,
`require` calls and literal dynamic imports — and directory and index
resolution is exactly what the build does, because it is the build. An
import the bundler cannot resolve fails the digest with its error; a
dynamic `import()` or `require()` with a non-literal specifier, which the
bundler leaves for runtime outside every hashed edge, is refused with a
clear error. The hash-outside-bindings-by-value path is gone: outside
files (capabilities, presets, constants, the pinned task schemas) are
hashed by bytes like harness-owned ones. Canonical JSON keeps an own
`__proto__` field (defined, never assigned), so values differing only in
that field hash differently. The previous digest `80d6fd00…ea95959` hashed
each change callback's source plus the scanner's closure; the R3 digest
`dc3f6372…dd15f` hashed callback sources only.

## Why the compaction tasks carry their log in the prompt

Measured on this rig: with the evaluation window of 26,000 tokens (harness
condition, shared by both arms since the R2 repair — never part of an
arm's mechanism, because a window override would also move `read_file`
truncation), `read_file` is capped at half a window in characters
(13,000), while near-window needs nine tenths in tokens — a single file
read can never trip compaction.
The task prompt therefore carries a generated 2,200-line log (~90 KB), so
the first request lands at ~102 KB, between 90% of the window and the
preflight limit, and the arm compacts at its first settled tool boundary.
Live long turns compact the same way through accumulated history; lane E
measures that difference with real calls.

## Evidence (fake pairs, all green at repository timeouts)

- `evalCompaction.test.ts` (11 tests): both long-context tasks compact at
  the first boundary — the second request carries the compaction prompt,
  every later one the hidden follow-up replaying the full byte-exact host
  todo list — and the judged fix lands byte-exact. The baseline sends no
  compaction under the same window. Both arms of a long-output task see
  byte-identical evidence, record included. A real memory store proves the
  automatic flush both ways: allowed, the labelled snapshot lands and the
  host's `add_memory` call rides the turn; refused (`denyUnmatched`), the
  store stays empty while the turn compacts and completes. Stop during a
  stream dispatches nothing; cancelling an in-flight summary dispatches no
  continuation (terminal `cancelled`).
  A classified 400 overflow recovers through compaction on a small task
  (all bodies stay below near-window, so only the overflow path could
  have compacted) and the turn still passes.
- `evalRunner.test.ts` (15 tests): the M75 strict-tools fake pair
  (now on the frozen `STRICT_TOOLS_ARM`, 9 accept / 7 held-out, 96 fake
  bodies, strict bytes on exactly the strict arm's requests) and the new
  M101 auto-compaction fake pair (16 tasks × 2 arms, 102 fake bodies,
  exactly the arm's two long-context runs compacted, both 0.75 floors
  held, verdict `pass`).
- `evalMultiEdit.test.ts` (3 tests): one `edits[]` call and two single
  edits both fix each multi-edit task (comparability) with identical
  bytes; the single call sends one fewer request. Multi-edit has no host
  seam — `edits[]` is always declared — so its pair is task-level by
  design; no vacuous arm was added. A host seam would be a production
  `tools.ts` change for another lane.
- `evalTasks.test.ts`: all sixteen verifiers fail the planted defect and
  pass two fix spellings. Packing, driver, report, wire, live-support and
  workspace-privacy suites pass unchanged (packing engagement still
  covers only the two `isLongOutput` tasks).

## Gate-fire drills (each restored byte-exact, SHA-256 verified)

| Drill | Deliberate break          | Assertion that fires                         | Restored                            |
| ----- | ------------------------- | -------------------------------------------- | ----------------------------------- |
| R1    | Verifier expects 781925   | frozen digest differs                        | tasks.ts `71d3df3d…90618`           |
| R2    | Arm latch `false`         | 5 compaction engagement tests fail           | mechanisms.ts `1365718e…d140ac`     |
| R3    | Window 20,000             | 5 tests fail (preflight refuses first send)  | constants.ts `44f85608…4bb3fe0acf8` |
| R4    | Strict capability `false` | strict-tools pair fails (no `"strict":true`) | mechanisms.ts `1365718e…d140ac`     |
| R5    | Arm renamed               | arm list and digest tests fail               | all four files `sha256sum -c` OK    |

### R2 repairs (2026-10-10, kubuntu; review RVCM1012 findings 1–3)

Each drill broke the guard, watched the named test fail, and restored the
file byte-exact (SHA-256 verified against the pre-drill value). Full record
in `docs/certification/m101.md`.

| Drill | Deliberate break                           | Assertion that fires                                               | Restored                             |
| ----- | ------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------ |
| D1    | Arm regains a 26,000-token window override | arm-config diff and frozen digest fail                             | mechanisms.ts `27988688…f808b8d`     |
| D2    | Arm latch `false`, text unchanged          | frozen digest fails; arm-list comparison stays green (as reviewed) | mechanisms.ts `27988688…f808b8d`     |
| D3    | `flushCompactionMemory` call removed       | both memory tests fail (snapshot; parsed flush call)               | ModelApiHost.ts `eee1b2eb…346fe762a` |
| D4    | Window 20,000                              | frozen digest fails (resolved per-task windows)                    | constants.ts `44f85608…4bb3fe0acf8`  |

### R3 repairs (2026-10-10, kubuntu; review RVCM1012B findings 1–2)

Each drill broke the guard, watched the named test fail, and restored the
file byte-exact (SHA-256 verified against the pre-drill value). Full record
in `docs/certification/m101.md`.

| Drill | Deliberate break                                                    | Assertion that fires                                              | Restored                          |
| ----- | ------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------- |
| R3-D1 | `noop` body throws (the review's probe, which the old pin survived) | frozen digest fails (`80d6fd00…`)                                 | mechanisms.ts `2525ecc5…869d4d`   |
| R3-D2 | New owned helper imported by the auto-compaction arm                | frozen digest moves; the new-helper test proves the walk found it | helper removed, import reverted   |
| R3-D3 | Function-valued outside binding hashed as `{}` (refusal neutered)   | `fails closed on a function-valued outside binding`               | armSources.ts `24a98227…541830`   |
| R3-D4 | A PLAN §8 row deleted                                               | `records the dependency-key assertion`                            | PLAN.md (SHA verified on restore) |

### R4 repairs (2026-10-10, linuxlt; review RVCM1012C findings 1–4)

The redesign above replaces the scanner and the by-value path wholesale;
the old R3 drills no longer apply (there is no clause pattern, no value
table and no `resolveRelative` left to break). Each drill below broke the
new guard, watched the named tests fail, and restored `armSources.ts`
byte-exact (SHA-256 `59d3671a…1484c16bbed` verified against the pre-drill
value after every drill).

| Drill | Deliberate break                                                 | Assertions that fire                                                                                                                                                                                                                                                                                            | Restored                             |
| ----- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| R4-D1 | File contents neutered: digest hashes each path, not its bytes   | `covers an outside file by bytes`, `moves when the helper changes`, `comment-quote edge`, `literal dynamic import`: **4 expected failures**                                                                                                                                                                     | armSources.ts `59d3671a…1484c16bbed` |
| R4-D2 | Bundler neutered: `bundle: true` flipped to `false` (entry-only) | **15 failures**: every test that bundles fails closed — the build rejects `external` without `bundle`, so the directory-index test (finding 3 rides the same resolver) and the refusal tests (with the resolve error instead) fail too; only the missing-file, `__proto__` and unhashable assertions still pass | armSources.ts `59d3671a…1484c16bbed` |
| R4-D3 | Refusal neutered: `refuseDynamicLoads` returns at once           | `fails closed on a non-literal dynamic import`, `fails closed on a non-literal require`: **2 expected failures** (without the scan the hole is silent: bundling succeeds)                                                                                                                                       | armSources.ts `59d3671a…1484c16bbed` |
| R4-D4 | `__proto__` guard neutered: plain assignment instead of define   | `keeps an own __proto__ field through canonicalization`: **1 expected failure** (both values serialize as `{}`)                                                                                                                                                                                                 | armSources.ts `59d3671a…1484c16bbed` |

Self-host note: the old refusal scan initially flagged `armSources.ts`
itself, because the scan patterns were regular-expression literals whose
inner quotes paired wrongly with the strip pass and exposed the doc
comment's call-like words; the patterns became strings to work around it.
The parser needs no such precaution — strings, comments, templates and
regex literals never parse as calls — and the real closure (all 16 `src/`
files plus pinned zod) scans clean, pinned by the repository-relative
test.

### R5 repairs (2026-10-10, linuxlt; review RVCM1012D finding 1)

The remaining refusal scanner treated non-literal dynamic loads as
covered: the strip pass replaced every template — substitutions included —
with `""`, so ``import(`${name}`)`` read as `import("")`, and a
concatenation starting with a quote read as a literal too. Indirect forms
the bundler also leaves for runtime were not refused either. The scanner
is replaced with the TypeScript compiler API (already a dev dependency,
never shipped: external to the in-memory bundle beside esbuild): every
file in the esbuild closure is parsed, and any `import()`, `require()` or
`new Worker()` load the bundler cannot see fails the digest with its file
and 1-based line. A dynamic `import()` or bare `require()` with a string
literal or substitution-free template stays the bundler's own edge
(probed: both land in the metafile); every indirect spelling
(`module.require`, `require?.()`, a `const req = require` alias chain
including `createRequire(url)` results, `require.call/apply/bind`) and
every `new Worker(…)` is refused in all spellings, literal or not —
probed on this rig, the bundler follows none of them (`require?.()` not
even with a literal), so each would run at runtime outside every hashed
edge. A `new URL(…)` alone is deliberately not refused: it parses data
and loads no file (zod's own `schemas.js` validates with `new URL(input)`
twice, and the real closure scans clean); a URL nested in a loader is
refused with it. No new dependency, no shipped-bundle change (`src/core/eval`
is imported by no shipped bundle), no UI string, no widened guard: the
rule refuses exactly the loads the bundler cannot follow.

Regression tests in `test/unit/eval/evalArmSources.test.ts`: the review's
two exact scenarios (template substitution, concatenation), every
indirect spelling (each literal and non-literal), `new Worker` (literal
and bare name), the `new URL` validation pin, a literal-`require` pin on
the allowed side, a file-and-line pin (`arm.ts:2`), a 64-case property
sweep (8 loader forms × 3 literal + 5 non-literal specifier spellings)
and a camouflage test (comment, block comment, string, regex and
template decoys collect clean beside them while a real load still fails).
Each new refusal test was watched to fail on the old scanner before the
replacement (5 failures), and the full sweep passes on the new one.

| Drill | Deliberate break                               | Assertions that fire                                                                                                                                                                                      | Restored                       |
| ----- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| R5-D1 | Refusal neutered: the AST walk returns at once | **8 failures**: every refusal test — the two old bare-form tests and the six new ones (template, concatenation, indirect spellings, Worker, property sweep, camouflage) — while all allow-pins stay green | armSources.ts `8584f41b…4611d` |

### R6 repairs (2026-10-10, linuxlt; review RVCM1012E findings 1–2)

One rule replaces the shape list: the walk finds every load site — a
dynamic `import()` (including `import.defer`, whose callee parses as a
MetaProperty on the keyword), any `require` spelling (bare, optional,
aliased in any scope, destructured, assigned, comma-sequenced, through
property or element access, through `call`/`apply`/`bind`,
`createRequire(…)(…)` under any local name, `require.resolve` bare or
destructured), every `new Worker(…)` spelling (bare, parenthesized, cast,
renamed, namespaced, aliased), a two-argument `new URL(specifier, base)`,
an `import.meta.resolve(…)`, a module-relative file read, and a dynamic
evaluation (`eval`, `Function`, bare or through a global holder) — and
every site is refused with file and 1-based line unless esbuild placed
its target in the closure. Direct `import(…)` / `require(…)` literals
resolve their candidates (probed extensions, index files, the `.js` →
`.ts` mapping esbuild itself applies) against the build's own metafile
inputs; a literal the bundler never followed (probed: the comma-sequence
loader) mismatches and fails. A non-literal specifier has no determinate
target and always mismatches. Bare and `node:` specifiers stay the
platform or a hashed dependency. Literal and static `import.defer` never
reach the walk: the cjs build rejects both outright (probed), as it does
a comma sequence around `import` — each still fails the digest, pinned by
its own test. Honest neighbours stay allowed and pinned: a bare platform
require, `path`'s own destructured `resolve`, a computed file read (the
loader itself reads its closure inputs that way), a `Function` type
annotation, an absolute file read, and the one-argument validating `new
URL(input)` zod itself uses. `ts.isImportCall` answers the same shape
question at runtime but is absent from the compiler's public types, so
the walk tests the callee shape directly. No new dependency, no shipped
bundle imports the evaluation modules, no UI string, no widened guard.

Regression tests in `test/unit/eval/evalArmSources.test.ts`: a 27-row
spelling table (every finding-1/2 form, each with its refusal message
and an `arm.ts:line` pin), the three fail-closed-at-build pins, five
honest-neighbour pins, and the unchanged sweep and camouflage tests. The
refuse-side of the metafile comparison (`did not place in the closure`)
has no naturally occurring trigger under esbuild 0.28.2 — every direct
literal either lands in the inputs or fails the build — so it stands as
probed defense-in-depth, with the allow-side pinned by the literal
dynamic-import test and the sweep's collect cases. Each drill below broke
the new guard, watched the named tests fail, and restored `armSources.ts`
byte-exact (SHA-256 `b558fbb1…e2b9` verified against the pre-drill
value after every drill).

| Drill | Deliberate break                                       | Assertions that fire                                                                                                                                                                                                                     | Restored                      |
| ----- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| R6-D1 | Refusal neutered: the walk returns at once             | **9 failures**: every refusal test — the two old bare-form tests, template, concatenation, indirect spellings, the new 27-row E-spelling table, Worker, property sweep, camouflage — while all allow-pins and build-fail pins stay green | armSources.ts `b558fbb1…e2b9` |
| R6-D2 | Comparison neutered: every relative literal mismatches | **2 failures**: the literal-relative-dynamic-import pin and the property sweep's collect cases — every refusal stays refused                                                                                                             | armSources.ts `b558fbb1…e2b9` |

## Gates

All five typecheck projects; ESLint `--max-warnings=0` and Prettier on
every changed file; `check:l10n` (0 problems; no new UI strings);
`check:reference` current; plain knip; production `npm run build`
(extension 550.1 KiB of 600 — `src/core/eval` is imported by no shipped
bundle, so the ~180 KB of task prompts never ship).

## Handoffs and lead decisions

- Lane E's estimate in `scripts/m101-e.mjs` now counts 16 tasks
  (160–320 calls); re-estimate live cost from the counted run.
- The live `eval.live.e2e.test.ts` still pairs baseline with packing
  only; adding the frozen auto-compaction and strict-tools arms to the
  counted run is lane E's change.
- The evaluation window (26,000 tokens) is the fake harness's value;
  the owner decision on the counted run's window size belongs to lane E.
- Two `as` assertions in `test/unit/eval/evalFrozen.test.ts` (the
  dependency-key narrowing and the held-deps widening) carry inline
  reasons and one PLAN §8 row per site (2026-10-10 R3 repair of review
  RVCM1012B finding 2, which this line wrongly claimed were unneeded). No
  `eslint-disable` entries or new dependencies.
