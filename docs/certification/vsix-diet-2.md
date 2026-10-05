# VSIXDIET2 — Universal package headroom

Kubuntu worktree `/home/randy/lanes/VSIXDIET2`, branch `perf/vsix-diet-2`,
base `6ebba52354f920bd32311e551acf82bbee83371a` (0.14.0 candidate).
No cap, dependency, source translation or wire shape changes. No network,
paid/live calls, push, merge or rebase. Scoped checks replace aggregate quality
because the lane brief/shared rules explicitly reserve that gate for the lead.

## Universal baseline and result

Original diet measurements, superseded by the FIXVSIX2 repair below.
Baseline **2,248,984 / 2,252,800 bytes**, 3,816 bytes spare. Reviewed measurement
**2,031,277 bytes**, **221,523 bytes headroom**
(**217,707 bytes saved**). The 150,000-byte target is met.
VSIX SHA-256: `2fc850aac2a663d07e9206be9bae111845e5ee421f15c162e9e91e8be530b6da`.

The real universal helper comes only from the authorized 0.13.0 VSIX, whose
SHA-256 matches its adjacent SHA256SUMS. Its x86_64/arm64 payload remains
289,568 bytes, executable, and byte-identical at SHA-256
`f42e757a0d78a6bc6a6af22c3bcf34fc7d082eb9e8130d9336024a55c19f0f36`.
Its ZIP contribution remains 81,327 bytes.

| Category (compressed payload bytes) |  Before |   After |    Saved |
| ----------------------------------- | ------: | ------: | -------: |
| Other members                       |  81,828 |  82,013 |     -185 |
| Manifest translations               | 160,346 | 160,346 |        0 |
| Node JavaScript                     | 827,569 | 221,945 |  605,624 |
| Runtime archives                    | 434,717 | 865,191 | -430,474 |
| Browser assets                      | 324,480 | 324,480 |        0 |
| Native helpers                      |  93,280 |  93,280 |        0 |
| Walkthrough                         | 159,901 | 116,991 |   42,910 |
| Vendored skill                      | 139,197 | 139,197 |        0 |

Archive and Node JavaScript must be read together: lazy source bytes move
into the archive, so the archive row alone increases. ZIP member headers and
the unchanged files remain included in the actual complete VSIX measurement.

## Activation and runtime preservation

Activation remains **447,145 bytes**, byte-identical to baseline. Staged
core English **49,154 → 46,217 bytes**: compressed regional key lists more
than offset the lazy archive reader. Recorder and shared wire/validation
parsers stay ordinary files. Browser assets/chunks stay ordinary ESM; no maps
or tests were leaking, and no duplicate browser outputs were found.

The existing language-major table schema/version and strict table validation
remain unchanged. Source JSON and VS Code manifest translations remain intact.
One quality-11 Brotli payload holds the translations and English-region JSON.
A separate solid `dist/runtime.bundles.json.br` holds exact lazy CommonJS
source strings, preserving backend availability when translations are damaged. Each requested executable/English member must match its
build-time SHA-256. `module._compile` preserves original filenames, relative
requires, exports and runtime stack locations; only requested code is compiled.
Every English region retains its original independent inline fallback.

Solid decompression expands each archive on its first use per Node core
module/process, under the existing 14-MiB decoder bound. Parsed archives are
cached separately; failed members evict their cache so repaired files can retry. This trades first-use decompression/memory for package
headroom; no wall-clock startup improvement or cross-platform performance claim
is made. Tables are installed only for the selected language, and regions/modules
remain loaded on use. The shared packaging serves VS Code hosts and every
ACP/headless editor; no editor-specific feature path is added.

All four PNGs use lossless filtering/compression. Decoded RGB hashes match
the original ZIP members; licences/notices and helper bytes compare identical.

| Walkthrough | Before file bytes | After file bytes | Decoded RGB SHA-256                                                |
| ----------- | ----------------: | ---------------: | ------------------------------------------------------------------ |
| welcome     |            27,779 |           20,306 | `e74e813ba25a0cf782bd5410aba9691af84112e3c7f8bb04b6e772493c3741bf` |
| chat        |            49,242 |           39,823 | `ef961568ffca02ae88934238114301687c54a803f3c2d35612dec4a2c894fe8c` |
| sign-in     |            30,392 |           22,112 | `4a425986b6a7374c93df6401f1f895021e8bd43f01aa8c48d68da25b0a059632` |
| open        |            63,012 |           44,833 | `74345d09079c7e71fc325f047e05d3a9369b8f533d1b3a97db6495fad7f7826f` |

## ACP package

