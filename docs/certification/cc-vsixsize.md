# CC-VSIXSIZE — what grew the win32-x64 VSIX since 0.19.0, and what can leave it

Windows PC, worktree `C:\Users\Randy\Coding\mx-cc-vsixsize`, branch
`cc/vsixsize`, base int/recovery `acb48b7f35`. Baseline: released 0.19.0,
main `f3941b8548`, packed in a scratch worktree
(`C:\Users\Randy\Coding\mx-scratch-vsix0190`, removed afterwards). Both
trees: `npm ci`, `npm run -s build` (exit 0 on each), then
`node scripts/package-vsix.mjs --target win32-x64`. No budget raised, no
gate loosened, no paid or live call, no push. The vault and
credential-store suites were never run on this PC. The analysis scripts
and both packages lived in the worktree's ignored `temp/` and were
deleted afterwards.

## Result

| Package                             | Bytes     | vs budget 3,788,800 | Exit |
| ----------------------------------- | --------- | ------------------- | ---- |
| 0.19.0 (`f3941b8548`)               | 3,649,018 | 139,782 under       | 0    |
| int/recovery (`acb48b7f35`)         | 4,278,624 | 489,824 over        | 1    |
| this branch (agent-only bundle out) | 4,273,804 | 485,004 over        | 1    |

Size lines as printed:

```
0.19.0:  VSIX: 3649018 bytes (budget 3788800)
before:  …muse-spark-code-win32-x64-0.19.0.vsix is 4278624 bytes; budget is 3788800 bytes (3700 KiB)
after:   …muse-spark-code-win32-x64-0.19.0.vsix is 4273804 bytes; budget is 3788800 bytes (3700 KiB)
```

**The package still does not fit.** 629,606 bytes grew since 0.19.0; all
but 4,820 of them are code and text the extension loads. Fitting needs a
decision this lane cannot take (below, "Remainder").

## What grew, by kind (zip member bytes, headers included)

| Kind                                                                                          | 0.19.0    | int/recovery | Growth   | This branch |
| --------------------------------------------------------------------------------------------- | --------- | ------------ | -------- | ----------- |
| Node bundles archive `dist/runtime.bundles.json.br`                                           | 1,357,054 | 1,634,246    | +277,192 | 1,629,809   |
| UI translation tables `l10n/ui.tables.json.br`                                                | 1,003,002 | 1,196,977    | +193,975 | 1,196,977   |
| Webview archive `dist/webview.json.br`                                                        | 460,680   | 528,331      | +67,651  | 528,331     |
| English fallback `dist/uiText*.js`                                                            | 101,518   | 121,361      | +19,843  | 121,361     |
| Manifest translations `package.nls*.json`                                                     | 229,255   | 248,140      | +18,885  | 248,140     |
| Native helper sources `native/**`                                                             | 65,934    | 80,713       | +14,779  | 80,713      |
| Walkthrough `resources/walkthrough/**`                                                        | 83,976    | 97,780       | +13,804  | 97,780      |
| Archive stubs and eager bundles `dist/*.js`                                                   | 85,589    | 97,949       | +12,360  | 97,566      |
| Other (manifest, notices, readme, changelog, legal data, vendored skill, usage tables, icons) | 255,274   | 262,268      | +6,994   | 262,268     |
| Skills `skills/**`, `first-party-skills/**`                                                   | 6,714     | 10,837       | +4,123   | 10,837      |
| **All members**                                                                               | 3,648,996 | 4,278,602    | +629,606 | 4,273,782   |

### `vsce ls` (the allowlisted source inventory), 0.19.0 → this branch

