# TRAINACT release-train activation repair

Rig: macmini, 2026-10-11. Base: `d36f5fa2d4`; branch:
`fix/train-activation`. No subagents, network/model calls, installs, merge,
push, cap, baseline, allow-list or localization changes. Aggregate quality
belongs to the lead under the explicit rig/common brief; PLAN §7 records
that scope. AGENTS rule 10 requires an Unreleased engineering note despite
no user-visible change. No new chunk.

## First cut: automatic-compaction admission

Move the admission constructor and model reader to `modelApiEntry.ts`,
behind existing `dist/modelApi.js`, instead of retaining the admission in
activation with two injected helpers. This removes the full admission and
its cost-model dependency from both manager callers. `modelPolicy` supplies
image counting in the backend; the first prepared attempt loads existing
`dist/providers.js` for exact price-card reservation. A missing pricing port
refuses before consent; absent/failed pricing refuses before reservation.
Authorization is checked again after the new async load.

| Step                       | Baseline | Current | Growth before | Growth after |
| -------------------------- | -------: | ------: | ------------: | -----------: |
| Train base                 |  561,352 | 571,429 |             — |       10,077 |
| Admission behind Model API |  561,352 | 566,730 |        10,077 |        5,378 |

Production build passes all size rows, split, host globals and notices.
The first cut leaves the unchanged budget test at 5,378; the second cut
below closes that remaining regression.
Owning suites: admission/manager 50 passed; modelApiAutoCompact,
runtimeAccounting, autoCompactionBundle 79 passed at repository timeouts.
Host typecheck and changed-file ESLint pass.

### Red drills

1. Remove the missing-port early refusal: the new regression
   `refuses a missing pricing dependency before consent or reservation`
   fails (an admission object is returned), with 24 other tests passing.
   Restore SHA-256
   `7edcddff6bfaa3fb4dbd40ef884c18f39d191e22cc43b4b5752d05e190b828c3`.
2. Put the admission's two imports and calls back to direct value imports;
   run the actual production build and split checker. Exact failure and
   byte-exact restoration receipt follow below.

   ```text
   bundle split: 2 problem(s); see PLAN.md D6 and M57
     dist/modelApi.js carries src/core/providers/priceCard.ts, which loads only in dist/providers.js
     dist/modelApi.js carries src/core/providers/priceCard.ts, which loads only in dist/providers.js
   ```

   Restored the same admission SHA-256 as drill 1 byte for byte.

## Second cut: paid-use question formatting

Move the whole formatter to `src/core/paid/paidUseQuestion.ts`, exported by
existing `dist/foreignHooks.js`. `paidConsent.ts` keeps its original async API,
loads that runtime on the first question, and installs the caller's table and
locale before formatting. No wording or consent state changes. The initial
placement in `dist/hookRuntime.js` measured 50.9 KiB against its unchanged
50 KiB cap; select the existing imported-hook runtime (80.5 KiB under its
100 KiB cap) instead. No new chunk or gate configuration change.

| Step                                           | Baseline | Current | Growth before | Growth after |
| ---------------------------------------------- | -------: | ------: | ------------: | -----------: |
| Formatter in hook runtime (rejected chunk cap) |  561,352 | 563,928 |         5,378 |        2,576 |
| Formatter in imported-hook runtime             |  561,352 | 563,929 |         2,576 |        2,577 |

Final activation growth is **2,577 bytes**, with **495 bytes** of room below
3,072 (required room: 150). Git/MCP launch and tool-I/O boundaries need no
changes. Production build passes all 155 size rows and the actual split
checker; its activation row reads:

```text
ok   dist/extension.js: 2 of the backend's 92 files (4.5 KiB), all on the allowed list
ok   dist/modelApi.js: carries the 42 files that load only with the backend, and no English table
ok   dist/providers.js: codecs and provider core load exclusively there
```

