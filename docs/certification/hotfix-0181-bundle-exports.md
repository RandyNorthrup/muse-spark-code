# HOTFIX0181: names a bundle reads from a sibling bundle (0.18.1)

Branch `hotfix/0.18.1`, cut from main `f8435aaac` (0.18.0). 2026-10-12, host
with Kubuntu. All rig runs: Kubuntu, three workers, repository timeouts.

## The released defect

0.18.0 could not complete a turn on a provider the user added, on a ChatGPT
plan or through Copilot, in any host. The lead's proof on the published npm
package, three runs of three:

```text
node acp.js exec --backend modelApi --provider anthropic --model anthropic/claude-opus-5-5 --permission-mode plan --max-requests 1 ...
Model API turn ... failed: (0 , w.isStaleConfirmedError) is not a function      requests 0
```

## Cause

`deferredCohort` (`scripts/lib/deferredBundles.mjs`) points every import of
`transport.ts`, `sse.ts` and `ndjson.ts` in a bundle other than
`dist/modelApi.js` at that bundle. The bundle exports what its entry,
`src/host/backend/modelApiEntry.ts`, exports and nothing else. 0.18.0 added
three functions to `transport.ts` and imported them in the provider code;
nobody added them to the entry. TypeScript checks such an import against the
source module, and the unit tests run on source, so everything was green and
the built bundles called `undefined`.

## The sweep

Every value imported from the three redirected modules by a file outside the
Model API bundle, compared with the entry's exports (the source test below
keeps this list):

| Name                          | Imported by                                                                                                                                               | In the entry before |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `assertConfirmedAllowed`      | `core/providers/configured.ts`, `core/providers/subscriptions/registry.ts`, `host/providers/copilotClient.ts`, `core/backends/modelapi/providerClient.ts` | no                  |
| `isStaleConfirmedError`       | `configured.ts`, `registry.ts`, `copilotClient.ts`                                                                                                        | no                  |
| `noteConfirmedRequestStarted` | `registry.ts`, `copilotClient.ts`                                                                                                                         | no                  |

Three names, not the two the failure message showed: a plan or Copilot turn
that had passed the first call would have failed on the third. Every other
value those files import (`RequestTransport`, `ModelApiError`,
`parseJsonResponse`, `redactSecrets`, `parseSse`, `parseNdjson` and the rest)
was already exported. `client.ts` imports five more unexported names; the
split gate keeps it in `dist/modelApi.js` alone, where the import is the real
module, and the built check confirms that.

The built bundles that called the missing names: `dist/configuredProviders.js`
(`assertConfirmedAllowed` twice, `isStaleConfirmedError`),
`dist/subscriptions.js` (all three) and `dist/modelsPanel.js` (all three; the
Copilot client is in the Models & Agents panel bundle).

## The guard, on built output

`scripts/lib/bundleExports.mjs` reads the bundles as they ship. For each
`dist/*.js` it finds the sibling bundles the text loads (`require("./x.js")`,
through esbuild's interop wrapper, and native `import("./x.js")`), and every
member read from them: a member of the binding that holds the module, a
destructured name, a member read at once, and the same after `await` or in a
`.then` callback. It compares them with the sibling's own export list, taken
from esbuild's annotation in the sibling's text
(`0 && (module.exports = { ... })`). A function that declares a local of the
binding's name is skipped for that binding.

- `scripts/check-bundle-split.mjs`, part of `npm run build`, runs it over
  every built bundle and fails on a member the sibling does not export. It
  also fails when nothing was compared with `dist/modelApi.js` or
  `dist/modelApiBoundaries.js`, so the check cannot pass by reading nothing.
- `test/unit/deferredBundles.test.ts` runs the same check on the real
  in-memory production builds, and proves it names the reader and the member
  when the Model API bundle's export list loses one.
- `test/unit/bundleExports.test.mjs` proves the reader forms on real esbuild
  output: 0.18.0's defect in miniature, the dynamic forms, a local of the same
  name, and a sibling without a readable export list (reported as unverified,
  never passed).
- `test/unit/modelApiEntryExports.test.ts` is the fast signal on source: it
  names the file and the import for the Model API bundle.

As first written the check stated two limits: a sibling whose text carries no
export annotation was not checked and only listed in the gate's line (the
five generated `uiText*.js` tables), and a module passed whole to other code
was not followed. The review of pull request 150 found that a stated limit
the gate does not enforce is a way for a missing export to pass, and found
two more of the kind. All are closed in "The review of pull request 150"
below: what the check cannot follow or read now fails the build.

## It found a second defect on its first run

The first build of the hotfix tree with the guard, before any drill:

```text
build_exit=1
  dist: schedules.js reads canonicalUsd from modelApiBoundaries.js, which does not export it
  dist: usageService.js reads canonicalUsd from modelApiBoundaries.js, which does not export it
```

`src/shared/exactJson.ts` (M121 P2-1, first released in 0.18.0) imported
`canonicalUsd` from `./usdSchema`. The build points `usdSchema.ts` at
`dist/modelApiBoundaries.js`, whose entry re-exports `usd.ts`, and `usd.ts`
re-exported five names of `usdSchema.ts` but not that one. In the built
product `isSameDecimal` called `undefined` inside its own `try` and returned
false, so nothing crashed and every money-keyed number was judged inexact:

- usage journal lines and monthly rollups written as version 1 (dollars as
  JSON numbers, what 0.17 wrote) were counted as inexact and left out of
  Usage (`core/usage/journalStore.ts`, a whole month at a time for rollups);
- `parseScheduleStoredJson` refused a stored schedule with such a number
  (schedules are latched off, so nobody met that one).

