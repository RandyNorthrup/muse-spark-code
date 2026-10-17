# MODELSPLIT — Models panel deferred sections

MODELSPLIT4, 2026-10-11, kubuntu, fixes RVMODELSPLIT3 findings 1–4.
The previous reserve and marker-only loading claims are withdrawn: neither
prevented collapse, and measuring only after commit did not certify loading.
This round follows the owner's redesign: preserve the visible document during
navigation and document one first section paint. No dependency, cap, timeout,
wire contract, credential or paid dispatch changes.

## Loading contract and measurements

- The entry starts the default Providers import when it evaluates. The
  registry's shared navigation paints the identical shell during entry/body
  loading and in the live panel. A document with no saved height announces
  connecting/loading accessibly, keeping that shell invisible until the first
  host state supplies its row count; the first visible section paint is its
  estimated skeleton. A saved height is visible immediately, before the body
  or host reply. Missing, malformed, zero-height or refused native storage cannot crash or collapse it.
- Local, wizard and host navigation use React transitions around one stable
  Suspense boundary. The old section stays mounted and visible while the next
  chunk loads. The requested tab announces loading and changes its token colour
  after 150 ms. A failed chunk says so with Retry, preserves the current box,
  and permits another section; Retry reloads the document.
- `SectionFrame` contains margins; the navigation's previous margin moves into
  that measured box, preserving settled pixels. Resize and DOM observers save
  the actual section height through `HostBridge.savedState/saveState`
  (`getState/setState` in VS Code), in a zod-validated snapshot. DOM observation
  matters: money text can settle without changing a labelled row's height.
  Skeletons and incomplete money renders are never persisted as settled boxes.
- On the default light, 690 px, two-provider fixture, the first-ever skeleton
  panel is **690 × 455 px**; settled Providers is **690 × 620.90625 px**.
  **The first-ever paint can adjust once by 165.90625 px in this fixture.**
  Later identical-state loads use the measured slot, **561.90625 px**, and the
  complete panel stays **690 × 620.90625 px** before/during/after the held
  Providers reload. Navigation with Models held keeps that same panel box;
  the browser samples every frame until Models commits and requires visible
  Providers with identical bounds. The reverse navigation separately holds
  the Providers preload and samples the retained **690 × 760.34375 px** Models box throughout
  that hold. New sections can have a
  different natural height when they commit; there is no intervening collapse.
- Shared React and `HostBridge` carry the behavior to native editor adapters;
  no VS Code-specific logic or new editor API is added. ACP/headless have no
  Models panel and retain their existing provider commands.

## Findings, regression guards and red drills

Every mutation ran a complete owning file at repository-default deadlines,
`npx vitest run <file> --maxWorkers=3`, then restored the bytes it started
from. No timeout override or filtered test was used. Each SHA-256 below is
the file as it stood when its drill ran, the same before and after the
restoration; subsequent complete files pass. The drills ran across this
round's work, so a value recorded before a later edit of the same file is
not the committed file (review RVMODELSPLIT4). The committed files at
`b92fab054` are:

| File                   | SHA-256 at `b92fab054`                                             | Rows below that carry this value |
| ---------------------- | ------------------------------------------------------------------ | -------------------------------- |
| `panel.tsx`            | `a8253182668158ce0af9cedb1cda1718d4ca51d011d19c1853c6a46d17916a56` | none                             |
| `DeferredSections.tsx` | `6de406c31b5b503dd0bddde6f676bc3bf0389090cd10c658de4226453fa4a64c` | the invalid-height guard         |
| `m114-audit.json`      | `0a2767bc95c0c84e048d6c9b1946eca545f5d823a50a0540c1cb63ae296eb2f2` | none                             |
| `ProvidersSection.tsx` | `469df363b8535ac537177e37e78a7c60a21e5ea5f2e607b3cbd83d688c40e355` | finding 4, money readiness       |
| `capture.mjs`          | `98f69953a7e98d21189cd3c3c4ff73f83b99cd668aa677dc504c86d9ac466960` | the counted-actions guard        |

The first drill's count also belongs to the suite of its moment. On the
committed suite, removing the local transition fails three tests and passes
seven: both held-navigation tests, and `keeps a failed section from feeding
its own larger box into the reserve` (review RVMODELSPLIT4, an in-memory
transform with no file written). The guards fail closed on the committed
bytes. The merge into the release train changed `ProvidersSection.tsx` (the
usage amount takes the exact-money type) and refreshed `m114-audit.json`, so
neither has either hash there. The train's wizard states its budget in an
exact text field (M121) and renders no budget suggestion card, so finding 4's
marker for budget suggestions has nothing to mark there; `Wizard.tsx` and
`SuggestionCard.tsx` are the train's.