| Production artifact     | Exact bytes | Unchanged cap (bytes) |
| ----------------------- | ----------: | --------------------: |
| `dist/extension.js`     |     563,929 |               614,400 |
| `dist/runtimeEngine.js` |     642,596 |               896,000 |
| `dist/headless.js`      |      98,360 |               102,400 |
| `dist/modelApi.js`      |     530,683 |               537,600 |
| `dist/providers.js`     |     142,366 |               153,600 |
| `dist/hookRuntime.js`   |      44,717 |                51,200 |
| `dist/foreignHooks.js`  |      85,433 |               102,400 |

Admission API changes for C-M101-2/C-M101-3a's frozen evaluation parent:

- New exported `AutoCompactionPricing` port, with
  `reserveRequestAmount: typeof reserveRequestAmount` and
  `requestImageCount: typeof requestImageCount` (type-only imports).
- `AutoCompactionAdmissionDeps` adds optional
  `loadPricing?: () => Promise<AutoCompactionPricing | undefined>`. Omission
  refuses admission. Evaluation fixtures must inject their real pricing
  functions and regenerate the parent source digest.
- `createAutoCompactionAdmission(deps): AdmitAutoCompaction` and
  `resolveAutoCompactModel(modelId): AutoCompactModel | undefined` retain
  their names and signatures. Ledger/claim exports are unchanged.
- Internal `ModelApiBundleDeps` adds optional `autoCompaction`, a typed pick
  of the existing manager's accounting, reserve, fence and daily-cap ports;
  the manager supplies it, and the backend constructs admission.

The added bundle regression uses no paid/live calls: its first question
rejects a missing chunk; after installing a test-only chunk it retries,
receiving the caller's language and table. Existing paidConsent plus budget
and bundle suites pass 40 cases. Admission/core/manager suites pass 78 cases,
including stopped or switched-off admission after a held pricing load with
no reservation. Final broader gate receipts follow below.

### Commit qualification

The first hooks-on commit `fcc925ff2` captured two tracked edits made while
its hook was still active, before the new formatter file was staged. The
following correction commit adds the file and selects the fitting existing
runtime. Integrate the complete range; the first commit alone is incomplete.
Re-read both the staged and committed diffs; make no edits while subsequent
commits run. No hook is modified or bypassed.

### Remaining red drills (all restored byte for byte)

3. Restore the original paid question formatter to activation while keeping
   admission lazy. The actual unchanged budget test fails:
   `Activation baseline=561352 current=566730 growth=5378`;
   `expected 5378 to be less than or equal to 3072`.
   Restore `paidConsent.ts` SHA-256
   `0c4a790e77c20af5c41baaf9be4d7d29f645fc0e691d02b828248bfa82c8fc6d`.
4. Remove the authorization/cancellation check after awaited pricing.
   Both new held-load cases fail: switched-off and stopped requests each
   reserve once instead of zero (25 other cases pass).
   Restore admission SHA-256
   `7edcddff6bfaa3fb4dbd40ef884c18f39d191e22cc43b4b5752d05e190b828c3`.
5. Remove the formatter runtime's installed-table handoff. The new first-use,
   missing-chunk/retry test rejects with a TypeError instead of returning the
   installed-language question. Restore `paidConsent.ts` to the same SHA-256
   as drill 3. Final owning suites run after all restorations.

## Backend ratchet and owning fixture completion

The complete `deferredBundles` suite retains a stricter Model API ratchet of
530,883 bytes. The first cut measured 532,953 (2,070 over that unchanged
ratchet). Load the admission factory from existing `dist/foreignHooks.js`
only on the first compaction; keep the small synchronous catalogue model
reader and its backend-side binding in `dist/modelApi.js`. The factory has
one source in `autoCompactionAdmission.ts`; the backend passes the same
ports after installing its language. New production size: **530,683 bytes**,
200 below the ratchet. Imported-hook runtime: **85,663 bytes**, below 102,400.
Activation stays **563,929 / growth 2,577**, with its 495-byte margin.

