# VSIXROOM — .vsix contents by size (baseline for the headroom lane)

Worktree `/home/randy/lanes/VSIXROOM`, branch `fix/vsix-room`, base `81dacaf5a7`.
Budget `MAX_VSIX_BYTES = 3700 * 1024 = 3,788,800` (`scripts/check-vsix-size.mjs`).
Main's universal .vsix ships 3,783,387 bytes (5,413 under); target is
at least 150 KiB of headroom with the cap unchanged (size at or below
3,635,200 bytes).

## Method

`npm run build` (production) then the repository's own staging pipeline:
`listFiles` from `@vscode/vsce`, compact-JSON staging, the real
`packRuntimeArchive` (lazy `dist/*.js` become small stubs plus the solid
brotli `dist/runtime.bundles.json.br`; `l10n/ui.*.json` become
`l10n/ui.tables.json.br`; `l10n/usage.*.json` become
`l10n/usage.tables.json.br`), the real packaged README/CHANGELOG writers,
then `vsce pack` + `compactVsix` + `compress-vsix.py` + `check-vsix-size.mjs`
(`temp/stage-partial.mjs`, scratch only, not committed).
This rig cannot build the CI-only binaries (arm64 helper, macOS dictate and
screen app, darwin vault), so they are absent here and identical before and
after: baseline partial pack is **3,345,023 bytes**, and branch savings are
measured as the delta of two identical runs. Sizes below are compressed
member bytes from `unzip -lv` of that baseline.

## Contents, largest first (compressed bytes + what reads each)