216 → 261 files. New: 34 lazy bundles (`accountPaid`, `devices`,
`editorChat`, `estimateActions`, `estimateHistory`, `estimatePrices`,
`judgeHook`, `judgeLint`, `judgeLocal`, `judgeP2`, `judgeServe`,
`judgeSetupDriver`, `judgeSources`, `judgeUses`, `maker`, `modelApiAcp`,
`modelApiB1`, `modelApiFast`, `modelApiFileRange`, `modelApiToolRun`,
`modelEfforts`, `playbook`, `resourceGovernorWindows`, `runtimeAccounts`,
`subscriptionCommands`, `teamCreate`, `teamEngine`, `teamFileIo`,
`teamHost`, `teamMerge`, `teamPanel`, `teamWorkerOps`, `toolRange`,
`validationSchema`), `dist/judgeModels.json`, three Windows C# sources
(`MuseSparkDeviceStorage.cs`, `MuseSparkDeviceWorker.cs`,
`MuseSparkLocalJudgePeer.cs`), `native/linux/MuseSparkLocalJudgePeer.c`
(not in the win32 stage), the judge-setup walkthrough step (`.md`,
`.webp`) and the five-file `skills/judge-lint/` pack. Gone:
`dist/runtimeMedia.js` (this branch). None of `dist/lsp.js`,
`dist/supervise.js`, `dist/packsVerify.js`, `dist/node.js`, the node
workspace (CodeMirror, xterm), fonts, source maps or certification files
is in either package.

### Zip members that moved by 1,000 bytes or more (0.19.0 → this branch)

| Member                                      | 0.19.0    | This branch | Change   | State |
| ------------------------------------------- | --------- | ----------- | -------- | ----- |
| `dist/runtime.bundles.json.br`              | 1,357,054 | 1,629,809   | +272,755 | both  |
| `l10n/ui.tables.json.br`                    | 1,003,002 | 1,196,977   | +193,975 | both  |
| `dist/webview.json.br`                      | 460,680   | 528,331     | +67,651  | both  |
| `resources/walkthrough/judge-setup.webp`    | 0         | 13,293      | +13,293  | new   |
| `dist/uiText.js`                            | 79,185    | 89,600      | +10,415  | both  |
| `dist/uiTextSurfaces.js`                    | 9,699     | 17,673      | +7,974   | both  |
| `native/windows/MuseSparkDeviceWorker.cs`   | 0         | 5,170       | +5,170   | new   |
| `docs/judge.md`                             | 3,429     | 7,969       | +4,540   | both  |
| `native/windows/MuseSparkJob.cs`            | 10,904    | 14,185      | +3,281   | both  |
| `native/windows/MuseSparkLocalJudgePeer.cs` | 0         | 2,759       | +2,759   | new   |
| `native/windows/MuseSparkDeviceStorage.cs`  | 0         | 2,557       | +2,557   | new   |
| `skills/judge-lint/standards.md`            | 0         | 1,450       | +1,450   | new   |
| `dist/uiTextRuntime.js`                     | 6,140     | 7,571       | +1,431   | both  |
| `package.nls.*.json` (15 files)             | 229,255   | 248,140     | +18,885  | both  |
| `dist/judgeModels.json`                     | 0         | 1,145       | +1,145   | new   |
| `skills/judge-lint/rules.json`              | 0         | 1,080       | +1,080   | new   |
| `dist/recorder.js`                          | 8,156     | 7,063       | −1,093   | both  |
| `dist/providerPolicy.js`                    | 3,466     | 1,936       | −1,530   | both  |
| 186 other members                           |           |             | +19,048  |       |

### Inside the Node bundles archive

Decoded bundles 7,171,763 → 8,655,840 bytes (+1,484,077), 100 → 134
members. Marginal cost is the archive's size with and without the member
(brotli 9, the production 8 MiB window; production is brotli 11, about
10% smaller throughout).