Baseline ACP tarball is reproduced by executing the exact HEAD packaging
script with the same unchanged production bundles. **1,295,540 → 951,174
bytes**, **344,366 bytes saved**. It carries the same format for both runtime archives and
independent English fallbacks; its entry and native credential binding stay
unchanged. `--packaged-acp` applies the same strict per-language source comparison
without VS Code manifest files, which ACP does not ship. CI requires both actual
archive members and drills their removal. The separate fake-only package copies
the archives unchanged and remains private, unsigned and unpublished.

## Checks and drills

Implementation commit: `a1bc7dac5f9953cacb677246f250c0b7ea192271`.
The existing `.husky/_/pre-commit` hook runs changed-file ESLint with fixes,
Prettier and staged Gitleaks: all pass, no leaks. The generated reader's source
still matches every drill restoration hash; the worktree is clean after the
implementation commit. This final receipt/PLAN gate-scope note uses the same
hook. No branch is pushed or integrated.

All commands run directly on Kubuntu, Node 24.18.0; complete Vitest files
run serially in batches of at most three with `--maxWorkers=3 --testTimeout=120000`.
The final positive run follows every byte-exact drill restoration.

- Five-project `npm run typecheck`; changed-source ESLint; changed-file Prettier;
  plain Knip, dpdm cycles and jscpd (zero clones); source localization and host API.
- Production build, all original size/split/host-global/notices caps, universal
  `npm run package`, explicit `check-vsix-size.mjs`, and `npm run package:acp`.
- Archive/fallback/English-region and complete importing/package/manifest/schema/
  documentation suites, plus actual packaged ACP/headless/fake launcher suites.
- Strict staged VSIX and ACP localization: 14 tables, 164 manifest strings,
  590 source files, zero problems. Host API: 332 APIs, 31 VS Code importers,
  25 Node built-ins, 61 theme variables, zero problems.
- `check-ui-text.mjs` loads actual factories and CLI. Additional CLI help matches
  exact source text in English and all 14 translated languages. Every archived
  lazy source matches the original build: 26 VSIX modules and seven ACP modules.
  The two packages' translation/English archives compare byte-identical.
- Native helper, licences/notices and decoded walkthrough RGB pixels compare
  unchanged. No source translation, dependency, original cap or gate is weakened.

Final positive receipts: **286 tests pass across 17 complete files**, no skips:
67 archive/English/fallback tests; 62 deferred/l10n/browser-package tests;
70 manifest/action/schema tests; nine ACP/changelog/README tests; 25 full-notes/
screenshot inventory tests; 53 packaged ACP/headless/fake-launcher tests.
Five-project typecheck and every required static/build/package gate exit zero.
The final lint run follows a test-only helper-scope correction; formatting passes
on all changed text files. All ten drill restorations precede the positive run.

ACP tarball SHA-256:
`f03f441453931fd802cd046cbc80693b3a29da974ac57eca771310755c6b6d15`.
Full aggregate quality/coverage, installed-editor integration and other-platform
runs are reserved for the lead by the explicit lane/shared rules. No live/paid
or hosted action-check certification is claimed.

The CLI check initially exposed its inherited missing Setup usage line;
expected help now includes the existing `acpUsageSetup` text exactly. The first
corruption assertion compared grouped production English key order with source
order; it now requires baseline byte serialization and identical source values.
The initial determinism negative probe's large binary diff was stopped; boolean
`Buffer.equals` preserves exact comparison and the corrected drill fails below.
Its interrupted run is not a guard-fire receipt.

Eight deliberate source bypasses make the complete VSIX suite exit 1. Every
source restores byte-exact at SHA-256
`32d37c54492c25abda905b18b08edf4ab218a4bbd0fd30f743983e995412191f`.

| Fault               | Failing tests | Mutated SHA-256                                                    | Restored SHA-256                                                   |
| ------------------- | ------------: | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| member-digest       |             2 | `6b0334845ae83c5483db5fe773cccc9792d98b268416bb7d9c864598361bbe7a` | `32d37c54492c25abda905b18b08edf4ab218a4bbd0fd30f743983e995412191f` |
| decoded-bound       |             2 | `2659eb829dbc5036a2e22ecacfc984779cef07b471bb48a4cf1997f69e60eb63` | `32d37c54492c25abda905b18b08edf4ab218a4bbd0fd30f743983e995412191f` |
| package-bound       |             1 | `28264979526b337236a8abac73b0c3f77de9ed5aa83dfbb7bacffe2f1d8f999d` | `32d37c54492c25abda905b18b08edf4ab218a4bbd0fd30f743983e995412191f` |
| archive-version     |             1 | `781260b542316adc8c07611310be2a1d6c812c5c3f5723ae1758353ee4419d3a` | `32d37c54492c25abda905b18b08edf4ab218a4bbd0fd30f743983e995412191f` |
| english-fallback    |             5 | `e9e7528fa86836c023bcabf10a01fd97a7987589e9712be02183cbe6fe26451a` | `32d37c54492c25abda905b18b08edf4ab218a4bbd0fd30f743983e995412191f` |
| failed-cache        |             1 | `318be0b6d3b9e7c3a701bcd9137daef0502f45281d4af044d12e083ff2f55f49` | `32d37c54492c25abda905b18b08edf4ab218a4bbd0fd30f743983e995412191f` |
| deterministic-order |             1 | `ea5492ef89e2331b23be7c2c3ce78af0ecc38002415dccca52a8a1a45c6c0f70` | `32d37c54492c25abda905b18b08edf4ab218a4bbd0fd30f743983e995412191f` |
| regional-keys       |            11 | `f774b5d374b772e0f52745709a7707e6bd2b8dbb6d35fc0b155113a8d31c85d4` | `32d37c54492c25abda905b18b08edf4ab218a4bbd0fd30f743983e995412191f` |

