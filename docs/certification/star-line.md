# STAR — quiet GitHub star line

## Readiness review (2026-10-05)

Scope comes from the owner's `STAR.md` and `common.md` lane briefs. Source
starts clean at `8c894b60aeb4c8c8ea67b8d08e25992f4b732f3f`, branch
`feature/star-github`. No live model calls or publishing are needed.

Reuse the existing Marketplace README staging in `scripts/package-vsix.mjs`,
the footer's `PageWriter.link`, host index validation and `openExternal`,
and existing theme, focus and wrapping CSS. The walkthrough has one English
markdown resource and 14 translated manifest descriptions; no localized
markdown variants exist. One runtime display-table key suffices by linking
the whole sentence. No new module, dependency, eager import or CSS is needed.

Acceptance is recorded next to PLAN.md D79. Tests cover all English source
surfaces, the actual staged README, footer/index/escaping and host dispatch;
existing localization and manifest checks cover table parity. Builds measure
activation before and after on the same Mac mini slot. Two removal drills
must fail for the missing line, restore matching SHA-256 and return green.

Local inventory: Windows, Node `v24.20.0`, npm `11.19.0`, Python `3.14.0`;
fresh worktree-owned `npm ci --ignore-scripts` passed. No dependency changes.
The feature-delivery structural validator reports `plan: expected exactly
one quality-ledger fence`; its readiness/closure validation is deferred
because the canonical project plan uses its established milestone format.
The owner's scoped brief does not authorize a plan-format retrofit. This
manual readiness review is not a passing structural-validator claim.

## Tests and red drills

Mac mini, dedicated `star` slot, macOS `15.7.4`, Node `v24.21.0`, npm
`11.19.0`, Python `3.14.7`, Vitest `5.0.2`. The initial green run
passed all 110 tests in eight files: `readmeVersion` (4), `vsixPackaging`
(17), `whatsNewHtml` (11), `whatsNewPanel` (9), `manifest` (34), `l10n`
(26), `whatsNewBundle` (5), `whatsNewPage` (4). The restored run passed
the same 110 tests, with no skips. This includes the existing axe check
(jsdom, without colour contrast), CSP checks and page keyboard dispatch.

