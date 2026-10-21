# MSM99: What's New in other editors (M99, PLAN.md D79)

Recorded 2026-10-17 on branch `ms/msm99`, from candidate
`rigs/win11/feature/m99-whats-new` (`85c3f0273`, fully incorporated: it is an
ancestor of this branch) merged with `main-now` (`3d30a7321`, merge
`9dc37b14a`). The VS Code side of M99 is unchanged and its acceptances still
hold (`docs/certification/m99.md`); this lane connects the built-but-unreached
part: after an update, a person in another editor (Zed, Neovim, Emacs, any ACP
client) reads this version's release notes without leaving the editor.

## What was finished, and where it connects

- **The renderer** (`src/core/whatsNew/whatsNewText.ts`): the shipped content
  tree (`src/core/whatsNew/whatsNewContent.ts`, the same schema the page
  renders) as plain text — title, version or upgrade range, releases newest
  first with Highlights, sections, quotes, ordered and unordered lists, `pre`
  blocks, inline code, links as `text <url>`, the earlier-notes pointer when
  shortened, and the full-changelog link. Pure (no `vscode` import), so the
  ACP agent and the unit tests read the real module. The notes stay English
  (D79); only the wrapping words are the installed display language's through
  the same table keys the page reads, so no new translated string was needed.
  Try-its stay out: another editor has no channel that runs them.
- **ACP's `/whatsnew`** (`src/acp/agent.ts`): announced in
  `availableCommands` (line 551, beside `help`, `vault`, `accounts` — the same
  literal shape those commands use), kept out of the installed-skill list
  (line 648), answered at line 1924: one `/whatsnew` text part ends the turn
  with `whatsNewText()` (lines 1225–1239), which reads `dist/whatsNew.json`
  beside the agent bundle (`WHATS_NEW_CONTENT_FILE`, `src/shared/constants.ts`
  line 1246), checks it with `parseWhatsNewContent`, and renders it for the
  installed version. A missing or unreadable file is logged with its path and
  answered with the generic failure — never an empty success.
- **Shipping** (`scripts/lib/acpBundles.mjs` line 90): `whatsNew.json` rides
  in the ACP package beside the agent bundle (data, never code, so no
  lazy-registry row). `dist/whatsNew.json` itself is still written by
  `npm run build` from CHANGELOG.md; no new build step.
- **Help and docs**: `/help` over ACP lists `/whatsnew` automatically through
  `compactReference` (`src/shared/cliCommands.ts`); the command is documented
  in `docs/acp.md` (line 364, beside `/accounts`), `README.md` (line 560) and
  `CHANGELOG.md` (line 13). ACP-only commands (`/accounts`, `/vault`) are not
  in the generated reference or `referenceAcp`, and neither is `/whatsnew` —
  that matches the M108 precedent. `docs/ide-compatibility/host-api.md` was
  regenerated for the one new `node:fs` read.

## Tests

- `test/unit/whatsNewText.test.ts` (7 tests): wrapping words, version and
  upgrade-range leads, no-notes and shortened cases, quotes/ordered-lists/pre
  blocks, the installed language read at render time, and checked content for
  the installed version — all through the real renderer. Pass.
- `test/unit/usagePackaging.test.mjs` (12 tests): the fixture gains
  `dist/whatsNew.json`; the suite proves the packager ships it. Pass. (First
  run failed on a missing declared `pngjs` install in this worktree —
  environmental, fixed with `npm install --no-save`; no tree churn.)