| Further step                          | Activation growth before | Activation growth after | Model API before | Model API after |
| ------------------------------------- | -----------------------: | ----------------------: | ---------------: | --------------: |
| Admission factory on first compaction |                    2,577 |                   2,577 |          532,953 |         530,683 |

The same suite's legal-scanner size drill used a stale private browser
metafile, missing `ProvidersSection.tsx` and `ModelsSection.tsx` after the
train merge. Its unchanged size checker reported:

```text
MISS dist/webview models providers section: deferred section chunk missing (budget 37 KiB)
MISS dist/webview models models section: deferred section chunk missing (budget 13 KiB)
```

Add those existing section entry points to that test-only metafile, like its
other fake browser outputs; actual browser sizes still come from production
and the owning bundle-size suite. No gate, cap, assertion or baseline changes.
The full deferredBundles/manager/budget rerun passes 143 cases at repository
deadlines. Both the backend ratchet and fixture repair have restored-source
red drills, recorded below. No implementation work beyond lazy wiring.

Final boundaries:

- `autoCompactionAdmission.ts`: model reader in Model API backend; admission
  factory in imported-hook runtime on first compaction; price-card functions
  remain in providers, injected at first attempt preparation. `modelPolicy.ts`
  stays in the backend and supplies image counting through that port.
- `modelApiBackendManager.ts`: passes the existing admission ports through
  `ModelApiBundleDeps`, with no admission value import at activation.
- `paidUseQuestion.ts`: the original whole question formatter, moved from
  `paidConsent.ts` to the same existing imported-hook runtime; the latter
  retains a small async shim. The formatter matches the original byte for
  byte except equivalent direct wiring to the existing lazy team factory.
- No git, tool-I/O, MCP launch or command moves; no new chunk. All language
  tables, size rows, immutable baseline and allow-lists retain their bytes.

### Final-cut and fixture drills

6. Put direct reservation/image helper imports back into admission on the
   final tree. The actual production split checker fails:

   ```text
   bundle split: 4 problem(s); see PLAN.md D6 and M57
     dist/modelApi.js carries src/core/providers/priceCard.ts, which loads only in dist/providers.js
     dist/foreignHooks.js carries src/core/providers/priceCard.ts, which loads only in dist/providers.js
     dist/foreignHooks.js carries src/core/providers/priceCard.ts, which loads only in dist/providers.js
     dist/modelApi.js carries src/core/providers/priceCard.ts, which loads only in dist/providers.js
   ```

   Restore admission SHA-256
   `7edcddff6bfaa3fb4dbd40ef884c18f39d191e22cc43b4b5752d05e190b828c3`.

7. Put the admission factory back in Model API. The unchanged backend
   ratchet fails at 532,953 against 530,883 (116 other cases pass).
   Restore `modelApiEntry.ts` SHA-256
   `24475654cd368bde04bd78f325923113b7fc6f698249621fecd7b914cc505f8e`.
8. Remove the two Models section entries from the private size-drill
   fixture. The legal-scanner cap drill's green replay fails with the two
   exact `MISS` lines above (116 other cases pass).
   Restore `deferredBundles.test.ts` SHA-256
   `b07bdcdd81c01aca99b033e0eac1a2a9a285ce281e87108a065939f4f6332353`.

Rebuild production after all restorations: exit 0; all 155 size rows,
split, host globals and third-party notices pass. Exact final sizes are in
the table above. The remaining complete owning suites and static gates run
on this restored tree.

## Complete suite receipts (macmini)

Every invocation uses `npx vitest run <files> --maxWorkers=3`, at most three
files, repository deadlines, no `--testTimeout`. All 33 owning files pass;
29 existing platform-dependent cases skip on macOS. There is no added skip,
assertion relaxation or test-timeout change. Some owning files repeat after
the deeper factory cut and restoration drills.