| Bundle                      | Decoded 0.19.0 → now | Marginal cost |
| --------------------------- | -------------------- | ------------- |
| `extension.js` (activation) | 434,959 → 524,559    | 111,661       |
| `runtimeAccounts.js` (new)  | 153,251              | 28,579        |
| `playbook.js` (new)         | 143,602              | 34,427        |
| `devices.js` (new)          | 115,955              | 26,597        |
| `teamHost.js` (new)         | 109,300              | 15,789        |
| `teamEngine.js` (new)       | 95,582               | 11,181        |
| `teamPanel.js` (new)        | 94,468               | 12,943        |
| `modelApiToolRun.js` (new)  | 70,934               | 8,859         |
| `judgeP2.js` (new)          | 64,108               | 13,340        |
| `judgeHook.js` (new)        | 62,784               | 5,945         |
| `estimatePrices.js` (new)   | 62,540               | 7,615         |
| `judgeSources.js` (new)     | 60,519               | 12,412        |
| `providers.js`              | 163,559 → 200,676    | 44,357        |
| `judge.js`                  | 46,924 → 77,228      | 13,784        |
| `conversation.js`           | 251,677 → 278,811    | 54,977        |

By feature (decoded): the local judge (nine bundles) about 364 KB, the
team engine and panel about 340 KB, accounts and subscriptions
(`runtimeAccounts`, `accountPaid`, `subscriptionCommands`) about 234 KB,
devices and maker about 147 KB, the playbook window 144 KB, the estimator
(`estimatePrices`, `estimateActions`, `estimateHistory`) about 122 KB,
Model API pieces about 140 KB, activation +90 KB. Every one of these is a
`vscode` or `both` row of `src/shared/lazyBundles.generated.ts`: the
extension loads it (for example `RUNTIME_ACCOUNTS_BUNDLE_FILE`,
`DEVICES_BUNDLE_FILE` and `JUDGE_P2_BUNDLE_FILE` from `src/extension.ts`,
`teamPanel.js` from the models panel).

### Inside the translation tables

Leaves 6,337; top-level keys 3,199 → 3,574. Each of the 14 locales grew
about 14–17 KB compressed (German +85,714 raw bytes). Largest German
growth: `devices` 9,337, `acpGrok` 5,528, `nodeOs` 2,994, `desktop`
2,520, `accounts` +2,431, `nodeMessages` 2,273, `judgeSetupWizard`
2,177, `judgeSetupCli` 1,694, `referenceCliOptions` +1,693,
`judgePanel` 1,544.

### Inside the webview archive

Decoded 1,669,618 → 1,946,572 bytes (+276,954), 190 → 238 members.
Growth by source (bytes in output): models-panel agents (devices) 30,287,
roles 27,117, `qrcode-generator` 20,778, `src/shared/l10n` 18,492,
accounts 15,410, components 14,843, packed English regions 12,683,
judge setup 9,644, `shared/devices.ts` 9,492, devices section 8,228,
prompts 8,054, generated tokens 7,028. No node workspace page, editor,
terminal, font or image is in it.

## What left the package, and why it is safe