The CI membership bypass removes both archive guards; the complete packaged
exec suite exits 1 with two membership failures. Altering an actual staged German
value makes `--packaged-acp` exit 1 with `differs from source`. Both files restore
byte-exact before positive checks:

| Fault           | File                                      | Before and restored SHA-256                                        |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| ci-membership   | `.github/workflows/build.yml`             | `13f7456d22c027ee59a681c27cd15a8a808aa6ba3737f95c898793ee676808fd` |
| acp-exact-table | `dist/acp-package/l10n/ui.tables.json.br` | `2bdff5e238f3d5f3df750365875a275580daaa1203fcb79f21adf8b976f8a990` |

## All VSIX members ranked by baseline compressed bytes

| Member                                                                                            | Before compressed | After compressed | Before raw | After raw |
| ------------------------------------------------------------------------------------------------- | ----------------: | ---------------: | ---------: | --------: |
| `extension/l10n/ui.tables.json.br`                                                                |           434,717 |          441,723 |    434,582 |   441,588 |
| `extension/dist/webview/main.js`                                                                  |           196,061 |          196,061 |    632,753 |   632,753 |
| `extension/dist/extension.js`                                                                     |           142,826 |          142,826 |    447,145 |   447,145 |
| `extension/dist/modelApi.js`                                                                      |           142,717 |              140 |    457,264 |       162 |
| `extension/native/darwin/muse-dictate`                                                            |            81,327 |           81,327 |    289,568 |   289,568 |
| `extension/resources/walkthrough/open.png`                                                        |            59,085 |           41,302 |     63,012 |    44,833 |
| `extension/dist/pageWorker.js`                                                                    |            58,398 |              142 |    193,171 |       164 |
| `extension/dist/conversation.js`                                                                  |            56,602 |              141 |    197,746 |       166 |
| `extension/dist/webview/chunks/chunk-Z55QKFYP.js`                                                 |            53,177 |           53,177 |    127,411 |   127,411 |
| `extension/resources/walkthrough/chat.png`                                                        |            46,165 |           36,961 |     49,242 |    39,823 |
| `extension/dist/planMarkdown.js`                                                                  |            44,986 |              144 |    147,608 |       166 |
| `extension/dist/agentImport.js`                                                                   |            37,912 |              144 |    118,893 |       165 |
| `extension/dist/uiText.js`                                                                        |            34,202 |           34,360 |     49,154 |    46,217 |
| `extension/resources/walkthrough/sign-in.png`                                                     |            27,799 |           19,418 |     30,392 |    22,112 |
| `extension/dist/checkpointStore.js`                                                               |            25,650 |              144 |     78,764 |       169 |
| `extension/resources/walkthrough/welcome.png`                                                     |            25,286 |           17,744 |     27,779 |    20,306 |
| `extension/dist/conversationGit.js`                                                               |            24,837 |              146 |     73,158 |       169 |
| `extension/dist/webview/chunks/chunk-35TQZ5QK.js`                                                 |            23,504 |           23,504 |     80,845 |    80,845 |
| `extension/docs/PRIVACY.md`                                                                       |            21,242 |           21,242 |     57,704 |    57,704 |
| `extension/dist/foreignHooks.js`                                                                  |            20,949 |              144 |     70,894 |       166 |
| `extension/changelog.md`                                                                          |            18,502 |           18,687 |     47,938 |    48,414 |
| `extension/dist/tab.js`                                                                           |            18,131 |              136 |     50,630 |       157 |
| `extension/dist/whatsNew.json`                                                                    |            16,572 |           16,572 |     21,963 |    21,963 |
| `extension/dist/judge.js`                                                                         |            16,105 |              137 |     48,144 |       159 |
| `extension/dist/sessionBoard.js`                                                                  |            14,862 |              142 |     46,128 |       166 |
| `extension/dist/webFetch.js`                                                                      |            14,634 |              140 |     38,258 |       162 |
| `extension/dist/browserCheck.js`                                                                  |            14,619 |              143 |     38,524 |       166 |
| `extension/dist/codeIntel.js`                                                                     |            14,215 |              141 |     40,005 |       163 |
| `extension/dist/hookRuntime.js`                                                                   |            14,212 |              140 |     44,006 |       165 |
| `extension/package.nls.ru.json`                                                                   |            12,488 |           12,488 |     49,928 |    49,928 |
| `extension/dist/extensionHooks.js`                                                                |            12,141 |              145 |     36,663 |       168 |
| `extension/dist/validation.js`                                                                    |            11,978 |           11,978 |     40,795 |    40,795 |
| `extension/vendor/high-quality-projects-skill/skills/project_setup/SKILL.md`                      |            11,971 |           11,971 |     28,728 |    28,728 |
| `extension/dist/review.js`                                                                        |            11,540 |              137 |     29,690 |       160 |
| `extension/dist/pluginHooks.js`                                                                   |            11,319 |              144 |     34,914 |       165 |
| `extension/package.nls.ja.json`                                                                   |            11,252 |           11,252 |     38,563 |    38,563 |
| `extension/package.nls.hu.json`                                                                   |            11,099 |           11,099 |     35,279 |    35,279 |
| `extension/dist/wire.js`                                                                          |            11,044 |           11,044 |     41,396 |    41,396 |
| `extension/package.nls.pl.json`                                                                   |            10,830 |           10,830 |     32,460 |    32,460 |
| `extension/package.nls.de.json`                                                                   |            10,811 |           10,811 |     33,585 |    33,585 |
| `extension/package.nls.zh-tw.json`                                                                |            10,802 |           10,802 |     28,955 |    28,955 |
| `extension/package.nls.cs.json`                                                                   |            10,733 |           10,733 |     32,398 |    32,398 |
| `extension/package.nls.fr.json`                                                                   |            10,719 |           10,719 |     35,168 |    35,168 |
| `extension/package.nls.zh-cn.json`                                                                |            10,699 |           10,699 |     28,557 |    28,557 |
| `extension/package.nls.ko.json`                                                                   |            10,678 |           10,678 |     34,471 |    34,471 |
| `extension/package.nls.tr.json`                                                                   |            10,440 |           10,440 |     33,523 |    33,523 |
| `extension/package.nls.it.json`                                                                   |            10,259 |           10,259 |     33,437 |    33,437 |
| `extension/package.nls.es.json`                                                                   |            10,239 |           10,239 |     33,672 |    33,672 |
| `extension/vendor/high-quality-projects-skill/skills/quality_retrofit/SKILL.md`                   |            10,236 |           10,236 |     23,448 |    23,448 |
| `extension/package.nls.pt-br.json`                                                                |            10,220 |           10,220 |     32,810 |    32,810 |
| `extension/dist/webview/chunks/chunk-MBTAPHGF.js`                                                 |             9,831 |            9,831 |     32,461 |    32,461 |
| `extension/dist/webview/main.css`                                                                 |             9,575 |            9,575 |     54,913 |    54,913 |
| `extension/vendor/high-quality-projects-skill/docs/QUALITY-REVIEW.md`                             |             9,474 |            9,474 |     22,561 |    22,561 |
| `extension/dist/recorder.js`                                                                      |             9,428 |            9,428 |     24,749 |    24,749 |
| `extension/package.nls.json`                                                                      |             9,077 |            9,077 |     27,923 |    27,923 |
| `extension/dist/report.js`                                                                        |             8,853 |              137 |     22,104 |       160 |
| `extension/vendor/high-quality-projects-skill/docs/CODE-QUALITY.md`                               |             8,646 |            8,646 |     20,500 |    20,500 |
| `extension/dist/museCodeReviewer.js`                                                              |             8,526 |              146 |     23,592 |       170 |
| `extension/dist/reviewer.js`                                                                      |             8,007 |              138 |     23,081 |       162 |
| `extension/dist/whatsNew.js`                                                                      |             7,582 |              141 |     19,001 |       162 |
| `extension/dist/browserRuntime.js`                                                                |             7,477 |              142 |     19,762 |       168 |
| `extension/dist/voice.js`                                                                         |             7,370 |              138 |     19,370 |       159 |
| `extension/vendor/high-quality-projects-skill/skills/project_setup/references/grill-me.md`        |             6,347 |            6,347 |     15,961 |    15,961 |
| `extension/dist/bundledSkills.js`                                                                 |             6,065 |              142 |     15,083 |       167 |
| `extension/vendor/high-quality-projects-skill/docs/DELIVERY.md`                                   |             6,002 |            6,002 |     15,068 |    15,068 |
| `extension/vendor/high-quality-projects-skill/templates/README.md`                                |             5,999 |            5,999 |     13,334 |    13,334 |
| `extension/package.json`                                                                          |             5,486 |            5,486 |     28,395 |    28,395 |
| `extension/vendor/high-quality-projects-skill/README.md`                                          |             4,627 |            4,627 |     10,928 |    10,928 |
| `extension/vendor/high-quality-projects-skill/scripts/delivery/checks.py`                         |             4,610 |            4,610 |     19,075 |    19,075 |
| `extension/vendor/high-quality-projects-skill/scripts/detect-stack.sh`                            |             4,578 |            4,578 |     13,257 |    13,257 |
| `extension/vendor/high-quality-projects-skill/scripts/delivery/reader.py`                         |             4,398 |            4,398 |     15,941 |    15,941 |
| `extension/THIRD_PARTY_NOTICES.txt`                                                               |             4,358 |            4,358 |     45,141 |    45,141 |
| `extension/readme.md`                                                                             |             4,199 |            4,199 |     11,502 |    11,502 |
| `extension/media/icon.png`                                                                        |             4,141 |            4,141 |      4,136 |     4,136 |
| `extension/vendor/high-quality-projects-skill/scripts/detect-stack.ps1`                           |             3,888 |            3,888 |     17,895 |    17,895 |
| `extension/native/windows/capture.ps1`                                                            |             3,709 |            3,709 |     10,902 |    10,902 |
| `extension/native/windows/MuseSparkMcpJob.cs`                                                     |             3,652 |            3,652 |     13,182 |    13,182 |
| `extension/dist/uiTextHooks.js`                                                                   |             3,613 |            3,739 |      4,746 |     4,911 |
| `extension/vendor/high-quality-projects-skill/docs/PHILOSOPHY.md`                                 |             3,519 |            3,519 |      7,203 |     7,203 |
| `extension/dist/webview/chunks/UsageDialog-IM3BQK3G.js`                                           |             3,502 |            3,502 |     12,905 |    12,905 |
| `extension/vendor/high-quality-projects-skill/skills/feature_delivery/SKILL.md`                   |             3,288 |            3,288 |      7,546 |     7,546 |
| `extension/vendor/high-quality-projects-skill/AGENTS.md`                                          |             3,268 |            3,268 |      7,279 |     7,279 |
| `extension/dist/webview/chunks/chunk-5IDLT4FO.js`                                                 |             3,193 |            3,193 |      8,248 |     8,248 |
| `extension/vendor/high-quality-projects-skill/scripts/delivery/graph.py`                          |             3,018 |            3,018 |     12,051 |    12,051 |
| `extension/vendor/high-quality-projects-skill/skills/project_setup/assets/PROJECT_BRIEF.md`       |             2,957 |            2,957 |      7,113 |     7,113 |
| `extension/docs/judge.md`                                                                         |             2,931 |            2,931 |      6,136 |     6,136 |
| `extension/vendor/high-quality-projects-skill/templates/.pre-commit-config.yaml`                  |             2,817 |            2,817 |      8,268 |     8,268 |
| `extension/vendor/high-quality-projects-skill/docs/RED-DRILLS.md`                                 |             2,790 |            2,790 |      6,293 |     6,293 |
| `extension/dist/webview/chunks/chunk-WIW7J74T.js`                                                 |             2,738 |            2,738 |      9,115 |     9,115 |
| `extension/dist/uiTextRuntime.js`                                                                 |             2,708 |            2,833 |      3,542 |     3,709 |
| `extension/vendor/high-quality-projects-skill/scripts/delivery/cli.py`                            |             2,638 |            2,638 |      7,358 |     7,358 |
| `extension/vendor/high-quality-projects-skill/VENDOR.json`                                        |             2,591 |            2,591 |      6,650 |     6,650 |
| `extension/vendor/high-quality-projects-skill/templates/typescript/eslint.config.mjs`             |             2,584 |            2,584 |      6,400 |     6,400 |
| `extension/dist/webview/chunks/AgentMap-BXXBJ4BZ.js`                                              |             2,530 |            2,530 |      8,060 |     8,060 |
| `extension/native/windows/dictate.ps1`                                                            |             2,420 |            2,420 |      6,909 |     6,909 |
| `extension/vendor/high-quality-projects-skill/scripts/delivery/snapshot.py`                       |             2,386 |            2,386 |      7,163 |     7,163 |
| `extension/vendor/high-quality-projects-skill/docs/INSTALLATION.md`                               |             2,360 |            2,360 |      6,244 |     6,244 |
| `extension/dist/webview/chunks/GitPanel-BUUXUQ6Z.js`                                              |             2,293 |            2,293 |      8,953 |     8,953 |
| `extension/vendor/high-quality-projects-skill/scripts/delivery/writer.py`                         |             2,250 |            2,250 |      6,158 |     6,158 |
| `extension/dist/webview/chunks/chunk-E7NQ3H3G.js`                                                 |             2,200 |            2,200 |      7,051 |     7,051 |
| `extension/dist/searchWorker.js`                                                                  |             2,125 |              144 |      4,969 |       166 |
| `extension/vendor/high-quality-projects-skill/templates/cpp/sanitizers.md`                        |             2,117 |            2,117 |      4,456 |     4,456 |
| `extension/dist/webview/chunks/BestOfNDialog-HYYK4H24.js`                                         |             2,078 |            2,078 |      7,072 |     7,072 |
| `extension/dist/webview/chunks/ReviewPane-7IGQNNZF.js`                                            |             1,992 |            1,992 |      5,642 |     5,642 |
| `extension/dist/uiTextSurfaces.js`                                                                |             1,936 |            2,059 |      2,510 |     2,678 |
| `extension/dist/webview/chunks/chunk-WLWBUQDT.js`                                                 |             1,822 |            1,822 |      5,097 |     5,097 |
| `extension/dist/webview/chunks/ReportDialog-DK2ZXVUY.js`                                          |             1,652 |            1,652 |      4,783 |     4,783 |
| `extension/dist/webview/chunks/chunk-YFMN4AFG.js`                                                 |             1,578 |            1,578 |      4,038 |     4,038 |
| `extension/dist/webview/chunks/HistoryDialog-VDRQMRHO.js`                                         |             1,567 |            1,567 |      3,431 |     3,431 |
| `extension/vendor/high-quality-projects-skill/scripts/delivery/model.py`                          |             1,557 |            1,557 |      4,665 |     4,665 |
| `extension/first-party-skills/muse_gadgets/SKILL.md`                                              |             1,485 |            1,485 |      2,879 |     2,879 |
| `extension/vendor/high-quality-projects-skill/templates/csharp/Directory.Build.props`             |             1,468 |            1,468 |      3,284 |     3,284 |
| `extension/vendor/high-quality-projects-skill/docs/REPO-META.md`                                  |             1,423 |            1,423 |      3,252 |     3,252 |
| `extension/vendor/high-quality-projects-skill/scripts/verify-format-safe.py`                      |             1,421 |            1,421 |      2,866 |     2,866 |
| `extension/vendor/high-quality-projects-skill/templates/powershell/PSScriptAnalyzerSettings.psd1` |             1,247 |            1,247 |      3,129 |     3,129 |
| `extension/vendor/high-quality-projects-skill/templates/rust/clippy-strict.toml`                  |             1,241 |            1,241 |      3,628 |     3,628 |
| `extension/native/windows/MuseSparkMcpLauncher.cs`                                                |             1,234 |            1,234 |      3,502 |     3,502 |
| `extension/vendor/high-quality-projects-skill/templates/web/knip.jsonc`                           |             1,177 |            1,177 |      2,398 |     2,398 |
| `extension/vendor/high-quality-projects-skill/templates/cpp/.clang-tidy`                          |             1,138 |            1,138 |      2,653 |     2,653 |
| `extension/vendor/high-quality-projects-skill/templates/python/mypy.ini`                          |             1,137 |            1,137 |      2,318 |     2,318 |
| `extension/vendor/high-quality-projects-skill/templates/python/ruff.toml`                         |             1,092 |            1,092 |      2,003 |     2,003 |
| `extension.vsixmanifest`                                                                          |             1,059 |            1,059 |      3,447 |     3,447 |
| `extension/vendor/high-quality-projects-skill/templates/rust/deny.toml`                           |             1,053 |            1,053 |      2,046 |     2,046 |
| `extension/vendor/high-quality-projects-skill/templates/typescript/tsconfig.strict.json`          |             1,027 |            1,027 |      2,104 |     2,104 |
| `extension/dist/webview/chunks/chunk-ORUPNIWN.js`                                                 |               962 |              962 |      2,026 |     2,026 |
| `extension/native/windows/MuseSparkJob.cs`                                                        |               938 |              938 |      2,388 |     2,388 |
| `extension/media/icon.svg`                                                                        |               923 |              923 |      1,847 |     1,847 |
| `extension/vendor/high-quality-projects-skill/templates/workflow/PLAN.md`                         |               888 |              888 |      2,018 |     2,018 |
| `extension/vendor/high-quality-projects-skill/scripts/skill-root.ps1`                             |               839 |              839 |      2,122 |     2,122 |
| `extension/dist/webview/chunks/chunk-6BQ4JTVV.js`                                                 |               826 |              826 |      1,554 |     1,554 |
| `extension/dist/webview/whatsNew.css`                                                             |               757 |              757 |      2,534 |     2,534 |
| `extension/vendor/high-quality-projects-skill/scripts/skill-root.sh`                              |               753 |              753 |      1,505 |     1,505 |
| `extension/dist/webview/chunks/chunk-SW22JVCB.js`                                                 |               698 |              698 |      1,402 |     1,402 |
| `extension/LICENSE.txt`                                                                           |               638 |              638 |      1,071 |     1,071 |
| `extension/vendor/high-quality-projects-skill/LICENSE`                                            |               638 |              638 |      1,071 |     1,071 |
| `extension/vendor/high-quality-projects-skill/templates/csharp/.editorconfig`                     |               570 |              570 |      1,153 |     1,153 |
| `extension/dist/webview/chunks/chunk-VAB6FSO4.js`                                                 |               555 |              555 |      1,143 |     1,143 |
| `extension/dist/webview/chunks/chunk-UW65GGTW.js`                                                 |               529 |              529 |        946 |       946 |
| `extension/vendor/high-quality-projects-skill/templates/web/.stylelintrc.json`                    |               502 |              502 |      1,147 |     1,147 |
| `extension/resources/walkthrough/chat.md`                                                         |               442 |              442 |        767 |       767 |
| `extension/dist/webview/whatsNew.js`                                                              |               431 |              431 |        708 |       708 |
| `extension/resources/walkthrough/welcome.md`                                                      |               403 |              403 |        694 |       694 |
| `extension/resources/walkthrough/sign-in.md`                                                      |               397 |              397 |        723 |       723 |
| `extension/vendor/high-quality-projects-skill/scripts/verify-delivery.py`                         |               357 |              357 |        580 |       580 |
| `extension/resources/walkthrough/open.md`                                                         |               324 |              324 |        587 |       587 |
| `[Content_Types].xml`                                                                             |               292 |              292 |      1,323 |     1,323 |
| `extension/dist/webview/chunks/chunk-JCXSRWIY.js`                                                 |               251 |              251 |        372 |       372 |
| `extension/vendor/high-quality-projects-skill/scripts/update-delivery.py`                         |               238 |              238 |        364 |       364 |
| `extension/dist/webview/chunks/chunk-JUQTSSJ7.js`                                                 |               176 |              176 |        210 |       210 |
| `extension/vendor/high-quality-projects-skill/scripts/delivery/__init__.py`                       |                72 |               72 |         80 |        80 |
| `extension/dist/webview/chunks/chunk-5OYIARPN.js`                                                 |                 2 |                2 |          0 |         0 |
| `extension/dist/runtime.bundles.json.br`                                                          |                 0 |          423,468 |          0 |   423,338 |

