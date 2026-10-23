# RLF-M111L0 — M111 lane 0: mockups, contracts, strings and tokens

Base: int/recovery at `f53ef168f` (0.19.0). Rig: linuxlt. Date: 2026-10-23.

## What landed

1. The owner-approved 18-screen mockups ("looks great", 2026-10-23) are the
   design reference at `docs/design/m111-mockups/` (canvas sources + viewer +
   README naming each screen). PLAN's M111 status records the approval and
   Q-M111 item 6 is closed. The mockups' tiled detached terminal diverges
   from D91.13; D91.13 (floating) governs and the contracts say so.
2. `src/shared/desktopContracts.ts`: workbench regions and frame sizes,
   bar popovers, launcher result kinds and modes, greeter/lock auth factors
   and lock actions, system prompt kinds, tiling rules, the onboarding pack
   schema, preview device presets and viewport schema, pseudo-RTL rule.
3. The `desktop` string group (52 keys) in English and all 14 tables.
4. Tokens in `design/tokens/muse.tokens.json` (generated files rebuilt, never
   hand-edited): `--ms-bar-height` 32px, `--ms-status-height` 24px,
   `--ms-rail-width` 48px, `--ms-rail-button-size` 44px,
   `--ms-rail-icon-size` 20px, `--ms-motion-flip` 280ms, real
   `--ms-syntax-{keyword,string,function,number}` colours in all four
   themes (was: alias of `--ms-text`), `--ms-divider` (softer, decorative),
   `--ms-on-warning`, `--ms-git-modified`.

## Proof

- `npm run check:tokens`: 0 problems (contrast in dark, light, hc-dark,
  hc-light; syntax on code-surface ≥ 4.5:1 measured 5.22–19.56).
- Red/green drill: dark syntax-keyword set to rgb(0.2,0.2,0.2), tokens
  rebuilt → `check-tokens` exit 1, `dark: colour.syntax-keyword on
colour.code-surface: 1.167:1 < 4.5:1 (text)`; restored → exit 0.
- `test/unit/desktop/contracts.test.ts` (5 tests): contract frame sizes
  cross-checked against generated `muse.css`; schemas accept mockup shapes
  and reject unknown fields; RTL rule; floating detached terminal.
- `node scripts/check-l10n.mjs`: 0 problems (14 UI + 14 usage tables).
- `npm run ui:look -- tools-open` (light + dark,
  `TMPDIR=<worktree>/temp`): `tools-open.light.png` / `tools-open.dark.png`
  beside this record; visually inspected (diff and code surfaces render
  with the rebuilt token CSS).
- Suites: `checkTokens.test.mjs`, `l10n.test.ts`, `desktop/contracts.test.ts`
  — 41 passed. `npm run typecheck`: exit 0.

## Gate exit codes on the final tree

check:tokens 0 · check-l10n 0 · check:reference 0 · check:host-api 0 (record
regenerated for `--vscode-gitDecoration-modifiedResourceForeground`) ·
check:roadmap 0 (regenerated) · cycles 0 · eslint (touched TS) 0 ·
prettier (touched) 0 · typecheck 0.

Failing at the base as well (measured, not this lane's doing): `npm run
build` bundle budgets (identical OVER list and sizes on `f53ef168f`: e.g.
modelApi 544.3 KiB both), `check:plan` (base PLAN.md is 3,769,703 bytes,
already over the 3,565,158 archive bound), `check:catches` (runtime/webview
counts; this lane's files contain no catches), `duplication` and `deadcode`
(all remaining findings in files this lane did not touch).