| Compressed | Member                                                                                | Read by                                                                                                                                                                                                                                                                                                                                                   |
| ---------: | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  1,074,023 | `dist/runtime.bundles.json.br`                                                        | Every lazy-node stub via `readPackedRuntime` in `dist/uiText.js` (69 archived sources; largest: `extension.js` 564,253, `modelApi.js` 526,995, `providerCatalog.js` 331,705, `conversation.js` 251,802, `pageWorker.js` 193,171, `prompts.js` 164,291, `schedules.js` 159,840, `reporting.js` 149,553, `planMarkdown.js` 147,608, `providers.js` 142,455) |
|    858,188 | `l10n/ui.tables.json.br`                                                              | `dist/uiText.js` loader installs the selected language's table (14 locales)                                                                                                                                                                                                                                                                               |
|     71,244 | `dist/uiText.js`                                                                      | Required by every archived stub; ships full (file 94,911) as the archive loader plus the independent English fallback                                                                                                                                                                                                                                     |
|     65,487 | `dist/webview/chunks/CZTOTORU.js`                                                     | Shared webview chunk: `react-dom-client.production.js` (204,927) for lazily mounted surfaces (`installTable`)                                                                                                                                                                                                                                             |
|     40,605 | `resources/walkthrough/open.png`                                                      | `package.json` walkthrough step `open`                                                                                                                                                                                                                                                                                                                    |
|     39,265 | `resources/walkthrough/chat.png`                                                      | `package.json` walkthrough step `chat`                                                                                                                                                                                                                                                                                                                    |
|     36,262 | `dist/webview/main.js`                                                                | Chat panel, `WEBVIEW_SCRIPT_FILE` (`src/shared/constants.ts`)                                                                                                                                                                                                                                                                                             |
|     34,360 | `dist/webview/chunks/WJTMI5FV.js`                                                     | Shared chunk: `src/shared/l10n/en.ts` browser English                                                                                                                                                                                                                                                                                                     |
|     34,035 | `l10n/usage.tables.json.br`                                                           | Usage panel/service (`src/host/usage/usagePanelEntry.ts`, `src/runtime/usage/*`)                                                                                                                                                                                                                                                                          |
|     30,218 | `dist/webview/chunks/BM2MTZEI.js`                                                     | Lazy highlight chunk: `highlight.js` core + 18 registered grammars (`src/webview/highlightRuntime.ts`, via `HighlightedCode`)                                                                                                                                                                                                                             |
|     27,280 | `docs/PRIVACY.md`                                                                     | **No reader found** (see below): removal candidate                                                                                                                                                                                                                                                                                                        |
|     24,677 | `resources/walkthrough/sign-in.png`                                                   | `package.json` walkthrough step `sign-in`                                                                                                                                                                                                                                                                                                                 |
|     20,843 | `dist/webview/chunks/VAKZXC5Z.js`                                                     | Shared chunk: deferred browser surface English                                                                                                                                                                                                                                                                                                            |
|     20,815 | `dist/webview/chunks/TO4IPJIV.js`                                                     | Shared chunk: `react-markdown` pipeline                                                                                                                                                                                                                                                                                                                   |
|     19,809 | `dist/wire.js`                                                                        | EAGER (ships full, 69,815): shared MSP/validation runtime kept directly executable for the ACP preflight cold start                                                                                                                                                                                                                                       |
|     18,637 | `resources/walkthrough/welcome.png`                                                   | `package.json` walkthrough step `welcome`                                                                                                                                                                                                                                                                                                                 |
|     16,316 | `package.nls.ru.json` (and 13 siblings + `package.nls.json`, ~213,000 combined)       | VS Code manifest translations for every command/setting/view (14 locales, `check:l10n` gate)                                                                                                                                                                                                                                                              |
|     16,270 | `dist/webview/chunks/QZ2WSSP2.js`                                                     | Shared chunk: `src/webview/state/uiState.ts`                                                                                                                                                                                                                                                                                                              |
|     16,032 | `dist/webview/chunks/ZSMVPGYG.js`                                                     | Shared chunk: `micromark` core                                                                                                                                                                                                                                                                                                                            |
|     14,908 | `dist/webview/main.css`                                                               | Chat panel page                                                                                                                                                                                                                                                                                                                                           |
|     14,254 | `native/linux/x64/muse-created`                                                       | Created-path helper on Linux x64 (built by `npm run build`; arm64 twin is CI-built)                                                                                                                                                                                                                                                                       |
|     13,753 | `dist/validation.js`                                                                  | EAGER (ships full, 47,820): shared validation runtime, same cold-start reason; CI requires it in the .vsix                                                                                                                                                                                                                                                |
|     13,364 | `dist/webview/chunks/C7EUZMDG.js`                                                     | Shared chunk: GFM micromark extensions                                                                                                                                                                                                                                                                                                                    |
|     12,057 | `package.nls.json`                                                                    | English manifest strings                                                                                                                                                                                                                                                                                                                                  |
|     12,016 | `vendor/…/skills/project_setup/SKILL.md` (vendor tree ~50,000 combined)               | Installed whole-tree copy to the user's skill sources (`src/host/skills/bundledSkillsInstall.ts` `copyTree`)                                                                                                                                                                                                                                              |
|     11,772 | `THIRD_PARTY_NOTICES.txt`                                                             | Legal notices; CI requires it in the .vsix                                                                                                                                                                                                                                                                                                                |
|     11,376 | `dist/webview/chunks/VTS6NJYR.js`                                                     | Shared chunk: `zod` core for the webview                                                                                                                                                                                                                                                                                                                  |
|     11,042 | `native/windows/MuseSparkJob.cs`                                                      | First-use compile by the Windows job runner (`src/host/backend/jobSource.ts`, `jobBuild.ts`)                                                                                                                                                                                                                                                              |
|     10,649 | `dist/webview/chunks/PRYAUJBL.js`                                                     | Shared chunk: resource `zod` validation                                                                                                                                                                                                                                                                                                                   |
|     10,521 | `dist/webview/chunks/V7E4JS5G.js`                                                     | Webview shared chunk (schedules/forms code)                                                                                                                                                                                                                                                                                                               |
|     10,306 | `native/windows/MuseSparkScreenRecord.cs`                                             | First-use compile, screen recording                                                                                                                                                                                                                                                                                                                       |
|     10,270 | `vendor/…/skills/quality_retrofit/SKILL.md`                                           | Same installed skill copy                                                                                                                                                                                                                                                                                                                                 |
|      9,751 | `dist/webview/chunks/LA4WDNCO.js`                                                     | Lazy schedules surface (`ScheduleSurfaceView`)                                                                                                                                                                                                                                                                                                            |
|      9,502 | `vendor/…/docs/QUALITY-REVIEW.md`                                                     | Same installed skill copy                                                                                                                                                                                                                                                                                                                                 |
|      8,681 | `vendor/…/docs/CODE-QUALITY.md`                                                       | Same installed skill copy                                                                                                                                                                                                                                                                                                                                 |
|      8,570 | `readme.md`                                                                           | Packaged marketplace readme (`renderPackageReadme`; source `README.md` 492,679 does not ship)                                                                                                                                                                                                                                                             |
|      7,892 | `dist/recorder.js`                                                                    | EAGER: voice/media recorder entry (`src/extension.ts` `activateWindow`)                                                                                                                                                                                                                                                                                   |
|      7,393 | `dist/webview/referencePage.js`                                                       | Reference page (`LAZY_BUNDLES`, side vscode)                                                                                                                                                                                                                                                                                                              |
|     ~7,000 | `package.json`                                                                        | Extension manifest (compacted at stage)                                                                                                                                                                                                                                                                                                                   |
|     ~3,000 | `CHANGELOG.md`                                                                        | Packaged notes (newest releases + highlights; source 421,450 does not ship)                                                                                                                                                                                                                                                                               |
|      small | `dist/*.js` stubs (60+)                                                               | One-line archive loaders (300–900 bytes each)                                                                                                                                                                                                                                                                                                             |
|      small | `native/windows/*.ps1`, `native/runner/*`, `native/windows/MuseSpark*.cs` rest        | Dictation/capture scripts, runner, vault C# sources for first-use compile                                                                                                                                                                                                                                                                                 |
|      small | `dist/webview/*.css` (models, usage, whatsNew, reference, reporting, resourceHistory) | Their pages                                                                                                                                                                                                                                                                                                                                               |
|      small | `skills/`, `first-party-skills/`                                                      | Skill install (`SKILL.md` + links)                                                                                                                                                                                                                                                                                                                        |
|      small | `media/icon.svg`, `media/icon.png`                                                    | Manifest icon                                                                                                                                                                                                                                                                                                                                             |
|      small | `docs/judge.md`, `dist/judge.js`                                                      | Judge doc + bench bundle (`src/extension.ts` `judgeWindowPort`); CI requires both                                                                                                                                                                                                                                                                         |
|      small | `dist/legal-data/`                                                                    | Legal scan data (`dist/legalScan.js`)                                                                                                                                                                                                                                                                                                                     |