## FIXVSIX2 — RVMVSIX2 repair (2026-10-05)

Worktree `/home/randy/lanes/FIXVSIX2`, branch `perf/vsix-diet-2-fix`,
base `b5bbb5ff`. The repair brief overrides common.md's merge/full-quality
steps: hooks on, no merge/push/rebase or live/paid calls.

**P2 fixed:** the VSIX packaging unit setup builds regional English in memory
with esbuild and writes only its owned temporary fixture. Baseline/size/fallback
comparisons use those generated files, never checkout `dist/`. The complete
45-test suite passes on Kubuntu with no checkout `dist/` (41.97 s); all tests
run, no skip or timeout changes. An initial attempt compressed the test-only
fixtures too and exceeded the unchanged ten-second setup limit; the fixture
now writes exact generated values without that unnecessary compression.

P2 red drill: reintroduce the four checkout-dist copies in setup, then run the
complete owning suite while `dist/` is absent. Suite exits 1 with named
`VSIX packaging` setup `ENOENT .../dist/uiText.js`; the 45 tests cannot start.
Restore byte-exact and compare SHA-256.

Before/restored `db36173039e4eddc7c36ca9630e11b8acf3aa7cf33c526d8bf97c8a564aa51df`; mutated `da0647d4281ed6e71885e6ca5a9b578c8d05b9613b133cb8c84af9bd72081750`.