| Complete files                                                                         | Result                                                                |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| autoCompactionAdmission.test.ts, autoCompact.test.ts, modelApiBackendManager.test.ts   | Test Files 3 passed (3) / Tests 78 passed (78)                        |
| modelApiAutoCompact.test.ts, runtimeAccounting.test.ts, autoCompactionBundle.test.mjs  | Test Files 3 passed (3) / Tests 79 passed (79)                        |
| modelsActivationBudget.test.ts, paidConsent.test.ts, paidConsentBundle.test.mjs        | Test Files 3 passed (3) / Tests 40 passed (40)                        |
| toolIo.test.ts, modelApiHooks.test.ts, paidHost.test.ts                                | Test Files 3 passed (3) / Tests 111 passed, 2 skipped (113)           |
| extensionHooks.test.ts, extensionHookRunner.test.ts, tabHooks.test.ts                  | Test Files 3 passed (3) / Tests 122 passed (122)                      |
| foreignHooks.test.ts, modelApiForeignHooks.test.ts, modelApiExtensionHooks.test.ts     | Test Files 3 passed (3) / Tests 53 passed (53)                        |
| git.test.ts, mcpProcess.test.ts, nativeGitSpawn.test.ts                                | Test Files 3 passed (3) / Tests 51 passed, 7 skipped (58)             |
| resourceWindowsLaunch.test.ts, attestedJob.test.ts, spawnProfiles.test.ts              | Test Files 1 passed, 2 skipped (3) / Tests 19 passed, 20 skipped (39) |
| deferredBundles.test.ts, modelApiBundle.test.ts, paidFeatures.test.ts                  | Test Files 3 passed (3) / Tests 164 passed (164)                      |
| acpPaid.test.ts, accountPaidConsent.test.ts, sessionTransfer.test.ts                   | Test Files 3 passed (3) / Tests 87 passed (87)                        |
| paidDailyBudget.test.ts, paidHookModels.test.ts, toolIoBounded.test.ts                 | Test Files 3 passed (3) / Tests 55 passed (55)                        |
| modelApiAutoCompact.test.ts, runtimeAccounting.test.ts, modelApiBackendManager.test.ts | Test Files 3 passed (3) / Tests 102 passed (102)                      |
| foreignHooks.test.ts, modelApiForeignHooks.test.ts, modelApiExtensionHooks.test.ts     | Test Files 3 passed (3) / Tests 53 passed (53)                        |
| modelsActivationBudget.test.ts, paidConsent.test.ts, paidConsentBundle.test.mjs        | Test Files 3 passed (3) / Tests 40 passed (40)                        |
| autoCompactionAdmission.test.ts, autoCompact.test.ts                                   | Test Files 2 passed (2) / Tests 53 passed (53)                        |

## Inherited dead-code qualification

The first plain knip run reports one inherited unused exported type:
`GitHubLeaseResult` in `src/core/git/tokenSource.ts:149`. Repository-wide
`rg` finds no reader, including inside that module. Remove the unused alias
(one erased TypeScript line); retain the live exported lease-result schema,
its fields and every behavior. GitHub token-source and git-source suites
pass all 27 cases at repository deadlines. Total complete owning files: 35.

9. Reintroduce the exact exported alias. Plain knip fails with the same
   `Unused exported types (1): GitHubLeaseResult` diagnostic. Restore the
   token source byte for byte to SHA-256
   `7bb73e4228509426e22f2d59961a91ea1ef04ada17ecead8755d4aca8c97f793`.
   Final static gates and production rebuild follow this restoration.

## Cycle-free refusal sharing

The actual cycle gate finds the new runtime edge returning through the
refusal error: `paidConsent.ts -> foreignHooksEntry.ts ->
autoCompactionAdmission.ts -> paidConsent.ts`. Move the existing error and
classifier unchanged into dependency-free `src/core/paid/autoCompactionError.ts`.
Consent re-exports both original names; admission imports the leaf directly.
No error name, class signature, classification or consent behavior changes.
This small source module is required to break the measured cycle; it adds
no chunk. Activation and Model API keep their exact sizes; the imported-hook
runtime drops another 230 bytes to **85,433**. Existing cross-bundle error
recognition, admission and activation suites pass all 30 cases.

