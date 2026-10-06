# M114 P2 panel surfaces — Kubuntu, 2026-10-06

The brief's colon/comma certification filename is normalized here to a portable
filename: Windows cannot check out a path containing a colon.

Lane P2 only, branch `m114/p2`, base `28ffc2def`. Read the rig brief, shared
Codex rules, AGENTS.md, PLAN D94/M114 in full, desktop research §13, the token
contract and lane 0/A/P1 certification and audit. No dependency, installation,
credential, remote request, model call, paid call, push, merge, rebase, hook or
budget change. The worktree's `.husky/_/pre-commit` exists. Full quality and
integrated coverage/visual gates remain with the lead under the lane brief and
PLAN §7; this lane runs the scoped suites directly with default Vitest timeouts.

## Implementation

P2's existing CSS regions now use the generated semantic colour, radius,
spacing, typography, elevation and motion roles. Dialogs use the larger radius
and overlay elevation; menus/pickers use popover elevation. High contrast and
forced colours replace their shadows with explicit borders. Account & usage,
History, sign-in/onboarding, handoff/report/secret dialogs, Agent map,
question/elicitation cards, session board/best-of-N, Git forms, review panes,
share views, the separate read-only task tab and What's New share control
states and readable keyboard rings. Conversation declarations remain P1-owned.
Imports of dialog/menu/settings/history modules are unchanged for DIET1.

Approval decisions have equal width, height and emphasis on one row, including
Reject, at 320 px. Long labels ellipsize visually while the complete text and
title remain. Locked decisions retain equal disabled styling. History archive
actions use opacity rather than visibility, remain in the Tab order, and reveal
on row focus. Scrollable menus reserve room for exterior rings; the Account
usage switch no longer clips its buttons' rings. Enabled field placeholders
use the input foreground to fix the captured third-party theme failures.

Gooey menu items retain opaque, crisp icon-and-label pills in their existing
fan geometry, without a filter, backdrop blur or shadow. Dialog/popover opening and pill/toggle motion
uses base/fast tokens only inside no-preference. The decorative agent pulse is
removed. What's New uses editor UI/code fonts and semantic roles, with complete
button/link states and a visible inset ring on its clipped code scroller.
No new user-facing text, command, setting, feature-catalog row or translation
key is introduced. No backend, selected-model behavior or consent policy changes.

## Ownership and integration handoffs

- **Paid popup and toasts:** this base's paid question is
  `vscode.window.showWarningMessage` in `src/host/paid/paidHost.ts`, not a React
  surface. Native notification/quick-pick/popup styling remains the host's
  under D94.2. Existing paid-host and consent tests verify the three choices,
  price/budget and admission behavior; no paid call is made here. Native
  counterpart bindings stay with their host owners.
- **Lane 0:** the distinct host-error foreground role remains absent. Existing
  direct `--vscode-errorForeground` reads keep their meaning until that owner
  supplies a captured mapping. No token source/generated output is edited.
- **DIET1:** only styles were changed in production; no surface import or
  lazy-loading structure is changed. Bind these same rules to its lazy chunks.
- **S/lead:** refresh P1's stylesheet source hash/captures after integration,
  review P2's after observations, finish pixelmatch goldens and the all-editor
  visual/accessibility/quality matrix. The existing host-API/source-inventory
  scanner omission of imported generated host roles remains S/lane 0-owned;
  do not delete theme fixture variables to hide it.
- **S docs:** CHANGELOG/README/CONTRIBUTING remain S-owned. Changelog handoff:
  “Polish menus, pickers, dialogs, Account & usage, History, task windows and
  What's New with shared theme tokens and complete control states; keep
  approval choices equally sized and emphasized on one row at narrow widths,
  preserve crisp gooey pills, and make History archive actions reachable by
  keyboard.” No new help-reference entry is needed for styling existing UI.
- **C/N/D:** this shared React/CSS works across host shells. Their actual
  companion/native/node/desktop bindings remain with their named lanes, absent
  here. No VS Code UI selector, remote font/stylesheet or CSP change is added.

## Verification record

