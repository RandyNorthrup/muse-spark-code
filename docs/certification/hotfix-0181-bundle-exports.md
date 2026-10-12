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

Limits, stated: a sibling whose text carries no export annotation is not
checked and is listed in the gate's line (today the five generated
`uiText*.js` tables); a module passed whole to other code is not followed.

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
`usd.ts` exports `canonicalUsd` and `exactJson.ts` imports it from `./usd`.
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
| `dist/modelApiBoundaries.js`  |           | 33,032 B  | 51,200 B  |
| `dist/configuredProviders.js` | 28,406 B  | 28,406 B  | 51,200 B  |
| `dist/subscriptions.js`       |           | 30,341 B  | 51,200 B  |

`dist/modelApi.js` grows by 290 B: the three names in its export map and in
its export annotation. They must be exports of that bundle and not copies in
the provider bundles: the confirmed-dispatch state they read and write lives
in `transport.ts`, once per process, and a copy would have its own. The bundle
test pinned the size at 532,537 B exactly; the pin is the owner's and is
re-measured in its own commit.

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

On the agent package built from tree `790285dd`, installed the way a user
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
