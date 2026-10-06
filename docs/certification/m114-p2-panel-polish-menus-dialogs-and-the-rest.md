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

## Final source/state guard-fire record

After the first hooked commit, sixteen complete owning-file runs each exited 1
at their planted guard and restored byte-exact in finally. These clean receipts
supersede the early diagnostic state drills. No test was filtered or skipped,
no timeout was raised and no rule/threshold changed. Each test name below is
under `M114 P2 panel contract`; the remaining cases passed unless the same
mutation intentionally hit both runtime and source-motion checks.

| Mutation          | Named failing test                                                                       | Restored SHA-256                                                   |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| approval-row      | light/320: equal approval decisions stay on one row with complete labels                 | `8387c2b31ec9c830b0589a976a287da398febf3abcfb062ff0cf19d90182ecca` |
| approval-width    | light/320: equal approval decisions stay on one row with complete labels                 | `8387c2b31ec9c830b0589a976a287da398febf3abcfb062ff0cf19d90182ecca` |
| approval-emphasis | light/320: equal approval decisions stay on one row with complete labels                 | `8387c2b31ec9c830b0589a976a287da398febf3abcfb062ff0cf19d90182ecca` |
| keyboard-ring     | light: panel controls have readable hover, pressed, disabled and keyboard states         | `8387c2b31ec9c830b0589a976a287da398febf3abcfb062ff0cf19d90182ecca` |
| hover-contrast    | light: panel controls have readable hover, pressed, disabled and keyboard states         | `8387c2b31ec9c830b0589a976a287da398febf3abcfb062ff0cf19d90182ecca` |
| pressed-contrast  | light: panel controls have readable hover, pressed, disabled and keyboard states         | `8387c2b31ec9c830b0589a976a287da398febf3abcfb062ff0cf19d90182ecca` |
| disabled          | light: panel controls have readable hover, pressed, disabled and keyboard states         | `8387c2b31ec9c830b0589a976a287da398febf3abcfb062ff0cf19d90182ecca` |
| placeholder       | light: panel controls have readable hover, pressed, disabled and keyboard states         | `8387c2b31ec9c830b0589a976a287da398febf3abcfb062ff0cf19d90182ecca` |
| hc-shadow         | hc-dark: overlays and menus use token elevation while every pill stays crisp             | `8387c2b31ec9c830b0589a976a287da398febf3abcfb062ff0cf19d90182ecca` |
| pill-blur         | light: overlays and menus use token elevation while every pill stays crisp               | `8387c2b31ec9c830b0589a976a287da398febf3abcfb062ff0cf19d90182ecca` |
| pill-alpha        | light: overlays and menus use token elevation while every pill stays crisp               | `8387c2b31ec9c830b0589a976a287da398febf3abcfb062ff0cf19d90182ecca` |
| agent-loop        | light: overlays and menus use token elevation while every pill stays crisp               | `8387c2b31ec9c830b0589a976a287da398febf3abcfb062ff0cf19d90182ecca` |
| unguarded-motion  | declares meaningful motion only within the preference guard and leaves host chrome alone | `8387c2b31ec9c830b0589a976a287da398febf3abcfb062ff0cf19d90182ecca` |
| whatsnew-font     | light: What’s New follows editor fonts and exposes complete button/link states           | `45da4b08950e8f231bc40579338ae6be4e57a97ab2729309261c933b00e2ae8f` |
| whatsnew-ring     | light: What’s New follows editor fonts and exposes complete button/link states           | `45da4b08950e8f231bc40579338ae6be4e57a97ab2729309261c933b00e2ae8f` |
| whatsnew-disabled | light: What’s New follows editor fonts and exposes complete button/link states           | `45da4b08950e8f231bc40579338ae6be4e57a97ab2729309261c933b00e2ae8f` |

## Secret-prompt decisions

A's separate secret-prompt dialog finding is also fixed: its existing
Send/Edit actions share the approval row's size, emphasis and non-stacking
layout. No handler, text, focus-trap behavior or surface import changes.
The browser fixture now renders the actual SecretPromptDialog. Its initial
run observed unequal geometry/emphasis in all six themes; the duplicated
modal probe also required first-element focus/evaluation, matching the
computed-style and CDP probes. The final file passes 38/38, and the restored
browser/Modal/QuoteMenu invocation passes 43/43. The source remains styles-only.