`dist/runtimeMedia.js` (the agent's media port, M105 lane V seam 5) is no
longer allowlisted in `.vscodeignore`. The build's own registry gives it
side `acp`: its only loaders are `src/runtime/backends.ts`
(`createRuntimeBackend`) and `src/runtime/exec/execFetch.ts`, reached
from `dist/acp.js`, `dist/headless.js` and `dist/runtimeEngine.js`, none
of which the VSIX carries. The ACP package keeps it
(`scripts/lib/acpBundles.mjs`). Saving 4,820 bytes (its stub plus its
share of the solid archive, which it largely shares with the other media
bundles).

The gate: `scripts/gen-lazy-registry.mjs` (run by `npm run build`) now
fails when the VSIX carries a bundle only the agent provably loads, and
`test/unit/packagedBundles.test.mjs` runs that check over the real
production build with the line put back.

Drill (rule 3): with `!dist/runtimeMedia.js` appended to `.vscodeignore`,
`node scripts/gen-lazy-registry.mjs --check` printed
`lazy registry: the VSIX carries runtimeMedia.js, which only the agent
loads: drop it from .vscodeignore` and exited 1; reverted, it exits 0.
With the gate's problem list emptied, the new
`packagedBundles` case fails; restored, it passes (exit codes below).

## Measured and not taken

| Lever                                                                    | Saving                        | Why not                                                                                                         |
| ------------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Brotli window 24 for the Node archive / the tables                       | 315 / 936                     | Noise                                                                                                           |
| Node archive members by name, or smallest first                          | none (+2,327 / +3,791 larger) | The current largest-first order is best                                                                         |
| Node archive as raw length-prefixed text instead of JSON                 | 6,003                         | Needs a new reader in every stub's loader for 0.2%                                                              |
| One solid archive for the webview and the Node bundles                   | 54,873                        | Needs both readers (`webviewBundleRoot.ts`, `readPackedRuntime`) rewritten                                      |
| `acp*`, `cli*`, `node*`, `judgeSetupCli` groups out of the VSIX's tables | at most 90,017                | Upper bound (`nodeErrors` is read by the chat webview); needs a VSIX-only English layout, a D33 contract change |
| Translations identical to English                                        | 6,655 raw (German)            | Negligible                                                                                                      |
| `voiceLinux.js`, `vaultPosix.js` out of the win32 package                | under 15,851                  | Vault loading cannot be exercised on this PC; small                                                             |
| Shorter archive stubs (134 at about 390 bytes)                           | about 25,000 (est.)           | Loader change for every lazy bundle                                                                             |

Even taking every row reaches about 193 KB, under half of the 485,004
bytes still over.

## Remainder

485,004 bytes over the 3,788,800-byte budget on win32-x64. Every
remaining grown byte is a bundle the extension loads, its translations,
its webview UI, its native helper source, its walkthrough step or its
manifest strings. No file in the package should not ship. Fitting needs
one of: the lead's D6 decision on the cap (PLAN.md D6; not raised here),
or a decision to take features or locales out of the VSIX.

## Decision (2026-10-24, owner; applied by CC-INT1)

The lead asked the owner with the measurements above. The owner's answer:
**"Move budget to measured +15%"**. D6's rule applied to this branch's
measured win32-x64 package: 4,273,804 × 1.15 = 4,914,874.6 bytes, rounded up
to the next 25 KiB multiple = **4800 KiB (4,915,200 bytes)**, replacing
3700 KiB (3,788,800 bytes). It is set once, `MAX_VSIX_BYTES` in
`scripts/check-vsix-size.mjs` (read by `package-vsix.mjs` and CI's per-target
step); PLAN.md D6 (VSIXBUDGET), D209 (amended) and §10 carry the decision;
`README.md` and `docs/RELEASING.md` name the new number;
`test/unit/vsixBudget.test.mjs` holds its edge. On this branch's own
measurement the package is then 641,396 bytes (13.1%) under 4,915,200; the
merged tree packs to 4,273,511 bytes (641,689 under, size line `VSIX:
4273511 bytes (budget 4915200)`, exit 0). Nothing else was raised. The
figures and exit codes of the merged tree's run are in
`docs/certification/cc-int1.md`.

## Checks (exit codes)

- `npm ci`: 0 (both trees).
- `npm run -s build`: 0 on `f3941b8548`, 0 on `acb48b7f35`, 0 on this branch.
- `node scripts/package-vsix.mjs --target win32-x64`: 0 on `f3941b8548`;
  1 on `acb48b7f35`; 1 on this branch (size only; every staging,
  localization, badge and module-export check before it passed).
- `node scripts/gen-lazy-registry.mjs --check`: 0; drill 1; reverted 0.
- `npx vitest run test/unit/packagedBundles.test.mjs`: 9 of 9, exit 0.
  Drill with the gate's problems emptied: the new case failed, 8 of 9,
  exit 1; restored, 9 of 9, exit 0.
- `vsixTargets`, `teamChunkPackaging`, `packageStage`, `vsixCompression`:
  passed.
- `manifest.test.ts`: 3 failures, identical on `acb48b7f35`'s
  `.vscodeignore` (walkthrough step `judgeSetup`, notices lacking
  `@codemirror/merge`, `actions: read` counted 8 not 7): int/recovery's,
  not this change's.
- `prettier --check`, `eslint` on the changed files: 0.
