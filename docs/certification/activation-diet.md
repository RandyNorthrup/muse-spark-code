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

> Superseded on 2026-10-04: main split code intelligence out on its own
> (PR #89, `dist/codeIntel.js` at 100 KiB), and the merge took main's split
> and dropped this one. See "Merged with main" below.

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

## Merged with main, the review's findings, and web fetch (2026-10-04)

Recorded 2026-10-04 (lane DIET-2). Main with M70 (PR #69 at `66b94269`)
had `dist/extension.js` at 590.6 of 600 KiB, and M87 adds about 4 KiB. The
target was 565 KiB or less: 25 KiB or more for M87, M71 and M81. No live
model call was made: the tests run against fakes.

Commits, in order:

| Commit     | What                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| `ed569397` | Merge `origin/feature/m70-review` (`66b94269`: main with M70)                                          |
| `9fae3adf` | Merge `origin/main` after PR #69 merged (its last commit `c5fc9b22`, and the dev dependency bump, #93) |
| `c696f88e` | The review's findings: every text block guarded against every shipped bundle                           |
| `b2de512e` | The window's web fetch loads on the first fetch (`dist/webFetch.js`)                                   |
| `a7b59cb8` | Merge `origin/main` (the 0.12.0 release, #106)                                                         |
| `fc773b73` | The M80 constants test counts `EXEC_MODEL_TEXT` (found by the full suite on Kubuntu)                   |

### The merge

Resolved by meaning (scratchpad `diet2/`):

- **Code intelligence.** Main's split (PR #89: `codeIntelEntry.ts`,
  `codeIntelBundle.ts`, `codeIntelTools.ts`, their tests, the
  `ON_FIRST_USE` split check, budget 100 KiB) won. This lane's own split,
  its `codeIntelUnavailable` words, its PLAN §8 row and its README clause
  were dropped. `CODE_INTEL_MODEL_TEXT` stayed: `dist/codeIntel.js` and
  `dist/modelApi.js` read it, activation does not.
- **Bundles main added** (session board, reviewer, bundled skills, voice,
  the reviewer on Muse Code) kept in `scripts/build.mjs`, the size, split,
  host-globals and notices scripts, `.vscodeignore`, CI's VSIX member list,
  knip and `npm run cycles`.
- **Model text.** This lane's blocks, plus every key main added. Main's new
  `MODEL_TEXT` keys that no activation file reads moved by reader:
  `subagentResultWithheld` and four M78 refusals to `MODEL_API_MODEL_TEXT`;
  `codeIntelPolicyRefused` and `codeIntelPolicyHidden` to
  `CODE_INTEL_MODEL_TEXT`; the exec run's untrusted-file frame to a new
  `EXEC_MODEL_TEXT` (`dist/acp.js` only); the Auto reviewer's text to a new
  `AUTO_REVIEWER_MODEL_TEXT` (`dist/reviewer.js`, `dist/museCodeReviewer.js`).
  M78 made the code intelligence queries read `pathChangedAfterApproval`,
  which activation reads too, so `dist/codeIntel.js` carried all of
  `MODEL_TEXT` again; it joined `fileHasUnsavedChanges` in
  `FILE_REFUSAL_MODEL_TEXT`.
- **Same words.** `diet2/same-words.mjs` bundles `constants.ts` at
  `origin/feature/m70-review` and in the tree and compares every
  `*MODEL_TEXT` block: 328 keys, every value equal, each in one block (329
  after web fetch's one new key, `webFetchUnavailable`).
- **Readers.** `diet2/stale-reads.mjs` lists every read of a block whose key
  is not in that block, under `src/`, `test/` and `scripts/`;
  `diet2/codemod.mjs` points each at the key's block and fixes the import.
  0 left. The rest of main's side was taken hunk by hunk where only import
  order or a block's name differed (`diet2/hunk-audit.py`,
  `rename-only.py`).
- CHANGELOG by `changelog-rebase.py` and `changelog-fix-released.py` at
  each merge; the l10n tables, `docs/host-api.md` and the notices merged
  without conflict and matched main's; PLAN kept both sides.

### The review's findings

From `muse/rv-diet.report.md` (no P1):

- **P2-1.** `REVIEW_MODEL_TEXT` had no guard entry. It has one (readers
  `dist/review.js`, `dist/modelApi.js` and the webview's review pane), as
  do the merge's `EXEC_MODEL_TEXT` and `AUTO_REVIEWER_MODEL_TEXT` and web
  fetch's `WEB_FETCH_MODEL_TEXT`. A block `constants.ts` declares that the
  check does not guard now fails the build, which caught
  `WEB_FETCH_MODEL_TEXT` the first time it was built.
- **P2-2.** A block's "others" were only activation and the ACP agent. Now
  they are every JavaScript bundle in the production metafiles (18:
  `dist/meta/*.json` and `dist/meta-acp/acp.json`, the webview included)
  but the block's declared readers.
- **P3-1.** `FILE_REFUSAL_MODEL_TEXT` is pinned to its two keys, with the
  reason: activation reads it (memoryStore, toolIo, fsAtomic), so any key
  added rides into `dist/extension.js` and `dist/acp.js`.
- **P3-2.** The shipped bundle test checks every key and value of
  `MODEL_TEXT`, not one canary (`test/unit/helpers/bundleText.ts`, shared
  by the code intelligence and web fetch bundles' tests). A value is found
  by its longest run without quotes, backslashes, `$`, line breaks or
  non-ASCII (what esbuild may escape), 12 characters or more; a key by
  `key:` after a brace, comma or space. A positive control finds the text
  the bundle does read the same way.

### More room: the window's web fetch

After the merge and the text moves `dist/extension.js` was 575.7 KiB, so
the brief's third step followed. Ranked by `bytesInOutput`, web fetch was
the largest piece that registration does not need: `core/web/webFetch.ts`
6.9 KiB, `fetchFailure.ts` 3.3, `webFetcher.ts` 1.8, `publicAddress.ts`
1.9, `textDecoding.ts` 1.5, `pinnedRequest.ts` 1.1, `mimeType.ts` 0.9,
`pageUrl.ts` 0.9 and about 5 KiB of model text.

- `src/host/web/webFetchEntry.ts` builds to `dist/webFetch.js` (46.7 KiB,
  budget 75). Its two exports install the activation bundle's table and
  locale on each call: `checkWebPageUrl` (the first checks) and
  `fetchWebPageWith` (the window's fetcher, `createWebFetcher`).
- `src/host/web/webFetchBundle.ts` loads it through `lazyBundleLoader`.
  `lazyWebFetcher` is the window's `WebFetcher` for both backends;
  `lazyPageUrlCheck` is Muse Code's `webFetch` check before the modal
  (`IdeWebFetchDeps.checkUrl`). Creating either loads nothing.
- A bundle that cannot load: the fetch's result is a failed fetch, kind
  `unavailable`, with `MODEL_TEXT.webFetchUnavailable` for the model and
  `UI_TEXT.webFetchUnavailable` for the Model API row (in all 14 tables),
  which is how every refused fetch reports; Muse Code's call is refused
  with it before any modal. The loader logs the file and the cause; the
  next use tries again.
- `approvalHost` and `bareHost` moved to `src/core/web/hostName.ts`, so the
  `ide` tool names the host at activation without the checks.
- Web fetch's 42 model text keys are `WEB_FETCH_MODEL_TEXT` (readers
  `dist/webFetch.js`, `dist/modelApi.js`, `dist/acp.js`). `webFetchDeclined`,
  `webFetchCancelled`, `webFetchNotOffered` and the new
  `webFetchUnavailable` stay in `MODEL_TEXT`: the `ide` tool reads them at
  activation.
- The Model API backend keeps its own URL checks and the ACP agent its own
  fetch. HTML is still converted on `dist/pageWorker.js`.
- Listed in the build, the size, split (`ON_FIRST_USE`: the entry, the
  fetcher, the transport, the fetch, the failures, the URL checks, the
  address checks, the media type and decoding modules) and host-globals
  checks, the notices (regenerated, 83 packages), `.vscodeignore`, CI's
  VSIX list, knip and `npm run cycles`.
- `src/core/export/sessionTransfer.ts`, the brief's other candidate, stays
  at activation: its export and import run from the panel's commands, and
  the target was met without moving it.

New tests, `test/unit/webFetchBundle.test.ts` (12): the guard accepts the
module and nothing else; the loader cases every lazy bundle meets; the
shipped bundle loads the shared English fallback and carries none of
`MODEL_TEXT`; it checks four refused URLs and an accepted one as the
source does; it fetches as the source does, and logs the host and the
outcome; it says why in the table the activation bundle installed; nothing
loads before the first use; a missing bundle fails each fetch with the
reason, logs it and tries again; Muse Code's check throws the reason.
`ideWebFetch.test.ts`: while the checks cannot be loaded, the call asks
nothing and fetches nothing.

### Sizes

Production build, KiB (`npm run build`'s own figures). "Before" is main
with M70 (`66b94269`, the M70 worktree's production build; the webview
from this merge's `66b94269` side).

| Bundle                     | Before | Merge and text moves | After | Budget |
| -------------------------- | ------ | -------------------- | ----- | ------ |
| `dist/extension.js`        | 590.6  | 575.7                | 552.6 | 600    |
| `dist/modelApi.js`         | 430.1  | 426.2                | 426.3 | 475    |
| `dist/review.js`           | 43.1   | 43.1                 | 43.1  | 50     |
| `dist/sessionBoard.js`     | 62.0   | 62.0                 | 62.0  | 75     |
| `dist/reviewer.js`         | 54.6   | 28.8                 | 28.8  | 75     |
| `dist/planMarkdown.js`     | 139.0  | 139.0                | 139.0 | 150    |
| `dist/checkpointStore.js`  | 135.7  | 109.1                | 109.1 | 225    |
| `dist/agentImport.js`      | 115.6  | 88.8                 | 88.8  | 125    |
| `dist/bundledSkills.js`    | 22.9   | 22.9                 | 22.9  | 50     |
| `dist/codeIntel.js`        | 76.9   | 54.6                 | 54.6  | 100    |
| `dist/voice.js`            | 34.7   | 34.7                 | 34.7  | 50     |
| `dist/webFetch.js`         | (none) | (none)               | 46.7  | 75     |
| `dist/museCodeReviewer.js` | 42.7   | 16.9                 | 16.9  | 75     |
| `dist/uiText.js`           | 104.9  | 104.9                | 105.0 | 125    |
| `dist/searchWorker.js`     | 18.1   | 18.1                 | 18.1  | 50     |
| `dist/pageWorker.js`       | 203.2  | 203.2                | 203.2 | 300    |
| `dist/webview/main.js`     | 860.2  | 860.2                | 860.6 | 900    |
| `dist/acp.js`              | 800.9  | 786.4                | 786.5 | 850    |

- `dist/extension.js` is 565,850 bytes: 38.0 KiB smaller, 47.4 KiB under
  the budget, 12.4 KiB under the 565 KiB target. `src/shared/constants.ts`
  is 26.3 KiB of it (`MODEL_TEXT` 65 keys).
- The English table and the webview grew 0.1 KiB for
  `webFetchUnavailable`; the webview's other 0.3 KiB is main's
  `c5fc9b22`, merged after the "before" build.

### Red drills

Each guard was broken on purpose in the working tree, the check that
should catch it was run, and every file was put back byte for byte with its
SHA-256 checked (scratchpad `diet2/drills.mjs`, `drills-extra.mjs`,
`drills.jsonl`, `drill-<id>.log`). The tree's `git diff` hash was the same
before and after each set. Gate drills: production build, metafile paths
normalized, then the size check and the split check (the exit code is the
split check's).

| #   | Broken on purpose                                                                                                        | Exit | What caught it                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | P2-1: the `ide` tools (activation) read `REVIEW_MODEL_TEXT.reviewMethod`                                                 | 1    | split: `dist/extension.js carries REVIEW_MODEL_TEXT` (both sentinels); the size check passed at 579.5 KiB                                                                         |
| R2  | P2-2: `core/review/reviewPrompt.ts` (`dist/review.js`) reads `MODEL_API_MODEL_TEXT.goalNoActive`                         | 1    | split: `dist/review.js carries MODEL_API_MODEL_TEXT` (3 sentinels); the size check also failed, 55.8 of 50 KiB                                                                    |
| R3  | P2-1: `constants.ts` declares `SCRATCH_MODEL_TEXT` with no guard entry                                                   | 1    | split: `declares SCRATCH_MODEL_TEXT, which scripts/check-bundle-split.mjs does not guard`                                                                                         |
| R4  | P3-1: `codeIntelNoTarget` moves to `FILE_REFUSAL_MODEL_TEXT`, its reader re-pointed                                      | 1    | split: `FILE_REFUSAL_MODEL_TEXT holds …, codeIntelNoTarget, not …`; nothing else would have (activation 575.8 KiB)                                                                |
| R5  | P3-2: `core/codeIntel/rename.ts` reads `MODEL_TEXT.fileNotText` (a key activation reads too)                             | 1    | `codeIntelBundle.test.ts`: "carries no key and none of the words of MODEL_TEXT" (first: `bundledSkillRoot`; now `shippedTextCases`)                                               |
| R5g | The same break as R5, through the build gate                                                                             | 0    | nothing: `dist/codeIntel.js` 66.7 KiB, under its 100; the test is what catches it                                                                                                 |
| W1  | `extension.ts` builds the fetcher statically again (`createWebFetcher`)                                                  | 1    | split: `dist/extension.js carries` `webFetcher.ts`, `pinnedRequest.ts`, `webFetch.ts`, `fetchFailure.ts`, … `which loads only on the first web fetch`, and `WEB_FETCH_MODEL_TEXT` |
| W2  | `core/web/webFetch.ts` reads `MODEL_TEXT.webFetchDeclined`                                                               | 1    | `webFetchBundle.test.ts`: "carries its own model text and no key and none of the words of MODEL_TEXT"                                                                             |
| W3  | `lazyWebFetcher` asks for the bundle when it is created                                                                  | 1    | "loads nothing until the first fetch"; "fails each fetch with the reason…"                                                                                                        |
| W4  | A fetch whose bundle cannot load fails with a network failure's words                                                    | 1    | "fails each fetch with the reason, logs the cause, and tries again on the next one"                                                                                               |
| W5  | `fetchWebPageWith` no longer installs the activation bundle's table                                                      | 1    | "says why in the table the activation bundle installed"                                                                                                                           |
| W6  | `isWebFetchBundle` accepts anything                                                                                      | 1    | "accepts a module that exports the check and the fetch, and nothing else"; the loader's "refuses another module at the path…"                                                     |
| W7  | Muse Code's `webFetch` checks URLs statically again (`checkPageUrl` imported, `deps.checkUrl` ignored), gate, then tests | 1    | split: `dist/extension.js carries` `fetchFailure.ts` and `pageUrl.ts`; `ideWebFetch.test.ts`: "asks nothing and fetches nothing while the checks cannot be loaded"                |

### Gates

| Check                                                                              | Result                                                                                    |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Full unit suite, Kubuntu rig (`rig-test.sh kubuntu … diet`, snapshot `22becb7b`)   | 343 files passed and 4 skipped (347); 6929 tests passed and 56 skipped (6985); 68.1 s     |
| `npm run build`, Kubuntu rig (real install, the same snapshot)                     | exit 0: every budget, the split check, host-globals for 15 bundles, notices (83 packages) |
| `npm run build`'s checks on the host (metafile paths normalized, see below)        | all ok, the same figures                                                                  |
| `tsc --noEmit` for `.`, `test/unit`, `src/webview`, `test/e2e`, `test/integration` | exit 0 (each)                                                                             |
| `eslint --max-warnings=0` and `prettier --check` on every file changed from main   | exit 0                                                                                    |
| `npx knip`, `npm run duplication`, `npm run cycles`                                | exit 0, 0 clones, no circular dependency                                                  |
| `node scripts/check-l10n.mjs`, `node scripts/check-host-api.mjs`                   | 14 tables, 0 problems; 271 APIs, 18 files importing `vscode`, 0 problems                  |

The first Kubuntu run (snapshot `262a977a`, before `fc773b73`) failed one
test of 6985: `execSchema.test.ts` counts the `EXEC_*` constants, and the
merge's `EXEC_MODEL_TEXT` is one more. The test now counts it and reads the
frame from it.

This worktree's `node_modules` is a junction into another worktree's
install, so locally the split check's prefix checks see
`../<worktree>/node_modules/…` paths and `npm run build` stops there; the
host runs the checks after rewriting those paths (`diet2/unjunction.mjs`).
The Kubuntu build, from a real install, needed no rewrite.
`deferredBundles.test.ts` fails on the host for the same reason and passes
on the rig. During the lane `muse-extension-m70`'s install was emptied
(PR #69 had merged), so the junction (only the junction) was replaced by
one into `mx-relfast`, whose lockfile is this branch's; the host gates
above ran on it.