10. Restore admission's error import from `paidConsent.ts`. The actual cycle
    gate again reports that same cycle and exits 1. Restore admission
    byte for byte to SHA-256
    `19d6b1ba293a172e91dddfc25d89d4555779ef6bc3225a923cb7c9f104dfdb7a`.
    Frozen evaluation parents must include the new refusal leaf and moved
    question formatter when refreshing their source digest; existing error
    imports through consent remain valid.

## Inherited duplication qualification

The unchanged duplication gate reports six inherited clones, all in
`runtimeAccountsService.test.ts` and `runtimeServices.test.ts`. Share only
those fixtures: duplicate account metadata and refused exec dependencies in
`test/unit/helpers/runtimeAccounts.ts`, plus the multiple-account owner setup
in the runtime-services suite. Its existing rejected-launch assertion still
runs for every caller. Every original case and assertion is retained. The
actual duplication gate now reports zero clones; the two complete suites
pass 28 cases at repository deadlines. Total complete owning files: 37.

11. Restore those two tests and their shared helper to the exact train base.
    The actual duplication gate again finds all six clones and exits 1.
    Restore the final three files byte for byte:

    - `runtimeAccountsService.test.ts`: SHA-256
      `e7df7b8d4785b25a9db1275c8d6623833f2ba6c7fde3cd2deb8c53af47eecbb8`.
    - `runtimeServices.test.ts`: SHA-256
      `25aab53d417c7301833c7ef20e0323c455d1f6eaba022aed5ba8694c939fe8bd`.
    - `helpers/runtimeAccounts.ts`: SHA-256
      `0b8ec3dc22b95694398b288a2c2e4991833bb0e677b7aa61bcf31733a6164f55`.

Final static and suite receipts below follow every restoration.

## Final restored-tree verification

The last complete affected-suite reruns pass at repository deadlines, three
files per invocation:

| Files                                                                 | Result     |
| --------------------------------------------------------------------- | ---------- |
| runtimeAccountsService, runtimeServices, paidConsentBundle            | 29 passed  |
| autoCompactionAdmission, autoCompactionBundle, modelsActivationBudget | 30 passed  |
| paidConsent, modelApiAutoCompact, modelApiBackendManager              | 127 passed |
| runtimeAccounting, deferredBundles, modelApiBundle                    | 145 passed |

The unchanged budget prints
`Activation baseline=561352 current=563929 growth=2577`.
Final `npm run build` exits 0: all 155 size rows, split, tokens, host globals
and third-party notices pass. The exact artifact sizes and split lines in
the table above are confirmed again on this restored source.

| Static check   | Exit |
| -------------- | ---- |
| host-typecheck | 0    |
| unit-typecheck | 0    |
| e2e-typecheck  | 0    |
| eslint         | 0    |
| prettier       | 0    |
| knip           | 0    |
| cycles         | 0    |
| duplication    | 0    |
| host-api       | 0    |
| l10n           | 0    |
| reference      | 0    |
| plan           | 0    |
| roadmap        | 0    |

No final verification uses raised timeouts, a filtered test, a new skip or
a weakened gate. Aggregate quality and platform-specific skipped cases stay
with the lead under the explicit brief. README and feature catalog need no
change: no command, setting or user-facing feature changes. Roadmap generation
leaves ROADMAP.md current. The Unreleased engineering note follows AGENTS
rule 10. No paid/live/network calls or installs occurred.

The correction commit is made with the installed `.husky/_` hooks, explicit
paths, and output in the lane's ignored temp directory. Read the staged and
committed diffs and compare every staged file's bytes after the hook; integrate
both lane commits together as qualified above.