CI-only binaries absent from this rig's pack (identical before/after, in
main's 3,783,387): `native/linux/arm64/muse-created`,
`native/darwin/muse-dictate`, `native/darwin/muse-dictate-screen.app/**`,
`dist/native/darwin/muse-vault`.

## Exclusion hygiene (verified)

No `*.map`, no test/spec files, no fonts, no `media/social-preview.png`
(500,113), no `media/readme/`, no `dist/meta/` in the vsix file list.

## Removals with proof (all stay in the repository)

1. `docs/PRIVACY.md` (73,851 file / 27,280 compressed): the string
   `PRIVACY.md` appears in no built bundle (`dist/`, including all webview
   chunks) and no source file; no code joins a `docs/` path under the
   extension dir; the packaged readme links the privacy policy by its GitHub
   URL, not the local file; the CI required-entries list
   (`.github/workflows/build.yml` `packages` job) does not name it; no
   packaging test names it. Only its `.vscodeignore` allowlist line goes.
2. Walkthrough PNGs become lossless WebP (135 KB -> 81 KB file bytes):
   `chat.png` 42,356 -> `chat.webp` 18,676, `open.png` 44,039 -> 28,444,
   `sign-in.png` 27,395 -> 19,118, `welcome.png` 21,183 -> 14,952
   (`cwebp 1.5.0 -lossless -m 6`). Each decodes pixel-identical (dwebp round
   trip, SHA-256 of decoded RGB equal, checked for all four). The walkthrough
   markdown (`media.markdown`, rendered by VS Code's Chromium webview, which
   reads WebP) points at the new names; no test names the PNG files. Nothing
   the person sees changes by a single pixel.

## Result

Partial pack (same method, same absent CI-only binaries): 3,345,023 ->
**3,275,124 bytes** (**69,899 saved**; per-member deflate makes the delta
transfer to the universal VSIX within ~100 bytes). Mapped onto main's
universal 3,783,387: about 3,713,488, i.e. about **75 KB of headroom**.
The 150 KB target (at or below 3,635,200) needs about **78 KB more**.

## Why the remaining ~78 KB is not taken (negative results, all measured)

Every other byte was checked and is load-bearing; removing any of it cuts
a feature, a locale, or a deliberate resilience property:

- **Archives are optimal.** `runtime.bundles.json.br` (5.57 MB raw) at
  brotli-11 with a 24-bit window saves only 4,824 bytes over the current
  22-bit window; dropping JSON escaping for an index+concat container saves
  only 5,452 bytes (brotli already sees through the escaping). Both were
  measured, not implemented: too little for surgery on the digest-checked
  loader. `ui.tables.json.br` (4.09 MB raw, 14 real translations) gains
  nothing from a larger window (measured: 0 bytes).