| Finding                              | Fix and named regression                                                                                                                                                        | Deliberate break and observed failure                                                                                                    | Restored SHA-256                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1: loading collapse                  | Stable `SectionFrame`, transitions, remembered skeleton; `keeps Providers visible throughout a held Models transition and announces its pending tab` and reverse Providers hold | Remove the local transition: both held-navigation tests fail (2 failed, 6 passed when it ran; 3 failed, 7 passed on the committed suite) | `632473f4851c73eeddd9d77b31dbc3fcd9b2c44877989dfc7d710f90256df378` (`panel.tsx`)            |
| 1: reload first paint                | `uses the saved measured height while Providers is held on reload`; settled-box persistence and refused-storage guards                                                          | Ignore saved height: the remembered-height test fails (1 failed, 7 passed)                                                               | `6abce44c0d7a410f2b253d73b07aa3763345e5bceb14bd99e03d3ab13293ad79` (`DeferredSections.tsx`) |
| 2: ineffective identity test         | Real `ModelsApp` receives validated changed host state; changed provider label, scan status and `$1.20` must arrive before identity is checked                                  | Key the section by provider label: updated content arrives but identity fails (1 failed, 7 passed)                                       | `632473f4851c73eeddd9d77b31dbc3fcd9b2c44877989dfc7d710f90256df378` (`panel.tsx`)            |
| 3: absent filtered baseline          | `includes reviewed filtered Models frames for the entire visual matrix` requires the audit scene and every theme/width/state key                                                | Remove the audit scene: the new guard and existing complete-matrix guard fail (2 failed, 11 passed)                                      | `89839edb30c09931e287aba513be7a59acfba1b1c61b0050f26fc17c5ecfa858` (`m114-audit.json`)      |
| 4: missing money readiness           | Mark usage amounts, model rates, test disclosures and budget suggestions; `marks every key usage amount until the held money chunk has formatted it`                            | Remove usage deferred markers: the amount-readiness test fails (1 failed, 5 passed)                                                      | `469df363b8535ac537177e37e78a7c60a21e5ea5f2e607b3cbd83d688c40e355` (`ProvidersSection.tsx`) |
| 4: waiter returns with requests open | Always drain tracked requests; `waits for an outstanding lazy chunk even without a loading marker`                                                                              | Remove the unconditional drains: the no-marker held-request guard fails (1 failed, 3 passed)                                             | `b647632b83f3358460fe578ff40d6562146dd44aae8663eb38641b1261204436` (`capture.mjs`)          |

Additional guards found while exercising the whole loading class:

| Guard                                                                     | Deliberate break and observed failure                                                        | Restored SHA-256                                                                            |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `keeps a failed section from feeding its own larger box into the reserve` | Permit measuring the error screen: 1 failed, 8 passed; its larger box overwrites the reserve | `cbc0e0fae1465332a79fbebbaf167c429ce87711196f777b9643f6fc9e8ed90f` (`DeferredSections.tsx`) |
| `ignores an invalid remembered height of 0`                               | Accept zero in the schema: 1 failed, 9 passed; the skeleton collapses                        | `6de406c31b5b503dd0bddde6f676bc3bf0389090cd10c658de4226453fa4a64c` (`DeferredSections.tsx`) |
| `finishes counted scene actions after a lazy renderer commits`            | Stop checking counted actions: 1 failed, 4 passed; the expected provider search is absent    | `98f69953a7e98d21189cd3c3c4ff73f83b99cd668aa677dc504c86d9ac466960` (`capture.mjs`)          |

The failure reserve contains child margins and never measures its own error
screen, avoiding ResizeObserver feedback growth. Chunk-abort browser checks
verify the complete box stays reserved and Retry works through a real click.

The money browser case holds the actual production chunk, invokes the actual
capture waiter and requires it to remain pending; release must produce
`$1.20`, `$3.40`, `$10.00`, `$6.60`. All Models money readers were swept;
failed loads clear their loading markers and retain the existing honest Retry.
The Models harness exposes its counted pending actions to the waiter, so a
late Providers commit cannot be captured before the provider-search action
finishes. Schedule browser fixtures likewise wait for the ready handshake and
real surface before acting, instead of racing a lazy placeholder.

## Reviewed visual coverage

Review: **MODELSPLIT4-filtered-table-2026-10-11**. The existing capture,
`saveCapture`, byte verification and `validateManifest` APIs reconstructed
source **6636c84beb804af52e49363ac10ede3223d3d295** and rendered the missing
`models-table-filtered` scene. Its **72 frames / 2,334,546 bytes** were inspected
in twelve six-frame contact sheets: six themes
(light, dark, both high contrast, One Dark Pro, Dracula), two widths
(320/690), six interaction states. The `qwen` search consistently shows one
of five models, selected Tool calling, the local model/context, responsive
cards/table and the expected hover/focus/pressed/disabled/selected treatment.
No empty paid amounts were accepted. Existing baseline pixel hashes and bytes
are unchanged; only these inspected frames were added. DeferredSections was
also missing from the inherited renderer inventory: it and the new shared
registry navigation (`SectionNavigation.tsx`) are now registered, with the
held-chunk checks covering their loading interval. The existing renderer
inventory test rejected a temporary `.ts` renderer registration; extracting
the component into `.tsx` fixed the structure without changing the guard.
The existing Providers frame metadata includes both shared renderers, without
changing any pixel baseline.