Version 2 files (decimal text) were unaffected and no file was changed. Fix:
the boundaries bundle's entry, `src/shared/modelApiBoundariesEntry.ts`,
exports `canonicalUsd` from `usdSchema.ts`; `usd.ts` and `exactJson.ts` are as
in 0.18.0. The first form of this fix (`790285dd`, the tree of the live proof
below) added the name to `usd.ts`'s list instead. `usd.ts` is also an input
of four webview bundles, and the added name changed one of their chunks:
3,404 bytes before and after, identifiers renamed, the other 175 files
identical. No pixel could depend on it, but a hotfix should not touch a
browser bundle, so the export moved to the entry, which no browser bundle
reads. The readers and the tests below are the same for both forms.
Tests on the built code (`deferredBundles.test.ts`, "version 1 money through
the built bundles"): the 0.17.0 fixture journal read through the built
`usageService` bundle gives the same history as the source and no inexact
record; the built service still refuses a dollar a number cannot carry; a
stored schedule with dollar numbers parses through a bundle built with the
production plugins against the built boundaries bundle.

## Runs

Fixed tree (`790285dd`): `npm run build` exit 0;

```text
ok   cross-bundle members: 2135 reads of 39 sibling bundles, each exported by the bundle read (export list not readable: uiText.js, uiTextHooks.js, uiTextMedia.js, uiTextRuntime.js, uiTextSurfaces.js)
```

Typecheck exit 0 (five projects). The new and changed suites:
`bundleExports`, `modelApiEntryExports`, `deferredBundles`,
`problemReportBuilder`, `reportProblemHandler`: 239 passed, 1 failed, and the
one is the Model API pin below.

| Bundle                        | 0.18.0    | Hotfix    | Cap       |
| ----------------------------- | --------- | --------- | --------- |
| `dist/modelApi.js`            | 532,537 B | 532,827 B | 537,600 B |
| `dist/extension.js`           | 563,974 B | 563,974 B | 614,400 B |
| `dist/headless.js`            | 100,078 B | 100,078 B | 102,400 B |
| `dist/modelApiBoundaries.js`  | 32,999 B  | 33,032 B  | 51,200 B  |
| `dist/configuredProviders.js` | 28,406 B  | 28,406 B  | 51,200 B  |
| `dist/subscriptions.js`       |           | 30,341 B  | 51,200 B  |

`dist/modelApi.js` grows by 290 B: the three names in its export map and in
its export annotation. They must be exports of that bundle and not copies in
the provider bundles: the confirmed-dispatch state they read and write lives
in `transport.ts`, once per process, and a copy would have its own. The bundle
test pinned the size at 532,537 B exactly; the pin is the owner's and is
re-measured at 532,827 B in its own commit (`d90646575`), so it can be kept or
dropped on his word; the entry commit follows it, so a no is a revert commit
of that one, not a reset. With it the suites above all pass.

## What 0.18.1 changes in the built product

The production builds of 0.18.0 (`f8435aaac`) and of the branch with the
entry commit, on the same machine, compared file by file: 276 files of `dist`
each, metafiles aside.

- `dist/webview`: 176 files, every one with the same name and SHA-256 in both
  builds. The hotfix changes no browser bundle, so no frame and no README
  screenshot can move.
- Five files differ:

| File                         | 0.18.0    | 0.18.1    | Why                                                        |
| ---------------------------- | --------- | --------- | ---------------------------------------------------------- |
| `dist/modelApi.js`           | 532,537 B | 532,827 B | The three exports                                          |
| `dist/modelApiBoundaries.js` | 32,999 B  | 33,032 B  | Exports `canonicalUsd`                                     |
| `dist/report.js`             | 19,615 B  | 19,777 B  | Report a Problem: dotted setting names, facts switched off |
| `dist/acp.js`                | 241,039 B | 241,202 B | The same report builder, which the agent's bundle carries  |
| `dist/whatsNew.json`         | 35,870 B  | 35,457 B  | The release notes                                          |

Every other file is byte-identical, `dist/extension.js`, `dist/headless.js`
and the provider bundles among them: those bundles already called the three
names, and only the bundle they read them from changed.

On that tree (`24523131`): `npm run build` exit 0 with the guard line above
unchanged, 155 size rows and none over, typecheck 0; 155 files of the
packaging, bundle, report, release-text, usage and schedule suites and the
packed-package suite: 2,543 passed and 1 failed, `usageIntegration` at its
5,000 ms limit (a known deadline case). E8 and the three built money tests
pass.

## Drills

Each drill changed files in the rig's copy only, ran, and restored them; the
SHA-256 prefixes of the four files after the drills equal those before
(`edf449acbc3875f3`, `a7dccf2f9b6d1065`, `d35aeac5d6029bf0`,
`b4fa9fa5c0f8da88`), `git status` was empty, and the build was green again.

**A. The three files as released** (`modelApiEntry.ts`, `usd.ts`,
`exactJson.ts` from `f8435aaac`): `npm run build` exit 1,

```text
bundle split: 11 problem(s); see PLAN.md D6 and M57
  dist: configuredProviders.js reads assertConfirmedAllowed from modelApi.js, which does not export it
  dist: configuredProviders.js reads isStaleConfirmedError from modelApi.js, which does not export it
  dist: modelsPanel.js reads assertConfirmedAllowed from modelApi.js, which does not export it
  dist: modelsPanel.js reads isStaleConfirmedError from modelApi.js, which does not export it
  dist: modelsPanel.js reads noteConfirmedRequestStarted from modelApi.js, which does not export it
  dist: scheduleBackground.js reads canonicalUsd from modelApiBoundaries.js, which does not export it
  dist: schedules.js reads canonicalUsd from modelApiBoundaries.js, which does not export it
  dist: subscriptions.js reads assertConfirmedAllowed from modelApi.js, which does not export it
  dist: subscriptions.js reads isStaleConfirmedError from modelApi.js, which does not export it
  dist: subscriptions.js reads noteConfirmedRequestStarted from modelApi.js, which does not export it
  dist: usageService.js reads canonicalUsd from modelApiBoundaries.js, which does not export it
```

and the unit run exit 1 with six failures: both built cross-bundle tests, the
three built money tests and the source signal, which named
`providerClient.ts`, `configured.ts`, `registry.ts` and `copilotClient.ts`
with each import.

**B. One export removed** from the fixed entry (`isStaleConfirmedError`):
`npm run build` exit 1 with three problems (`configuredProviders.js`,
`modelsPanel.js`, `subscriptions.js`); unit run exit 1 with three failures.

**C. `canonicalUsd` as released** (`usd.ts`, `exactJson.ts`): unit run exit 1
with four failures. The built usage service reported 27 inexact records for
the 0.17.0 fixture where the source reports 0, and the built schedule reader
threw `scheduleStoredJsonInvalid`.

Drills A and C were run on the first form of the money fix, when the name was
in `usd.ts`'s list.

**F. The entry without the export** (the final form): `npm run build` exit 1,

```text
bundle split: 3 problem(s); see PLAN.md D6 and M57
  dist: scheduleBackground.js reads canonicalUsd from modelApiBoundaries.js, which does not export it
  dist: schedules.js reads canonicalUsd from modelApiBoundaries.js, which does not export it
  dist: usageService.js reads canonicalUsd from modelApiBoundaries.js, which does not export it
```

and the built tests exit 1 with four failures (the cross-bundle check and the
three money tests). Restored byte for byte (`f5091fe22bc53ab6`), `git status`
empty, build exit 0.

## E8: one turn on a configured provider through the packed package

The test whose absence let 0.18.0 out. `test/e2e/execStdio.e2e.test.ts` packs
the production package and runs it; every row used Meta's own model, so no
built code ever loaded the configured-provider bundle and called into
`dist/modelApi.js`. E8 does: `exec` in plan mode with `--max-requests 1` on a
Mistral provider from a providers file, its key in the test-owned keyring.
The preload answers the models list and one answer from the captured
exchange the unit suite's production run uses
(`docs/certification/m95-captures/mistral`) and resolves the provider's name
without a DNS query, so nothing leaves the machine. It asserts exit 0, status
`completed` on `mistral/ministral-3b-latest`, one request in the result and
exactly one chat request received.

Run: the suite's 45 tests pass, E8 in 2.3 s.

**Drill E.** The entry as released, and the build guard switched off in the
rig's copy so the package could be built at all: E8 fails, exit 4, status
`failed`, "is not a function" in the output and no chat request received,
while the suite's Meta rows (E3, E4, H2) pass beside it: 1 failed, 2 passed.
That is 0.18.0: every existing row green, the provider turn dead. Restored
byte for byte (`edf449acbc3875f3`, `55f222c13f7d7168`), `git status` empty.

In the 70-file gate run that carried this suite, four tests of two other
files ran past their 5,000 ms limit at load 11 (`checkPlan`, two cases;
`usageJournalMigration`, two cases). Same machine, alone, a minute later: 41
of 41 pass in 20 s.

## Report a Problem and dotted setting names

Found by an audit, verified by a failing test first. `SETTING_NAME_PATTERN` in
`src/core/support/problemReport.ts` allowed one segment after `museSpark.`.
The report's facts carry the names of the settings the user changed
(`manifestSettingNames` and `changedSettingNames`, `host/support/reportFacts.ts`),
and 14 of the manifest's 100 settings have a second dot
(`museSpark.vault.enabled`, `museSpark.judge.engine`,
`museSpark.shell.passEnvironmentVariables` and others). For anyone who had
changed one, `validatedFacts` threw, the handler said "That did not work" and
the dialog never opened; unticking the facts could not help, because they were
validated before `includeFacts` was read.

- The pattern takes one to four dotted segments, each with the old character
  rule; nothing but `museSpark.` plus letters, digits and dots between
  segments passes. The count bound moves from 64 to 128 names, above the
  manifest's 100, so a user who changed every setting still gets a report.
- A report whose facts are switched off is built without them, title
  included, when they do not validate. With facts on, the refusal stands.
- Tests: every `museSpark.*` property of the real `package.json` passes the
  builder, one at a time and all at once (read from the manifest, so a setting
  added later cannot break reports); ten names that are not setting names are
  still refused; the handler opens for a changed dotted setting; the
  facts-off cases.

**Drill D.** `problemReport.ts` as released (`f8435aaac`), the new tests
unchanged: exit 1, four failures (`accepts every setting of the manifest on
its own`, `carries all of them at once`, `builds the report without them when
they do not validate`, `opens for a user who changed a dotted setting`), 105
passed. Restored byte for byte (`b4fa9fa5c0f8da88`): both files pass.

## Live proof by the lead, 2026-10-12 12:07 AM PT, Kubuntu, Anthropic claude-opus-5-5

On the agent package built from tree `790285dd` (the first form of the money
fix; the three exports and the readers are the same in the final form), installed the way a user
gets it (`npm pack` of the package, `npm install` of the tarball into a fresh
folder):

- `exec`, plan mode, one request: completed, "ready", $0.012148.
- `exec`, acceptEdits, one request: completed, "ready", $0.000699.
- A real task (read `answer.ts`, two requests): "41", $0.003524.
- Four model calls, $0.0164 in all. Released 0.18.0 in the same minute:
  `(0 , w.isStaleConfirmedError) is not a function`, 0 requests.
- ACP, 25 scripted cases over stdio: the five that failed on 0.18.0 complete.
  `/usage` shows 88 requests, 462,735 input tokens and a total of $0.52 where
  0.18.0 said "80 older records not counted ... Total Cost: Unknown": the
  `canonicalUsd` fix, live.

## The review of pull request 150 (2026-10-12)

Four findings on head `39153196d`, all four real. They are one class: a
gate that can pass having checked less than it says. Fixed in scripts, tests
and records only; no file under `src` changes and no built file changes
(below). Windows host for edits, Prettier, changed-file ESLint and git;
builds, Vitest and the drills on the Linux laptop.

### 1. A target passed by being loaded (`check-bundle-split.mjs`)

`siblingExportProblems` recorded a sibling in `verified` with a count of
zero when it was loaded and no member read could be tied to it, and the gate
asked only whether the two targets were in that map.

- `verified` holds a sibling only when members were compared with its export
  list. Loaded and nothing read is not verified.
- `crossBundleFailures(report, targets, expectedComputed)` in
  `scripts/lib/bundleExports.mjs` is the gate's decision, so tests reach it:
  a missing export; a use that could not be followed, with reader, sibling
  and form; a sibling whose export list is not in its text; a load by a
  computed name that is not listed; a listed one that is gone; and each
  target with no member compared.
- The sweep of "present means checked": the map (above), the gate's
  `.has(target)` (now the count), the gate's line, which counted the map's
  size, and the `unverified` list, which was printed and passed. The five
  `uiText*.js` tables have no esbuild annotation; their export list is now
  read from their own `exports.EN = ...` (any other use of `exports` or
  `module.exports` leaves a list unknown), so `unverified` is empty on the
  real build and anything in it fails.

Tests (`bundleExports.test.mjs`, "a bundle counts as checked by the members
compared with it", five cases; every unfollowable form also asserts that the
sibling is absent from `verified` and that the gate's sentence names it).
**Drill F1**, presence counts again (the map takes zero counts, the gate asks
`.has`): exit 1, 15 failed, 39 passed.

### 2. A local hid the module for a whole function (`bundleExports.mjs`)

`declaredIn` collected every name declared anywhere in a function, so a
block-, loop- or catch-scoped local with the module's minified name hid the
module for the whole function, and a member read outside that scope was
skipped.

A name is now resolved by its binding through the lexical scopes around each
use: the file, a function (parameters, its own name, `var` at any depth, the
body's own `let`, `const`, class and function declarations), a block, a
switch block, a loop head, a catch clause, a class static block and a named
class expression. A read counts for a module exactly when its name resolves
to the binding that holds the module.

Tests, on built text in the shapes the minifier leaves, each with a read of
the sibling before the inner scope and one after it: a catch parameter, a
`for (let …)` binding, a `for (const … of …)` binding, a block `const`, a
block class, a switch case `const`, a class static block `var`; a function
still hides the name for its body and only for that; a module kept in a
block is read there and nowhere else. **Drill F2**, only functions, static
blocks and the file are scopes: exit 1, 7 failed, 47 passed.

### 3. An import kept in a holder was not followed (`bundleExports.mjs`)

A dynamic import stored by an assignment recorded no binding and no member.
Shipped code does it: `src/runtime/backends.ts` keeps
`import('./runtimeAccountingEntry.js')` by `??=` and reads
`createRuntimeDailyBudget` from the awaited value; deleting that export
passed the gate.

The check now follows a sibling's module, or the promise of it, through
every place the build keeps it: a variable (by binding), a property (by
name), a function or method that returns it (every call by that name), the
assignments `=`, `??=`, `||=` and `&&=`, a conditional, `??` and `||`, a
comma, `await`, a `.then` callback, `.catch` and `.finally`, a destructuring
declaration or assignment, a lowered dynamic import, and esbuild's interop
helper, recognised by its own definition and not by the shape of a call.
What cannot be followed is listed in `unfollowed` and fails the build: the
module passed whole, kept in an object or an array, a computed member, a
`...rest`, a function that returns it handed on without a call, a `.then`
callback given by name, a static import or re-export.

A load whose file is worked out at run time cannot be tied to a bundle at
all. There is one: `configured.ts` falls back from
`dist/providerCatalog.json` to the same table written as a module, which is
data handed whole to its schema. It is listed in `COMPUTED_LOADS` with that
reason; any other computed load fails the build, and so does that entry once
its load is gone.

On the real build (the production build of this branch, 87 bundles): no
member the first form read is lost, and 31 are read that it did not see,
through exactly the forms above:

| Reader             | Sibling                                                 | Members now compared                                                                                                                                                             |
| ------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtimeEngine.js` | `runtimeAccounting.js`                                  | `createRuntimeDailyBudget`, `withRuntimeAccounting`, `setUiText`                                                                                                                 |
| `foreignHooks.js`  | `pluginHooks.js`                                        | `containedTree`, `PluginSession`, `pluginAnswer`, `pluginRequest`                                                                                                                |
| `headless.js`      | `runtimeEngine.js`                                      | `createAcpAgent`, `createExecClient`, `createRuntimeBackend`                                                                                                                     |
| `modelApi.js`      | `hookRuntime.js`                                        | `loadSparkHookDefinitions`, `validateElicitationValues`, `validateElicitationSchema`, `parseElicitationParams`, `dispatchExtensionHooks`, `runTypedHandler`                      |
| `modelApi.js`      | `modelApiCodeIntel.js`                                  | `bareName`, `repoMapSection`, `planRenameCall`, `renameRefused`, `isProtectedRename`, `renameCardPath`, `applyRename`, `CodeIntelRefusal`, `runCodeIntelRead`, `renameHookFiles` |
| `modelApi.js`      | `foreignHooks.js`, `modelApiHooks.js`, `modelApiMcp.js` | `loadForeignHookDefinitions`; `dispatchHooks`; `McpServerPool`, `setUiText`                                                                                                      |
| `extension.js`     | `schedules.js`                                          | `nextScheduleFire`                                                                                                                                                               |

All 31 are exported: the stricter check found no third defect. The gate's
line is now

```text
ok   cross-bundle members: 2244 reads of 44 sibling bundles, each exported by the bundle read; every loaded sibling followed to its members, every export list read, 1 of 1 listed load(s) by a computed name
```

(2,135 reads of 39 before: 31 members newly followed, and 78 reads of `EN`
from the five tables whose export list is now read.)

Tests: thirteen holder shapes taken from the real build
(`bundleExports.test.mjs`, "a module is followed through every place the
build keeps it"), a cached dynamic import in real esbuild output, twelve
forms that cannot be followed and a `...rest`, the computed load and its list, and on the
real production builds (`deferredBundles.test.ts`) "follows every loaded
sibling to its members and reads every export list" and "names a member read
through a cached dynamic import (the accounting bundle)".

| Drill                                                              | Command         | Result                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F3a** `??=` not followed                                         | the two suites  | exit 1, 6 failed, 173 passed                                                                                                                                                                                                                              |
| **F3b** the same, on the real build                                | `npm run build` | exit 1, three problems, each "loads … and uses it in an expression the check cannot follow … (not followed, so not checked)": `foreignHooks.js` and `pluginHooks.js`, `modelApi.js` and `modelApiHooks.js`, `runtimeEngine.js` and `runtimeAccounting.js` |
| **F3c** the provider catalog's load not listed                     | `npm run build` | exit 1, two problems: the load, and the entry that matches nothing                                                                                                                                                                                        |
| **F3d** `createRuntimeDailyBudget` not exported, in the real build | `npm run build` | exit 1: "dist: runtimeEngine.js reads createRuntimeDailyBudget from runtimeAccounting.js, which does not export it"                                                                                                                                       |

Every drill changed files in the rig's copy only and restored them: the
SHA-256 prefixes before and after are equal (`0e572e61d511c45b` for
`scripts/lib/bundleExports.mjs`, `8bac881f424efad9` for
`src/runtime/runtimeAccountingEntry.ts`) and `git status` was empty.

### What changed for other code

`scripts/lib/bundleExports.mjs`, for a lane that builds on it:

- `siblingExportProblems(files)`: same name and argument. Its result keeps
  `problems`, `verified` and `unverified` and gains `unfollowed` (sentences)
  and `computed` (`{ reader, text }`). `verified` no longer holds a sibling
  with a count of zero.
- New exports: `crossBundleFailures(report, targets, expectedComputed?)`,
  `CROSS_BUNDLE_TARGETS`, `COMPUTED_LOADS`.
- `scripts/check-bundle-split.mjs` takes its two lists from there.

### No built file changes

The production build of `39153196d` and of this change on the same machine:
267 files of `dist` each (the metafile folders aside), built one after the
other in the same slot on the laptop, every one with the same name and
SHA-256 in both builds. `dist/modelApi.js` is 532,827 B (`cae6cd7e029a…`)
and `dist/extension.js` 563,974 B (`7cd17477a3ec…`) in both;
`dist/headless.js` 100,078 B and `dist/whatsNew.json` 35,457 B. No cap and
no pin moved, and no file under `src` is touched.

## The candidate that ships: `hotfix/0.18.1-nopin` (2026-10-12)

Pull request 150 takes `dist/modelApi.js` to 532,827 B, 290 B over its
0.18.0 pin, and no pinned size goes up. This branch is that pull request's
head (`87d9ab91c`) plus the Model API bundle diet. It replaces pull request
150, which is not merged.

### What was merged

`c7afe3533`: `fix/modelapi-diet`, 14 commits, at `4f30cc913` (`31d525e4c` on
the rig before the identity rewrite; the same tree, `89fd2e2f9`). No textual
conflict. No commit message in the range carries a `users.noreply.github.com`
address. The stricter cross-bundle check of pull request 150's review is
unchanged and passes as it stands; no listed exception was added:

```text
ok   cross-bundle members: 2258 reads of 45 sibling bundles, each exported by the bundle read; every loaded sibling followed to its members, every export list read, 1 of 1 listed load(s) by a computed name
```

### Sizes against pull request 150, built on the same machine (Kubuntu)

| File                    | `87d9ab91c` | Candidate   | Cap or pin                                     |
| ----------------------- | ----------- | ----------- | ---------------------------------------------- |
| `dist/modelApi.js`      | 532,827 B   | 518,954 B   | 0.18.0 pin 532,537 B; cap 537,600 B, untouched |
| `dist/modelApiTools.js` |             | 23,433 B    | 51,200 B                                       |
| `dist/uiText.js`        | 97,020 B    | 97,068 B    | The two new English messages                   |
| `dist/whatsNew.json`    | 35,457 B    | 38,619 B    | 40,960 B                                       |
| `dist/webview` (176)    | 1,586,386 B | 1,586,402 B | 136 files differ, 40 keep name and SHA-256     |

`dist/modelApi.js` is 13,583 B under the 0.18.0 pin; the size test asserts
the measured 518,954 B. Outside `dist/webview` nothing else differs in bytes:
`dist/extension.js` is 563,974 B (2,622 of the 3,072 B activation budget) and
`dist/headless.js` 100,078 B in both. `dist` has 268 files against 267.

The browser bundles differ because the diet adds two messages to
`src/shared/l10n/en.ts` (shown when the helpers bundle cannot load), which
every bundle with the message table carries: 16 B in all. Pull request 150
changed no browser bundle; this candidate does, so its frames are rendered
by the hosted visual job, not assumed.

### Three reds of the lane that its own runs did not include

Each was found by the candidate's gate on Kubuntu and fixed in a commit of
its own.

1. **The packaging fake** (`191a6008c`).
   `test/unit/resourceAcpPackaging.test.mjs`: 6 of 11 failed on the lane's
   head, on Kubuntu and on the Mac mini (`87d9ab91c`: 11 of 11). The lane
   moved the usage-asset closure into `scripts/lib/acpBundles.mjs`, which
   reads the metafile by an absolute path; the fake file system answered
   only the relative spelling, returned its default text, and `JSON.parse`
   threw. The fake now compares resolved paths: 11 of 11.
2. **Dead code** (`4550ebaa8`). `npm run deadcode` exit 1: two exports and
   four exported types of `modelApiToolsEntry.ts` "in a used namespace".
   The file is a deferred bundle's entry and was not listed in `knip.jsonc`,
   where every sibling entry is, and it re-exported four types nobody reads
   through it. The entry is listed and the four type re-exports are gone:
   exit 0, and no file of `dist` changes.
3. **Static analysis** (`08b7a7de8`). `npm run security:sast` exit 1: two
   blocking `detect-non-literal-regexp` findings,
   `scripts/gen-lazy-registry.mjs:103` and `scripts/lib/lazyRegistry.mjs:41`,
   each building `\b<name>\b` from a constant's name scanned out of `src`.
   Both now call `hasIdentifier(text, name)`, an `indexOf` search that
   accepts a hit with no identifier character on either side; nothing is
   suppressed. The answer differs from the old expression only beside a
   dollar sign, which the old one took for a word boundary (`$FOO` counted
   as a use of `FOO`, and a name holding `$` never matched). This paragraph
   said until the reviews below that the generated registry was unchanged
   because `gen-lazy-registry.mjs --check` exited 0. That was false as proof:
   the command checked nothing then. The proof made since: over the 38
   bundle-name constants and every one of the 393,180 lines of the 1,546
   sources, 533,204 comparisons of the old expression with the search, 0
   where the two answers differ.

Drill for the test the third fix adds (`lazyBundleFiles.test.ts`, "reads a
bundle-name constant only as a whole name, a dollar sign included"): with the
check of the character after the name removed, the suite exits 1 (1 failed, 6
passed, "expected true to be false"); restored, 7 of 7.

### Runs on Kubuntu, three workers, exit codes

On the tree of `8ea450f35` (the merge, the fake fix and the release text):
`npm run build` 0 (156 size rows, none over); typecheck 0 (five projects);
lint 0 (`lint:ps` is a reported skip off Windows); Prettier over the
repository 0; cycles 0; duplication 0; `check:badges`, `check:tokens`,
`check:l10n`, `check:reference`, `check:host-api`, `check:plan` and
`check:roadmap` 0; `security:audit` 0; `security:secrets` 0 (4,988 commits);
the packaging, bundle, report, release-text and usage suites, 77 files: 1,457
passed, 0 failed; `test/e2e/execStdio.e2e.test.ts` 45 of 45. The suites that
depend on the lane's sources (`vitest related`, 88 files): 4,398 passed and 1
failed, `usageIntegration` at its 5,000 ms limit. That deadline is known and
its cause is measured in a lane of its own (every usage read parsed the
machine's real Muse Code trace logs again; lane USAGETRACE, `356ab216e`, not
in this candidate); it was not run again here. `deadcode` 1 and
`security:sast` 1 on that tree: reds 2 and 3 above.

On `08b7a7de8` (tree `1263053cb`), the head the pull request opened on with
two document commits after it: `deadcode` 0; `security:sast` 0; typecheck 0;
`npm run build` 0 with the line above; every one of the 268 files of `dist`
has the SHA-256 it had on `8ea450f35`; the registry, bundle and packaging
suites, 6 files: 275 of 275; `test/e2e/execStdio.e2e.test.ts` on the packed
package 45 of 45.

The packed agent package of that head: `muse-spark-code-acp-0.18.1.tgz`,
2,490,546 B, 144 files, SHA-256
`72fa54eac3730a1613c3dc01b967dc05edf5b25ca62a24a70230ec765f6493ff`. It is not
the package that ships: the changes after the first hosted run, below, change
built files, and the package of the final head has its own digest and its own
live run there.

### Live smoke through the packed package, by the lead, 2026-10-12, 8:30 to 8:33 AM PT

Measured by the lead, not by the runs above. That tarball (its SHA-256
verified after copying), installed with `npm install <tgz>` into an empty
folder on the owner's Windows 11 PC (Node 24.20.0) and run from an empty
workspace, the agent's own folders redirected to a private test folder, keys
from the DPAPI store over standard input and removed afterwards (verified: no
key stored, no provider configured). Passed on all three routes:

- **Meta Model API, terminal agent**
  (`exec --backend modelApi --allow-contributor-models --model muse-spark-1.3-contributor`,
  run cap $0.25): a plain turn completed, 1 request; a tool turn completed, 3
  requests, and the file it was asked to create exists with the right
  content; a long answer completed, 1 request, 1,201 output tokens. The model
  reported on every result is `muse-spark-1.3-contributor`. 5 requests,
  $0.000686 settled, nothing uncertain.
- **A configured provider, the route 0.18.0 broke, terminal agent**
  (`providers add --preset anthropic … --key-stdin`; `providers test`: "Key
  works · 14 models"; `exec --provider … --model <entry>/claude-sonnet-5-5`,
  run cap $3): plain turn 1 request; tool turn 2 requests, file created with
  the right content; long answer 1 request. 4 requests, $0.013986 settled,
  nothing uncertain.
- **The editor protocol** (ACP over stdio, the same provider entry; the model
  read from the session's `model` config option and verified before any
  prompt): a plain turn ended `end_turn`; a tool turn raised one permission
  request ("Write: acp-smoke.txt", allowed once) and created the file;
  `/usage` then shows 3 requests for the session.

12 model requests in all, about three cents.

What the smoke also showed. All of it was present before this candidate and
none is its regression; each has a lane or gets one:

- a. A contributor model without `--allow-contributor-models`, and a provider
  model outside the entry's list, are refused with "This model is not
  available for this run." and no reason or remedy.
- b. One Sonnet request reserves $2.262144, so a run cap of $0.25 refuses it
  ("The next request exceeds the remaining budget.", no remedy).
- c. Each of two such refused runs left an open $2.262144 hold in the day's
  spending record.
- d. The third run then failed with "Internal error: Models & Agents is not
  available in this build." (a false sentence; zero requests).
- e. `--verbose` placed before `exec` makes `exec` reject its own options;
  `exec --help` prints the whole 1,374-line reference.
- f. The first ACP answer is prefixed with "Automatic compaction is awaiting
  evaluation and is inactive."; the account option reads "meta · Default
  Account" while the model is a provider's.

b, c and d are the budget defects whose fixes are in lanes (budget holds, the
start race); they go into the release after this one.

### Finding 4 of pull request 150's review: the complete gate

The finding: four timeouts in an aggregate run and two files passing alone
afterwards are not an exit-zero `npm run quality`. Agreed. Its answer was to
be one complete local run on one quiet machine; that plan is withdrawn and the
rule it cited is changed in this candidate (AGENTS.md, working rule 2, and
CONTRIBUTING.md, "Before you open a pull request"): hosted CI is the gate for
a release, every job green on the commit that merges, a red job read and its
cause measured; local runs are for fast feedback; before a release, real
conversations go through the packed product. The hosted full tier runs every
gate the local aggregate runs, the visual render in six shards among them, on
runners that carry nothing else, and its record is the run itself: the runs of
this branch are listed at
<https://github.com/RandyNorthrup/muse-spark-code/actions?query=branch%3Ahotfix%2F0.18.1-nopin>
and the one that counts is the run on the pull request's final head.

What the local attempts gave, as they were: one complete run was started on a
clean checkout of `8ea450f35` on the Linux laptop at 7:38 AM PT and stopped
at 7:49 AM PT, when red 2 changed the code head; it is recorded as stopped,
not as passed, and none was started after it. One test fails on that laptop
in a clean checkout of this branch,
`test/unit/inspectNative.test.ts`, "B1 Linux kernel boundary > runs verified
stat or refuses its unsupported thread requirement" (exit 1,
`stat: {"confined":true,"abi":7,"excluded":0}`); the same file passes on
Kubuntu on this tree (22 of 22), and this branch changes neither the test,
its helpers nor the code it runs. Its cause is not measured here; a lane of
its own has it, for `main`.

## After the first hosted run (2026-10-12)

Pull request 151 opened on `b27e48f16`. Its first hosted run and two reviews
found what the candidate still owed. Everything below is in the candidate.

### The first hosted run, 38270466443

Red. Every failed job, with the tests that failed in it:

| Job                                                   | Failed                                                                                                                                            | Whose                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| static gates, lint (Ubuntu, Windows, macOS)           | ESLint `unicorn/consistent-boolean-name`: `usesIdentifier` in `scripts/lib/lazyRegistry.d.mts:31`                                                 | The candidate's (`08b7a7de8`)                          |
| tests, Ubuntu shard 4, macOS shard 6, Windows shard 8 | `cyclesRoots.test.ts`, 5 cases; `flightRecorder.test.ts`, "R2 verifies the frame vocabulary against the shipped extension package"                | The candidate's (the diet's inventories)               |
| tests, Ubuntu shard 4                                 | `lazyBundleFiles.test.ts`, "resolves every dist name the sources load to a registry row": 5,543 ms of a 5,000 ms limit                            | The candidate's (the diet's test)                      |
| tests, macOS shard 1                                  | Cancelled by the job's 20-minute limit at 20.5 minutes; `modelApiHost.test.ts`, "refuses before the popup a source it could not send …", 5,446 ms | The candidate's (the diet's per-call install, below)   |
| tests, Windows shard 3                                | `fileLease.test.ts`, 2 cases; `tokenFile.test.ts`, 3 cases at the 15 s limit                                                                      | Code this change does not touch; with the Windows lane |
| quality (three systems), package, dictation helper    | The aggregates of the jobs above                                                                                                                  | Consequences                                           |

What each was, and its fix:

- **Lint.** The declaration file was the one changed file of `08b7a7de8`
  that was not linted before the push; the full lint on the rig had run
  before the helper existed. Renamed `hasIdentifier` (`b0e716f95`). Before
  the next push the rig ran the lint parts exactly as the workflow runs them.
- **Inventories.** The diet added a build entry and a dist file and updated
  every list that names a sibling but two: the dependency-cycle roots
  (`scripts/cycles.json`) and the frames a problem report keeps
  (`REPORT_PACKAGE_FRAME_PATHS`, 84 of 85 packaged scripts). Both name the
  new file (`48332e552`). Every list that names `dist/modelApiMcp.js` was
  read again: those two were the only gaps.
- **The registry test's limit.** One cause on all three systems: a unit test
  scanned the whole tree in process and sat at its limit (5,543 ms on
  Ubuntu, red; 4,238 ms on macOS of 5,000; 3,961 ms on Windows of 15,000).
  That assertion is the registry command's (next section); no limit moved.
- **macOS shard 1.** Two things. The diet made `modelApiHost.test.ts` slower
  (the section after next), and macOS had no margin on six shards even
  green: in run 38225260540 shard 4 took 19.0 of its 20 minutes and shard 1
  took 15.9. macOS takes eight shards now, as Windows does (`f03b4ef61`);
  the 20-minute limit and every test limit are unchanged.

The gate that ran on the rig before that push ran named suites, 77 files and
then 88 dependent ones, not the whole unit suite. Neither
`cyclesRoots.test.ts` nor `flightRecorder.test.ts` was among them;
`lazyBundleFiles.test.ts` was, and passed on the rig. Before the next push the
whole suite ran there.

### Two reviews and the bot's thread

A run-review on Windows (RVDIET0181, `87d9ab91c..8ea450f35`: 0 P1, 4 P2, 1
P3), a read-review through the product itself (RVAPP-DIET0181: 0 P1, 2 P2, 4
P3) and the Codex bot's thread on the pull request (P1). The product code
was judged safe by both; the records and one gate were not.

| Finding                                                                                                  | Answer                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `gen-lazy-registry.mjs` does nothing: no command-line part, so the build's check and both scripts exit 0 | A command, tested as one; next section                                                                                                   |
| The committed registry is stale: `ModelApiHost.ts` rows 19 lines off                                     | Regenerated by the command; rows name a function, not a line                                                                             |
| The scan misses a template literal, a computed name, a constant loaded where it is defined               | Scanner redesigned on the syntax tree; a computed load fails unless listed                                                               |
| The scan skips any line with `path.dirname` and `path.join`                                              | Followed; the one such name is listed with its reason                                                                                    |
| "No behaviour change" rests on goldens that never reach the moved code                                   | A golden that reaches it, written by the code before the move; the changelog says what does change                                       |
| Terminal and ACP users are told to "reinstall the extension and reload the window"                       | Those hosts say their own sentence                                                                                                       |
| No test removes `dist/modelApiTools.js` from a packed agent                                              | `execStdio.e2e.test.ts`, E9                                                                                                              |
| The changelog's 0.18.1 section reads like lane notes                                                     | One entry for a person; the detail is here                                                                                               |
| The pin comment says "only ever moves down in this lane"                                                 | False against the lane's history (+109, +2,120, +461 B); the comment says so                                                             |
| `packagedBundles.test.mjs` and `acpStdio.e2e.test.ts` fail on the Windows rig                            | On hosted Windows, run 38270466443: shard 7, 3 of 3, 22.8 s; shard 6, 13 of 13, 22.5 s. The rig's failures are the rig's, measured there |

### The registry command

`scripts/gen-lazy-registry.mjs` had no command-line part in any commit: the
file ended after `buildRegistry()`. `node scripts/gen-lazy-registry.mjs
--check` in `npm run build`, `npm run check:lazy-registry` and
`npm run lazy-registry:generate` did nothing and exited 0. The lane's
certification recorded a red drill of that check which those bytes cannot
have produced (corrected in `modelapi-diet.md`), and the candidate's own
record above took "exit 0" for "checked" once. The registry it guarded was
stale the whole time.

What it is now (`fb5f9520d`):

- **A command and nothing else.** No exports, no "am I the main module"
  test: such a test is false when the script is reached through a junction
  or a symlink, and the script then exits 0 having run nothing. It writes
  the registry or, with `--check`, compares it.
- **No input, no pass.** Metafiles missing, empty or unreadable fail with a
  sentence.
- **Every form of load.** The scanner reads the TypeScript syntax tree of
  each source that can hold a load. A literal is a literal wherever it stands:
  either quote, a template with no substitution, a name wrapped onto a line
  of its own. A load whose argument does not hold the name (a template with a
  substitution, a variable, `createRequire(file)(file)`, `new Worker(path)`)
  is recorded and fails unless `COMPUTED_SOURCE_LOADS` lists it with its
  reason. Five are listed: the loader adapter, the provider catalog and three
  worker starts whose path a caller builds from a literal the scan reads.
- **Nothing skipped.** The old scan skipped a line holding `path.dirname`
  and `path.join` and said nothing. The one such name,
  `src/runtime/schedules/wake.ts`, is the agent script the operating system
  starts for a scheduled wake. Followed as a load it made VS Code a loader of
  `acp.js` and of everything the agent loads: 14 packaging gaps. It is listed
  in `NAMED_NOT_LOADED` with that reason; the command checks that the build
  emits the file, that the agent's package carries it, and that the entry
  still matches a name in the source.
- **Rows without line numbers.** A row names the file and the function,
  method or constant that names the bundle
  (`ModelApiSession.toolAssist`, `WEB_FETCH_BUNDLE_FILE`). No consumer read
  the line, and an unrelated edit of a 17,000-line source made the registry
  stale.

The redesign changes what is found by exactly one name, measured on the tree:
the old scan and the new one give the same 242 requests, 38 bundle-name
constants and load attributions, and the new one adds the `wake.ts` name.
The command's first run, on the committed file, exited 1 and named 73 rows:

```text
lazy registry: src/shared/lazyBundles.generated.ts row modelApiTools.js says { file: 'modelApiTools.js', side: 'both', requestedBy: [ { importer: 'src/core/backends/modelapi/ModelApiHost.ts', line: 3127, side: ['acp', 'vscode'], }, ], },; the build gives { file: 'modelApiTools.js', side: 'both', requestedBy: [ { importer: 'src/core/backends/modelapi/ModelApiHost.ts', symbol: 'ModelApiSession.toolAssist', side: ['acp', 'vscode'], }, ], },
lazy registry: 73 problem(s); src/shared/lazyBundles.generated.ts not checked as current; after a real change of loaders run npm run lazy-registry:generate
```

Generated: 97 bundles, 127 loads by file name. Row by row against the
committed file: 97 of 97 rows have the same side and the same loading files
with the same sides. Only the line became a symbol.

Drills on the repository itself, Kubuntu, each the real command after a real
`npm run build`:

```text
$ printf "export async function load() {\n  return await import('./rogueEntry.js')\n}\n" > src/__drill__/rogueLoader.ts
$ node scripts/gen-lazy-registry.mjs --check          # exit 1
lazy registry: src/__drill__/rogueLoader.ts:2 (load) loads ./rogueEntry.js, which the build does not emit
lazy registry: 1 problem(s); src/shared/lazyBundles.generated.ts not checked as current; after a real change of loaders run npm run lazy-registry:generate

$ ln -s "$PWD/scripts" /var/tmp/linked-scripts
$ node /var/tmp/linked-scripts/gen-lazy-registry.mjs --check   # exit 1, through the link
lazy registry: src/__drill__/rogueLoader.ts:2 (load) loads ./rogueEntry.js, which the build does not emit

$ sed -i "s/symbol: 'ModelApiSession.toolAssist'/symbol: 'ModelApiSession.elsewhere'/" src/shared/lazyBundles.generated.ts
$ node scripts/gen-lazy-registry.mjs --check          # exit 1
lazy registry: src/shared/lazyBundles.generated.ts row modelApiTools.js says { … symbol: 'ModelApiSession.elsewhere' … }; the build gives { … symbol: 'ModelApiSession.toolAssist' … }

$ mv dist/meta-acp dist/meta-acp.kept
$ node scripts/gen-lazy-registry.mjs --check          # exit 1
lazy registry: dist/meta-acp cannot be read (ENOENT: no such file or directory, scandir '…/dist/meta-acp'); run the production build first (node scripts/build.mjs --production)
$ mkdir dist/meta-acp
$ node scripts/gen-lazy-registry.mjs --check          # exit 1
lazy registry: dist/meta-acp holds no metafile; run the production build first (node scripts/build.mjs --production)

# everything restored
$ node scripts/gen-lazy-registry.mjs --check          # exit 0
ok   lazy registry: 97 bundles, 127 loads by file name resolved, 5 listed load(s) by a computed name, 1 listed name(s) that are not a load; src/shared/lazyBundles.generated.ts is current
```

The same as tests, with the command run as a child process over a real
production build of a copy of the repository
(`test/unit/packagedBundles.test.mjs`): current, stale, generate (equal to the
committed file), a planted loader and a computed load through a linked
folder, metafiles empty and absent. With the command's main made to return at
once (`process.exit(0)` before it reads its arguments), those tests fail and
the suite exits 1. The scanner's forms
(`test/unit/lazyBundleFiles.test.ts`): with computed loads no longer
recorded, with templates no longer read, and with a constant loaded in its
own file dropped again, one test fails each time and the suite exits 1. Each
drill restored its file byte for byte.

### What a turn paid for the helpers

The diet's `toolAssist()` ran `await import('./modelApiToolsEntry.js')` and
installed the whole language table into the helpers bundle on every call,
and it is called before and after every model call, for every streamed tool
call and for every URL check. An install rewrites every entry of the table
and builds eight `Intl` objects.

Counted and timed on Kubuntu (the method instrumented in the rig's copy, the
file restored byte for byte):

| What ran                                                                | Calls of `toolAssist()` | Loads          | Table installs                 |
| ----------------------------------------------------------------------- | ----------------------- | -------------- | ------------------------------ |
| `modelApiHost.test.ts`, 670 tests, the diet's body                      | 3,469                   | 3,469 (973 ms) | 3,469: 14,376 ms, 4.14 ms each |
| the same, fixed                                                         | 3,469                   | 955 (170 ms)   | 4: 5 ms                        |
| the case that went red on hosted macOS, the diet's body                 | 36                      | 36             | 36: 169 ms                     |
| the same, fixed                                                         | 36                      | 9              | 1: 5 ms                        |
| one turn through the built `dist/modelApi.js`, one model call, the diet | 2                       | 2              | 2: 4.9 ms each                 |
| the same, fixed                                                         | 2                       | 1              | 1: 4.8 ms                      |

So a turn paid two installs of about 5 ms for each model call, in the product
and not only in tests. Now the helpers are loaded once for a session (a load
that failed is not kept: the next request tries again) and handed the language
once per installed table, through one helper that the code-intelligence and
schedules bundles' loaders in the same file use too. The same shape in
`src/core/context/recordingReader.ts` belongs to another bundle and is left
to the bundle-state work. A module is never handed whole to that helper: the
cross-bundle check fails a sibling it cannot follow to a member, and its
first form here failed it four times.

`test/unit/modelApiHost.test.ts`, 670 tests, uninstrumented, the same rig,
one after the other:

| Tree                                | Runs                          |
| ----------------------------------- | ----------------------------- |
| Before the diet, `87d9ab91c`        | 41.92 s, 41.69 s              |
| The diet as the pull request opened | 52.05 s, 53.64 s              |
| Fixed                               | 40.65 s to 42.73 s in 15 runs |

Before the diet 12 more runs took 41.58 s to 44.40 s.

**Observed, cause not measured.** In a 16th run of the fixed tree, which took
57.60 s with the rig's load at 5.4, `ModelApiSession: session budget (M82) >
admits no two-host overspend when both real claims publish before final
admission` (`test/unit/modelApiHost.test.ts:3638`) hit its 5,000 ms limit. The
case works two hosts against one real budget journal on disk. Alone it takes
143 to 291 ms, 8 of 8 on this tree and 8 of 8 before the diet; in the whole
file it passed 15 of 16 times on this tree and 14 of 14 before the diet. No
cause is named, no limit is raised and no retry is added.

Test (`modelApiBundle.test.ts`, "hands the helpers the language once per
table, not once per call", on the built bundle): one install for a turn of
two model calls, one more after a table is installed in the bundle. With the
diet's body put back it fails (4 installs) and the suite exits 1.

### The golden of the moved code

The 141 golden requests never reach the three groups of code the diet moved:
hooks are off, no call fetches, previews are only asserted absent. One new
scenario reaches all three in one turn: a PreLLMCall and a PostLLMCall hook
see each model call, the model calls `web_fetch` and its URL check's refusal
goes back to the model, and the call streams an argument preview. Its fixture
(`test/fixtures/golden-requests/moved-helpers.json`, 38,109 B: two raw
requests, four hook payloads, the previews) was written by the sources of
`87d9ab91c`, before the move, with the test file of this head. The whole
suite then passes on those sources and on this head, 142 of 142 each: byte for
byte the same. With one more field in what a PreLLMCall hook receives the
scenario fails; restored byte for byte (`d8392b7f2`).

What does change for a person, and the changelog now says so: when the
helpers bundle cannot load, every turn on that backend is refused before
anything is sent, hooks configured or not.

### A packed agent without its helpers (E9)

`test/e2e/execStdio.e2e.test.ts`, E9: the production package is packed, its
`dist/modelApiTools.js` removed, and one turn sent on a configured provider.
Zero provider requests, a non-zero exit, the agent's own sentence ("…
reinstall muse-spark-code-acp and restart the agent …") and never "reinstall
the extension", and on stderr `modelApiTools.js failed (absent)`: a missing
file is reported as absent in the packed agent. Drills: with the extension's
sentence put back, and with the refusal replaced by empty hook fields, E9
fails each time and the suite exits 1; restored byte for byte.

The agent hosts hand the Model API backend the sentence they already had for
a damaged backend (`acpModelApiBundleUnavailable`): no new sentence, no
locale table changes.

### Sizes on the final head

Built on Kubuntu from `1d2858f6f` (a clean checkout) and compared file by
file with the build of `87d9ab91c` on the same rig. `npm run build` exit 0;
156 size rows, none over.

| File                    | `87d9ab91c` | Final head  | Why                                                           |
| ----------------------- | ----------- | ----------- | ------------------------------------------------------------- |
| `dist/modelApi.js`      | 532,827 B   | 519,354 B   | The diet; then +68 B the host's sentence, +332 B load once    |
| `dist/modelApiTools.js` |             | 23,433 B    | New (cap 51,200 B)                                            |
| `dist/extension.js`     | 563,974 B   | 564,064 B   | The backend manager hands the host's sentence on (+90 B)      |
| `dist/runtimeEngine.js` | 643,477 B   | 643,567 B   | The same (+90 B)                                              |
| `dist/acp.js`           | 241,202 B   | 241,226 B   | The frame name (+24 B)                                        |
| `dist/report.js`        | 19,777 B    | 19,801 B    | The frame name (+24 B)                                        |
| `dist/recorder.js`      | 21,595 B    | 21,619 B    | The frame name (+24 B)                                        |
| `dist/uiText.js`        | 97,020 B    | 97,068 B    | The two messages of the diet                                  |
| `dist/whatsNew.json`    | 35,457 B    | 36,204 B    | The release notes (cap 40,960 B)                              |
| `dist/webview` (176)    | 1,586,386 B | 1,586,402 B | 136 files differ, 40 keep name and SHA-256 (the two messages) |

`dist/reportingPanel.js` (45,333 B) and `dist/resourceGovernor.js` (108,028 B)
keep their size and differ in bytes; what differs in them was not examined.
Every other file is byte-identical. `dist/modelApi.js` is 13,183 B under the
532,537 B of 0.18.0; the size test's pin moves from 518,954 to the measured
519,354 with that reason beside it (an exact-size pin moves with its measured
number and its reason; a cap moves only on the owner's word: no cap moved).
`dist/extension.js` has grown 2,712 of the 3,072 B the activation budget
allows. `dist/headless.js` is 100,078 B, unchanged.

### Runs on the final head

Kubuntu, three workers, exit codes.

On the complete tree, before its last commits (which change one test file and
documents): the lint parts exactly as the workflow runs them (`run-s
format:check lint:js:main lint:js:tests lint:css lint:ps`; `lint:ps` is a
reported skip off Windows) 0; `lint:js:unit` 0; typecheck 0 (five projects);
`deadcode` 0; `security:sast` 0; `security:audit` 0; `check:badges`,
`check:tokens`, `check:l10n`, `check:reference`, `check:host-api`,
`check:plan` and `check:roadmap` 0; cycles 0; duplication 0; `npm run build`
0 with

```text
ok   cross-bundle members: 2258 reads of 45 sibling bundles, each exported by the bundle read; every loaded sibling followed to its members, every export list read, 1 of 1 listed load(s) by a computed name
ok   lazy registry: 97 bundles, 127 loads by file name resolved, 5 listed load(s) by a computed name, 1 listed name(s) that are not a load; src/shared/lazyBundles.generated.ts is current
```

the registry, bundle, golden and packaging suites, 12 files: 491 of 491;
`test/e2e/execStdio.e2e.test.ts` on the packed package 46 of 46.

The whole unit and process suite on `1d2858f6f`, a clean checkout, 1,355 s,
while other work took the rig's load to 14: exit 1. Vitest's summary: 1,319
files passed, 8 failed, 10 skipped; 27,595 tests passed, 6 failed, 224
skipped. Every red it named:

| Suite                           | Failed                                                                                                                           | What it is                                                                                                                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acpPackageFixtures.test.ts`    | "every packaging fixture uses the shared layout and keeps no list of its own": four suites found, three expected                 | The candidate's. The scan took `packagedBundles.test.mjs`, which mentions the packager in a comment and now spawns the registry command, for a suite that runs the packager. The scan asks that the packager be named in a string (`3e21a8c62`): 3 of 3 |
| `playbookOutcomes.test.ts`      | 8 cases                                                                                                                          | The rig's: its shared dependency folder is installed without scripts, so the Husky wrappers the cases run do not exist. A clean checkout with a full install passes them                                                                                |
| `vault/peer.test.ts`            | 1 case                                                                                                                           | The rig's: `sudo -u nobody` cannot reach the run's private temporary folder ("command not found"). A clean checkout passes it                                                                                                                           |
| `usageIntegration.test.ts`      | 1 case at its 5,000 ms limit                                                                                                     | Known before this candidate; its cause is measured in a lane of its own (above)                                                                                                                                                                         |
| `accountsPanel.a11y.test.mjs`   | "hc-light section at 690px passes axe and fits the panel" at its 5,000 ms limit                                                  | Observed, cause not measured. Alone, load 10.6: 34 of 34, that case 1,503 ms                                                                                                                                                                            |
| `runtimeChatGptPackage.test.ts` | "refuses a missing providers bundle before replacing the package stage" at its 5,000 ms limit                                    | Observed, cause not measured. Alone, load 8.3: 2 of 2, that case 1,431 ms                                                                                                                                                                               |
| `promptHostLifecycle.test.ts`   | "registers and merges the prompt mirror when Settings Sync is enabled before any sharing command": the awaited call was not seen | Observed, cause not measured. Alone, load 11.1: 3 of 3, that case 188 ms                                                                                                                                                                                |
| `windowsTrustedPath.test.ts`    | Its `beforeAll` at the 10,000 ms hook limit                                                                                      | Observed, cause not measured. Alone, load 7.8: 25 of 25                                                                                                                                                                                                 |

None of the last four files is touched by this change, and none of them was
red on the hosted run. No limit was raised and no retry added for any of
them; hosted CI on the final head is the gate.

The package of the final head: `muse-spark-code-acp-0.18.1.tgz`, 2,490,514 B,
144 files, SHA-256
`3e4d4ca2f52b9279152be29a720c1f7ef09a413c4cf9fbb52e9fd733461a74b0`, packed on
Kubuntu from `1d2858f6f`; the commits after it change one test file and
documents, nothing the build reads.

The real conversations through this package are the lead's to run, after this
record is written; the live run recorded above is of the earlier package
(`72fa54ea…`), and this one's is added under it when it has run.