- `test/e2e/acpStdio.e2e.test.ts` (new case, line 411): the e2e fixture
  (`test/e2e/acpFixture.ts`) lays `dist/whatsNew.json` beside the built
  `acp.js` exactly as the published package ships it (generating it with the
  build's own writer when no build has). Over real ACP stdio on the fake Muse
  Code CLI, `/help` lists `/whatsnew` and `/whatsnew` ends the turn with the
  notes title, a release heading and the changelog link, with zero tool calls
  — no model send. Pass.
- **Red drill**: renaming the announced command to `whatsnew2` fails the new
  e2e case on the `/help` assertion (`expected … to match /\/whatsnew\b/`);
  reverted, green again. The first drill wording (`toContain('/whatsnew')`)
  passed against `whatsnew2`, which is why the assertion uses a word
  boundary.

## Gates (final tree, this rig)

| Gate                     | Result                                                                  |
| ------------------------ | ----------------------------------------------------------------------- |
| format (`format:check`)  | exit 0                                                                  |
| eslint (zero warnings)   | exit 0                                                                  |
| typecheck (all projects) | exit 0                                                                  |
| knip (`deadcode`)        | exit 0                                                                  |
| cycles (dpdm)            | exit 0, none found                                                      |
| duplication              | exit 0, 0 clones                                                        |
| `check:l10n`             | exit 0, 0 problems                                                      |
| `check:reference`        | exit 0, current                                                         |
| `check:host-api`         | exit 0 after `--write` regen                                            |
| `check:plan`             | exit 0, 0 drift                                                         |
| `check:roadmap`          | exit 0, current                                                         |
| `check:tokens`           | exit 0, 0 problems                                                      |
| `npm run build`          | exit 0                                                                  |
| `security:sast`          | exit 0 (semgrep 1.178.0 in a venv; not preinstalled on the rig)         |
| touched suites           | whatsNewText 7/7, usagePackaging 12/12, acpStdio `/whatsnew` case green |

`node scripts/package-acp.mjs` alone still stops on this rig at the missing
macOS helper (`native/darwin/muse-dictate`): the full ACP package needs the
multi-platform artifacts CI builds. The content-file leg it owns
(`whatsNew.json` in `ACP_BUNDLES`) is proven by the usagePackaging suite and
the e2e fixture instead.

## Real-life steps for the lead

1. Publish the ACP package from a tree with this lane (`npm run package:acp`
   on a machine with the platform artifacts, or CI's package job) and point
   an ACP editor at it (Zed, Neovim + CodeCompanion, Emacs — `docs/acp.md`).
2. Open the editor's slash-command menu: `/whatsnew` is listed.
3. Send `/whatsnew`: the reply is this version's highlights and full notes as
   text, ending the turn with no model call and no spend. The editor still
   opens a session first, which on either backend needs its usual sign-in
   (Muse Code's, or the stored Model API key): a signed-out editor is
   asked to sign in at `session/new`, before any prompt — the command
   itself never reaches a model.
4. Send `/help`: the command list names `/whatsnew`.

## RVMSM99 review addendum (2026-10-17)

Review lane `rv/msm99` (Muse Wonder Full) re-ran the claims above; the full
record is the lane report (`RVMSM99.report.md`). Fixed on the review branch:

- **F1**: `whatsNewTextForContent` rendered every release the content file
  ships; it now selects with `releasesToShow` exactly as the page's manual
  open does, so "this version's notes" is true. New unit case (8 in the
  suite); the e2e fixture's laid-out package now carries the repository
  version its notes cover (a `0.0.0-e2e` package honestly has no notes).
- **F2**: `/whatsnew` with trailing words fell through to a model turn
  (proven red: the backend echoed the prompt). The reserved name now
  answers locally for anything after it, decided on the one typed text.
- **F3**: the packaging suite now asserts `package/dist/whatsNew.json` is
  in the tarball; before, it only had to be present as a fixture input.

What "proven" means here, restated: `/whatsnew` and its `/help` listing are
proven over real ACP stdio against the built agent (on the fake Muse Code
CLI the stdio suite uses; the asserted notes text is content that fake
never produces). No real editor ran `/whatsnew` on either lane: Zed,
Neovim and Emacs are the already-proven ACP hosts of record
(`docs/ide-compatibility/hosts.md`, Preview), and step 1–4 above remain the
lead's real-editor run.