Commands use the brief's `rig-run.sh macmini C:/Users/Randy/Coding/mx-star
star npx vitest run` followed by those eight `test/unit/*.test.*` paths.
Drills use the same configuration, with complete affected files only:

| Mutation                                          | Test files                                        | Intended observed failure                                                      | Exit | Counts              |
| ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ | ---- | ------------------- |
| Remove the line from `docs/marketplace-readme.md` | `readmeVersion.test.ts`, `vsixPackaging.test.mjs` | Source welcome/README guard and actual staged README both lack the sentence    | 1    | 2 failed, 19 passed |
| Remove the footer's `writer.link` line            | `whatsNewHtml.test.ts`, `whatsNewPanel.test.ts`   | Footer has zero star links; repository index and host-dispatch assertions fail | 1    | 4 failed, 16 passed |
| Bypass `escapeHtml` for the star sentence         | `whatsNewHtml.test.ts`                            | Installed text's injected `<img>` becomes markup rather than literal text      | 1    | 1 failed, 10 passed |

Each drill saves original bytes and restores in `finally`. SHA-256:

- Marketplace README before and restored:
  `87dcea0f9c5ebc5c42d056ffcbe007bb3e0ec57a0032f8feea87d8f4d5644d3b`;
  removed-line mutation:
  `da920ac59886df0fcb9df7ee1c71d32c9c6cef17f886df893036d9741b16ec28`.
- Renderer before and restored after both drills:
  `d8b6e1e0794df8de467603f6a03528916eed4f5bc2ef3405f68c53ce13289966`;
  removed-footer mutation:
  `c3aed12510b85503f10cfdc187ef2aac73a8e334baa3c57862948baa90f56563`;
  unescaped-text mutation:
  `4d940b4fdd75b23b463e2a0810da0c3170829f9e6141a1c78a09bb9088dff46a`.

Local ignored receipts: `temp/star-green.log`, `temp/star-drills.log`,
`temp/star-red-readme.log`, `temp/star-red-footer.log`,
`temp/star-red-escaping.log`, and restored results in `temp/star-gates.log`.

## Gates and packaging

Mac mini's final scoped gate snapshot `35dbf0a8` passed each command, exit 0:
the eight test files above; `npm run typecheck` (all five projects); scoped
`npx eslint --max-warnings=0` on the seven changed TS/MJS files; full
`npm run lint`; `npm run deadcode`; `npx jscpd` (zero clones);
`npm run check:l10n` (14 tables, 131 manifest strings, zero problems);
`npm run check:host-api` (zero problems); and `npm run package`, which ran
`npm run build` with every size, split, host-global and notice check passing.
The packaged localization check also reports zero problems. PowerShell lint
is skipped by design on macOS; the actual Windows `node scripts/lint-ps.mjs`
run passed with zero PSScriptAnalyzer findings.

The first full lint run caught two selectors in the new renderer tests:
missing `:scope` and an interpolated CSS selector. Use scoped queries and
compare the anchor's `href` directly; no rule or assertion was weakened.
The final eight-file run passed 110 tests after this fix. A local scoped
ESLint run was stopped after slow dependency loading; the same complete
scoped command passed on the Mac mini. Local `git diff --check` passed.
Final formatting receipt: `temp/star-format-final.log`. Commit hooks are
enabled: serial lint-staged formatting/lint and staged gitleaks, with no bypass.
The initial staged secret scan misclassified the documented escaping-drill
SHA-256 after its mutation label. Rename that label while retaining the full
digest and unchanged scanner rules; no exclusion or suppression is added.

`npm run package` produced a private `muse-spark-code-0.13.0.vsix`,
**2,083,797 bytes**, within the unchanged **2,252,800-byte** cap. Independent
ZIP inspection found `extension/readme.md` (VSCE lowercases this filename),
12,107 bytes, byte-identical to `docs/marketplace-readme.md` and the staged
README. It contains exactly one linked star sentence. The archive also
contains the welcome markdown, English manifest description, and all 14
translated UI/manifest pairs with matching sentences and repository links.
This rig package lacks the built macOS dictation helper and is not universal
release certification. It was neither published nor installed for a live
editor test. Detailed receipts: `temp/star-final-gates.log`,
`temp/star-windows-ps.log`, `temp/star-archive-selection.log`,
`temp/star-inspect.log`, `temp/star-final-drills.log`, and
`temp/star-final-restored.log` (110 passed after the final drills).

## Bundle comparison

Production builds on the same Mac mini `star` slot, baseline source
`8c894b60` (build snapshot `fd9a8a85`), final source as tested above:

| Artifact                            | Before (bytes) | After (bytes) | Growth (bytes) |                     Cap (bytes) |
| ----------------------------------- | -------------: | ------------: | -------------: | ------------------------------: |
| `dist/extension.js`                 |        596,065 |       596,065 |              0 |                         614,400 |
| `dist/whatsNew.js`                  |         16,997 |        17,098 |            101 |                          51,200 |
| `dist/uiText.js`                    |        122,182 |       122,274 |             92 |                         128,000 |
| `dist/webview/main.js` (entry only) |        616,789 |       616,789 |              0 | Startup graph capped separately |
| `dist/webview/whatsNew.js`          |            708 |           708 |              0 |                          25,600 |

Activation's before/after SHA-256 is identical:
`41d8df4895c2f2d9430ff1088d2d1d6c1497fd7834993f05c8d966466cd9a345`.
It also stays below the brief's 600,000-byte train target. The chat startup
graph measures 877.3 KiB before and 877.4 KiB after, within its 900 KiB cap;
the shared English table's new key is the only chat-content addition, with
no rendered panel line. Existing footer CSS keeps native link focus outlines,
theme colours, and wrapping at narrow widths; the page's CSP is unchanged.
The test evidence covers axe without colours and keyboard dispatch, not a
new installed-editor or screen-reader certification.

## Handoff limits

`integrate/m72-on-24ff` is absent; this lane starts on the newer released
`origin/main`, and `git merge --no-edit origin/main` reported already up to
date. No dependency, threshold, ignore, permission, wire or startup import
changed. No feature blocker remains. Full quality and universal release
certification belong to the release lead, as the lane brief requires. The
generic ledger-format validator remains deferred as described above.