| Mutation        | Named failing test                                                    | Restored SHA-256                                                   |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| secret-width    | light: secret-prompt decisions keep equal size and emphasis at 320 px | `d4ad3aa24f589a4d4bbfa285ec0dc457882e73bf9f5cc1b93bb189aa642bacfe` |
| secret-emphasis | light: secret-prompt decisions keep equal size and emphasis at 320 px | `d4ad3aa24f589a4d4bbfa285ec0dc457882e73bf9f5cc1b93bb189aa642bacfe` |

Startup CSS now measures 65,035 → 68,540 bytes (**+3,505 bytes**); the separate
What's New CSS is 6,452 → 9,116 bytes (+2,664). The production build and the
zero-clone duplication gate pass again, with every existing cap unchanged.
The previously recorded 3,410-byte figure belongs to the first commit; this
is the finished P2 stylesheet's measurement.

## Existing behavior and motion regression

The existing P2 regression suites were run in eight serial batches of at
most three files with `--maxWorkers=3` and the repository's default timeout:
TasksApp, AgentMap, BestOfNDialog, DeferredSurface, EffortSlider, ErrorBoundary,
GooeyMenu, HistoryDialog, MentionMenu, Modal, Palette, PopoverMenu, QuestionCard,
QuoteMenu, SessionBoardDialog, ShareView, SignIn, UsageDialog,
reportProblemDialog, paidHost, paidConsent, whatsNewHtml, reducedMotion and
ApprovalDock. The first seven batches pass 229 tests. The last initially passes
22 and fails the existing reducedMotion source check: it splits selectors on
commas and requires the same spelling in the moving and cancelling rules.
The new opening rule used `:is(...)`, while its cancellation listed the plain
selectors. The moving rule now uses the same plain list. No test or gate
changed, and the browser/reducedMotion/ApprovalDock invocation passes 50/50.
The separately run whatsNewPage suite passes four tests. Across these 25
existing files, 256 distinct tests pass.

The selector-only correction reduces startup CSS by five bytes: the finished
measurement is 65,035 → 68,535 bytes (**+3,500 bytes**, below 4 KiB).
What's New stays at +2,664 bytes in its separate page. All five compiler
projects passed earlier; no TypeScript file changed after that run. Final
scoped ESLint and stylelint pass, localization reports zero problems, plain
knip passes with its two existing configuration hints, and jscpd reports zero
clones. The final production build passes tokens, all bundle-size/split gates,
host globals and notices. No budget or hook is changed.