**P1 fixed:** archive wrappers retain the build's inert static export
annotation (and direct plain-CJS export names), then compile the unchanged
digest-checked bytes. Parsing top-level statements excludes declarations
inside comments/strings. The reader lives on the private cached CommonJS
Module; `uiText.js` keeps precisely its original public exports.

`test/packaging/moduleExports.test.mjs` runs automatically in both packaging
jobs, after production build: every top-level Node module in the VSIX tree
and extracted actual ACP tarball is imported with native Node `import()`
before `require()`, and both export-name sets equal the unpacked build.
Native functions are exercised in hookRuntime, foreignHooks, reviewer,
session board, report and plugin bundles where shipped, through both loaders.
Workers isolate CLI/host state with fake services and a credential-free
environment; no network/model call. Browser ESM assets stay ordinary files.
The separate package suite does not add a prerequisite to unit CI.

Baseline regressions: 25/34 VSIX and 6/15 ACP module tests fail, including
`parseElicitationParams` through native import. After repair, 34 VSIX and
15 ACP tests pass; all 78 owning tests in three complete unit files pass.

P1 declarations drill: suppress generated static declarations in
`packageArchive.mjs`. The complete 46-test VSIX unit file exits 1: only
`retains direct CommonJS named exports through native import and require`
fails. The automatic package-time suite exits 1 with 24/34 failures, including
`vsix hookRuntime.js: native import and require retain baseline exports and calls`.
Restore source byte-exact, then production packaging passes again.