The manifest now has **13 Models-named scenes / 936 frames**: twelve Models
panel scenes (including the filtered table), plus the existing chat model
picker. It has **9,864 frames / 449,283,997 bytes** overall, below 512 MiB. The
archive is `/var/tmp/l-MODELSPLIT/models-split-reviewed-filtered`; full PNGs
remain outside git. Scratch source reconstructions were removed. The recorded
source revision permits reconstruction on other rigs, including Windows.

## Verification receipts

All commands ran directly on kubuntu, at repository-default test deadlines,
with at most three Vitest files per run and `--maxWorkers=3`.

- Nine deliberate red drills: expected named failures and byte-exact restore.
  The final restored layout/readiness/audit run passes all 22 tests.
- **173 distinct unit tests pass** across fourteen complete owning files:
  layout 10, money lifecycle 6, app 2, bundle size 64, section registry 3,
  panel sections 19, panel schemas 12, panel host 9, provider seam 8,
  panel entry 6, visual readiness 5, visual gate 13, visual matrix 9,
  current/historical audit 7.
- `node test/e2e/startupMoney.mjs`: **12/12 pass**, including frame-by-frame
  holds in both navigation directions, remembered reload, both chunk failures
  and real Retry clicks, held money capture, chat/palette money failures,
  cost failure/hold, wizard cancellation and both schedule lifecycle cases.
- `npm run check:visual -- --shard=5/157`: **66 panel frames pass, zero changed
  pixels**. The existing capture/manifest/image-verification/pixel-comparison
  APIs also compare **all 864 panel frames** (twelve scenes × six themes × two
  widths × six states): **3 changed pixels total, at most 1 per image** under
  the unchanged 12-pixel/ratio/antialiasing policy. Every usage amount is
  nonempty. These receipts cover the Models panel; they do not claim a full
  9,864-frame replay or an isolated chat model-picker comparison.
- Production build and all bundle guards pass unchanged: startup **350,023 B /
  341.8 KiB** (cap 500 KiB), body **38,943 B / 38.0 KiB** (cap 75 KiB),
  Providers **28,399 B / 27.7 KiB** (cap 31 KiB), Models **12,053 B / 11.8 KiB**
  (cap 13 KiB). No dependency or budget change.
- All five typecheck projects, changed-file ESLint/Stylelint/Prettier,
  dead-code, cycles and duplication checks, and token/localization/reference/host-API/
  plan/roadmap gates pass. React review checks confirm stable component types,
  transition ownership, effect/observer cleanup, optional validated persistence,
  render-time localization, accessible pending/failure/retry states and lazy
  boundaries. No install was needed.

Aggregate `npm run quality` remains lead-owned under the explicit rig/common
brief; this lane runs scoped gates directly and commits with installed hooks.
No merge, push, rebase, paid/live model call, subagent or hook change occurred.

## Retained earlier budget proofs

The original section split and both empty-group `MISS` guards remain intact.
The existing 64-test bundle-size file covers both 31/13 KiB section caps,
missing chunks, sections compiled into the body, exact-cap passes and one-byte
overflow failures. Earlier byte-exact MISS and static-import drills are retained
in commits `b9a91e7a6` and `a2b681712`; the invalid reserve/marker-only layout
claims in `2fd9b58cd` and `069eedf1b` are superseded by this record.

## The providers section row on the release train (2026-10-11)

The lane measured its caps on 0.17.0. On the release train the providers
section's closure is larger, because the train's wizard carries 0.17.1's
repairs and exact money (M121): **32,197 B** at the merge of `b92fab054` onto
`acf388a14` (macbook rig, production build), 453 B over the lane's 31 KiB.

| Input (bytes in the section's chunks) |  Bytes |
| ------------------------------------- | -----: |
| `Wizard.tsx`                          | 15,397 |
| `ProvidersSection.tsx`                |  9,553 |
| `components/SearchableSelect.tsx`     |  2,292 |
| `components/ScanStatus.tsx`           |  1,371 |
| `components/CostNotice.tsx`           |    820 |
| `components/SuggestionCard.tsx`       |    650 |
| `components/KeyState.tsx`             |    434 |
| `components/UndoBar.tsx`              |    406 |
| keybindings (`models.select`)         |    323 |
| `components/InlineError.tsx`          |    269 |
| `listNavigation.ts`                   |    142 |

Both section rows are new with this split and exist nowhere else, so the
lead set the providers row where it first lands, by the precedent for a new
chunk: the bytes measured on the landing tree plus 15 percent, rounded up to
a whole KiB. 32,197 × 1.15 = 37,026.6 B = 36.16 KiB, so the row is **37
KiB** (`MODELS_DEFERRED_BUDGETS` in `scripts/lib/webviewBundles.mjs`). No
existing row changed. The models section measured 12,074 B on the train and
keeps 13 KiB; the panel body went from 69.0 KiB to 28.4 KiB of its 75.
`test/unit/bundleSize.test.mjs` pins 37 and 13, their exact-cap passes and
their one-byte overflows, in place of the 31/13 named above.

The row tightens when the wizard, which opens on demand, moves out of the
section chunk (planned separately).
