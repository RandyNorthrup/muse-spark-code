# FIX78W — M71 webview budget repair

Bounded verification on Kubuntu, 2026-10-04 (local time), from branch
`feature/m71-git-prs`, parent `4057fab1`. The brief and shared common rules
reserve full quality, native editor/hosted certification and publication
for the lead. All commands run directly in this worktree; there are no
live or paid calls. Exact bounded receipts, source hashes, production bytes
and negative controls are in [fix78w-verification.json](fix78w-verification.json).

## Attribution and repair

Production esbuild metafiles from this branch and an archived `main-sync`
`244d5905` built inside this worktree with the same installed dependencies
show a 25,447-byte M71 increase. Normalize the archived build's symlinked
`node_modules` paths before comparing contributors. The largest additions
are the English table (10,467 bytes), Git panel (8,955), Git state reducer
(1,668), App wiring (1,324), shared Git schemas (1,052), palette (710),
UI reducer (683) and protocol (442). Other differences are below 100 bytes.

The browser was a single IIFE in this checkout. React `lazy` and `Suspense`
now load Git only when it has state to show and Account & usage when opened.
Git alone leaves the ESM startup graph at 907.4 KiB, so the second dialog is
needed to recover the overflow. Both panels use the shared React runtime
and mutable installed-language table; the reducer continues receiving
messages while code loads. The loading Account modal keeps Close, Escape,
focus trapping and the background's inert state.

esbuild emits browser ESM chunks. Both the extension document and harness
load the entry as a module; the document's nonce-only CSP is retained.
The VSIX allow-list includes generated chunks, and build startup removes
old hashed chunks. The size gate counts the complete static import graph
once, using actual file sizes; its 900 KiB cap is unchanged. The split
gate refuses either panel in that graph, and identifies the shared browser
constants by their metafile source to retain all model-text restrictions.
Notices include every emitted chunk.

| Browser artifact                                 |   Bytes |   KiB |
| ------------------------------------------------ | ------: | ----: |
| `main-sync`, before the repair                   | 909,415 | 888.1 |
| M71, before the repair                           | 934,862 | 913.0 |
| Repaired entry                                   | 716,118 | 699.3 |
| Repaired entry and all static JavaScript imports | 919,959 | 898.4 |
| Deferred Git panel                               |   8,950 |   8.7 |
| Deferred Account & usage                         |  11,076 |  10.8 |
| All emitted browser JavaScript                   | 939,985 | 917.9 |

The cap covers startup, including both shared chunks. Total emitted
JavaScript grows by 5,123 bytes for module boundaries and deferred loading;
the reduction is in the initial payload. The rig's initial size differs
from MRG78's Windows receipt (913.5 KiB); the comparison above uses fresh
builds on one machine, Node 24.18.0 and the pinned esbuild 0.28.2.

## Verification

- Five TypeScript projects pass `npm run typecheck` on the final source.
- Scoped ESLint (`--max-warnings=0`) and Prettier pass. `.vscodeignore` has
  no Prettier parser and is checked by the real package-membership test.
- Localization: 14 tables, 122 manifest strings, 455 source files, zero
  problems. No language-table key changes are required.
- Host API: 286 VS Code APIs, 22 importing files, 23 Node built-ins and
  57 theme variables; zero problems. The checked inventory needs no change.
- Knip passes; jscpd finds zero clones. Cycles pass.
- Production `npm run build` passes size, split, host-global and notices
  checks. Every Node bundle remains inside its existing cap.
- M71, M83 and UI owners: 45 whole files, 1,656 passed tests, zero failures,
  one existing skip for a genuine Windows short-name workspace. Each
  invocation has at most three files, `--maxWorkers=3 --testTimeout=120000`.
- The new production-bundle suite adds ten passing tests: 46 distinct files
  and 1,666 passing cases in total. It runs the real build and VSIX member
  listing, tests the static-graph accounting and missing-file refusal, and
  confirms one React, English fallback and installed-language state copy.
- Production Chrome with the same nonce-only CSP: English and German
  request neither deferred panel on startup, retain a draft received while
  Git's chunk is held, submit the edited draft, close Account during loading
  and reopen it after loading. Zero CSP violations and page errors. A 404
  Git chunk reaches the existing crash boundary and Reload host action.
- Accessibility: `node scripts/a11y.mjs git-held git-commit git-pr
git-pr-narrow usage usage-api usage-install usage-install-narrow palette
palette-tips slash-commands slash-tips review-pane` passes 52 pages
  (13 scenarios × four themes), zero violations, undecided failures,
  exemptions or missing results. Axe cannot measure 496 elements hidden
  under open menus/dialogs or outside the scroll view; the stock gate
  reports that limitation.

The initial App helper held a detached loading-dialog element after
Suspense replaced it. It now queries the current dialog while waiting;
the full App file passes. This was a test readiness correction, not a
timeout or gate adjustment.

## Negative controls

Every control below exits 1, then the altered source or generated file is
restored byte-exact by SHA-256. Restored production build, split checks,
and complete drill-owning test files pass.

| Mutation                                                                | Failure observed                                               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| Restore browser IIFE output                                             | Startup cap and both deferred-owner tests fail                 |
| Import Git eagerly                                                      | Startup cap, Git owner test and split gate fail                |
| Import Account eagerly                                                  | Startup cap, Account owner test and split gate fail            |
| Count only the entry in the size gate                                   | Static accounting, overflow and missing-static-file tests fail |
| Remove chunk VSIX inclusion                                             | Real package member comparison fails                           |
| Retain stale hashed chunks                                              | Real package member comparison fails on a seeded stale file    |
| Remove the module script type                                           | HTML/nonce reference test fails                                |
| Remove review-text sentinel from the browser reader                     | Model-text split gate fails                                    |
| Drop the deferred Git commit callback                                   | New delayed-panel behavior test fails                          |
| Remove browser constants source ownership                               | Unique-owner and model-text reader checks fail                 |
| Attribute the shared runtime sources to a second output in the metafile | All three source-sharing assertions fail                       |

## Integration boundary

`main-sync` remains `244d5905` and is already an ancestor of this branch;
no new merge is needed. Commits use explicit staged paths with the configured
Husky/lint-staged/gitleaks hook enabled. Full `npm run quality`, publication
and native/editor hosted certification stay with the lead as required by
the lane brief; this record establishes the bounded checks listed above.