Source before/restored `6a737a6bddcbf8a9399d5a69ddf5023d92ff4b5adb896151f6d6b52633c4fc04`; mutated `108aef27c832653e5cb5573a02b9c07faeb2741c9f2c2c192c7acd9d372f2083`.

P1 reader drill: additionally publish the private reader in the actual
staged `uiText.js`, leaving runtime compilation functional. Exactly
`vsix uiText.js: native import and require retain baseline exports and calls`
fails (1/34); restore the generated file byte-exact, then all 34 pass.

Staged core before/restored `0a25ef2527c6cbb57bbc7e279be846ee08ee7f4e5886aa6515c985374649a68d`; mutated `6ead808d5d77d1402a635ed02b4d5ade2137ccaa4bfd9fd7b983b8fc818f739b`.

Design measurement with the same staged members and VSCE ZIP settings:
keeping the seven actual native-import targets ordinary measures
**2,079,020 bytes / 173,780 headroom**.
Static declarations with all lazy code still archived measure
**2,033,170 bytes / 219,630 headroom**,
**45,850 bytes smaller**; this design retains the most headroom.
Both exceed the unchanged 150,000-byte target and 2,252,800-byte cap.
The alternate package is an unpublished scratch artifact, not product.

Activation remains **447,145 bytes**, SHA-256
`cd0cce336f8b36999a22e68cf3e23f354c0191f26c6ef431c6ae60a9934a640c`,
byte-identical to the unpacked build before repair. The published universal
helper is verified against `_ctx/vsix-0.13.0/SHA256SUMS` and retains the
original 289,568 bytes and digest recorded above. No dependency or cap change.
Both RVMVSIX2 findings are fixed; no P2/P3 review residual is left.