- **No dead code.** knip clean; lazy registry has zero `unreached` bundles;
  no module is embedded twice in one bundle (checked every node metafile);
  webview React ships once, code-split, minified.
- **213 unread `UI_TEXT` keys exist but are staged, not dead.** Whole-`src/`
  word search plus built-bundle grep plus `git grep` on the team branches
  plus ruling out concatenated/template key construction (only map-based
  `UI_TEXT[map[k]]` reads, whose literal values the search covers). Every
  cluster traces to a strings-first lane commit for work still in flight:
  `estimate*` (45, M117, wires on `c/m117-6`), `team*` (130, M96 lane 0,
  Oct 4), `playbook*` (M116), `resource*` (M107), `reference*`,
  `provider*`/`suggest*`/`acpProvidersNone`/`signOutRemoveProviders` (M95),
  `hook*`/`hooks*`/`plugin*`/`agentImportKindPlugin` (M91),
  `legal*` (M97), `anthropicCodec*`, `execProvider*`, `promptImportConfirm`
  (M118), `sessionBudgetWriteFailed`. Deleting them destroys in-flight
  translations and risks tonight's own integration. Removing `en.ts` keys
  would fail loud (typecheck), never silent — but the churn is not taken.
- **Rejected:** EAGER-file stubbing (~14 KB, buys into ACP cold-start and
  no-archive resilience), `uiText*` region archiving (~15 KB, removes the
  damaged-archive English fallback the design requires), parse5 replacement
  (~30 KB, loses the most robust HTML parser), lossy image compression
  (pixel change), locale cuts (gate + users), C# prebuilding (deliberate
  first-use-compile decision), chunk consolidation (first-paint budgets).

## Gates and drills (final tree)

- `npm run format:check`: exit 0. eslint: no lint-covered file changed
  (hook lint-staged green on both commits).
- `npm run typecheck` (all five projects): exit 0. `npm run deadcode`:
  exit 0. `node scripts/check-bundle-size.mjs`: exit 0.
  `node scripts/check-l10n.mjs`: 0 problems.
- `npx vitest run test/unit/packagedBundles.test.mjs
test/unit/vsixCompression.test.mjs --maxWorkers=3`: 10/10 pass.
- `node test/packaging/moduleExports.test.mjs vsix temp/vsix-stage`:
  78/78 pass (staged lazy loader healthy).
- Partial-pack `node scripts/check-vsix-size.mjs` on the branch result:
  3,275,124 < 3,788,800, pass.
- Drills: every walkthrough markdown image ref resolves to a staged file;
  all four WebPs decode pixel-identical in two independent decoders
  (cwebp/dwebp 1.5.0 and PIL); walkthrough steps use `media.markdown`,
  rendered by VS Code's Chromium webview. Live walkthrough open NOT RUN:
  no editor on this rig — for the lead.
- Production `npm run build` ran green on this tree's sources before the
  (sourceless) packaging changes; `dist/` is unchanged since.

## PR #230 review dispositions (PR230FIX lane, 2026-10-17, linuxlt)

One line per thread; each is fixed at its cause or answered with a commit
below. Status `DONE` means fixed and measured on this lane; `OPEN` means
the fix is being worked here.

- **vsix-room.md:165 (packed WebP walkthrough proof)** — OPEN: the
  `NOT RUN` stands; fix is a real open of the packed VSIX walkthrough in
  VS Code stable under `xvfb` on this rig (pack, install, open
  `museSpark.gettingStarted`, screenshot, record) — §Drills updated with
  the result when it lands.
- **chat.md:1 (README still names PNGs)** — OPEN, applies: `README.md`
  documents the walkthrough scenes as `*.png`; fix updates the names to
  the shipped `*.webp` and aligns the stated refresh workflow with the
  script that actually produces them.
- **vsix-room.md:98 (no Unreleased entry)** — OPEN, applies: fix adds the
  packaging change to `CHANGELOG.md` under `[Unreleased]`.
- **vsix-room.md:1 (no PLAN.md scope)** — OPEN, applies: fix registers
  the VSIXROOM decision (WebP walkthrough, privacy-doc removal from the
  package, headroom target) in `PLAN.md` §2.
- **vsix-room.md:111 (78 KB short of the 150 KiB target)** — OPEN:
  genuine further savings are measured first; whatever cannot be taken
  becomes an explicit target revision with measured cause here and in
  `PLAN.md` for the lead to approve at merge, so the record no longer
  declares an unmet success.