The new browser suite compiles CSS and the actual ApprovalCard once in
beforeAll, then uses the repository timeout for each case. Class probes cover
six themes, both 320/690 px approval layouts, contrast, focus/hover/pressed/
selected/disabled states, editor fonts, explicit HC elevation, crisp pills,
meaningful guarded motion and unchanged pixels under reduced motion.
Before changes it failed 30 cases (stacked/unequal decisions, old focus/radius
and What's New states), with one old motion case passing. The first updated
run passed 31; the ApprovalDock/GooeyMenu invocation passed 57 total. Additional
motion/source and evidence guards and final results are recorded below.

The first production build passed token, size, split, host-global and notices
gates. Extension 438.4/600 KiB, Model API 446.9/475 KiB. Production-equivalent
CSS builds of this lane's base vs current code measured startup CSS
65,035 → 68,445 bytes (**+3,410 bytes**, below 4 KiB) and the separate What's
New CSS 6,452 → 9,116 bytes (+2,664). No startup or activation JavaScript
changes; no cap is raised. Integrated M114 growth from P1 remains the lead's
accounting handoff, not a claim that the combined milestone meets its target.

Actual after scenes use the existing fake host and components, six theme
captures and both widths. PNGs stay in ignored `temp/m114-p2-after`; only the
manifest/index are committed. Before images remain untouched in
`/home/randy/archive/m114-a-before-17d7`. These are observations, not reviewed
goldens. The manifest preserves all incomplete axe findings as unmeasured.

The final initial implementation passes all five compiler projects, scoped
JavaScript/CSS lint and 58 tests in the new browser/ApprovalDock/GooeyMenu
invocation. No timeout override. Visual inspection of actual dark/320
approval and gooey scenes confirms equal decisions and opaque crisp pills.
The 60 dark observations have zero scoped axe violations; incomplete contrast
findings are retained, not declared passes.

The CSSOM source-audit approach was stopped after two corrections still failed:
Chrome serializes `animation: none` with reordered defaults, while declarations
containing `var()` do not expose populated longhands. Those runs are diagnostic,
not counted as clean drills. The guard now reads authored declarations and
tracks their enclosing media blocks, with the separate browser test verifying
actual durations and reduced-motion frames. No gate is weakened or skipped.
Capture setup also corrected the What's New nonce and
kept its test-only host shim configurable for the harness's own fake host.
No production CSP or bridge changed.

## Opening guard-fire record

The whole owning file runs with default timeouts, three workers and no filter.
Each mutation exits 1 at the named guard, restores in finally and matches SHA-256.
The restored file then passes 32/32. Logs/JSON stay in ignored `temp/m114-p2`.

| Mutation          | Named failing tests (M114 P2 panel contract)                                                                                                                         | Restored SHA-256                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| opening-duration  | declares meaningful motion only within the preference guard and leaves host chrome alone; guards opening and toggle motion and stops all frames under reduced motion | `1bb1ab377590dd06e3c0f043b06b456884965f8722131189bd5d864c1186fdc1` |
| opening-unguarded | declares meaningful motion only within the preference guard and leaves host chrome alone; guards opening and toggle motion and stops all frames under reduced motion | `1bb1ab377590dd06e3c0f043b06b456884965f8722131189bd5d864c1186fdc1` |

## Field contrast and duplicate declarations

The added input-boundary assertion first failed in four themes, including
One Dark Pro 1.692:1 and Dracula 1.218:1, below the unchanged 3:1 UI threshold.
P2's fields now use the readable muted text role for their essential border,
matching P1's composer approach. Placeholders still use input text at opacity 1.
The deliberately invisible border fails all six state cases, restores byte-exact
and the restored suite passes 32/32. The three-file regression run passes 58/58.

The duplication gate exposed eight CSS clones. Shared field/card/action
properties are grouped once in P2's regions, and the repeated parent surface
list now encloses its states with native CSS nesting. Agent dots declare a
square aspect ratio with their inline size rather than two independent sizes.
No P1 declaration, ignore, gate threshold or rule changed. `npx jscpd` passes
with zero clones; plain knip passes with two existing configuration hints.
The production build passes again at 66.8 KiB main CSS and 8.9 KiB What's New
CSS. Startup growth is 3,410 bytes after this consolidation.

| Mutation     | Named failing test                                                                                      | Restored SHA-256                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| input-border | M114 P2 panel contract light: panel controls have readable hover, pressed, disabled and keyboard states | `8387c2b31ec9c830b0589a976a287da398febf3abcfb062ff0cf19d90182ecca` |
