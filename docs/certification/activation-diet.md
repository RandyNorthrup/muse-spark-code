# Activation diet: the third strike (PLAN.md D6, 2026-10-03)

Recorded 2026-10-03. The change is on branch `perf/activation-diet`, cut
from `feature/m70-review` (PR #69) at `807effc2`. Three PRs in a row (#89,
#78, #87) each had to split code out because `dist/extension.js` crossed
its 600 KiB budget, and the open PRs together add about 36 KiB to main's
573 KiB. Under the owner's three-tries rule this is fixed once,
structurally: the activation bundle stops carrying text and code that only
lazily loaded bundles use. The budget stays 600 KiB.

No live model call was made for this lane: the tests run against fakes.

## Measure first

`npm run build` on `807effc2`, then `dist/meta/extension.json`'s inputs
ranked by `bytesInOutput` (scratchpad `diet/rank.mjs`). The largest:

| Input                                             | KiB in `dist/extension.js` |
| ------------------------------------------------- | -------------------------- |
| `src/host/conversation/conversationController.ts` | 99.7                       |
| `src/shared/constants.ts`                         | 43.6                       |
| `src/extension.ts`                                | 30.8                       |
| `src/core/backends/musecode/MuseCodeHost.ts`      | 20.8                       |
| `node_modules/zod/v4/core/schemas.js`             | 15.8                       |

Of `constants.ts`, `MODEL_TEXT` was 29.4 of the 70.4 KiB that survive tree
shaking (unminified, scratchpad `diet/survivors.mjs`). It is one object, and
esbuild cannot tree-shake an object by key, so every bundle that read any
of its 230 keys carried all of them.

Each key's readers were found by search and mapped to the bundles that
carry them through the production metafiles (scratchpad `diet/keys.mjs`).
A key whose readers are all outside `dist/extension.js` can move.

## What changed

### Model text, by reader

`MODEL_TEXT` now holds the 105 keys that a source file of
`dist/extension.js` reads. The rest moved to blocks beside it that only
their readers import:

| Block                     | Keys | Read by                                                                                                                                                                                                                            |
| ------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MODEL_API_MODEL_TEXT`    | +61  | `dist/modelApi.js`: goal tools, file and media tools, custom agents, MCP results, the code intelligence prompt line and the rename's write, observation packing, the verify loop's report; and the paired evaluation (`core/eval`) |
| `CODE_INTEL_MODEL_TEXT`   | 43   | `dist/codeIntel.js` and `dist/modelApi.js`: the code intelligence answers and refusals (`core/codeIntel/**`)                                                                                                                       |
| `CHECKPOINT_MODEL_TEXT`   | 4    | `dist/checkpointStore.js`: a recorded write that did not happen (`writeRecorder.ts`)                                                                                                                                               |
| `AGENT_IMPORT_MODEL_TEXT` | 3    | `dist/agentImport.js`: the imported rules section (`importConvert.ts`)                                                                                                                                                             |
| `FILE_REFUSAL_MODEL_TEXT` | 1    | `fileHasUnsavedChanges`: the Model API's file tools, the memory tools and the rename; its own block so that `dist/codeIntel.js`, which reads only this of the shared text, carries no `MODEL_TEXT`                                 |

- Fourteen keys that the merge of main had put back into `MODEL_TEXT`
  (`pack*`, `verifyLead`, `runChecksLead`) were already in
  `MODEL_API_MODEL_TEXT` with the same words, and nothing read the copies.
  They are gone. `packKnownIdsMore`, new on main, joined its siblings.
- The words did not change. `diet/same-words.mjs` bundles `constants.ts` at
  `HEAD` and in the working tree and compares them: 285 distinct keys
  before and after, every value equal, each key in exactly one block. The
  one new key is `codeIntelUnavailable` (below).
- Every reader names the block its key is in now (a scripted rewrite,
  `diet/codemod.mjs`, then `tsc` for all five projects). The keys keep
  their names.

The text moves alone took `dist/extension.js` from 577.5 to 569.6 KiB.
That did not reach the target, so the brief's second step followed.

### The `ide` server's code intelligence answers are a bundle of their own

- `src/host/ide/codeIntelEntry.ts` builds to `dist/codeIntel.js` (52.2 KiB):
  `answerCodeIntel`, `planRename` and `renameDiff`, with the queries, the
  repo map, `codeText.ts` and `CODE_INTEL_MODEL_TEXT`. The build options are
  the activation bundle's format, platform and target. `vscode` is not
  external there, so a stray import of it fails the build.
- Muse Code's tool list (names, descriptions, schemas, from
  `definitions.ts`) is still built at activation, so nothing about
  registration changed. `ideCodeIntelTools(intel, answers)` takes the
  answers as a function and calls it only inside a tool's `call`.
- `codeIntelLoader` (`src/host/ide/codeIntelBundle.ts`) goes through
  `lazyBundleLoader` (`src/host/lazyBundle.ts`). It requires the bundle on
  the first call, then calls its factory once with the activation bundle's
  installed table and language.
- A bundle that cannot load throws `MODEL_TEXT.codeIntelUnavailable`. The
  MCP server turns that into the call's error result, which is how the
  tools already report a refusal. The log has the file and the cause, and
  the next call tries again.
- The Model API backend keeps its own copy of the same modules in
  `dist/modelApi.js`. Each bundle carries its own copy of what both use, as
  M57's audit describes. The code intelligence modules compare errors by
  name (`DeadlineError`) or create and catch them in the same bundle
  (`CodeIntelRefusal`), so nothing is compared by identity across bundles.
- Budget 75 KiB: the measured 52.2 KiB plus 15 %, rounded up to 25 KiB, the
  rule M72 and M83 used. It is listed in `scripts/build.mjs`,
  `check-bundle-size.mjs`, `check-host-globals.mjs`, the notices' header
  (`THIRD_PARTY_NOTICES.txt` regenerated, 82 packages, header only),
  `.vscodeignore`, CI's VSIX member list, knip's entries and `npm run cycles`.

Why no existing lazy bundle took it:

- **`dist/modelApi.js`** already carries the code, but a Muse Code user
  would then load the whole Model API backend on the first lookup. D6's
  PR #32 amendment says a Muse Code user never does. Timed on the owner's
  machine (Node 24, three runs each, every bundle required after the
  activation bundle's own module code had run):
  - `dist/codeIntel.js`: 35.1, 34.8 and 39.0 ms;
  - `dist/modelApi.js`: 194.6, 170.0 and 189.3 ms;
  - `dist/review.js`, for scale: 33.1, 40.4 and 29.8 ms.
- **`dist/review.js`** (43.2 of 50 KiB) and **`dist/agentImport.js`**
  (100.5 of 125 KiB) have no room for 52 KiB.
- **`dist/checkpointStore.js`** is required at activation
  (`CHECKPOINT_STORE_BUNDLE_FILE`), so moving the code there would move
  bytes without moving any work out of activation.

### The guard

`scripts/check-bundle-split.mjs` runs in `npm run build`. Three new checks
follow its existing "dist/extension.js carries none of …" checks:

- **Code intelligence files.** `codeIntelEntry.ts` and the five
  `core/codeIntel` answer modules must not be in `dist/extension.js` or
  `dist/acp.js`, and must still be in `dist/codeIntel.js`.
- **Text blocks.** esbuild keeps property names, so a block's sentinel key
  in a bundle's output means that bundle carries the block. Each block
  lists its sentinels, the bundles that read it and the bundles that must
  not carry it:
  - `MODEL_API_MODEL_TEXT`: `compactionPrompt` (the M70 check, kept),
    `goalUnfinishedExists` and `verifyUncheckedCodeLoading` (from the moved
    text);
  - `CODE_INTEL_MODEL_TEXT`: `codeIntelNoSymbolNamed` and
    `repoMapBudgetTooSmall`;
  - `CHECKPOINT_MODEL_TEXT`: `writeNotRecorded`;
  - `AGENT_IMPORT_MODEL_TEXT`: `importedRulesHeading`.

  A sentinel must also still be in each bundle that reads its block, and
  still be a key of the block in `constants.ts`. So renaming one fails the
  build instead of quietly turning the check off.

- **What stays.** Every key of `MODEL_TEXT` must be read by a source file
  of `dist/extension.js`, found from the metafile's inputs. This is what
  keeps lazy-only text from growing back into the shared block, one key at
  a time, which is how the three strikes happened. A computed read
  (`MODEL_TEXT[…]`) in an activation file fails too, since the check cannot
  follow it.

## Sizes

Production build, KiB (`npm run build`'s own figures):

| Bundle                    | Before (`807effc2`) | Text moves only | After | Budget |
| ------------------------- | ------------------- | --------------- | ----- | ------ |
| `dist/extension.js`       | 577.5               | 569.6           | 544.7 | 600    |
| `dist/modelApi.js`        | 378.6               | 376.4           | 376.5 | 400    |
| `dist/codeIntel.js`       | (none)              | (none)          | 52.2  | 75     |
| `dist/review.js`          | 43.2                | 43.2            | 43.2  | 50     |
| `dist/planMarkdown.js`    | 139.0               | 139.0           | 139.0 | 150    |
| `dist/checkpointStore.js` | 132.8               | 125.3           | 120.7 | 225    |
| `dist/agentImport.js`     | 112.8               | 105.1           | 100.5 | 125    |
| `dist/uiText.js`          | 89.3                | 89.3            | 89.3  | 100    |
| `dist/searchWorker.js`    | 15.2                | 15.2            | 15.2  | 50     |
| `dist/pageWorker.js`      | 203.2               | 203.2           | 203.2 | 300    |
| `dist/webview/main.js`    | 826.9               | 826.9           | 826.9 | 900    |
| `dist/acp.js`             | 733.7               | 725.8           | 721.3 | 850    |

- `dist/extension.js` is 32.8 KiB smaller (557,823 bytes). The target was
  at least 30 KiB, to 547 KiB or less.
- `src/shared/constants.ts` went from 43.6 to 30.9 KiB of it.
- The VSIX ships 7.1 KiB less JavaScript in all: +52.2 for the new bundle,
  −32.8, −12.1, −12.3 and −2.1 for the others.

## Tests

The full unit suite ran on the Win11 rig, from snapshot `bd7745dc` (every
code and test change in the commit; only these Markdown files changed
after it): `rig-test.sh win11 C:/Users/Randy/Coding/mx-diet diet`, no file
arguments. Result: 292 files passed and 3 skipped (295); 5319 tests passed
and 47 skipped (5366); 2004 s; exit 0 (scratchpad `diet/rig-win11-unit.log`).
The `clean filter … failed` lines in its output come from tests that make
git filters fail on purpose.

| Check                                                                                            | Result                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `tsc --noEmit` for `.`, `test/unit`, `src/webview`, `test/e2e`, `test/integration`               | exit 0 (each)                                     |
| `eslint --max-warnings=0` and `prettier --check` on every changed file                           | exit 0                                            |
| `npx knip`                                                                                       | exit 0                                            |
| `node scripts/check-host-api.mjs`                                                                | 271 APIs, 18 files importing `vscode`, 0 problems |
| `npm run duplication`                                                                            | 0 clones                                          |
| `node scripts/check-l10n.mjs`                                                                    | 14 tables, 0 problems                             |
| `npm run cycles`                                                                                 | no circular dependency                            |
| Bundle size, split, host-globals and notices checks (host, metafile paths normalized, see below) | all ok                                            |
| `codeIntelBundle.test.ts`, `ideCodeIntelTools.test.ts` (host)                                    | 2 files, 11 passed                                |

New tests:

- `codeIntelBundle.test.ts`:
  - `isCodeIntelBundle` accepts a module whose factory is a function, and
    nothing else.
  - The loader loads nothing until asked, then loads once and keeps the
    answers.
  - It says why a module that cannot be loaded is refused, and tries again
    on the next call.
  - It refuses a module that is not the bundle, and a missing file, with
    the same reason.
  - The shipped bundle, built as `scripts/build.mjs` builds it beside a
    shared `uiText.js`, loads the shared English fallback and its own model
    text, and never `MODEL_TEXT`.
  - The bundle is the module the loader accepts, and it answers a real
    `findDefinition` as the source modules do.
  - It reads the table the activation bundle installed: a German table's
    `codeIntelNoService` is the refusal's visible reason.
- `ideCodeIntelTools.test.ts`:
  - Listing the tools does not load the answers.
  - A bundle that cannot load answers both a read and a rename as a failed
    call with `codeIntelUnavailable`, and the next call, once it loads,
    answers.

### The local build and the `node_modules` junction

This worktree's `node_modules` is a junction into `muse-extension-m70`.
esbuild resolves it, so the metafiles name dependencies as
`../muse-extension-m70/node_modules/…`.

- The split check's prefix checks then report 5 problems
  (`dist/pageWorker.js no longer carries node_modules/parse5/` and the
  like). That happens on the unchanged `807effc2` too, so locally
  `npm run build` stops at the split check.
- On the host, the checks were run after rewriting those paths to
  `node_modules/…` (scratchpad `diet/unjunction.mjs`; `dist/` is build
  output). Then every budget, split, host-globals and notices check
  passes.

`npm run build` itself was run on the Win11 rig, in the same snapshot's
checkout, `C:\Users\randy\gates\rt-diet`, whose `node_modules` is a real
install (`npm ci` from the same lockfile). It exited 0 with every check
ok: the twelve budgets, the split check (with the code intelligence and
model text lines), host-globals for nine bundles, and the notices
(82 packages). The figures matched the host's to the tenth of a KiB
(scratchpad `diet/rig-win11-build.log`).

## Red drills

Each guard was broken on purpose in the working tree, the check that should
catch it was run, and every file was put back byte for byte, with its
SHA-256 checked (scratchpad `diet/drills.mjs`, `drills.jsonl`,
`drill-<id>.log`). The working tree's `git diff` hash was the same before
and after the drills.

Gate drills: production build, metafile paths normalized, then
`check-bundle-size.mjs` and `check-bundle-split.mjs`:

| #   | Broken on purpose                                                                                                     | Exit | What the gate said                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Activation code imports `MODEL_API_MODEL_TEXT` statically (`host/ide/codeIntelTools.ts` reads `goalUnfinishedExists`) | 1    | 3 problems: `dist/extension.js carries MODEL_API_MODEL_TEXT` (its keys `compactionPrompt`, `goalUnfinishedExists`, `verifyUncheckedCodeLoading`); extension 556.9 KiB            |
| G2  | The `ide` tools import `answerCodeIntel` statically again                                                             | 1    | 6 problems: `dist/extension.js carries` `codeIntelQuery.ts`, `codeIntelTools.ts`, `codeText.ts`, `repoMap.ts`, and `CODE_INTEL_MODEL_TEXT` (both sentinels); extension 565.8 KiB |
| G3  | `goalNoActive` goes back into `MODEL_TEXT`, read only by `modelapi/goals.ts`                                          | 1    | 1 problem: `MODEL_TEXT.goalNoActive is read by no source file of dist/extension.js`                                                                                              |
| G4  | The sentinel `goalUnfinishedExists` is renamed `goalUnfinishedAlready` (block and reader)                             | 1    | 2 problems: `MODEL_API_MODEL_TEXT has no key goalUnfinishedExists`; `dist/modelApi.js no longer carries MODEL_API_MODEL_TEXT (its key goalUnfinishedExists)`                     |

Test drills: `codeIntelBundle.test.ts` and `ideCodeIntelTools.test.ts` on
the host (11 tests when clean):

| #   | Broken on purpose                                                              | Exit | Tests                    | Failing tests                                                                                                |
| --- | ------------------------------------------------------------------------------ | ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| T1  | The bundle's factory no longer installs the activation bundle's table          | 1    | 1 failed, 10 passed (11) | "reads the table the activation bundle installed"                                                            |
| T2  | Listing the `ide` tools asks for the answers (loads the bundle at activation)  | 1    | 2 failed, 9 passed (11)  | "lists every tool as read-only…", "answers every call as a failed one… while its bundle cannot be loaded"    |
| T3  | A bundle that cannot load answers with other words than `codeIntelUnavailable` | 1    | 3 failed, 8 passed (11)  | the loader's refusal and retry, the malformed and missing module, and the `ide` tools' failed calls          |
| T4  | `isCodeIntelBundle` accepts anything                                           | 1    | 2 failed, 9 passed (11)  | "accepts a module whose factory is a function, and nothing else", "refuses a module that is not the bundle…" |