The restored 46-test VSIX unit file passes (27.10 s). Changed-file ESLint
and formatting pass. Knip first correctly reported the new child test as
unregistered; adding its exact path as an explicit entry restores analysis
without an ignore or rule change.

### FIXVSIX2 final gate receipt

Repair commits: `d4369577` (P2), `7e46ce07` (P1). Both hooks ran
ESLint/Prettier and staged Gitleaks successfully; no leaks. No review residual.

All on Kubuntu, directly in this worktree, one tooling run at a time:

- 78 distinct unit tests pass in three complete files:
  `vsixPackaging.test.mjs` (46), `uiTextRegions.test.mjs` (7), `l10n.test.ts` (25).
  The restored VSIX suite passes again after its red drill. P2's separate
  fresh-checkout run passed all 45 then-existing tests without `dist/`.
- Automatic native Node package checks: 34 VSIX + 15 actual ACP tarball
  module tests pass, including callable regressions through both loaders.
- Five-project typecheck; changed-file ESLint/Prettier; plain Knip; jscpd
  (zero clones); localization (14 tables, 164 strings, 590 files, zero problems);
  host API (332 APIs, 31 importers, 25 built-ins, 61 variables, zero problems);
  dpdm cycles; all production size/split/global/notices gates exit 0.
- `npm run package` and `npm run package:acp` exit 0, including the unchanged
  size cap, exec schema and exact staged VSIX/ACP localization checks.
- Actual ZIP member inventory is unchanged. All 27 browser members and
  37 other checked members (helpers, manifest translations, walkthrough,
  licences/notices, eager parsers/recorder and both archives) are byte-identical
  to the reviewed package. Browser JavaScript also matches the unpacked build.
  Every actual ACP tarball file matches its staged bytes. The source archiver
  still has its exact post-drill restoration SHA-256 recorded above.

Final universal VSIX **2,033,170 bytes**, **219,630 bytes
headroom** (target ≥150,000; cap 2,252,800). ACP **951,319 bytes**.
Activation **447,145 bytes**, byte-identical.

Final VSIX SHA-256: `1cd12d473cdbb1a72899c0db89cabc3f400cf54ee15ed3aba9a27b94f176a737`.
Final ACP SHA-256: `05eda977a395d50b009c3192612fc41985f634a040f82feff4282f17b680d7bd`.

Full aggregate quality/coverage, installed-editor activation and other-platform
certification remain the lead's integrated release checks, as the rig brief
requires. No gate threshold, ignore, timeout, skip or dependency was changed.
No merge, rebase, push, network, live or paid model call was made.