The read-only `npm run check:host-api` exits 1 with exactly one problem: the
S-owned generated `docs/ide-compatibility/host-api.md` differs in its theme
variable inventory (old 61, scanner's current 29). The scanner misses imported
`design/tokens/generated/host-roles.css`. This is the previously named lane
0/P1/S handoff, not a passed gate; neither that record nor the scanner was
rewritten by P2. Full quality, integrated coverage, reviewed visual goldens,
all-editor bindings and the shared changelog remain with the named owners.

The final restoration run exposed two 5,000 ms state-case timeouts (light and
dark), with 42 other cases passing. Rather than raising the timeout, the
browser test now opens one CDP session/document per theme and reuses it for
hover/pressed states, clearing the forced state between controls. The
assertions are unchanged. Scoped formatting/lint and the complete
browser/evidence/whatsNewPage invocation now pass 44/44 in 21.35 seconds,
using the repository's default timeout. This changes test setup only; the
production source and capture hashes remain current.

## Complete after observations

The finished CSS was rebuilt before refreshing all six theme groups. One long
capture process ended with status 143 after light/dark completed; their
receipts were retained and each remaining theme was rerun individually.
The final matrix contains **360 PNGs**, 30 scenes at 320/690 px in all six
themes, with **444 actual renders** covering all 37 P2 audit rows. Browser
150.0.7871.186, en, UTC, DPR 1, fixed virtual clock, reduced motion,
loopback-only traffic. All sources match the final source hashes.

The local PNG archive is 18,913,608 bytes in ignored
`temp/m114-p2-after`; no PNG is tracked. The committed manifest/index carry
source/image SHA-256, byte size, dimensions, computed roles and axe receipts.
There are zero scoped violations. Axe leaves 110 incomplete
contrast entries (1008 nodes); their reasons and targets are retained
as unmeasured. Visual spot checks cover narrow dark approval/secret decisions,
crisp gooey pills and the One Dark Pro History search/focus surface.
These are after observations; S must review goldens and run pixelmatch.

The standard `npm run test:a11y -- <scene>` gate passes all 25 P2 scenes it
supports, serially, across four VS Code themes (**100 pages**). Its separate
unmeasured/exemption reports stay in the scene logs. The five remaining scenes
(crash, deferred-modal, secret, icons, whats-new) use real components in the
P2 driver; all six themes are checked by its scoped axe runs. Existing native
paid-popup policy is covered by the passed paidHost/paidConsent suites.

Reproduce observations after `npm run build` with
`node test/unit/helpers/m114PanelCapture.mjs <theme>` for each of light, dark,
hc-dark, hc-light, one-dark-pro and dracula. Without an argument it captures
all themes. Theme accumulation refuses stale source hashes. Use
`MUSE_M114_P2_CAPTURES_DIR=temp/m114-p2-after npx vitest run test/unit/m114PanelEvidence.test.mjs --maxWorkers=3`
for actual PNG validation. Metadata remains checked without the local archive.
The capture driver is test-only; no product command or setting is added.

## Evidence guard-fire record

Thirteen deliberate corruptions each run the complete owning evidence file
with default timeouts, three workers and local PNG verification enabled.
Each exits 1 at exactly the named test, restores the receipt/image bytes in
finally and matches both SHA-256 values. The in-repository PNG drill also
restores the original directory file list. Only P2's ignored image was changed;
A's before archive was untouched. Logs and JSON remain in `temp/m114-p2`.

| Mutation          | Named failing test (M114 P2 captured evidence)                                                                 | Restored SHA-256                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| matrix            | covers every P2 component at both widths in six themes with current sources and honest axe receipts            | `d1d971b59abf330ade11f7d809040e0f7629871c4a3c501091a0917a9e20b67e` |
| source-hash       | covers every P2 component at both widths in six themes with current sources and honest axe receipts            | `d1d971b59abf330ade11f7d809040e0f7629871c4a3c501091a0917a9e20b67e` |
| source-inventory  | covers every P2 component at both widths in six themes with current sources and honest axe receipts            | `d1d971b59abf330ade11f7d809040e0f7629871c4a3c501091a0917a9e20b67e` |
| render-coverage   | covers every P2 component at both widths in six themes with current sources and honest axe receipts            | `d1d971b59abf330ade11f7d809040e0f7629871c4a3c501091a0917a9e20b67e` |
| computed-roles    | covers every P2 component at both widths in six themes with current sources and honest axe receipts            | `d1d971b59abf330ade11f7d809040e0f7629871c4a3c501091a0917a9e20b67e` |
| axe-violation     | covers every P2 component at both widths in six themes with current sources and honest axe receipts            | `d1d971b59abf330ade11f7d809040e0f7629871c4a3c501091a0917a9e20b67e` |
| incomplete-reason | covers every P2 component at both widths in six themes with current sources and honest axe receipts            | `d1d971b59abf330ade11f7d809040e0f7629871c4a3c501091a0917a9e20b67e` |
| png-in-git        | keeps image bytes outside git and checks PNG dimensions, length and SHA-256 when the local archive is supplied | `d1d971b59abf330ade11f7d809040e0f7629871c4a3c501091a0917a9e20b67e` |
| png-signature     | keeps image bytes outside git and checks PNG dimensions, length and SHA-256 when the local archive is supplied | `218ec35705772943ec55dbf1914053db36b1be51f5d3be05c519f1326e2fb18a` |
| png-width         | keeps image bytes outside git and checks PNG dimensions, length and SHA-256 when the local archive is supplied | `218ec35705772943ec55dbf1914053db36b1be51f5d3be05c519f1326e2fb18a` |
| png-height        | keeps image bytes outside git and checks PNG dimensions, length and SHA-256 when the local archive is supplied | `218ec35705772943ec55dbf1914053db36b1be51f5d3be05c519f1326e2fb18a` |
| png-length        | keeps image bytes outside git and checks PNG dimensions, length and SHA-256 when the local archive is supplied | `218ec35705772943ec55dbf1914053db36b1be51f5d3be05c519f1326e2fb18a` |
| png-digest        | keeps image bytes outside git and checks PNG dimensions, length and SHA-256 when the local archive is supplied | `218ec35705772943ec55dbf1914053db36b1be51f5d3be05c519f1326e2fb18a` |

Together with the 21 source/style drills, **34 deliberate guard failures**
were observed and restored. The final browser/evidence/whatsNewPage run passes
44/44 after restoration. Across 27 scoped files, **296 distinct tests pass**.
No filter, skip or timeout override is used. Final prettier/scoped lint and
`git diff --check` pass; production build budgets remain unchanged. Full
quality and reviewed visual regression remain the explicit lead/S handoffs.
