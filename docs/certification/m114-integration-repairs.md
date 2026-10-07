# M114 independent integration-review repairs — FIXM114I

Rig: win11. Worktree: `C:/lanes/FIXM114I`, branch `m114/w-fix`.
Review/base: RVM114W, `2bd9e0f095bd5f32154cca3942b3ac58894c38cc`
(the supplied Kubuntu integration snapshot; its remote ref is not present on
this rig). No paid/live calls, dependencies, cap changes or suppressed gates.

| Finding                                                                   | Repair and regression                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 static CI replays missing historical source and exceeds its deadline | Static checks retain token checks; required visual shards alone replay pixels, with full history, explicit recorded-revision fetch and the existing required receipt merge. `manifest.test.ts` and `visualGate.test.mjs` assert the route.                                                                                                                                                                                                                                                                                                                       |
| P2-2 Open Questions focus                                                 | All three actual OpenQuestionsChip buttons carry `chat-control`. `m114Conversation.test.mjs` renders them at 320 px in six themes and checks 2 px / 2 px rings with at least 3:1 contrast.                                                                                                                                                                                                                                                                                                                                                                       |
| P2-3 stale renderer inventories                                           | The matrix and current audit cover all 73 renderers and 112 supporting files, including nine new inputs and removal of ApprovalDock. Historical grades name their immutable audit revision. Actual capture mappings include the question provider/dock/chip, Help and three lazy content renderers. `m114Audit`/`visualMatrix` enforce exact source inventory and hashes; `visualGate` rejects a manifest inventory missing a current renderer; `visualCapture` requires actual question/Help renders. Integrated PNG recapture is the lead-owned handoff below. |
| P2-4 historical receipts hashed against today's code                      | P1 binds to 55e2ab9ed; P2 binds to 871597b49; both use lane A's immutable 58ed2fc1d inventory. A single batched Git read verifies every recorded source blob. P2's later hash-only CSS edit is undone to recover its actual capture provenance. Source/image hashes otherwise stay unchanged. Unit CI fetches history so shallow checkout cannot hide those sources. `m114Conversation`, `m114PanelEvidence` and `m114Audit` preserve the historical records.                                                                                                    |
| P2-5 lazy menu dismissed by secret modal                                  | The actual lazy GooeyMenu and SecretPromptDialog mount in independent fixture scenarios; the panel waits for its real pill before transferring focus. `m114Panel` checks both focus owners and all original menu states. The History assertion also waits for the fake host's asynchronous postMessage/React commit instead of reading it immediately.                                                                                                                                                                                                           |
| P2-6 companion closure 59 bytes over cap                                  | Derive theme class names from the existing mode map rather than repeating strings. Actual browser behavior and separate JS/CSS budgets remain checked by `themeBridgeBrowser`; lazy JS is 25,594 / 25,600 bytes.                                                                                                                                                                                                                                                                                                                                                 |
| P3 font usage in English                                                  | The invalid font command's reason is a getter read after main installs the language. `fontCli` parses three invalid argument shapes before French installation, then checks the French usage and rejects English. No new string or runtime command.                                                                                                                                                                                                                                                                                                              |

All source changes for these repairs are below the shared rule's 300-line
implementation bound per finding; the larger JSON diff is the required
renderer/source inventory data, rather than new runtime machinery.

## Failing-base controls

Initial runs were on the unmodified integration base, with repository
timeouts and at most three files/workers. Logs remain in ignored
`temp/fixm114i/`:

- `base-inventory.log`: m114Audit and visualMatrix inventory controls failed;
  manifest passed. 48 passed, two failed.
- `base-controls.log`: the new CI routing and font-language assertions and six
  actual Open Questions keyboard checks failed, alongside the historical
  current-source assertion. 58 passed, 12 failed.
- `base-panel.log`: 25 menu-state failures, historical P2 source failure and
  25,659-byte closure failure. 60 passed, 27 failed.
- `base-manifest-guard.log`: a new current renderer can be omitted without
  error before the inventory guard; one failed, 11 passed.

These failures exercise each finding before its repair. No timeout was raised
and no test or coverage threshold was removed. The historical hash tests still
verify exact bytes, now from their proper immutable source revisions.

## Integrated PNG handoff

On Chrome 150, `visualCapture` and `visualStability` fail in
`rasterizationFingerprint` with `Page.captureScreenshot: Unable to capture
screenshot`, before scene rendering. The same driver fails alone. A separate
probe reproduced refusal for a 128 px viewport with both ordinary and
persistent contexts. Normal panel screenshots work. Two attempted remedies
(normal viewport plus the original crop; normal viewport plus full-height
probe) failed in the complete driver and were reverted to HEAD byte-exact.
The shared stop-after-two-fixes rule ends this browser path. No claimed golden
or screenshot hash was generated, and the old golden remains intentionally
incompatible with the complete current inventory.

Lead-owned commands on a functioning rendering rig, after committing inputs:

```sh
npm run build
npm run check:visual -- --update --review=RVM114W-FIXM114I-integrated --archive=<new-outside-repository-directory>
npm run check:visual
npm run check:visual:a11y
npx vitest run test/unit/visualCapture.test.mjs test/unit/visualStability.test.mjs --maxWorkers=3
npm run quality
```

Review the complete new captures before committing the manifest. The six CI
shards use the new recorded revision and required receipt merge unchanged.
Full quality, integrated PNG certification and hosted CI are not claimed here.

## Fresh-clone CI verification

Pending the committed-source clone and final receipts; this section will be
completed with exact owning-suite repetitions and static gate results.
