# PLAN.md archived milestone sections

Closed milestone sections (merged, released, complete or superseded) moved here
from PLAN.md §6 to keep the plan under the `check:plan` 4 MiB reader bound
(lead decision, combined 0.17.0 integration, 2026-10-08). PLAN.md keeps each
milestone's heading, its status rows and a pointer here; every decision (D-entry)
stays in PLAN.md §2. Text below is unchanged from PLAN.md.

## FIX0160X — Repair release CI composition (2026-10-07, macmini)

**Status 2026-10-07: released.** Shipped in 0.16.0 (§10).

Preserve M106/M107, pinned questions and agent outcomes while repairing the
five owning CI suites and universal/fake-only packaging. Update stale ACP
command and Help-process fixtures; exercise the harness's ready handshake;
build complete bundle inventories in an owned tree. Supply native helpers in
cold exec fixtures and the Action's package job without relaxing real package
requirements. Diagnose Linux architecture delivery before changing its guard.
Run complete owning files at repository deadlines, five typechecks, lint,
formatting, plain knip, duplication, reference/localization/host API, production
build and both packagers. No merge, push, paid/live calls or Windows-lane edits.
Record causes, deliberate failures and restored checks in
`docs/certification/fix0160x.md`. Shared lane rules reserve aggregate quality
and hosted multi-OS qualification for the lead (see §7).

All five failing files and the Action/VSIX regressions now pass: 200 tests
across seven complete files at repository deadlines, with four deliberate
red/restored guard drills. Five typechecks, full local lint, changed-file
formatting, plain knip, duplication, reference, localization, host API and
production build pass. Actual VSIX/ACP packaging fails closed because both
Linux helper inputs are absent on this Darwin worktree; Q-FIX0160X-LINUX-ARTIFACTS
remains open. The Windows capture's `routeUnconfirmed` comes from the browser
confinement verifier outside this lane; no guard is relaxed or Windows file
changed. Full hosted qualification and aggregate quality remain lead-owned.

## REL0160 — Prepare the 0.16.0 release (2026-10-06)

**Status 2026-10-07: released.** Shipped in 0.16.0 (§10).

**Status: M106/M107 joined; promotion waits on `sync/main-0160` and failed size qualifications.**
The authorized first join is `git merge --no-ff m107/w` at `e8b6d24ae`,
recorded as `06904a410`, onto main `8c6351d73`. Preserve all M107 repairs,
generate reference/host/schema artifacts with their own generators, and move
its unreleased notes out of older dated release sections into the 0.16.0 draft.
Prepare three Highlights covering strict tool contracts and loop limits/previews,
CPU/memory throttling and eligible relocation, and free-disk floors. Keep every
named M107 native/editor/storage qualification visible; component tests do not
certify a missing production binding.

The round-2 brief authorizes `git merge --no-ff sync/m106-final` at
`3e0c0c603`, completed as `61d61038e` with both feature sets and regenerated
reference/host/schema records. Merge `sync/main-0160` when supplied with
0.14.4/0.15.0, then bump the manifest/lock and generated ACP package together
to **0.16.0**. Preserve main's 0.15.0 notes as README's **Earlier in 0.15**.
Until then the 0.16.0 changelog/README stay explicit drafts and the manifest
remains 0.14.3. Final merged-source receipts and size/native qualifications
are recorded in `docs/certification/rel0160.md`; no failed gate is waived.

## INT0160UX — Integrate 0.16.0 UI features on 0.15.0 (2026-10-07, linuxlt)

**Status 2026-10-07: released.** Shipped in 0.16.0 (§10).

- [x] Merge QPIN `dcac54ea5` with `git merge --no-ff`, retaining current
      release repairs and the pinned question surface.
- [x] Merge agent outcomes `c79cd749a` with `git merge --no-ff`, retaining
      current team, question and agent-map behavior and all localized keys.
- [x] Audit the older agent-outcomes changes against current runtime paths;
      add regression tests and prove any repair with a byte-restored red drill.
- [~] Verify committed code in a fresh clone after `npm ci`, with `CI=true`:
  five typechecks, lint, formatting, plain knip, duplication, reference,
  localization, unchanged production budgets and four default-timeout
  coverage shards with merged thresholds.
- [ ] Run the accessibility harness; regenerate README screenshots and replace
      only images changed by these features. Record commands, counts, drills
      and blockers in `docs/certification/int0160ux.md`.

Fresh-clone lint reproduced an unchanged release-base violation in
`scripts/check-badges.mjs`: its conditional job-token object spread violates
`unicorn/consistent-conditional-object-spread`. INT0160UX's requirement to fix
all verification failures includes this syntax-only gate repair. Preserve
GitHub-only authorization and add empty/absent-token boundary coverage.
The merged compact/agents command expectation also exposes one duplication:
reuse the existing ACP command fixture with optional skill commands, keeping
all ordering and command assertions intact. Update the existing ACP usage
inventory assertions for the new local `/agents` command, retaining all usage
routing/cancellation/no-model-call checks. The legal cap drill's fixture must
use production's existing model-text compression plugin; its budget stays
150 KiB and the real production build already passes. Add the plugin
factory's minimal declaration so the fixture is checked without a suppression. Whole-shard verification
also requires current App tests to answer in the attention dock, the warmer
and bundle test to follow QPIN's single question/elicitation chunk, and every
harness map opener to distinguish the Agent map pill from Side chat.
Transcript folding tests must assert the unfurled marker; submitted markers
and dock controls keep their lock checks. Crash/reload must restore exactly
one interactive dock card and its transcript marker. Approval-first App
fixtures must deliver host resolution before answering a question: approval
priority remains intact. Share the five dock button queries inside the
existing App test file to avoid duplicating long accessible-region selectors.
Investigate the long-stream harness readiness failure
without increasing its deadline; preserve every delta and completion. A real
Chrome probe shows MessageChannel completion can precede delivery of queued
window messages, leaving only a partial reply when readiness reports done.
Advance the stream from delivery of its own window message instead, removing
the second task per delta and keeping readiness pending through completion.
The second fresh clone passes every static/unit/coverage gate, but the full
browser run still exposes per-delta React renders under load. Deliver the same
100-character frames synchronously in bounded batches, yielding through a task
port between batches and retaining the completion-delivery fence. Do not change
readiness bounds, workers or axe scope. Startup must wait for the composer or
tasks surface; the transient initial sign-in gate is not scene readiness and
can race question input or legal report delivery. Cover that startup boundary.
The next fresh full shard exposes another load-sensitive fixture: parsing the
entire changelog takes 6.508 seconds inside its five-second highlights test.
Move that unchanged full parse into `beforeAll`, retaining both release/version
assertions and the repository's existing test and hook deadlines. Prove the
highlights assertion still rejects a missing release Highlights section with
a byte-restored changelog mutation; do not shorten or bypass content validation.
The responsive probe also exposes a stale `AXE_AFTER_MS` reference in the
shared screenshot helper after the harness replaced idle timing with bounded
readiness. Remove the obsolete delay and retain theme, scene, font/paint and
error readiness through `whenReady`; exercise the actual evaluation string
without that removed global, and prove the guard fires before restoring it.
The fourth coverage run passes the release/version fixture but exposes the
same expensive full-changelog parse in the lossless artifact suite: its
packing test exceeds the five-second deadline at 5.596 seconds. Parse the
complete real notes once in that suite's `beforeAll` and reuse them in both
encoding cases. Preserve the existing named deadline on the other long case,
all 40 KiB/decoded bounds and exact lossless comparisons. Prove corruption
still fails the complete owning file, with a byte-restored encoder drill.

Packaged exec reproduces a release-base Node 22 loader-hook failure before
any dispatch: native CommonJS import lacks implicit `require.cache`. A small
real Node 22 probe confirms explicit `createRequire(__filename).cache` remains
available. Generate both archive wrappers with that explicit require, preserving
member digests, bounded decoding, inline English fallback and named exports.
Extend the existing native-import packaging regression to synchronous hooks;
retain all built-engine, credential isolation and signal assertions/deadlines.

Version remains 0.15.0. Entries belong under Unreleased. The rig brief permits
these two merges and full fresh-clone verification; no other merge, push,
rebase, paid/live model call, timeout or gate relaxation is authorized.

## QPIN — One question card, pinned above the composer (2026-10-07)

**Status 2026-10-07: released.** Shipped in 0.16.0 (§10).

The owner: "If we fixed the questions so they are pinned to the bottom why
is there still a screenshot of it floating in the middle of the chat?"
Amend D92.1 and D92.7: waiting and deferred questions keep only a compact
transcript marker (icon, Open question, title and Answer). Answer selects,
expands, scrolls and focuses the dock's first control. MCP forms follow the
same rule. Preserve late delivery, drafts, approval priority and settled
summaries. Update Help & Reference in all 14 languages and README images.
Sized screenshot captures must wait for the same scenario, fonts and paints
as wide captures: the existing early locator wait raced lazy question UI.

- [x] Implement the marker and explicit dock navigation; owning tests and
      a deliberate duplicate-card regression drill with byte-exact restore.
- [x] Restore question.png beside approval; regenerate question-related
      README shots and question accessibility scenes in all four themes.
- [x] Commit with hooks; verify a fresh clone with npm ci and CI=true:
      complete owning suites three times at default timeouts, five
      typechecks, lint, format, plain knip, duplication, build, reference
      and localization, keeping all thresholds unchanged.

Record receipts in docs/certification/question-pinned.md. Shared common.md
and review-common.md were absent from both C:/lanes/_ctx and the rig note's
~/lanes/_ctx; the rig brief and repository rules govern this repair.

## FLAKETH20 — Explain and repair the Windows team harness hang (2026-10-07)

**Status 2026-10-07: built.** Scoped Windows receipts are in `docs/certification/flake-team-harness-20.md`; Linux integration certification remains separate.

- [x] Measure the unchanged full file and case 20 with CI=true and V8 coverage.
- [x] Keep bounded console, page-error and request-failure evidence on failed
      harness readiness, with a wait shorter than the existing case deadline.
- [x] Repair the evidenced cause without raising deadlines, adding retries or
      skipping cases; prove the regression fails before the repair.
- [x] Certify 100 consecutive case-20 passes and 30 complete-file passes on
      Windows, plus ten Linux file passes if a Linux machine is reachable.
- [x] Record counts, cause, fix and restored drills in
      docs/certification/flake-team-harness-20.md; commit with normal hooks.

Scope is browser harness readiness and its owning regressions. No model call,
merge, rebase, push, dependency or gate change. The shared lane rules delegate
aggregate quality to the lead; run the scoped gates directly on this rig.

## M43–M56 — Parity with everything Muse Code and the Model API offer (D36)

**Status 2026-09-27: M43–M56 merged (M56 as PR #44). All ship in
0.9.0.** The program the owner asked for (2026-09-25): one pull request per
milestone, each with its tests, red drills, documents and fourteen
translations. The order is D36's table:

| Milestone | What reaches the panel                                                                                                                | State                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| M43       | A row for every tool Muse Code runs (memory, goals, schedules, workflows, web, background work, reminders, input), tool-result images | merged, PR #29                                       |
| M44       | Images on the Muse Code backend through the `ide` session server with the key (paid, loud); image edits                               | merged, PR #30 (web fetch moved to M44b)             |
| M45       | Goals: set, see, pause, clear                                                                                                         | merged, PR #31                                       |
| M46       | Background work and stop; the `!` user shell; clarifying questions                                                                    | merged, PR #33                                       |
| M47       | Workflows: captured run and children as read-only cards; owner controls deferred until a live success capture                         | merged, PR #34                                       |
| M48       | Model API subagents with staged paid child admission; Muse Code read/reopen deferred until live success capture and certification     | merged, PR #35                                       |
| M49       | Memory: see and edit; memory tools on the Model API backend                                                                           | merged, PR #36                                       |
| M50       | MCP servers on the Model API backend                                                                                                  | merged, PR #37                                       |
| M51       | Hooks on the Model API backend                                                                                                        | merged, PR #39                                       |
| M52       | Scheduled prompts (`/loop`): list and cancel                                                                                          | merged, PR #40                                       |
| M53       | Rewind a conversation; a side chat                                                                                                    | merged, PR #41 (with the usage follow-up)            |
| M54       | PDFs and other files as input                                                                                                         | merged, PR #42                                       |
| M55       | Sign in and install Muse Code from the panel (M41 folded in)                                                                          | merged, PR #43 (with the sign-in reducer review fix) |
| M56       | Enterprise network: proxy and certificates, the sandbox network switch, no session log, the CLI's config status                       | merged, PR #44                                       |

## CI0150M — Round 3 macOS CI repairs (2026-10-07, macmini)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

- [x] Reproduce the journal coverage timeout and companion authentication race;
      replace per-byte JavaScript newline scanning with typed-array searches,
      retaining every line, size, UTF-8, version and schema check. Prepare the
      full benchmark in `beforeAll` at the default hook deadline. Control the
      browser fixture's server clock so valid sessions do not expire under load;
      expiry remains an explicit clock advance, with real browser/socket timers.
- [x] Reproduce static gates and the native dictation build/disclaim job. Fix
      causes without changing gates, budgets, test deadlines or assertions.
- [x] Repair the full-shard `checkSlots` fixture cost: create its immutable Git
      baseline once in `beforeAll`, copy it per isolated case, and certify each
      descendant/transport-failure scenario as its own test at the default
      deadline. Preserve real snapshot, install, credential and cache checks.
- [x] Start the forced browser-restart discovery phase after bounded runtime
      preparation completes (or the check ends). A first verified download must
      not spend the unchanged discovery poll budget before the browser exists.
      Preserve every restart, resolver, proxy, challenge and cleanup assertion.
- [x] Commit locally with normal hooks and explicit paths, then reproduce all four
      coverage shards, merged coverage and each locally runnable macOS workflow
      job from fresh clones with Node 22 and `CI=true`, including installed
      packages. Report shared failures and the installed E5 timeout; record
      hosted W as unverified. These receipts do not claim all macOS CI jobs pass.
- [x] Record macOS round 3 results and byte-exact regression drills in
      `docs/certification/train-0.15.0.md`. No merge, rebase, push, credential
      disclosure, live or paid model call is authorized.

## FIX0150R — Release review repairs for runners and usage (2026-10-07, macmini)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

Repair PR #136 threads PRRT_kwDOUkzj5M6p1xVd, PRRT_kwDOUkzj5M6p1xVm
and PRRT_kwDOUkzj5M6p1xVs only. Runner children use D89.5's shared credential
predicate; runner configuration refuses credential-shaped environment names
with the existing translated explanation. Retention persists paired cache/input
and output/duration sums and observation coverage, and the shared runtime adapter
restores them for every editor. Legacy rollups keep unknown paired rates.
Rollup monetary sums use the same integer micro-dollar settlement as raw totals.
Browser validation shares the pure predicate from a Node-free module, retaining
the existing core import API. The duplication gate requires raw and retained
usage to share their empty-measurement initializer in the existing aggregate file.
Prove each regression fails against release head `0113c131e`, then passes;
record byte-exact restored guard drills in `docs/certification/fix0150r.md`.
Verify complete owning files three times after the brief's clean checkout,
with `CI=true`, at repository timeouts and at most three files per invocation.
Run all five typecheck projects and the scoped static/build gates. No dependency,
new feature, provider-wire shape, paid/live call, merge or push is authorized.

## CI0150W — Round 3 Windows CI verification (2026-10-07, win11)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

Scope: reproduce every Windows pull-request job from committed fresh clones,
using CI's Node 22, `CI=true`, four coverage shards and repository deadlines.
The explicit round-3 whole-shard requirement applies to CI reproductions;
targeted development runs retain the rig's three-file limit. Own the native
team lifetime, hints/load, worker fence and Model API host timeouts. Remove
repeated cold setup and launch-priority delays structurally, retaining native
security checks, all assertions, deadlines and budgets. Record any failures
owned by another OS lane without merging or editing its work. No paid/live
model calls, global dependency installs, push, merge or rebase.

The baseline clean Windows shard also exposed `teamRuntimePackage.test.mjs`
building its private production bundles inside a five-second assertion. Move
that invariant compilation into suite preparation while retaining every lazy
factory and no-dispatch assertion. Clean-artifact package failures reported
across OSes remain Linux-owned under the round-3 shared rules.

The complete Windows shard 2 additionally reproduces `checkSlots.test.ts`'s
six native failure scenarios sharing one five-second test, followed by cleanup
while its timed-out loop still starts children. Prepare one immutable Git seed
per suite and run each independent uncertainty/transport scenario as its own
case at the unchanged default deadline. Keep every state and refusal assertion.

Coverage also reproduces Windows held-launch cancellation issuing STOP again
after the helper has already received STOP and closed its pipe. The second
write raises EPIPE and masks the expected lifetime-disposed refusal. Retain
the held cancellation's original write promise and await it during retirement;
do not resend STOP for that held launch. Preserve ordinary retirement, native
proof/uncertainty and the existing deadline. The real coverage-enabled native
disposal case is the regression guard; no assertion or timeout is relaxed.
Record this native cancellation pitfall as G33 in the orchestration register,
covered by M96's held-launch disposal guard and Windows cancellation write.

The dedicated pinned-browser job exposes two live startup-contract refusals
and an unjoined observation rejection on Windows. Capture its actual pinned
CDP startup frames to diagnose the refusals before any production change;
preserve every version, command-line, blank-target, network-service, process,
listener and cleanup assertion. No new retry, launch delay, timeout or skip.

- [x] Attempt owned-failure reproductions and inspect round-2 Windows priority.
- [x] Fix scoped causes, prove regression guards fire, and commit with hooks.
- [x] Attempt every locally executable Windows job command in fresh committed
      clones, including installed-package, pinned-browser and integration
      checks; remove clones and record unavailable hosted W execution.
- [x] Record each job's result under round 3 Windows in
      `docs/certification/train-0.15.0.md` and report exact remaining failures.

## CI0150C — Clean-checkout platform and logic CI repairs (2026-10-07, macmini)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

Run directly on Kubuntu with `$HOME/.local/bin` in PATH: production build,
VSIX/ACP packaging and size measurement, all five typecheck projects, full lint,
format check, plain Knip, localization/reference/host/schema gates, every
configured Vitest file in sequential batches of at most three files/workers
with repository-default timeouts, and the full accessibility harness.
The rig brief overrides common.md's older ban on the complete batched suite;
aggregate `npm run quality`/coverage and hosted native OS gates remain the
lead's qualification. The only authorized cap adjustment is the brief's VSIX
measurement plus 5%, rounded upward to 25 KiB, if the existing cap is exceeded.
No other gate is weakened. Record commands, failures, retries, package hashes
and outstanding merges in `docs/certification/rel0160.md`. Commit finished
pieces with hooks and explicit paths; no push, rebase, live/paid calls or tags.
The lane is time-boxed to 120 minutes.

- [x] Repair the lane's journal canonical-root checks, Windows short-name fixture,
      native child priority observation, ACP model fixture, legal focus readiness,
      prompt-menu harness readiness, pending release note and browser resolution.
- [x] Validate newly added README images from checked-out files while retaining
      public URL checks for images already on main and missing-file refusals.
- [x] Run every touched owning test file three times from a clean checkout with
      `CI=true`, at most three files per run and repository default timeouts;
      run all five typechecks, lint, formatting, plain knip and duplication.
- [x] Prove a repaired behaviour fails when deliberately broken, restore exact
      bytes and record results in `docs/certification/ci0150c.md`; commit locally
      with hooks and explicit paths. Hosted cross-platform results remain the
      lead's release checks; no live or paid calls, push or merge is authorized.

**README draft correction.** The complete sweep observes both existing
`readmeVersion` guards fail when a 0.16.0 headline is installed before the
manifest can be bumped. Preserve the exact ready-to-apply section in
`docs/certification/rel0160-readme-draft.md` and link it from README while
keeping the released headline/contents aligned with 0.14.3. Apply that section
and demote main's 0.15 section only with the authorized version promotion.
Rerun the complete affected batch at default deadlines; do not relax either
guard or bump early.

## CI0150B — Hosted CI test setup repair (2026-10-07, win11)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

- [x] Profile the ten lane-owned suites from a clean checkout with `CI=true`.
      Share invariant transforms, source fixtures and cold setup; build only the
      Usage browser artifacts required by its real CSP and chunk test.
- [x] Preserve all assertions, history scales, performance budgets and default
      deadlines; remove wall-clock races and normalize Windows fixture paths.
- [x] Run every owned whole file three times after clean-tree removal, all five
      typecheck projects, lint, changed-file formatting, plain knip and duplication.
- [x] Prove a repaired guard fails under deliberate regression and restore exact
      bytes; record timings and checks in `docs/certification/ci0150b.md`.
      Commit locally with hooks; no push, merge, rebase or live/paid calls.

## REL0150M — Bring 0.14.4 and 0.14.5 into 0.15.0 (2026-10-06, linuxlt)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

- [x] Merge `rel-0145` then `chore/infra-0150-m`, each with `git merge --no-ff`;
      preserve all train and sharing features, newer translated text and both
      harness readiness inventories. Regenerate reference and host API records.
- [x] Keep version 0.15.0 and the dependency union; regenerate the lock and prove
      clean installation. Keep one current What's New, with Earlier 0.14.5 and
      Earlier 0.14.4 before older notes; preserve every changelog release.
- [x] Run the complete configured suite in batches of at most three files using
      repository default timeouts, full ESLint with zero warnings, all five
      compiler projects, formatting, plain knip, duplication, cycles and inventories.
- [ ] Measure production bundles and actual universal VSIX/ACP packages; apply
      only the brief-authorized measured universal size plus 5%, rounded up to
      25 KiB rule, and record each changed cap with its measured reason.
- [x] Run every accessibility scenario in four themes; regenerate and view every
      README screenshot with the compact bookmark composer menu.
- [x] Record all checks, fixes and byte-exact regression drills in
      `docs/certification/train-0.15.0.md`; commit locally with hooks, never push.

Both ordered merges are committed with normal hooks: `50a4947a` and
`4eac2793`. Infrastructure owning tests and restored regression drills pass.
The dependency union and clean ordinary npm ci check are complete. Generated
reference/host records and locale unions are clean. All 822 configured files
have final whole-file results: 16,435 passed, zero failed, 75 existing skips.
Every listed final static gate and production build now passes on `7f896a95`,
including keyboard and legal readiness repairs. Full production accessibility passes
976 pages; the repaired legal driver passes 96 keyboard/zoom checks and 24
English/pseudo WCAG pages. All 17 screenshot pairs are regenerated and viewed;
the paid frame includes all promised rows. Actual helperless VSIX and ACP packages
pass at 2,651,561 and 1,928,065 bytes, with 54 and 38 native module-export checks.
All measured bundle caps pass unchanged. Only the certified-helper input for
actual universal measurement remains blocked (Q-REL0150M-UNIVERSAL). Eight
successful deliberate regressions restore exact bytes. Final self-contained
receipt: `docs/certification/train-0.15.0-rel0150m.json`.

The merged ACP Registry and stdio suites duplicate their real packaged-agent
build and cleanup. Consolidate only that test fixture setup to satisfy the
unchanged zero-duplication gate; retain separate capability and lifecycle tests,
installed-package coverage and default deadlines. Regenerate the host API record
after the manifest's single-walkthrough union.

The first 822-file sweep finds translated ACP help losing train command rows,
three isolated package/localization fixtures missing newly merged dependencies,
and the shutdown VM missing the prompt-host port. Restore translated provider,
legal and compaction help, keep complete real fixture graphs, and verify prompt
disposal precedes backend shutdown. Investigate the team browser setup's 60-second
failure with the rig's explicit Chrome executable; keep all deadlines and cases.

Team setup is blocked by VSCE scanning the owned scratch install before its
allowlist filter; move that evidence to OS scratch rather than changing a gate.
The now-executed browser cases expose the map opener matching Side chat's
earlier `.agents-pill`. Target the titled Agent map pill in every harness scene
and guard against the ambiguous selector; preserve all 22 browser assertions.
Record both discoveries as G30/G31 in the orchestration register and D100;
future governor/playbook enforcement stays with M107/M116, not this release lane.

The complete 976-page accessibility run finds failed lazy history rows inside
the listbox and dangling active-row IDs (16 elements, two ARIA rules; no missing
pages). Diagnose the production row-load failure and preserve valid listbox,
keyboard, loading and retry semantics; add an owning regression and demonstrate
its failure before rerunning the complete four-theme matrix. Gates stay unchanged.
The production error is `Cannot read properties of undefined (reading 'archive')`:
the browser keyboard compiler discovers dispatch calls but misses direct
WEBVIEW_KEYBINDINGS context reads in HistoryPromptRow. Extend that existing AST
discovery to literal direct reads and reject dynamic reads; compile the real lazy
row in its owning regression. No eager history import or budget increase.

The legal keyboard/zoom driver begins input when a dialog first appears, before
the harness's scripted selections and preview actions settle. Its first two
official runs fail focus containment and dialog visibility; an observational
probe passes, so that probe is not final acceptance. Wait on the existing themed
scenario readiness before exercising native keyboard input. Guard both held and
rejected readiness, prove the guard fails without the wait, and rerun the entire
96-case native plus 24-page English/pseudo legal checks at unchanged deadlines.
G32 records this readiness requirement for M107; its runtime enforcement remains
future work, while the legal driver and owning guard are repaired here.

Refresh every README image against the saved train/incoming baseline. The paid
usage image needs a taller 690-by-1000 viewport so its caption's Tab, Model hooks
and Judge rows are fully visible; the other sixteen retain their declared
geometry. This changes capture data only, not the UI or bundle budgets.

The rig brief authorizes the full suite and listed full-repository gates despite
common.md's scoped-file rule. Aggregate `npm run quality` remains reserved for
the lead under common.md; this lane records its components separately. No new
live/paid model requests, dependency, command, setting or escape hatch is planned.
The earlier 0.14.4 universal cap was 2525 KiB from 2,457,606 measured bytes;
the release train's existing 2775-KiB cap remains until fresh measurement.

## TRAIN15E — Join M95/M102 and finish bounded accounting (2026-10-06)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

The cold-start profile finds eager runtime imports through `providersEntry`
loading the captured codecs and Model API transport on a Meta-only command.
A small provider-policy entry exposes only pure model references and credential
records, including their endpoint validation. The captured codecs and transport
keep their current entries. Package size recovery uses the inline browser
deflate decoder and includes activation's exact CommonJS bytes in the existing
digest-checked solid runtime archive. Its native export annotation and eager
loader remain in place; the source activation budget stays 600 KiB. Source
tables, loader hashes and native exports remain identical.
The headless preflight also defers its ACP engine to `runtimeEngine.js`;
an invalid stdin key must be refused before importing the engine or SDK.
A final idle repeat measures +22.2%, above the 20% threshold: the ACP
launcher still eagerly initializes the same engine before reaching its
headless branch. Reuse the engine entry for serve/login too, install the
caller language before use, and retain the recording restore in finally.
The packaged repeat still measures +21.2% because its runtime error text
opens the entire translation archive. Keep the runtime English region
byte-exact and direct for preflight; retain its canonical archived snapshot
for the existing bounded, digest-checked reader API and round-trip checks.
The installed changelog keeps Unreleased highlights and links to the full
Unreleased record, while its two released sections remain byte-identical.

The rig brief authorizes the no-ff M102 integration, preserving both train and
provider/usage behavior and the released changelog and Meta request fixtures.
Finish production headless BYO dispatch through the shared provider transport,
record its attempts in the same journal, and admit ACP/headless spending through
a locked durable daily ledger using the runtime setting. Unknown or unfinished
requests retain their reservation; a refusal occurs before dispatch. Runtime
`settings.json` in the agent data folder holds `paidDailyBudgetUsd` (default $5,
range $0.50–$500); invalid settings and abandoned locks fail closed. The shared
API returns an attempt reservation before its final synchronous dispatch fence. Prove the
hard cap and two-process last-dollar race with offline tests.

Move optional hook dispatch and MCP connections to lazy entries to recover at
least 5 KiB beneath the existing 475 KiB Model API cap. New artifacts use their
measured size plus 15%, rounded up to 25 KiB; existing caps and the authorized
2,534,400-byte universal VSIX cap stay fixed. Measure five cold exec starts on
this train and 0.14.1 before changing a named packaging deadline. Run the
brief's scoped suites/gates/package checks, conditionally merge sync/main only
if its reference gate has landed, and record all receipts in the train record. The new hook, MCP and runtime
accounting entries have 50, 75 and 50 KiB caps from measurements of 28.3,
49.0 and 26.0 KiB with the same +15%/25-KiB rule. The pure provider policy
entry is 7.7/25 KiB and the lazy standalone engine is 753.4/875 KiB.
Hosted search remains unavailable in the runtime under this hard daily budget: its fees lack a dispatch upper bound.

## VSIXDIET2 — Universal package headroom for 0.15.0 (2026-10-05)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

Scope and the sole conditional cap decision are recorded in D6 above.
Receipts: `docs/certification/train-0.15.0.md` and the TRAIN15D JSON record.

M97 integration retains the current shared validation, English regions, runtime
Brotli archives and deferred conversation/browser graph. Its legacy indexed
locale decoder remains compatible; packaged ACP translations keep the existing
validated archive instead of repacking a Brotli member as JSON. Keep the legal
scan and paid explanation lazy, preserving Plan holds, confidential-model
admission, NVDA focus behavior, bounded registry consent and all fixed caps.
The first combined Model API build exceeds its fixed cap by about 4 KiB.
Share the canonical paid schemas/accounting (paidBoundary.ts), legal validators and legal tool adapter through
the existing modelApiBoundaries bundle; preserve its 25-KiB cap and every
implementation. Its model-facing text gets its own guarded reader block.
Both new palette rows retain the current tooltip contract, reusing the free
scan’s translated description. Budget-disclosure fixtures explicitly accept the
Muse Code price before asserting its per-use question.
Scanner plural messages use the Intl `{count}` slot for their selected count
in every language, satisfying the current plural gate without changing output.
The first universal M97 package is 2,536,048 bytes, 1,648 above the
lead-approved 2,534,400 cap. The attempted English surfaces-region move
increased it to 2,543,484 because the region retains an inline fallback; restore
that placement. Use maximum Brotli quality (11 instead of 10) in the existing
lossless archives, preserving their version, decoded values, SHA validation,
bounds and loaders. A compression-only preview saves 12,953 bytes on the
locale archive alone. No region or individual bundle cap changes.
The new legal explanation setting follows D78’s interactive Model API default;
explicit false stays off and Muse Code still requires its opt-in. The legal
explanation shares the daily paid ledger on both backends; the
existing other-feature backend policy stays intact. Regenerate current host
inventories and add the scanner to the existing deferred inventory. The common
brief's featureCatalog/gen-reference/check:reference machinery is absent from
this release tree and both merge inputs; README/manifest/slash/ACP docs record
M97 here, with that later reference-system integration left to its owning lane.

- [x] Measure M96's shared browser graph and existing packed-data inventory.
- [x] Move the post-tool event tail into the lazy team runtime; certify behavior.
- [x] Measure universal VSIX, apply only the explicitly authorized cap if needed.
- [x] Merge and measure `m96/ifix-win4`, then `m97/sr`; resolve by meaning.
- [x] Complete scoped compiler/lint/l10n/host/schema/owning-suite checks and drills.

### Preserved integration notes: VSIXDIET2 — Universal package headroom for 0.15.0 (2026-10-05)

**FIXVSIX2 review repair (2026-10-05, RVMVSIX2).** Fix P1 by retaining
Node's static named-export declarations in each archived CommonJS wrapper,
while compiling the exact digest-checked original source. Keep the archive
reader on the private cached CommonJS Module, preserving uiText's public
export surface too. Compare native
`import()` and `require()` exports for every packaged Node module with the
unpacked build in both VSIX and ACP, and exercise hooks, reviewer, session
board, report and plugin functions without model calls. Fix P2 by building
the packaging suite's English fixtures in memory from source, so unit CI needs
no `dist/`. Register the packaging child test as a Knip entry (not an ignore),
so the dead-code gate analyses this runtime entrypoint. Prove each repair red,
restore byte-exact, remeasure universal
headroom (at least 150,000 bytes) and byte-identical activation. No dependency,
guard widening, paid/live call, merge, push or rebase; 90-minute repair box.

- [x] Repair P2, run the complete suite without checkout build output, drill.
- [x] Repair P1, compare every packaged module and callable regression, drill.
- [x] Run scoped static/build/package gates and record sizes and receipts.

- [x] Reproduce the 0.14.0 universal VSIX with the checksum-verified published
      helper and rank every member by compressed bytes. Keep the 2,252,800-byte cap.
- [x] Pack runtime translations and generated lazy English regions together at
      Brotli quality 11, using Node's built-in bounded decoder and today's table
      validation. Use the same archive in ACP; keep manifest translations readable
      by VS Code and source JSON checked by the localization gate.
- [x] Measure deterministic lossless package improvements, targeting at least
      150,000 bytes of universal headroom with no activation growth or text changes.
      Preserve all licences/notices, runtime assets and editor behavior.
- [x] Solid-compress the exact existing lazy CommonJS bundle sources in an
      independent archive: translation damage must preserve backend availability.
      Keep activation, recorder, shared parsers and
      ACP entry code ordinary CommonJS. Compile each selected, SHA-256-checked
      original through Node's CommonJS module loader with its original filename;
      retain independent inline English-region fallbacks for archive damage.
- [x] Prove every locale's exact compact JSON round-trip, English-region lazy
      loading, missing/corrupt fallback, and packaged ACP/CLI loading. Drill new
      guards and restore each file byte-exact with SHA-256 receipts.
- [x] Run scoped owning/importing suites in batches of at most three files,
      static gates, all production caps and universal packaging on Kubuntu. Record
      before/after members in `docs/certification/vsix-diet-2.md`; hook-on local
      commits only, no network/live/paid calls, merge, push or rebase. The lane's
      shared rules reserve aggregate quality/coverage for the lead; 120-minute box.

## TRAIN15B — Resume the 0.15.0 batch within the existing caps (2026-10-05)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

The lead authorizes a fresh bounded size recovery on the TRAIN15A worktree:
build chat, Models and What's New as entries in one ESM splitting build,
with per-entry reachable metafiles and unchanged startup/deferred/readership
checks. Isolate the canonical Review comment block at build time in its actual
reader. Share repeated token formatting, unknown-paid paragraphs and provider
usage token text within UsageDialog, preserving absent facts, plural conditions
and markup while offsetting the shared graph's import overhead. The vendored provider catalogue has no runtime reader on this tree and
is not needed before the loader: emit its exact JSON values as a CommonJS data
module, packed and verified by the existing runtime archive loader. Keep its
licence/provenance. Inspect the three named large chunks for accidental test,
development or duplicate-version inputs; measure universal and helperless VSIX
archives and every existing bundle cap. If either VSIX stays over 2,252,800
bytes, stop with exact deltas and analysis, preserving features and caps.

After recovery, merge only `m96/int3d`, `m96/ifix-win4`, then `m97/sr`, each
with `git merge --no-ff`, preserving all behavior, translated keys and released
changelog bytes. Run scoped owning checks and measure after each step; hooks
stay enabled. Full quality, M95's remaining transports and M102 stay for the
lead's continuation. Record this run in `docs/certification/train-0.15.0.md`
and its receipts. No paid/live calls, credentials, push, rebase or other merge.

**Outcome:** the universal VSIX is 2,213,704 bytes (39,096 headroom);
helperless is 2,132,213 (120,587 headroom). Both are below 2,252,800,
a 155,043-byte universal reduction. Chat startup is 797,449 / 921,600;
Models is 418,077 / 486,400 with all eager chunks. The original deferred
cohort is 51,226 / 51,200, still 26 bytes over after two bounded usage
reductions. Stop that recovery path under common.md; hold all three remaining
merges because the brief requires every unchanged cap to pass. Preserve this
review candidate and its exact missing headroom, rather than imply a green
package gate. No merge/conflict, feature removal, cap or gate exception.
Twelve complete owning files pass 246 tests, zero skips; all five typecheck
projects and scoped lint, localization, deadcode, duplication, host API, exec
schemas, split/readership, host-globals and notices pass. Eight deliberate
regressions fail and restore byte-exact. Actual standalone VSIX staging passes
38 native module checks; `npm run package` remains red at the deferred cap.
Exact artifacts, inputs, byte deltas and drills are in the train certification
and its existing JSON receipt. Full quality and native/hosted/live proof stay
external; no new tool or dependency was installed.

## TRAIN15A — Start the 0.15.0 release batch (2026-10-05)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

M101's merged Model API is 486,502 bytes, 102 bytes above its unchanged
486,400-byte cap. Reuse one build-generated lossless model-text decoder for
its existing immutable blocks; preserve exact values, literal readership keys
and dead-block elimination. No runtime feature, dependency or cap changes.
Measure the universal archive before proceeding beyond M101.

The first M101 universal archive is 2,368,627 bytes (+115,827). Build chat
and Models as separate ESM entry points in one existing split graph so React,
localization and shared helpers ship once. Retain per-entry reachable metafiles,
the 900-KiB chat and 475-KiB Models startup caps including all static imports,
the original deferred allowances, nonce CSP and exact model-text readership.
The first shared graph correctly fails the model-text guard: constants carry
the Review template into Models. Keep that canonical block's exact source in
its own generated browser module, so only the actual Review import closure
carries it. Do not add Models as a reader or weaken the guard. Retain each
entry's CSS metadata alongside its reachable scripts.
Keep the original deferred 50-KiB cap too: the split graph leaves that cohort
57 bytes over after the canonical Review block moves into its reader. Share
UsageDialog's two identical unknown-paid-tally paragraphs in one local renderer,
preserving each condition, localized plural and DOM markup.
Neither entry loads the other's app. Verify actual browser startup and package
membership; if this cannot fit without broader product scope, record the exact
largest twenty VSIX deltas and stop at M101 as the brief requires.

**Outcome:** the shared-entry experiment is reverted after the original deferred
cohort remains over its unchanged cap after two bounded fixes (57 bytes, then
10). The shipped candidate keeps the separate Models build. Its final universal
VSIX is 2,368,747 bytes, 115,947 over the 2,252,800-byte cap; all raw bundle caps
pass, with Model API at 486,338 bytes. Stop after step 2 under the brief and
common.md; steps 3–5 remain pending. Exact ZIP deltas and scoped proof are in
`docs/certification/train-0.15.0.md` and its JSON receipts. No release
certification or cap exception is claimed.
Scoped Kubuntu proof passes: all five typecheck projects, changed-file lint and
format, localization/host API, production bundle/split/global caps, 92 complete
owning files (3,661 tests, zero skips), three new red/restored drills and actual
ACP packaging/CLI checks. Stage 1 passes 156 tests and two red/restored drills.
Only the universal VSIX cap blocks this candidate; full quality remains for
continuation.

- [ ] Merge `perf/vsix-diet-2-fix`, `m101/int`, `m96/int3d`, `m96/ifix-win4` and `m97/sr` in that order with two-parent merge commits, preserving every input's intent.
- [ ] Keep one Unreleased section with at most five contributed-command/setting Highlights; retain every released section byte-identical to `6a0207c1`. Union decisions, milestones and real translations; regenerate generated records.
- [ ] After every merge, run scoped owning tests (at most three files, three workers, 120-second test admission), typecheck, changed-file lint/format, localization, host API, help reference when present, production build and a CI-shaped VSIX with the checksum-verified universal helper from the shared 0.13.0 archive. Keep all existing caps unchanged.
- [ ] Recover measured size through existing deferred chunks or package exclusions without dropping shipped functionality. If M101 still exceeds the VSIX cap without an owner product decision, record the largest twenty exact archive deltas and stop.
- [ ] Record merges, conflicts, resolutions, checks and per-merge sizes in `docs/certification/train-0.15.0.md`. Commit locally with hooks, no push/rebase, live/paid calls or unrelated merges. Full quality and the two unfinished inputs belong to the later continuation; time box 120 minutes.

## PR132M — Verify the 0.14.4 merge into infrastructure (2026-10-06)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

Starting at merge `3e58f1568` on `chore/infra-0150-m`, verify the complete
App suite at repository-default deadlines, then every configured Vitest file
in sequential batches of at most three files with `--maxWorkers=3`. Include
the deferred warm-up guard, harness-wait guard and built-exec suite. Compare
any failure with clean main `aa4e3fa83`; fix merge regressions structurally,
and record main failures separately. No timeout, retry, skip or gate changes.

- [x] Complete App suite: 161 tests pass, including all palette routes.
- [x] Complete configured unit/process-e2e suite in bounded batches.
      All 560 files ran: 11,841 passed, 74 existing skips and one failure also
      reproduced on clean main `aa4e3fa83`. The checkpoint fixture disposes
      only after successful filter discovery, but a filter-free repository
      makes Git exit 1 before disposal. The lane permits this trivial test-only
      correction: dispose in `finally`, preserving Git's discovery result.
      Corrected owning file passes all 16 tests. The original fixture,
      omitted merged warm-up import and unexplained sharing timer each fail
      deliberately; all three restore SHA-256-exact source.
- [x] Five compiler projects, lint, changed-file format, plain Knip,
      duplication, localization, host API, reference and production build.
- [x] Record results and any failure drills in `docs/certification/pr132w.md`;
      commit locally with hooks and explicit paths.

Final complete checkpoint/warm-up/harness verification passes 37/37.
Combined final per-file results cover all 560 files: 11,842 passes and 74
existing skips, zero unresolved failures. All named static/build gates pass;
no second full sweep or coverage run is claimed. Receipt:
`docs/certification/pr132w.md#pr132m--main-merge-verification-2026-10-06`.

The lane brief explicitly authorizes the full configured suite in bounded
batches; shared rules still prohibit aggregate `npm run quality`, external
requests, additional merges and pushes. Coverage, accessibility and hosted
cross-platform quality remain with the lead. No live or paid model calls.

## PR132W — Diagnose the Windows built-exec failure (2026-10-06)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

On the Windows 11 rig, reproduce the complete `execStdio.e2e.test.ts` file
at repository-default timeouts and compare with `sync/main-0170`. Isolate
the expected pre-release external badge failure from any Windows process
or encoding failure, fix the root cause without weakening a gate or skipping a row,
and prove the regression fails before the fix. Package setup uses a test-owned
transport for badge responses and reads screenshot bytes from this checkout;
the real package badge validator still runs, including its CI skip prohibition.
Require three complete green runs, scoped static/build checks and a receipt in
`docs/certification/pr132w.md`.
The rig/shared brief prohibits aggregate quality/full-unit runs, network
requests, merges and pushes; integrated quality and external badges stay
with the lead. Commit locally with the existing hooks and explicit paths.

Completed: the unchanged candidate and main snapshot pass when the expected
external badge failure is isolated. The package subprocess now uses local
screenshots and test-owned badge responses while retaining the real validator.
Three final-source `CI=true` runs pass 33 tests each with only the three existing
Windows signal skips; all 32 badge-policy tests also pass. A fake HTTP 404 fails
the real validator and restores SHA-256-exact source. Five compiler projects,
final e2e typecheck, scoped lint/format, Knip, zero-clone duplication, reference,
localization, host API and production size/split/host-global/notice gates pass.
Evidence: `docs/certification/pr132w.md`. Full quality, hosted CI and external
badges remain lead-owned; no Windows process/encoding defect was reproduced.

## INFRA015 — Integrate screenshot refresh and test infrastructure (2026-10-06)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

Completed on `linuxlt`: three ordered no-fast-forward merges preserve all
incoming heads; npm STAR regression and two integrated guards fail deliberately
and restore byte-exact. Final default-timeout tests pass 506 assertions in 30
complete files. All 724 accessibility pages pass with zero violations, undecided
rules or missing results. All 17 README captures match committed UI; seven are
pixel-identical and the others differ only in animated/clock/caret paint.
Five-project typecheck, full lint, plain Knip, zero-clone duplication, reference,
localization, host API and production size/split/host-global/notice gates pass.
The actual Linux VSIX is 2,290,386 bytes (2236.705 KiB), below 2400 KiB; packaged
README links and version are verified. Certification: `docs/certification/infra015.md`.
Full quality, hosted cross-platform checks, external badges and universal macOS
helper packaging remain lead-owned; no local implementation blocker remains.

Linux rig `linuxlt`, branch `chore/infra-0150` from
`8c6351d73`. Merge `fix/test-warm-deferred`, `fix/harness-waits`, then
`docs/readme-shots-1006`, each with `git merge --no-ff`. Preserve both sides
of plan, changelog and contributor notes; retain readiness-based harness waits
and convert any new screenshot-scene fixed delay to the same `whenFound` flow.
Extend STAR's exact linked sentence to the npm landing page and prove its new
regression test fires by removing the sentence and restoring it byte-exact.

Acceptance: complete accessibility harness with zero violations and zero pages
without results; regenerate README previews, compare every declared screenshot,
refresh and inspect changed assets. Run the requested owning Vitest files in
batches of at most three, with repository-default timeouts; five-project
typecheck, lint, format, reference/localization/host API, plain Knip, duplication,
production build and VSIX packaging under the unchanged 2400 KiB cap. Record
merge resolutions, failure drills, receipts and remaining blockers in
`docs/certification/infra015.md`. Commit finished pieces with hooks enabled and
explicit paths. No push, rebase, additional merge, paid/live call or gate change.
The rig brief and common.md prohibit aggregate quality/full-unit runs; the lead
owns full quality and hosted cross-platform certification after this handoff.

## TESTWARM — Warm deferred surfaces before behavior tests (2026-10-06)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

Add one test-only helper that imports every deferred webview surface before
behavior suites run. Check its import set against the webview source so a new
deferred import cannot silently miss warm-up. Keep dedicated loading/failure
tests cold, production code unchanged, and hook/test/findBy timeouts at their
repository defaults. Measure cold baseline and three cold runs of every owning
suite directly on the Windows 11 rig, in batches of at most three files. Prove
the drift check fails after an unlisted deferred import and restore exact bytes.
Record receipts in `docs/certification/testwarm.md` and the test infrastructure
fix in the changelog. Commit locally with hooks; no merge, push or model call.

Completed: all 17 owning behavior suites pass three cold Windows rounds,
407 assertions per round (1,221 passes) at repository-default timeouts. The
source-derived warm-up guard fails on an unlisted deferred import and restores
SHA-256-exact source; dedicated lazy loading/failure tests remain cold and pass.
Compiler projects, scoped lint/format, Knip, duplication, localization, host API,
reference and production build pass. Evidence: `docs/certification/testwarm.md`.

## HARNESSWAIT — Harness scenes wait for their controls (2026-10-06)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

Scope: replace every fixed-delay DOM interaction in `test/harness/index.html`
with `whenFound`, nesting dependent steps. Retain only explained host-event,
clock and readiness-polling timers. A source-parsing unit guard rejects delayed
DOM interactions, including calls through helpers, without a kept-timing reason.
Prove the guard with an old delayed click and SHA-256-exact restoration.
Check all accessibility scenarios in four themes, compare ten converted scenes
against shots from this lane's main base, and run harness unit tests at the
repository default timeout, compiler projects and scoped static/build gates.
Update CONTRIBUTING, Unreleased and `docs/certification/harness-waits.md`.
No product feature, dependency, wire shape or budget changes. The rig brief
prohibits aggregate quality, merges and pushes; the lead retains integrated
quality and cross-platform certification. Commit locally with existing hooks.

Verification found Chrome's command-line virtual-clock capture stalls before
rendering; a capture deadline returns blank pages. Use the existing Playwright
dependency for `scripts/lib/harnessCapture.mjs`, waiting on the harness's same
timed-event settle and `whenReady` condition before capture. Keep browser
lifecycle bounded and test that capture waits and closes on readiness failure.
Historical main snapshots use the same harness helpers and capture driver.
The full sweep also exposed a DOM wait starting before the module graph had
loaded. Arm it at `DOMContentLoaded`, require that startup in `whenReady`, and
prove the once-only startup regression without widening an existing deadline.
Jump's completion/code-block prerequisites proved too expensive on the loaded
rig. Stop using the streamed fixture for that scrolling check: preload the same
completed long reply. Waiting solely for a native scroll also failed twice:
a row can appear before its lazy content makes the panel scrollable. That path
was stopped too. Highlighted content plus a synthetic scroll and settling wait
still failed under full concurrency. A warmed-context trace captured a delayed
native scroll after the new message, recording that message as already seen.
Wait for highlighted content and guarantee one native scroll before publishing
new content; from an already-zero position, move one pixel and back to queue it.
A runtime regression delays that event at both starting positions. The next
warmed trace caught one pending layout repinning the panel after that event.
Requeue the native scroll while the panel has moved from zero, and exercise
that repin in the regression. Require the actual New messages control before
scanning. The separate `long` scene retains
its streamed-delta check; record the failed paths and red controls in certification.

Completed on Kubuntu: 38 readiness conversions, five ineffective callbacks
removed and 34 individually explained timers. All 38 owning tests pass at
repository default timeouts. The full accessibility sweep passes all 716 pages
(179 scenes × four themes), with zero violations, undecided rules or missing
results; the warmed-context jump check passes 36 pages. Ten visual states match
main, with caret, clock, elapsed-label and glyph/border rendering differences
listed in `docs/certification/harness-waits.md`. Six deliberate failure controls
have SHA-256-exact restoration. Scoped compiler/static checks and production
build pass without changing caps; aggregate quality remains lead-owned (§7).

## SHOTS — README screenshot refresh (2026-10-06)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

Refresh the README and Marketplace screenshots from this release's actual
webview harness. Build dev, capture every existing mapping to a preview,
inspect each committed/captured pair, and replace shots whose UI changed.
Preserve existing sizes and themes. The Chrome CLI capture stalled on this
rig; use the existing Playwright helper and harness readiness/scan result
in the README runner, refusing harness errors before writing an image. Add
images of M112's open-question dock and the Help & Reference page using existing scenes where possible; append
any needed scene and wait for its controls with `whenFound`. Do not edit
existing scenarios owned by HARNESSWAIT. Align both landing pages' captions
and alt text with the captured views; preserve versions and the single
What's New section. Record every image verdict, scoped checks, accessibility
receipts and before/after packaged VSIX sizes in
`docs/certification/readme-shots-2026-10-06.md`. No feature, dependency,
wire shape, paid call, merge, push or gate change is authorized.

The lane runs owning test files with the repository's default timeout,
compiler projects, scoped lint/format, dead-code, duplication, localization,
host API, reference and production build on Kubuntu. Shared rig rules
prohibit aggregate quality; the lead retains full integrated quality.

Completed on Kubuntu: four existing shots refreshed, two new shots added,
17 mapped captures inspected, 54 owning tests passing at default timeouts,
eight new-scene accessibility pages passing and four restored red drills.
Scoped static checks and production build pass; the same-content Linux VSIX
grows by 254 bytes (2,289,534 → 2,289,788), below its unchanged 2400 KiB cap.
The full receipt and per-image verdicts are in the certification record.

## PROMPTMENU2 — Composer context menu across panel hosts (2026-10-06)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

Scope: reuse the compact Prompt library popover at the pointer in panel hosts
without VS Code's contributed context menu. The VS Code HTML marks its native
menu capability before React mounts; the browser harness does not. Save, Share
and Use retain the toolbar's conditions and exact draft callbacks. Escape closes
the popover and returns focus to the input; placement stays inside the viewport.
Shift-right-click retains the browser's own clipboard menu. The existing
`copyText` bridge is write-only: no clipboard-read/paste port exists, so no
clipboard rows or new wire methods are invented.

- [x] Inventory actual panel mounts and native/MHP dependency evidence.
- [x] Shared composer fallback, pointer placement and native-menu guard.
- [ ] Complete owning tests at default timeouts; deliberate failures with
      byte-exact restoration; five typechecks, lint, formatting, plain knip,
      duplication, localization/reference/host checks and capped build.
- [x] Composer accessibility scenes and visual inspection in four themes.
- [x] Certification, changelog and Help & Reference updated; local hooked commit.

Status: 210 unique tests pass at default timeouts; eight drills restore exact
bytes; all five types, full lint/format, plain knip, localization/reference/host
checks and capped build pass. Accessibility is 32/32 pages and all twelve
screenshots are visually checked. The third checkbox remains open only for
the inherited ACP duplication deferral in §7; no prompt-menu clone was reported.

Next slice: repair the inherited ACP fixture duplication, then integrate this
fix into the release branch and run full quality/hosted CI. Native and companion panel mounting remains M104 work;
ACP/editor-owned chat UIs do not render this composer and retain their editor's
context menus. Evidence lives in `docs/certification/promptmenu-hosts.md`.

## REL0144 — Release 0.14.4 preparation (2026-10-06)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

**Hosted CI repair (run 37558466658, 2026-10-06).** Fast-forward the rig to
`sync/rel0144-host` (`99163bd10`). Make the browser fixture build every page
and metafile its package assertion reads, and prove it after deleting `dist`.
Replace chained HTML sanitization with one encoding pass; audit literal regex
escaping and document only specific Semgrep false positives in §8. Validate
the complete installed ACP help table without stripping M118's keys. Re-run
all configured Vitest files in batches of at most three at default timeouts,
the production build, both packages, reference and universal-artifact checks,
and CI's pinned Semgrep 1.178.0. No paid/live calls, push or extra merge.

Rig repair certified on `b881f932f`: 557 files, 11,815 passed tests, zero
failures and 72 existing skips at repository default timeouts; both packages,
all named static checks, zero Semgrep findings and installed ACP help in all
15 languages pass. The universal job's installed-package fake guards pass
38/38. Receipts and scanner warnings are in
`docs/certification/m118.md#hosted-ci-repair-for-0144`; hosted CI remains with
the lead.

Merge only `sync/main-0144` into the reviewed M118 integration, preserving
M112 questions, Help and STARTDIET deferred surfaces. Give M118 optional
surfaces the diet's accessible loading/retry pattern and independent measured
caps (size plus 15%, rounded up to 25 KiB). To retain the diet regression
baseline, defer existing tool bodies and review findings, and the history row
with its M118 Save menu; preserve their rendering and actions. Load the effort
slider on first model-menu use too. Pack the generated Node reference at build
time with native Brotli, retaining the decoded model and zod checks; keep
startup at 900 KiB, original
deferred UI at 50 KiB and VSIX at 2400 KiB. Join both help inventories and
regenerate all derived references. Prepare the manifests and release notes
for 0.14.4; certify every configured Vitest file at repository defaults, all
accessibility scenarios in four themes, static gates, production builds and
packages, and live public badges. No model calls: Use prepares text and never
submits. Hosted run IDs remain the lead's release-record fields. Pack the manifest
localization tables needed by standalone full Help into the ACP tarball, and
prove staged full Help for every shipped language before npm packing.

## FIXM118INT — RVM118INT corrections (2026-10-06)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

Repair all five reviewed P2s within the existing M118 ownership and budgets:
use confinement's canonical `checkedAbsolute` for every atomic sharing writer;
make prompt cancellation invalidate an in-flight release after the Save picker
and at each write admission; reuse `usePrompt` in the terminal for whitespace
placeholders and literal single-pass substitutions; observe Settings Sync changes
at activation before the lazy sharing bundle is used; show prompt-action failures
through the shared response reducer on composer, message/history and palette
routes. No new dependency, wire shape, guard relaxation or paid/live call.
The activation shim reuses the existing configuration listener and constructs
its loader/raw ports only on demand, retaining M118's 1 KiB growth limit.
Each correction gets a failing regression and a byte-exact restored red drill
in `docs/certification/m118.md`. Rig runs use repository-default test timeouts.
The sprint rig brief forbids aggregate quality and unlisted merges; the lead
owns hosted full quality. The common M72 merge target is absent on this rig and
is superseded by the already-integrated M118 base; this repair adds no merge.

## FIXM118C — RVM118C corrections (2026-10-06)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

The lane brief authorizes all four P2 fixes in C's existing regions: one
boundary-aware path tokenizer for both modes/all formats (P2-1/P2-3), full
displayed outcome and citation material from the existing transcript item
projection (P2-2), and session/unmount generation invalidation for pending
dialog confirmation (P2-4). Conversation's allow-list and D98's explicitly
selected scrubbed attachment policy stay unchanged. No dependency or guard
expansion. Each finding gets a failing regression, a byte-exact restored red
drill and receipts in `docs/certification/m118-c.md`. The authoritative rig
brief prohibits merge/push/rebase and aggregate quality; bounded owning tests
and static/build checks run directly on Kubuntu, with hooks-on local commits.

## FIXM118P — RVM118P correction lane (2026-10-06)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

The rig brief authorizes the seven reviewed corrections within P: machine-only
sync consent; one explicit destination chooser for native imports, saves and
copies (workspace first under confidential/unknown policy); merge before every
mirror write; recheck newest revisions under the disk lock; bind queued loads
to the id returned by opening the requested surface; successful draft saves
return the persisted prompt and continue as edits; and per-scope list results
that report damage while preserving the healthy picker. Each receives a
regression and byte-exact deliberate-failure receipt in `m118-p.md`.
No dependencies, paid/live calls, caps, guard widening, merges or pushes.
The shared core and React ports carry the corrections to W/X's editor bindings.
Bounded local checks run here; the lead owns full integrated quality.

## REL0143F — Repair release PR #129 CI failures (2026-10-06)

**Status 2026-10-06: built.** Status evidence: `docs/certification/rel0143-ci.md`.

Continue `release/0.14.3` at `4122e1155` without another merge or push.
Reproduce the report frame inventory, crash recovery, question dismissal and
Cline quoting failures. Match the shipped inventory exactly, exercise M25's
state flush and crash-loop prevention through the diet's retry helper, preserve
M112's session-scoped exactly-once commands across lazy surfaces, and remove
expensive shell startup from the quoting unit test without raising timeouts.
Run every Vitest file in batches of at most three on Kubuntu with the repository
default timeout; fix additional merge failures. Run production build, VSIX
package, reference, localization, five-project typecheck, lint and the shared
static checks. All existing gates and caps remain unchanged. The brief's full
batched suite requirement supersedes common.md's focused-file restriction;
aggregate quality and hosted cross-platform certification remain lead-owned.
No live/paid call, network request, dependency, hook change or publication.
Record failures, byte-exact red drills, counts and gate receipts in
`docs/certification/rel0143-ci.md`. Local commits use the existing hooks.

Completed: repair commit `e9e0e055e`. All 532 Vitest files ran in 178 default-
timeout batches: 11,430 passes, zero failures, 72 existing skips. Four deliberate
failures were restored byte-exact. Five-project typecheck, full lint/format,
reference, localization, host API, plain Knip, zero-clone duplication, production
build and package pass. The real VSIX's 39 fixed JavaScript members exactly
match both the manifest and report frame allowlist, including questionNotes.js.
No additional merge failure, cap change or timeout override was needed.

## FIXM112Q — Durable-question review corrections (2026-10-06, Q complete)

**Status 2026-10-06: built.** Status evidence: `docs/certification/m112-q.md`.

Scope: all six findings in `RVM112Q.report.md`, within Q's existing files.
Late answers use the ordinary user-message send path, including permission-mode
barriers and session-not-loaded recovery. Re-asks own a fresh deferral deadline;
publication makes one atomic store replacement and failed publication restores
the durable snapshot as well as memory. Coalesced replies attempt every live
request independently and retain the card until every attempt settles. Session
deletion sweeps every snapshot temporary file bearing that session's prefix.
No dependency, wire shape, guard relaxation, paid call or new command is needed.
Shared registry/storage behavior applies to runtime/editor integrations; the
controller correction applies wherever the existing conversation bridge runs.

Each finding requires a failing-before regression and a deliberate red drill
with byte-exact restoration in `docs/certification/m112-q.md`. Run targeted
Kubuntu suites and the lane's static/build checks; the lead owns full quality
and cross-platform integration. No merge or push is authorized in this lane.
Implementation commit `070a79e7a` closes all six findings, with eight byte-exact
red controls and 1,417 passing tests across fifteen complete owning files.
Host/integration types, scoped lint/format, plain knip, duplication, localization
and production build pass. The inherited U reducer and A inventory handoffs
remain as below.

## REL0142 — Prepare the 0.14.2 Help reference release (2026-10-06)

**Status 2026-10-06: built.** Status evidence: `docs/certification/rel0142.md`.

Scope: merge `sync/main` at `1c5f016ae` into the Help reference branch with
both features and gates intact; keep released 0.14.1 entries in their section.
Then bump the three-part version to 0.14.2, promote only new Help entries,
and update both landing pages with one current What's New section. Preserve
main's future plans and all Help audit records. The scoped Kubuntu checks are
the release/version, packaging, badge, Help/reference and fake stdio suites;
localization, reference, five-project typecheck, changed-file lint/format,
production build and unchanged bundle budgets. No tag, push or publication.
The brief prohibits aggregate quality; the lead retains integrated quality.
The release packaging suite exposed a differently ordered Hungarian Help
translation suffix. Normalize its key order to the other tables without
changing any key or translated value, preserving the existing archive gate.
The headless stdio package fixture must also include Help's lazy reference
bundle, which the production packager now requires; retain every guard.
The integrated reference bundle exceeded its unchanged 100 KiB budget by
631 bytes. Assign the shortest existing pool references to the most frequent
values, preserving all expanded JSON, schemas and translations; prove the
lossless round trip and retain the existing size cap.

- [x] Resolve and certify the main integration, then commit with hooks on.
- [x] Prepare the release metadata and user-facing notes; repeat release checks.

Round 2 merges `feat/help-reference-fix` at `a010a1994` with `git merge
--no-ff`, preserving release metadata, Hungarian ordering, the stdio fixture
and frequency-sorted reference pooling. Regenerate all reference outputs from
the combined generator and promote the final audit fix into 0.14.2 while
Unreleased stays empty. Repeat the certified release checks and retain the
100 KiB reference cap; hooks on, local merge commit only, no push/tag/publish.

Evidence: `docs/certification/rel0142.md`.

Round 3 repairs the hosted failures on PR head `919401ec3` after the
authorized fast-forward from `release/0.14.2-pr`. Export the activation paid
callback from a small module and test it by import, replacing source slicing
and evaluation. Expect both localized usage and Help reference lines in the
fake ACP stdio checks. Compare real VSIX members against a locally rebuilt
0.14.1, remove redundant reference material, and retain bundle caps. If the
universal VSIX still exceeds 2200 KiB after removing waste, the owner's
explicit release rule sets its cap to measured bytes plus 5%, rounded up to
25 KiB. Certify package, owning stdio/reference/release suites, typecheck,
lint, formatting and localization directly on Kubuntu; local hook-on commits
only, no push, tag, publication, paid/live calls or aggregate quality.

Round 4 repairs the second hosted CI failure on `900a06738`: build the
generator test's unchanged model once per file, reuse unchanged keyboard
analysis for mutation checks, and normalize all reference evidence paths to
forward slashes before lookup or matching. Keep mutation checks sensitive to
changed source and registry inputs; prove Windows-style paths and deliberate
registry bypass failures. Audit the other reference/help suites for repeated
setup. Run every requested release/reference/fake stdio suite with repository
default timeouts, recording the slowest tests before and after; repeat real
packaging and scoped static/build gates. No timeout, threshold, hook or bundle
cap changes. Aggregate quality and hosted cross-platform runs remain with the
lead under the explicit rig/shared rule; local hook-on commits only.

Round 5 repairs the last two hosted failures on `48a2e8575`. Update only
the dev-only `shell-quote` lock entry within `npm-run-all2`'s existing
`^1.8.4` range to a fixed version for GHSA-pqg4-j6r4-53mv; add no direct
dependency, override or audit exception. Verify clean installation in an
isolated directory because this rig's existing dependencies are hard-linked
to a shared install. Preserve the deliberate complete-reference contract for
`exec --help`, `report --help` and `scan-secrets --help`: commit `94a1e7d3b`
and `docs/certification/help-reference.md` record parity with `help --all`.
Update the stale report parser expectation, then run the requested Help,
reference and fake stdio suites with default timeouts, audit, typecheck,
lint, formatting, reference freshness and production build. No new command
or feature, gate change, paid/live call, merge, push, tag or publication.

Round 6 repairs the universal release-artifact check on PR #127: compose
compact ACP help from both installed table entries, including its reference
hint, with one formatter shared by the CLI, fake stdio tests and bundle check.
Check English and every installed translation. Audit scripts and workflows
for other stale usage comparisons, and reproduce the secret-free universal
artifact job locally: production build, universal VSIX and contents/size
checks, ACP pack/install and contents checks, shared-text loading, fake
headless process guards, SBOMs and source/hash receipt. Keep repository test
timeouts, hooks and all budgets unchanged; no merge, push, tag, publication,
live/paid calls or aggregate quality. Record baseline failure and deliberate
guard failures in `docs/certification/rel0142.md`.

## BADGEFIX — Exact package versions on store pages (2026-10-05)

**Status 2026-10-05: built.** Status evidence: `docs/certification/badgefix.md`.

- [x] Generate static Marketplace/Open VSX and npm/GitHub release version
      badges from the manifest while staging each package. Landing-page templates
      use `{version}`; installed READMEs contain the exact package version.
      Keep GitHub's root README versions and all count badges dynamic.
- [x] Discover all README badge images, including Markdown/reference images and
      GitHub's trusted workflow badge; fetch them before purging GitHub camo.
- [x] Add `check:badges` to quality and CI: HTTPS image targets, trusted store
      SVG hosts, no dynamic store versions, exact staged versions and valid SVG
      responses. Keep PNG screenshots as HTTPS content images. Network skips
      require a named local reason and are refused in CI; packaging checks the
      exact staged READMEs. No model calls, dependencies or runtime UI changes.
- [x] Package and inspect the VSIX and ACP tarball; prove dynamic-version and
      version-mismatch failures, restore byte-exact, and record focused/static
      checks and artifact versions in `docs/certification/badgefix.md`.

The rig brief prohibits push, merge and rebase; shared rules reserve aggregate
quality for the lead. Run the bounded owning tests and static/build gates here,
with hooks on. Badge-check public requests are the brief's sole added network
exception; release cache refresh remains CI-only. Time box: 60 minutes.

## CIFIX14T — Timed-out monitor cleanup on macOS (2026-10-05)

**Status 2026-10-05: built.** Status evidence: `docs/certification/cifix14-monitor.md`.

- [x] Collect 30 complete baseline owning-file runs under twelve CPU load
      workers. Capture a running descendant after return with a 300-call
      native diagnostic; prove Mac zombies also accept signal zero.
- [x] Fix the proven product race: SIGKILL returned before a descendant
      exited (loaded native probe: PID 60465, parent 1, group 60423, state R).
      Await POSIX group exit for up to two seconds, then signal again and log.
      Exclude Linux zombies from running groups and make the Mac test probe
      recognize exited zombies and already-reaped PIDs. Preserve Windows jobs.
- [x] Prove 30/30 loaded runs (210 tests), with the wait removed failing 3/3
      loaded drills. All seven guard drills restore exact SHA-256 bytes.
      Five owning shell files pass 113 tests, with six existing Windows skips.
- [x] Complete static/build checks and prepare the hook-on local repair
      commit within the 60-minute lane. No push, merge, rebase or paid/live call.

Evidence belongs in `docs/certification/cifix14-monitor.md`. The explicit rig
brief prohibits pushes, merges, rebases and paid/live calls; the shared lane
rules reserve aggregate quality and integrated coverage for the lead. Test
deadlines, retries, skips and every existing gate remain unchanged. Shared
shell execution covers the extension and ACP/headless runtime on every editor.

## STARTDIET — Chat startup headroom (2026-10-05)

**Status 2026-10-05: certified.** Status evidence: `docs/certification/startdiet.md`.

- **Scope.** Measure the production startup import closure and record its forty
  largest modules with import chains. Keep the 900 KiB startup cap and all
  existing budgets; achieve at least 40 KiB of startup headroom on 0.14.0.
  Move the syntax engine and all eighteen grammars to a lazy code-body chunk:
  render the escaped, selectable code and its actions immediately, including
  during streaming and import latency. Load highlighting only for a closed,
  supported fence. Keep Markdown/GFM parsing synchronous for restored messages.
  Defer the remaining action-only dialogs (Share, Session Board, handoff,
  secret prompt), and the separate Tasks surface. Reuse React, localization,
  language aliases and shared helpers through ESM splitting. Reuse the existing
  palette list/dismissal shell in the command palette: deferring Session Board
  otherwise moves that shell into the original deferred cohort (52.0/50 KiB).
  Deduplicate those handlers/markup and keep the shared shell eager so that cap
  holds, without inventing a helper or changing dismissal behavior. Use hash-only
  generated browser chunk names: the first shell dedupe still leaves 80 import
  bytes over the old cap, and more palette-body cleanup only saves eager bytes.
  Stop that route; remove repeated generated names from import paths instead.
  Metafile source/entry-point guards and `chunks/*.js` packaging stay unchanged.
  The full accessibility scan found no axe violations but one report page checked
  its lazy dialog at a fixed 400 ms before it loaded. Use the existing bounded
  `whenFound` helper for its checkbox inspection; retain both the exact count
  and 24 px spacing assertions, and rerun the complete gate.
  No dependency,
  translated text, model/wire shape, paid-call or host-specific change.
- **Budgets.** Add measured budgets for the new lazy import closures under D6's
  existing size-plus-15%-rounded-to-25-KiB rule. The original seven deferred
  surfaces retain their aggregate 50 KiB cap, including any shared deferred
  helpers. Unclassified deferred output stays charged to that cap. Guard new
  entry points, their source placement and startup exclusion in the split gate.
- **Proof.** Before/after per-output bytes and startup/deferred totals; unchanged
  empty/sign-in/transcript/Markdown harness images; the accessibility gate;
  directly run touched/owning unit files (at most three per invocation, three
  workers), typecheck, changed-file lint/format, localization, host API,
  deadcode, duplication and production build. Hold a new import to prove code
  and actions render while it loads and a canceled dialog stays closed. Statically
  re-import a moved module, watch the bundle split check fail, then restore its
  SHA-256 exactly. Record results in `docs/certification/startdiet.md`.
- **Editors.** All changes are in the shared browser UI/build guards; every editor
  using that webview receives the same behavior. ACP/headless have no browser
  surface and their bundles/behavior are unchanged. No live or paid calls.
- **Certified.** Startup 893.221 → 792.149 KiB (107.851 KiB headroom), original
  deferred surfaces 49.697/50 KiB; new highlighting 93.131/125, action dialogs
  9.141/25, Tasks 1.343/25. All existing caps unchanged. 302 owning unit tests,
  production build, static checks, four identical screenshot pairs and all 620
  accessibility pages pass. Red fallback/static-import/close/checkbox drills
  fire and restored bytes/receipts are in `docs/certification/startdiet.md`.
- **Lane gates.** The rig brief explicitly forbids full quality/full unit runs
  and merges; use its direct targeted checks and hooks-on local commits. The
  lead owns the full cross-rig gate and integration.

## CIFIX14C — Packaged ACP help agrees with its canonical table (2026-10-05)

**Status 2026-10-05: built.** Status evidence: `docs/certification/cifix14-acp-usage.md`.

- [x] Reproduce the release job's strict English fallback check against the
      installed production ACP tarball, and trace both help strings through
      the generated runtime region and package copy.
- [x] Fold the existing translated Setup command into `acpUsage` in English
      and all 14 translations; remove the separate key and appended write.
      Both help and argument errors read the complete canonical usage once.
- [x] Prove exact help/table equality and Setup visibility in process tests,
      including a translated locale; run the release package steps, localization
      checks and ACP regressions directly on Kubuntu in bounded batches.
- [x] Record gate-fire drills, artifact sizes and unavailable platform steps in
      `docs/certification/cifix14-acp-usage.md`; commit locally with hooks.

The rig brief prohibits pushes, merges, rebases and paid/live calls; shared
rules prohibit aggregate quality and writes to the existing `node_modules`.
Use the installed dependency tree and an offline scratch-prefix tarball install.
The lead retains the integrated full quality and hosted universal-helper checks.
The existing strict equality check and every budget remain unchanged.

## CIFIX14W2 — Windows short paths in the kept shell directory (2026-10-05)

**Status 2026-10-05: built.** Status evidence: `docs/certification/cifix14-shortpath.md`.

- [x] Resolve Windows workspace roots and shell-reported directories to the
      native long form before containment, relative tails and command cwd use.
      Keep POSIX path handling unchanged and retain link/junction confinement.
- [x] Reproduce with a real 8.3 directory on the Windows 11 rig; assert the
      canonical tracked directory, the `sub` tail, root silence and escape reset.
      Exercise both short/long input directions with injected path functions.
- [x] Remove canonicalization, observe the complete owning file fail, restore
      byte-exact and collect the shell suites with default CLI timeouts and
      three workers. Run the shared lane's static/build checks and commit locally
      with hooks; no push, merge, rebase or paid/live calls. Time box: 60 minutes.

Evidence belongs in `docs/certification/cifix14-shortpath.md`. Shared lane
rules reserve the integrated full quality run for the lead; all existing
gates and timeouts remain unchanged.

## CIFIX14M — macOS hosted CI repair for 0.14.0 (2026-10-05)

**Status 2026-10-05: built.** Status evidence: `docs/certification/cifix14-macos.md`.

- [x] Collect all four CI unit/process-e2e shards on the Mac mini, in the rig
      brief's batches of at most three files with three workers. Preserve coverage
      collection and merge the complete map against the unchanged thresholds.
- [x] Repair the deferred-bundle tests' dependency on pre-existing `dist/`
      artifacts: build and load every required support bundle from private fixtures,
      using the production English compression plugin for the exact-value check.
      Preserve activation's assertions that action bundles remain unloaded.
- [x] Fix any further macOS failures at their root, prove regression assertions
      fire, then collect two consecutive green complete runs and per-file receipts.
- [x] Run typecheck, scoped lint/format and the available static/build gates;
      commit locally with hooks. No push, merge, rebase or paid/live call. VS Code
      integration is outside the macOS CI matrix. Time box: 90 minutes.

The explicit lane brief authorizes full shard coverage but shared rules prohibit
`npm run quality`; the lead retains the integrated full quality gate. No gate,
timeout, retry or skip policy is changed. Evidence is recorded in
`docs/certification/cifix14-macos.md`.

## TRAIN14B — Complete the 0.14.0 release train (2026-10-05)

**Status 2026-10-05: built.** Status evidence: `docs/certification/train-0.14.0.md`.

- [x] Merge origin-main (#121), M91/M91b, M93, Knip constants, DEFLAKE4 and M98 phase 1 in the brief's order, retaining every source head and both split-check speed fixes. Skip unready m94/kw and ci/refresh-badges for the lead.
- [x] Connect metered Judge claim/settle/refund/lookupByClaimId/latestDay to D78's shared daily ledger and test shared reservation plus subscription-only consent behavior.
- [x] Adapt ACTDIET prototype commits after the merges; activation at most 600,000 bytes, shared English under the original 125 KiB, webview startup under 921,600 bytes, all other caps unchanged.
- [x] If the actual universal package still exceeds its unchanged cap, use measured shared Node wire schemas and one bounded lossless translation archive, preserving exact locale values, source tables, browser parsing and ACP JSON compatibility. Before startup repair the real universal VSIX is 2,436,399 bytes; fourteen individual Brotli tables occupy 605,236 ZIP bytes. A language-major values matrix measures 434,140 Brotli bytes, and shared existing protocol/agent-event schemas save about 20.6 KiB compressed across five measured Node consumers before conversation/ACP. No dependency or existing cap changes.
- [x] Preserve the browser’s synchronous inline English fallback with a build-only dictionary over repeated text and label-key fragments; decode all keys, values and plural forms exactly before localization state is created. Register every new exact bundle path in M93’s frame vocabulary, preserving package-only stack privacy. Rebalance Share and the small Session Board into eager imports so the unchanged 50-KiB deferred cap and 900-KiB startup cap both hold. The lossless key/value probe saves 38,451 bytes; no user copy, functionality, dependency or cap is removed.
- [x] Preserve both full What’s New releases through a lossless Node-only Brotli envelope when the plain tree exceeds its unchanged 40-KiB on-disk cap. The measured 60,873-byte tree needs a new 75-KiB decoded bound (measured plus 15%, rounded to 25 KiB); validate the envelope and decoded tree, retain small/plain compatibility, and prove round-trip and expansion limits. This follows the existing packed Node fallback and keeps all release content.
- [x] Prepare 0.14.0 with one dated changelog section, at most five Highlights, byte-identical older releases, and matching full/Marketplace README sections and install versions.
- [ ] Run full quality directly on Kubuntu and measure a CI-shaped VSIX with the checksum-verified universal helper from the authorized 0.13.0 archive. Record conflicts, sizes, drills, gate tail and PR description in the train certification. Local hook-on commits only, no push, rebase, paid/live call; 180-minute time box.

Train 0.14.0 final gate repair: update ACP fixtures for required split bundles, await the lazy report, and use VSCE’s actual listFiles API without CLI startup. Optimize the build-only lossless English codec without changing output or timeouts. M91 extension hooks must use M71’s held-project trust both before loading and before running, including manual hooks; certify the activation wiring regression.

## TRAIN14A — Start the 0.14.0 release batch (2026-10-05)

**Status 2026-10-05: built.** Status evidence: `docs/certification/train-0.14.0.md`.

Final integration review joins M94 Tab to M71 held-project trust: the Tab
factory receives `isProjectTrusted`, and its ignore-check Git runner carries
the same predicate through `beforeRun` to the native entry. Prove both wiring
checks fail under deliberate bypasses, then restore exact source bytes.

- [x] Merge M94 Tab, M71 git/PRs, M100 multi-device plan and DEFLAKE3 in that order, each as a two-parent merge commit. Preserve all decisions, translations and byte-identical released changelog sections from `7820bd30`.
- [x] Resolve integration overlaps by retaining D78 default availability and M94 first-use consent, then regenerate generated inventories. Defer a merged feature's optional UI through the existing chunks if required; every current size cap stays unchanged.
- [x] Run each branch's scoped tests (at most three files, three workers, 120-second test timeout), typecheck, changed-file lint/format, localization, host API, production build and package after every merge. Full quality belongs to the later completed train and is explicitly excluded by this brief.
- [ ] Certify each CI-shaped VSIX with the actual universal helper. Its measured prior-train ZIP contribution gives estimates within the cap after the repairs; Q-TRAIN14 records the missing artifact and read/network fence.
- [x] Record conflict decisions, checks, gate-fire drills if new guards are needed, and exact per-merge bundle/archive bytes in `docs/certification/train-0.14.0.md`. Commit locally with hooks; no push, main merge, rebase, credential access or paid/live call. Time box: 100 minutes on Kubuntu.

## KNIPC — Restore dead-export analysis of shared constants (2026-10-05)

**Status 2026-10-05: built.** Status evidence: `docs/certification/knip-constants.md`.

- [x] Reproduce the Knip 6.38.0 blind spot and bisect a scratch copy of
      `src/shared/constants.ts`; identify the source construct or entry/config
      classification that suppresses its exports.
- [x] Fix the cause without an ignore or weakened gate; remove genuinely
      unused constants and tests that only keep those constants alive.
      The whole-module enumeration in `execSchema.test.ts` and disabled
      namespace issue types were the two blockers. Named imports plus additive
      `nsExports`/`nsTypes` inclusion expose both planted value/type exports;
      every existing constant remains referenced, so none is removed.
- [x] Plant an unused export, observe plain Knip exit 1, restore byte-exact
      and observe exit 0. Record evidence and scoped static/build/test checks
      in `docs/certification/knip-constants.md`; commit locally with hooks on.

The KNIPC rig brief and shared lane rules prohibit full quality/full-unit
runs and integration merges/pushes. The lead retains full quality, coverage,
accessibility and integration certification; this lane runs the required
scoped checks directly on macmini, with all existing gates unchanged.

## DEFLAKE4 — Deterministic deferred-bundle split drills (2026-10-05)

**Status 2026-10-05: built.** Status evidence: `docs/certification/deflake4.md`.

Scope: remove repeated child-process/full-repository split scans from
`test/unit/deferredBundles.test.ts` without changing a timeout, retry,
platform condition or gate. Reuse the production build and the actual gate's
deferred-bundle declarations and checks; a small callable tooling module is
needed because importing the current CLI executes every gate and exits.

- [x] D4-A: build real shipped entries once per test file and cache their
      metafiles; each case mutates an isolated in-memory copy.
- [x] D4-B: every existing split drill observes its exact rejection and
      restored green, with SHA-256 byte-exact restoration; deliberate guard
      defects must make the owning tests fail.
- [x] D4-C: run the entire owning file 50 times on this Windows host with
      another Vitest run alongside; report each test's maximum and mean,
      comfortably below 2 seconds, in `docs/certification/deflake4.md`.
- [x] D4-D: run the lane's scoped/static/build gates, update changelog and
      certification, then commit explicit paths with hooks enabled.

Readiness: the existing build already runs once in `beforeAll`; each of five
drills launches the full split CLI twice, repeatedly reading all outputs and
source files and parsing TypeScript. Preserve the canonical declarations,
diagnostics and every parent/destination check. No UI, protocol, dependency,
paid call or release change. The named brief authorizes local parallel Vitest
for D4-C despite common.md's ordinary rig-only/one-process rules.

- [ ] Recover the merged webview startup overage within unchanged startup and
      deferred budgets: inspect model-text overcarriage, then defer optional
      dialogs with the existing loading/focus affordance only if measurements fit.

## DEFAULTS — Available enhancements and interactive daily paid admission (D78)

**Status 2026-10-04: built.** Status evidence: `docs/certification/defaults.md`.

Scope and acceptance are in D78. The existing paid gate and consent remain
canonical; the daily adapter reuses M82's journal, while the final HTTP
guard reserves and settles only interactive extras. No new dependency,
wire shape or prompt text. Separate `dictationEngine` selection preserves
the free system default. Test/quality evidence lives in
`docs/certification/defaults.md`. M91 golden fixtures and M94 Tab are not
in this base; their integrated-tree proof remains the lead's next step.

Every milestone carries the same certification checklist (§6.0) plus its own
acceptance criteria. **A milestone is not complete until its checklist passes.**

## SDK142 — Muse Code 1.4.2 fingerprint and documentation (2026-10-02)

**Status 2026-10-02: built.** Status evidence: `docs/certification/sdk142.md`.

Scoped maintenance: recognize the captured additive MSP fingerprint of
1.4.2-R4684.1. 1.4.1-R4503.1 is not added: it never reached npm and no live
frame of it was captured, so a 1.4.1 host still warns. Keep the SDK at 1.3.0, its own
1.3.0-R3401.1 fingerprint outside the successor map, and the existing
additive-successor log wording. Unknown fingerprints still warn.
Correct CLI facts from the October 2 research without building features.

- [x] Verify all three digests against the SDK research artifacts and release evidence.
- [x] Test both successor mappings and log outcomes, plus the SDK's own pin;
      remove the 1.4.2 entry, observe failure, then restore byte-exact.
- [x] Run the backend/host/account tests and the process-level fake CLI e2e
      on Kubuntu, including an explicit 1.4.2 served fingerprint while the
      default fake continues to use SDK 1.3.0's `EXPECTED_SCHEMA_FINGERPRINT`.
- [x] Correct provider selection, model effort metadata, session deletion,
      feedback, voice and Windows workaround facts; preserve dated evidence
      and append dated notes where needed.
- [x] Run typecheck, scoped lint/format, deadcode, duplication, localization,
      host API and production build on Kubuntu; keep package files unchanged.
- [x] Record results in `docs/certification/sdk142.md` and update its index.

Scoped gates verified on Kubuntu; see `docs/certification/sdk142.md`.
The named CLI research report is missing. The listed corrections were
checked against its available raw captures and release evidence; the lead
should reconcile that report when it is supplied.

The lane brief overrides §6.0's full local quality run: the lead owns the
aggregate gate. This lane commits with configured hooks and does not push.

## M0 — Scaffold and gates (this session)

**Status 2026-09-22: complete.** Certification record: `docs/certification/m0.md`.
All gates pass on the scaffold and were each proven to fire; the visual F5 check
is the one open item (Q7).

- **Goal**: production-grade skeleton; every gate green on the empty scaffold.
- **Scope**: repo init, toolchain, configs, CI, hooks, docs, minimal extension
  that activates and shows an empty webview, minimal tests.
- **Files**: `package.json`, `package-lock.json`, `.npmrc`, `tsconfig*.json`,
  `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`,
  `.stylelintrc.json`, `knip.jsonc`, `.jscpd.json`, `vitest.config.ts`,
  `.vscode-test.mjs`, `scripts/build.mjs`, `scripts/check-bundle-size.mjs`,
  `.husky/pre-commit`, `.github/workflows/ci.yml`, `.gitignore`,
  `.gitattributes`, `.editorconfig`, `.vscodeignore`, `.env.example`,
  `.vscode/{launch,tasks,settings,extensions}.json`, `LICENSE`, `README.md`,
  `CHANGELOG.md`, `PLAN.md`, `AGENTS.md`, `CLAUDE.md`,
  `.github/copilot-instructions.md`, `src/extension.ts`,
  `src/shared/{constants,protocol}.ts`, `src/host/views/ChatViewProvider.ts`,
  `src/host/html.ts`, `src/webview/{main.tsx,App.tsx,styles.css}`,
  `test/mocks/vscode.ts`, `test/unit/**`, `test/integration/**`.
- **Acceptance**: `npm run quality` green; F5 opens Extension Development Host
  with a "Muse Spark" activity-bar view rendering the empty state; each gate
  proven to fire (table in `docs/certification/m0.md`).
- **Tests**: protocol schema round-trip and rejection; HTML/CSP nonce builder;
  React `App` renders empty-state hint; integration: extension activates and
  view command exists.
- **Gates**: all of §6.0 plus first CI run green on ubuntu + windows.
- **Security**: `.env` ignored before first commit; gitleaks proven with a
  fake secret; CSP present in the webview HTML.
- **Performance**: bundle sizes printed and under budget.
- **Docs**: README (install, dev, scripts), CHANGELOG `[Unreleased]`.

## M1 — Panel shell, message bus, keybindings, settings

**Status 2026-09-22: complete.** Certification record: `docs/certification/m1.md`.
Delivered: sidebar + tab surfaces behind a `SurfaceRegistry`, typed message
bus with a settings snapshot, `museSpark.*` settings with validated reads and
live broadcast, keybindings Ctrl+Esc / Ctrl+Shift+Esc / Alt+K / Ctrl+Alt+F,
redacting logger, composer key semantics. Deferred to later milestones as
planned: mic button (P2), onboarding checklist (M8).

- **Goal**: the chrome of the Claude Code panel without a model behind it.
- **Scope**: sidebar `WebviewView` + editor `WebviewPanel` ("Open in new tab"),
  header (title, history icon, new-conversation icon), empty state
  ("Type /model to pick the right tool for the job."), composer skeleton with
  placeholder "ctrl esc to focus or unfocus Muse", "+" and "/" buttons,
  disabled model pill, send button; typed message bus; `museSpark.*` settings
  (`preferredLocation`, `initialPermissionMode`, `autosave`, `attachOpenFile`,
  `useCtrlEnterToSend`, `hideOnboarding`, `focusView`, `respectGitIgnore`,
  `museBinaryPath`, `environmentVariables`); keybindings `museSpark.focusInput`
  Ctrl+Esc, `museSpark.openInNewTab` Ctrl+Shift+Esc,
  `museSpark.insertMentionReference` Alt+K, `museSpark.toggleFocusView`
  Ctrl+Alt+F; output channel logger with secret redaction.
- **Acceptance**: keybindings work in the dev host; settings changes reach the
  webview live; a11y: composer reachable by keyboard, roles/labels set.
- **Tests**: reducer for UI state; settings mapper; keybinding contributions
  present in `package.json` (unit test reads the manifest); integration test
  toggles focus.
- **Docs**: settings table in README.

## M2 — Authentication and the Muse Code (MSP) backend

**Status 2026-09-22: complete.** Certification record: `docs/certification/m2.md`.
Delivered: per-OS launch resolver and child environment (pure, tested on all
three platform branches), `MuseCodeHost` over the SDK's raw `Connection`
with an in-memory fake MSP server for tests, `AuthService` (browser sign-in
via `muse login` in a terminal + credential-file watch, API-key sign-in into
SecretStorage, sign-out, host `authRequired` override), per-surface
`ConversationController`, sign-in gate / transcript / Send-Stop in the
webview. Approval mode is `denyUnmatched` until M4 ships the approval cards.
Live end-to-end run against the signed-in CLI recorded in the certification
file; the in-panel F5 check is the owner's.

- **Goal**: sign in and hold a streaming conversation with Muse Spark.
- **Scope**: `muse` binary discovery (setting → PATH → documented install
  dirs, per OS: Windows `%LOCALAPPDATA%\Programs\muse`, macOS/Linux per
  `install.sh`) with a spawn strategy per platform (D1a); install guidance when absent (opens dev.meta.ai/products/muse-code);
  sign-in screen with "Sign in with browser" (runs `muse login` in an
  integrated terminal, then re-probes) and "Use a Model API key" (input →
  SecretStorage → `META_API_KEY` in the child env); `MuseCodeBackend`:
  spawn `muse serve`, `initialize` with `clientInfo` and
  `capabilities.userInputDialogs = true`, fingerprint check, `session/start`
  with `workspaceRoot`, `turn/start` with text parts, fold `item/*` into
  `AgentEvent`s, `turn/cancel` / `turn/interrupt` for Stop, host-death
  recovery with a visible error, `/logout` → `muse logout`.
- **Acceptance**: with a signed-in CLI, a prompt streams back; Stop works;
  killing the child shows an error card and a "Restart" action; unauthenticated
  state shows the sign-in screen (detected from the turn error kind or a
  failing `usage/read` probe — verify which at implementation time).
- **Tests**: backend against a scripted fake `DuplexTransport` replaying
  recorded MSP transcripts (happy path, cancel, host death, auth failure);
  credential store never logs; env injection.
- **Security**: key redaction verified by a test that greps logger output.
- **Windows hazard (found 2026-09-22)**: the `muse.cmd` shim runs
  `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` and fails with
  `Get-FileHash` not recognised when the child inherits a `PSModulePath` that
  lists pwsh 7 module directories first. When spawning `muse` from the extension
  host on Windows, set `PSModulePath` in the child environment to
  `%ProgramFiles%\WindowsPowerShell\Modules;%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules`
  and cover it with a unit test.
- **Deferred if Q1 unanswered**: live certification.

## M3 — Composer and command palette parity

**Status 2026-09-21: complete.** Certification record: `docs/certification/m3.md`.
Delivered: the "/" palette (seven Claude Code groups from a pure registry in
`src/shared/palette.ts`, filter box, keyboard-only operation, model list as a
second view, skills from `skill/list`), "+" attach (native dialog; images
become host-held attachments with `W×H` chips, other files become `@path`
mentions; paste and drop of images; drop of editor resources), the `@`
mention menu over a `git ls-files` index (fuzzy-ranked, `.gitignore`
respected, VS Code file search as the fallback), model pill + picker
(`model/list`, `session/setModel`), effort slider and Thinking toggle
(`session/setReasoningEffort`, Ctrl+Alt+T / Option+T), the permission-mode button and
Shift+Tab cycle mapped per D7, Enter while a turn runs → `turn/steer` with a
fresh-turn fallback, `/clear` and `/compact`. Live checks recorded in the
certification file.

**Round two (2026-09-21, after the owner's second F5 check and the second docs
pass in §5.3):** the mode button opens the Modes menu and the `+` button
opens the attach menu (Upload from computer / Add context) instead of acting
directly; Bypass permissions sits behind `allowDangerouslySkipPermissions`
(D7); the pill reads `model effort` and hugs its text; the effort dots carry
tooltips and offer the tiers verified per model (D10, Minimal … Max); the
thinking toggle moved from Ctrl+O to Ctrl+Alt+T (Option+T on macOS,
Ctrl+Alt+O on Linux); the placeholder reads "Queue
another message…" while a turn runs; the brand mark is the Meta logo the
owner supplied (panel and activity bar). Harness scenarios `modes`,
`modes-bypass`, `attach`, `add-context` cover the new surfaces.

- **Scope**: "/" palette ("Filter actions…", groups Context / Model / Customize
  / Account & usage / Skills / Slash commands / Support) driven by a command
  registry + `skill/list`; "+" attach: files (QuickPick), images (paste, drag,
  file) as `image` parts with `W×H` chips; `@` mention autocomplete
  (`workspace.findFiles`, gitignore respected, `@path#L1-L9`, folders); model
  pill + picker (`model/list`, shows context limit as "1M"); effort slider
  (low / medium / high / extra high / max → `session/setReasoningEffort`);
  thinking toggle (maps to reasoning display + effort floor); permission mode
  button cycling Manual / Edit automatically / Plan / Auto / Bypass →
  `ApprovalMode` mapping (documented once verified against the CLI);
  Shift+Enter newline; Ctrl+Enter send option; queued message while running →
  `turn/steer`.
- **Acceptance**: every palette item routes; screenshots match the reference
  layout; keyboard-only operation of palette and mention menu.
- **Tests**: command registry; mention parser; image chip dimension reader;
  effort/mode mappers with negative cases.

## M4 — Transcript rendering

**Status 2026-09-22: complete.** Certification record: `docs/certification/m4.md`.
Delivered: GitHub-flavoured markdown for assistant text (react-markdown 10 +
remark-gfm 4, raw HTML never rendered, links through the host with an
http/https/mailto allow list, images reduced to alt text), fenced code as
highlighted blocks (highlight.js core, 18 grammars, Copy and Insert at
cursor), tool rows built on the live wire shapes (Read / Edit / Write /
PowerShell / Bash / Question labels, change line from `patchSummary`,
numbered diffs from the stored `tool_patch` document via `item/readOutput`
with the edit tool's unified `visibleOutput` as the interim view, `IN` /
`OUT` boxes for shell tools, generic rows for unknown tools and kinds),
reasoning rows ("Thought for Ns", summary parts), approval cards driven by
`approval/requested` → `approval/decide` including the multi-stage
`approval/updated` step, question cards for `request_user_input` →
`userInput/answer`, the pinned task list, retry notices, the session name in
the header, the context indicator in the composer, the status line with a
rotating verb, image chips inside user cards, and Focus view folding steps
behind one row. `HAS_APPROVAL_UI` is now true, so Manual / Edit
automatically / Auto run as their real MSP modes (D7). Code-block "Apply"
(diff into the editor) moved to M5 with the rest of the edit-review flow.

- **Scope**: streaming markdown (react-markdown + remark-gfm, sanitised),
  syntax highlighting (Q5), code block Copy / Insert into file / Apply; tool
  rows (collapsible, `item/readOutput` paging); reasoning blocks with Ctrl+O;
  approval cards from `approval/request` (choices rendered from
  `availableChoices` with scope labels, optional feedback); question cards from
  `userInput/request`; pinned todo list; context % and token usage footer;
  turn errors and retry notices; Focus view.
- **Reference (owner screenshots of the Claude Code transcript, 2026-09-21)**:
  tool rows are a bullet + bold tool name + monospace argument (`Edit
C:\…\App.test.tsx`, `Bash List the session images…`) with a one-line
  summary under it (`Added 82 lines`, `Removed 6 lines`, `Modified`) and a
  collapsible body: unified diffs with a line-number gutter and red/green
  rows for edits, `IN` / `OUT` boxes for shell commands (output clipped with
  a fade); reasoning collapses to `Thought for 14s`; assistant text that
  answered a mid-turn message carries a `· summarized` suffix; a spinner line
  with a rotating verb (`Calculating…`) sits under the last row while the
  turn runs; user messages show their image chips (`image.png 695×1032`)
  above the text in a horizontally scrollable strip; the mode button, pill and
  Stop stay live in the composer throughout.
- **Acceptance**: 10k-token response renders without jank (< 16 ms frames in
  the webview profiler); approvals resolve; questions answer; the transcript
  matches the reference above row for row.
- **Tests**: reducer folds for each `AgentEvent`; markdown sanitisation blocks
  script/HTML injection; approval decision payloads.
- **Security**: markdown rendered with `skipHtml`; links open via
  `env.openExternal` after confirmation for non-https schemes.

## M5 — Editor integration

**Status 2026-09-22: complete.** Certification record: `docs/certification/m5.md`.
Delivered: the open-file chip and its `<ide_selection>` /
`<ide_opened_file>` part with `displayText`, autosave before turns, Open
diff / Revert on finished edit rows through a `muse-edit:` content provider
and reverse-applied patch hunks, Apply on code blocks, and the IDE tool
server (MCP over loopback HTTP, `sessionMcp`) exposing `getDiagnostics`,
which `muse serve` catalogs as `mcp__ide__getDiagnostics`. All three flows
verified live through the controller (editor context answered without
tools, the model called the diagnostics tool, an edit was diffed and
reverted on disk); the live edit turn caught and fixed the extended-length
patch path (D11). Design fixed before code, from the Claude Code docs
(research notes) and the MSP facts below.

- **Facts that shape it**: in-workspace file edits are applied by the CLI at
  once and never prompt (D11), so a Claude-Code-style "review before write"
  is impossible on MSP — the review is _after the fact_ (open the diff,
  revert). `muse serve` grants `userShell`, `sessionMcp` and
  `sessionListStream` when asked at `initialize` (probe 2026-09-22), and
  `session/start.config.mcpServers` takes a per-session MCP server over
  `stdio` or `streamableHttp` (closed union), so an IDE tool server for
  diagnostics is possible without a child process: the extension host serves
  MCP over loopback HTTP with a per-host bearer token. `turn/start` has
  `displayText` ("presentation form … never model-visible"), which lets the
  durable transcript show what the user typed while the model also gets the
  editor context.
- **Editor context** (`attachOpenFile`, on by default): the host watches the
  active editor and its selection (debounced), broadcasts `editorContext` to
  every surface, and the composer shows a chip after the model pill (file
  icon, basename, `L5-10` while lines are selected, `×` to drop it until the
  file changes) as in the Claude Code bar. On send the webview says whether
  the chip was on; the host then appends a text part in the Claude Code
  wording — `<ide_selection>The user selected the lines 5 to 10 from
src/x.ts:\n…\n</ide_selection>` with the selected text (clipped), or
  `<ide_opened_file>The user opened the file src/x.ts in the IDE. This may
or may not be related to the current task.</ide_opened_file>` — and sets
  `displayText` to the typed text. The user card shows the same chip.
- **Autosave**: with `museSpark.autosave` on, every send first saves all
  dirty editors (`workspace.saveAll(false)`), so the CLI reads what the user
  sees.
- **Edit review**: Edit / Write rows gain **Open diff** and **Revert** once
  the item completes with a `patchRef`. Open diff fetches the stored patch
  document, rebuilds the pre-edit text by reverse-applying its hunks to the
  file as it is now, serves it through a `TextDocumentContentProvider`
  (`muse-edit:` scheme) and opens `vscode.diff(before, file)`. Revert writes
  the rebuilt text back through a `WorkspaceEdit` (a file the edit created is
  moved to the trash) and posts a notice. When the hunks no longer match the
  file (the user or a later edit changed it) both say so instead of guessing.
  The "Proposed changes" tab and Accept / Reject-before-write from the first
  cut are dropped: MSP offers no pre-write hook for in-workspace edits.
- **Code block Apply**: replaces the active editor's selection with the block
  (inserts at the caret when nothing is selected) and reveals the result;
  Insert at cursor and Copy stay as in M4.
- **Diagnostics**: `initialize` requests `sessionMcp`; `session/start`
  registers `ide` as a `streamableHttp` MCP server served by the extension
  host on `127.0.0.1:<ephemeral>` with an `Authorization: Bearer <token>`
  header (token minted per extension host, never logged, never on disk). The
  server implements `initialize`, `ping`, `tools/list` and `tools/call` for
  `getDiagnostics { uri? }` (errors and warnings from
  `languages.getDiagnostics`, capped), `mode: optional` so a server hiccup
  never blocks a session. Verified live: see `docs/certification/m5.md`.
- **Alt+K** (M3) is unchanged.
- **Tests**: patch reverse-apply (exact match, mismatch, created file, CRLF);
  `muse-edit` content provider and the diff / revert host module with fakes;
  editor-context text builder; the composer chip, dismissal and user-card
  chip; controller parts + `displayText` + autosave; the MCP HTTP server over
  a real loopback socket (auth, `tools/list`, `tools/call`, notifications
  → 202, GET → 405).
- **Security**: the MCP server binds loopback only, requires the bearer
  token, exposes one read-only tool and answers nothing else; reverts never
  touch files outside the workspace (paths come from the patch document and
  are resolved against the workspace root; anything escaping it is refused).

## M6 — Sessions, history, rewind

**Status 2026-09-22: complete.** Certification record: `docs/certification/m6.md`.
Delivered as designed below: the History dialog (paged `session/list`,
grouped and searchable, archive in `workspaceState`, live through the
`sessionListStream` events), resume with inline/snapshot history replayed
into the transcript, the sidebar's ten-minute restore, rename and fork
(offered; Muse Code 1.3.0 refuses both on Windows and the panel shows the
refusal), the unread badge / tab mark, and the tab title following the
session name. Deviations from the design, all deliberate: a `none` history
(host budget) is reported as a warning notice rather than paged through
`view/page` (no session here has come close to the budget; the fallback
stays on the M8 polish list); pending approvals / questions listed in a
resume's `pendingRequests` are not re-shown (the host re-issues them as
server requests, which this client declines by design; a resumed session
with a decision pending is an edge the live check could not produce);
resume applies the surface's effort and permission mode to the session
instead of reading the session's own, so the composer never lies. Wire
probe (`scratchpad/probe-sessions.ts`, no tokens) against the day's live
sessions:

- `session/list` rows carry `sessionId, path, status, activeTurnId,
createdAt, updatedAt, workspaceRoot, providerId, modelId, turnCount,
forkedFrom, title, firstUserPrompt` (no `name` until one is allocated, no
  `lastActivityAt` on rows — the resumed `Session` has it); `title` equals
  the first prompt for unnamed sessions. `firstUserPrompt` / `title` are
  built from the **whole** prompt, so the M5 `<ide_selection>` part shows up
  in them: the History dialog strips `<ide_…>…</ide_…>` blocks for display.
- `Session.modelId` is the metadata fold's model, which is the host default
  `muse-spark-1.3-contributor` even for sessions our `session/start` opened
  on `muse-spark-1.3` (the durable log shows every model request on
  `muse-spark-1.3` and `run.model.configured` naming it). Never seed the
  composer or label a row from `Session.modelId`; after a resume ask
  `model/list` (`isActive`) for the session's model.
- `session/resume` with `history: 'inline'` served `mode: inline` with the
  full item array for a one-turn session (11 items: `userMessage`,
  `reminderChild`s, `toolCall`s, `agentMessage`); `userMessage` items carry
  `turnId`, `commandId` and `text`.
- `session/rename` fails on Windows 1.3.0: "session name rename authority is
  unavailable: … UnsupportedPlatform". The title stays read-only on Windows
  (the error is surfaced as a notice if attempted); to re-check on Linux/macOS.
  Filed upstream as meta-models/muse-code-sdk#30 (2026-09-23).
- `session/fork` fails on Windows 1.3.0 too, with or without a `cutPoint`
  and on a session this connection never loaded: "invalid fork boundary for
  session …: WriteFailed" (`scratchpad/probe-fork.ts`). "Fork from here"
  therefore ships behind the same honest path: the action is offered, the
  CLI's refusal is shown as a notice, and the live check is deferred to
  Linux/macOS. Filed upstream as meta-models/muse-code-sdk#31 (2026-09-23).
- `session/read` (point-in-time, no lease) serves the same inline history as
  a resume (10 items for a one-turn session) and is what the fork cut-point
  lookup and the dialog's preview use.
- With `sessionListStream` granted, `session/listChanged` **does** arrive
  (a full `Session` row), alongside `session/closed {reason: hostShutdown}`
  and `session/statusChanged {status: notLoaded}` when the host shuts down;
  nothing arrived within 3 s of a `session/resume` of a `notLoaded` session
  in the same probe. The dialog therefore folds `session/listChanged` rows
  when they come and still refreshes with `session/list` when it opens and
  after its own actions. (A first run of this probe reported no
  notifications at all because its handler was written `(method, params)`
  while the SDK passes one `{method, params}` object — the same mistake
  that stalled the sandbox probe; both were re-run with the right shape.)

- **Wire facts (msp.d.ts, 1.3.0)**: `session/list {workspaceRoot?, limit ≤ 200,
cursor?, updatedAfter?}` → `Session {sessionId, name?, firstUserPrompt?,
createdAt, lastActivityAt?, modelId, branch?, status (notLoaded | idle |
running), attention? (approvalPending | inputPending), forkedFrom, path}`
  ordered by activity; `session/resume {sessionId, history: auto | inline |
snapshot | anchored, cursor?, excludeItems?}` → `{session, history {mode,
items | null, snapshot | null, noneReason?}, pendingRequests, viewCursor}`
  (the served `mode` is authoritative; `snapshot.state.items` carries every
  item at its latest revision plus name, todo list, context usage, effective
  model, pending approvals / user inputs); `session/read` is the same
  envelope without subscribing; `view/page {sessionId, limit 1–1000, cursor?,
direction?}` pages the raw view events when history came back `none`;
  `session/fork {sessionId, cutPoint?: {lastTurnId}}` → the resume envelope
  for the **new** session with `forkedFrom`; `session/rename {name}` → the
  canonical name (or `session/nameChanged` later); the `sessionListStream`
  capability (granted, M5 probe) adds `session/listChanged` rows next to
  `session/started` / `session/closed`. The 1.3.0 schema has no archive or
  delete method; since 1.4.0-R4302.1, MSP has `session/delete` and
  `session/deleteCompleted`. The extension does not call them: archiving
  remains client-side. `Item` carries `turnId`, `commandId`,
  `displayText` and attachment metadata for `userMessage`, which is what a
  replayed transcript needs.
- **History dialog**: the header clock opens a History overlay above the
  composer (palette styling): a search box filtering on name and first
  prompt, rows grouped Today / Yesterday / Previous 7 days / Older by
  `lastActivityAt ?? createdAt`, each row showing the name (or the first
  prompt), the relative time and the branch, with hover actions Rename and
  Archive; `Enter` / click resumes; keyboard navigation as in the palette.
  Rows come from `session/list` for this workspace (paged to the cap) and
  stay live through `session/listChanged` / `session/started` /
  `session/closed`. Archived ids and the `museSpark.archiveInactiveSessions`
  days (default 14; 1 / 2 / 7 / 14 / never, as Claude Code) live in
  `workspaceState`; archived and stale rows are hidden, never deleted.
- **Resume**: `session/resume` with `history: 'inline'` preferred; the host
  posts one `historyLoaded {items, name, todos, context}` message and the
  reducer rebuilds the transcript from the item snapshots (user cards from
  `displayText ?? text` plus attachment metadata, the M4 rows for the rest)
  before live events continue from `viewCursor`; a `snapshot` answer feeds
  the same path from `snapshot.state`; `none` falls back to `view/page`
  forward from the start through the M4 notification mapper. Pending
  approvals / questions listed in `pendingRequests` are re-shown from the
  snapshot pointers. The resumed session's model, effort and approval mode
  seed the composer.
- **Persistence**: the last session id per surface kind is kept in
  `workspaceState`; a surface that opens within `SESSION_RESTORE_WINDOW_MS`
  (10 minutes, the Claude Code sidebar rule) of that session's last activity
  resumes it, otherwise it starts fresh and the dialog has it.
- **Titles**: `session/nameChanged` already drives the header; clicking the
  title edits it and sends `session/rename`, showing the canonical name the
  host settles on.
- **Fork ("Rewind")**: hovering a user card offers _Fork from here_:
  `session/fork` with `cutPoint.lastTurnId` = the turn before that message
  (the reducer maps `localId` → `turnId` from `turnAccepted` and keeps the
  wire `turnId` on replayed user items), then the surface switches to the new
  session from the fork's resume envelope. Claude Code's "Rewind code"
  (workspace checkpoints) has no MSP counterpart and is not offered; the
  M5 per-edit Revert is the closest tool.
- **Unread dot**: a turn that completes, or an approval / question that
  arrives, while the surface is hidden sets the view badge (`webviewView.badge`)
  or the tab's unread mark, cleared when the surface becomes visible.
- Already in place: new conversation (header button, `/clear`), `/compact`,
  independent sessions per editor tab.
- **Tests**: grouping, search and archive / restore policies (pure,
  deterministic clock); reducer replay of inline and snapshot history
  (M4 fixtures); fork cut-point mapping; rename round trip; badge policy;
  list-stream row folding. Live: `session/list` shape, `session/resume`
  served mode for a small session, `session/fork` envelope,
  `session/rename` normalisation, `session/listChanged` with the capability.

## M7 — Model API backend (bring-your-own key)

**Status 2026-09-22: complete.**

Status detail retained: complete against a fake server; live certification of
the Model API path pending the owner's go (each live turn is billed to the
owner's key). Certification record: `docs/certification/m7.md`.

- **Scope**: `ModelApiBackend` on `POST /v1/responses` streaming; tool harness
  (read, write, edit, glob, grep, shell) with a permission engine implementing
  the same five UI modes; diffs through the M5 path; `GET /v1/models` key
  validation; contributor opt-in dialog; backoff on 429; usage from response
  `usage`; token pre-count via `/responses/input_tokens`.
- **Tests**: SSE parser on recorded streams; tool argument validation; permission
  engine truth table; contract tests against a local fake server.
- **Security**: shell tool disabled in Manual mode until approved per call;
  workspace-root path confinement for file tools.
- **As built** (`src/core/agent/agentBackend.ts` is the internal protocol both
  hosts implement; `src/core/backends/modelapi/`):
  - `client.ts`: `GET /models`, `POST /responses/input_tokens`, streamed
    `POST /responses`; the documented retry policy (429 / 500 / 503 with
    exponential backoff, jitter and `Retry-After`, four retries before any
    body is read; 400 / 401 / 403 / 404 / 413 / 504 never retried); the key
    is read per request and never logged.
  - `schemas.ts`: the Responses shapes read (message / function_call /
    reasoning output items, usage, the stream event union with unknown types
    skipped, the error envelope, the model list).
  - `ModelApiHost.ts`: one session = a replayed conversation (`store: false`,
    `include: ["reasoning.encrypted_content"]`, `prompt_cache_key` = session
    id, `reasoning.summary: auto`, the UI effort mapped one-to-one and the
    Thinking-off `none` sent as `minimal` because `none` is a 400). Each
    turn streams reasoning summaries (`summary.N` deltas), text deltas and
    function calls into the same AgentEvents as MSP; function calls run
    through the permission engine and the tool harness, their results go
    back as `function_call_output` items, up to 50 rounds per turn; steering
    appends the input before the next model call; a second send queues;
    cancel aborts the fetch and any pending card; `compact` summarises with
    one model call and replays only the summary, then reports the new
    context size from `/responses/input_tokens`; `session/list`, resume and
    fork are served from the sessions this window holds (not persisted:
    the M8 polish list carries a JSON session store); no skills; rename is
    local.
  - `tools.ts`: `read_file`, `edit_file` (exactly one match), `write_file`,
    `search` (regex, glob, three output modes), `list_files`, the platform
    shell (`powershell` on Windows, `bash` elsewhere, one command line
    spawned as an argument array, timeout and output caps), `ask_user`
    (question cards) and `todo_write` (the task list). Paths are confined to
    the workspace root on both path styles. Edits leave a Muse-shaped patch
    document (Open diff / Revert of M5 work unchanged).
  - `permissions.ts`: `allowAll` runs everything; `onRequest` (Auto) runs
    reads and edits and asks for shell — there is no LLM judge here, so Auto
    is Edit-automatically with a prompt for commands; `promptUnmatched`
    (Manual) asks for edits and shell; `denyUnmatched` (Plan) refuses both.
    Cards offer Allow once / Always allow in this session / Reject with
    feedback; a session rule never overrides a refusal.
  - Host side: `ModelApiBackendManager` (real `fetch`, the stored key, the
    workspace file lister, `toolIo.ts` over node:fs and child_process),
    `backendSelection.ts` (see D1), the sign-in gate offering the paths the
    selection allows, the palette's Backend row, and the contributor guard
    (one modal yes per conversation; `confidentialWorkspace` hides the tier
    and refuses it) applied to both backends.
- **Live**: the no-key CLI check (`live-nokey.log`) is in m7.md. The Model
  API path was certified against the in-process fake server only; a live
  turn costs the owner's key and waits for their go.

## M8 — Account & usage, polish, packaging

**Status 2026-09-22: complete.** Certification record:
`docs/certification/m8.md`.

- **Scope**: Account & usage dialog (`usage/read` subscription bars or token
  totals), `/usage`, `/cost`; onboarding checklist; voice dictation (Q4);
  screen-reader announcements; `vsce package`, marketplace README, privacy
  policy (`docs/PRIVACY.md`), icon; CHANGELOG 0.1.0.
- **As built**:
  - `AgentHost.readUsage()` / `onUsageChanged()` on both hosts: the MSP host
    calls `usage/read` (`{ usage? }`, absent until the CLI has observed a
    frame) and folds `usage/changed` (host-level, like the list stream);
    the key backend answers "none". The controller answers `readUsage` with
    a `usageReport` (backend + window) and re-posts on every change, one
    subscription per host (`HostWatch`, shared with the list stream).
  - `src/shared/usage.ts`: the SDK's `SubscriptionUsage` shape as a zod
    schema, bar clamping (over-quota keeps the real percent in the label),
    reset countdowns, window length, and the plan label (Meta's tier field
    is an opaque numeric id live, so the dialog says "Muse Code
    subscription" unless the tier reads as a name).
  - `UsageDialog` hangs from the header like History (Esc / close button):
    Backend row, Plan, current block and weekly bars (`<progress>`, since the
    CSP forbids inline styles), "as of", this conversation's tokens and
    context, "Open dev.meta.ai". Opened from the Account & usage row,
    `/usage` and `/cost`. A Model API window explains pay-as-you-go billing
    instead of bars.
  - Onboarding: `ONBOARDING_TIPS` under the empty-state hint until
    `museSpark.hideOnboarding`; "Hide these tips" is a host action that
    writes the global setting, and the settings broadcast hides them live.
  - Screen readers: a visually hidden polite, atomic live region in `App`
    fed by `UiState.announcement` (text + sequence so repeats are read):
    finished / failed / stopped turns, approval requests with the tool
    label, questions, `sendFailed`, resumes, warning and error notices.
  - Packaging: `icon` (128×128 PNG rendered by `scripts/render-icon.mjs`, since 0.1.1 `scripts/render-images.mjs` (`npm run images`, which also renders the README banner and the social preview)
    from `media/marketplace-icon.svg`, in 0.1.0 a spark on a dark tile (dropped in 0.1.1, the sparkle being Google's mark: the icon is now a plain "M" on the tile and the banner and social image carry no logo) rather than
    Meta's mark), `homepage`, `bugs`, `vscode:prepublish` (production
    build), `.vscodeignore` reduced to the two bundles, the stylesheet, the
    icons, `package.json`, README, CHANGELOG, LICENSE and PRIVACY.
  - Voice dictation (Q4): **not shipped in M8** (superseded by M9 the same
    day). VS Code webviews run in Electron, where the Web Speech API's
    `SpeechRecognition` fails with a `network` error because Chromium's
    cloud recognizer is not wired up (electron/electron#46143,
    WebAudio/web-speech-api#80), and there is no extension API for
    dictation into a webview. M9 moves recognition out of the webview into
    a helper process on the OS recogniser.
  - Model API sessions lived for the window only at 0.1.0; the JSON session
    store came in 0.2.0 (M10, `src/host/backend/fileSessionStore.ts`).
- **Live** (`scratchpad/live-m8.log`, `docs/certification/m8.md`): with the
  CLI on the owner's subscription, `usage/read` returned nothing before the
  first turn, one "pong" turn (4 model attempts in the CLI's trace, login
  credential) was followed by `usage/changed` carrying `tier`, a 300-minute
  window and the weekly block, and `usage/read` then returned the same.

## M9 — Voice dictation on the operating system's recogniser

**Status 2026-09-22: built.**

Status detail retained: built; certified on Windows through the real
recogniser twice (a synthesised recording, then a real webcam microphone
hearing text-to-speech across the room, with text back), and on the
owner's Mac mini for the helper's permissions, engine, capture (levels
metered) and recognition lifecycle (three defects found and fixed there).
macOS recognised text arrived once the recognition mode was left to Apple
(forced on-device gives empty results on an Intel Mac without the model)
and the mini's speech daemons were restarted after Dictation was enabled.
Pending: a person speaking for the accuracy check on each platform.
Certification record: `docs/certification/m9.md`.

- **Goal**: Claude Code's microphone ("Tap or hold to record Ctrl+D")
  under the owner's constraints of 2026-09-22: no API cost (Meta's Voice
  Transcribe at $0.18/hour was rejected), no third-party packages or
  engines (sherpa-onnx and friends rejected), no "random system shortcuts"
  (driving Win+H / Apple Dictation from the button was rejected): the
  button itself must produce text.
- **Scope**: composer microphone with tap-to-toggle and hold-to-talk, Ctrl+D
  (Cmd+D) in the composer, Space/Enter on the focused button; recognised
  phrases inserted at the caret; "Listening…" / "Starting the microphone…"
  placeholders, a pulsing red mic, live-region announcements; the button
  dimmed with a reason where no recogniser exists; the PSScriptAnalyzer
  gate; the macOS helper build and the CI package job.
- **Design** (decided with the owner: Windows API, macOS Apple Speech
  helper, Linux disabled for now):
  - A resident helper process per conversation speaks one line protocol:
    `start` / `stop` / `quit` in on stdin; `ready` (language, recogniser),
    `listening`, `text`, `stopped`, `error` out as JSON lines. It stays
    warm for `DICTATION_IDLE_EXIT_MS` (5 min) after a recording so the
    next press listens in milliseconds (the engine takes about a second to
    load), then quits; `dispose` kills it.
  - **Windows**: `native/windows/dictate.ps1` under Windows PowerShell 5.1
    (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`,
    `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File`), on the
    .NET Framework's `System.Speech` (`SpeechRecognitionEngine` +
    `DictationGrammar`, `SetInputToDefaultAudioDevice`,
    `RecognizeAsync(Multiple)`; `RecognizeAsyncStop` on "stop" keeps the
    phrase in flight). The recogniser is picked for the display language,
    then the locale, then the first installed. Events are polled from the
    PowerShell event queue (no `-Action` blocks: those cannot run while the
    pipeline is blocked in a .NET read), and stdin is read through
    `Stream.ReadAsync` so the loop never blocks. `-InputWav <file>` replays
    a recording instead of the microphone, for the certification run and
    for the user's own diagnosis.
  - **macOS**: `native/darwin/Dictation.swift` on `SFSpeechRecognizer` +
    `AVAudioEngine`; Apple chooses on-device recognition where its model is
    installed and its servers otherwise (no charge). Not forced on-device:
    on the owner's Intel Mac mini `supportsOnDeviceRecognition` is true
    while the on-device model is absent (asset purged), and a forced
    on-device request ends in an empty final result with no error;
    `--on-device` exists for whoever wants the refusal instead.
    Built by `native/darwin/build.sh` (universal binary, `Info.plist` with
    the two usage descriptions embedded in `__info_plist`, ad-hoc signed)
    in CI's `native-darwin` job; the `package` job ships it in the
    `.vsix`. A package built elsewhere lacks the binary and the panel says
    so. The binary is git-ignored. Found on the owner's Mac mini
    (2026-09-22, macOS 15.7.4, no microphone attached): AVFAudio reports
    some failures as Objective-C exceptions that Swift cannot catch, so the
    helper checks CoreAudio's default input device and the hardware input
    format before touching the engine (a Mac with no input device gets an
    error line, not a crash); the tap uses the hardware input format,
    since the input node's cached output format (44.1 kHz) no longer
    matches the device after a device change (48 kHz) and the mismatch is
    a fatal assertion; each start step writes a marker to stderr so an
    unexpected exit names the step; `--input-device <UID>` pins the capture
    device (the rig's Teams loopback driver cannot be a default input:
    `kAudioDevicePropertyDeviceCanBeDefaultDevice` is 0, and an aggregate
    over it inherits that); and Apple refuses recognition with "Siri and
    Dictation are disabled" until Dictation or Siri is on in System
    Settings, which the helper passes through verbatim.
  - **Linux**: `locateDictationHelper` answers "unavailable" with the
    reason; the button is dimmed with that as its title (not `disabled`,
    so the tooltip still shows).
  - **Host**: `Dictation` (`src/core/voice/dictation.ts`) is the pure
    driver over an injected spawn (`HelperChild`), with the stop grace
    (`DICTATION_STOP_GRACE_MS`, the helper is restarted if "stopped" never
    comes), the idle exit and the unexpected-exit report (last stderr
    line). `dictationHost.ts` adapts `child_process.spawn` (§8 row). The
    controller creates one driver on the first press, posts
    `dictationState` on `surfaceReady` and on every status change, inserts
    each phrase as `insertText` with a trailing space, and reports helper
    errors as a notice. The words never reach the log (character count
    only).
  - **Webview**: `dictationGesture.ts` holds the press/release maths
    (`DICTATION_HOLD_MS` = 300: shorter is a tap that toggles, longer is
    push-to-talk that stops on release); the composer applies it to
    pointer, Ctrl+D (with key repeat ignored and the modifier's release
    counting) and Space/Enter, listening for `pointerup` on the window so
    a hold released off the button still stops. The press is
    default-prevented so the caret stays in the textarea.
- **Acceptance**: the sandbox replay of a synthesised WAV through the real
  Windows recogniser yields `ready` in under a second, `listening`, a
  `text` line and `stopped`, exit 0 (done: 827 ms, "Although settings file
  in fix the bug" for "open the settings file and fix the bug", confidence
  0.46, the classic engine's accuracy as warned to the owner); the owner
  speaks into the dev host and the words land in the composer (done the same
  evening with a real microphone, §10); the macOS helper compiles in CI
  and, on a Mac, prompts for the microphone and speech recognition once
  and then transcribes (done on the Mac mini that evening with a real
  microphone, text back; m9.md).
- **Gates added**: `lint:ps` (PSScriptAnalyzer, `PSGallery` settings,
  exit = finding count; real on Windows, a reported skip elsewhere;
  installed on the CI Windows runner in a step).
- **Security**: the helper command line is fixed (§8 row); the script runs
  with `-ExecutionPolicy Bypass` scoped to its own process, as the VS Code
  PowerShell extension does; nothing about the audio or the text leaves
  the machine on Windows; on macOS Apple may process audio on its servers
  when on-device recognition is unavailable (`docs/PRIVACY.md`); the
  helper never sees the workspace, a credential or the model.

## M10 — Workspace context: rules, skills and memory on both backends

**Status 2026-09-22: built.**

Status detail retained: built and certified (`docs/certification/m10.md`):
the CLI path proved live before and after the trust flag (rule ignored,
skill `skillNotFound` → rule followed, skill ran), the Model API path
against the fake server, seven checks fired on purpose.

- **Goal**: what D13 decided. On the CLI backend, the workspace's rules and
  project skills are loaded whenever VS Code trusts the workspace (they
  never were). On the Model API backend, the model sees the same rules
  files, skills and project memory index that Muse Code would give it, by
  the same file conventions, and nothing else.
- **Scope**:
  - `serveArguments(posture, trust)`: `--trust-workspace` when trusted,
    `--disable-shell` when not; the host is restarted when trust is
    granted (`onDidGrantWorkspaceTrust`), with a notice.
  - `src/core/context/` (pure, no `vscode`, no `fs`; everything through
    `ToolIo`, which gains `listDirectory(absolutePath)` for the skill
    roots): `rules.ts` (root file, `CLAUDE.md` fallback per directory,
    nested files by first touch, `RULES_FILE_MAX_BYTES` per file and
    `RULES_CONTEXT_MAX_BYTES` overall with the two warnings Muse prints),
    `skills.ts` (front matter parse and validation, project root then the
    personal Muse root, project shadows personal on a duplicate id,
    `user-invocable: false` hides a skill from the palette but not from
    `read_skill`, `SKILL_FILE_MAX_BYTES`), `memory.ts` (the index with
    `MEMORY_INDEX_MAX_LINES` / `MEMORY_INDEX_MAX_BYTES`), and
    `instructions.ts` composing the system instructions: base text, the
    rules preamble (Muse's sentence) and files, the skills catalogue with
    the `read_skill` instruction, the memory index and the convention for
    writing notes with the file tools.
  - `ModelApiHost`: a `WorkspaceContext` per session, refreshed before each
    model call for newly touched directories; `read_skill` (class `read`,
    never prompts); a `skill` part expanded to the skill body plus the
    arguments (the transcript shows the typed `/name arguments`);
    `listSkills` from the catalogue; `refreshSkills()` on the host emits
    `skillsChanged` (the extension watches `.agents/skills/**` and the
    personal root); in Restricted Mode the tool definitions omit the shell
    and `executeTool` refuses it.
  - Manifest `capabilities` (D13) and the `extensionKind` of D14 (they are
    one edit).
  - README backend table and a "Rules, skills and memory" section;
    `docs/PRIVACY.md` (on the Model API path the rules, the skill bodies
    the model loads and the memory index travel to Meta with the prompt);
    CHANGELOG.
- **Acceptance**:
  - Live, CLI backend, workspace `C:\muse-live-ws` with an `AGENTS.md`
    rule ("end every reply with PINEAPPLE") and `.agents/skills/shout`:
    before the change the extension's own backend code lists no `shout`
    skill and the reply ignores the rule; after it, `skill/list` carries
    `shout` (source `project`), the reply ends with PINEAPPLE and a
    `skill` part `shout good morning` returns `GOOD MORNING!!!`. Two short
    turns each run, attempts counted from the CLI trace logs.
  - Model API backend against the fake server: the request body's
    `instructions` carries the root rules file, the catalogue and the
    memory index; a `read_file` of `src/a.ts` makes the next request carry
    `src/AGENTS.md` after the root one; a `read_skill` call returns the
    body without an approval card; a `skill` part sends the expanded text;
    an oversize rules file is skipped with the warning in the log; in Restricted Mode no rules, no skills, no memory
    and no shell tool are sent.
- **Tests**: `rules.test.ts`, `skills.test.ts`, `memory.test.ts`,
  `instructions.test.ts` (new), `sandbox.test.ts` (trust arguments),
  `modelApiHost.test.ts` (the acceptance list above), `fakeToolIo`
  (`listDirectory`), `modelApiTools.test.ts` (`read_skill` argument
  validation and the shell refusal).
- **Gates**: the existing set; `npm run quality` green; every new test
  broken once on purpose (certification record).
- **Security**: rules and skill files are workspace content and may carry
  prompt injection; they already reach the model on the CLI backend by
  Muse Code's design, and on the Model API backend only in a trusted
  workspace, under the same permission modes as before. Files are read
  with the size caps and never executed. `read_skill` resolves only ids
  from the catalogue (no paths from the model). The personal root is read,
  never written.

## M11 — Production hardening (D14)

**Status 2026-09-22: built.**

Status detail retained: built and certified (`docs/certification/m11.md`);
the release workflow is proved by the 0.2.0 tag itself (§10).

- **Goal**: the D14 table, every row either done or deferred with a reason.
- **Scope**: the webview error boundary and `hostAction: reload`; the Model
  API JSON session store (`src/host/backend/sessionStore.ts` behind a
  `SessionStore` interface in `ModelApiHostDeps`; one file per session
  under `context.storageUri`, written after each turn and on rename or
  archive, read at host start; a corrupt file is skipped with a log line,
  never fatal); `Muse Spark: Show Logs` and `Muse Spark: Diagnostics`;
  `.github/workflows/build.yml` (`workflow_call`: quality matrix, macOS
  helper, package) used by `ci.yml` and the new `release.yml` (tag `v*`:
  build, GitHub Release with the `.vsix` and the CHANGELOG section,
  Marketplace publish when `VSCE_PAT` is set); `SECURITY.md`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `.github/ISSUE_TEMPLATE/`,
  `PULL_REQUEST_TEMPLATE.md`, `dependabot.yml`, `CODEOWNERS`; README and
  CHANGELOG; version 0.2.0.
- **Acceptance**: a thrown render error in the harness shows the boundary
  with the message and Reload restores the panel; a Model API conversation
  survives `Developer: Reload Window` with its transcript, patches and
  name, and appears in history; the Diagnostics output contains no secret
  (the logger's redaction test covers the key shape, and the command writes
  booleans for credentials); `release.yml` runs green on the `v0.2.0` tag
  and the GitHub Release carries the `.vsix`.
- **Tests**: `ErrorBoundary.test.tsx`, `sessionStore.test.ts` (round trip,
  corrupt file, missing directory), `modelApiHost.test.ts` (store calls),
  `diagnostics.test.ts` (the report's shape and redaction).
- **Gates**: unchanged; the workflows are validated by running them.
- **Security**: the session store holds conversation text and patches in
  the workspace storage directory VS Code already uses for extension state
  (per user, per workspace, outside the repository); the API key is never
  in it. `SECURITY.md` names the reporting path.

## M12 — Harness parity (D15)

**Status 2026-09-22: built.**

Status detail retained: built and certified (`docs/certification/m12.md`);
version 0.3.0.

- **Goal**: the D15 table, every "M12" row built and certified; version
  0.3.0.
- **Scope**: `package.json` (setting scopes, `activationEvents`, the
  walkthrough, five commands, the keybinding `when` clauses, the
  `enableNewConversationShortcut` setting); `resources/walkthrough/`
  (four Markdown steps and their images, packaged); the panel serializer
  (`chatPanel.ts` `restoreChatPanel`, the webview's `setState` with the
  session id, `ConversationController.restoreSession`); the commands in
  `src/host/commands/` (`createRulesFile.ts`, `openInTerminal.ts`) with
  the template in `src/core/context/rulesTemplate.ts`; the Model API
  prompt's environment and working-rules sections (`instructions.ts`, the
  host's `describeEnvironment` dependency); the `museSpark.signedIn`
  context key; README, CHANGELOG, this file.
- **Acceptance**: a repository's `.vscode/settings.json` cannot set the six
  machine-scoped settings (VS Code ignores them and says so in the Settings
  editor); an editor-tab conversation comes back on its session after
  Developer: Reload Window; the walkthrough opens from the command and
  from the Welcome page and its images render; New Conversation clears the
  active surface (or opens one), Sign Out signs out, Open in Terminal starts
  the `muse` TUI in the workspace root (or explains the missing CLI),
  Create AGENTS.md produces the `muse init` file and opens it; the Model
  API request carries the date, the git facts and the working rules.
- **Tests**: `manifest.test.ts` (scopes, activation, walkthrough files,
  keybinding clauses), `walkthrough.test.ts` (every image a step
  references exists and is packaged), `chatPanel.test.ts` (restore with a
  stored session id, with none, with garbage state),
  `conversationController.test.ts` (`restoreSession`: resumes, ignores
  when a session is live or signed out), `App.test.tsx` (the state the
  webview stores follows the session id), `createRulesFile.test.ts`,
  `openInTerminal.test.ts`, `rulesTemplate.test.ts`, `instructions.test.ts`
  and `modelApiHost.test.ts` (environment section, once per session, a
  failing describer), `settings.test.ts`.
- **Gates**: unchanged.
- **Security**: the six machine-scoped settings are the ones that choose
  what executes, what is billed and how much is approved; the walkthrough
  and the template contain no user data; `muse init` runs only in a
  trusted workspace and never with the pasted key; the environment section
  carries git metadata only (branch, counts, subjects), never file
  contents.

## M13 — Verification fixes, process-level e2e, the rewind menu (D16)

**Status 2026-09-22: built.**

Status detail retained: built and certified (`docs/certification/m13.md`);
version 0.3.1.

- **Goal**: every D16 row marked "M13".
- **Scope**: `test/e2e/` (the fake CLI `fake-muse/serve.mjs` and its
  Windows stub `fake-muse/stub.cs`, the installer `fakeMuse.ts`, the
  process-level suite `museCode.e2e.test.ts`, the opt-in live drill
  `live.e2e.test.ts`, its own `tsconfig.json`); vitest and knip
  configuration; the coverage tests (`toolIo`, `MentionMenu`,
  `StatusLine`, `EffortSlider`); `permissionModes.ts`; `AuthPort` and
  `DictationHandle`; the deletion of `scripts/measure-markdown.mjs`; the
  user card's fork/rewind menu (`Transcript.tsx`, `editsAfter` in
  `uiState.ts`, the `rewindCode` message and the controller's handler);
  README, CHANGELOG, this file.
- **Acceptance**: the e2e suite passes on Windows (compiled stub), macOS and
  Linux (shebang script) in CI without a Muse account; the live drill
  passes on the owner's machine within the attempt budget and the number
  is recorded; the menu forks, rewinds and does both; the lint, coverage
  and dead-code gates stay green with the manager no longer excluded from
  coverage.
- **Security**: the fake CLI runs only under the test runner's own Node,
  from a temporary directory, with the environment the test passes; the
  live drill uses the owner's CLI sign-in exactly as the panel does and
  never the pasted key; a rewind goes through the same review path as a
  single revert (a file changed since is reported, never overwritten).

## M14 — Subagents, the Agent map, the Account & Usage modal, choices as pickers, the banner, the compact button (D17)

**Status 2026-09-22: built.**

Status detail retained: built and certified (`docs/certification/m14.md`);
version 0.4.0.

- **Goal**: every D17 row.
- **Scope**: the wire schema (`subagent` fields, background flags), the
  `childTranscript` and `readChildSession` messages, `AgentHost.readSession`,
  `AccountFacts` and `UsageInsights` on `usageReport`, the
  `openMuseSettings` host action; `src/core/usage/insights.ts` (trace-log
  parsing, attribution, the cost estimate), `src/host/usage/traceLogs.ts`
  (reader with a TTL), `src/host/backend/museSettings.ts` (delegation
  mode, read only); the webview: `Modal`, `AgentMap`, the rebuilt
  `UsageDialog`, the agents pill in the header, subagent rows and the
  background badge, the composer banner and the compact button, `/agents`;
  the controller (the choice-steering note, the account facts and insights
  on the usage report, the child-session read); the fake CLI's `subagents`
  and `background:` scenarios; README, CHANGELOG, this file.
- **Acceptance**: the fake-CLI e2e drives two subagents to completion
  with readable child sessions and a backgrounded call; the unit gate
  covers the parser against the line shapes of the 2026-09-22 drill log;
  the modal and the map are Testing-Library-tested; the live subagent run
  came in D21/M18 (delegation switched on through a temporary config, the
  spawns allowed, two children reporting).
- **Security**: the settings file and the trace logs are read, never
  written; the insights carry counts and timestamps only; the steering
  note is fixed text; a child transcript is read through the same host
  command as History.

## M15 — The first F5 round: model warm-up, transcript scrolling, chevrons, response copy, outputs in the editor (D18)

**Status 2026-09-22: built.**

Status detail retained: built and certified (`docs/certification/m15.md`);
version 0.4.1.

- **Goal**: every D18 row that changed code.
- **Scope**: the controller (`warmModels`, the single in-flight model
  listing, `openOutput` over the paged store, the decision warning), the
  `openOutput` message and the `openDocument` dependency, the extension's
  `muse-output` content provider; the webview: the transcript scroll
  state and the jump button in `App`, `ExpandChevron` on tool and
  reasoning rows, the response Copy with the shared `useCopiedFlag`, the
  clickable output blocks and the clipped diff with "Click to expand" in
  `ToolRow`; styles; README, CHANGELOG, this file.
- **Acceptance**: the unit gate covers each row (proofs A–H in the
  record); the owner's F5 re-check of each report.
- **Security**: output documents are read-only virtual documents holding
  text the transcript already showed or the CLI's stored output; the
  provider keeps the last twenty; nothing is written to disk.

## M16 — The second F5 round: the pill's model, thinking rows, file links, Click to expand everywhere, the last usage window (D19)

**Status 2026-09-22: built.**

Status detail retained: built and certified (`docs/certification/m16.md`);
version 0.4.2.

- **Goal**: every D19 row that changed code.
- **Scope**: the controller (`sessionInfo` from the warm-up, the
  `openFile` message and dependency, the `usageCache` dependency in
  `postUsage`), the `openFile` message and `LineRange` (`revertEdit`
  removed), the extension's `openFile` (select and reveal) and the
  `museSpark.lastUsage` global-state cache; the webview: `ReasoningRow`
  (live summary, plain line after), `ToolRow` (header as toggle + path
  link + chevron, shell and edit rows open from the start, the stored
  patch fetched once, "Click to expand" on every stored-patch diff, no
  review buttons, `changedRange` from the diff rows), `QuestionCard`
  rebuilt (tabs, stacked native inputs, Other, Submit/Cancel) with
  `cancelQuestions` on both hosts and the `cancelQuestion` message, styles;
  README, CHANGELOG, this file.
- **Acceptance**: the unit gate covers each row (proofs in the record);
  the owner's F5 re-check.
- **Security**: `openFile` opens only the path the CLI reported for the
  tool call, resolved against the workspace when relative; the usage
  cache holds percentages and timestamps only.

## M17 — Reply to an output, ask about or comment on highlighted chat text (D20)

**Status 2026-09-22: built.**

Status detail retained: built and certified (`docs/certification/m17.md`);
version 0.4.3.

- **Goal**: every D20 row.
- **Scope**: `ChatReference` on `sendMessage` (`protocol.ts`),
  `src/core/chatReference.ts` (the tagged part), the controller's `send`
  (the part before the editor context); the webview: `reference` in the
  state with `referenceSet` / `referenceCleared` and `referenceLabel`,
  the composer chip, the reply actions menu on `AssistantRow`,
  `QuoteMenu` rendered by the row that owns the selection, the
  right-click handler on the transcript, the user card's reference chip,
  `data-entry-id` / `data-role` on rows; styles; README, CHANGELOG, this
  file.
- **Acceptance**: the unit gate covers the part text, the reducer, the
  menus, the right-click flow and the wire (proofs in the record); the
  owner's F5 check.
- **Security**: the payload is text the transcript already shows, clipped;
  nothing outside the conversation is read.

## M18 — The verification round (D21)

**Status 2026-09-23: built.**

Status detail retained: built and certified (`docs/certification/m18.md`);
version 0.5.0.

- **Goal**: every D21 row.
- **Scope**: 16 harness scenarios (`test/harness/index.html`,
  `scripts/harness-shots.mjs`), the usage modal's no-logs text, the
  subagent tool labels and the approval card's wording for a tool subject,
  the live drill's budget and comment; the child-item routing in the
  reducer (`childOwnerOf`, `applyChildItem`), `resultText`, the map's
  `controlsFor` and controls, `controlSubagent` / `messageSubagent` on both
  hosts, the two messages, the fake CLI's `subagent/*` handlers, the
  classifier's child marker; README, CHANGELOG, this file.
- **Acceptance**: every scenario rendered and viewed; the live drills'
  facts recorded; the gate green.
- **Security**: the live drills' temporary config copy is deleted on every
  exit path and never echoed; the harness runs against a fake host only.

## M19 — Issue #4: the prompt box auto-grows (D22)

**Status 2026-09-23: built.**

Status detail retained: built and certified (`docs/certification/m19.md`);
merged through pull request #5 from `fix/composer-autogrow`, shipped in
0.5.2.

- **Goal**: the D22 rows.
- **Scope**: `rowsFor(draft, metrics)` and `fitRows` with their layout and
  resize effects in `src/webview/components/Composer.tsx` (the `rows`
  attribute is set on the element, not through a prop, so no state changes
  in an effect); two tests in `test/unit/Composer.test.tsx` (the measured
  growth, shrink and cap with stubbed heights; the pure row count); the
  `composer-grow` and `composer-max` harness scenarios; CHANGELOG, this
  file.
- **Acceptance**: the measured test fails when the measurement is ignored
  (the pre-fix behaviour); both scenarios rendered and viewed; the gate
  green; the pull request's CI green before the merge.
- **Security**: none new; the box reads its own metrics only.

## M20 — Rewind across subagents (D23)

**Status 2026-09-23: built.**

Status detail retained: built and certified (`docs/certification/m20.md`);
shipped in 0.5.5.

- **Goal**: the D23 rows.
- **Scope**: `sequence` on the state, `seq` on user cards, `completedSeq` on
  tool rows, `stampCompletion`, `replayHistory` returning its counter,
  `editsAfter(state, id)` over the conversation and the child transcripts
  (`src/webview/state/uiState.ts`); the call in `App.tsx`; two reducer
  tests (interleaved parent and child edits unwound by completion, the
  stamp kept across snapshots); README, CHANGELOG, this file.
- **Acceptance**: the interleaving test fails when the child transcripts
  are left out (the pre-fix behaviour) and when the stamp is never applied;
  the gate green.
- **Security**: none new; the host still confines every reverted path to
  the workspace and matches every hunk before touching a file.

## M21 — The audit: security and confinement (D24)

**Status 2026-09-23: built.**

Status detail retained: built and certified (`docs/certification/m21.md`);
merged through pull request #6 from `hardening/m21-security`, shipped in
0.6.0.

- **Goal**: every section-A row of the audit (D24) except the release
  workflow's secret scope, which M26 owns.
- **Scope**: `src/core/executables.ts`, `src/host/canonicalPath.ts`,
  `src/host/git.ts` (new); `confineWorkspacePath`, the Windows segment
  checks and `ToolIo.realPath` (`tools.ts`, `toolIo.ts`, `searchWorker.ts`,
  `EditReview`); `compileGlob` (`glob.ts`, rewritten); `isProtectedPath`,
  per-command session rules and `isKnownChoice` (`permissions.ts`,
  `ModelApiHost.ts`); the trust gate on git (`environment.ts`,
  `workspaceFiles.ts`); absolute-path resolution (`launch.ts`,
  `toolIo.ts`); `shellEnvironment` and `setEnvironmentVariable`; the
  controller's Edit-automatically answer, `revokeBypass`, the remote-window
  Bypass confirmation and the contributor check on resume
  (`conversationController.ts`, `extension.ts`); `permissionModeDetail`;
  redaction, the report's `~`, the stderr cap; the manifest's trust text;
  README, SECURITY.md, docs/PRIVACY.md (the environment facts, previously
  undocumented), CHANGELOG, this file.
- **Acceptance**: a test per row, each fired against the unfixed code or a
  deliberate break (`docs/certification/m21.md`); the pathological glob
  under a second; a real junction refused by the search worker and by
  `canonicalPath`; the gate green; the pull request's CI green on all three
  platforms before the merge.
- **Security**: this milestone is the security work; §9 updated.

## M22 — The audit: processes and lifecycle (D25)

**Status 2026-09-23: built.**

Status detail retained: built and certified (`docs/certification/m22.md`);
merged through pull request #9 from `hardening/m22-lifecycle`, shipped in
0.6.0.

- **Goal**: the D25 rows.
- **Scope**: `src/host/processTree.ts`, `src/core/timeouts.ts` (new);
  `runCommand` and `BoundedText` (`toolIo.ts`); `HostExit`,
  `SessionNotLoadedError` (`agentBackend.ts`); deadlines, `describeExit`,
  the guarded handler, reference-counted handles (`MuseCodeHost.ts`,
  `ModelApiHost.ts`); the managers' generations, the handshake deadline,
  the launch cache, the proxy, the CLI's environment
  (`museCodeBackendManager.ts`, `modelApiBackendManager.ts`); the
  controller's `backendStopping`, `hostExited`, `resumeAfterRestart`,
  `submitResuming`, shared start and disposal guards; sign-in by
  modification time and one terminal (`browserSignIn.ts`,
  `authService.ts`); `CredentialStore`; the IDE tool server; the client's
  retries; `deactivate`, the login shell, the terminal environment
  (`extension.ts`); the exe scan (`launch.ts`); the fake CLI's `silent`
  mode; README, CHANGELOG, this file.
- **Acceptance**: a test per row, 22 breaks fired
  (`docs/certification/m22.md`), real processes for the tree kill and the
  background child, the handshake deadline against the fake CLI; the gate
  green; the pull request's CI green on all three platforms.
- **Security**: none new; no process is signalled after it has exited.

## M23 — The audit: protocol and backend semantics (D26)

**Status 2026-09-23: built.**

Status detail retained: built and certified (`docs/certification/m23.md`);
merged through pull request #10 from `hardening/m23-protocol`, shipped in
0.6.0.

- **Goal**: the D26 rows.
- **Scope**: `promptLedger.ts` (new); the receipts, early events, handshake
  facts, `sendCommand`, size check, `listPending` pull, settled errors and
  base64 pages (`MuseCodeHost.ts`); the new methods and `cumulative` usage
  (`mapNotification.ts`); `activeTurnId` and `pendingRequests`
  (`sessionRecords.ts`); `PromptSettledError`, `canEditSessions`,
  `LoadedSession.activeTurnId` (`agentBackend.ts`); the Model API's tool
  outputs, steering, compaction, character pages, headers and lazy loads
  (`ModelApiHost.ts`, `sessionStore.ts`); retention, leftovers and rename
  retries (`fileSessionStore.ts`, `museSpark.cleanupPeriodDays`); SSE
  (`sse.ts`, `client.ts`); refusals (`schemas.ts`); `write_file` folders
  (`toolIo.ts`); the controller's gap reload, notices, running-turn
  bookkeeping, rename/fork gate and kept images; `AttachmentStore.partsFor`
  / `release`; `approvalReopened`, `promptDropped` and
  `sessionInfo.canEditSessions` (`protocol.ts`, `uiState.ts`), the
  rewind-only menu (`Transcript.tsx`) and the cached rows
  (`UsageDialog.tsx`); the fake CLI's live usage shape; README, CHANGELOG,
  this file.
- **Acceptance**: a test per row, each fired against a deliberate break
  (`docs/certification/m23.md`, 38 breaks); the gate green; the pull
  request's CI green on all three platforms.
- **Security**: a protocol error is logged by kind, never with the frame's
  content; the retention deletes only sessions whose age is known; no new
  dependency.

## M24 — The audit: editing correctness (D27)

**Status 2026-09-23: built.**

Status detail retained: built and certified (`docs/certification/m24.md`,
the context rows in `docs/certification/m24-context.md`); merged through
pull request #11 from `hardening/m24-editing`, shipped in 0.6.0.

- **Goal**: the D27 rows.
- **Scope**: the Model API's hunks, text shapes, fingerprints, unsaved-file
  refusals, shell clipping and search limits (`tools.ts`, the prompt line in
  `instructions.ts`); `revertHunks`' created rule (`patchApply.ts`) and the
  `created` flag (`patchDocument.ts`); Edit Review's BOM and folder rules
  (`editReview.ts`, `readTextFile` in `extension.ts`); strict decoding,
  atomic writes, the PowerShell preamble and streamed search hits
  (`toolIo.ts`, `searchWorker.ts`, `fsAtomic.ts`, the session store); the
  controller's unsaved-files notice; `isSamePath`; the context rows:
  `ContextIo` and `decodeContextText` (`contextFiles.ts`, host side
  `contextIo.ts`) under the rules, skills and memory loaders, the
  diagnostics tool, `formatMention` (`src/shared/mentions.ts`) and the
  composer's mention reader, `rootRelativePath` / `resolveAgainstRoot` /
  `hostSideUri` (`workspaceRoot.ts`) and their callers in `extension.ts`
  and the controller; README, CHANGELOG, this file.
- **Acceptance**: a test per row, each fired against a deliberate break
  (`docs/certification/m24.md`); the gate green; the pull request's CI
  green on all three platforms.
- **Security**: no file is rewritten from a lossy decode; no write happens
  under an editor's unsaved changes or over a file the model has not seen;
  no rules, memory or project-skill file reaches the model through a link
  out of the workspace; no new dependency.

## M25 — The audit: webview and UI state (D28)

**Status 2026-09-23: built.**

Status detail retained: built and certified (`docs/certification/m25.md`);
merged through pull request #8 from `hardening/m25-webview`, shipped in
0.6.0.

- **Goal**: every section-E row of the audit (D28).
- **Scope**: `src/webview/state/store.ts`, `snapshot.ts`,
  `transcriptEntries.ts`, `src/webview/links.ts`, `src/webview/useDismiss.ts`
  (new); the reducer (`uiState.ts`), `App.tsx`, `main.tsx`; the rows and
  components (Transcript, ToolRow, ReasoningRow, CodeBlock, MarkdownView,
  QuestionCard, ApprovalCard, QuoteMenu, Modal, HistoryDialog, Composer,
  StatusLine, TodoPanel, Header, AgentMap); `streamSplit.ts`, `diff.ts`,
  `styles.css`; `webviewSetup.ts`, `chatPanel.ts`, `ChatViewProvider.ts`;
  `ConversationController.clear()` and `surfaceReady()` only; the
  `surfaceFocused`, `conversationCleared` and `surfaceState` messages and
  `sendFailed.attachmentsKept`; the M25 constants; six harness scenarios;
  README, CHANGELOG, this file.
- **Acceptance**: a test per row, each fired against a deliberate break
  (40 proofs); every harness scenario rendered and the new and changed ones
  viewed; the gate green; the pull request's CI green on all three
  platforms before the merge.
- **Security**: the saved webview state is untrusted input (zod, versioned)
  and restored only when the host confirms its session is live; relative
  links are confined to the workspace in the webview, every other href
  still passes react-markdown's filter and the host's scheme allow-list; no
  new dependency.

## M26 — The audit: packaging, CI, platform and voice (D29)

**Release-build reuse request (RELFAST, 2026-10-04).** The owner asked why a
release repeats roughly 50 minutes of gates after its release PR already passed.
Reuse only this repository's successful PR/merge-group/main-push CI run whose package job
recorded the exact tag tree, including the PR merge checkout. Record CI asset
SHA-256 hashes, retain packages/SBOMs/receipt for 30 days, verify tree and package
versions before staging unchanged bytes for the existing publishers. Any lookup,
download or verification miss falls back to the full shared build, with a job
summary; `RELEASE_FORCE_REBUILD=true` forces that path. Scope: build/release
workflows, one release-only lookup/receipt script, owning release tests and docs.
Acceptance: exact-tree success, fork/event/workflow/status refusal, version/hash
refusal and rebuild wiring proved by tests and byte-exact guard drills. No new
dependencies, publication or gate relaxation. Lane checks follow RELFAST/common;
aggregate quality and hosted reuse/fallback remain the lead's gates. Evidence:
`docs/certification/relfast.md`. Design is in `docs/RELEASING.md` before code.

**RELFAST2 completion (2026-10-04).** Merge PR #107's manual
`artifacts_run_id` recovery into the same lookup/download/verification/staging
path. Automatic reuse requires the tag's exact recorded checkout tree; merge
queue commits qualify by that tree, never by their temporary branch or head SHA.
Manual recovery pins an earlier own-repository Release run on the same version
tag with all seven build jobs successful. Its original source commit/tree may
precede a recovery-only workflow/changelog fix: preserve those original package
bytes. Validate the source run, nonexpired artifact inventory and both manifests;
use its recorded hashes when present. Pre-receipt Release runs remain recoverable
with the pinned download action's artifact integrity check and manifest/inventory
verification, without claiming an older CI hash receipt. Recovery failures stop;
they never rebuild an already-published version. Publishers download only the
verified bytes staged in the current run. Every release job condition respects
cancellation, including skipped-build handling. Finish the 19 pending guard
drills and drill these new recovery/merge-queue/cancellation guards byte-exact.
Lane checks follow RELFAST2 and common.md; full quality and hosted receipts
remain lead-owned. No push, tag or workflow run.

**RELFAST3 completion (2026-10-04).** Preserve the staged RELFAST2 work with
enabled commit hooks and merge `origin/main` at `1e93c67c`, keeping every released
CHANGELOG section. The owner reports that release run `37225339230` could create
`v0` but its update failed with HTTP 422 under the release-tags ruleset
`23893754` (admin bypass only). Keep that ruleset unchanged. A failed major-tag
step retains its failure outcome and reports an admin move without failing the
already-published channels' summary. Keep all-channel admission, cancellation,
ancestor and divergent-history guards; request only a fast-forward update.
Document the owner's admin PATCH command in `docs/RELEASING.md`. Acceptance:
execute the actual workflow shell with synthetic Git/API responses, prove
failure reporting and successful/no-op/divergent paths, drill each new guard
with byte-exact restoration, and run the owning workflow tests and lane checks.
Hosted reuse/fallback, CIFLOW integration and the actual admin tag move remain
lead-owned; no network publication or ruleset mutation is authorized here.

**Release-artifact follow-up (REL, 2026-10-02; implemented and lane-verified).**
Scope: checksums and pinned provenance for the VSIX and ACP package; accurate
CycloneDX ingredient lists from the shipped bundle inputs and the ACP native
dependency; retry only transient registry failures (three attempts, 20/60-second
backoff); accept an existing version only after its downloaded hash or npm
integrity matches; aggregate every channel's outcome and make GitHub Release
reruns safe. Add a measured VSIX size gate, check every packaged ACP locale,
trace the Windows launcher's actual runtime use, document signing/auth/recovery,
and prepare inert M80 schema/major-tag hooks. No publication, version/tag change,
M80 implementation or budget relaxation in this lane. Acceptance: owning script
tests and deliberate guard removals on Kubuntu, actionlint and shellcheck there,
the lane's scoped local checks and production build/package measurement.
`docs/certification/rel-artifacts.md` binds results: 60 owning tests, 20
byte-exact guard-removal controls, actual corrupted-tar/checksum exercises,
workflow lint, scoped local checks and a universal package. The lead owns
aggregate quality and hosted release verification. Existing build, package,
esbuild metafiles, tag/environment policy and release ledger are reused.

**Status 2026-09-23: built.**

Status detail retained: built and certified (`docs/certification/m26.md`);
merged through pull request #7 from `hardening/m26-platform`, shipped in
0.6.0.

- **Goal**: the D29 rows.
- **Scope**: the workflows, `.vscode-test.mjs`, the new scripts, the
  notices, the macOS helper files, the voice code, the manifest's
  keys/menus/categories, the walkthrough, and their tests.
- **Acceptance**: the gate green; integration tests on both versions; the
  Mac build checks its embedded version; the live Windows dictation check;
  25 test-fire proofs (A–Y); the PR's CI green.
- **Security**: the PAT is confined to one step; tags must be on `main`; no
  tokens persisted; the audit has no silent bypass; no new dependencies; no
  signing credentials created.

## M27 — The tree kill's orphans (D25)

**DEFLAKE2 follow-up (2026-10-04, scoped gates verified):** PR #115's Windows
shard failed while starting PowerShell to compile the M50 MCP launcher.
Both M27 and M50 still compile through `Add-Type` under the existing
20-second process deadline; the reported error lacks termination metadata.
Remove PowerShell startup/module discovery from their shared build path by
invoking Windows' .NET Framework C# compiler directly, keeping source-digest
caching, atomic publication, self-tests and the unchanged deadline. Prove a
forced PowerShell compile-start failure is avoided for both helpers and run
real Windows compile/process suites. Preserve compiler diagnostics and
termination details on failures. Record the precise evidence and any limits
in `docs/certification/mcp-job-flake.md`; scoped lane gates run on Win11,
with aggregate quality and hosted CI left to the lead per the lane rules.
Win11 passed 80 tests across six owned helper/MCP/shell suites, with two
existing platform skips. Both deliberate regressions fired and the source
was restored SHA-256-exact. All five compiler projects, scoped lint/format,
dead code, duplication, localization, host API and production build passed;
the extension is 553.1 KiB under its unchanged 600 KiB cap. The initial
CI termination reason remains unavailable; the dependency on PowerShell
compile startup is removed for both helpers, and future native compiler
failures include diagnostics and exit/signal/killed metadata.

**JOBFLAKE follow-up (2026-10-03, scoped gates verified):** hosted Windows failures in
PRs #96 and #89 hid the helper's preparation error and kept its failed
promise for the session. Keep compilation and success caching unchanged;
clear only an unavailable result so the next caller tries preparation
again, sharing each in-flight attempt. Collect the real helper log in
`toolIo.test.ts`'s missing-helper assertion. Prove compile and self-test
recovery with fake runners, deliberately restore the old cache to see the
regressions fail, then restore exact bytes. Run the two owned suites on
Win11 and the lane's scoped gates; full quality remains the lead's gate
under `common.md`. Record the paths to unavailability and actual receipts
in `docs/certification/jobflake.md`. The first hosted failure's specific
trigger remains unknown until the improved assertion captures it.
Final Win11 proof: 53 passed, 2 existing platform skips. All five type
projects, scoped lint/format, host API, duplication, dead code,
localization and production build passed. Both recovery controls failed
with the old cache and passed after exact-byte restoration. Aggregate
quality and the unchanged pins' npm audit triage remain with the lead.

**Status 2026-09-23: built.**

Status detail retained: built and certified (`docs/certification/m27.md`);
merged through pull request #12 from `hardening/m27-orphans`, shipped in
0.6.0.

Found at the 0.6.0 release gate: three full runs in a row failed in
`toolIo.test.ts`'s teardown (`EBUSY` on its folder, every test green). A
logged run showed `taskkill /T` killing the shell and its console host
while a ping PowerShell had started during the kill (160 ms before
taskkill returned) lived on in the folder; one orphan of an earlier run was
still there, suspended. The first fix, a sweep for the dead shell's
orphans, left a launcher's child unreachable (its parent gone too), which
the Codex review of PR #12 pointed out; job objects replace it as the
primary path, the sweep staying as the fallback.

- **Goal**: a timed-out or stopped command ends with every process it
  started, on Windows as on POSIX (the D25 row above).
- **Scope**: `shellJob.ts` (the helper's source, its compile, self-test and
  cache, the join statement); `processTree.ts` (the job termination, the
  fallback sweep with its identity check, `killTree` awaited, one
  `PSModulePath`); `runCommand` and `shellArguments` in `toolIo.ts`; the
  wiring in `extension.ts`; the constants; `processTree.test.ts`,
  `shellJob.test.ts`, `toolIo.test.ts`, the test folders' removal helper;
  README, CHANGELOG, this file.
- **Acceptance**: for real on Windows, a launcher's orphaned grandchild
  ended through the job, a background process surviving a normal end, and
  the fallback finding an escaped child; the helper's cache, self-test and
  failures, the job path and the fallback's rounds over scripted helpers;
  the command's result waiting; the test-fire proofs; full gate runs green;
  the PR's CI green.
- **Security**: the helper is compiled on the user's machine from source
  in the extension (no binary shipped), into the extension's own storage,
  named by the source's digest; it calls only `CreateJobObject`,
  `AssignProcessToJobObject`, `OpenJobObject` and `TerminateJobObject`,
  on jobs this extension named. The fallback kills only processes created
  while their parent was the command's, each after a same-run check of its
  creation time. Windows PowerShell by absolute path under `%SystemRoot%`;
  fixed scripts with numeric ids and quoted paths only; no new dependency.

## M28 — macOS dictation asks under its own name (D29)

**Status 2026-09-23: built.**

Status detail retained: built and certified (`docs/certification/m28.md`);
pull request #15 from `hardening/m28-release-hygiene`, shipped in 0.7.0.

The owner's go-ahead (2026-09-23) on the route M26 recorded: macOS charges
a helper's privacy requests to the app responsible for it, VS Code for the
panel, and VS Code declares no speech-recognition purpose
(microsoft/vscode#307364), so macOS refused dictation from the panel without
asking.

- **Goal**: macOS asks for the helper's own speech-recognition and
  microphone permissions, under its own name and usage descriptions.
- **Scope**: `native/darwin/Dictation.swift` (the disclaimed re-launch via
  `responsibility_spawnattrs_setdisclaim`, looked up at run time; the
  parent relaying SIGTERM, SIGINT and SIGHUP and the exit status; the
  refusal texts), `native/darwin/check-disclaim.sh` and its step in the
  macOS CI job, the comments on `--app-name`, the early-exit hint; README,
  PRIVACY, CHANGELOG, this file.
- **Acceptance**: on the owner's Mac mini, tccd attributing the request to
  the helper and prompting for it, where the same binary with the disclaim
  skipped is charged to its parent and refused; the check passing there
  and failing with the re-launch or the relay removed; the macOS CI job
  running the check; the gate green.
- **Security**: a private libsystem call, resolved with `dlsym` and
  skipped when absent (the helper then asks as before); no new entitlement,
  no signing change; the grants cover the helper alone, not VS Code or
  anything else it starts. The ad-hoc signature ties a grant to one build,
  so an update that changes the helper asks again.

## M29 — `.muse/` is a protected path (D30)

**Status 2026-09-24: built.**

Status detail retained: built and certified (`docs/certification/m29.md`);
pull request #16 from `features/m29-m30-skills-export`, shipped in 0.7.0.

- **Goal**: a write under `.muse/` on the Model API backend asks in every
  mode but Bypass, like the other paths that configure code outside the
  edit.
- **Scope**: `PROTECTED_PATH_SEGMENTS` in `src/shared/constants.ts`; the
  permissions tests; README (the protected list), CHANGELOG, this file.
- **Acceptance**: a write to `.muse/hooks.json` and to `.muse/settings.json`
  asks under Edit automatically and Auto, and a write to `muse/notes.md`
  (no dot) does not; the test fails with the entry removed (proof); the
  gate green. The Muse Code backend is the CLI's own policy: one short live
  turn checks whether it asks before writing `.muse/hooks.json`, and an
  upstream issue follows if it does not.
- **Security**: tightens only.

## M30 — Skills, imports and export (D30)

**Status 2026-09-24: built.**

Status detail retained: built and certified (`docs/certification/m30.md`);
pull request #16 from `features/m29-m30-skills-export`, shipped in 0.7.0.

- **Goal**: manage Muse Code's skills and import Claude Code's or Codex's
  from the panel, continue work from either agent, and export a
  conversation.
- **Scope**: a skills manager over `muse skills list|enable|disable --json`
  (QuickPick with checkboxes, per-skill scope); an importer over
  `muse skills import --from claude|codex` (dry run, confirmation with the
  candidates, import, report); palette rows for `resume-claude` and
  `resume-codex` when listed; a Markdown exporter from the session history
  (both backends) and the JSON session log through `muse export`; commands,
  palette rows, the protocol, constants, tests; README, CHANGELOG, this
  file.
- **Acceptance**: the CLI's JSON parsed with zod (an unexpected shape is an
  error the user sees, not an empty list); enable/disable issued only for
  changed rows, with the right scope; the import confirms before writing and
  reports installed, skipped and failed candidates; the exported Markdown
  holds every message, tool call and result in order; the Muse Code rows
  hidden on the Model API backend and when the CLI is missing; unit tests
  over fake CLI output; test-fire proofs; the gate green.
- **Security**: the CLI is run by absolute path with an argument array and
  no shell (D24), with `--workspace` and `--trust-workspace` only when VS
  Code trusts the folder. Imports copy skills into the user's own skills
  folder only after the user confirms the list. The export is written only
  where the user chose in a save dialog.

## M31 — MCP servers and hooks, read-only (D30)

**Status 2026-09-24: built.**

Status detail retained: built and certified (`docs/certification/m31.md`);
pull request #17 from `features/m31-m32-mcp-hooks-worktrees`, shipped in
0.7.0. Found on the way
and fixed with it: PowerShell reads the typographic quotes U+2018 to U+201B
as quote characters, which the job helper's quoting (M27) did not escape;
quoting moved to `src/core/shellQuote.ts`, which the terminals the
extension opens now use for the CLI's path and every argument.

- **Goal**: see which MCP servers and hooks Muse Code will load, sign in to
  an OAuth server, and open the files that define them, without the
  extension editing them (D17).
- **Scope**: a tolerant reader for the settings file (`mcpServers` and
  legacy `mcp_servers`, `type` or `transport`, url host or command name,
  `mode`, `enabled`; a note when both keys are present, since Muse then
  loads none); `muse mcp login|logout <name>` in a terminal; hook sources:
  `.muse/hooks.json`, the settings `hooks` block, `managed_hooks_path`;
  palette rows and commands; tests; README, CHANGELOG, this file.
- **Acceptance**: every documented and legacy shape read; unreadable or
  malformed files reported, never shown as "no servers"; the conflict note
  when both keys exist; login and logout run in a terminal with the server
  name quoted; unit tests; test-fire proofs; the gate green.
- **Security**: read-only; secrets in `env` and `headers` are never shown
  (names only), and URLs are reduced to scheme and host.

## M32 — Worktrees (D30)

**Status 2026-09-24: built.**

Status detail retained: built and certified (`docs/certification/m32.md`);
pull request #17 from `features/m31-m32-mcp-hooks-worktrees`, shipped in
0.7.0.

- **Goal**: start work on a separate branch without touching the current
  checkout, as the CLI's `--worktree` does.
- **Scope**: "New worktree…" (branch name, base ref, `git worktree add` into
  `<repository>.worktrees/<name>` beside the repository, open in a new
  window) and "Remove worktree…" (`git worktree list --porcelain`, the main
  checkout excluded, `git worktree remove`, `--force` only after a second
  confirmation naming the uncommitted changes); commands, palette rows,
  tests; README, CHANGELOG, this file.
- **Acceptance**: branch names validated with `git check-ref-format`; an
  existing folder refused; git's own error shown when it fails; unit tests
  over the git runner; an integration run against a real temporary
  repository; test-fire proofs; the gate green.
- **Security**: git by absolute path (D24), never in Restricted Mode;
  paths passed as arguments.

## M33 — Web search on the Model API backend (D30)

**Status 2026-09-25: built.**

Status detail retained: built and certified (`docs/certification/m33-m35.md`,
D34); merged as PR #27 (`f52312b`, run 36166385587, seven jobs green) with
M34 and M35; ships in 0.9.0.

- **Goal**: let the key backend search the web, as Claude Code's WebSearch
  tool does, at a cost the user has agreed to, loudly (D30's five rules).
- **Scope**:
  - `museSpark.modelApiWebSearch`, off by default, with the price in its
    description.
  - The shared paid-feature machinery M34 and M35 reuse: the confirmation
    when the feature is turned on, the composer's paid badge, the Account &
    usage tally, and a palette toggle.
  - The `web_search` tool in the Responses request, and
    `web_search_call.results` requested so the row can list its sources.
  - `web_search_call` output items as paid tool rows, and `url_citation`
    annotations as the reply's source links. The replayed text stays
    unchanged.
  - Tests; README, CHANGELOG, this file.
- **Acceptance**:
  - Off by default and absent from every request; on, exactly one tool
    entry, and only on the Model API backend.
  - Turning it on without the confirmation leaves it off.
  - The badge and the tally follow the setting and the searches made.
  - Rows and citations rendered from recorded SSE.
  - Unit tests, test-fire proofs, the gate green.
- **Security**: nothing new executes locally; the searches run at Meta.

## M34 — Image generation on the Model API backend (D30)

**Status 2026-09-25: built.**

Status detail retained: built and certified (`docs/certification/m33-m35.md`,
D34), merged with M33 in PR #27 (`f52312b`).

- **Goal**: let the key backend create an image file when asked (icons,
  mockups, diagrams), at $0.01 an image.
- **Scope**:
  - `museSpark.modelApiImageGeneration`, off by default, with the price in
    its description, loud through M33's machinery.
  - A `generate_image` tool (prompt, workspace path, size) calling
    `POST /v1/images/generations` with `muse-image-1.0` and
    `output_format: png`.
  - An approval card before each call that names the price, in every mode,
    Bypass included (owner ruling, D30).
  - The image written through the confined write path.
  - Tests; README, CHANGELOG, this file.
- **Acceptance**:
  - Off by default and absent from the tool list.
  - Asked before every image in every mode.
  - The path confined like any write, protected paths included.
  - The response parsed with zod.
  - The tally counts each image.
  - Unit tests over a fake Images API, test-fire proofs, the gate green.
- **Security**: the write goes through the same confinement as
  `write_file`, and the call is billed to the user's key only after an
  approval that names the cost.

## M35 — Muse Voice dictation, paid and opt-in (D30)

**Status 2026-09-25: built.**

Status detail retained: built and certified (`docs/certification/m33-m35.md`,
D34), merged with M33 in PR #27 (`f52312b`). As built, the Windows recorder is
compiled when its resident helper starts (no assembly in storage), the
stream is the realtime WebSocket with the key in its first frame, and the
end-to-end check with a real key and a real microphone waits for the owner
(it bills the key: one recording of a few seconds is well under one cent).

- **Goal**: an optional dictation engine with Meta's own recogniser (Muse
  Voice Transcribe, $0.18 per audio hour) on the Model API backend, loudly
  opt-in. The free OS recognisers stay the default everywhere, and are the
  only engine on the Muse Code backend (owner ruling, D30).
- **Scope**:
  - `museSpark.modelApiVoice`, off by default, with the price.
  - Audio capture on the host machine without third-party code:
    - **Windows:** the waveIn API through a compiled-once C# helper, as M27
      compiles its job helper.
    - **macOS:** AVAudioEngine in the existing Swift helper.
    - **Linux:** `arecord` or `parec` when the system has one.
  - Audio streamed to the realtime transcription endpoint with the key.
  - The microphone shows the paid engine (label and tooltip with the
    price), and each recording's length is tallied.
  - Tests; README, PRIVACY, CHANGELOG, this file.
- **Acceptance**:
  - Off by default.
  - Never used on the Muse Code backend.
  - The OS engine is used whenever the paid one is off.
  - Capture stops with the recording and the stream closes.
  - The tally matches the seconds sent.
  - Unit tests over a fake transcription endpoint; one short live check,
    with its cost stated first.
  - Test-fire proofs, the gate green.
- **Security**: audio leaves the machine only while the paid engine records,
  and only to Meta's endpoint with the user's key. PRIVACY.md says so.

## M36 — Rewind finds a hunk that only moved (D31)

**Status 2026-09-24: built.**

Status detail retained: built and certified (`docs/certification/m36.md`);
pull request #17 from `features/m31-m32-mcp-hooks-worktrees`, stacked with
M31 and M32 so the gate runs once; shipped in 0.7.0.

- **Goal**: an edit whose lines are intact is undone even when lines were
  added or removed above it; nothing is ever applied that does not match
  exactly and uniquely.
- **Scope**: `src/core/patchApply.ts` (`placeOf`, the carried shift);
  `patchApply.test.ts`, the D27 test in `modelApiTools.test.ts`; README,
  CHANGELOG, this file.
- **Acceptance**:
  - Moved down and moved up are both found.
  - Two hunks with the move carried, and lines added between them kept.
  - A repeated block placed by the carried move.
  - Refused when ambiguous, and refused when the lines themselves changed.
  - The overlap refusal unchanged.
  - Test-fire proofs, the gate green.
- **Security**: the one relaxation of D27 is bounded: a hunk is applied
  only where its whole text matches exactly and only once; a partial or
  repeated match is refused.

## M37 — The accessibility gate (D32)

**Status 2026-09-24: built.**

Status detail retained: built and certified (`docs/certification/m37.md`);
pull request #18 from `features/m37-accessibility`, shipped in 0.7.0.

- **Goal**: every screen the harness can show passes WCAG 2.2 AA's
  automated checks in all four default themes, and the gate keeps it so.
- **Scope**: `scripts/a11y.mjs`, `scripts/capture-themes.mjs`,
  `scripts/lib/harnessServer.mjs` (shared with `harness-shots.mjs`),
  `test/harness/index.html` (`?theme=`, `?axe=1`),
  `test/harness/themes/*.json`; `EffortSlider.tsx`, `Palette.tsx`,
  `HistoryDialog.tsx`, `ListBody.tsx`, `styles.css`; the component tests; `package.json`
  (`test:a11y`, in `quality` and `quality:ci`); `build.yml` (its CI
  step, Linux and Windows); README, CHANGELOG, this file.
- **Acceptance**:
  - 208 pages (52 scenarios × 4 themes), 0 violations, the exemptions
    printed.
  - Delete archives and restores from the History search box, only with
    the box empty.
  - Focus in the palette or History list keeps the dialog open; leaving it
    closes it; Escape works from the list.
  - Test-fire proofs for each rule fixed, for a page with no result and
    for a missing bundle; the gate green.
- **Security**: none new. axe-core is a dev dependency and never bundled.

## M38 — "/" in the prompt: the palette, then slash commands

**Status 2026-09-24: built.**

Status detail retained: built and certified (`docs/certification/m38.md`);
pull request #19 from `features/m38-slash-autocomplete`, shipped in 0.7.0.

The owner asked for this on 2026-09-24: "when the user types a slash to
begin a slash command it should be adaptive autocomplete, not the slash
opening the command menu". Then, with screenshots of Claude Code: "the
slash should still open the pallet but after you type a character it should
change to the slash commands menu".

- **Goal**: `/` behaves as in Claude Code. The `/` stays in the prompt and
  the palette shows above it. One character more and the palette gives way
  to a flat list of slash commands that narrows as the name is typed.
- **Behaviour**:
  - **The palette** shows while the prompt is exactly `/`, the caret is at
    its end, and the focus is in the composer.
    - It is attached above the box with no filter box of its own. The box
      keeps the focus and hands the palette its keys (Up, Down, Left,
      Right on the effort row, Enter, Escape), and its
      `aria-activedescendant` follows the palette's active row.
    - A row that changes a value in place (effort, thinking, Focus view,
      Ctrl+Enter) keeps the `/` and the palette. Any other row takes the
      `/` with it; a skill row leaves `/selector ` for its arguments.
  - **The list** shows while the prompt is one `/word` (`slashFilterOf`)
    with the caret at its end. A space closes it.
    - The entries are the palette's rows named `/…` (`/agents`,
      `/compact`, `/export`, `/clear`, `/logout`, `/usage`, `/cost`), rows
      given Claude Code's names (`/model`, `/resume`, `/permissions`,
      `/config`, and `/mcp` and `/hooks` on the CLI backend), and the
      session's skills. Each name appears once; a disabled row never.
    - Ranked: names that start with the text, then names with a word that
      does (`engineering:standup` for `st`), then names holding it, then
      descriptions holding it. Alphabetical within each.
    - Up and Down move. Enter runs a command and empties the prompt; on a
      skill it completes `/selector ` for the arguments. Tab completes the
      name. With nothing matching, Enter sends the text as it is.
  - **Both**:
    - Escape closes the menu and keeps the text. The dismissal holds for
      that draft only, so a later `/` opens the menu again.
    - Neither opens while another menu or dialog is open, or with the
      focus outside the composer.
    - Shift+Enter still breaks the line and Shift+Tab still cycles the
      mode.
  - The `/` button still opens the palette with its own filter box.
- **Scope**:
  - New: `src/shared/slashCommands.ts` (the list and its ranking),
    `SlashMenu.tsx`, and `MenuOption.tsx`, the row it shares with the `@`
    list.
  - `PaletteItem.slashName`.
  - `Palette.tsx`: the attached mode, `PaletteKeys` through `keys`, and
    `onActiveRowChange`.
  - `Composer.tsx`, `App.tsx`, `styles.css`.
  - The harness scenarios `slash-palette` and `slash-commands`, which the
    accessibility gate now covers, and `palette` (now the `/` button).
  - Tests, README (and its palette screenshot), CHANGELOG, this file.
- **Acceptance**: both menus in the harness in all four themes with no
  accessibility violation; the component and App tests; test-fire proofs;
  the gate green.

## M39 — Logging and performance you can see

**Status 2026-09-24: built.**

Status detail retained: built and certified (`docs/certification/m39.md`);
pull request #20 from `features/m39-logging-performance`, shipped in 0.7.0.
Owner (2026-09-24): "as far as o11y for errors etc we are good? … really i
mean logging and performance everywhere". An audit of the code that day answered: not yet. The CLI
process layer is well logged, and every line is redacted. The conversation
layer reports failures to the panel but not to the log, webview errors
never reach the host, and nothing measures time at runtime.

- **Goal**:
  - Every failure the user sees is also in the log, and no promise rejects
    unseen.
  - A webview error reaches the log.
  - The log tells a session's story, with ids, results and durations, and
    never its content.
  - Two unbounded resources get bounds.
- **Logging**:
  - `ConversationController.handle` catches, logs and shows a notice.
    Today a failed compact, skill list, copy, insert, file pick,
    sign-in, archive or usage post reaches only VS Code's Extension Host
    log (`extension.ts` calls it with `void`).
  - `notice()` at warning and error level writes the same line to the log;
    so do the worktree and skills commands' error popups.
  - A `webviewError` message carries the text and stack (redacted, rate
    limited, no user content) from:
    - the error boundary, which today only writes to the webview console;
    - `window` `error` and `unhandledrejection`;
    - a guarded reducer: a throw in the message listener is outside React's
      boundary and loses the host message silently;
    - a failed image read.
  - Lifecycle lines at info level, each with the session and turn id so
    they match the CLI's trace logs:
    - sign-in method and outcome, and the backend chosen;
    - session start, resume and fork;
    - turn start and end, with the result and duration;
    - approval decisions (the tool and the answer, not its input);
    - a restart and its reason, and a retried MSP command.
  - Less noise:
    - an invalid setting warns once per value, not on every read (about 7
      per send);
    - an ignored stream event type is logged once, not every frame.
  - No content in the log:
    - an unparsed dictation-helper line is logged by length, not verbatim;
    - the skills CLI's stderr is capped;
    - a malformed model frame's preview stays out of the failure reason.
  - Swallows that hide a cause say it: a permission error is not "file
    absent" or "CLI not found", and a git timeout is not "not a
    repository".
  - Trace level: MSP method names and latencies, and Model API request
    timings, at `trace`. Raising the Muse Spark output channel's level then
    shows more; the default stays quiet.
- **Performance**:
  - Measured and logged:
    - activation time;
    - CLI spawn to handshake;
    - time to first token and turn duration, on both backends;
    - the first Model API turn's git calls (up to three sequential 15 s
      calls today), which also run in parallel.
  - Bounds:
    - an idle timeout on the Model API stream, which today waits on Stop
      alone, ending the turn with a retryable error;
    - a size limit on `read_file` and `edit_file`, which today load a whole
      file of any size.
  - Webview:
    - streamed deltas batched per animation frame; today each is one post,
      one dispatch and a pass over every row;
    - the once-a-second snapshot save held while a reply streams.
  - Smaller:
    - the selection read after the debounce, not before;
    - opened output documents bounded in host memory;
    - output previews clipped by characters as well as lines;
    - the IDE tool server started on first use.
- **Built with these numbers**:
  - Webview errors: at most 10 a minute per panel reach the log, their
    text cut to 1,000 characters and their stack to 4,000.
  - Stream idle limit: 5 minutes, for the headers and between frames.
  - File tools: files up to 10 MiB.
  - Output documents: at most 20, and 32 million characters together.
  - Previews: 12 lines and 2,000 characters.
  - Deltas: batched every 16 ms.
  - An invalid setting warns once per value.
  - `Logger` and `CoreLogger` gain `trace`.
- **Tests**: each item has one, and a drill breaks it once (19 drills). The
  batching case lives in the controller's tests, where the posts are made.
- **Privacy**: the log gains ids, counts, results and durations only.
  Never prompt text, file contents, dictated words or model output.

## M40 — The panel in VS Code's display languages (built)

**Status 2026-09-25: built.**

Status detail retained: built and certified (`docs/certification/m40.md`):
M40a merged in pull request #23, M40b in its own pull request. Owner (2026-09-24): "yes" to the
languages VS Code itself ships. The design is D33.

**M40a, as built** (three agents on separate file sets, after the lead wrote
the shared table, helpers and checks):

- **The table:** `src/shared/l10n/en.ts`, about 620 keys: strings, `{slot}`
  templates, plural forms and label groups (the permission modes and their
  details, effort levels, tool labels, skill scopes, status verbs,
  onboarding tips, Muse Code's exit meanings). `MODEL_TEXT` in
  constants.ts holds the 25 texts the model reads, in English.
- **The helpers:** `src/shared/l10n/text.ts`: `fill`, `plural`,
  `templateParts` (a slot rendered as markup: the approval card's code, the
  usage insight's percentage, the Modes hint's key cap), and `Intl`
  formatting of numbers, percentages, US dollars, units, relative times and
  dates.
- **The checks:** `src/shared/l10n/check.ts` does both jobs. Run loosely,
  it is the shape check the host and the webview apply to a table they
  load; run strictly, it is the gate. `src/shared/l10n/locales.ts` holds
  the languages with a table (none yet) and maps VS Code's language id to
  one.
- **Host:** `src/host/l10n.ts` loads the table at activation. The webview
  HTML carries it as JSON with `<html lang>`, and
  `src/webview/installTable.ts` installs it before the first render.
- **What else changed:**
  - Sentences that ended in a value also became templates (a path last in
    English comes first in Japanese).
  - The exported Markdown's own words are in the table; the conversation in
    it is copied as it was.
  - Log lines no one sees in the panel stay English.
- **The manifest:** 76 strings in `package.nls.json`.
- **The gate** is `npm run check:l10n`, in `quality:gates`. It checks the
  tables, `l10n/untranslated.json` (the names left in English, one list for
  the table and one for the manifest), the manifest, and that nothing reads
  `UI_TEXT` at module load (a TypeScript scan).
- **The harness:** `--lang=<id>` for `harness:shots` and `test:a11y`, and a
  pseudo-locale (`npm run harness:pseudo`).

**M40b, as built:**

- **The translations:** seven agents translated in parallel, two related
  languages each, one pair of files per language. Each took VS Code's own
  terminology in that language (several read Microsoft's VS Code language
  packs), its form of address, and the key names VS Code shows there (Strg,
  Umschalt, Maj, MAIUSC, Mayús).
- **What they produced:** `TABLE_LOCALES` lists the fourteen languages, and
  the gate checks all 28 files strictly.
- **Words that are the same in a language** ("Backend" in German, "Model" in
  Czech, "Manual" in Spanish) are listed per language in
  `l10n/untranslated.json`. So are six values that are the same everywhere:
  the product name as a heading, and five key names.
- **The gate learned one thing:** a plural entry, or a single form of one,
  may be listed. Czech's and Polish's "1 agent" is the English, while their
  other forms are not; before, the agents had to write around it.
- **Seen:** screenshots in German and Japanese. The accessibility gate ran
  in both, 216 pages each, and found one contrast problem English had not
  reached (the Modes menu's highlighted detail line), now fixed.
- **Disclosed:** the README's Languages section says the translations are
  machine-made and how to correct one.

- **Goal**: the panel, the Command Palette entries and the settings read in
  the user's VS Code display language: Simplified and Traditional Chinese,
  Japanese, Korean, German, French, Spanish, Brazilian Portuguese, Russian,
  Italian, Turkish, Polish, Czech and Hungarian, with English as the base.
- **Approach**:
  - The manifest's strings move to `package.nls.json` and
    `package.nls.<language>.json`.
  - `UI_TEXT` becomes the English table; the host picks the table for
    `vscode.env.language` and hands it to the webview when it starts.
  - Counts use `Intl.PluralRules`, and dates and numbers use `Intl`
    formatting in that language.
- **Gate**: every language has every key; placeholders and Markdown match
  the English; nothing is left untranslated except an allowlist of names
  (Muse, MCP, …).
- **Honesty**: the translations are machine-made. The README says so and
  asks for corrections.
- **Order**: after M38 and M39, so their new text is translated with the
  rest.

## M42 — Replay as Meta validates it (D35)

**Status 2026-09-25: built.**

Status detail retained: built and certified (`docs/certification/m42.md`);
merged as PR #28 (`0e09b63`).

- **Goal**: every request the Model API backend sends is a conversation
  Meta accepts, and a stream the server ends early is retried as the docs
  say.
- **Scope**: `phase` on replayed assistant messages, the reasoning summary,
  the reply after a reasoning-only turn, 502 retried, retryable stream
  errors retried whole; the stored-session schema takes `phase`; tests,
  CHANGELOG, this file.
- **Acceptance**: each rule has a test from the documented shape and a red
  drill; the gate green.

## M43 — A row for every tool Muse Code runs (D36)

**Status 2026-09-25: built.**

Status detail retained: built and certified (`docs/certification/m43.md`);
merged as PR #29 (`03ca4da`).

- **Goal**: every tool Muse Code can run has a named row, and the ones that
  answer in JSON read as what they mean; nothing is dropped that the wire
  may add later.
- **Research first**: a live capture of six turns in an empty folder on the
  contributor model (38 model attempts, counted from the trace log) gave
  the exact arguments and results of the memory, goal, schedule, web search
  and background-work tools, and showed that a backgrounded shell call has
  no `background` flag and that an image read carries no
  `modelVisibleContent` on the live stream.
- **Scope**: labels for the CLI's whole tool list and MCP tools; row bodies
  for memory, goals, scheduled prompts and search results; background runs
  recognised from their result (they no longer read "Interrupted" when the
  turn ends); pictures a tool read or made, loaded by the host from the
  workspace under the D24 link check; the Model API's search rows in Muse
  Code's result shape; generic JSON indented; 52 strings in fourteen
  languages; AGENTS.md rule 13 (wire shapes come from a capture).
- **Acceptance**: tests from the captured shapes, drills T1–T12, harness
  scenarios `muse-tools` and `muse-web` seen and in the accessibility gate,
  the gate green.
- **Left for later milestones**: goal controls and `session/goalChanged`
  (M45); stopping background work from the panel (M46); workflow runs (M47).

## M44 — Images on both backends, and image edits (D37)

**Status 2026-09-25: built.**

Status detail retained: built and certified (`docs/certification/m44.md`);
merged as PR #30 (`bdaede4`).

- **Goal**: the owner's "images … on each": the model can make and edit
  images on the Muse Code backend too, billed to the key, opt in and loud.
- **Research**: Meta's `/images/edits` takes a JSON body with the sources
  as data URLs and answers like a generation, at the same price
  (dev.meta.ai/docs/api-reference/images/edit-image, read 2026-09-25).
- **Scope**: `edit_image` on the Model API backend; the shared image
  pipeline (`prepareImageCall` / `runImageCall`, `ToolIo.readBytes`);
  the `ide` server's image tools with the purchase dialog; the tool list
  read per request; key presence in the paid state (`isKeyStored`) for the
  toggles, the badge, Account & usage and Muse Voice on Muse Code; the
  approval card naming an edit's sources; 11 new strings and 4 changed in
  fourteen languages; the M43 gate's e2e timing flake fixed.
- **Acceptance**: tests for every refusal, the purchase, the dialog, the
  list, the marking and the gate; drills; the gate green.
- **Web fetch** (D36's M44 row) moves to its own milestone: it needs a
  network-safety design of its own (M44b, below).

## M44b — Web fetch on the Model API backend (D36)

**Status 2026-09-27: folded into M69 (D49), which also serves it to Muse
Code through the `ide` server; built there on 2026-09-28 with every rule
below (see M69's status).** Muse Code's own
`web_fetch` is gated off in 1.3.0, and the Model API backend has no fetch
tool. The D36 inventory named the network-safety design this needs before
the model may read a page:

- **Destinations:** refuse private, loopback and link-local addresses, and
  pin the DNS answer the check approved, so a second lookup cannot move
  the request inside the network.
- **Redirects:** a small fixed limit, each hop checked like the first.
- **Bounds:** a size cap and a time limit on every fetch.
- **Content:** an allowlist of content types; HTML reduced to text before
  the model sees it.
- **Approvals:** each fetch asks or runs by the permission mode, as a
  network tool.
- **Transport:** through `liveFetch`, so VS Code's proxy and certificate
  settings apply (D43).
- **Acceptance:** tests and red drills for each rule above, a harness
  scenario for its row, the gate green, and a certification record.

## M45 — Goals (D38)

**Status 2026-09-26: built.**

Status detail retained: built, certified and merged as PR #31 (`1908673`,
run 36219311056) (`docs/certification/m45.md`).

- **Goal**: a session goal the user can set, see, pause, resume, change
  and clear on both backends, with Muse Code's verbs, and the Model API
  backend as close to Muse Code's goal loop as it can be without spending
  what the user did not ask for.
- **Research first**: msp.d.ts's `goal/*`, `session/goalChanged` and
  `snapshot.goal`; Muse Code's goal-tracking recipe and interactive docs;
  the goal store's statuses, tool descriptions and failure messages in the
  1.3.0 binary; a live capture of the verbs, their refusals, a resumed
  snapshot and a stopped goal turn (three turns, nine model attempts).
- **Scope**: `goalChanged` in the agent events and the history; the
  resume's snapshot preference; `controlGoal` on both sessions with the
  captured refusals; the Model API's four goal tools, the stored goal, the
  pinned section, the step-probe note, the token budget, Stop pausing, the
  wake turn; the goal strip, `/goal …` in the prompt and the palette's
  `/goal`; 32 strings in fourteen languages; harness scenarios `goal` and
  `goal-edit`.
- **Acceptance**: tests from the captured shapes on both backends, the
  reducer, the controller, the strip and the prompt; drills G1–G54; both
  scenarios seen and in the accessibility gate; the gate green.
- **Left**: a fork's goal on Muse Code shows only once Muse Code reports it
  (fork is refused on Windows 1.3.0, so it could not be captured); the
  exported Markdown does not include the goal.

## M46 — Background work and stop; the `!` user shell; clarifying questions (D39)

**Status 2026-09-26: PR #33 merged into main at `e219d04` after local and hosted gates**
(`docs/certification/m46.md`). A full local gate passed on M45 base
`5581fe2` with the Windows accessibility runner capped at two workers;
M46 was then reconciled onto M45 candidates `502684c`, `ec5db58`,
`899b573`, `f5df625`, `4da43ac`, `f3390ec` and `ef84852`. The full local
quality gate passed on `ef84852`. M45 merged into main at `1908673`, whose
source tree is identical to `ef84852`; M46 now branches from that merge.
M46 was committed as `8a85d79` and opened as PR #33. Review found two
session-lifecycle gaps: final-surface disposal must stop CLI background
tasks, and resumed foreground shell history must restore the `Ctrl+B`
context. Both have focused failing-before/passing-after tests. The
corrected tree passed the full local gate. Its fresh review found one
more case: a Model API shell row starts before approval, so the running
shell shortcut stays off while the permission card waits. A real fake-API
and held-shell test failed before the change, passed after, and verifies
the shortcut works once approved. The second correction's local gate
passed. The next review found a running Model API `!` row missing from
another surface's history, and forks missing a background shell's terminal
context when the later note was cut. Both failed in focused tests before
the fixes; recording the running row and tagging terminal replay notes by
task fixed them. A cross-host restore test then caught that the started
`!` row needed a save at start; `touch()` persists it before completion.
The third correction passed the local full gate. The next review found
that a quiet foreground Model API shell was also absent from another
surface's live history. Started tool rows are now recorded once and
replaced by item ID when they move or finish; a focused test failed
before the change and passed after it. An unanswered function call is
deliberately not persisted to disk because its replay would lack an
output, so this guarantee is for surfaces sharing the live session. The
fourth correction passed the local full gate. A read-only review then
found that a second panel did not know about a shell approval already
pending in the shared Model API session, so its restored row could make
`Ctrl+B` intercept VS Code before the shell was runnable. The live
two-panel test failed before the change and passed after pending approval
requests were replayed to new listeners. The fifth correction passed the
local full gate. A second read-only review found that a joining panel in
Edit automatically could then approve a Manual panel's pending file edit.
Both Model API and Muse Code tests failed before the fix; replayed cards
now carry an internal marker that forbids automatic approval, including
Muse Code's `approval/listPending` path. The sixth correction passed the
local full gate. A further read-only review found the inverse live case:
an older Edit automatically surface could approve a new Manual surface's
edit. Both backends reproduced it; the Model API also exposed a pending
resolver registration race, fixed before the authorization drill. The
reverse order (Manual first, Auto joining) and two Auto panels proved a
single last-mode value cannot describe the shared session safely. Auto
approval now runs only while one controller holds it in Edit automatically;
detaching another panel restores it. The internal replay marker is removed
before postMessage. The seventh correction passed the local full gate.
Its review found one export gap: a Muse `userShell` ending by signal had
the signal in its row but not Markdown. The existing localized signal
label now appears in export too, with a failing-before/passing-after test.
The final export correction passed the local and current-head hosted
quality matrix, with no open review threads, before PR #33 merged.

- **Goal**: what Muse Code's TUI does with Ctrl+B, `/stop` and `!`, and its
  "let me explain" answer to a question, from the panel, on both backends.
- **Research first**: two live captures in empty folders on the contributor
  model, the Windows sandbox on (`C:\muse-live-m46`) and off
  (`C:\muse-live-m46b`): 27 model attempts, counted from the trace logs.
  They gave the shapes in D39, and showed that a `!` command cannot be
  stopped on Muse Code.
- **Scope**: `task/background`, `task/stop`, `task/stopAll`,
  `session/userShell` (the `userShell` grant asked for) and
  `userInput/clarify` on Muse Code; the same on the Model API backend
  (moved shell calls, the user's own commands, explanations); Move to
  background and Stop on the rows, Stop and Stop all in the Agent map, the
  header pill counting running background tasks, Ctrl+B and two commands;
  the `!` prompt (the Shell chip, Run command), the **You ran** row, its
  Markdown export; Explain instead on the question card; "Stopped" for a
  stopped row; two onboarding tips; the fake CLI's `long:` script and its
  task and user-shell methods; 34 strings and 2 command titles in fourteen
  languages.
- **Acceptance**: tests from the captured shapes on both backends, the
  controller, the reducer, the rows, the card, the manifest and the fake
  CLI end to end; drills; harness scenarios `muse-shell`, `background-map`
  and `question-explain` seen and in the accessibility gate; the gate
  green.
- **Runner**: Windows headless Chrome runs at most two harness pages at a
  time. Four concurrent `jump` pages timed out after M46's added UI work;
  one page at a time passed, and two workers passed twice with all four
  themes. This changes resource pressure only: every scenario, axe rule,
  exemption and the per-page timeout stay as they were. Other platforms
  retain six workers (`docs/certification/m46.md`).
- **Left out, on purpose**: the Model API backend makes no model call when
  a background command ends (D39: nobody asked for one); a model-side stop
  tool like Muse Code's `work_stop`, and moving tools other than the shell,
  wait until a capture shows Muse Code doing either.

## M47 — Workflows: captured run and agents (D40)

**Status 2026-09-26: captured read-only presentation merged; owner controls
deferred** (`docs/certification/m47.md`). PR #34 merged into main as
`34002ab` after exact-tree local quality, all seven hosted checks and review.
Live capture proved the run card and one child's updates plus rejected
owner commands; accepted control shapes remain uncaptured.

- **Goal**: a workflow Muse Code runs reads as what it is, a run of agents
  going on in the background, with its captured progress and result.
- **Research first**: a live capture of one turn asking for a workflow
  with one agent, in `C:\muse-live-m47` on the contributor model (eight
  model attempts, counted from the trace log, two of them a first run cut
  short by the capture script); free probes of the controls against the
  finished run for the refusals, and of `session/read` and
  `subagent/readResult` with the agent's id.
- **Scope**: the `workflow` item's fields through the MSP mapping; a
  `workflow` transcript row (name, status, agents, tokens, trigger source,
  result or failure) that outlives its turn; agents merged as Muse Code
  drops fields; the Workflow tool's row (captured inline script and
  launch); the agents pill counting workflow agents and the Agent map listing
  runs; `run.workflow_trigger_mode` read, noted in the map and in
  Diagnostics; localized strings in fourteen languages.
- **Narrow layout**: a workflow name that is visually shortened keeps its
  full display name in the title tooltip; a script ID is not a substitute
  for that name.
- **Agent map composition**: a map with a workflow or background task is not
  empty even if it has no subagent row. The empty hint appears only when all
  three are absent.
- **Sparse history replay**: a same-session history reload preserves a
  workflow child's earlier label and usage from the panel's validated live
  or saved webview snapshot when the final Muse Code item omits those fields.
  A different session never inherits them. With no prior snapshot, absent
  values remain unknown; the final wire item cannot reconstruct them.
- **Model API**: no parity is expected or built; workflows are Muse Code's
  own engine (D40).
- **Acceptance**: tests from the captured presentation frames,
  the applicable rendering drills (the old control drills remain historical
  in the certification record), harness
  scenarios `muse-workflow` and `muse-workflow-map` in the accessibility
  gate. The final candidate passed `npm run quality` on tree
  `7390e3b2fc080aef5fcaa1ad4226f688e0f5ed75`, all seven hosted
  checks and review; PR #34 merged. Claude's M47 source worktree
  passed `quality:gates` but its accessibility run had four Chrome pages
  without a result and exited 1; secrets and SAST did not run.
- **Left out, by Muse Code or evidence**: pausing and resuming a run (no MSP
  verb); a workflow agent's transcript (no session to read); listing or
  recovering saved workflows (`muse workflows list|recover` are CLI commands
  outside MSP); and a resumed workflow's source file in the tool row until
  its actual input arguments are captured. Cancel, Skip and Retry wait for
  a live accepted-command and outcome capture; the captured refusal probes
  alone do not certify usable controls. A child `phase` and saved workflow
  display name also wait for live evidence.

## M48 — Model API subagents and captured Muse Code controls (D45)

**Status 2026-09-26: merged.**

Status detail retained: merged as PR #35 (`docs/certification/m48.md`).
Child requests use a default-off paid gate, one-use task consent and a final
HTTP admission check with a four-attempt limit. The two P1 review threads (a
child's `turnStarted` stealing the parent's steering; the persist guard
missing nested child replays) were fixed with failing-before/passing-after
tests; local quality and all seven hosted checks passed on the final commit.
No real paid request or subscription turn was made. Native read/reopen have
no callable panel path until a bounded live success capture is available.

- **Goal**: the Model API backend can delegate bounded independent work to
  child sessions, with the Agent map and parent context showing the result.
  Muse Code's remaining `reopen` and `readResult` owner commands wait for
  a live success capture.
- **Research**: Muse Code's MSP `SubagentTargetParams` and the method schema
  say `readResult` consumes an already visible result and `reopen` starts a
  later attempt. The 2026-09-23 captured `subagent_spawn` and
  `subagent_wait` calls give their names and core arguments. A live capture
  of the two MSP owner commands is still required under rule 13; SDK types
  alone do not justify a callable panel control.
- **Scope**: six Model API subagent tools; child sessions with their own
  replay and transcript, capacity and idempotent spawn; owner controls;
  child results queued into the parent's next model request; persistence,
  usage and approval routing; Agent map controls and all translations;
  `agents-result` and `agents-closed` harness scenarios.
- **Cancellation boundary**: stopping a queued child discards messages it
  never saw. A later reopen starts the retained objective without replaying
  that cancelled queue; persisted child state carries no cancelled note.
- **Cross-surface and goal boundary**: a child approval pending when another
  panel attaches is replayed with the no-auto-decision marker, and the
  parent routes its decision back to that child. Child usage contributes to
  the parent total once and charges only the goal active at the child turn's
  start, never a later replacement goal.
- **Paid child acceptance**: default-off machine gate and price
  confirmation, one-use child-task cards in every mode, four-attempt
  admission budget checked at the final HTTP boundary on all child paths,
  paid row/badge/tally without double-counting conversation token cost,
  fake-key red drills and localization. No live billed request was needed
  for this acceptance; the Muse Code owner-command capture remains separate.
- **Acceptance for the delivered subset**: unit and protocol tests, each
  new check seen failing in a red drill, local quality gate green, hosted
  checks green, and the certification record under `docs/certification/m48.md`.
  Muse Code `readResult` and `reopen` remain removed and require a later
  bounded live success capture before they can be offered.

## M49 — Memory: see and edit; memory tools on the Model API backend (D36, D41)

**Status 2026-09-26: merged.**

Status detail retained: merged as PR #36 at `4694803`; native writer-lock
parity unproved (`docs/certification/m49.md`). The isolated M49 worktree was based on M47's
main merge `34002ab` (pre-move index tree preserved at
`refs/codex-backups/m49-pre-m47-20260926`), then merged with M48 (`a9dec5a`).
The first full local quality gate
passed on staged M46-base tree `7c39e088` (1,736 unit tests, 272 browser
pages, zero security findings). The M47-base focused set passed 450 tests;
the later ordered-tree gate and review preceded its merge.
New-note atomic publication passed 69 focused memory tests and a two-process
local collision drill; the earlier quality receipt predates that change.
Muse Code's native `.muse-memory.lock` writer protocol remains unproven, so cross-process writes
to an existing note can lose an update (D41, §9). Claude's original M49
worktree had no commit or green `npm run quality` run; its three recorded
attempts stopped in unit tests.

- **Goal**: the notes Muse Code keeps are visible and editable from the
  panel on both backends, and the Model API backend saves and reads them
  with Muse Code's own tools, so both backends share one memory.
- **Research first**: the personal-project note the M43 capture wrote was
  found on disk (names only); a two-turn live capture (`C:\muse-live-m49`,
  contributor model, 25 model attempts, the data home redirected so the
  owner's personal memory was untouched) gave the personal scope's folder,
  the folder-name rule, the front matter, the append separator, the read
  window, the refusals and Muse Code's approvals; the binary's strings gave
  the tool schemas and messages. No MSP method or CLI command exists (D41).
- **Scope**: `src/core/memory/` (locations, index, store);
  `read_memory`/`add_memory`/`edit_memory` on the Model API backend with
  Muse Code's shapes, approvals as edits, the session-start snapshot in the
  instructions, not offered in Restricted Mode; the Memory view
  (`museSpark.memory`, palette "Memory…", `/memory`) with open, new and
  delete, keeping `MEMORY.md` true; 26 strings and one command title in
  fourteen languages; README, PRIVACY, CHANGELOG, this file.
- **Acceptance**: tests from the captured shapes and both captured folder
  names; the store on the real file system with a junction; drills M1–M21;
  the gate green.
- **New-note race**: `add_memory` and the Memory view must create a missing
  note exclusively. If another writer takes its path after the first read,
  report the collision and keep that writer's bytes; never replace them.
- **Index links**: a note with spaces, parentheses, brackets or percent signs
  must get a valid Markdown link in `MEMORY.md`; finding and removing that
  line must recover the note's actual path, without creating duplicates.
- **Left**: the snapshot is read once per session, as Muse Code's is; a
  note is not re-read into the instructions when it changes mid-session.
  The memory rows do not yet open their note (the view does).

## M50 — MCP servers on the Model API backend (D36, D42)

**Status 2026-09-26: merged.**

Status detail retained: merged as PR #37 at `fa370ee`; local and all seven
hosted checks passed
(`docs/certification/m50.md`). The
isolated M50 branch passed `npm run quality` on exact M47-base staged tree
`9a2399aa4b15f401c5e0c73d5f21846af3fff06c`: 1,820 unit tests passed
(3 skipped), 280 accessibility pages had no violated or undecided rules,
and secret/SAST scans found zero findings. An independent Windows audit
found no leftover fixture processes. That receipt predates the merged M48
and M49 tree (`4694803`). The combined staged tree
`28eea6f74ef17c7a9c72bf00325ce3a6d5737f96` passed `npm run quality`:
1,967 unit tests passed (3 skipped), 304 accessibility pages had zero
violations/undecided rules, the production bundles met budgets, audit found
zero advisories, and secret/SAST scans found zero findings. At that
checkpoint, hosted review remained. Corrected staged tree
`8ce10a01a2aeb5f01d9bf33108d7ebaf9f8563dd` passed `npm run quality`
after review fixes: 1,970 unit tests passed (3 skipped), 304 accessibility
pages had zero violations or undecided rules, and audit, secret and SAST
scans found zero findings. PR #37's first hosted run passed Linux and macOS
quality but failed 13 Windows MCP stdio tests: overlapping real-process test
files delayed PowerShell job-helper launches beyond the existing 10 s MCP
initialize and 30 s pool startup deadlines. Windows Vitest files now run
serially while keeping every test, coverage threshold, and deadline. That
first hosted Windows recheck remained open at the time.

The next hosted Windows run (`36268614149`) still failed seven real MCP
process tests after file serialization; the same tree passed local Windows
and WIN-11-VM quality. The 2-core hosted runner can delay each new
PowerShell helper beyond the unchanged MCP deadlines even with one test file
at a time. M50 now compiles a separate C# console launcher once into the
extension storage and starts that executable directly for stdio servers.
Preparation runs a bounded executable self-test, including for a cached
file; a corrupt or blocked binary fails stdio closed with its reason logged.
Its private environment config and nonce-bearing GO still bind the live
creator before a server is created suspended, assigned to a kill-on-close job,
and resumed. The M27 shell-job DLL stays on its existing path. Real Windows
binary, batch, Stop, owner-death and withheld-GO drills passed; WIN-11-VM
passed full quality on staged tree `1c3217a94da0d3850f172d0335426041e8081c52`
with 304 accessibility pages and zero audit, secret or SAST findings. Local
staged tree `fcf1375157ce7f720fb2bb951d942481c9554720` then passed full
quality with 1,974 unit tests and 304 accessibility pages. PR #37 run
`36272726372` then passed all seven hosted jobs on direct-executable head
`d39e02a`, including Windows quality, accessibility, VS Code integration and
VSIX packaging. The final documentation receipt also passed its exact-tree
local gate and all seven hosted checks before PR #37 merged.

PR #37's Codex review found three valid faults: closing during a batch of
more than four servers could launch a later batch after shutdown; a required
server lost during a model reply or tool call did not stop the active turn;
and `_ide` normalized to the reserved `ide` function name. All three are
fixed locally. The new tests failed **3/3** on the reviewed code; removing
the new mid-call loss checks made its test fail **1/1** before restoration.
The affected suites passed **194/194** after the fixes. The corrected tree
later passed its exact-tree local and hosted gates before merge.

- **Goal**: the key backend runs the MCP servers Muse Code would, from the
  same settings, with Muse Code's names for their tools and its approvals,
  loudly when one does not run; and offers the extension's own diagnostics
  tool, which only Muse Code sessions had.
- **Research first**: Muse Code's public pages and changelog, and its 1.3.0
  binary's settings types, framings, validation messages and migrate skill
  (D42); Meta's function name rules, schema limits and the Responses
  schema's content parts for a function's output (the saved API docs). No
  live capture: nothing on the wire is Muse Code's, and there is no key.
- **Scope**: an MCP client of the extension's own (JSON-RPC 2.0, the
  handshake, paged `tools/list`, `tools/call` with deadlines and
  cancellation) over stdio (line-delimited or Content-Length, the process
  spawner with its environment allowlist and batch-file quoting, the tree
  kill) and streamable HTTP (JSON and event-stream replies, sessions,
  headers); the server set per host with its live states; tool names,
  schema fitting and result conversion; the approvals (D42's table); the
  in-process IDE tool; the MCP servers view and palette row on the Model
  API backend; 23 strings in fourteen
  languages; tests with a fake stdio server and a fake HTTP server.
- **Acceptance**: every rule of D42 has a test; drills M1–M24 fail a test
  in Claude's source worktree. The integrated branch's focused real stdio,
  pool and HTTP suites pass. The Windows job-assignment drill fails when
  assignment is disabled and passes when restored; a withheld-GO drill fails
  when owner confirmation is disabled and passes when restored. Real binary,
  batch, Stop, exited-parent and extension-parent death fixtures pass. The
  combined M48–M49 tree passed local quality before PR #37's review fixes;
  the corrected tree later passed exact-tree local and hosted checks.
- **Remote error boundary**: HTTP response bodies, malformed event payloads and authentication challenge parameters are untrusted. Errors and logs keep status and the authentication scheme, not raw server text that could echo a configured header or token.
- **Windows batch launch**: `cmd.exe /v:off` disables delayed `!` expansion even when the machine default enables it; `/d` continues to bypass AutoRun. The configured command and arguments remain quoted and percent signs refused.
- **Startup pressure**: connect at most four configured servers at once. Keep the settings order and start every enabled server, but avoid a simultaneous burst of child processes when a settings file has many entries.
- **Windows stdio containment**: the extension's three binary pipes are inherited unchanged by a configured MCP server. A C# console helper, compiled once into the extension's storage and spawned directly, binds a real handle to the creating Node process, then waits on a separate private pipe for a nonce-bearing GO from that still-live creator. Only then does it create the server suspended, assign a no-breakaway, kill-on-close Job Object and resume it, checking the bound parent handle once more immediately before resume. A dead creator cannot send GO even if its PID was recycled before the bind. Stop ends only the owned helper, closing its job; a server or extension that exits naturally also closes it. Missing job support fails stdio closed. Finite detached children, byte values `00` and `ff`, a `.cmd` launcher, withheld GO and both sides of parent death are covered by real local fixtures; disabling assignment and confirmation made their respective drills fail before restoration. No PID-only process kill is used on this path. M27's DLL remains separate for shell commands.
- **Final stdio response**: Node can report a server process's `exit` before its stdout has drained. M50 starts the job/orphan cleanup at `exit`, but tells the MCP transport the server ended only at Node's `close`. A deterministic exit → final JSON-RPC frame → close test failed when notification was moved back to `exit` and passed when restored; a real server writing its final reply synchronously before immediate exit also passed.
- **POSIX exited parent**: its detached MCP server leads a process group. If that server exits before `close()`, signal its group while descendants still retain the group ID. A finite-lifetime real child failed without this cleanup and passed with it under WSL Arch. A child that deliberately creates a new process group remains outside this guarantee; the POSIX Vitest run still needs a Linux/macOS native dependency install in CI.
- **PowerShell identity pairs**: the earlier Windows sweep drill found that `@(@(pid, ticks))` flattens the pair, so it fed a FILETIME timestamp to `Get-Process -Id` and missed a child. Its hashtable records remain for the M27 fallback and POSIX/legacy cases; M50's Windows stdio path no longer relies on the sweep or a PID at teardown.
- **Left for later**: resources, prompts, sampling, roots, elicitation and
  OAuth for remote servers; a server's own event stream over HTTP.

## M51 — Hooks on the Model API backend (D36)

**Status 2026-09-27: merged.**

Status detail retained: merged as PR #39 at `eb0ce56`; all seven hosted jobs
passed (run 36291432546) (`docs/certification/m51.md`). Still open: live
hook parity beyond the captured PreLLMCall/PostLLMCall echo frames, and the
complete event-specific output contract. For 0.9.0 every hook source
(managed, user and project) loads only in a trusted workspace, so no hook
runs in Restricted Mode (on `release/0.9.0`; §10). The dated paragraphs in
this section are checkpoints from before the merge.

PR #39 review found a `PreToolUse` permission gap at the M49 join: the
memory-tool branch returned before forwarding the hook's `ask` decision,
so `add_memory` or `edit_memory` could write in Bypass without a card.
The forced-approval bit now reaches the memory permission judgment after
path placement and before execution. A forced card requires a human
decision even when `PermissionRequest` hooks allow or Edit automatically
would ordinarily answer a file write; Plan and Restricted Mode refusals
still take precedence. The Bypass/Edit memory-write red tests found no
card before this correction and now pass. Positive allow-once and
hook-forced read paths also pass locally. Exact staged tree `0fbe2c47`
passed full WIN-11-VM quality: 2,041 tests (3 skipped), 304 accessibility
pages with zero violations or missing results, zero audit/secret/SAST
findings, and zero checkout-owned processes. The next documented tree
`58bcb9c5` passed local Windows `npm run quality` with the same 2,041/3
unit result and 304-page accessibility result; all static, build, audit,
secret and SAST gates passed. Redacted staged-patch gitleaks and independent
process audit also found zero. This latest receipt changes the documented
tree again, so its exact local gate and hosted review remain before merge.

Independent final review found an unchecked cast in the Model API host test's
fake response-body helper. The review cleanup replaces it with a runtime
array/record check. A malformed fake input failed before the change and
passes after it; the cleanup receives its own exact-tree quality gate before
commit.
The first pre-PR branch run on `bb2bd61` failed only on Windows:
`toolIo.test.ts`'s real hook-process test hit Vitest's default five-second
test deadline while its real `runHook` operation still had a ten-second
deadline; test-folder cleanup then saw `EBUSY`. Align the test's outer
deadline with other bounded real-process tests so it can observe the hook
operation's success or explicit timeout and finish cleanup. Do not change
`runHook`'s deadline, assertions, Vitest's global threshold or the quality
gate. The exact staged tree `2856971` passed the focused real hook stdin
test on WIN-11-VM with zero fixture-owned processes; final documented-tree
local quality and a new pre-PR branch dispatch remain before a PR. The next
documented tree `0b990287` passed full local Windows quality (2,034 tests,
3 skipped; 304 a11y pages with zero violations/undecided/missing; audit,
gitleaks and SAST zero) and a process audit of zero. The verified pre-PR
workflow receipt below changes documentation again, so the final candidate
must receive its own exact-tree gate before commit and branch dispatch.
The second M51 branch dispatch on `d9602f9` passed all other jobs but Windows
again failed the real hook stdin fixture: with an adequate outer deadline,
`more` returned exit code 1 in hosted CI. The test must exercise the same
PowerShell-to-cmd hook runner using a deterministic Node stdin echo child,
not a terminal pager whose behavior depends on runner console state. Keep
the 10 second product deadline and the assertions that stdin is echoed,
exit is zero and no timeout occurred. The exact staged tree `e46ece3`
passed the focused real hook test on WIN-11-VM after `npm ci`, with zero
checkout-owned processes. Repeat exact documented-tree local quality and
branch dispatch before opening a PR.
The third M51 pre-PR run on `348ac4f` failed the same Windows hook case
after 10,962 ms even with the Node echo child. The next bounded diagnostic
must report the controlled fixture's exit code, timeout/cancel flags and
stdout/stderr on failure, without secrets. Do not infer a terminal-pager
cause or relax the 10 second product limit before that result is known;
the PowerShell-to-cmd stdin forwarding boundary may need a runtime fix.
Run `36282344418` then reported `isTimedOut: true`, `elapsedMs: 11027`,
empty stdout/stderr and no cancellation. Microsoft documents that
[stdin is not connected to PowerShell's pipeline for input](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_redirection?view=powershell-5.1),
while [`Console.In` reads standard input](https://learn.microsoft.com/en-us/dotnet/api/system.console.in?view=netframework-4.8.1).
A diagnostic Windows wrapper explicitly read UTF-8 stdin and piped it to
cmd, with the existing 256 KiB hook-input cap enforced before spawn; the
job-object join, allowlisted environment and child command line stayed
intact. A local Unicode JSON echo drill passed;
removing the adapter cap made its oversized-input guard test fail before
restoration. Exact staged tree `c977c836` passed a real Unicode+EOF hook
drill and full WIN-11-VM `npm run quality`: 2,036 tests passed (3 skipped),
304 accessible pages returned with zero violations/undecided/missing, and
audit, gitleaks and SAST found zero. The remote tree matched before/after
and process audit found zero checkout-owned processes. This receipt changes
documentation, so final exact local Windows and hosted branch proof remain
before a PR.
Hosted run `36284566101` on `bf559d4` still timed out the controlled
Windows echo case at 12,232 ms with empty output, despite explicit stdin
forwarding. That does not prove stdin was the cause. The next diagnostic
uses a 30 second budget only for this real-process fixture (still far below
the product's 600 second default) and a 60 second Vitest envelope, while
keeping the exit/Unicode echo/no-timeout assertions and all separate
timeout gates. A late success would point to hosted startup pressure; a
30 second hang would call for deeper I/O work. If late success occurs,
compare the original wrapper under the same hosted budget before
retaining extra runtime forwarding code. Run `36285882702` then passed
all seven hosted jobs on `cadb565`; its Windows Unicode/EOF hook test took
28,779 ms, near the 30 second fixture cap. An isolated pre-forwarding
wrapper tree `9ebcdf21` passed that Unicode/EOF test locally and on
WIN-11-VM with no owned process left. The extra PowerShell read/pipe has
no demonstrated benefit, so revert only that line while keeping the
256 KiB adapter guard. Raise this fixture's bounded operation budget to
60 seconds and its Vitest envelope to 90 seconds, still below the 600
second product default; all separate timeout behavior tests remain. Exact
staged tree `b9667382` then passed a focused Unicode/EOF test and full
WIN-11-VM quality: 2,036 tests passed (3 skipped), all 304 a11y pages
returned with zero violations/undecided/missing, and audit, gitleaks and
SAST found zero. Remote tree and process audit were clean. This receipt
changes documentation; exact host-local and hosted proof on the simpler
wrapper remain required before a PR.
An M54 integration review found a separate hook-stdin privacy boundary:
`input_text`, developer instructions, tool descriptions and assistant output
can themselves contain pasted `data:` media URLs. The common model-call
preview now scrubs those URLs before clipping text, preserving ordinary
surrounding words and leaving the actual Model API request/replay unchanged.
A fake Zod-valid text URL failed the pre/post payload test before the fix;
the shared projection then passed 4/4 focused tests. No new provider wire
schema or live paid call is inferred. The prior documented-tree full gate
`42168ea7` passed locally with 2,034 unit tests (3 skipped), 304 accessible
pages and zero audit/leak/SAST findings, but predates this media fix; exact
quality and branch dispatch remain required on the new tree.

Checkpoint 2026-09-26 (superseded by the merge): M51 branch `4624552` includes merged main `fa370ee` and has exact-tree Windows `npm run quality` green on tree `6a70ef7` (2,033 tests passed, 3 skipped; 304 accessibility pages with zero violations, undecided or missing; audit, gitleaks and SAST zero). The small final-review test/doc cleanup then required its own exact-tree gate before commit. The
bounded runtime wires all 17 documented event names at the Model API backend's supported operations: `SessionStart`, `UserPromptSubmit`,
`PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`,
`PostToolBatch`, `PreCompact`, `PostCompact`, `Stop`, `StopFailure`, `SessionEnd`
and `Notification`, plus captured `PreLLMCall` and successful `PostLLMCall`
boundaries. `SubagentStart` and `SubagentStop` now run at the M48 child turn
boundary under the same paid task grant. The complete event-specific output
contract remains open. The pre-M48 stage is pinned at
`refs/codex-backups/m51-pre-m48-20260926`; M48 reconciliation passed 232/232
focused tests across six hook/host/settings/tool-I/O files, host and unit
typechecks, localization and targeted lint. At that checkpoint, the final
documented-tree gate remained open. An
initial duplication check failed on 11 clone pairs, then passed with zero
clones after shared hook and write-turn helpers; no gate was weakened. An
isolated Muse Code 1.3.0 echo-provider run
captured PreLLMCall/PostLLMCall success frames and a PreLLMCall block. A
subsequent isolated echo run captured a PostLLMCall block: its run failed
without another model request. Full Model API parity remains open; the
captured safe subset is staged in this isolated worktree.
The pre-PR workflow delta from merged main `10522223` is staged with the
review cleanup for one exact candidate gate; branch dispatch remains a
separate prerequisite to opening its PR.

The first full M48-base quality run reached `security:sast` after 1,814
passing unit tests and 304 accessible pages, then failed on unbounded
host-thread regex compilation in the hook parser. Compilation now runs
inside a bounded V8 context, and the focused hook/host tests and Semgrep
scan pass. The exact documented tree still needs a full quality rerun.
The first documented rerun found a separate 25 ms regex match timeout
false negative under 147 coverage workers because each match built a new
V8 context. Reusing fixed contexts kept the 25 ms match bound and restored
the full unit-coverage pass (1,814 tests, 3 skipped). The final exact-tree
quality gate remains pending.
Windows `npm run quality` then exited 0 on exact staged source tree
`b87fb92247a57e37b4a28a01a1ad2a3effbeef5c`: 1,814 unit tests passed
(3 skipped), all 304 accessibility pages returned with no violations or
undecided results, and audit, secret and SAST checks were clean. This
receipt is for the source tree before the documentation update; rerun the
full gate on the final documented tree before committing.
The documented tree `1ebbfc1eba20f41c09c57a6c4f113071e692c4af`
also passed local Windows `npm run quality`: 1,814 unit tests passed
(3 skipped), 304 accessibility pages returned with zero violations,
undecided results or missing pages, and audit, secret and SAST checks were
clean. Independent process audit found no M51-owned Node or Chrome process.
This added receipt changes the staged tree, so the commit candidate must
pass the full gate once more before commit.
It did: local Windows `npm run quality` exited 0 on final documented tree
`da39841b6919b76ba0e70ca17ba3fbf3e003b400`; 1,814 tests passed
(3 skipped), all 304 accessibility pages returned, and audit, secret,
SAST and duplication gates were clean. No M51-owned Node or Chrome process
remained. That tree was committed locally as `08a217b` without a push.

The reviewed M49 merge `4694803` was then joined on the M51 branch from a
fresh backup ref `refs/codex-backups/m51-pre-m49-20260926`. Four content
conflicts combined M51 hook loading and paid child approvals with M49's
memory store and tests. Eight focused hook, subagent and memory suites
passed 284/284; all five TypeScript projects, localization, targeted lint,
Prettier and duplication passed. A red mutation that sent the original
tool arguments past `PreToolUse` changed the memory approval from
`reviewed.md` back to `deploy.md`; restoring the effective call passed.
M50 external MCP/IDE hook integration and the Model API Hooks picker
were added in the later M50 join. Exact local quality then passed;
hosted M51 review remains open.
The first exact M49-combined staged tree
`da82047818238b6788070181406a7d9f76492d92` then passed local Windows
`npm run quality`: 1,894 tests passed (3 skipped), all 304 accessibility
pages returned with zero violations or undecided results, and audit,
secret, duplication and SAST gates were clean. Independent process audit
found no M51-owned Node or Chrome process. This receipt changes the staged
tree; the final documented candidate must pass the full gate before the
local M49 merge commit.

The captured M51 model-call increment wires `PreLLMCall` before a logical
Model API response stream (including compaction) and `PostLLMCall` after a
completed response. It uses the observed summary fields with bounded text
previews, not media bytes, full tool output or API keys. A captured pre-call
block vetoes the request before HTTPS. A post-call block stops before tools
run, pairs returned calls with failure outputs for replay and buys no
follow-up request, matching the isolated echo capture's failed terminal.
Internal HTTP retries share the logical attempt's hook boundary, and the exact retry/failed-response
hook sequence remains an explicit certification gap. The M48 child events
passed local fake boundary tests but have no live provider claim. M50's
external MCP dispatch and the Model API Hooks picker later passed focused
integration tests; live MCP or subagent hook parity is not claimed.

**Integration map, recorded 2026-09-26; M48 child path focused-green, M50 open.** M48 creates a child
in `ModelApiSession.spawnChild`, admits queued work in `startQueuedChildren`
only after its paid grant, and reports a completed turn in `childEvent`.
Pass M51's session hook snapshot into the child without re-reading settings.
Dispatch `SubagentStart` at the actual first child-session start, before its
first model request, and put its allowed context in the child replay. Do not
fire it for a declined spawn or a cancelled queued child. `childEvent` is
too late to implement `SubagentStop`: dispatch that event at the child's
natural stop boundary inside its turn, with the documented child ids and
last assistant message. A block may continue the same child task only within
both M51's stop-continuation bound and M48's existing four-request paid
grant; owner Stop, interrupt, disposal and queued cancellation must not be
converted into a hook-funded continuation. These are local Model API hook
events, not new Muse MSP notification parsers; the SDK's documented payload
is reference evidence, not a live subagent capture.

Before the reversible M50 join, its `ModelApiSession.externalTool` and
`performExternal` needed to join M51's
`runCall`/`decideAndRun` hook path: keep the external `mcp`/read-only IDE
permission and trust checks, route the effective `PreToolUse` input through
normal approval and the MCP/IDE validator, skip workspace `touchPath` for
external tools, preserve M50's structured `outputParts` for model replay,
and send bounded text to `PostToolUse` or `PostToolUseFailure`. Include
`mcp__<server>__<tool>` and `mcp__ide__<tool>` in matcher, post-tool and
batch coverage without exposing media bytes or provider credentials to hook
stdin. M50's palette had offered MCP but not Hooks on the Model API backend;
the join added the backend-aware Hooks picker. M51's earlier machine opt-in
check happened only when hooks loaded; dispatch now checks it again so an
open session stops running hooks as soon as the setting turns off. Source
files remain a session snapshot.

The reversible M50 join at `d39e02a` preserves the reviewed MCP/IDE
dispatch and M51 hook path. Hook stdin now receives a 4,096-character
argument preview with 512-character values, a 1,024-character result
preview, bounded nesting and omitted media/credential fields; the actual
MCP arguments and structured model replay are unchanged. A required-server
failure takes precedence over `PostToolUse` or `PostToolBatch` hook stops.
The backend-aware Hooks picker shows `museSpark.modelApiHooks` on/off state
and opens that setting, while source edits still require a new session.
Fake red drills observed the original media/credential leak and a completed
turn after required-server loss. Independent review found three more await
boundaries: PreLLMCall could send a request after required-server loss,
PostLLMCall could report its own block instead of that loss, and Stop or
SubagentStop could finish a turn after the loss. A separate key-read race
could still send a response POST after that loss. All now recheck the
required server before continuing; the final synchronous request guard
also covers every HTTP retry and preserves child paid admission. Local
fake red/green drills cover each boundary.
Mac `quality:gates` exited 0 on staged pre-review-fix tree `e930a362` with
161 test files passed (one skipped), 14 localization tables, zero duplicate
clones and zero audit advisories. It did not run the browser gate. The
post-review-fix tree `02c02fb314410cd20b02e2d789ac40bc888f1ab7`
also passed Mac `quality:gates` in 121 seconds with the same 161 passed
test files, one skipped, 14 tables, zero clones and audit advisories.
Independent readback confirmed its Git tree and zero checkout-owned Mac
processes. That receipt preceded the documentation join and excluded
browser a11y. The later final M50-main ancestry merge `4624552` has tree
`6a70ef7a87f1cdf8234e1991a74896633709ff6b`, identical to the exact
Windows full-quality candidate: 2,033 tests passed (3 skipped), 304 a11y
pages returned with zero violations, undecided or missing pages, and audit,
gitleaks and SAST reported zero. Independent CIM audit found zero M51-owned
Node or Chrome processes. The branch is clean and unpushed; hosted M51
review and the scoped review-cleanup gate remain open.

Focused M48 fake checks now cover no `SubagentStart` for decline/queued
cancel, one start context reaching only the child, natural `SubagentStop`
feedback under the four-request cap, explicit Stop that cannot be vetoed,
and live hook opt-out in an open session. The M50 fake tests now cover MCP
rewrite through normal approval, bounded hook payloads, post-tool/batch
delivery and required-server loss at hook await boundaries. Remaining
cross-feature IDE and denial checks, hosted review and live parity need
completion. The captured echo
frames are unchanged; no new live hook capture is claimed here.

- **Source contract:** Muse Code 1.3.0's [settings-level hook guide](https://meta-models.github.io/muse-code-sdk/next/guides/extend/hooks/) and [event/payload reference](https://meta-models.github.io/muse-code-sdk/next/guides/plugins/reference/hook-events/) document the project, user and managed sources, 17 events, matcher grammar, command fields, stdin and result shapes, and execution limits. The guide includes captured runs. The shorter user guide names 15 events; the SDK reference also documents `PostToolBatch` and `StopFailure`. These are reference shapes, not a claim that this extension has executed them.
- **Goal:** use those existing Muse hook files with Model API sessions, without handing the Model API key to a hook process. Every hook source (managed, user and project) requires VS Code workspace trust (decided for 0.9.0; M51 first gated only project hooks). Hook commands are outside the tool sandbox; the Model API backend must not execute them merely because the model chose a tool. Activation needs an explicit, machine-scoped opt-in and a visible review of commands/sources. A declined or unavailable activation runs no hook.
- **Runtime:** read and validate each source at session start, in managed/user/project order, and keep that snapshot for the session. Reject an invalid source without silently keeping partial guards. Run commands with a cleared, allowlisted environment, stdin JSON, a bounded timeout, independent stdout/stderr limits, process-tree cancellation and at most four concurrent hook commands across the extension host. Validate JSON output before use. Hook answers can block or alter only the event actions the reference allows; any rewritten tool input is revalidated and still passes normal approvals. A hook never approves a paid call, bypasses a protected write, or broadens a session rule. Show failures and hook messages without leaking command environment or credentials.
- **Context priority:** hook-added text is replayed as user-level context. A repository hook cannot create a developer instruction; its blocking decision is enforced by code before the relevant action.
- **Panel access:** expose **Hooks…** in Customize on both backends after M50's palette changes. The picker must say whether Model API hook execution is on, and link to its machine setting; source rows must not claim a trusted project runs while the opt-in is off. Keep Muse Code's read-only settings behavior.
- **Event mapping:** wire lifecycle, prompt, tool, permission, model, compaction, subagent and stop events at their real boundaries. Where a Model API session has no corresponding operation, the event cannot fire; do not fake it. Preserve event-specific payload fields and any hook feedback in the replay/transcript. Bound repeated `Stop` and post-model continuations so hooks cannot create an infinite paid loop.
- **Acceptance:** tests from the cited reference shapes cover source order, trust/opt-in, bad config, matcher selection, denial, updated input plus permission recheck, failure/timeout/output caps, cancellation, cleared credentials, each applicable event and persisted replay. Red drills show a disabled guard test fails, then restored green. `npm run quality` and the relevant UI/accessibility checks pass. Record local and live evidence in `docs/certification/m51.md`; do not mark complete on unit tests alone.

## M52 — Scheduled prompts (D36)

**Extended by D95 (M115, 2026-10-06):** unattended runs, kinds, events,
delivery modes, the shared store and every editor; M52's per-run Run modal
and loaded-session rule are replaced (D95.12).

**Status 2026-09-27: merged.**

Status detail retained: merged as PR #40 at `93ea81c`; all seven hosted jobs
passed (run 36294862598) (`docs/certification/m52.md`). No live model
attempt or paid call was made; the cron day-field rule is a standard-cron
inference, not captured Muse parity. The dated paragraphs below are
checkpoints from before the merge.

Checkpoint 2026-09-26: PR #40 expiry and tariff fixes staged. The
isolated M52 worktree is based on `34002ab`; its pre-M47 79-path staged tree
is pinned at `refs/backup/m52-before-m47`. Sixteen M47-base fake schedule,
paid guard, UI and workflow suites passed 622/622; all five TypeScript
projects and localization passed. On the exact later pre-integration tree
`a248d9c18b51818e5e95234ee13d7a1f4c02a4b3`, WIN-11-VM ran full
`npm run quality` with exit 0 (1,728 tests passed, three skipped; 288
accessibility pages with zero findings; audit, secret and SAST checks clean).
Kubuntu ran `npm run quality:gates` with exit 0 (1,724 passed, seven skipped;
build and audit clean). Linux browser accessibility was not certified.
The later native-proof tree `e4e5a8f24ce513e6eb24e0aa463ccefb2f7647c4`
also passed full Windows `npm run quality` with exit 0: 1,730 tests passed,
three skipped, 288 accessibility pages with zero findings, and clean build,
audit, secret and SAST gates. Its log and process audit are recorded in
`docs/certification/m52.md`. This receipt precedes the ordered join.
The following documentation-only tree
`9e293770599794a2a7b95ad8780b12fc6885577a` passed Mac mini
`npm run quality:gates` with exit 0: 1,726 tests passed, seven skipped,
and build, localization, lint, type, duplication and audit gates clean.
PSScriptAnalyzer is Windows-only; Mac browser accessibility, secret scan and
SAST were not part of that run. Its exact log and process audit are in the
same certification record.
The no-commit join with M51 (`bb2bd61`) now retains M48 paid-child admission,
M49 memory, M50 MCP and M51 hook boundaries alongside scheduled consent.
The client rechecks the key, model and paid gate after SecretStorage, before
each fetch and retry; a synchronous child-admission abort prevents the
scheduled paid row and request. Four red drills caught retry-key changes,
Stop-hook continuation, PreLLM veto and the final admission-abort race before
their fixes (`docs/certification/m52.md`). Focused suites, host/unit/webview
types, localization, lint and duplication pass on the staged join. The exact
combined full gate and final M51 ancestry remain open.
Independent review found that strict schedule persistence could save a parent
or child with an unanswered tool call, and that losing the Model API key left
the old account's schedule prompts visible. Two tests failed before the fixes
and all three focused cases passed after: creation now refuses and removes its
new job while replay is unsafe; listing without a key emits an empty schedule
view. A storage-error red test then showed that clearing after the disk read
could still leave stale prompts visible. The list now clears immediately on
missing identity, before storage I/O, and rechecks identity after the read.
A claim followed by account removal makes no HTTP request or paid tally.
The pre-fix combined tree `88cb798730d12517fc3075753d9aca77d4b403de`
passed Mac `quality:gates` (2,059 passed, 14 skipped); the post-fix tree still
needs the full local, platform and hosted gates. The later M51 hook media
preview correction must also join before final certification.
The cron matcher now follows standard crontab day-field semantics: when either
day field contains `*`, both fields' actual values must match; when neither
contains `*`, either may match. Red tests caught `*/1` wrongly firing on an
unlisted weekday and preserve the `*/2` step and full-range cases. Meta
documents local five-field cron but does not specify this combination rule,
so this is a standard-cron inference, not live Muse parity.
The first M51-joined full WIN-11-VM gate then found four missing results in
the `paid-subagent-usage` accessibility scenario. M48's harness paid tally
omitted M52's required `scheduledRuns` field; protocol validation dropped
that state before the paid badge rendered. A protocol test confirmed the
rejection. Adding `scheduledRuns: 0` to the shared fixture made the targeted
scenario pass all four themes with zero findings. This is pre-fix full-gate
evidence; the corrected exact tree still needs its full rerun.
The corrected staged tree `8ed1a123a584a9e5ac6dc6cef37efd342c92afc7`
then passed literal WIN-11-VM full quality: 2,075 unit tests passed, 312
accessibility pages had zero findings or missing results, and audit, secret,
SAST and PowerShell checks were clean. Its commit `bb9fd538` preserves that
tested tree. This receipt precedes the later M51 fixture and hook-stdin fix.
M55 review found one further display edge: sign-out left a prior schedule
list in webview state even though the core would refuse its key. A reducer
test failed with the old prompt still visible, then passed after auth-state
clearing. Backend switches also clear it; transient CLI sign-in on the still
active Model API backend preserves it until auth actually changes. The
webview suite passed 98/98 after the fix. This fix ships with M55 (PR #43).
A same-backend Model API key replacement then exposed one more boundary:
`backendStopping(false)` dropped the old session, but its schedule event stayed
visible and the next `signedIn` event retained it. A controller test failed
with the old account's prompt still shown. Dropping a Model API session now
emits an empty schedule list before the asynchronous restart, while a CLI
sign-in attempt that keeps the session live does not drop it. The focused
test passed after the fix; no real key or Model API call was used. This
change requires its own exact-tree full gate before a commit.
PR #40 review exposed two M52 boundaries. A seven-day interval first fires
exactly at the seven-day expiry, so normal polling after that instant prunes
the job without a runnable occurrence. Treat expiry as exclusive when
calculating fires; reject a cadence with no eligible fire before creating
storage. An eligible due occurrence remains pending until Run, Cancel or the
seven-day expiry, whichever comes first. Prune and refuse claims at expiry,
including old stored jobs whose first fire equals it. The scheduled
feature-enable price currently quotes
only standard token rates, and the per-run modal reuses those rates even for
a contributor model. Show both verified tariff tiers at feature enable and
the selected model's exact tier in each run modal; an unpriced model cannot
gain consent. Preserve all other paid gates and the zero-request decline.
Add red/green expiry, contributor, and unknown-model tests, update all
localized rate templates and docs, then rerun the exact-tree full gate before
updating PR #40.
Seven focused cases failed before the expiry/tariff fix and then passed;
one more test caught a receipt write crossing expiry and passed after the
post-write guard. Six affected suites pass 273/273, all TypeScript projects,
localization, targeted ESLint, Prettier and zero-clone duplication pass.
No live Model API attempt was used. Full exact-tree quality and hosted PR
checks remain open at this checkpoint.
The first frozen candidate `f215881a` passed static, type, localization and
duplication gates but its full unit gate failed one stale palette expectation
for the old standard-only price (2,089 other tests passed, three skipped).
The palette's new two-tier output is intended; update that explicit test,
prove it green, and rerun full quality on the next exact tree.
The native price-modal decline was observed with a fake Model API in an
ordinary VS Code development window; see the receipt below. Meta's [interactive
guide](https://dev.meta.ai/docs/muse-code/interactive) defines `/loop` as a
recurring prompt with an interval or local five-field cron expression. Its
[loop and cron recipe](https://dev.meta.ai/docs/cookbook/loop-and-cron) says
jobs are session-scoped, need a running process, skip a fire during an active
run, recover at most one missed recurring fire, and expire after seven days.
The captured Muse Code 1.3.0 `cron_create`, `cron_list`, and `cron_delete`
tool rows are in `docs/certification/m43.md`; MSP exposes no cron verb, and
the CLI exposes no `muse cron` command. A panel could ask the model to list or
cancel native jobs, but could not prove that its answer is authoritative.

- **Model API scope**: `/loop <interval> <prompt>` and `/loop "<five-field
cron>" <prompt>` create local, session-scoped schedules; `/loop list` opens
  the stored jobs, and `/loop cancel <id>` removes one. The panel lists prompt,
  cadence, next eligible time, run count, and pending state, with accessible
  run and cancel controls. A schedule belongs to the workspace and the stored
  Model API key identity that created it. It persists with its session and
  survives a window restart. Only a loaded session observes due work; no
  external or hidden process runs after VS Code closes.
- **Money boundary**: scheduling, listing, and cancelling make no Model API
  call. A due occurrence stays pending until Run, Cancel or seven-day expiry,
  whichever comes first. When the user chooses Run, they accept that
  occurrence's prompt and published Model API token prices in a
  modal, and the machine-scoped, off-by-default scheduled-prompts paid gate
  is on with its price accepted. Bypass cannot skip this. A declined or closed
  dialog leaves it pending until expiry and spends nothing. A paid transcript row and
  Account & usage count identify every admitted scheduled run; its tokens
  remain in the session's token-cost estimate, not added twice. A price
  confirmation names one model and session; if either changes while the
  dialog is open, that approval expires without a claim or request. A
  cancelled job is rechecked after the dialog too. Admission carries the
  confirmed model and account digest into the turn; the client compares the
  key it actually reads from SecretStorage with that digest before HTTP,
  and a changed model fails before each scheduled request. Stop during the
  key read refuses before the paid row, tally or HTTP request. No raw key is
  stored in a schedule, transcript or receipt. A local receipt alone does
  not count as paid use; the paid row and tally appear when the first HTTP
  attempt begins, after the final guard.
- **Account isolation during reads**: a list or poll reads the stored jobs
  before resolving the current key identity. An older, delayed read cannot
  publish a previous account's prompts after a key switch.
- **Delivery**: an occurrence is atomically claimed in the workspace store
  before its turn starts. A failed or interrupted turn is recorded as attempted
  and never silently replayed. A recurring job computes its next eligible
  time without a backlog; a one-time job ends after its attempt. An active
  turn leaves the occurrence pending. The run is refused if the API key has
  changed, the workspace differs, the paid gate is off, the session is no
  longer loaded, or the claim cannot be recorded. Resume restores the job
  list before any due notification. Cancel is idempotent and never cancels a
  turn already admitted. A receipt claimed just before a model, key or gate
  change is retained even if the client refuses before HTTP: the missed
  occurrence is skipped rather than risk a replay of a possibly billed one.
- **Muse Code boundary**: its native cron tools remain available through
  ordinary model turns, including the captured tool rows. The panel does not
  claim a native job list or issue a direct cancel until Meta exposes a
  schedulers API over MSP or the CLI; add that wire shape only from a live
  capture. The panel's `/loop` management applies only to the extension's
  Model API schedules, with backend/account/workspace scope shown in the UI.
- **Acceptance**: pure schedule parsing and local-time next-fire tests,
  restart/due/cancel/active-turn tests, atomic-claim and cross-window race
  tests, changed-key and workspace isolation, gate-off/decline/Bypass drills,
  paid row and tally, all translations, accessibility harness, and the full
  `npm run quality` gate. Record red drills and exact evidence in
  `docs/certification/m52.md` before certification.

**Native modal proof plan and result (2026-09-26).** Reuse the same VS Code
`showWarningMessage` helper in production and a disposable ordinary VS Code
development extension. `@vscode/test-cli` explicitly refuses modal dialogs
while it runs extension tests, as the session-1 test-mode attempt showed, so its test
mode cannot certify this gate. The probe uses an in-memory key identity, fake
Model API fetch, session and schedule stores, and an injected clock; it never
reads or stores the owner's key or calls Meta. For Manual and Bypass, make a
job due, open the native per-run price modal, dismiss it in the active WIN-11-VM
console session, and assert zero fake fetches, zero paid-run tally, no receipt
and unchanged fire count. First prove a disposable user-scope interactive task
actually runs in session 1 and can inspect VS Code's UI Automation tree.
Wait for other VM gates to finish before opening a window; remove only the
identified temporary task and helper afterward. If session-1 UI access is
unavailable, leave this acceptance gate open rather than treating a mocked
modal as proof. The disposable task ran in session 1 and UI Automation saw
the actual modal, including the prompt, standard token prices, and Cancel
control. Cancel declined Manual and Bypass runs. The fake host recorded zero
HTTP fetches, paid-run tallies, schedule claims and fire counts in both cases;
the owner key was never read. `@vscode/test-cli` refused the modal in test
mode, and injected Escape did not dismiss the ordinary VS Code modal, so
keyboard Escape is not certified. The temporary task, helper files, private
Code process, profile and extensions directory were removed after a process
audit. The capture and red drill are in `docs/certification/m52.md`; ordered
integration and full gates on the later tree remain open.

## M53 — Conversation rewind and side chat (D46)

**Status 2026-09-27: merged.**

Status detail retained: merged as PR #41 at `be34ee8` with the Account & usage
follow-up; all seven hosted jobs passed (run 36298748478)
(`docs/certification/m53.md`, "Final PR #41 integration receipt"). Limits
stand: Muse Code 1.3.0 refuses forks on Windows, and the Plan-mode side fork
elsewhere is not certified strictly read only. The dated paragraphs below
are checkpoints from before the merge.

**PR #41 live-card image follow-up (focused proof):** the webview's local user-card
ID and Model API's replay user-message ID differ before any History reload.
`turnAccepted` must carry the backend's ID to the card without replacing its
local UI ID, including a late acceptance. A promoted steer may later receive
a new turn ID, so its ID-keyed correction must work on either event order.
Snapshot validation must preserve the replay ID. Five targeted cases failed
before the fix and seven passed after it. Three affected suites passed 273/273;
localization, changed-file lint, formatting and duplication reported zero
problems. The joined-tree gates remain required before this follow-up is
certified.

**PR #41 review follow-up (focused proof):** a steered user card can share its turn
ID with the previous card, so its fork cut must use an earlier distinct turn
or hide conversation rewind when none exists. Image restoration must identify
the selected card as well as its turn. A Muse Code side panel may resume only
its own side fork from History or after a window reload; a foreign session must
be refused before its Plan mode or goal can change. Five focused assertions
failed first; disabling the side guard made its History test fail too. Seven
targeted tests then passed after the source fix; four affected suites passed
433/433 with all five TypeScript projects, lint, localization and formatting
green. An active selected turn remained a further gap: menu and forged
controller request both failed red drills, then were blocked before a fork.
Model API replay now links
each primary or steered user message to its exact transcript card; accepted
compaction stores its real summarized turn through save and resume. Both core
regressions failed before the fix and passed afterward, including older
session files. Exact-tree gates and PR review remain required before this
follow-up is complete.

**Further PR #41 live-card correction (done before merge; see above):** an immediate Model API
image rewind before History reload still uses the webview-local card ID while
the durable replay uses a different generated ID. Red-test primary, steered,
queued and late-acceptance paths; carry the generated ID through acceptance
without replacing the local row ID, then rerun the exact combined gate.

**Checkpoint 2026-09-26 (superseded by the merge): M52 and M54 joins
staged** (`docs/certification/m53.md`). Focused tests and merge red drills
passed on the isolated trees: 628 focused tests on M47 main `34002ab` and
the combined-fork red drill on M46. The pre-move stage is pinned at
`refs/codex-backups/m53-pre-m47-20260926`. M48–M51 are present in staged
tree `01fe750c246b16a527ca51eeb989c672571e7eb8`; six focused suites
passed 561/561 with five TypeScript projects, lint, localization and format
green. The later M52/M54 join passed 614/614 focused tests, five-project
typecheck, localization, lint and formatting. Side-schedule create, cancel
and run first failed their red test, then were refused before storage, claim,
HTTP or paid tally; a PDF remains in side-fork replay. Corrected M51 ancestry
and exact combined quality and browser gates remain open.
The isolated M52/M53 join then passed eight focused suites 681/681 with
zero duplication; its key-replacement checkpoint also passed full Windows
quality (`docs/certification/m53.md`). M54's final ordered join still needs
its own exact-tree gate.

- **Goal**: rewind conversation context to a selected user turn, preserving
  its prompt as a new draft; ask a side question in a separate branch while
  the main conversation continues.
- **Research**: Muse Code 1.3.0 exposes `session/fork` with an optional
  completed-turn cut point, but no MSP rewind or side-chat verb. Its TUI has
  `/rewind` and `/side` (`/btw`). The Model API session already stores input
  replay and transcript items. D46 sets the implementation and limits.
- **Scope**: a user-card rewind choice, draft and available image restoration,
  a fork before the chosen turn (or fresh conversation before the first), a
  separate side-chat panel that keeps the source attached, a fixed Plan-mode
  policy and cleared goal on the side branch, compaction-aware Model API cuts, eight strings
  in all fourteen languages, and documentation.
- **Acceptance**: met at merge (PR #41, run 36298748478).
- **Mac gate checkpoint, M48–M52 joins still pending**: exact staged M53 tree
  `426a6f55f99f551e6ce85254977688964699a867` passed remote patch and
  Node archive verification and `npm ci`, then `quality:gates` stopped at
  `unicorn/prefer-simple-condition-first` in the side-chat `Shift+Tab`
  guard. Moving the existing callback check first passed focused ESLint and
  the keyboard regression test on the private Mac copy. The second run on
  corrected tree `eda1f4ce416ccd5c4cd5f402edc0e0eec01608f5` passed
  through cycles, then stopped at three `jscpd` clones. Shared fork-source
  guard and test setup helpers removed all three on the private Mac copy:
  duplication found zero, 267 focused tests passed, and changed-file ESLint
  plus host/unit type checks passed. A third run on exact staged tree
  `eaa5ee60f195d8eab9ce5ab237ca2c59db70bb0f` passed
  `quality:gates` on Mac: 1717 unit tests passed, localization, duplication
  and audit clean. The `rewind` and `signin` accessibility scenarios each
  passed all four themes; the full Mac accessibility matrix remains open
  after six-way Chrome page timeouts over SSH (`docs/certification/m53.md`).
- **WIN-11-VM full local gate**: literal `npm run quality` exited 0 on exact
  staged M53 tree `4273bd0f94bccfcffae471b5ad1a36cd38542964` on M47
  base. Unit tests: 1721 passed, three skipped. Accessibility: 280 pages,
  zero violated or undecided rules and zero pages without a result.
  PSScriptAnalyzer, localization, duplication, audit, gitleaks and Semgrep
  all reported zero findings. The private VM checkout had no unstaged or
  untracked files or remaining gate processes. This documentation receipt
  changes the staged tree; M48–M52 joins and their gates remain pending
  (`docs/certification/m53.md`).
- **Provisional M51 boundary review**: `ModelApiSession.copyInto` keeps the
  completed-turn/compaction cut alongside M46 background notes and M48 child
  records. A side fork is marked and put in Plan before any M51 `SessionStart`
  hook; all its hooks stay disabled through resume and close. M50 external MCP
  calls are refused before read-only hints or approval rules. Copied and
  resumed child records are held to Plan. A side surface cannot revive an
  ordinary Model API session: the core checks its stored marker before resume
  hooks. Red tests caught the previous hook, child-mode and resume leaks;
  normal forks remain unaffected (`docs/certification/m53.md`).
- **Durable side-session lifecycle**: the stored marker is optional for old
  sessions. The fork clears its inherited goal before a strict save; a failed
  save opens no panel or orphan record, and a slow save finishes before the
  source hold is released. History/restart keeps the side label and Plan lock.
  These focused checks passed on the provisional M51 join. The M52 join now
  refuses schedule create, cancel and run in core before any paid admission;
  red/green tests cover a resumed side fork and a Bypass source. Corrected
  M51 ancestry and exact combined quality still need verification.
- **Stale action boundary**: a rewind message names the session whose
  transcript supplied the selected prompt; a side-chat message names the
  session shown when its header button was clicked. If the surface switched
  sessions before or during host work, neither rewind nor side chat may
  clear, replace, or fork the unrelated current session.
- **Focus return**: closing a side-chat tab reveals its original surface if
  that surface is still registered. The registry's active fallback can be a
  different tab, so it is not used as proof that the original closed.
- **Limit**: Muse Code 1.3.0 on Windows refuses forks. On other Muse Code
  platforms the Plan-mode side fork may inherit allow rules; unlike Model
  API Plan mode, it is not certified as strictly read only.

## M54 — PDFs and other files as input (D47)

**Status 2026-09-27: merged.**

Status detail retained: merged as PR #42 at `cf33cb2`; all seven hosted jobs
passed (run 36345148020) (`docs/certification/m54.md`). Live paid PDF
delivery on the Model API is unverified (no key; fake-API tests only).
Conversation rewind of a PDF or named text-file card stays refused until
exact file-byte restoration exists. The paragraphs below are dated
checkpoints from before the merge.

**I/O review work:** Picker reads must share the bounded, single-handle file
reader used by Model API tools, returning the normal oversize refusal even if a
selected local/remote file grows after metadata is checked. Model API
`read_file` must read text, images and PDFs through the canonical path that
passed workspace confinement; a retargeted symlink must not switch the bytes
to a path outside the workspace after the check. Deterministic race tests and
focused quality gates precede the final ordered-tree certification.
The same checked-target rule extends to paid image edit sources (M44) before
the confirmation/API call and to tool-row images (M43). Tool-row image bytes
must share the bounded single-handle reader so growth after metadata cannot
cross the 10 MiB limit. Deterministic link-swap and stale-size red drills
cover these adjacent paths before final certification.
Paid image output reservation and Model API `write_file`/`edit_file` also keep
the canonical target selected at confinement: a link retarget must not create
or edit outside-workspace files between the check and the write. Text-file
cards keep the requested relative path, and unsaved-editor checks cover both
the requested and canonical paths. Link-swap tests must prove the outside
target is untouched and that an unavailable reservation sends no paid call.
The checked absolute path itself can change after confinement if a workspace
directory is renamed and replaced by a junction. Host reads therefore bind
an opened handle to a fresh canonical-path and file-identity check before
returning bytes. Atomic writes recheck the canonical target, parent and
temporary file at the actual write/rename boundaries, including retries;
changed paths fail closed under the approved target. A real junction-swap
drill must leave the outside sentinel untouched for read and write tools.
Paid image output reservations also check the opened file identity before
fill and before release cleanup, so a changed path cannot delete a different
file. The operation-time canonical check is applied only when the trusted
M54 confinement caller passes its checked canonical path; raw memory paths
retain their separate policy, including macOS `/var` to `/private/var`
aliases. Node cannot expose a final Windows path by handle or perform a
handle-relative rename here; adversarial rapid double-swaps remain outside
these observed-change checks and are not claimed as sandbox protection.
The indexed UTF-8 native picker forwards that proof through FileAccess to its
bounded read after the index check. Native PDF and image picks retain their
existing unrestricted local-path policy. The tool-row image preview adapter
forwards the same proof from workspace confinement to its bounded read.
Picker file-size admission follows bytes, not a misleading suffix: peek only
the first PDF-header window on the already-open handle, then read a detected
PDF up to the document limit or non-PDF bytes up to the selected image/text
limit; a `.pdf` name retains its document cap and invalid-PDF refusal.
An unindexed or outside-workspace text-named file gets only a header probe:
PDF bytes continue on that same handle, while ordinary text stays a mention
without reading beyond that header. Return the detected type even on oversize
refusal so Muse Code gives
its PDF-specific backend reason. Keep private-name, indexed-text, checked-path
and conversation-generation checks before any attachment is retained.
Browser paste/drop admission also peeks the bounded PDF header before applying
the image cap to a file whose MIME and name claim image content. A real PDF
named `.png` uses the 32 MB document limit and PDF media type; a non-PDF image
over 10 MiB is refused without full-file encoding. Preserve the existing
aggregate encoded-media and in-flight reservation checks before encoding, and
drop an asynchronous header result after the conversation changes.
For text-named files, a drop is similarly probed; a paste is probed only when
the clipboard has no plain text to insert. An ordinary text paste retains its
native text behavior, and an ordinary text file is not encoded as an image.
Private attachment names are refused before the header is read.

**Prior checkpoints, 2026-09-27: M51–M53 merged; M54 PR review follow-ups.** The
isolated M54 worktree is based on `34002ab`; its pre-M46 50-path staged tree
is pinned at `refs/codex-backups/m54-pre-m46-20260926`. Focused PDF and
replay checks passed; the M47-base reconciliation passed 724 focused
attachment, replay, workflow and backend tests, all five TypeScript projects,
localization and lint. M48–M53 are now merged on main. The combined M54 code
tree `307157a` passed full Windows VM and Mac gates. PR #42 review found
file-card identity and Muse History-resume gaps, so those gates are a
checkpoint only. Corrected code tree `6b18a3e` passed full WIN-11-VM and Mac
gates; a later review found aggregate browser-admission and localized
tool-row gaps, making those gates a checkpoint. Combined code tree `f4b3a3e`
passed full WIN-11-VM and Mac gates. The next review found a stale native
picker and English invalid-file rows, so those are checkpoint gates too;
combined code tree `57a2a96` passed full WIN-11-VM and Mac gates. Its
documentation receipt's local quality and hosted PR CI remain open. A compressed
or encrypted page tree with
unknown count still reserves all 50 image slots (D47).
The raw page-tree inspector also has a fixed candidate limit: excessive
`/Type /Pages` markers return an unknown count and reserve all 50 slots,
bounding host CPU work on a crafted document within the accepted byte cap.
PDF name `#HH` escapes can hide `/Type`, `/ObjStm`, `/Encrypt`, `/Pages` or
`/Count`; comment-separated type/count tokens are ambiguous too. Those page
trees reserve all 50 slots. Tool `read_file` and
the local attachment picker must bind size check and bytes to one open file
and stop after at most the permitted size plus one byte, even if a workspace
file grows or its path is replaced between asynchronous operations. The
picker keeps its existing over-limit refusal and workspace path policy;
text attachments read the canonical target that passed that policy.
Paste/drop admission uses each file's byte metadata and existing plus
in-flight media reservations to enforce the 48-million-character encoded
budget before `blobToBase64`; a refused second large PDF is never loaded or
expanded in the webview. Each admitted browser file carries a request ID
through the host's added/refused result, so only its own reservation is
released; same-name local refusals cannot release an earlier file. Clearing
or changing the conversation invalidates pending reads before they can post
to the new conversation. The host rechecks actual bytes as before.
The native picker captures that same conversation generation before opening
its dialog and checks it after path validation and bounded file reads, so an
old dialog or file read cannot add an attachment or mention after New
Conversation. Its final add remains bound to the captured generation across
the backend lookup. The separate mention QuickPick likewise ignores a choice
that returns after the conversation cleared.
Browser paste/drop encoding also belongs to the conversation in which it
started. Resume, fork and conversation rewind advance the browser attachment
epoch before asynchronous session replacement; the host binds that epoch
before awaiting the backend and refuses older upload messages. Accepted chips
and the draft remain available, while only unfinished encodes are invalidated.
Restored panels report their current epoch on readiness so a host-driven
session replacement can advance the same boundary before History loads.
A delayed or debounced webview snapshot may restore an epoch older than the
host's current session-change guard. `ready` must never lower that host epoch;
the host returns its current epoch in `surfaceState`, and the panel raises its
epoch before admitting fresh files. A held old upload followed by resume or
fork, stale `ready`, and release must be refused; a new upload after sync must
still be accepted.
Host-driven panel and recent-session restore follows the same browser epoch
boundary before its asynchronous resume. A file delivered after session drop
but before the restored History must be refused, while the panel receives the
new epoch in time to accept fresh uploads. Same-session host restart keeps
accepted chips and draft and does not advance this browser boundary.
An edit or paid image approval binds the canonical target it classified;
the executing tool must use that target and refuse if a workspace alias
resolves elsewhere after the card. Paid image sources use the bytes and
canonical paths approved before the card, with no new private-file read or
HTTP request after an alias changes.
File rewind refusal follows the user card's identity, not its turn: a file
steered into a running turn must not block rewind of an earlier text-only
card. Muse Code's durable `displayText` carries an extension-owned readable
text-file annotation; the MSP snapshot mapper keeps the readable line and
rebuilds a file chip on live events and History resume. A malformed
annotation is treated as a file card and cannot enable a lossy rewind.
Before a direct rewind clears or forks, the host checks the card ID, turn,
text and previous distinct-turn cut against served user items; missing or
mismatched evidence refuses the action.
Muse Code `turn/steer` has no captured `displayText` field, so a text-file
message sent while a turn runs is queued through `turn/start`, where MSP
persists this annotation. Text-only steering remains as before. Native Muse
clients and the extension may show the annotation because it is stored in
MSP's display text. This preserves a user-authored identical line; a false
file-chip match can only refuse rewind, never discard the prompt.
After the M54 Stop replay fix, nine focused suites passed 531/531 and all
five TypeScript projects passed on this tree. M54-on-M47 passed full Windows
`npm run quality` on staged tree `9b01560` (see receipt below); that result
does not certify the ordered combined tree. The M51 join passed 533 focused
tests, all five TypeScript projects, localization and duplication. M50 MCP
image output now shares the PDF page/encoded-media budget, and M51 hook stop
paths remove unsent PDF/image bytes from replay without copying those bytes
to hook stdin. The MCP budget and PostToolBatch Stop red drills failed before
their fixes and passed after restoration (`docs/certification/m54.md`).
When a completed Model API request omits older PDF or image parts to fit the
media budget, durable replay adopts that fitted request after delivery; the
saved session no longer retains bytes the model will never receive again.
History keeps attachment names and types. Failed or stopped requests retain
their prior replay state. Rewind of an image card checks the trusted History
attachment count and available replay bytes before clear or fork, including
after resume and when a webview request reports too few images. Model API
send and steer also check the aggregate UTF-8 size of named text file parts
against their separate context allowance before accepting a turn. This
closes the path where text chips admitted under Muse Code are later sent on
Model API without its admission check.
The M51-joined pre-review tree `2903468656a370d7d4c9a821a56421f03bacd287`
passed full WIN-11-VM quality: 2,070 tests, 304 accessibility pages with zero
findings, audit, Gitleaks and Semgrep clean. It precedes the M51 hook-preview
fix and later M54 review work, so it does not certify the final tree.
Independent review built a valid 50-page PDF with its real page tree in an
object stream and an unlinked visible one-page tree. The bounded raw scanner
had returned one page, underweighting the request. A red test reproduced it;
the parser now reserves all 50 slots when object streams or encryption could
hide the real tree. That review tree still needed a fresh gate.
The M52-joined staged tree `ad5d89dcd36ffdcf6ead66126bf328fdf3493e60`
passed full local Windows quality before its commit `5487149`: 2,113 unit
tests passed, build and audit clean, accessibility and security gates green.
The M53 join now preserves PDF media in side-fork replay and refuses its
scheduled paid controls in core; 614 focused tests passed. Earlier source
tree `2d2d0dc45b31b8b5dcddad9aeae4ca73b126fe2c` passed exact-tree
Windows VM `npm run quality` and Mac/Kubuntu `npm run quality:gates` after the
indexed text picker and tool-row preview forwarded their checked path proofs.
Review then found that a PDF with an image or text suffix could hit the wrong
read cap before its header was inspected. Corrected source tree
`cdf62eca10d02f089f3fbb4487e00ced496d42fc` passed exact-tree Mac and
Kubuntu `npm run quality:gates`; the Windows VM passed 260 focused native
picker, ToolIo and attachment tests on its runtime-equivalent tree `7f56829d`
(two platform-specific skips). The only 7f-to-cdf change is a test expectation
for macOS canonical `/private/var` paths. The final documentation receipt
was superseded by the browser paste/drop review finding. Final browser and
native picker source tree `2fbb593cd99b54fc786587e6847ee87b2dffd496`
passed exact-tree Mac/Kubuntu `npm run quality:gates`; the Windows VM passed
349 focused Composer, PDF, picker, ToolIo and attachment tests (two skips).
That documentation receipt was superseded by two further PR review fixes:
aggregate named-text steering plus undelivered `read_file` reservations, and
browser upload epochs across session replacement and reload. Corrected staged
source tree `91d0e2751ba0dd4d2dcd510919692a8a0fbebfc5` passed exact-tree
Mac and Kubuntu `npm run quality:gates` (2,344 tests on each); WIN-11-VM
passed 817 focused tests on the same tree. The root checkout passed 817
combined focused tests, all five TypeScript projects, lint, localization,
formatting and duplication. The exact receipts are in `docs/certification/m54.md`.
The documentation receipt tree
`b1d05e85830875a2a6cb5355a42f15cf1c3c7015` then passed full Windows
host `npm run quality`: 2,353 unit tests, 312 accessibility pages with zero
findings, dependency audit, Gitleaks and Semgrep all clean. Its exact log,
tree and process audit are in `docs/certification/m54.md`. The final gate note
is documentation-only; the updated PR head needs hosted CI and review. Live
paid PDF delivery remains unverified; no paid request ran.

- **Goal:** a user can send a PDF to the Model API backend from the picker,
  paste or drop, then see it in the sent card and restored history; the agent
  can read a workspace PDF or image through `read_file` and receive its bytes.
  A bounded UTF-8 file picked from a trusted, indexed workspace can be attached on
  both backends as a named text part; binary files remain path mentions or
  explicit refusals. Muse Code gives a direct refusal for a PDF while MSP
  1.3.0 has no file input part.
- **Research:** Meta's `input_file` example and page, size and image budgets
  in the file handling guide; SDK `TurnInputPartType`; SDK issue #48. No live
  Meta API key is present for a paid live call; test against the fake client.
- **Acceptance:** valid PDF byte signature and bounded page counting; size,
  count, aggregate bytes and backend refusal; composer and history chips;
  exact Responses payload, tool read and replay budget; translated text in fourteen languages;
  meaningful red drills and `npm run quality` green. Record evidence in
  `docs/certification/m54.md` before changing status to certified.
- **Stop edge:** a tool-read PDF or image from a stopped/failed turn is not
  sent again with the next user turn; replay says why its bytes are absent.
- **Remaining ordered checks (M48–M53):** check M48 child-session isolation and
  paid attempt accounting for PDF reads; M49 memory-path protections beside
  named text attachments; M50 MCP image parts in function outputs against
  the same page and encoded-media budgets; M51 hook stops after `read_file`
  and hook previews without media bytes; M52 confirmed paid runs with PDFs
  already in replay; M53 rewind of PDF/text chips and Plan-mode side chats
  with inherited PDF context. M52 confirmed paid replay and M53 side-fork PDF
  replay now have focused tests on the staged join. Conversation rewind of a
  PDF/text card is explicitly refused until exact file-byte restoration is
  available. The other cross-checks,
  exact-tree quality and browser gates still precede final certification.
- **Kubuntu exact-tree gate attempt:** the private `10.10.11.212` checkout of
  staged tree `7cd2d8d` passed `npm ci`, then `npm run quality:gates` stopped
  at its first step: Prettier flagged one formatting line in
  `test/unit/modelApiHost.test.ts`. Later gates did not run. The test line is
  formatted in the next staged tree; its remote gate rerun is pending.
- **Second Kubuntu attempt:** staged tree `8c4f36d` passed formatting, then
  stopped at JS lint: the new held-PDF test used the forbidden
  `Promise.withResolvers<void>()` type. Later gates did not run. The test now
  uses the existing `<undefined>` and `resolve(undefined)` convention; a new
  exact-tree gate rerun is pending.
- **Third Kubuntu attempt:** staged tree `ed1035b` passed formatting, lint,
  all five TypeScript projects, localization, dead-code and cycle checks.
  Duplication then found the repeated next-turn assertions in M54's two
  Stop/PDF tests. Their shared request step now lives in one test helper;
  the remaining gates and a new exact-tree rerun are pending.
- **Fourth Kubuntu attempt:** staged tree `a1731ff` passed
  `npm run quality:gates` (exit 0): 1,724 tests passed, 7 skipped, no
  duplication or localization issues, and no audit advisories. This is
  M54-on-M47 Linux gate evidence only. PowerShell analysis was skipped on
  Linux; browser/accessibility, secrets/SAST, live Model API and M48–M53
  ordered-integration gates remain open. The receipt in the docs was added
  after the tested tree, so it is not a claim about a later combined tree.
- **WIN-11-VM full gate:** staged tree `9b01560` passed literal
  `npm.cmd run quality` on `10.10.11.183` (Windows npm entrypoint, exit 0):
  1,728 tests passed, 3 skipped; 280 accessibility pages had zero rule
  violations; PSScriptAnalyzer, Gitleaks and Semgrep found zero issues.
  A first runner invocation of `npm` was blocked by PowerShell's
  `npm.ps1` execution policy and falsely appeared to exit 0; it ran no
  gate and is not counted. The real gate log, independent remote exit 0,
  unchanged tree and post-gate process audit 0 are in `m54.md`. The green
  receipt is a later docs-only edit, and M48–M53 integration plus live Model
  API verification remain open.

## M55 — Install and sign in from the panel (D36, M41)

**Status 2026-09-27: merged.**

Status detail retained: merged as PR #43 at `0cf5e7e`, with the review fix to
the sign-in reducer (`e489ed8`: a device sign-in started from a live Model
API session keeps that session until it succeeds). All seven hosted jobs
passed on head `d50ce40` (run 36346755802) and again on the review fix
(run 36348351793). A live Meta install and a completed device sign-in are
owner steps. Ships in 0.9.0 (`docs/certification/m55.md`).

Earlier checkpoints (historical): the full gate passed on the then-final
tree (2,454 tests, 328 accessibility pages, the host bundle 593.5 KiB within
D6) before the PR review. The staged implementation was reconciled onto
merged M47 main `34002ab` with 449/449 focused tests passing across ten
files; the pre-move stage is pinned at
`refs/codex-backups/m55-pre-m47-20260926`. Full quality, visual and real
installer/sign-in gates remain open. A focused M55 audit on that M47 base
replaced the inline installer confirmation group with the existing accessible
modal, including an inert background. It also resolved the credential-write
versus Cancel/timeout race. Meta's current Muse Code overview documents
`irm https://dev.meta.ai/install.ps1 | iex` on Windows and
`curl -fsSL https://dev.meta.ai/install.sh | sh` on macOS/Linux. The panel
will display the exact platform command and ask for confirmation before opening
a visible terminal to run it. It will recheck the known CLI locations and offer
sign-in when the binary appears; a timed out install remains retriable.

**Follow-up acceptance, 2026-09-26:** A signed-out or signing-in panel with
a saved transcript keeps that transcript available and shows its sign-in and
device-code controls in a visible, accessible banner. Account & usage offers
CLI installation while a Model API key is stored, without changing the live
Model API backend during the installer watch, and offers adding or replacing
the stored Model API key while Muse Code is signed in, without restarting its
session or making a paid call. After an install, the same panel can start Muse
Code browser sign-in; the key stays only in SecretStorage. M52's stale
schedule/account display and M53's side-chat replay remain cross-milestone
join checks, not claims certified by this milestone.
The follow-up's red-first App/Auth cases failed 5/5 on the earlier staged
behavior; after implementation three focused suites passed 115/115, all three
affected TypeScript projects and localization passed, and 32 English/pseudo
targeted accessibility pages across four themes had zero violations. Full
quality and live installer/sign-in proof remain open (`docs/certification/m55.md`).
Final focused regression passed 458/458 tests across nine discovered suites,
with host/webview/unit typechecks, localization, scoped lint and the dev build
green; this remains scoped evidence, not the full quality gate.
The first isolated Mac Node 22 `quality:gates` run on staged tree `13b2f8c`
stopped at one duplicated App test setup; earlier gates passed, later gates
did not run. The shared `/usage` test helper made local `npm run duplication`
pass with zero clones. Mac `quality:gates` then exited 0 on the corrected
staged source tree `f2557f66`: 1715 tests passed, 7 skipped, 0 dependency
advisories and production bundles within budget. Full browser accessibility,
integration, Windows PowerShell lint and live installer/sign-in remain open.
M55 auth safety QA also covers an unsuccessful CLI device sign-in started from
a live Model API key session: Cancel, timeout, refusal or launch failure must
restore that session rather than leave a valid key marked signed out. No key
is passed to the temporary Muse Code host, and no paid request is implied by
the sign-in attempt. A cancelled flow must not publish a late device code.
If VS Code cannot open the installer terminal, the panel must report that
launch failure distinctly from a CLI-discovery timeout, while preserving an
active Model API session. An installer watch that finishes after sign-out must
derive the current credentials and must not restore the earlier signed-in
state. An installer timeout or terminal failure during sign-out or a retained
logout hold must not republish a signed-in status from raw credentials; a
watcher started before sign-out stops at the changed sign-out generation. A
browser sign-in click paused on a SecretStorage read before a newer sign-out
must not start its device flow afterward; a fresh click while held still may
recover a newly written CLI credential under the rules below.
An API-key prompt open in another panel when sign-out starts must not store a
late key. Sign-out waits for any SecretStorage write already underway before
clearing the key, and for any already-started key sign-in backend restart
before ending sessions; neither may publish a signed-in state afterward.
Sign-out must still end the extension host and clear its stored key if the
visible `muse logout` terminal cannot open. A CLI credential file may remain
until that terminal command finishes, and an inherited or configured
`META_API_KEY` cannot be revoked by `muse logout`. Keep the extension gated
and show that remaining-credential condition on refresh; never turn it back
to signed-in merely because the same credential is still present. Persist
only a boolean logout hold in VS Code's extension-private local global state
so a window reload cannot reassert sign-in. An ended extension session reports
signed-out with explicit remaining-credential detail; a later refresh stays
gated as an error until the CLI credential disappears or a new CLI sign-in
explicitly succeeds **without** `META_API_KEY` in the CLI environment. Meta's
[auth guide](https://dev.meta.ai/docs/muse-code/auth) says that environment
key overrides browser sign-in and `muse logout` cannot unset it; do not let a
browser approval silently re-enable key-billed CLI use. Do not remove a user
environment variable or log its value.
The host selector must refuse a held or otherwise unsigned auth state before
and after its asynchronous raw credential check; raw `META_API_KEY` or a file
alone must never create a host. If VS Code cannot persist the logout hold,
the extension must still close the host and show an error instead of claiming
sign-out finished; a new activation cannot safely infer consent from the
remaining raw credential.
After a held refresh sees credentials disappear, it must derive backend facts
again before publishing a signed-in state; the earlier snapshot may be stale.
If a host finishes opening after sign-out revokes admission, close that owned
host before refusing the request.
Backend kind alone cannot bind admission: sign-out followed by a fresh sign-in
to the same Model API kind must invalidate a host selection started before
sign-out. An in-flight session opening or send captures the auth and
conversation generation before its first await, then refuses and preserves
the draft and attachment chips if sign-out, account replacement or New
Conversation occurs before the host or session opens. Close a stale host;
never send the old prompt under the new key.
Recovery from a held old CLI credential file may start an explicit browser
device flow only when `META_API_KEY` is absent and the extension key was
cleared; accept it only after a new credential-file modification is observed.
(Amended 2026-09-27, D26: accept it only once the CLI confirms the new
sign-in; `muse logout` never removes the file, so "remains" means the CLI
still reports a sign-in.)
Sign-out must publish a gated state and start ending attached sessions before
awaiting global state or SecretStorage. Other panels must not send a paid
child follow-up or similar session action during that wait. A rejected
SecretStorage key deletion must still end the host, keep the hold, and report
an actionable error rather than leaving a signed-in turn running.
Two panels may request sign-out concurrently. Treat those requests as one
operation or keep admission blocked until the final sign-out settles; an
earlier caller's `finally` must not release the hold while another stop or
credential clear is pending.
Model and skill catalogues are scoped to the attached session and backend.
Dropping a session clears those cached choices; an asynchronous list begun
under the old session cannot publish after sign-out, New Conversation or a
backend/account switch. A fresh session must fetch its own catalogue even if
an older list is still in flight. An attach delayed in effort setup must
not start old-session skill loading after its generation was revoked.
The M52 account-switch fix clears visible schedules when the Model API key is
replaced; verify it on the ordered M55 join.
Model API conversations also belong to the key that created them. Persist a
nonreversible key digest with each session and expose, resume, read or fork it
only for that same digest. A stored session without ownership metadata stays
on disk but is not admitted: its owner cannot be proved. Replacing a key must
not resume the prior key's session or send its replay under the new key;
History must omit the prior key's sessions. Check the owner again after
asynchronous storage reads. Stop an active old-key turn before replacing its
SecretStorage value so a later tool round cannot pick up the new key. Clear
the panel's old History rows and reject a list reply arriving after the
host stopped. Prove key A to key B with fake keys and zero B requests
containing A's conversation.
On the Muse Code backend, replacing only the secondary Model API key keeps
the subscription conversation running. An extension-owned paid image tool
captures the key generation and digest before its confirmation; a changed
key refuses purchase and every retry before HTTP, without restarting the CLI.
Auth transitions also clear rendered private transcript, output pages and
child transcripts before a new account can see them, while a local unsent
draft remains available. Retained image/file chips and in-flight browser
reads from the prior account are discarded. Reads, History events and session adoption begun
under a stopped host cannot publish old-account content after sign-out.
An account-ending stop detaches this surface's session and closed-session
listeners before awaiting turn cancellation, and queued callbacks check the
session generation. A rename reply held across that stop cannot restore the
former account's title. Other surfaces keep their own listeners until their
own stop, and the stopped turn still receives its local cancelled end. A
`view/gap` history read begun before account stop checks that generation
after every await and cannot refill the cleared panel or post a stale notice.
A surface reloaded during the cancellation wait receives no prior session id,
model or skill catalogue; its saved old-account transcript is invalidated
even when same-kind Model API sign-in follows.
The saved webview snapshot is untrusted until both the live session and
signed-in account are confirmed. Its private title and transcript cannot
render in the connecting/checking shell. A signed-out result clears the
snapshot even when the prior local auth state was only `checking`; a
transient CLI sign-in while the Model API conversation remains live may keep
that already-confirmed conversation visible.
The explicit account-boundary clear is immediate even before the next auth
reply: gate the panel as checking and discard the old usage report, model and
skill catalogues, History archive ids, editor context, mention results and
pending announcement or insert. Keep the unsent local draft. Invalidate a
local quote selection when the conversation changes.
All new session actions use the auth service's admitted backend, not only its
visible signed-in label, and refuse while an account stop is in flight.
Actions already started carry the session and stop generation through their
awaits: stored output and edit review, rewind/side fork, goal and subagent
commands, compaction, and paid scheduled-run confirmation cannot act on the
prior account after that boundary. Paged output stays bound to one session.
Selecting a manager-cached host never closes that borrowed live host merely
because the secondary key changed. Installer discovery in auto mode must
retire the former backend's active session before a newly selected CLI host
is used, then start the next send on the selected backend.
The QA fixes passed 164/164 focused fake-host/fake-CLI tests across eight
suites, host/webview/unit typechecks, localization, scoped lint/format and
zero-duplicate checks. Mac `quality:gates` exited 0 on the pre-documentation
QA staged tree `ed5d2926`: 1723 tests passed, 7 skipped, zero clones and zero
advisories. This receipt was documented afterward; M48–M54 joins and the final
integrated tree need their own gate.

M55 provisional tree `eb30d625` passed Linux and Mac `quality:gates` and
WIN-11-VM full `quality` before later PR #42 review found two more source
issues in M54. These are pre-review checkpoints, not certification of the
final joined tree. Exact receipts are in `docs/certification/m55.md`; final
M54 ancestry, M55 gates and live installer/device approval remain open.

Frozen M54 follow-up tree `f4b3a3e` was layered onto the isolated M55
stage without changing M55 auth source or its earlier gate receipts. The
31-path join passed 633 focused tests across nine suites, five TypeScript
projects, localization across fourteen tables, scoped formatting and lint,
and duplication with zero clones. Those checks are provisional; new exact-tree
Linux, Mac and Windows gates remain required after final M54 ancestry.

Frozen M54 tree `57a2a963` was then layered onto this isolated M55 stage
with its native-picker generation guard and localized visual-read failures.
The 23-path join kept M55 auth source unchanged. Ten selected new
regressions, five TypeScript projects, fourteen localization tables, scoped
ESLint and duplication passed. The earlier `80af642a` WIN-11-VM quality run
was interrupted at accessibility after review found these issues; it has no
quality result. This new tree still needs exact cross-platform gates after
M54 final ancestry and live installer/device approval.

The `a09eac30` Windows host full quality gate completed exit 0 before a
stop request reached it, but a later PR #42 review found two more M54 source
issues; that run is a green checkpoint, not final M55 certification. The
24-path frozen M54 tree `b770bd6a` was then layered onto this isolated M55
stage without changing its auth source. Four affected suites passed 415/415,
all five TypeScript projects, fourteen localization tables, scoped ESLint
and duplication passed. Final exact-tree gates remain open.

PR #42 commit `5292d4a` records the corrected M54 `b770bd6a` Windows VM
and Mac code-tree gates in `m54.md`. The isolated M55 branch now follows
that commit; only receipt documentation changed from its prior staged tree.
Its source still needs M55-specific exact-tree quality after PR #42 review
and merge.

The fifth PR #42 review follow-up, frozen M54 tree `75b30e59`, is now
provisionally layered onto M55's backed-up `bdba7726` stage. Its 27 changed
paths add the Model API named-text context allowance, send/steer admission,
durable media pruning after a completed response, and a History-bound image
rewind guard. The M55 auth implementation remains in place; this combined
source checkpoint was `e0207e2a` before its documentation receipt. M54
VM/Mac gates certify M54 alone. M55 exact-tree quality, PR #42 final
review/merge, and live installer/device approval remain open.

PR #42 fifth-review receipt commit `a228787b` now anchors the isolated M55
branch. Its only change from frozen M54 code tree `75b30e59` is the M54
Windows VM/Mac gate record. M55's prior staged tree `589d5646` was backed
up, and the branch head moved to that commit without changing staged
source, tests, translations or scripts. The M54 certification file now
matches the commit. PR #42 hosted review/merge, M55 exact-tree quality and
live installer/device approval remain open.

The sixth PR #42 review delta from `a228787b` to frozen M54 tree
`639bf222` is provisionally layered onto the backed-up M55 `f531774e`
stage. The ten changed paths add Muse Code attachment admission after a
backend switch and stop stale sends before submission or after a late
acknowledgement, while retaining owned session recovery. M55 authentication
source/tests remain intact; the combined source checkpoint was `ac558296`
before its documentation receipt. M54 platform gates on this code tree,
PR #42 final review/merge, M55 exact-tree quality and live installer/device
approval remain open.

PR #42 sixth-review receipt commit `bd667e46` now anchors the isolated M55
branch. Its only difference from frozen M54 code tree `639bf222` is the
Windows VM/Mac gate record. The prior M55 stage `a54ccfaa` was backed up;
the soft anchor preserved its source, tests, translations and scripts.
The M54 certification file now matches the commit. PR #42 hosted
review/merge, M55 exact-tree quality and live installer/device approval
remain open.

The seventh PR #42 review delta from `bd667e46` to frozen M54 tree
`423ef6f5` is provisionally layered onto the backed-up M55 `8d08b889`
stage. Eight changed paths add page-slot admission for same-round visual
reads and preserve specific localized attachment refusal banners. M55 auth
source/tests remain intact; the combined source checkpoint was `220d9ee0`
before its documentation receipt. M54 platform gates on this code tree,
PR #42 review/merge, M55 exact-tree quality and live installer/device
approval remain open.

PR #42 seventh-review receipt commit `97a13326` now anchors the isolated
M55 branch. Its only difference from frozen M54 code tree `423ef6f5` is
the Windows VM/Mac gate record. The prior M55 stage `1b9e5981` was backed
up; the soft anchor preserved its source, tests, translations and scripts.
The M54 certification file now matches the commit. PR #42 hosted
review/merge, M55 exact-tree quality and live installer/device approval
remain open.

The eighth PR #42 review delta from `97a13326` to frozen M54 tree
`53237394` is provisionally layered onto the backed-up M55 `eeaf355a`
stage. Six changed paths reserve visual MCP tool output, queued `read_file`
media and accepted steering together until first delivery. Stop or failed
delivery removes undelivered output images from replay. M55 authentication
source/tests remain intact; the combined source checkpoint was `c4d4a50d`
before its documentation receipt. M54 platform gates on this code tree,
PR #42 review/merge, M55 exact-tree quality and live installer/device
approval remain open.

PR #42 eighth-review receipt commit `e8974ee3` now anchors the isolated
M55 branch. Its only difference from frozen M54 code tree `53237394` is
the Windows VM/Mac gate record. The prior M55 stage `43789177` was backed
up; the soft anchor preserved source, tests, translations and scripts.
The M54 certification file now matches the commit. PR #42 hosted
review/merge, M55 exact-tree quality and live installer/device approval
remain open.

For sign-in, the panel uses the experimental MSP `account/loginStart` device
flow, with code and browser link visible in the panel, Cancel, and credential
file observation. The isolated 1.3.0 capture `scratchpad/m55/capture-m55.jsonl`
showed `account/read` logged out, `loginStart {type:"deviceCode"}` returning
`verificationUrl` and `userCode`, `loginCancel` returning `cancelled`, and a
`loginCompleted` cancellation notification. It did not capture a successful
sign-in; success must be proved by a credential file change and the backend's
refresh, not a guessed notification shape. The Model API key continues through
SecretStorage and is never given to `muse serve`. (Amended 2026-09-27, D26:
`account/read`, whose shapes were captured on 2026-09-27, decides a
sign-in, with the file change as the second signal. The PR #49 captures
added `expired`, 600 s after `loginStart`, then `granted`, `denied` and
`failed` to the captured endings; `granted` came after both signals, so
it is not one of its own, except with no first `account/read`, where
`granted` borne out by `account/read` counts.)

**Acceptance:** no installer or login starts without its button; installer
command is fixed, shown before confirmation, and runs in a visible terminal;
duplicate clicks start one watcher; install detection leads to sign-in; device
code and URL are schema-checked before display; Cancel also works during
the temporary host handshake, closing that process without starting login;
cancel and timeout close the temporary MSP process; a file change yields a refreshed signed-in state; unit
tests, red drills, accessibility and `npm run quality` pass before certification.

**Host bundle budget (D6), 2026-09-27:** the C# the Windows job helpers
share ships as `native/windows/MuseSparkMcpJob.cs` and is read when a helper
is first built, instead of riding in the host bundle as a 12 KiB string;
`dist/extension.js` went from 605.5 KiB (over the 600 KiB budget) to
593.5 KiB. The budget is unchanged.

## M56 — Enterprise network and posture (D43)

**Status 2026-09-27: built.**

Status detail retained: built, and joined onto M55 as branch
`codex/m56-enterprise-final`. Its commit `f7dc40f` sits on
`codex/m55-install` `b98c05b`. A merge then brings in M55's `d50ce40`, which
carries main's merged M54 (PR #42, `cf33cb2`). Both trees passed local
`npm run quality`, and the receipts are in their commit messages. M55's
review fix and main after PR #43 (`0cf5e7e`) are merged in, and that tree
passed `npm run quality` too (2,497 unit tests passed, 5 skipped; 328
accessibility pages; `dist/extension.js` 596.7 KiB). Merged as PR #44
(`890e37b`) after all seven hosted jobs passed (run 36350220096, the Windows
job on its second attempt); ships in 0.9.0. Still open: live proof behind a
real enterprise proxy with a private root, including Muse Code's IDE route
(`docs/certification/m56.md`, "Final join onto M55").

That join keeps M54's and M55's records as they were. It restores
`docs/certification/m53.md` to M55's copy, and it corrects the certificate
advice to what the Kubuntu drill proved: `NODE_EXTRA_CA_CERTS` helps only
with `http.systemCertificates` off. It also brings `dist/extension.js` from
601.6 KiB to 596.7 KiB under the unchanged 600 KiB budget (D6). To do so,
the shell job type and the MCP launcher's C# ship as `.cs` files beside
M55's shared half, and the two helpers share one copy of their build steps
(`jobBuild.ts`). The paragraphs below record the provisional joins that led
here. Claude's original
worktree left two failed quality runs. The isolated M56 tree builds on merged
main `34002ab`; its pre-M47 stage is pinned at `refs/backup/m56-before-m47`.
The staged tree `0b83645791fc43608cda0f569505cb8bd560661f` passed
`npm run quality` on a separate Windows 11 VM checkout: 1,721 unit tests
passed (3 skipped), 280 accessibility pages returned results with zero
violations, and security scans found no leaks or SAST findings. The VM
process audit found no remaining M56 checkout or accessibility Chrome
process. This receipt covers that exact tree before the later documentation
and proxy-validation fix. The combined staged tree
`5619bd599df00b8a470a63582aec904056a2ae49` then passed full local
Windows quality with 2,209 unit tests, accessibility and security gates
green, and no owned test processes left; commit `90308c1` matches that tree.
The M51 PR #39 and M53 PR #41 review fixes are joined. M54 frozen code and
M55's sign-out, account-isolation and catalogue fixes are joined provisionally;
M55's current independent review fixes, final receipts and merged ancestry
must precede M56's exact-tree local and hosted checks. A live
enterprise proxy with a private-root certificate remains open.

An isolated Kubuntu drill on staged tree `8300ddaa` exercised production
`liveFetch` and `withLoopbackBypass` through Node's environment-proxy
support, a local authenticated CONNECT proxy and a temporary private CA.
The success, missing-CA, 407 and loopback outcomes are recorded in
`docs/certification/m56.md`. This is a local simulation, not VS Code
extension-host or Muse Code IDE-route proof; an actual corporate proxy and
private-root end-to-end check remains open. No model or paid call ran.

A second isolated Kubuntu drill on staged tree `8e1d9cc` ran the actual
extension in VS Code 1.130.0's Extension Development Host. Its production
`liveFetch` reached a loopback-only HTTPS origin through a local authenticated
CONNECT proxy and temporary private CA, with VS Code configured for that
proxy and `http.systemCertificates: false` plus process-local
`NODE_EXTRA_CA_CERTS`. Missing the CA failed TLS verification. With
`http.systemCertificates: true`, that same process-local CA did not make the
request pass in this setup. A network namespace had only loopback and no
routes; no real Meta, model or paid traffic was possible. This proves that
local extension-host path under the stated settings, not a real corporate
proxy/root or Muse Code's IDE MCP route; those checks and exact-tree full
quality remain open (`docs/certification/m56.md`).

The fifth PR #42 review delta from head `5292d4a` to frozen M54 tree
`75b30e59` was layered onto the backed-up M56 `f6a63e62` stage. The M54
certification conflict kept the complete newer M54 receipt; the constants
conflict kept both M56 prompt-cache controls and M54's Model API text limit.
The combined source checkpoint was `43d02269` before its documentation
receipt. M55 authentication and M56 enterprise implementation remain in
place. M54 platform gates on `75b30e59` certify only M54; M56 exact-tree
quality, final M54/M55 ancestry, and live enterprise proxy/private-root
proof remain open.

PR #42 receipt head `a228787` has the same source, tests and localization
tables as frozen M54 tree `75b30e59`; it adds the fifth-review platform
receipt to `docs/certification/m54.md`. The M56 staged source tree was
preserved exactly while moving its HEAD from `5292d4a` to `a228787`, then
the exact M54 receipt blob was adopted. M55 sign-in and M56 enterprise
changes remain staged. This anchor does not certify the combined M56 tree;
its final M55 ancestry, exact-tree gates and live enterprise proof remain open.

The sixth PR #42 review delta from head `a228787` to frozen M54 tree
`639bf222` was layered onto the backed-up M56 stage `b53293c3` without
conflicts. It adds the reverse Muse Code attachment-budget guard and the
Model API stale-send and late-ack fences. The ten-path patch can be reversed
against the combined staged tree, and all other source paths retain their
pre-join blobs. M55 authentication and M56 enterprise changes remain staged.
The M54 code-tree evidence applies only to M54; final PR #42/M55 ancestry,
M56 exact-tree quality and live enterprise proxy/private-root proof remain open.

PR #42 receipt head `bd667e4` has the same source, tests and localization
tables as frozen M54 tree `639bf222`; it adds only the sixth-review platform
receipt to `docs/certification/m54.md`. The M56 staged source tree was
preserved exactly while moving its HEAD from `a228787` to `bd667e4`, then
the exact M54 receipt blob was adopted. M55 sign-in and M56 enterprise
changes remain staged. This remains a provisional ancestry checkpoint;
combined M56 exact-tree gates and live enterprise proof are open.

The seventh PR #42 review delta from head `bd667e4` to frozen M54 tree
`423ef6f5` was layered onto the backed-up M56 stage `5fba42e1` without
conflicts. It adds the Model API tool-read PDF page-slot queue guard and
keeps known localized attachment refusals visible in the composer. The
eight-path patch passes a cached reverse check against the combined stage;
all other paths retain their pre-join blobs. M55 sign-in and M56 enterprise
implementation remain staged. This provisional source join still needs
final PR #42/M55 ancestry, M56 exact-tree gates and live enterprise proof.

PR #42 receipt head `97a1332` has the same source, tests and localization
tables as frozen M54 tree `423ef6f5`; it adds only the seventh-review
platform receipt to `docs/certification/m54.md`. The M56 staged source tree
was preserved exactly while moving its HEAD from `bd667e4` to `97a1332`,
then the exact M54 receipt blob was adopted. M55 sign-in and M56 enterprise
changes remain staged. This ancestry checkpoint still needs final PR #42/M55
joins, combined M56 gates and live enterprise proxy/private-root proof.

The eighth PR #42 review delta from head `97a1332` to frozen M54 tree
`53237394` was layered onto the backed-up M56 stage `0b6923d2` without
conflicts. It reserves current-batch tool output, queued file and accepted
steer media together until first delivery; Stop and failed requests scrub
undelivered output images. The six-path patch passes a cached three-way
reverse check. M55 sign-in and M56 enterprise code remain staged. This
provisional source join still needs final PR #42/M55 ancestry, M56 exact-tree
gates and live enterprise proxy/private-root proof.

PR #42 receipt head `e8974ee` has the same source, tests and localization
tables as frozen M54 tree `53237394`; it adds only the eighth-review
platform receipt to `docs/certification/m54.md`. The M56 staged source tree
was preserved exactly while moving its HEAD from `97a1332` to `e8974ee`,
then the exact M54 receipt blob was adopted. M55 sign-in and M56 enterprise
changes remain staged. This ancestry checkpoint still needs final PR #42/M55
joins, combined M56 gates and live enterprise proxy/private-root proof.

- **Goal**: route the panel through VS Code's proxy and certificate support
  and Muse Code through its documented environment, expose the posture
  switches `muse serve` has, and show managed-configuration status; key the
  Model API's prompt cache as Meta documents.
- **Research first**: VS Code 1.125.0's `proxyResolver.ts` and the shipped
  1.139.0 extension host (the extension's `fetch` and WebSocket already go
  through VS Code's proxy and certificate support); Node 24's failure
  shapes, captured; Muse Code's proxy and certificate variables from its
  binary and a recording proxy; `muse serve --help`, a wrong
  `--sandbox-network`, and four MSP probes of `--no-session-log` (one turn
  on the contributor model, 26 model attempts; the rest no model call);
  `muse config status`; Meta's prompt-caching guide and pricing.
- **Scope**: `liveFetch`; validated VS Code proxy settings at the Muse Code
  child-process boundary; network failures described with their fix;
  loopback in Muse Code's `NO_PROXY` whenever it has a proxy (a fix);
  `museSpark.sandboxNetwork` (machine-scoped, restart on change);
  Diagnostics' network lines and known-safe `muse config status` fields; the
  approval-ceiling refusal as a sentence; `prompt_cache_key` per prefix and
  `museSpark.modelApiPromptCacheRetention` (machine-scoped, in memory by
  default); five UI strings and eight
  manifest strings in fourteen languages; README (Settings, Proxies and
  certificates, Privacy and security, Troubleshooting), PRIVACY, CHANGELOG.
- **Acceptance**: tests from the captured shapes and drills N1–N20 passed;
  the join onto M55 added the job-source contract test and drills N21–N25,
  and its exact tree passed local full quality. Merged as PR #44
  (`890e37b`, run 36350220096, seven jobs green); live enterprise-network
  proof remains open.
- **Left**: `--no-session-log` until Muse Code serves a memory-only host's
  view over MSP (an upstream report, D43); Muse Code's own
  `endpoint_transport.proxy` is the user's to set in its settings file. No
  enterprise proxy with authentication and a private root has been exercised
  end to end; routing and failure messages have local capture evidence only.

## M58 — A popup before every paid use (D48)

**Status 2026-09-27: certified.** Status evidence: `docs/certification/m58.md`.

- **Goal.** The owner's rule of 2026-09-27: every paid use asks in a popup
  with Allow once, Allow always in this workspace, or Deny.
- **Scope.** `PaidUseConsent` and its grants; `askPaidUse`; the Model API
  host's image, child-task and web search paths; the controller's Muse
  Voice start and scheduled run; the Muse Code `ide` image tools; Account &
  usage's "always" state and **Ask again every time**; the badge's tooltip;
  the removal of the paid approval card.
- **Files.** `src/core/paid/paidConsent.ts` (new), `src/host/paid/paidHost.ts`,
  `src/core/backends/modelapi/ModelApiHost.ts`, `permissions.ts`,
  `imageGeneration.ts`, `src/host/conversation/conversationController.ts`,
  `src/extension.ts`, `src/shared/{paid,protocol,agentEvents,constants}.ts`,
  `src/webview/{App.tsx,components/ApprovalCard.tsx,components/UsageDialog.tsx}`,
  the 14 UI and manifest tables, the harness (`paid-always` added; the three
  paid card scenarios now show the row while the popup asks).
- **Acceptance.** Each paid use asks once per use (web search once per
  prompt), in every mode; Deny bills nothing; "always" stops the asking in
  this trusted workspace only, lapses on a price-acceptance change, and is
  taken back by Ask again; a protected image target and a hook demanding a
  question ask anyway; no paid card remains.
- **Tests.** `paidConsent.test.ts` (new), `paidHost.test.ts` and
  `scheduledRunConfirmation.test.ts` (rewritten for the popup),
  `modelApiHost.test.ts` (image, child-task and web search paths),
  `conversationController.test.ts` (Muse Voice), `UsageDialog.test.tsx`.
- **Gates.** `npm run quality`; drills recorded in
  `docs/certification/m58.md`.
- **Docs.** README (Paid features, settings table), PRIVACY, SECURITY,
  AGENTS rule 12, CONTRIBUTING, CHANGELOG.
- **Security.** Grants hold feature names only; untrusted workspaces never
  offer or honour "always"; settings stay machine-scoped.
- **Status.** Built on `feature/m58-paid-consent` (2026-09-27).

## M67 — Code intelligence tools (D49)

**Status 2026-09-29: built.** Status evidence: `docs/certification/m67.md`.

**Integration review 2026-09-29:** PR #57's candidate is being joined with
PR #32 before final gates. A Stop during the last awaited check of the first
rename file could still write; the first-write boundary now rechecks cancellation.
The two held-check regression cases, independent review and final local rig
gates are tracked in `docs/certification/m67.md`; no merged status is claimed.

- **Goal.** The model finds definitions, references and symbols the way
  an IDE does, instead of grepping.
- **Scope.**
  - Tools backed by VS Code's language services:
    - `find_definition` and `find_references` (by symbol at a
      path/line/column, or by name);
    - `workspace_symbols`;
    - `document_symbols`;
    - `hover` (types and docs);
    - `rename_symbol`, which is an edit that asks like one: its edit is
      applied file by file through the extension's edit path, so
      confinement, D24's protected-write cards, Edit Review and rewind all
      apply. On Muse Code the `ide` tool does not write: it returns the
      edits, and Muse Code's own edit tool applies them under its
      approvals and rewind;
    - `call_hierarchy` where the language supports it.
  - A compact **repo map**: files ranked by how often their symbols are
    referenced, within a token budget. It is offered as a tool and as an
    opt-in section of the system prompt.
- **Backends.**
  - Model API: native tools.
  - Muse Code: the same tools on the `ide` MCP server as `mcp__ide__*`.
- **Acceptance.**
  - Input paths are confined like the file tools' (D24). Results outside
    the workspace (a library's `.d.ts`, another root) are left out and
    counted.
  - Results are workspace-relative, capped and deterministic.
  - Restricted Mode still allows the read-only tools; `rename_symbol` is
    an edit, so it follows the edit rules there (and on `ide` it only
    returns edits).
  - A language with no provider answers "no language service", not
    nothing.
- **Tests.** A fake language-service host in unit tests. An integration
  test in VS Code over a TypeScript fixture.
- **Size.** M.
- **As built (2026-09-28).** Decisions taken while building, each open to
  the owner's review:
  - **One core, two surfaces.** `src/core/codeIntel/` holds the tools
    (confinement, placing, capping, the repo map, the rename plan) over a
    `LanguageServiceHost` interface; `src/host/codeIntel/languageServices.ts`
    implements it with VS Code's `vscode.execute…Provider`,
    `vscode.prepareCallHierarchy`/`provide…Calls`, `vscode.prepareRename`
    and `vscode.executeDocumentRenameProvider` commands. The Model API
    offers `find_definition`, `find_references`, `workspace_symbols`,
    `document_symbols`, `hover`, `call_hierarchy`, `repo_map`,
    `rename_symbol`; the `ide` server offers the same as `findDefinition`,
    …, `renameSymbol` (the camel case of `getDiagnostics`). The core stays
    outside `src/core/backends/modelapi/**`, since the activation bundle
    carries it for the `ide` tools.
  - **Naming a symbol.** Path, line and column (1-based); path, line and
    name (its first whole-word use on the line); path and name (its first
    use in the file); or name alone, looked up among the workspace symbols
    (exact name, TypeScript's `greet()` read as `greet`; the first in place
    order is used and the others listed).
  - **"No language service".** VS Code exposes no way to ask whether a
    provider exists, and its commands answer an empty list either way. An
    empty answer is therefore checked against the file's document symbols:
    none means "no language service answered for <file> (language <id>)",
    worded to allow for a file that declares nothing; some means "No
    <kind> at <place>". Workspace symbols have no file to check, so an
    empty answer says that they come from the languages' services and that
    TypeScript's needs a project file open.
  - **Placing results.** A result is in the workspace when its path is
    (textual and canonical confinement, D24) or when its real path is under
    the root's real path (a workspace opened through a link, whose files a
    server reports by real path). Everything else, including virtual
    documents, is left out and counted. Lines come from the disk.
  - **Caps.** 100 locations, 200 symbols, 50 callers or callees with five
    call sites each, 4,000 characters of hover, three outline levels; a
    20-second deadline per language-service call.
  - **Rename.** Planned before the card from VS Code's rename edit: every
    file must be placed in the workspace (any outside refuses the whole
    rename), at most 200 files, no file operations, no unsaved changes, and
    the document's text equal to the disk's (BOM aside), so the edit lands
    where the service meant it. On the Model API the card is a `fileWrite`
    naming up to five files and counting the rest, protected when any file
    is (D24); after approval every file is confined and read again and
    nothing is written unless each is unchanged; files are written with the
    tools' atomic write, one patch across them (per-line hunks, which Edit
    Review's revert undoes), and the fingerprints `write_file` checks are
    updated. A failed write stops the rest and names what was written.
    Plan refuses a rename before the language service is asked. On `ide`
    the tool returns a unified diff and writes nothing (read-only). The
    file tools' one-hunk patch (D27's `hunkBetween`) moved beside the
    rename's hunks as `changeHunk` in `codeText.ts`, unchanged, so the two
    share one implementation (the duplication gate).
  - **Repo map.** Aider's idea over VS Code's services: names of three
    characters or more are counted in the text of up to 1,000 listed files
    (128 KiB each, read confined); the 300 names used by the most files are
    looked up as workspace symbols, eight at a time, within 10 seconds (5 for
    the prompt); each file scores the uses of its names by other files,
    shared among a name's definers. Document symbols per file were rejected:
    opening every file would make VS Code open each document for every
    extension (a linter lints them all). The prompt section is opt in
    (`museSpark.modelApiRepoMap`, machine-scoped since it bills prompt
    tokens), made on the first turn that has it on and kept for the session
    so the prompt's prefix stays cached (a Stop ends it at once, and a map
    cut short that way is not kept); Muse Code's instructions are its own,
    so there it is the `repoMap` tool only.
  - **Annotations.** `McpTool` gained `annotations` (as M69 adds it);
    `getDiagnostics` and every code intelligence tool declare
    `readOnlyHint: true`, and all are listed in Restricted Mode.
  - **Tests.** `codeIntelTools`, `codeText`, `renamePlan`, `repoMap`,
    `modelApiCodeIntel`, `ideCodeIntelTools`, `languageServices` (the
    adapter over the `vscode` mock) and `toolPresentation`;
    `test/integration/codeIntel.test.ts` over `test/fixtures/workspace/
code-intel` on VS Code stable and 1.125.0; live case19 of the Model
    API sweep; the `code-intel` harness scenario.
  - **Review round (after `c5c4045b`).** Three class reviews; every
    finding fixed in one commit on a merge of `origin/main` (PR #50):
    - A rename's edit ranges must each cover exactly the old name (the
      text the edit at the position replaces, read from the text the
      position came from), and that file must still be that text: an edit
      the service computed on an older version is refused, never applied.
    - File operations: VS Code's `WorkspaceEdit.entries()` lists only text
      edits and `size` counts them (read from the extension hosts of 1.99.0,
      1.125.0 and 1.139.0), so the old check never fired. The adapter reads the
      internal `_allEntries()` through zod (`_type` 2 is a text edit, 1 a
      file operation); a missing or changed list is `unknown`, refused
      (§8 records the undocumented member).
    - Writing: every file is checked again after the card, then each once
      more right before its own write; a change found partway stops with a
      revertable patch of what was written. Stop before the first write
      writes nothing; once writing starts the rest follow. A failed
      `rename_symbol` row with a patch keeps review and rewind
      (`PARTIAL_EDIT_TOOLS`, `hasLandedEdits`).
    - The prompt's repo map: trusted workspaces only; only a map with text
      is kept, a try that fails or comes out empty counts, three at most
      (`REPO_MAP_PROMPT_TRIES`), and a Stop does not count; child tasks and
      forks use the conversation's. `Limits` takes its Stop listener off,
      begins no work past the budget, and holds the file listing to it; the
      map says how many files it read.
    - Unsaved files: a line number in one is refused; lines shown are the
      editor's, and the answer says so.
    - Hover: held back when every definition is outside the workspace and
      outside the languages' libraries (VS Code's `appRoot` and each
      extension's folder, `LanguageServiceHost.libraryRoots`). Types that
      flow from outside files into workspace symbols remain (§9).
    - Hooks: `rename_symbol` matches `Edit`, and a matching `PreToolUse`
      hook gets the planned `files` (planned for it alone, only when one
      would run and the mode allows edits).
    - Wording: "no language service" allows a file that declares nothing;
      an empty answer says the language may lack that provider; the same
      name, a change after the plan, the header's file name. A rename named
      by symbol alone has no file button. The card names protected files
      first.
    - Captures: live case19 again with a stand-in that skips string
      literals (4 references, 4 edits, the import asserted); and Muse Code
      1.4.0-R4302.1 calling `mcp__ide__findReferences` in on-request mode
      (4 model attempts): it listed our tools with annotations, asked its
      own card for a `readOnlyHint` tool, and showed our text verbatim.
      The README's "reads in every mode" is the Model API's alone.
  - **Second review (Grok Build on `585af100`).** One P1, five P2; all
    held on inspection and are fixed in one commit:
    - Unsaved changes by real path: `ToolIo.unsavedFiles()` lists the
      editors' files, and `unsavedDocumentPath` matches one to a file by its
      own path, the service's, or its real path (a workspace opened through
      a link names files by the link in the editor and by the real path in
      the language service). The plan, the recheck before each write, the
      lines shown and the target all use it; a target is asked and read at
      the editor's own path.
    - Repo map: a batch the time or a Stop cuts off is dropped whole, so
      nothing it finds later reaches the map or its counts; "no language
      service" only when every lookup ran and none found anything, a cut
      map being partial.
    - A rename planned for its `PreToolUse` hooks is the plan written; a
      hook's new arguments plan afresh.
    - Call hierarchy: outgoing call sites name the file of the function
      asked about; of several items at a position the one declared there is
      asked, and the answer counts the others.
  - **Codex on PR #57.** Two P2s, both held and fixed in one commit:
    - The repo map counts every line it renders against its budget (the
      lead, the count of files left out, the notes, and the prompt
      section's heading); `repo_map` refuses a `max_tokens` too small for
      its own fixed text and names the size that would do.
    - `document_symbols` opens and outlines the file at the path of an
      editor holding unsaved changes to it (`openAsEdited`), as the other
      tools do; no other tool opened a named file directly.
- **Status.** Built on `feature/m67-code-intel` (2026-09-28); reviewed and
  fixed the same day. Drills and the live checks in
  `docs/certification/m67.md`.

## M68 — Verify loop (D49)

**Resume integration, 2026-09-29 (source preparation only).** Join M68 and
its reviewed workspace-edit repair onto main `f7db5715` (M79 and PR51 included), preserving
the M67/M69 tools, required MCP cancellation signals, unsaved-file access,
ACP key isolation and the VS Code 1.99/Node 20.18 floor. Move the existing
workspace-edit registry unchanged to a core structural-observer module;
the backend manager owns and injects it before a lazy host can start, so
pending writes reach new conversations and children without loading the
lazy verify ledger in activation or ACP. The ACP runtime shares registries
by an existing canonical directory's native bigint device/inode identity,
refusing unreadable, non-directory or unusable identities. Bind actual tool
and context paths to the immutable canonical root, keep the raw cwd only for
saved-session identity, and fence the raw and canonical roots' captured native
identity before mutations, commands and final publications after awaited
staging. Cached aliases never silently rebind after retargeting. Native alias,
retargeting, directory replacement and distinct-directory
controls remain unverified until the Windows, macOS and Linux rig slot.
Rename begins notices for every
planned canonical/alias path before rechecks, records only successful
writes in the originating session, and completes all notices in finally.
Keep the current first-write Stop guard. M79's plan publication brackets each
checked create attempt with shared notices, records only a true new-file result
in its captured live Model API owner, and always completes in finally. A changed
conversation never becomes the saved plan's invented owner. Preserve M79's
owned-stage cleanup with M68's conditional writer. M77's winner-apply binding
remains a later integration seam. No verifier or certification claim is made
during preparation. The frozen behavior tree `1c3dbea9` has current host,
unit, e2e and webview types, scoped lint and the normal duplication gate all
at exit 0. Fifty-two bounded acceptance tests passed before and after 16
deliberate production failures; every mutated source hash restored exactly.
Fifteen failures reached intended assertions, and the lazy-injection failure
reached its exact subscription-contract TypeError, labeled separately.
The host API inventory regenerated successfully. Full exact-tree quality,
independent staged review, installed ACP/VS Code and native rig controls
remain required; this evidence makes no live-model or full-rig claim.

- **Goal.** Every edit is checked, and the model sees the result without
  asking.
- **Scope.**
  - After a tool round that edited files, the next request carries the
    new diagnostics of those files: errors and warnings, capped, with
    changes against the previous round.
  - An optional **format on edit** runs VS Code's formatter on edited
    files.
  - **Check commands**: `museSpark.checkCommands` (lint, test,
    typecheck), machine-scoped, run as the shell tool runs commands (in a
    job object on Windows, M27; there is no sandbox on the Model API).
    - They run **automatically once after every tool round that edited
      files**, before the next request, and their results go into it.
    - The model can edit what a check runs (`package.json` scripts, a
      config), so an automatic check takes the shell tool's permission
      path: it asks in every mode that asks for a shell command, which is
      every mode but Bypass today, and "always allow in this session" works
      as it does for that command. Plan and Restricted Mode never run
      them.
    - Each can scope itself to the changed files: the paths go as separate
      arguments after `--`, and a path starting with `-` is refused. A
      time cap bounds the run.
    - The model can also call `run_checks` itself.
  - A `then_run` option on `write_file`/`edit_file` (SoL-Pi's Action
    Fusion). The command goes through the shell permission path. Format
    on edit runs first, then the hash is taken, and the guard skips the
    command only if the file changed after that.
  - A bounded fix loop: at most N rounds while checks fail, then it stops
    and says so.
- **Backends.**
  - Model API: all of it.
  - Muse Code: diagnostics through `mcp__ide__getDiagnostics`, which
    already exists. The guidance to verify is sent as model text in the
    turn (`MODEL_TEXT`); the template AGENTS.md stays `muse init`'s
    (M12), and no skill is installed into Muse Code's folders (D13).
  - Automatic checks after Muse Code's own edits would need an MSP event;
    that is asked upstream.
- **Acceptance.** Check commands and `then_run` never run in Plan or
  Restricted Mode, and never run unapproved where a shell command would
  ask. `then_run` shows in the row as one call with two results.
  - **Workspace edit review, 2026-09-29:** before an approved `write_file`
    or `edit_file` can write or format, notify every live Model API session
    in this workspace, including parents, children and siblings. Pending
    names must lapse the verify loop's grants even during a new message;
    checks over pending writes cannot count as current. Completion or
    failure releases the pending state and invalidates runs that started
    during the write. New sessions join active notices; disposed sessions
    leave them. Keep each session's successful-edit diagnostics and fix
    loop separate, and preserve the shell tool's rules (Q12). Reuse
    `ModelApiHost`'s session lifetime and `VerifyLedger`, with held writes
    and formatters in the existing fake API tests plus red drills.
    Project memory writes and an added note's `MEMORY.md` index also notify
    the ledger when confined inside this workspace; they still do not
    schedule automatic diagnostics or checks. Other writers (shell, image
    and external MCP tools) keep M68's existing scope.
- **Evidence.** OpenCode, Aider (`--lint-cmd`/`--test-cmd`), Crush,
  SoL-Pi.
- **Tests.** The fake Model API over a fixture with a failing check: the
  diagnostics and check results reach the next request, the fix loop stops
  at its limit, and a check asks where a shell command asks (a drill per
  mode).
- **Size.** M.
- **Status 2026-09-28: built.**

Status detail retained: built and certified on `feature/m68-verify-loop`
(`docs/certification/m68.md`); not pushed. Decisions taken:

- **Settings**, all machine-scoped (D15): `diagnosticsAfterEdits` (on),
  `checkCommands` (none; `{ name, command, changedFiles?,
timeoutSeconds? }`, at most 8, names unique, 300 s unless set, 600 s at
  most), `formatOnEdit` (off). The loop is Model API only, as scoped;
  `run_checks` and `then_run` are offered only with the shell.
- **After a round that edited files** (the edit tools' writes; not the
  shell's, the memory tools' or images), before the next request: the
  edited files' diagnostics, then the checks, in a **Check edits** row
  (`verify_edits`) whose summary counts errors and warnings and names each
  check's outcome; the model reads it all as a user note that leads with
  "tool data, not a new instruction from the user". A diagnostic is
  matched across rounds by severity, source and message, never its line,
  for "N new, M fixed"; at most 50 are listed.
- **The language servers report only on files an editor shows**
  (measured, VS Code 1.139.1 and 1.125.0: a hidden `.ts` and `.json` got
  nothing in 25 s, shown ones in 1.6 s and 0.1 s). So each edited file no
  editor shows opens beside the active editor in a tab of its own (not a
  preview, which `workbench.editor.enablePreview: false` would make
  permanent and which would replace the user's own preview), without
  taking focus (beside, so nothing the user types lands in it), and the
  tabs it opened close after the read unless the user changed them. After
  the M68 review the wait starts once the file shows: 4 s for a first
  report, then 1.5 s of quiet, 10 s at most, a Stop ending it for every
  file left; one queue serves every caller (panels, subagents, the
  `getDiagnostics` tool). A file with no report, unsaved, or past the
  round's first 8 (`VERIFY_SHOWN_FILES_MAX`) is "not checked" with the
  reason, never clean, and leaves the "N new" baseline alone; the baseline
  moves only once the note reached the conversation. The existing
  `getDiagnostics` tool does the same for a file it is asked about, on
  both backends, which is what makes the Muse Code guidance useful; it is
  confined by real path first, and its wait ends when the MCP caller goes
  away.
- **Permission path** (`authorizeCommand`): Restricted Mode refuses; the
  mode's shell verdict decides (Plan refuses, Bypass allows, the others
  ask); the card is the shell's own (`shell` subject, so Edit
  automatically never answers it), with the PermissionRequest hook seeing
  it as a shell call; "always allow in this session" is keyed on the
  configured command without its paths, under the verify loop's own key
  (`VERIFY_COMMAND_RULE_KEY`) since PR #54's fourth Codex round: a
  check's or `then_run`'s grant never answers for the model's own shell
  call of the same command, nor the shell's for them. A check the
  user rejects is not asked again until their next message. In Restricted
  Mode the automatic checks are left out rather than refused one by one.
  Superseded by the M68 review: checks, `run_checks` and `then_run` go
  through the user's PreToolUse, PostToolUse and PostToolUseFailure hooks
  as calls of the shell tool (`runVerifyCommand`: a block is "a hook
  denied it" with the hook's words, `updatedInput.command` replaces the
  line and the rule key, a demanded question asks even in Bypass, a
  PostToolUse context or reason follows the output, and `continue: false`
  ends the turn); a PermissionRequest hook's denial is told apart from the
  user's Reject, whose feedback is kept. The session rule stays keyed on
  the configured command, which is safe because a path can no longer
  inject (below), but it does not answer after the conversation, since
  the user's message, edited a file that decides what the command runs
  (`canChangeWhatRuns`: `COMMAND_DEFINING_FILES`, code-loading files, a
  file whose path occurs in the command's text or a plain word of it
  names, or, since PR #54's fourth Codex round, any edited file when the
  command holds shell syntax that makes its words uncertain: quotes,
  escapes, variables, substitutions, globs, operators). The judgement is
  made on the command the rule is keyed on, a hook's rewrite included.
- **Paths reaching a check** (the M68 review, P1): only edited files that
  exist, or `run_checks` paths that exist in the workspace; a leading `-`
  or `@`, or a control character, refuses the check, and on Windows so do
  `"`, `&`, `|`, `<`, `>`, `^`, `%` and `!` (`WINDOWS_ARGUMENT_SYNTAX`):
  measured, Windows PowerShell 5.1 passed `["a\"","b --inject"]` to
  node.exe as `a b`, `--inject`, and a `.cmd` ran `x&echo.INJECTED` as a
  second command, expanded `%OS%` and dropped `^`, while spaces, both
  quotes, `$`, `;`, `,`, `=`, parentheses, braces and non-ASCII passed
  intact through both.
- **Code the editor runs** (the M68 review): a linter's or formatter's
  JavaScript config, `package.json`, `node_modules`
  (`CODE_LOADING_FILE_PATTERNS`) is never shown or formatted, and once the
  conversation writes one nothing more is shown or formatted until the
  user's next message ("not checked" with the reason).
- **One budget**: the verify note, diagnostics and every check together,
  is at most `VERIFY_NOTE_MAX_CHARS` (64,000), shared equally; so is a
  `run_checks` result. A check the model ran since the round's last edit
  (`run_checks` over the edits, or a `then_run` of its own command) is not
  run again after the round, and nothing runs after the turn's last round.
- **The fix loop**: `CHECK_FIX_MAX_ROUNDS` (3) failing verdicts in a row
  stop the checks until the user's next message. Since PR #54's third
  review the state is one `VerifyLedger` per session: every check that
  ran is recorded against the file state it ran on, a round is judged
  when a run since the previous verdict is current, and it passes only
  when no current run of any check failed. A user's message, once
  admitted, resets it all; a steered message resets the count, the
  rejections and the runs, but not what the conversation wrote; a goal's
  wake, and a parent model's message to a subagent, reset nothing.
  `run_checks` honours the stop and the rejections too. The model is told
  to stop fixing and say what still fails; the panel shows a warning. The
  diagnostics go on.
- **`then_run`** (SoL-Pi's Action Fusion, reimplemented from its public
  description, no code ported, so the notices generator is unchanged and
  M73 stays the first milestone that may port): after the edit (and its
  format), the command takes the permission path above (a hook's forced
  question carries over), then runs only if the file's SHA-256 still
  equals the fingerprint the edit left; else "not run: the file changed".
  The row keeps the edit's diff and adds a **Then ran** block (command,
  output, exit or reason). A Stop at its card keeps the edit's result and
  diff. The shell's default 120 s cap applies.
- **Format on edit**: `vscode.executeFormatDocumentProvider` over the
  document once it shows what the tool wrote (2 s to catch up, else
  skipped), within 5 s; edits applied to the written text (BOM kept, the
  file's CRLF kept), written back by the tool, the patch and fingerprint
  taken after. A formatter that fails or overlaps leaves the edit as
  written and is logged; so does a write-back that fails (the M68 review),
  and a formatter that does not answer in time is logged too.
- **Muse Code**: a second `<harness_note>` with each message, from
  `MODEL_TEXT`: call `mcp__ide__getDiagnostics` on each edited file (only
  when the session got the `ide` server) and fix what the edit broke, and
  run the named check commands (named only in a trusted workspace). The template AGENTS.md is unchanged; no skill is
  installed. Automatic checks after Muse Code's own edits need an MSP
  event ("a turn's edits finished", or an edit completion hook), still to
  be asked of Meta upstream: the owner's to file.
- **Evidence**: 27 unit tests over the fake Model API (a fixture whose
  lint fails), 11 over the editor adapter, an integration test inside VS
  Code 1.139.1 and 1.125.0 (TypeScript and JSON diagnostics, the JSON
  formatter), a harness scenario `verify`, 26 red drills, and a live case
  (case19: 3 requests a run, two runs, contributor model, `then_run` used
  and passed, the check note accepted by Meta). After the M68 review (one
  pass over three reviewers' 2 P1 and 18 P2 findings, 16 of them
  distinct): 47 loop tests, 18 editor tests, 12 check-command tests (two
  real round trips through Windows PowerShell 5.1, one into a `.cmd`), the
  harness scenario fixed and reshot, 40 red drills, and the integration
  test rerun on both versions. That run caught a regression the tab
  cleanup made: the JSON server clears a file's diagnostics when its tab
  closes, so `settleFile` now returns what it read while the file showed
  and the diagnostics tool answers with that. Codex's review of PR #54
  added four, fixed with drills R41 to R46: a hook's stop ends the
  remaining checks; a queued editor caller stops while it waits; an
  already shown file's report since the write, or a shown document that
  holds the disk text, counts; `run_checks` rounds without edits count for
  the fix loop. Its second round added three, closed as a class: every act on
  a file after an await uses the confined real path and canonical name
  and checks the file (its real path, and what the edit left) just
  before; a reused background tab keeps its preview state and the tab
  that was in front comes back (drills R47 to R56). Its third round
  (four findings) was answered by a redesign: one conditional write in
  `fsAtomic` for every verify-loop writer, and one `VerifyLedger` per
  session that records each check against the file state it ran on,
  judges a round only by runs on the latest state, and resets on any
  admitted user input, queued or steered (drills R57 to R68).
- **Open for the owner**: the side editor group, the upstream MSP ask, and
  the `diagnosticsAfterEdits` default (on).

## M69 — Web fetch (D49; folds in M44b)

- **Goal.** The model reads a page it found or was given.
- **Scope.**
  - The `web_fetch` tool, with M44b's network-safety rules:
    - HTTPS only;
    - public addresses only: loopback, private, link-local, IPv6
      unique-local, carrier-grade NAT (100.64.0.0/10), IPv4-mapped and
      other reserved addresses are refused;
    - the name is resolved and checked locally, and the connection goes to
      that pinned address, also through a proxy (CONNECT to the address,
      with the host name for TLS); where the proxy cannot take a pinned
      address, the fetch stops with that reason;
    - a small redirect limit, each hop checked and pinned like the first;
    - a size cap, a time limit, a content-type allowlist, HTML converted
      to Markdown, and the text marked as untrusted content.
  - It asks per host in every mode but Bypass, since the URL itself can
    carry data out. It is off in Restricted Mode.
  - Through VS Code's proxy and certificates (M56).
  - No billing: the fetch is the extension's own. It is not Meta's paid
    search.
- **Backends.**
  - Model API: native.
  - Muse Code: `mcp__ide__webFetch`, since Muse Code's own `web_fetch`
    is switched off. It follows D49's rule for network tools on `ide`.
- **Acceptance** (M44b's): tests and a red drill for each rule above,
  including a name that resolves to a private address, a redirect into
  one, and a proxy that cannot take a pinned address; a harness scenario
  for its row; the gate green; a certification record.
- **Size.** S.
- **Status 2026-09-29: built.**

Status detail retained: built on `feature/m69-web-fetch`, PR #52 open
(`docs/certification/m69.md`); the resumed picture repair passes focused
tests and red drills; final review and integration gates are pending.
Integration retains M67's separate language services, binds the existing
web fetcher to the standalone ACP Model API runtime, and ships its converter
worker/notices. Independent review found missing permission checks on later
address attempts and the Node 24.0–24.4 HTTPS proxy warning gap; both have
focused regressions and intended red/restored proofs. The standalone transport
remains Node's, without automatic proxy rerouting or VS Code settings.
Built to M44b's safeguards
and the plan review's six rules:

- **Destinations** (`src/core/web/publicAddress.ts`, `pageUrl.ts`):
  `https:` only, no credentials, 2,048 characters at most; local and
  reserved names (`localhost`, `local`, `internal`, `home.arpa`, `test`,
  `invalid`, `example`, `onion`, `alt`, and any single-label name) refused
  before any lookup. IPv4 is public outside IANA's special-purpose blocks
  and Azure's WireServer (so 169.254.169.254, 100.100.100.200 and
  192.0.0.192 are refused); IPv6 only inside 2000::/3 and outside
  2001::/23, 2001:db8::/32 and 3fff::/20, with IPv4-mapped, -compatible,
  NAT64 and 6to4 judged by the IPv4 inside. Every DNS answer is checked:
  one non-public answer refuses the name.
- **Pinning** (`src/host/web/pinnedRequest.ts`): Node's `https` connects
  to the checked address, with `servername` and `Host` carrying the name,
  so TLS still verifies it. VS Code's patched `fetch` cannot pin (it
  replaces a caller's dispatcher with its own agent, keeping only CA and
  HTTP/2 options: @vscode/proxy-agent `createFetchPatch`, read
  2026-09-27); its patched `https` can, and does so through the proxy:
  the integration test shows a loopback proxy receiving
  `CONNECT 203.0.113.7:443` and a ClientHello naming the host, on VS Code
  1.139.1 and 1.125.0. Only an answer that arrived over TLS is read: a proxy's
  own refusal of the tunnel is reported as `Proxy response (N)`, M56's
  proxy failure, never read as the page. The checked addresses are raced
  in the resolver's order (ADDRCONFIG) as RFC 8305 says, never
  re-resolved.
- **Redirects**: same host (host and port) followed, each hop checked,
  resolved and pinned again, at most `WEB_FETCH_MAX_REDIRECTS` (5); a
  redirect to another host is handed back to the model as a URL to fetch
  in a new call, so each host is approved on its own; into a refused URL
  it fails naming the redirect.
- **Bounds**: 5 MiB after decompression (gzip, deflate, br; another
  coding refused), declared or streamed; 30 s for the whole fetch; an
  allow-list of text types; the header's charset, else HTML's `<meta>`,
  else UTF-8. HTML becomes Markdown in one linear pass
  (`htmlToMarkdown.ts`, with `entities` for character references, the
  one new dependency, D3); inline nesting, list and quote indents and
  table width are capped so a hostile page stays linear. The model reads
  the first 50,000 characters and is told the total.
- **Approvals**: a new `network` tool class. Bypass allows, Plan
  (`denyUnmatched`) refuses (its rules allow workspace reads, not network
  reads), Manual, Edit automatically and Auto ask, per host: the card
  (`webFetch` subject) names the URL as it will be fetched, and "Always
  allow in this session" is keyed on the host. Restricted Mode: not
  offered, refused if called; a side chat (always Plan) is not offered
  it. A URL refused on its face (scheme, credentials, length, a reserved
  name, a non-public literal address) is refused before any card; a name
  is resolved only after approval, since the lookup itself carries the
  name out, so one that resolves to a private address is refused after
  the card and before any connection.
- **Untrusted content**: the model's text is the header line, a notice
  that the page is untrusted data, and the content between markers with
  8 random bytes the page cannot know; the instructions say the same.
- **Muse Code**: `webFetch` on the `ide` server, listed only while the
  workspace is trusted and `museSpark.sandboxNetwork` is not
  `restricted` (the list is read per request), with MCP annotations
  `readOnlyHint: false, openWorldHint: true`, and the extension's own
  modal (Allow once / Reject, naming host and URL) before every call,
  whatever Muse Code's mode. Live (4 model attempts, contributor model,
  empty folder): Muse Code listed and called it, asked its own approval in
  on-request mode, and passed our text through verbatim as the row's
  output, which the row's size line reads (AGENTS rule 13).
- **Row**: the URL beside the label, "Fetched 48.2 kB (text/html)" under
  it, and what the model read in the body; harness scenario `web-fetch`.
- **Review round** (three class reviewers over `c3d7702c`, all fixed in
  one commit): the `ide` call gets an `AbortSignal` aborted when Muse Code
  closes the request or sends `notifications/cancelled` (both captured
  from Muse Code 1.4.0 on a stopped turn, 2 model attempts), raced against
  the modal, with `isOffered` checked again after it and one modal per URL
  at a time; the checked addresses are raced as RFC 8305 says (250 ms);
  connection failures in web fetch's own words naming the host and the
  addresses (not M56's Meta advice), a proxy's refusal of the tunnel
  included, the detail only as error codes (a name mismatch's message
  lists the certificate's names); server text outside the markers only as short tokens, the
  final URL, the title and a moved target inside them; the converter
  bounded at 100,000 characters (prefix depth 4, rows unpadded); all
  trailing dots stripped and empty labels refused; RFC 7050 NAT64 prefix
  discovery; damaged compression is the coding's failure; the charset only
  from `<meta>`, an unknown label ignored; sentences name "this tool";
  Model API rows localized for a moved page and Restricted Mode;
  `sandboxNetwork` described in fifteen manifest tables. PAC and
  `http.noProxy` see the pinned address, not the name (@vscode/proxy-agent
  0.45.0 `agent.js` builds the proxy URL from `opts.host`): kept, since the
  name would let the proxy resolve it again; documented.
- **PR #52 review** (Codex): NAT64 discovery fails closed (only a
  definite "no AAAA" from the page's own resolver means no DNS64; a
  timeout, SERVFAIL or an answer without a prefix leaves it unknown, and
  then no IPv6 answer is used, a name with only IPv6 answers refused as
  `nat64Unknown`); a `PermissionRequest` hook's allow no longer replaces
  the per-host card (it may still deny or ask). Swept: every other failed
  lookup or check already refuses.
- **PR #52 second review** (Codex): what allowed a fetch is asked again
  after every await: after the card or hook (the turn, trust, a mode that
  now refuses), before each hop's lookup and connection (a caller's
  `isStillAllowed`, ending the fetch as `withdrawn`), and once the page is
  in, before the model gets it; on Muse Code the offer (trust,
  `sandboxNetwork`) is that check.
- **PR #52 third review** (Codex): NAT64 absence is proven only by a DNS
  query's own NXDOMAIN or NODATA (c-ares), while the system resolver's
  answers still reveal a prefix; the converter hides an element a page
  left open (`<p hidden>`, `<li aria-hidden>`, cells, rows) up to where a
  browser ends it, tracking what is open inside and around it, and, from
  the sweep, a hidden image's alt text, a self-closed hidden element, an
  unopened dialog, ruby's `rp` and `datalist`.
- **PR #52 fourth review** (Codex, a self-closed `<template/>` shown):
  the converter's hiding now follows the WHATWG parsing algorithm as a
  whole: one stack of open elements with the algorithm's scopes, special
  and formatting elements, implied ends, the adoption agency (a hidden
  formatting element reopens until its own end tag), `</form>`, foreign
  content (breakouts, integration points, CDATA), select, tables,
  headings and `<body>` attribute merging; the tokenizer ends comments
  (`<!-->`, `--!>`), bogus comments (`</ x>`), CDATA and script escapes as
  HTML does, honours a slash only right before `>` and only on void and
  foreign elements, and keeps attribute names that begin with `=`.
  parse5 8.0.1 (MIT, already in the tree through jsdom) was measured and
  not adopted: quadratic on hostile nesting (40,000 nested `<div>` in 25 s,
  40,000 nested lists in 73 s, where the converter takes 34 and 127 ms), so
  a 5 MiB page could hold the extension host for hours; no dependency
  changes.
- **Redesign after the fifth review** (Codex: `<base href>` ignored, the
  charset sniff reading `<meta>` text in comments and other attributes,
  `display:/**/none` passing the hidden check; the fourth round on the
  hand-written path, so the owner's rule applied: redesign, not patch).
  The page is parsed by parse5, decoded by html-encoding-sniffer (the
  standard's sniffing) and Node's `TextDecoder`, and its inline styles
  read by @csstools/css-tokenizer (D3); the converter walks the tree,
  leaving out exactly what HTML hides, and resolves links against the
  first `<base href>`. parse5's time on hostile nesting is contained by
  running it on a worker of its own bundle, `dist/pageWorker.js` (D6), one
  per page (never at activation; the bundle-split gate checks it), at most
  two at once, stopped at 10 s or 512 MiB, which refuses the page with the
  reason.
- **Redesign review** (two class reviewers): the sniffer's crash on a
  malformed `<meta>` content read past; `replacement` encodings read as one
  U+FFFD; XHTML sniffed as XML; a later `<meta>` changes a tentative
  encoding (the standard's reparse); the header's charset read as a MIME
  parameter; at most two conversion workers at once, the wait honouring
  the fetch's signal; a deadline passing during conversion named as the
  conversion's; failure details as short codes, crashes logged by name,
  code and frames; `popover`, closed `<details>` and declarative shadow
  roots read as they render; inline `display` by its real grammar, a
  bracket stack, and a `var()` on a hiding property counted as hiding;
  the `.vsix` check and an integration test for `dist/pageWorker.js`.
  Grok Build's review of the same diff added: the title only from the first
  `<title>` child of `<head>` (one the parser put inside a hidden element
  no longer reaches the model), and an encoding the runtime cannot decode
  refuses the page (`undecodable`) instead of reading it as UTF-8, with
  `x-user-defined` and `replacement` decoded by the Encoding standard's own
  definitions (Node 20.18 has no decoder for the first, no Node for the
  second).
- **PR #52 review of `19f843f3`** (Codex): XHTML is refused
  (`application/xhtml+xml` read by an HTML parser misreads its XML syntax,
  `<script src="x"/>` swallowing what follows, and no XML parser is
  bundled; it is no longer in the Accept header either); `visibility` is
  inherited, so the walk carries it down instead of dropping the subtree:
  a descendant with `visibility: visible` shows, an invisible element keeps
  its tags (a shown item stays in its list) but writes no text or void
  element. Swept: `display: none`, `content-visibility: hidden`, `hidden`,
  `inert`, `aria-hidden`, `popover`, a closed dialog or `<details>` hide
  all they hold, which no descendant can undo; `visibility` was the only
  inherited one.
- **PR #52 review of `83eedf26`** (Codex: a `<col>` styled
  `visibility: collapse` hides a column whose cells are not its
  descendants; the third round on the converter's hiding, so the owner's
  rule applied: redesign, not patch): the converter no longer emulates
  rendering. It cannot do so completely (a stylesheet, a class, a `<col>`,
  a script, a font or a colour can hide text), and the attempt protects
  nothing, since a page can put the same words in visible small print; the
  defence is the untrusted markers around everything a page returns. Left
  out now is only what is never page text by structure: the head (the
  title is read from it), scripts, styles, template content (a declarative
  shadow root's is written where it stands), `<noscript>`, embedded frames
  and media, form controls, SVG and MathML. `hidden`, `inert`,
  `aria-hidden`, `popover`, closed dialogs and `<details>`, `rp` and
  inline styles are no longer read, for one consistent rule. The result is
  the page's text as served, which can include text a browser would not
  show, all of it marked untrusted, and the tool description and the
  notice before the markers say so. `inlineStyle.ts` and
  @csstools/css-tokenizer (D3) are removed; the worker bundle is
  201.2 KiB. This supersedes the earlier bullets' hiding.
- **PR #52 resume repair (2026-09-29, focused verification complete)**: traverse
  `<picture>` so its fallback `<img>` keeps the existing safe-source and
  nonempty-alt rules. `<source>` contributes no image or attributes;
  no `srcset`, media-query or browser rendering selection is emulated.
  Regression coverage must keep document order, relative fallback URLs
  and alt text, refuse unsafe or wordless images, and still exclude
  images inside inert templates and embedded media. Reuse the converter
  and its unit suite, with a red drill restoring `picture` to `OMITTED`
  in a disposable copy. Final reviewed-tree quality remains required.
- **Left**: a machine-scoped switch to turn web fetch off entirely,
  whether Muse Code's "Always allow this MCP tool" should also silence the
  extension's own modal, and whether Plan should allow fetches as reads,
  are the owner's (§3 is untouched until asked).

## M70 — Review (D49)

**Status 2026-10-02: built.** Status evidence: `docs/certification/m70.md`.

- **Main reconciliation (MG69, 2026-10-02).** Finish the inherited merge of
  `origin/main` `0e9546e0` into `544c16c2`, preserving M70 review/Revert,
  M84 session transfer and M83 imports, including both lazy bundles and
  checkpoint edit tests. Regenerate the host API record and notices from
  merged source on Kubuntu. Keep Unreleased milestones under Added and
  released changelog sections byte-identical to main. Run required owning
  suites, static gates and build on the rig; commit with configured hooks,
  no push. Evidence: `docs/certification/mg69.md`. Full quality remains
  the lead's gate under the lane brief.
- **Second main reconciliation (M70m2, 2026-10-02).** Complete the inherited
  merge of `e66263f1` (M73 packing, M74 handoff and the charset repair) into
  `c48bf6bd`, keeping both features' commands, turn admission and source.
  The handoff waits for the review pane as for the other modals. Reviewer
  requests retain whole observations because its existing read-only tool
  set has no `recall_output`; ordinary requests still pack. Keep packing's
  model text in the existing lazy Model API block. Run the owning suites
  and static gates on Kubuntu, regenerate the host API record there, and
  retain released changelog sections byte-for-byte from `origin/main`.
  No push; configured hooks and all gates remain unchanged. Evidence goes
  in `docs/certification/m70m2.md`.
- **Main reconciliation (M70m, 2026-10-02).** Finish the inherited merge of
  `9f35526d` in `4debea77`, merge `origin/main` `2a03a79b` (0.10.1) in
  `90c1a0c4`, then include the newer docs-audit head `2067d2f9` (PR #74).
  Keep the review/Revert implementation and main's session transfer and
  evaluation intact, including all tests and harness scenarios; regenerate
  the host API record on Kubuntu. Focused rig proof and the browser capture
  limitation are recorded in `docs/certification/m70m.md`. Full quality and
  PR acceptance remain the lead's gates, as the lane brief requires.
- **Revert restructured (M70e, RV69, 2026-10-02).** The fourth review round
  on Revert ends the patching: the lead's decision is one operation under
  checkpoint admission, in order: take the lease, read the saved bytes,
  rebuild from those bytes, re-resolve the canonical target inside the
  workspace, check no editor is dirty, then publish only while the file
  still holds those bytes, through the guarded conditional writes the
  model's tools use (`ToolIo.writeFileIfUnchanged`; a created file's trash
  through `fsAtomic.deleteFileIfUnchanged`, which compares the bytes, the
  canonical path and the file's identity just before the removal; a file
  absent when read through the absence-conditional write a restore uses),
  then let the lease go. No raw `workspace.fs` write or delete is left in
  Revert; `createRevertIo` notes the file as the user's only once a change
  lands. (1) A save during admission is now read and rebuilt from; one after
  the read refuses the publication. (2) A folder swapped for a link during
  admission is refused by the re-resolve, and after it by the writers'
  bound-path checks. (3) A `/review` start barrier belongs to the
  conversation generation that set it: `dropSession` drops it and an old
  `finally` never clears a newer one. (4) A Revert that changed the file
  stays reverted (and its once-only hold kept) when the lease release fails
  afterwards; the failure is logged, as a turn's failed release is (no
  user-visible notice exists for it). Proof in `docs/certification/m70.md`.
- **Independent review follow-up (M70d, 2026-10-01).** Four code-reading
  findings, each confirmed before repair, after merging main's shared
  English table (PR #67). (1) The changed-file list carried git's
  `--name-status` lines; it now holds paths (a rename as `old → new`) read
  from `-z` output, which also keeps git's quoting out of the privacy
  check. (2) The cut never mid-line in practice (git's diff opens with a
  short line), but a line break exactly at the cap kept 200,001
  characters; the cut is now within the cap and the docs say how it falls.
  (3) A pane press or read overtaken by a restart, a crash, the host
  closing the session or a sign-in check returned silently: the pane
  waited forever and an unwritten hunk stayed "already reverted". It is
  answered while the panel still shows that conversation, and a press
  releases only its own hold. (4) A revision word over 256 characters
  parsed as git and was refused as "too long"; the parser now applies the
  wire schema itself, so such a word is custom text. Also: the activation
  review-admission fixture lacked M72's `asUserEdit`, so its four cases
  timed out since the main merge. Proof in `docs/certification/m70.md`.
- **Shared-table decision (M70c, 2026-10-01).** Remove the lane's empty-table
  build workaround in its own commit, then merge approved `build/shared-ui-text`
  (`44d920fd`). Every Node bundle loads `dist/uiText.js`; review stays lazy
  with its unchanged 50 KiB cap. No other build-layout change. Build before
  further fixes; stop and report if any cap is exceeded.
- **Independent review follow-up (M70b, 2026-10-01).** Reproduce RV70 findings
  1–5 before fixing: wait for ordinary mode admission; fence late review
  acknowledgements to their submitted session/generation; recheck dirty buffers
  inside checkpoint write/delete admission; omit git metadata from Reviewer
  system instructions; report unreadable pane patches as omitted edits.
  Reuse existing mode settlement, session fences, dirty predicate, date text
  and pane omission path. One commit per finding, guard drills with
  byte-exact SHA-256 restoration. Run the two reported failing suites alone and
  resolve any isolated failures without changing deadlines. No M72 merge this
  round; full quality and installed-editor checks remain the lead's gates.
- **RV70 finding 1 verified (M70c).** Reviews await the existing ordinary
  mode-settlement lane, including refusal. Controller guard drill: 329 green,
  two intended failures, 329 restored with matching SHA-256. Isolated native
  controller fixtures now arrange held admission before the retarget action;
  retained Model API checkpoint test waits for actual admission (331 pass).
  Deadlines and assertions unchanged; proof in `docs/certification/m70.md`.
- **RV70 finding 2 verified (M70c).** Track the submitted session, including
  owned resume recovery, and apply the current session/generation fence after
  acknowledgement before accepting its capture/turn. Clear and retire cases
  fail without the guard; full controller file passes 331 tests after exact
  restoration. M57's real bundle fixture is built in its existing setup hook,
  retaining its deadline and goal-refusal assertions.
- **RV70 finding 3 verified (M70c).** Revert binds its existing
  dirty-buffer predicate to both original and canonical paths and passes it
  to the write/delete adapter. The adapter invokes it after checkpoint
  admission, immediately before I/O. This port argument is needed because
  the adapter receives only the canonical target and cannot otherwise recheck
  a dirty buffer opened through a link. No new option or helper module.
  All four regression cases failed before repair. Predicate/write/delete
  guard drills each restored all 32 owning tests with matching SHA-256.
- **RV70 finding 4 verified (M70c).** Omit git metadata from
  Reviewer system instructions; repository material belongs only in its
  untrusted turn block. Keep the existing date text in a date-only
  `REVIEW_MODEL_TEXT` template: the ordinary environment formatter always
  adds git facts, and passing it undefined git would falsely suggest that
  the repository is absent or unavailable. Ordinary-turn formatting stays.
  Commit-subject regression fails before repair and when system metadata is
  reintroduced; 22 owning tests pass after SHA-256-exact restoration.
- **RV70 finding 5 verified (M70c).** Unreadable descriptions throw the
  existing localized refusal, entering the pane's existing omission path.
  Sole and mixed corrupt patches are counted honestly; the real bundle test
  now requires refusal. Four before/mutated failures, 372 restored owning
  tests, byte-exact SHA-256. No new UI key or parser shape.
- **M70c closure.** All five RV70 findings reproduced, repaired and drilled;
  nine source/compiled guard mutations rejected with exact SHA-256 restoration
  (two shared-table checks; mode wait, session fence, dirty predicate and its
  two I/O callers; system metadata; malformed description). Required static gates/build pass,
  plus passing evidence for all 840 tests in 11 owning files. The combined
  run's native-picker timeout and UI worker startup failure are retained;
  complete material/UI files pass alone after bounded fixture preparation.
  No timeout, threshold, ignore, rule level or name filter changed. Full
  quality, installed-editor/rig certification and the new M72 merge remain
  the lead's work. Detailed receipts in `docs/certification/m70.md`.
- **Goal.** Review what the agent did before it lands.
- **Scope.**
  - `/review` with presets:
    - the uncommitted changes, the branch against its base, one commit, or
      custom instructions;
    - a security preset: injection, secrets, authentication, unsafe APIs.
  - The review runs as a reviewer.
    - On the Model API, M70 builds the built-in **Reviewer** agent itself:
      read-only tools, its own prompt, the security preset. A `/review`
      the user asks for runs as a turn of the conversation itself, with
      the Reviewer's prompt and tools, so it is part of their turn. Run as
      a child (D45) or on its own, it is a paid use (D48).
    - On Muse Code, the review prompt is sent as the turn's text
      (`MODEL_TEXT`); no skill is installed. The diff under review is
      untrusted content, so that turn runs in Plan mode and the previous
      mode comes back after it. Muse Code's Plan mode applies its own allow
      rules, so this review is not claimed strictly read-only (D46).
    - M76 later lets users define agents of their own on the same base.
  - In Restricted Mode, which runs no git, the presets that need git are
    unavailable and say so.
  - Findings become a list with file and line.
  - A **review pane** over the conversation's changes:
    - files and hunks, each hunk accepted or reverted;
    - a comment on a line is sent to the agent as a steer or the next
      message.
- **Backends.** Both. The pane is the extension's own.
- **Acceptance.** On the Model API the Reviewer has no write, shell or
  network tool; a finding opens its file and line; a reverted hunk leaves
  the file as it was; a line comment reaches the agent as a steer; the
  Muse Code review turn runs in Plan mode and the mode comes back.
- **Tests.** The fake Model API and the fake `muse serve`; the pane in the
  harness and the accessibility gate.
- **Size.** L.
- **As built** (`feature/m70-review`; written 2026-09-28, resumed and joined
  to the M72 candidate `1fd98aaf` on 2026-09-30; `docs/certification/m70.md`).
  - **`/review` grammar.** `/review` (uncommitted), `/review branch [base]`,
    `/review commit [revision]`, `/review <text>` (custom, no git), each
    with an optional leading `security`. A keyword counts only with at most
    one revision word after it, so `/review branch naming in utils` is
    custom text. A revision is one word of at most 256 characters that
    never starts with `-`: the parser applies the wire schema itself, so any
    other word there makes the line custom text, and a leading `-` is
    refused again before git sees it. The palette's Review
    group has the presets, **Security review** (`/security-review`, Claude
    Code's name) and the pane (`/changes`); a missing base or commit is
    picked in a quick pick, the base suggested from `origin/HEAD`, else
    `main` or `master`.
  - **The material** comes from the extension's own git
    (`src/core/review/reviewMaterial.ts`, `src/host/review/reviewCollector.ts`)
    run as the prompt's git facts run: `GIT_METADATA_OPTIONS` (no fsmonitor
    hook, disabled with an empty value because Git 2.25 and 2.35 read
    `false` as a hook pathname; no signature program; `--no-replace-objects`,
    so a replace ref cannot show other commits than history holds), every
    configured clean and process filter overridden for the call (names read
    with the shared `gitFilterOptions`, never commands; the working-tree
    diff compares saved text), `--no-ext-diff`, `--no-textconv` and
    `--relative`. It covers the uncommitted changes against `HEAD` (staged,
    then unstaged, before a first commit), a branch from its merge base, and
    one commit against its first parent (a root commit whole). Files that
    may hold secrets (M54's attachment rule, now `shared/privateFiles.ts`)
    are left out of every diff by pathspec and only named. The changed files
    are listed by path (a rename as `old → new`), read from git's `-z`
    output so no path arrives quoted. The diff is cut after its last whole
    line within 200,000 characters (git's diff opens with a short
    `diff --git` line, so one always fits), and the reviewer is told so.
    Everything git said, the branch name and commit message included, goes
    between random markers under a sentence that calls it untrusted data
    (D49's untrusted content); a marker the material already holds is
    replaced, three tries. Restricted Mode refuses the git presets with the
    reason; custom instructions still run.
    The branch scope's base and merge-base facts also live inside those
    markers: a base chosen from git's picker is repository data too.
  - **A request owns its folder.** Each git request is bound to the
    folder's canonical path and its device and inode
    (`src/host/workspaceIdentity.ts`, shared with the ACP agent's Model API
    hosts): git runs only at that canonical cwd, the lexical and canonical
    path are compared before and after every call, after a picker and
    before the material is released, and trust is re-read each time. A link
    or junction retargeted, or a directory replaced, cancels the request;
    once lost it stays lost. The last synchronous comparison before the
    turn is sent does not exclude an unrelated replacement after it (the
    residual every path-then-act check has).
  - **The Model API's Reviewer** (`reviewer.ts`) is the conversation's own
    turn run with its prompt (role, workspace, environment, the review
    method, the workspace rules) and only `read_file`, `search`,
    `list_files` and `mcp__ide__getDiagnostics`: no write, shell, memory,
    MCP, subagent, image or web search, and a call to anything else is
    refused in every mode, Bypass included. It performs no additional external MCP startup
    during the review turn and is not stopped by an unavailable server;
    configured servers can still start when the conversation opens; the next ordinary turn
    keeps its required-server check. No payment is asked: it is the user's
    own turn (D49). A child task whose role is `reviewer` runs the same way
    and stays a paid child task (D45, D48); one that names an M76 custom
    agent runs as that agent, whose own prompt, tools and mode govern it.
  - **Muse Code** gets the same text with the role and the method at its
    head, as the turn's text (`REVIEW_MODEL_TEXT`), no skill. The turn runs
    in Plan mode (`denyUnmatched`) and `PlanModeHold` puts the user's mode
    back when that turn ends. Muse Code applies its own allow rules in Plan
    mode, so the review is not claimed strictly read-only (D46; the owner's
    ruling). The mode logic is the careful part:
    - a mode the user picks while the hold is being set cancels that
      pending review; one picked during the review wins and nothing is put
      back; the newest choice follows every outstanding mode request, and
      a new turn waits for them rather than trusting the panel's label;
    - Bypass comes back only while its setting still allows it (D24): a
      restore revoked while it was in flight is corrected to Manual before
      it is reported, off and on again does not revive an earlier pending
      remote confirmation, and a fallback the backend refuses retires only
      the session that owned the unsafe request, never a replacement;
    - the session going releases the hold, and a review whose Plan
      admission was refused after a revocation retires the old Bypass owner
      rather than relabelling it Manual.
  - **A review is a turn for checkpoints (M72, D51).** It is marked
    running and takes the pre-turn capture before it is sent (released with
    the mark when its turn cannot be sent), as a message does, because a
    Plan-mode turn on Muse Code is not strictly read-only. One review starts
    at a time, and a message sent while one starts waits for it, then goes
    into the review turn as a steer. That wait belongs to the conversation
    generation that started the review: a cleared or replaced conversation
    drops it, so the old review's outstanding command neither holds up nor
    refuses the next conversation, and its end never clears a newer one.
  - **Findings**: the review ends with a fenced `muse-review` JSON block
    (the extension's own format, parsed with zod); the reply shows it as a
    list with severity, title, detail and a `file:line` that opens the file
    at those lines. A model-chosen severity is shown as it came; a location
    outside the workspace is text, never opened. A block that does not
    parse stays a code block.
  - **The review pane** (`/changes`) lists the conversation's edits, its
    agents' included, in the order they landed, file by file and hunk by
    hunk (at most 200 edits and 20,000 diff lines, the first patch
    included; the rest are counted). Accept marks a hunk; Revert takes that
    one hunk out of the file as it is now (M36's exact reverse-apply), once,
    or says why it could not. A comment on a line quotes the file, the line
    and three lines around it as a `chat_reference` from `diff`, and goes as
    a steer into the running turn or as the next message. Revert is an
    explicit file edit of edit review, serialized per file so overlapping
    reverts rebuild from each other's bytes, and each one is one operation
    under the checkpointed edit lease (another window refuses a restore
    meanwhile): read the saved bytes, rebuild from them, re-resolve the
    canonical target inside the workspace (links and junctions), refuse an
    editor with unsaved changes, then publish only while the file still
    holds those bytes at that path with no link on the way (the tools'
    `writeFileIfUnchanged`; a created file emptied goes to the trash through
    `deleteFileIfUnchanged`; a file absent when read is written only while
    still absent). A refused publication says why (changed since, or
    unsaved changes). It is announced to live verification without an own
    edit round of the agent's (`beginExternalEdit`) and is the user's once
    it lands. A Revert that changed the file stays reverted when the lease
    release fails afterwards (logged). A press or a pane read that a restart, a
    crash, the host closing the session or a sign-in check overtakes is
    answered while the panel still shows that conversation (attached, or
    the one the next message resumes); a press that wrote nothing gives its
    hunk back, and only its own hold. A cleared or other conversation hears
    nothing of it.
  - **Bundles** (D6 amendment): the review's code is `dist/review.js`, and
    the Model API and review bundles carry no English table.
    The lane's budget repair splits the existing model text used only by
    `ModelApiHost` into `MODEL_API_MODEL_TEXT` beside the shared block,
    following `REVIEW_MODEL_TEXT`. Its words and callers' behaviour stay
    identical; activation can discard that unused object. The bundle-split
    gate must reject its return to activation or the ACP loader. This is
    required to fit M70 under the unchanged 600 KiB activation cap.
  - **Wire evidence** (AGENTS.md rule 13): nothing new is read from Muse
    Code or Meta. `session/setApprovalMode` and `session/approvalModeChanged`
    are M4's captured shapes; the findings block is the extension's own
    format and is parsed as untrusted model output.
  - **Left to the owner** (not settled here): widening the list of files
    that may hold secrets beyond M54's (`.npmrc`, `.netrc`, cloud
    credential folders); offering the read-only code intelligence tools
    (M67) to the Reviewer; whether Muse Code's review should refuse to run
    at all while its Plan mode is not strictly read-only. The safest
    default is built: the narrowest tool list, the current list of names,
    and the honest notice.

## M72 — Turn checkpoints (D49)

**Correction batch before 0.10.0, 2026-09-30 (built and lane-verified; the
four-rig gate, hosted CI and the release are open).** Seven commits on the
verified `9c4ac7d3` (`docs/certification/m72.md`, "Correction batch before
0.10.0", holds every drill with its hash):

- **Memory** (`cfe57534`, `80b768f4`): the batch described next. The
  activation wiring test now pins the exact guard expressions (a no-op
  `captureGuard` fails it), which the independent verifier found missing. Its
  other finding, that `withCheckpointEditAt` decides containment lexically
  against the canonical root while the store also accepts the display root, was
  right for the export edit (a save dialog returns VS Code’s spelling) and is
  fixed in `e78a949d`: containment holds for either spelling. The project memory
  scope was never affected (its path is built from the root it is compared
  with).
- **The user's `!` and a shell that never started** (`e593ebe4`, `1fd98aaf`):
  see "Final admission for the user's `!` command" below.
- **git's path limits** (`62c856d8`): see "Long storage paths" below.
- **Test infrastructure** (`c5fec8dc`, `dd4daa8f`): on macOS and Linux the
  integration tests use a short user-data folder only when the default would
  not fit a Unix socket path (macOS caps it at 104 bytes), and the macOS worker
  cap is typed so that `typecheck:host` passes; it failed at the base and would
  have failed `npm run quality`.

Measured by `npm run build` on `62c856d8`: extension 591.7 of 600 KiB, Model
API 398.5 of 400 (1.5 KiB left: anything that lands in `ModelApiHost.ts` needs
its size re-checked), checkpoint store 188.5 of 225; no budget moved. **Open:**
the final four-rig gate (Windows host, Windows VM, Mac mini and Kubuntu, each a
literal `npm run quality` on the exact tree), hosted CI, the protected merge and
the release; the independent verifier of the git path lane had not reported.
**Owner decisions still open** (§3): native/process exclusion, whether hooks
should get a final admission of their own, and whether a storage path over 240
characters should ever be served by moving the repository (today it is refused
with a clear message).

**Actual memory composition and GUI admission batch, 2026-09-30 (built; aggregate
gates and platform runs open).** Activation built Muse Code's
memory over the raw tool I/O while the guarded owning fixture composed a
checkpointed one, so a replacement of an ignored project note or of its
`MEMORY.md` took no checkpoint copy, an exclusive creation (which has no
ToolIo call) took none either, and the Memory view's creation and trash held
no restore lease. One small composition, `createCheckpointedMemory`
(`host/backend/checkpointedMemory.ts`), is now the only place activation
builds the store, and the regression tests build it too:

- Replacements (an existing note, an edit, `MEMORY.md`) go through
  `withCheckpointCopies` with the original guard. An exclusive creation
  awaits the same `beforeToolWrite` copy, then publishes with no-clobber and
  the same guard. The accepted-first-write rule is kept: a note already
  published stays when a later index guard refuses, with the honest index
  warning.
- The view's creation, trash and index line run under the pure edit lease
  (`withCheckpointEditAt`) until their native promises settle, with one guard
  captured when the action starts (`backend.workspaceActionGuard`, the same as
  Create AGENTS.md and the review revert). The guard is handed through
  `Store.create` and `Store.forget` to the atomic publication callbacks. A
  note is copied before the trash (`beforeDelete`), and the guard speaks last
  right before VS Code's delete, which has no callback seam. A trashed note
  stays trashed when the index guard refuses, and the failure is reported.
- Whether a scope takes the lease is decided by its folder, not its name:
  only a scope under the workspace folder does (the project scope; Muse
  Code's personal folders when the window is opened on the home). The rest
  keep only the lifetime guard, so no project lease is taken for a path no
  restore writes. The view has no trust gate, as before, so it still works
  in Restricted Mode (the lease publishes its mark there too, with no git).
- A conversation export the user places is written through the same lease
  when its file lies in the workspace (`cliFeatures` `editFile`); the
  writer inventory found no other raw workspace writer: the Model API tools,
  the IDE image tools and memory copy first; plans, the review revert,
  Create AGENTS.md and exports hold the lease; hooks and shell commands mark
  activity; CLI commands, worktrees and terminals use the native startup
  fence; sessions, schedules and the job helpers write the extension's own
  storage; the ACP agent is an independent process outside the guarantee.
- `src/extension.ts` has no unit run (its coverage is the integration
  suite), so a wiring test holds it to the composition: no `new MemoryStore`
  or `createMemoryIo` in activation, the view gets the composition's lease
  and copy, and exports go through `withCheckpointEditAt`.

Held-GUI controls run real git, real native I/O, the real store and a second
window: a held creation or trash is refused a peer window's restore
(`turnElsewhere`) and lets it through after settlement; a personal path
outside the workspace takes no lease and a restore proceeds meanwhile; a
revoked window refuses before the delete or the publication; a failed copy
stops both; and a restore puts back the ignored note, its index and the
trashed note. Eighteen on-purpose breaks of these guards each failed their
intended tests and restored byte-exact (the certification record names the
hashes). No new transaction, policy, dependency or native resolver framework.

**Whole-suite correction batch, 2026-09-30 (verified).** Four controller
expectations predated the required checkpoint-state row. Their exact old
auth/composer/model/session/skills/attachment order is kept, with the
explicit `noFolder`, blocked Restore/Redo, empty legacy/current turn lists
and relevant session identity added at the actual emission point. The
side-session clearing test asserts the complete new message sequence rather
than a position from the end. The webview's `checkpointState` messages carry
`legacyTurnIds`. Nothing filters the new row and no assertion was weakened.
This is a fixture contract correction, not a product behavior change: the
five owning files (controller, conversation checkpoints, App, UI state,
protocol) pass 636 of 636, and removing the session id or the legacy turn
ids from the emitted row fails four and five controller tests on the exact
expectations.

**Release-blocking memory-owner repair, 2026-09-30 (bounded proof complete).** The
old memory-tool branch bypassed the captured call admission used by ordinary
file edits. After approval it awaits placement, note reads and checkpoint
preimages, but its existing/new note and index writes received no turn guard.
The repair threads the existing original-call Stop, mode, trust, session-disposal and
Host-closing predicate through `runMemoryCall`, `MemoryStore` and `MemoryIo`
to the existing atomic replacement/no-clobber publication callback. Recheck
after memory preparation; reads create no mutation notices or write grants.
Every new-note index publication carries the same admission. Keep an already
published note if a later index guard refuses, with the existing honest
index warning; do not roll back accepted bytes or invent index success.
Real checkpoint preimage and native publication fixtures cover held
Stop/mode/trust/disposal/Host-close refusal, unchanged-owner success and index
completion/refusal. Old `85cedad0` published actual late bytes after Stop,
mode and trust changes. Exact `e908e825` passed five types, 400 owning tests
in four files, owned lint, whole-repository duplication (605 files, zero
clones) and 14 localization tables. Four external guard-removal controls
showed green → red → restored green with exact hashes restored. Initial
fixture narrowing, startup interference, lint and clones were fixed without
changing assertions or gates. Lead full quality/final release proof remains
required; the per-milestone record carries the exact receipts. No policy,
dependency, native resolver or general transaction framework is added.

**Common Stop/lifetime join, 2026-09-30 (bounded proof passed; aggregate gates open).** Preserve
the reviewed `c19a4955` checkpoint implementation and apply only the proved
ordinary-write, formatter, rename and automatic-diagnostics owner guards.
Capture the actual active turn object, call, mode and initial trust before
awaits; recheck the same owner at native publication and result release.
Forward the optional ordinary-write guard through checkpoint preimage copies
and compose it with runtime directory ownership in the existing atomic path.
Conditional checkpoint callbacks, preimages, pure leases and captured Plan
recorders stay intact. A denied late formatter retains the successful initial
edit and its patch. Rename refuses before its first actual write after owner
changes, while preserving its established finish-after-first-write Stop rule.
Host closing fences publication before awaited SessionEnd work. Diagnostics
and configured checks with revoked ownership/trust are refused or withheld,
never reported clean; Restricted ordinary reads/edits retain their contract.
This branch has no M78 profiles or M82 budget feature: use its existing
permission engine and add no such settings or whole Host replacement.
Native held-checkpoint and atomic-stage controls plus the current M72 suites
passed the assigned Windows VM proof after the lead reassigned Kubuntu to
M75. Five type projects, scoped lint, all 14 locales and zero duplication
passed on behavior tree `f6e7e854d8b6a37738e82484b39c23b3dbe0ace2`.
The final seven-file rebind passed 504 tests; the earlier full 27-file owning
selection passed 757 with six explicit Windows skips on `8b272cb3`, before
only production naming/declaration placement and typed fixture deduplication
changed. Fourteen disposable mutations failed their intended assertions;
31 selected tests passed before and after exact restoration. Removing the
required Host closing callback also failed the constructor contract at
TS2345 and restored exactly. The certification record names hashes/receipts.
Initial factory, fixture, polling, parallel-timing, lint and clone failures
are retained; no threshold, deadline, ignore, dependency or rule was weakened.
The final evidence-doc reconciliation resumes from the user-paused checkpoint;
it changes no behavior and reuses those valid proofs. Final independent
review, verified latest-main join and aggregate/platform/installed gates
remain open; no partial unverified M75 snapshot is joined here.
The checkpoint shell wrapper adds another await before command entry; its
optional final command callback therefore runs after the pure activity mark
and again after the native adapter's awaited Windows assembly preparation.
A refusal before entry releases the mark without claiming an unknown process;
the native adapter reports proven cancellation with no workspace process.
Existing commands, hooks, permissions, signal and runtime identity checks
remain in their paths. Held-mark/assembly negatives and an actual unchanged
local command must prove that forwarding before merge certification.
The same callback reaches ordinary model shell calls through ToolContext.
Original call/batch admission is passed through explicit path preparation,
every sequential check and then_run rather than recaptured after a changed
mode or trust. Completed commands retain their actual exit status; unstarted
commands are refused and revoked results create no current ledger grant.
M46's explicit background move retains its existing separate controller:
only the exact still-owned controller may outlive the parent turn, while
captured mode/trust, command Stop, session disposal and Host close still hold.
Multi-check, explicit-path and held-background controls bind these seams.

**Independent no-entry classification follow-up (verification pending).**
The f6 review found a captured-owner refusal after checkpoint admission or
Windows assembly reported as a ran failed/cancelled check. Carry explicit
locally proven entry-refusal evidence through the existing ShellResult;
only the wrapper/native callback boundary may set it, never model/MSP data.
runCommand preserves it and runVerifyCommand reports notRun/refused from
that evidence. A null exit code or cancellation alone cannot imply no entry.
Already-started commands retain their actual exit outcome after revocation.
Extend held-mark/actual-assembly summaries and a launched/cancelled control;
prove only the new classification removals, preserving the valid 14 earlier
reds and original paused receipts. No new policy or ownership registry.
The common result interface and no-entry constructor live in the neutral
core/shellResult module, preserving the original tools type export. Eager
host adapters import only that tiny value; they cannot pull LAZY_ONLY tools
into the extension. Existing type consumers and outcome behavior are unchanged.

**Final admission for the user's `!` command and proof for a shell that never
started (2026-09-30).** The Model API session's explicit `!` command (M46) was
the one shell entry that reached the checkpoint wrapper and the native adapter
with no final admission: after its initial Restricted Mode check, the activity
mark and the adapter's Windows assembly wait could end with nothing asking the
current trust, the session or the Host closing. It now passes its own callback
as the sixth `runShell` argument and refuses on the user's own stop, session
disposal, Host closing and current trust. It does not take the model's rules:
the running turn, its Stop and the permission mode (Plan included) never
decide an explicit `!`, and a started command keeps its outcome. A refused
entry ran nothing: its row reads "The command did not run" and the model is told
nothing. Separately, a command that could not start at all carries
`isWorkspaceShutdownProven` through `unstartedShell()` in `core/shellResult`:
no interpreter on `PATH`, a missing PowerShell (a spawn that failed with no
pid), the hook shell, and `spawn` itself throwing (a NUL in the command, a
command line past the operating system's limit; `startProcess` in `toolIo.ts`).
The failure stays a failure. A launched command, an error event after launch
and a normal exit never carry the proof, so the wrapper still records native
uncertainty for any real launch. A failure before entry (the activity mark
cannot be made) is a `ShellEntryError`: the user shell path treats it as a
no-entry outcome and tells the model nothing, while a failure after the command
ran stays a plain `Error` and is still told. Out of scope by design: hooks (no
workspace-trust gate; SessionEnd runs while the Host is closing; Stop is
honoured through the signal) and Muse Code's `session/userShell`, which the CLI
runs in its own process, guarded only by the controller's Restricted Mode check
and the native startup fence. A throw from `assertWorkspaceCurrent` stays
unproven and conservative; only the ACP runtime composes it, and it has no
checkpoint wrapper, so no false sticky state is reachable (revisit if the two
are ever combined).

**Measured checkpoint bundle split (D6, verification pending).** Literal
`npm run build` on 0.10.0 `addc6870` produced extension 638.2 KiB, exceeding
the unchanged 600 KiB budget; Model API 397.9/400 KiB and every other existing
bundle were below their budgets. Preserve that real failure and move only
checkpoint implementation behind a dedicated shipped CommonJS entry using
the existing requireFile/checked-loader pattern. The extension keeps a thin
typed API and neutral turn key; the factory synchronously installs activation
UI_TEXT/uiLocale before constructing the real store. Constructor/getter,
maintain, namespace safety, process/startup admission and dispose remain
synchronous or awaited exactly as before. Loading occurs when activation
constructs a known-namespace store, including before its initial maintain;
this is a code-bundle split, not a claim of wholly lazy activation behavior.
The bundle must ship in the VSIX, source/metafile split gate, notices and size
inventory. Its new bounded budget will be set from measured implementation
bytes with documented headroom; no existing threshold is raised. Real built
factory, missing/malformed refusal and repaired-load controls plus literal
build/size/split and deliberate failures must prove the boundary.

The injected activation GitProcess keeps its original local error objects.
The new checkpoint bundle has separate copies of GitMissingError/GitExitError,
so checkpoint catch paths must use the error's checked name and exit fields,
not custom-class identity. Reuse host/git.ts for these structural guards,
preserving stderr/message and all CAS/error handling. Exercise actual built
factory capture with native Git and an exit-1 config control, plus the native
missing-Git error crossing the factory boundary; deliberate guard removal
must fail those semantics. No process-error wrapper or alternate store.

Actual scoped proof on `a8d25f02`: all five type projects and lint passed;
literal `npm run build` exited 0, including size, split, host globals and
81-package notices. Extension 590.5/600 KiB, Model API 398.1/400,
checkpoint store 186.8/225. Six real built-module controls passed. The
fixture-only `e908e825` rebind has identical production/native/script/package
inputs; all five types, lint, whole duplication (605 files, zero clones),
14 locales and 79 controls plus 447 owning tests passed. Three new no-entry
classification removals fired at intended assertions; new loader/Git and
packaging drills are completing in owned disposable copies. These are scoped
results, not full-quality, platform or release/channel certification; those
remain the lead's next gate. No product source awaits a new feature decision.

**Long storage paths (2026-09-30, measured with git 2.52.0.windows.1).**
`core.longpaths` is read only after git has opened the repository, so the
repository's own path must fit PATH_MAX as written: a `GIT_DIR` of PATH_MAX-40
(220) characters or fewer is taken absolute (`'$GIT_DIR' too big` beyond);
written relative, `<git dir>/objects` must still fit in 259 (repository 251 or
less, storage 240 or less); the work tree and a repository being made are
changed into, so 258 or less. No spelling, working directory, gitfile or option
reaches beyond, and the hashed namespace and identity hashes stay as they are.
The old initializer (`shadow-<uuid>.initializing`, 56 characters) also ran
`git init` without the scoped option, which fails from 235 characters; the
frozen 90ff host run hit that at 242 with a repository of only 195. ShadowGit
now makes the repository in a short unique folder in the storage folder itself
(`.i-` plus 12 digits of sha256 of the window's id: same folder, so same volume
through links and junctions, and one atomic rename), with scoped
`core.longpaths`; removes it in a `finally` whether init failed, was cancelled
or lost the publication race; and sweeps one a dead window left once it is
older than `CHECKPOINT_STALE_LOCK_MS`. While the repository path is PATH_MAX-40
or shorter every command keeps the absolute `GIT_DIR` and the work tree as its
directory; beyond that it is named `shadow.git` with the storage folder as
directory, `GIT_WORK_TREE` and `GIT_INDEX_FILE` stay absolute (a relative index
is invalid after git changes into the work tree), and `hash-object`'s file
argument is named in full because it opens files from where it started. A
repository over PATH_MAX-9 or a work tree over PATH_MAX-2 is refused before any
file is made or git is started, as capture refusal `pathTooLong` with UI text
`checkpointPathTooLong` (14 tables, machine-made). PATH_MAX is the platform's
(260, 1024, 4096) unless a test lowers it (`gitPathMax` dep), so both decisions
are by length. No store created by an earlier build is affected (storage of 177
characters or less). Tests: `checkpointLongPaths.test.ts` over real git; the
tests' independent reads use one helper that scopes `core.longpaths`. Sixteen
on-purpose breaks and an equivalence drill (the relative spelling forced across
20 suites) are in the certification record. Limits kept: `git worktree add` and
the workspace-cwd metadata runners cannot use a workspace over 258 characters,
and window presence files are written before the path check.

**Status 2026-09-30: built** on `feature/m72-checkpoints` (PR #55, first built
2026-09-28) and integrated on `integrate/m72-on-24ff` for 0.10.0 (D51,
`docs/certification/m72.md`); not yet merged: the final four-rig gate, hosted CI
and the release are open. The mechanism is a shadow repository in the
extension's own storage, never the workspace's `.git`.

- **Goal.** Undo is cheap, and complete wherever the extension saw the
  change coming; where it could not, it says exactly what it left.
- **Scope.**
  - A checkpoint at each turn boundary, kept in a shadow repository in
    the extension's own storage, never in the workspace's git objects or
    refs, where a push could carry an untracked or ignored secret
    (`.env`). It runs with hooks and fsmonitor off and none of the
    workspace's filters. It includes untracked files.
  - Ignored files the turn itself created or changed are handled too:
    - a file the agent's own edit and write tools change is copied before
      the write, so a restore brings it back;
    - a shell command's changes are found afterwards by a bounded scan of
      size and modification time, when the old content is already gone
      (and Muse Code cannot be paused before its commands). A restore
      deletes the ignored files the turn created and lists the ones it
      changed as not restorable. It never claims more than it did.
  - Other ignored content is left out. Everything is subject to the size
    limits, and the checkpoint names any file it skipped.
  - Restricted Mode, where the extension runs no git, has no checkpoints,
    and the panel says so.
  - Restore files, conversation, or both. A restore goes through Edit
    Review's checks (D27): a file the user changed after the turn, or one
    with unsaved changes, is refused with the reason and listed, never
    overwritten.
  - Redo after a restore.
  - Size limits, and cleanup with the conversation.
- **Backends.** Both. It lives in the extension. Conversation restore
  follows M53, and Muse Code on Windows still cannot fork (sdk #31), so
  there it restores files only and says so.
- **Relation to D46.** D46's rewind stays the conversation's own rewind of
  the edits it recorded; a checkpoint restore also covers what shell
  commands changed, and both use the same confirmation.
- **Acceptance.** Nothing lands in the workspace's `.git`; a restore puts
  back tracked, untracked and pre-copied ignored files, deletes ignored
  files the turn created, and lists what it could not restore; redo
  returns to the state before the restore.
- **Tests.** A temporary repository per test, with drills for the
  workspace `.git` guard and the not-restorable list.
- **Size.** M.
- **Built (2026-09-28).**
  - **Resume 2026-09-29 (`e73e8549`, safe-availability verification pending; integration open).** Finish the
    existing shadow-ref redesign rather than reintroduce `store.lock`:
    checkpoint and redo JSON live in their own CAS refs, each window owns
    its index/pins/staged copies and presence, archives are written before
    returning, and prune keeps recent objects while another window writes
    their refs. Port tests that still import the removed lock or read the
    removed `records.json`. Prove independent stores preserve each other's
    records and live captures, ignored preimages survive until their end
    record is durable, archives survive window close, folder preservation,
    stopped restores retain Redo, and localized failures reveal no storage
    paths. Recheck queued/scheduled turn admission and state the remote
    Muse Code event limit honestly. Evidence belongs in `m72.md`; the old
    lock receipts remain historical, not certification of this redesign.
    A restore/redo reserves a single shadow ref by CAS before file work,
    rechecks running windows after admission and lets the reservation go
    only if still its own. Model API turns await their running mark before
    hooks, shell commands or model calls, including queued and scheduled
    turns. Checkpoint identity is the session/turn pair so simultaneous
    windows cannot create two records for one turn.
    A known process that is still alive retains its presence and resources;
    heartbeat age alone cannot prove it gone. Native, unresolved activity and
    unreadable/old presence do not expire, even on owner PID death, without
    confirmed native shutdown. A reused process id can delay ordinary
    fenced-window cleanup; deleting unproved copies or reservations is refused.
    Cleanup defers record deletion and prune while a live restore owns its
    reservation. Admission reserves first, then rereads records/archives and
    pins that fresh source view before touching files, so cleanup cannot
    remove old source blobs during setup.
    A failed ref command is observed before it is called a conflict: if
    the ref already names the exact tree just written, the write succeeded.
    Model API admission awaits an existing turn record, or capture and
    record creation, before edits. The independent resume review also
    requires staging/index enumeration before a fresh presence read, and
    preserving a redo's applied report if trimming its original record fails.
    Failed end writes pin the complete pending record tree under the owning
    window until final persistence, protecting ignored preimages beyond the
    prune grace. Empty-folder cleanup errors after a committed file delete
    are logged without dropping that applied step or its Redo preimage.
    All Model API turns, including paid children and queued child follow-ups,
    await admission and keep their mark until completion. Child records use
    the top parent's session id for archive/retention and their own unique
    turn id, so a child outliving its parent still blocks a restore.
    Fresh host/unit types and nine checkpoint suites pass (111 tests,
    3 POSIX-only skips); the unchanged Model API source passes its full
    301-test owning suite. Independent read-only review closes the storage
    and child-admission findings. Full quality, cross-platform checks and
    the native Muse Code pre-event exclusion limit remain integration work;
    the certification record names the source-bound focused receipts.
    **Safe destructive availability correction (2026-09-29, before code).**
    Stored checkpoint Restore/Redo is offered only for the actual attached
    Model API session. The host and store recheck server-owned session/backend
    admission and trust before mutation; unknown/disconnected identities fail
    closed. Muse Code captures/listing remain read-only. Before any agent
    `muse serve` startup, its manager awaits a persistent native marker in
    existing window presence and checks the shared restore reservation without
    launching Git in Restricted Mode. This applies with checkpoints off and
    remains through native idle/queued/scheduled/child work. Current stores
    attest the startup fence through a fixed presence word; old/unknown peers
    cannot attest it and block destructive operations. Native/unknown presence
    is not discarded on age, extension PID death, host exit or store disposal:
    SDK exit/close proves the server exited, not every native descendant.
    No automatic full native shutdown proof exists here. Recovery requires
    explicit user confirmation that all native workspace work has stopped,
    closing its old window so it cannot republish or restart native work,
    then removing only that exact unsafe presence JSON under `checkpoints/windows`.
    Saved record refs, captures, Redo and history remain. Verify this narrow
    owned-fixture recovery procedure before documenting it. Preserve the
    prior focused receipts as historical,
    add real-storage mixed-window and held-reservation startup tests plus
    fake-host admission/barrier tests and red/restored proof. No new lock,
    dependency, wire field or paid capture.
    The existing atomic writer also receives a synchronous pre-commit check
    for checkpoint writes, after its awaited canonical-path checks and just
    before each rename attempt. Backend/trust revocation during temporary-file
    preparation cannot commit an old restore into a new session.
    The same native barrier also covers the account-only workspace-cwd
    `muse serve` process. No capture proves its autonomous scheduler inert.
    Initialize checkpoint admission before authentication can request that
    host; preserve required auth probes and their cwd. A probe therefore can
    conservatively close Model API restore availability too, as the UI/docs
    must state. Reuse the manager's single admission callback at both spawn
    sites, with no private SDK process handles.
    Locally owned shell/hook work also outlives Model API turn boundaries:
    background commands and `!` commands can run after the parent turn ends;
    SessionStart/SessionEnd hooks can run outside a turn. Extend only the
    existing `withCheckpointCopies` I/O wrapper to publish a unique activity
    mark before `runShell`/`runHook` and clear it after the real I/O promise
    settles. The shared wrapped I/O covers children and stays active with
    capture off. Real-store held-activity tests and red/restored proof must
    show Restore/Redo refusal, startup exclusion under CAS, and no mark
    released at the outer row acknowledgement.
    The existing runner's normal primary exit/drain is not proof that all
    descendants stopped. Without positive locally owned shutdown provenance
    on its internal ShellResult, shell/hook completion first publishes the
    same sticky unsafe presence and only then clears its transient activity
    mark. Current runners provide no such full-tree proof. Active activity
    markers also survive owner death/disposal; they cannot disappear into
    false safety after a crash. Pure file-tool Model API sessions remain
    eligible; commands/hooks/account probes can conservatively close that
    availability. Keep intentional background jobs intact. No automatic
    release, native wire field or new containment framework.
    Independent rereview found two remaining ownership bypasses. Fence the
    existing Model API local stdio MCP factory before actual spawn with the
    same persistent native barrier; adapt only the local spawn seam to await
    it, without protocol/schema changes. Externally managed HTTP MCP services,
    editors and independent processes remain outside this ownership guarantee.
    Also make the surface checkpoint tracker passive for Model API actual
    turns: core admission/end callbacks own their canonical mark and end
    capture. Latch ownership when tracking a session/turn so closing one
    retained surface cannot clear an actual turn still running elsewhere.
    Only pending panel captures remain surface-owned. Real retained-session
    and MCP startup/idle regressions must prove both bypasses closed.
    Current workspace-specific storage also splits fences when two VS Code
    workspace identities name one physical folder. Before store/auth/spawn,
    resolve the native canonical directory and use the existing memory
    workspace-key helper (Windows-normalized/case-folded) under the extension's
    global storage. All current-version windows sharing that canonical root,
    user/profile/global-storage namespace share the existing store/CAS/presence.
    Unknown/unreadable roots fail closed. Preserve old workspace-specific
    stores in place as read-only legacy; use existing record readers without
    prepare/cleanup/migration, show legacy IDs as read-only, never move active
    fences or delete history. Older versions, different profiles/users/machines,
    remote HTTP MCP, independent processes and editors are outside that fence
    guarantee. Real two-identity/native-alias/unknown-root tests are required.
    The factory closure audit also found short CLI skills/import/export and
    sandbox commands, plus extension-managed interactive/auth/MCP/installer terminals.
    Await the same persistent startup marker before execFile or terminal
    creation (a shell profile can run immediately), keeping absent-CLI return
    semantics. Existing callback contracts accept awaited void/boolean
    promises; check the application shutdown signal and manager generation
    after admission before invoking the actual factory. Terminal disposal,
    command exit and owner death do not clear uncertainty. Prove each CLI,
    sandbox and terminal family with held durable admission/real restore refs
    and no-launch after shutdown; no new process-tree framework or wire field.
    The bounded closure search found Create AGENTS.md's `muse init` callback
    too. Gate it through the same native startup path; refusal propagates and
    never becomes absent CLI/template fallback. The explicit pure template
    write uses existing active presence admission, checks shutdown and manager
    generation after the await, and releases only after its FS promise settles;
    it does not promote a process marker. Preserve its Restricted Mode action
    while running no Git there. Test held missing-file lookup, real restore
    reservation and late shutdown before either writer begins.
    The final bounded factory pass includes extension-managed Git worktree
    add/remove: normal repository configuration can run checkout hooks and
    leave workspace-capable descendants. Route only those exact mutation
    argument forms through the existing persistent startup admission; keep
    ordinary Git metadata reads and user hooks unchanged. After admission,
    resolve the owned workspace and Git cwd, verify the cwd contains that
    workspace, and recheck application lifetime/manager generation immediately
    before Git. Pass that checked canonical cwd to the actual runner; a
    retargeted caller alias must never select another repository after the
    check. Prove a real post-checkout canary, refusal under a real restore
    ref and no Git after late shutdown. Freeze this writer inventory before
    current-main integration and fresh affected verification.
    Current-main integration adds M79's explicit plan publication and stale
    stage cleanup, plus the existing file-review revert write/delete seam.
    These pure workspace mutations use the same actual-promise file-edit
    lease, including success/failure and held-restore/late-close cases. Keep
    M79's captured owner/trust/lifetime checks and no-clobber/inode cleanup
    intact; admission does not grant ownership of another writer's stage.
    Automatic prompt environment status/log can also execute configured Git
    fsmonitor, signature or clean/process helpers. Use M70/M77's scoped
    suppression: empty fsmonitor (legacy-compatible), signature/maintenance
    off, and bounded names-only filter discovery with per-command clean,
    process and required overrides. Keep ordinary user Git unchanged. Each
    actual metadata process holds existing checkpoint activity through its
    promise and rechecks trust, lifetime and owned cwd immediately before
    spawn; discovery failure refuses facts, never means no helpers. Harmless
    real helper canaries must execute under ordinary Git and remain absent
    under environment reads; held restore, late trust/lifetime and cwd cases
    prove admission. Keep shared suppression parsing in the existing Git
    module for the later M70/M77 joins, without a new process framework.
    The portable ACP process has no stored checkpoint restore surface or
    VS Code profile namespace. Its required startup policy explicitly records
    that independent-editor boundary; it does not claim shared VS Code
    admission or publish a fabricated fence. Keep the extension's managed
    startup callback required. ACP writes, like other independent editors,
    are outside the current VS Code checkpoint exclusion guarantee.
    The joined M68 conditional file writer keeps its fingerprint, unsaved
    text and captured-owner checks, with M72's preimage wrapper reaching
    `writeFileIfUnchanged` too. Atomic writes retain both live predicates
    after awaits and immediately before rename, and support snapshot bytes
    without changing conditional text/fingerprint semantics. Keep M68's
    shared edit registry, plan captured owner and verify settings/ports.
    Independent joined-main review found plan trust/lifetime withdrawal after
    awaited admission/staging could still publish. Capture the actual plan
    workspace/trust/lifetime predicate, pass it through the existing PlanIo
    edit callback and into native no-clobber mkdir/stage/publication checks,
    and check it immediately before stale-stage removal. Reuse the existing
    staged callback for real held-stage regressions. Restricted explicit
    Revert/template policy stays unchanged; plan saves keep their existing
    trusted-only policy. Preserve M68 captured owner and M79 stage identity.
    The joined restore review also found a saved/dirty file could change
    during atomic staging, after its initial expectation check. Reuse M68's
    conditional writer with a restore-specific current-file predicate, raw
    byte/absent/stat expectations, and fresh dirty/backend/cancel checks at
    publication. Recheck canonical/unlinked deletion destinations after the
    awaited file check, and cleanup folders before rmdir. Preserve executable
    bits and durable partial Redo. Real held-stage edits, dirty editors and
    parent link swaps must refuse writes; document the same narrow last
    comparison-to-syscall residual as the existing native conditional writer.
    The existing readonly menu note remains semantic and keyboard accessible;
    constrain that menu to the viewport and wrap long localized safety/legacy
    reasons. Register native, legacy and narrow read-only fixtures in the
    existing harness inventory so the accessibility gate reaches these states;
    verify actual narrow browser viewport bounds before integration. Reuse
    the existing component and harness.
  - **Where.** `src/host/checkpoints/` (the shadow repository, the store,
    the ignored scan, the records, the port and the tool-write wrapper),
    `src/core/checkpoints/` (git output parsers and the pure restore plan),
    `src/host/conversation/conversationCheckpoints.ts` (a conversation's
    captures, restore, redo and notices), the protocol's `restoreFiles`,
    `redoRestore` and `checkpointState`, and the user card's menu.
  - **When a capture is taken.** Before a message that starts a turn is
    sent, so the turn's first edit cannot precede it; the turn takes the
    oldest waiting capture, whichever of its start and its acknowledgement
    comes first. A turn no message of the panel started (a queued message,
    a scheduled run) is captured when it starts. Model API admission waits
    for that capture and record before edits; Muse Code events cannot wait.
    Each turn's end is captured too, including a turn the backend
    stopped (D25), a conversation that left the panel and a panel that
    closed. A steered message takes none.
  - **What a restore undoes.** The difference between the chosen turn's
    start capture and a capture taken now, less every path that changed
    between the conversation's turns or after the last (the user's work)
    and every path another conversation's turn changed while one of these
    ran (their times overlap), refused as "changed by something else in the
    meantime". Ignored files follow the turns' recorded changes, with the
    stat continuity check between turns. A path added since the checkpoint
    that the restored ignore rules name was an ignored file then and stays.
    A link, a folder link or junction (Git for Windows walks into one, so a
    capture drops every path under it), a file over 16 MiB and a nested
    repository are left out and named. Folders a restore empties are
    removed only if they were not there at the checkpoint: git trees hold no
    empty folder, so the capture before a turn also records the folders it
    holds no file of (`ls-files --others --directory`, an untracked folder
    listed whole standing for everything below it, plus the ignored and
    linked ones; up to 10,000, past which, or for a record without the
    list, a restore removes no folder). Limit: a folder the turns made
    inside a listed folder counts as there (the listing collapses an
    untracked folder), so it is left, empty. HEAD, the index, the stash and
    branches are never touched.
  - **Windows sharing a store (2026-09-29 redesign).** Each window owns
    its index, pins, staged copies and atomic presence file. Checkpoint and
    redo JSON live inside trees under `refs/muse-spark/record/<id>`; updates
    and deletions compare the previously read ref, and a checkpoint's id is
    derived from its session/turn pair. Independent windows cannot overwrite
    each other's records or create duplicate checkpoints for one turn. A
    restore/redo claims `refs/muse-spark/restore-active` by CAS, rechecks
    running windows, and releases only its own value; a crashed reservation
    is taken over only after its owner's presence is gone. Every store
    publishes presence before creating its refs. Shadow initialization uses
    a private completed directory then an atomic rename, so two first uses
    do not race Git's configuration or hook templates.
    - Panel submissions await a running mark. Model API turns additionally
      await admission before hooks, edits or requests, including queued and
      scheduled runs, and refuse a failed mark. Muse Code's remote events
      cannot delay its engine; exclusion before an autonomous start event
      arrives remains unverified, so its destructive checkpoint operations
      are unavailable. Locally owned shell/hook activity and account-only
      serve are fenced too; unproved shutdown keeps them unavailable until
      exact confirmed recovery, as stated in the README.
    - Tool preimages stay until the end record persists. A failed end write
      keeps its completed boundary and copies; the next store operation
      retries that metadata without capturing later user edits. Presence
      retains that unfinished end until it persists.
    - Archiving writes a separate atomic archive file before returning,
      including in Restricted Mode. Every window hides older captures at
      once; trusted cleanup deletes their record refs. Prune retains objects
      younger than `CHECKPOINT_PRUNE_GRACE_MS` (one hour), so another window's
      in-flight objects are protected.
    - Closing stops file work before the next mutation, finishes only Redo
      metadata and reservation release, then removes presence and staging.
      Presence remains live until in-flight work settles. Empty directories
      present at the original boundary are preserved as before.
  - **Each step** (review of 4ce27cb8): the redo record of every step is
    saved, with its keep ref, before the first file changes; `.gitignore`
    files are written first, then the ignore check (paths given as `./…`,
    never pathspec magic), then deletions, then writes, so a case-only
    rename and a file↔folder swap come back. Just before its step each file
    is re-checked: unsaved in an editor or notebook (asked again), its
    canonical path equal to the canonical root plus the path (no link or
    junction on the way), and its content the blob (SHA-1 computed in
    process), absence or size-and-time the plan expects. A step that fails
    or throws is reported as "could not be changed"; the record is then cut
    to what was done. Blobs are read in batches of at most 32 MiB. Writes
    keep the file's permissions and set only its execute bits.
  - **Redo** records what the restore replaced and what it left, and puts
    back only files still as the restore left them. A redo is recorded the
    same way, so it can be redone. What a redo could not do stays in its
    record (the button stays); a spent record is deleted. The button waits
    for the host's answer.
  - **Turns running.** A restore or redo waits for no turn: it is refused
    while any turn of the window runs (recorded or not, checked again after
    the confirmation). A turn whose end was never recorded makes its
    restored paths "unsure", named in the notice.
  - **Rewind conversation and restore files** is one action: one modal that
    names both, the conversation's checks (M53) before any file changes,
    the restore, and the rewind only when every file was restored; the
    report is posted after the fork so the new transcript carries it and
    its Redo (tied to the restore's id, not the conversation). **Fork
    conversation and rewind code** is one `rewindCode` message with `fork`:
    confirm, revert, fork.
  - **Cleanup.** Every window open (activation and trust granted) runs
    `maintain`: stale git locks older than five minutes (more than git's
    two-minute timeout) are cleared, keep refs no record names and the pins
    and tool copies of windows that are gone dropped and pruned, and
    retention applied with the setting on or off. Archiving in Restricted
    Mode drops the conversation's records at once with no git (under the
    store lock); its refs go at the next trusted `maintain`. Captures are
    pinned until recorded or let go; a capture older than its
    conversation's archive is not recorded. Closing the window ends every
    git still running and removes its presence. The folder is 0700 on POSIX.
  - **The menu.** A turn with a checkpoint (its first card) offers **Restore
    files to here** and **Rewind conversation and restore files** beside
    M6's fork, M53's rewind and M13's code rewind; a turn without one keeps
    M13's **Fork conversation and rewind code**. Disabled rows say why a
    choice is missing (Restricted Mode, the setting off, git not on `PATH`,
    Muse Code on Windows); a turn offers **Restore** only while checkpoints
    are on. **Rewind code to here** now asks in the same modal.
  - **Bounds.** 50,000 files outside the ignore rules and 512 MiB of changed
    files per capture (beyond them the turn has no checkpoint and the panel
    says why, once per conversation and reason); 16 MiB per file; the
    ignored scan at 5,000 files, and an ignored folder over 1,000 files left
    out whole; 500 ignored changes per turn. Retention: 100 checkpoints per
    conversation, 50 conversations, 20 redo records per conversation, and
    `museSpark.cleanupPeriodDays`. Archiving a conversation deletes its
    checkpoints and prunes at once; retention prunes at most every ten
    minutes.
  - **Setting.** `museSpark.turnCheckpoints`, machine-scoped, on by
    default.
  - **Limits (resumed candidate).** A Muse Code queued or scheduled turn's
    capture races its start (the remote backend does not wait), so stored
    destructive Restore/Redo is available only to an actual attached Model
    API session with confirmed process safety. Native/account and local stdio
    MCP startup, or shell/hook completion without full-tree proof, durably
    closes that availability. Unknown/crashed activity never expires into
    safety. Current-version windows sharing the canonical first folder and
    extension global-storage namespace coordinate across workspace identities;
    older versions, other profiles/users/machines, independently managed
    editors/processes and remote HTTP MCP services are outside that guarantee.
    Saved old workspace-specific history remains read-only. On Muse Code
    the extension cannot copy an ignored file before the CLI's own tools
    write it, so such a change is listed as not restorable. Failed end
    persistence freezes the original end boundary and staged preimages until
    retry is durable, keeping restores refused in the meantime. A file swapped between its
    re-check and its write is the same residual as the Model API tools'.
    Dirty notebooks are read from VS Code's notebook documents, which the
    unit tests do not reach (extension wiring). The first capture of a
    large workspace hashes all of it once.

## M75 — Paired efficiency evaluation (D49)

**Status 2026-10-02: built.** Status evidence: `docs/certification/m75.md`.

**PR63 second review round and the 0.10.0 merge (2026-10-01):** main
(`90ec399e`, 0.10.0 and the npm path fix) merged in; its [Unreleased]
`### Fixed` kept, M75's entry under `### Added`. Three threads closed:

- **No credential variable in the model's shell commands.** Both live
  harnesses build their tool access through `liveToolIo`
  (`test/e2e/evalLiveSupport.ts`), whose environment is
  `withoutCredentials(process.env)`, as for every process the ACP agent
  starts; the cards are allowed without a person reading them, so another
  provider's key in the owner's shell must not reach a tool's output.
- **Arms take turns going first.** The task at index i starts with arm
  i mod arms, so the prompt cache a task's first run warms (the same system
  prompt and message) is not credited to one arm; each v2 result records
  its `order` (1 = first), shown in the report, absent from v1.
- **The task selection is read inside the enabled test only**
  (`liveEvalSelection`, which refuses while live tests are off without
  reading anything), so a stale `MUSE_EVAL_TASKS` cannot fail the default
  run; the outer deadline allows the whole task set.

**PR63 final review, 2026-09-30 (repairs pending):** close the four reported
boundaries before merge. The opt-in live evaluator reads its credential from
the existing secure credential-store API inside the enabled test; it never
loads a key from its initial environment, arguments or a fixture. The same
arms list determines both execution and the outer task-by-arm deadline;
individual turn and verifier limits stay unchanged. Workspace-creation
failures retain cleanup but expose only bounded fixed error information,
including failures before a workspace object can be returned. Preserve the
authentic version-1 baseline byte-for-byte; version the expanded report as 2,
parse the legacy fields as genuinely unrecorded and render them truthfully.
Add ordinary mocked regression controls and deliberate failure proofs, then
repeat exact-tree local/platform/independent/hosted gates. No live or paid
evaluation is authorized by these repairs.

- **Main 327 update plan (2026-09-30; source only).** Preserve the f7
  candidate and original dirty source, then replay the approved continuation
  through a normal merge of `32709441`. Retain M68's actual-send guards,
  check registry, conditional tool I/O and canonical runtime. Reconcile
  the eval client-settings helper with M68's canonical fake key/account
  ports; keep the wire `3b81e698` and test `9cf294e0` bytes unchanged.
  No QA or model run is performed by this source preparation.
- **Current-main preparation (2026-09-30; verification held).** Join
  main `f7db5715` through a normal pending merge and retain the original
  ten-file approved continuation, including `wire.ts` source hash
  `3b81e698` and its `9cf294e0` regression tests. Reuse M76's already
  prepared current-host driver/test ports for code intelligence, repo-map
  and web fetch defaults; do not replace this harness with an older host.
  Preserve finite/safe-integer usage validation and the shared unknown
  liability flag that stops later model calls after ambiguous sent usage.
  The ten-task, 39-request historical report remains historical. New
  current-main compiler, behavior, red and aggregate/platform evidence is
  still required. No new model run is authorized by this preparation.
  **Resume review 2026-09-29:** the ten-task baseline exists at `f3e6bb35`
  (39 requests, recorded $0.0041); its JSON and Markdown remain unchanged.
  Later WIP changed the harness and does not inherit that live certification.
  Review found invalid negative/cached token counts could lower its budget, and
  sent requests with missing usage could leave later tasks free to keep sending.
  Reject invalid counts and close the shared run budget when sent usage is unknown;
  recheck after an awaited request body before sending. Fresh tests, deliberate
  red proofs, full rig gates and contemporary paired evidence remain required.
  Independent review also found the non-Request send reused mutable original
  arguments after validation; always send the validated `Request` snapshot.
  The final independent review found fractional and unsafe integer token counts
  still passed the eval bridge. Require nonnegative safe integer input, output
  and cached counts, retaining cached <= input. Raw nonfinite SSE usage must
  retain unknown liability and refuse the next shared-budget arm. The old-base
  Mac refresh passed all 91 eval tests before/after six assertion-failing
  mutations, host/unit types, scoped lint/format and duplication; receipt
  `m75-count-boundary-preliminary-fix/receipt.json` records exact restoration.
  The prior 81-test Mac receipt remains historical evidence for its exact source.
  Current-main integration and full rig gates remain required.

- **Goal.** A harness change is measured before it is trusted.
- **Scope.**
  - A task set: repository fixtures with verifiers, split into accept and
    held-out tasks.
  - Paired runs with and without a mechanism, on the contributor model,
    on the Model API (Muse Code's harness is not ours to vary).
    M75 is built first in wave 3: it lands with a baseline run, and M73
    and M74 then use it for their own paired runs before they ship.
  - Capability floors fixed in advance; tokens, cost and the pass rate
    recorded.
  - Attempts counted from the trace.
  - A report in `docs/certification/`.
- **Rules.** Runs follow the live-spend rules: an empty workspace, the
  contributor model, counted and reported.
- **Acceptance.** The baseline run is recorded with its attempts; a
  mechanism below a floor fails its run.
- **Tests.** The runner and its verifiers against the fake Model API; the
  live runs are the evidence.
- **Size.** M.
- **Status.** Built on `feature/m75-eval` (2026-09-28). A first draft
  (Muse Code, contributor model) drove a small tool loop of its own with
  three file tools and in-memory fixtures, judged by string matching, and
  committed a fake-API run as the baseline; the review replaced all
  three, since a mechanism M73 or M74 adds lives in the extension's
  harness and the draft's loop could not carry it. What landed:
  - `src/core/eval/`: the task set (`tasks.ts`), a task's folders and its
    verifier (`workspace.ts`), the trace (`wire.ts`), one turn on the
    harness (`driver.ts`), the paired runner (`runner.ts`) and the report
    (`report.ts`); the `EVAL_*` constants and `MODEL_TEXT.evalClarification`.
  - `test/unit/eval/` (60 tests on the fake Model API, the real
    `ModelApiHost`, the real tool I/O on disk and real verifier
    processes) and 15 red drills (docs/certification/m75.md).
  - `npm run test:e2e:live:eval` (`test/e2e/eval.live.e2e.test.ts`),
    opt-in like the Model API sweep. The baseline, all ten tasks on
    the contributor model, passed 10/10 in 39 model calls for $0.0041,
    verdict `pass` (`docs/certification/m75-baseline.json` and `.md`),
    after a first run of two accept tasks (6 calls, $0.0009).
- **Decisions.**
  - **The harness under test is the extension's own.** Each task runs a
    `ModelApiHost` (the system prompt, tools, permission engine and loop
    users run) with the task's prompt as the user's message. A mechanism
    is a change to the host's dependencies (`EvalHostChange`), so the two
    arms of a pair differ in that alone; M73 and M74 add their arm to the
    live file with their runs. Only the panel is replaced: a card is
    allowed once (Auto mode, so only shell commands and protected writes
    ask), a question is answered "proceed", and no paid feature is on or
    allowed (D48): a paid use that happens anyway fails the task.
  - **An empty workspace per task.** A fresh folder under the system's
    temporary folder per task and arm, holding the fixture files only
    (each fixture is an ES module package), removed afterwards. Nothing
    from the owner's profile (personal skills, memory, hooks) reaches the
    prompt.
  - **Verifiers judge behaviour.** Each is a Node module run after the
    turn beside the workspace (the model never sees it), in its own
    process with an empty environment and a time limit; it imports the
    fixed files and asserts what they do, so any correct fix passes.
    Every verifier is proved to fail its defect and to pass two
    spellings of the fix.
  - **Attempts from the trace.** Every request goes through the run's
    `fetch`, which records method, path, model, status and the usage
    Meta returned; attempts are the `POST /responses` sent, retries and
    any call a mechanism adds included. It refuses, without sending, a
    model call on any model but `muse-spark-1.3-contributor`, any other
    host, and everything once the run's estimate passes $0.50.
  - **Floors 0.75 / 0.75**, fixed in advance: 5 of 6 accept and 3 of 4
    held-out tasks must pass, on every arm, the baseline included (a
    task set the baseline cannot pass detects nothing). A split that did
    not run holds no floor: such a run is `incomplete`, never `pass`.
  - **Paired task by task**: each task runs on every arm before the next,
    so both arms of a pair share the conditions of the moment.
  - No new setting, command, panel string or paid feature: the
    evaluation is developer tooling. M73 and M74 add their own
    off-by-default settings with their passing runs. M91 lane S's
    `museSpark.modelApiShellKeepsDirectory` is the exception M91 step 4
    names: M75 records the setting, pinned off in the eval driver to match
    the recorded baseline, which predates it. The shipped default stays on;
    turning it on for eval runs needs a fresh baseline run.

## M73 — Observation packing (D49)

- **Follow-ups, 2026-10-02 (M73f, RV73b P3-1/P3-2).** Keep the existing
  session schema, host and pack store. A present but invalid
  `packedTokensAvoided` must load as absent and restart the packing ledger
  at zero, preserving the conversation. An unknown recall id must name
  only the last eight packed ids, plus the omitted count in English.
  Regressions belong in `modelApiPacking.test.ts` and
  `observationPack.test.ts`; each guard gets a byte-exact restored red
  drill in `docs/certification/m73.md`. The lane brief limits checks to
  owning suites, the unit type project and changed-file lint/formatting
  on Kubuntu; full quality remains the lead's gate. Fold both behaviors
  into the existing Unreleased Added entry, with no new setting or API.
  Both findings are verified: 57 tests across the three owning files,
  unit typecheck and scoped lint/formatting passed on Kubuntu. Three red
  drills failed as intended and restored byte-exact; the results and
  hashes are in `docs/certification/m73.md`. No lane blocker remains;
  review and aggregate quality belong to the lead before integration.

- **First review (RV73) repaired, 2026-10-02.** Four findings, each with a
  regression and red drills (`docs/certification/m73.md`):
  - A recalled page is framed as untrusted tool data (D49 "Untrusted
    content"): it names the tool its call named, carries the notice, and
    sits between fresh random markers outside the unchanged slice, so an
    interior page of a `web_fetch` result keeps its boundary.
  - The ledger survives resume: the stored session keeps an optional
    `packedTokensAvoided` (a non-negative whole number; older files resume
    at zero), restored into the store while the outputs and their send
    counts start fresh.
  - The live run records its packing acceptance in the report
    (`packingEngagement`, verdict `fail` when a long-output task never
    packed) before it prints or writes it.
  - The recall row's heading and refusals are `UI_TEXT` in all fifteen
    tables, counts through `Intl`; the recalled text is shown as it was
    and the model's text stays `MODEL_TEXT`.
- **Main integration, 2026-10-02 (M73m).** Merge `origin/main` at
  `44b76f24` into `feature/m73-packing`, preserving final M75 behavior and
  main's changelog entries. Kubuntu passed the owning M73/M75 suites
  (14 files, 627 tests), all five type projects and the code-intelligence
  fixture, scoped lint, formatting, dead code, duplication, localization,
  host API, cycles and production build. The build needed a private copy
  of the rig's linked dependencies for its path-based bundle-split check;
  no source or gate changed. Results are in `docs/certification/m73.md`;
  full quality and the live paired evaluation remain the lead's gates.
  No live or paid run is authorized.
- **Goal.** Long sessions stop resending large old tool outputs.
- **Scope.**
  - NVIDIA SoL-Pi's ObservationPack design, implemented for the Model API:
    a tool result over a threshold is
    sent whole for its first requests, then as a placeholder with an id,
    size, and first and last lines.
  - `recall_output(id, offset)` pages the original back. Originals are
    kept with the session.
  - The swap is sticky, so the cached prefix breaks once per output.
  - A savings ledger shows the tokens avoided in Account & usage.
  - SoL-Pi's Evidence-Preserving Reducer for long command logs: a
    separate model call that shortens a log while keeping its error
    evidence. It is a paid use (D48) and is under the same gate.
- **Backends.** Model API. Muse Code has no hook for this.
- **Gate.** Built after M75, and lands with its own M75 run. Until that
  run shows the capability floors held, there is no setting and no path
  that packs an observation; then the setting is added, still off by
  default. A failed run reworks the mechanism; it does not ship.
- **Acceptance.** `recall_output` returns the original bytes; the swap
  happens once per output; the ledger matches the tokens left out.
- **Tests.** The fake Model API with long outputs, and its M75 run.
- **Size.** S.
- **D78 released-main default (2026-10-04): on.** The owner's target makes
  `museSpark.modelApiObservationPacking` available by default.
  **Candidate packing default: on.** M101INT integrated the released manifest
  and runtime default with the README; ACP/headless uses the same shared packing
  engine. Explicit-off requests retain their golden bytes.
- **Status 2026-10-02: shipped off by default after its M75 run passed.**
  Built 2026-10-01 on
  `feature/m73-packing`, from M75's merged head. What is in it:
  - `src/core/backends/modelapi/observationPack.ts`: one session's store.
    An output over 8,000 characters rides whole for 2 requests, then as a
    placeholder (its call id, characters, lines, a token estimate, its
    first 4 and last 4 lines, bounded under the threshold); the swap is
    sticky, so the placeholder is the same text every request. A request
    counts once it is really sent, at the client's last step before
    `fetch` (`ResponseAttemptGuard.onRequestStarted`), and an HTTP retry of
    the same request counts once. `recall_output(id, offset)` pages the
    original back 4,000 characters at a time, never splitting a character;
    the replay keeps every original (placeholders never commit), so a
    restored session packs again from the whole outputs; a compaction
    forgets the store's originals and keeps the ledger.
  - The host builds the store only while its `observationPacking` dep is
    on and never for a subagent, which is also refused `recall_output`
    (a read-class tool: no card). The dep is read when a session is
    created or resumed: `museSpark.modelApiObservationPacking` (since its
    run passed, below) or the M75 arm.
  - The ledger rides on `tokenUsage` (`packedTokensAvoided`) to Account &
    usage's Tokens section, "Packing saved (estimate)", shown only while a
    session packs; the estimate is 4 characters a token, net of what the
    placeholder still costs.
  - The M75 side: the `packing` arm (`src/core/eval/mechanisms.ts`); two
    long-output tasks in the task set (`accept-long-middle-value`,
    `heldout-long-middle-rule`: a 512-record evidence file whose middle
    record is needed after two more requests), so the set is twelve tasks,
    seven accept and five held-out, under the same 0.75 floors (6 of 7, 4
    of 5); results record the ledger and successful recalls; the live run
    passes only if packing engaged on every long-output task it ran
    (`unengagedLongOutputTasks`).
  - **Not built: the Evidence-Preserving Reducer.** The evaluation refuses
    every paid use (D48), so it cannot measure a paid reducer, and the gate
    forbids shipping what is not measured (§3).
  - **The M75 run passed (2026-10-02, after the RV73 repairs):** both
    arms 7/7 accept and 5/5 held-out against the 0.75 floors, packing
    engaged on both long-output tasks, 111 model calls on the contributor
    model for $0.0156 (`docs/certification/m73-run.md`). On the long-output
    tasks packing sent 39% fewer input tokens at about the same cost: what
    it leaves out was mostly read from the cache. So, as the gate says,
    the setting was added, off by default and machine-scoped:
    `museSpark.modelApiObservationPacking` (VS Code only; the ACP agent
    does not pack).
  - The WIP of `integrate/m73-m75-join-20260930` (staged tree `d52b6a9a`)
    is archived as `_archive-2026-10-01/m73-m75-join-wip`; what was kept
    and dropped is in `docs/certification/m73.md`.

## M74 — Long tasks: automatic compaction and handoff (D49)

**Status 2026-10-02: built.** Status evidence: `docs/certification/m74.md`.

**M74fu follow-ups verified, 2026-10-02 (`fix/m74-followups`).** The four
review findings after PR #71 are fixed: share one conversation-replacing operation
lock between handoff Start and plan actions (P2-2); explain a deferred
brief read and retry it after sign-in/key activation completes (P2-1);
retain a current handoff when its brief read throws while admission is
closed (P3-4); and refuse a composer send during distillation, keeping its
draft and attachments, while allowing Start's own brief send (P3-3).
The composer guard runs before the first auth/session await as well as
after preparation awaits, so an admission hold cannot lose that draft.
The existing controller and reducer reuse the busy and sign-in text.
The four owning suites and the UI-state suite pass 606 tests on Kubuntu;
nine guard drills fail as intended and restore byte-exact by SHA-256.
The five TypeScript projects, ESLint, Prettier, dead code, duplication,
localization, host API and production build pass there too, with unchanged
caps (extension 552.2/600 KiB, Model API 353.5/400). Evidence and exact
bindings are in `docs/certification/m74.md`. The full quality gate remains
the lead's per the lane brief. No origin push,
live call, new dependency, setting, wire shape or escape hatch.

**Main merge, 2026-10-02 (M74m).** Merge `origin/main` at `2a03a79b`
(M84, M75 and 0.10.1) into the handoff branch at `aa37274e` (`91329eb8`),
then include PR #74's documentation audit at `2067d2f9`. Keep both
features and the released changelog unchanged. Share files join the
handoff's one-modal rule: a waiting or edited brief stays in state while
the share is open, then opens with focus when it closes. Both arrival
orders have regression coverage. Current merge evidence is recorded in
`docs/certification/m74.md`; the full four-machine gate remains the lead's.

**Historical note, 2026-10-02 (this tree, `feature/m74-handoff`).** Manual
`/handoff` is built: ported onto the release candidate (`41ed14bf` on
`8e9d3a1e`), fixed for the ten findings of the RV74 review (one commit
per finding), for RV74c's (a refusal at the sign-in guard answered, one
modal at a time, the withdrawn-distillation guard tested) and for
RV71x's (Cancel and Start while admission is held: the handoff as one
owned operation), and merged with `main` at `3614409e`, its shared-table
fixes kept as `main` has them (certification
`docs/certification/m74.md`). Automatic compaction, the hidden todo
follow-up and the memory flush are not built (see "Not built" below), so
M74 is not complete. On this tree the M74 test files (nine files, 791
tests with the M45 goal fixes below) pass on the kubuntu and Mac mini
rigs; every M74 guard was broken on purpose, seen red and restored byte
for byte (sha256), or is recorded as backed by another check (five are;
O17, the one that had neither, now has its test); and the typechecks (host, unit,
webview), `eslint` and Prettier on the changed files, `check:l10n`,
`check:host-api`, `deadcode` and `jscpd` pass on kubuntu, and so did
the `handoff`, `usage` and `agents` accessibility scenarios at RV74c (the
webview has not changed since). The handoff had pushed
`dist/extension.js` and `dist/modelApi.js` over their caps (601.3 and
401.3 KiB); the lead's fix, the shared English table
(`build/shared-ui-text`, merged at `f5f9006f`), brings every bundle
within its unchanged cap (on this tree, kubuntu: `dist/extension.js`
531.0 of 600 KiB, `dist/modelApi.js` 328.0 of 400, `dist/uiText.js` 74.3
of 100, `dist/webview/main.js` 782.7 of 900). Where `node_modules` is a
junction (the Windows host) or a link to another checkout (the kubuntu
rig's test worktree), the build's split check reports the page worker's
parser packages missing: esbuild names them by the link's target, outside
`node_modules/`; they are bundled (the certification has why), and the
checks the chain then skips (`check-host-globals`,
`third-party-notices`) pass run by hand. After the shared-table merge the
M74 test files and all 24 checkpoint test files passed on the kubuntu and
Mac mini rigs (the twelve M72 checkpoint failures and the
`checkpointModelApiStop.test.ts` hang seen before it, identical on
`8e9d3a1e`, were gone); the checkpoint files were not re-run for RV74c,
which changes no checkpoint code. Not run here: `harness:shots`, the
integration tests, a production build with a real `node_modules` and
`npm run quality` (the lead's four-machine gate).

- **Goal.** Hours-long tasks keep their thread without a manual
  `/compact`.
- **Scope.**
  - Compaction is considered when a todo item completes. It uses
    SoL-Pi's cache economics with the selected model's cache-write/read
    prices (measured re-prefill time for local models), and compacts near
    the window independently of the economic decision.
  - A hidden follow-up restores the full exact todo list and current goal
    from authoritative host data, never a model guess.
  - A memory flush before compaction (OpenClaw). It is a memory write,
    so it asks in Manual and is refused in Plan and Restricted Mode, and
    notes drawn from untrusted content stay labelled as untrusted.
    Compaction summaries keep that label too.
  - `/handoff` starts a new conversation from a distilled brief (Amp).
- **Backends.** Model API. Muse Code compacts itself.
- **Gate (D81.3 supersedes the original default).** The automatic setting
  exists and defaults on, but the production latch remains inactive until
  its current paired M75 run passes and shared D78 admission is connected. `/handoff` is the user's own command, so it ships
  without that gate; M79 reuses its path.
- **Acceptance.** Compaction never drops the todo list or an untrusted
  label; `/handoff` shows the brief before the new conversation starts.
- **Tests.** The fake Model API across a compaction, and its M75 run.
- **Size.** M.
- **Built:** manual `/handoff` and the C1/C2 compaction mechanism. C2's
  automatic trigger, memory flush and authoritative todo continuation are
  implemented (2026-10-05, `docs/certification/m101-c2.md`) but production is
  inactive, awaiting the current M75 pair and shared D78 admission wiring.
- **Remaining certification:** lane E's frozen current M75 compaction pair,
  with both 0.75 floors and real compaction evidence; connecting the missing
  shared D78 admission/ledger in this base; combined provider registry and
  platform integration. Q-M74 is resolved by D81.3; consent is no longer an
  owner question. The production latch remains false, so M74 is not yet
  certified complete. Manual `/handoff` and `/compact` remain available.
- **Decisions taken for `/handoff`:**
  - One owned operation per handoff, reserved before any preparation
    await; its session and the conversation's generation stay current
    through preparation, and an ordinary turn that starts meanwhile
    refuses the handoff instead of the distillation steering into it.
    Cancel invalidates a Start until the shared brief path commits the
    new conversation. The reviewed brief's UTF-8 size (256 KB) is checked
    before anything is cleared or sent.
  - `/handoff` (optionally with a goal after it) is the user's own command
    and ships without the M75 gate: it asks the model, as the user's own
    turn in the current conversation, for the distilled brief (goal,
    decisions, files touched, open work, todo list), shows it in a dialog
    before anything starts, and starts the new conversation on confirm
    through M79's `startFromBrief` path (`ConversationBrief`, one path, no
    duplicate) — or cancels and nothing starts.
  - The brief is the reviewed text itself as the first message (no file
    travels); the goal and the open items travel in the model's note, and
    the open items (never completed or dropped ones) become the todo list
    before the first request. The request turn's own card stays in the
    transcript.
  - Untrusted content stays labelled: the request makes the model mark
    tool-output, fetched-page and imported-file content `[untrusted]` in
    the brief, and the seeded note tells the new conversation what the
    label means (D49).
  - **The start mode (RV74 finding 1; the lead's decision, 2026-10-01).**
    The model wrote the brief, so it counts as approved, and starts in the
    starting mode as an approved plan does (`briefMode`: Manual when that
    is Plan, never Bypass in a remote window), only when the dialog showed
    the user all of it before Start: the whole brief, and the open items
    it seeds, which the dialog lists under Tasks, with no character the
    dialog does not show (`hasUnshownCharacters`: a control or format
    character). Otherwise it is untrusted content and starts in the
    asking mode (`untrustedBriefMode`, as a plan picked from Plans…
    does), and the panel names the mode. A handoff from a conversation in
    Plan mode stays in Plan (`ConversationBrief.shouldKeepPlanMode`), whatever
    either rule says.
  - A brief waiting in its dialog comes back to a rebuilt panel
    (`surfaceReady` posts its `handoffReady` again, RV74 finding 3): the
    host keeps the handoff, so without its dialog every later `/handoff`
    would answer "already running".
  - The composer keeps `/handoff …` until the host answers
    (`handoffCommandResult`, RV74 finding 4), as for `/goal`: a refused
    handoff keeps its typed goal; an accepted one clears the draft unless
    it was edited meanwhile. Every refusal answers, the sign-in guard's
    too (RV74c N1): a request or a Start refused while the backend's
    admission is held (a key activation, with the panel still reading
    signed in) gets `accepted: false`, so the command and Start work
    again once admission returns. The same guard now answers M45's
    `goalCommand` too (released behaviour, the same defect; the lead's
    decision, 2026-10-02: its own commit and `[Unreleased] ### Fixed`
    entry; certification `docs/certification/m45.md`, drill G55), and
    so does every exit of the goal command before the host has it
    (admission closing, the account ending or a restart during its host
    lookup; drills G56–G58). One the backend already had when a key
    activation or a restart lands is answered refused too, with
    `goalOutcomeUnknown` (it may or may not have taken effect), and the
    goal is read back from the backend before the conversation's next
    action (drills G59–G61).
  - The handoff is one owned operation (RV71x N5, N6; the lead's rule,
    2026-10-02). Cancel is never auth-gated: releasing an operation the
    panel owns needs no admission. After every await of the request, the
    brief read and Start, one check (`isStillCurrent`: generation,
    session, ownership and admission) runs, and nothing is cleared or
    left before it passes; Start's lives in the shared `startFromBrief`,
    so M79's Implement gets it too. A refusal for admission leaves the
    operation waiting with its dialog intact: Start works again once
    admission returns, and a brief whose read admission put off is read
    after sign-in/key activation completes, on the next `/handoff` or a
    rebuilt panel, with the sign-in reason said while the read waits. A
    read that throws while admission is closed keeps its operation. Start
    shares the plan actions' operation lock through the new brief's send,
    and composer sends cannot steer a submitted distillation, even before
    its acceptance arrives; refusal restores the exact draft unless edited.
  - One modal at a time (RV74c N2): a brief that arrives while Account &
    usage, the Agent map or the install confirmation is open waits,
    unmounted, until that dialog closes, then opens with the focus, so
    its Start is never reachable under a dialog that hides it. Closing
    the handoff dialog (Cancel, or the new conversation clearing it)
    hands the focus back to the prompt, as the other dialogs do.
  - Model API backend only: on Muse Code the command says it is
    unavailable there. Side chats are refused; one handoff runs at a time;
    a `/handoff` while a reply runs is refused ("Wait for the reply to
    finish, or stop it, first."; nothing waits or queues, RV74 finding 8);
    an oversized (over 256 KB) or empty brief is refused with the reason.
    No new setting: nothing automatic runs.
  - A built-in `/handoff` takes the name from a skill of the user's or the
    project's own called `handoff` (RV74 finding 10; no skill or command
    Muse Code 1.4.0 ships is named so). The lead's rule, 2026-10-01:
    built-in command names win over a user skill of the same name, as
    `/goal` does; no code change.
  - The port's history (the four conflicts, the merge fixes) is in the
    certification. No escape hatches (§8: nothing to record).

## M76 — Custom agents (D49)

- **Main integration, MG70, 2026-10-02.** Finish the active merge of
  origin/main `0e9546e0` into `feature/m76-agents`, preserving M76 and main's
  imports, handoff, observation packing, session transfer and release/docs
  work. Regenerate the host API record on Kubuntu and retain main's released
  changelog bytes. Repair the merged fake-host dependencies and retained
  test helper calls after observing their compiler/test failures. The
  joined import bundle test duplicates M76's shared-text build plugin;
  reuse that existing plugin after observing jscpd's clone failure. Run the
  owning suites and static checks serially on Kubuntu, then commit with
  normal hooks and no push. Aggregate quality and editor/platform gates
  remain lead-owned under `MG70.md` and `common.md`.
  **Lane result:** 1,863 tests in 42 owning/affected files pass on Kubuntu,
  with no skips, and all eight serial static/build commands exit 0. The
  regenerated host record reports 273 APIs and zero problems. Compiler,
  Manual-policy test and duplication-gate failures were observed before
  their repairs; the merge receipt is in `docs/certification/m76.md`.

- **Main integration, M76m, 2026-10-02.** Join origin/main `2067d2f9`
  (M75, M84, 0.10.1 and the documentation audit) into `feature/m76-agents`.
  Preserve both sides' behavior and documentation, regenerate the host API
  record on Kubuntu, and keep every released changelog section byte-identical
  to main. The joined M75 evaluator needs M76's three host ports: no personal
  agent root, the existing non-confidential evaluation workspace, and the
  evaluator's contributor-model consent (paid child tasks still refuse).
  Record the failing compiler and owning evaluator test before that repair;
  run the lane's owning tests and static
  checks serially on Kubuntu. Aggregate quality, editor/platform and release
  gates remain lead-owned under `M76m.md` and `common.md`.
  **Lane result:** all five typecheck projects and the seven remaining lane
  checks pass on Kubuntu; 1,601 tests in 34 owning files pass with no skips.
  The regenerated host record reports 266 APIs and zero problems. The
  evaluator's paid refusal fired red before repair; its 134 controls pass
  after. All production build subgates pass without changing a cap. The
  conflict resolutions, rig setup and receipts are in
  `docs/certification/m76.md`.
  **Updated main:** first join committed as `0621fda9` with normal hooks;
  then join `555f764a` (PR #64, encoding compatibility), preserving both
  changelog/plan additions and removing four exact Unreleased duplicates
  already released on main. A fresh private rig install takes sniffer 7.0.0.
  All eight lane commands pass again; 1,634 tests in 37 files pass with no
  skips. The encoding source/tests remain byte-identical to main and the
  host API record is regenerated again on Kubuntu. Final extension size
  is 544.1/600 KiB, Model API 359.9/400 and page worker 203.2/300; all
  production build subgates pass. The record above binds this final join.

- **Independent-review corrections, 2026-10-01 (M76b).** Reproduce RV76's
  three findings on `eb606fcb` with fake HTTP, then commit each smallest fix:
  preserve the child's Manual/Edit automatically policy through parsing,
  persistence and approval routing while retaining the parent ceiling; admit
  spawns against the effective child tools and refuse an empty set before a
  paid request; localize allowlist refusals in all 14 tables while retaining
  English model output. Drill each new guard with SHA-256 restoration.
  No candidate merge this round. Focused tests run on rigs in slot `m76`;
  serial local lane gates run before handoff. Full quality and editor/platform
  certification remain lead-owned under `common.md`.
  **Lane result:** all three findings reproduced on `eb606fcb`, fixed with
  fake HTTP, and drilled with byte-exact restoration. The final affected
  suites passed 813 tests on Kubuntu; all eight required serial Windows
  checks passed, including the production build within every existing cap.
  `docs/certification/m76.md` records the original failures, five drills and
  gate receipts. No candidate merge was performed this round.
- **Second independent review, 2026-10-01 (M76c).** Two findings, both
  confirmed by a failing regression first. A `then_run` an agent without
  the shell refused showed the English model sentence in its localized line
  under the edit: the row now takes `UI_TEXT`, the model keeps `MODEL_TEXT`.
  The **Check edits** body is the model's note and stays English like every
  check sentence in it (its summary line is localized; a check's `detail`
  is not rendered), so the docs were narrowed to say so. A spawn whose agent
  lists no offered tool asked the contributor yes and the paid-use popup
  before failing: it is now refused before both, and met again at child
  creation, since the offered tools can change while a popup waits. Three
  drills restored byte-exact; joined origin/main `2a30b1a0` first.
  **Lead decision, same review:** the same two kinds, older than M76, fixed
  too (owner rule: no deferrals). `settledSpawn` settles a spawn that starts
  no child (worktree isolation, a `command_id` reused for a different task,
  the per-conversation limit) before the contributor yes and the paid-use
  popup, and a retry under the same `command_id` answers with that child
  without asking again. No re-check follows the popups: a turn's calls run
  one at a time, only a spawn adds a child or a command id, and a child
  cannot spawn. M68's `hookInputNoCommand` gets a `UI_TEXT` key in all 14
  tables for the `then_run` line; the model keeps `MODEL_TEXT`. Five drills
  restored byte-exact.
- **Third independent review, 2026-10-02 (RV70x, structural round).** Four
  findings (three P2, one P3). Owner rule at a third round: fix the shape,
  not the instance; the lead set three shapes, built as specified after
  joining origin/main `3614409e`.
  - **S1, catalogue precedence fails closed** (finding 1: a personal root's
    EACCES discarded a read project agent, and the inheriting built-in of
    its id wrote under Auto). `loadCatalogFiles` lists each root on its own:
    a listing failure is a warning naming that root (`loading the user
agents failed: …`), and the other roots load. Each root also reports
    what it holds but did not yield (a file unreadable, over its cap,
    refused, past the limit). `loadAgents` turns both into holes, and
    `resolveAgent` walks project, personal, built-in: a hole that may hold
    the name refuses it, naming the folder or file, before any lower
    definition can stand in. Only names that resolve are offered to the
    model. The skills share the loader, so one skill root's failure no
    longer hides the other's skills either.
  - **S2, spawn admission is one ordered pipeline** (findings 2 and 4).
    `decideAndRunSpawn` owns the order: the mode (Plan refuses a retry
    too), then an existing `command_id` (`existingSpawn`: an exact retry
    answers with its child before any new-child admission; another task is
    refused), then `admitNewSpawn` (isolation, the limit, the agent, its
    tools, the paid gates; nothing awaited), then `consentToChildTask`,
    which takes the grant and each wait in turn (the contributor yes, the
    PermissionRequest hooks, the paid-use popup) with `recheckAdmission`
    after every one: trust for a custom agent, Plan, paid subagents, the
    price, a contributor model in a confidential workspace, the model, the
    key, the goal, and the tools the agent meets. The child starts on the
    last recheck with nothing awaited between. Model follow-ups and the
    user's own follow-ups and reopens take the same waits and rechecks.
    This supersedes M76c's "no re-check follows the popups".
  - **S3, the child's policy is one table** (finding 3: an Edit
    automatically child prompted under Auto and Bypass).
    `childPermissionMode(parent, child)` in `approvalRules.ts` is the less
    automatic of the two in the order Plan, Manual, Edit automatically,
    Auto, Bypass (the parent's when the agent names none);
    `editAutomaticallyChoice`, which the panel and the ACP agent share,
    answers under it. So a Manual parent caps every child, a Manual child
    always asks, an Edit automatically child keeps its automation under
    Auto and Bypass, and protected, replayed and escalated requests are
    never automatic. A table test covers all 30 (parent × child) pairs and
    holds the host's `narrowApprovalMode` to the same order.
  - One regression per finding, each failing without its fix; five drills
    restored byte-exact (`docs/certification/m76.md`). The refusal for a
    root that did not load is a new `agentUnloaded` string in all 14 tables.

- **Goal.** Specialised agents with their own prompt, tools, model or
  effort, and permissions.
- **Scope.**
  - Agent definitions in Markdown with front matter, in the project and
    the user folder. The folder follows Muse Code's own convention if its
    binary or docs name one (D13: no invented file names); otherwise the
    name chosen is recorded in D13 as the extension's own. Claude Code's
    and Codex's formats are imported (M83). M83, built first, writes
    imported agents to `.agents/agents/<id>/AGENT.md` and
    `<config>/muse/agents/<id>/AGENT.md` (`PROJECT_AGENTS_DIR_SEGMENTS`,
    `PERSONAL_AGENTS_DIR_SEGMENTS`): M76 loads from there, or moves both.
  - Built-in agents:
    - **Explore**: read-only, context-saving;
    - **Reviewer**: built in M70, and becomes the first definition in
      this format;
    - **Second opinion**: a high-effort consult on a hard question.
  - A run that makes model calls beyond the user's own turn is a paid
    subagent use (D45, D48).
  - A repository's agent files load only in a trusted workspace, and can
    only narrow the tools and permissions the session already has. A
    model one names passes the same checks as the user's own choice
    (`allowsModel`: contributor models, `museSpark.confidentialWorkspace`).
- **Backends.** Model API. Muse Code has its own agents, which the
  Agent map already shows.
- **Acceptance.** An untrusted workspace loads no project agent; a
  project agent that asks for more tools or permissions than the session
  has gets the session's; a model it names passes the user's checks.
- **Tests.** Front-matter parsing with zod, and drills for each narrowing
  rule.
- **Size.** M.
- **Lane review 2026-09-30.** Recheck workspace trust at child creation,
  after contributor and paid consent waits; a revoked workspace must create
  no custom-agent child or paid model request. Explicitly label role text
  as untrusted in the model prompt. Recheck trust before agent loading and
  discard a catalogue completed after trust withdrawal. Restore the missing certification record
  with current lane checks and red/restored proofs; lead-owned aggregate and
  platform gates remain open. The brief's handoff was missing during this
  review; the lead restored it before the 2026-10-01 resume.
  The inherited retained-surface checkpoint test must await its existing
  preparation hook before its model-request assertion; repeated lane runs
  raced real Git setup. Preserve its request deadline, test timeout and
  restore assertions. Record the two test-only session casts in §8 and
  select a known approval-mode member without an unchecked cast.
  Read the canonical file that confinement approved, rather than resolving
  the project alias again after a symlink/junction may have changed; a link
  swap regression must keep outside prompt text out of the catalogue.
- **Status 2026-09-30: built.**

Status detail retained: built on `feature/m76-agents` over the M72 release
candidate (`1fd98aaf`), after a first build on 2026-09-28 (Muse Code) and
a resume that ported it over main `32709441`; the record is
`docs/certification/m76.md`. Reviewed in three classes (concurrency and
lifecycle; validation, confinement, trust and the paid rule; failure
paths, honesty and docs), with the findings below fixed. M70's Reviewer
joins the built-ins when M70 lands, and M83 imports Claude Code's and
Codex's formats through `parseAgentFile`; neither is part of this
milestone.

- **Decisions taken while building.**
  - **Lead decision 2, resumed 2026-10-01.** Withdraw the empty English
    table substitution and its test/gate/docs as a separate commit. Merge
    `build/shared-ui-text` (`44d920fd`) and use its shared `dist/uiText.js`
    runtime fallback for every Node bundle and the ACP package. No other
    build-layout change or cap increase is authorized. Refresh the lane
    checks after joining the current M72 candidate.
  - **Resumed lane verification 2026-10-01.** Removed the rejected approach
    in `8f697aff`, merged the approved shared fallback in `2688de3f` and
    the candidate `2ae4caf7` in `18f9262b`. All required lane checks passed;
    897 tests in 16 files, two existing platform skips. The shared-layout
    test fired red and restored byte-exact; an offline installed ACP tarball
    and the actual Node bundles load English successfully. The joined
    checkpoint fixture's two clones were removed by shared setup and
    expected blob data, preserving assertions and platform conditions.
    Final sizes: extension 523.4/600 KiB, Model API 337.4/400, checkpoint
    store 120.6/225 and shared table 73.0/100. Merged the final candidate
    `d09d472f` in `80a33895`, retaining its mode-aware expectations and the
    shared fixtures. All nine lane checks passed again on the affected
    join: five-project types, affected lint/format, knip, zero clones,
    localization, host API, build and 50 checkpoint tests in four files
    (six inherited platform skips). The current runtime smoke passed;
    installed ACP, Model API and shared-table bytes match the final build.
    Full quality, independent review and platform/release gates remain
    lead-owned; no lane check is pending or red.
  - **Prior lane verification 2026-09-30.** Merged the current candidate
    `8d59fb5c` in `486f33c2`. All required lane gates passed: five typecheck
    projects, changed-file lint/format, dead code, duplication, localization,
    host API, build and 891 tests in 15 non-live files. Seventeen retained
    intentional failures proved the feature guards; exact SHA-256 restoration
    and green reruns are in `docs/certification/m76.md`. Final sizes are
    extension 595.8/600 KiB, Model API 337.4/400 and checkpoint store
    192.7/225. The handoff was restored and read on resume; full quality,
    independent review, four-machine and release gates remain lead-owned.
  - **The folder** is the extension's own (D13's addendum): the CLI names
    none.
  - **One loader.** `src/core/context/catalogFiles.ts` serves skills and
    agents (the duplication gate's threshold is 0), and `skills.ts` keeps
    its behaviour. A file is read through `ContextIo.readFile(path,
maxBytes)`, which returns at most one byte past the cap and only for a
    regular file, so a huge file, a pipe or a device never reads whole; the
    skills' log line for an oversize file therefore drops the file's size.
  - **`subagent_spawn` takes an optional `agent`**: no new tool, no palette
    command, no `/agent` invocation. The `# Agents` catalogue (id, source,
    description) rides the parent's instructions while paid subagents are on
    and the workspace is trusted; a child's role rides its own, labelled
    with its source and id, below the workspace rules and skills, as text
    that cannot add tools or permissions.
  - **Narrowing only.** The child's allowlist is the agent's list met with
    the tools the session offers (a list that meets nothing fails the spawn
    loudly, before any popup asks) and binds every call before any dispatcher, memory's included;
    the mode is the agent's when it is not wider than the session's, in the
    order denyUnmatched < promptUnmatched < onRequest < allowAll (the modes
    menu's order, not `APPROVAL_MODES`'s), and a mode switch re-narrows;
    automatic checks need `run_checks` or the shell in the list, and
    `then_run`, which runs any command line, the shell; the model is the agent's or the session's; the effort is the
    agent's, else the default, dropped to the highest tier the model serves
    (D10). A stored, resumed or forked child keeps its narrowing.
  - **Untrusted input.** Front matter is parsed with zod after a line
    reader that reports what it could not take (a list, an indented value,
    a repeated key); such a file is refused, and so is a `tools` line naming
    no tool (it used to read as "every tool"). Name, description and model
    are bounded (64, 240, 64 characters) and free of control and format
    characters; at most 32 files load; a file agent shadows a built-in or
    personal one with the same id, with a log line.
  - **Trust.** A repository's files load only in a trusted workspace; the
    catalogue and every spawn are refused once trust is lost; a resumed
    child's project-file role is left out while untrusted; a child reads no
    agent directory.
  - **Paid (D48).** An agent run is a paid subagent use: its popup names the
    model and its price; a model other than the session's asks even when
    subagents are allowed always here, because "always" was given for the
    model the user saw priced. A contributor model asks the contributor yes
    for each spawn, and for a follow-up this session was never given it for
    (a child resumed in a new window); a confidential workspace blocks it,
    at the grant and again at a queued start.
  - **Built-ins.** `explore` reads, searches and lists (and `read_skill`
    when skills exist) on the session model; `second-opinion` runs at high
    effort with the session's tools. They survive an unreadable agent root.
  - **Not built.** No file watcher (agents load once per conversation), no
    palette listing, no per-agent settings; Restricted Mode and the ACP
    agent (no subagents, D62) offer none.
- **Owner's choices taken as the safest default.** A role below the rules
  that outrank it, not first; an agent's effort may exceed the session's
  (Second opinion's purpose) and the popup does not name it; a project file
  may shadow a built-in; the contributor yes per spawn, not per
  conversation. Each is listed in the certification record.

## M78 — Auto, made safe (D49)

**Status 2026-10-02: built.** Status evidence: `docs/certification/m78.md`.

**MGCOH main merge, 2026-10-02.** Integrate `origin/main` at `0e9546e0`
into `feature/m77-m78-m82` at `8c72bdcc`. Main already includes M84,
0.10.1, M74, the editor-guide fixes and M83's import. Preserve every
cohort and main feature, all translated keys, every lazy bundle's gate and
CI package membership. Regenerate the host API inventory and package
notices on Kubuntu. Keep the activation, Model API, board and reviewer
caps at 600/475/75/75 KiB. The MGCOH receipt in
`docs/certification/m78.md` records the merged-source checks; full quality
and publication remain the lead's responsibility under the lane brief.

**MGCOH current-main follow-up.** Main advanced during the first merge's
hooks to `8dac84cf` (M84's narrow-share focus fix, PR #80). Retain that
fix unchanged and resolve the App test's imports with both the share page
constant and the cohort's paid tally fixture. The same 32 owning files
pass all 1,727 tests again at snapshot `5c8e2f1d`. Scoped static gates
and all four narrow-share accessibility themes pass at `f6ec1cc0`.
The extra README screenshot command's wide Chrome CLI step hangs on this
rig; a bounded direct-binary retry times out. The narrow Playwright
capture renders correctly, but no clean wide screenshot-command pass is
claimed. Record that optional browser-runner blocker in the certification
without changing main's source or any gate. This adds no feature beyond
current main and changes no cap or approval policy.

**Main merge, 2026-10-02 (M78m).** Merge `origin/main` at `e66263f1`
(M74's handoff, with M84, 0.10.1 and the documentation fixes already in
the cohort's ancestry) into `1372f047`. Keep both features whole. The
controller test helper retains both M74's held-host callback and M82's
owned voice-budget scope, and the paid palette's regression names M78's
reviewer and M77's best-of-N beside the five existing toggles. M74 adds no
dispatcher tool or tool-output path, so the existing M78 fence table still
covers the complete dispatcher. Unreleased milestones stay under Added;
the released changelog remains byte-identical to main. The host API record
is generated on Kubuntu from the merged source. Scoped evidence is in
`docs/certification/m78.md`; aggregate quality remains the lead's gate.

**RV78g review fix, 2026-10-02: an outcome that cannot name its files fails
closed.** Muse's review of the choke-point fence found one P1, four P2 and
four P3, most from one root: the fence trusted `touched`, but a command's,
a server's, the IDE's or a child's output cannot list every file it quotes.
The lead's decision: `ToolOutcome.touched` is `{ names, complete }` and
defaults to incomplete. Only tools whose output provably carries just the
listed files say complete (`read_file`, `list_files`, `search`, the writes
and edits with rename, the image tools, memory with its note, `read_skill`).
The dispatcher judges a complete outcome as before; an incomplete one is
also refused when the file policy's revision moved at all since admission.
The revision (`filePolicyRevision`) is a digest of the profile, its
deny-read globs, deny-all, extra roots and the trust, recorded in each
`Admission`: a digest, not a counter, so a stored child result is judged the
same way after a restart, and no glob or root is stored. Each child records
its spawn admission's revision (persisted with it and with each pending
result): a drained result is withheld when it moved, after a resume too, and
`subagent_wait`, `read_result` and `status` carry their children's
revisions; a result saved before revisions is withheld. `addIndexLine`
throws its owner's Stop on after logging, so `add_memory` ends as a stop; a
refusal of the index line alone still keeps the note reported written
(`IndexLineStoppedError`). The store hands the I/O its caller's own guard
and asks it once more after a failure. Every table row runs again with a
deny on a file no call reads (complete rows delivered, opaque rows refused),
the no-I/O row is checked against the fakes' I/O counters, egress rows
assert no image request and nothing billed, and the subagent rows quote a
marker. Seven red drills are in `docs/certification/m78.md`.

**RV78f review fix, 2026-10-02: the fence at its two choke points.** The
follow-up review found three paths the per-I/O fence missed (an image
edit's sources sent to Meta after a deny landed during the reservation
awaits; `read_skill`, which consulted no file rule; MCP and IDE results
after their await), image and PDF reads with no regression, and a Stop
during a memory read reported as a file error. The lead's decision: fencing
tool by tool keeps missing the next tool, so the fence moves to the two
places every path crosses. **The dispatcher's fence**: `runCall` judges
every call's outcome, from every tool, built-in or external, with
`policyRefusal` over the call's `Admission` (its query, its judgement after
any card, and now the workspace's trust) and the files the outcome reports
in `ToolOutcome.touched`, synchronously right before the outcome is built
for the model. Every path that runs a call fills an `AdmissionSlot` at its
admission; a tool that reports no files is judged on verdict, mode and
trust alone. A refusal replaces the outcome; a read recorded as seen is
forgotten; a write already made is said to stay and keeps its patch on the
row (`UI_TEXT.policyChangedKeptWrite`, 14 tables). A rejection keeps its
own words. The per-tool post-read `readFence` is gone: reads report what
they touched instead. Side effects keep their fence at the moment they
happen: a shell command's process entry, a memory note's write (a read is
the dispatcher's), and **the egress fence**: the image request judges the
call again, with its target and every source, inside each attempt's final
admission, with no await before the send; a refusal sends nothing and
settles its claim at zero. `read_skill` refuses a denied project skill at
admission. `MemoryStore` throws its owner's Stop on, for reads and writes.
A table-driven regression drives every tool the dispatcher knows
(`classifiedToolNames()`) plus an MCP and an IDE tool with its I/O held
while a deny, a mode or a trust change lands; receipts and five red drills
are in `docs/certification/m78.md`.

**RV78 review fix, 2026-10-02: one live policy fence at every I/O.** The
independent review found one class in three places: the command and file
policy was decided before an await and not judged again at the I/O. A
rule-allowed shell command still entered its process after a forbid rule,
an ask rule or a profile arrived during the Windows job assembly's load; a
read finished under the old file rules and its text reached the model; a
memory note was written after its path was denied. The lead's decision:
one fence, `ModelApiHost.policyRefusal`, called at the moment of each I/O
with the current compiled policy (rules, profile, mode) for that exact
operation. It runs inside `ToolIo.runShell`'s final admission callback (as
`runVerifyCommand` already fenced checks), after every read used to build
model input completes (`read_file` text and its images and PDFs,
`list_files`, `search`), and inside every MemoryIo read/write assertion.
What ran with no question must still be allowed; an answered ask must not
now be refused nor newly settled by a rule or the profile; no touched file
may now be denied, nor read under an extra root the profile dropped. A
refusal replaces the outcome (the model gets `toolRefusedByPolicyChange`,
the row `policyChangedRefused`, in English and all 14 translated tables),
so nothing read is sent. A note already written when its new index line
was refused stays reported as written, its index line logged as not
written. Held-boundary regressions and three red drills are in
`docs/certification/m78.md`.

**Final lane receipt, 2026-10-01/02.** Implemented on the release candidate
with the approved shared English fallback (PR #67 tip `909db6736`, merged
as `3375e828`; the named shared branch was deleted by the lead). The required
`integrate/m72-on-24ff` merge reported Already up to date. Every bundle fits
its unchanged cap: extension 581.5 KiB, Model API 372.5 KiB, checkpoint store
126.3 KiB and shared UI table 82.3 KiB. All seven scoped static gates passed,
including all five type projects and zero clones. Final Kubuntu owning run:
51 suites / 2,083 passed / three Windows-only skips. Mac's 51-suite run passed
2,081 tests before the final two UI regressions; its final three UI callers
then passed all 246 tests. Windows VM native refresh passed 278 tests; the
Windows host's shell witnesses passed all 159 with no skips. Eleven unique
red/restored drills fired, with exact source hashes restored; the merged
host's three affected drills were refreshed. Actual 320px viewport/body
measurements and five narrow screenshots prove reflow, and 20 accessibility
pages passed in four themes. This review also caught and repaired the reducer
dropping approval reasons; delivery, stages and restoration are covered.
The installed offline ACP tarball and both extension/backend bundles loaded
the approved English fallback. No controller split, injected-table stub,
cap change, public push or paid call remains. Full aggregate quality,
independent review, installed-host/platform certification and hosted CI are
the lead's remaining gates under common.md, not passing lane claims.

**Resumed scoped proof, 2026-10-01.** The release-candidate port passed all
five Windows type projects and 46 owning Kubuntu suites (1,889 passed,
three Windows-only skips). Windows VM native coverage passed seven suites
(278 passed, 22 platform/capability skips); the Windows host independently
passed all 159 shell cases, including real Bash and PowerShell 5.1.
Ten intended red/restored drills cover rules, missing profiles, reviewer
claims/usage, native file/verification policy and both new UI presentations;
every restoration matches SHA-256. Localization, dead code and the refreshed
host API record passed. Five lane test clones and two invalid `void` types
were corrected without changing assertions, ignores or thresholds. The one
older-base checkpoint clone is already fixed on the release-candidate branch
to be merged. Build sharing follows the lead's `build/shared-ui-text` only;
full quality, independent review and final platform/installed proof remain
the lead's gates. Receipts are in `docs/certification/m78.md`.

**Lane readiness review, 2026-09-30.** Resume from the preserved cohort tree
`23bd93a3647f9029c2c79f5a0f95e3350666efa6`, taking its net feature delta
against main `32709441`. Keep M82's durable spend and M72's current turn,
publication and shutdown fences. Reuse the existing command lexer, policy
compiler, permission engine, paid popup and direct reviewer; no new package,
wire shape, bundle split or setting beyond the planned milestone. Integrate
the held policy/read/format boundaries and M77's rooted attempt editor and
shared edit recorder. Acceptance includes native Bash/PowerShell comparisons,
complex-command fallback, repository tightening, malformed-profile denial,
post-await owner/policy checks, paid consent and finite-cap direct claims.
The resumed native tests also require the automatic verify round to retain
its original edited-file policy fence after a lookup filters denied files out;
an empty allowed-file list cannot authorize a check over a revoked edit.
Focused gates and exact-restoration red drills bind this port. Full quality,
rig and installed/visual gates remain the lead's responsibility under common.md.
The skill's JSON-ledger validator remains deferred for this older canonical
plan; no competing plan or invented certification is created.

- **Goal.** Auto on the Model API earns its name.
- **Scope.**
  - **Command rules**: prefix rules for allow, ask or forbid, with tests
    kept beside the rules.
    - An allow rule matches only a command the shell's own parser reduces
      to simple commands (bash's, or PowerShell's AST), each judged
      alone. Anything else asks: substitutions (`$()`, backticks),
      redirections, background `&`, newlines, `iex`,
      `-EncodedCommand` and the call operator.
    - A forbid matches anywhere in the command.
    - D24's session rules stay keyed on the exact command line. These
      prefix rules are a new, user- or machine-level kind, and D24 is
      amended to name them when M78 lands.
  - **Permission profiles**: named sets of rules covering files (deny-read
    globs) and extra roots. They bind the file and fetch tools. The shell
    tool runs unsandboxed, so under a profile every shell command asks.
  - Rules and profiles live in user or machine settings. A repository's
    can only tighten them.
  - An opt-in **Auto reviewer**: a separate read-only model call judges a
    risky request. It has a circuit breaker, and it is a paid use (D48).
    It can turn an ask into an allow only for a request no rule settled;
    it can never allow a forbid, an ask rule, a protected write (D24) or a
    paid call. A failed call or a tripped breaker falls back to asking.
- **Backends.** Model API. Muse Code has its own policies.
- **Evidence.** Codex's auto-review and rules, OpenCode, Gemini CLI's
  policy engine.
- **Acceptance.** Each rule ships with its tests; a chained, substituted
  or redirected command asks; a repository's rules cannot loosen the
  user's; the reviewer never allows a forbid, an ask rule, a protected
  write or a paid call.
- **Tests.** A table of commands per shell with the expected verdicts, and
  drills for the parser fallback and the reviewer's limits.
- **Size.** M.

## M79 — Plans as files (D49)

**Continuation review, 2026-09-29 (verification held).** Recheck current
workspace trust and controller disposal after saved-plan lookup and the
save confirmation, before writing or starting a brief. A conversation
change alone still permits the already approved plan to be saved; it does
not permit implementation in the replaced conversation. Check the
no-clobber creator's canonical directory before recursive mkdir as well
as after creation and before publication, so a swapped ancestor cannot
create a folder outside confinement before being refused. Held lookup/
modal trust/disposal regressions and a real-disk pre-entry ancestor swap
must fail deliberately and pass restored before this source is certified.
The same no-clobber helper records its stage's dev/ino, checks ownership
before publication and every cleanup retry, and preserves a moved stage
or a replacement file. Stale-stage cleanup rechecks canonical confinement,
identity and captured modification/size metadata before removing a
candidate; a refreshed file is kept. Real-disk replacement, folder-swap
and refresh regressions cover these admitted cleanup repairs.
The 2026-09-29 local proof is preliminary on integrated base `4c35e73e`:
all five type projects, 341 focused tests (one platform skip), scoped lint
and zero duplication passed; six isolated mutants fired all ten new
cases and all three repaired suffix-boundary cases, with 50 filtered
tests restored green. Main has since advanced through M69, so its content
must be included and final gates repeated before merge. The later M68
join must wrap actual canonical plan publication in shared WorkspaceEdits
begin/finally-end for all ledgers and note the owning round only when
no-clobber creation returns true; that API is not copied into this base.

**Status 2026-09-29: built.**

Status detail retained: built on `feature/m79-plans-as-files`, reviewed and
pushed as draft PR #53; certification and review fixes are in
`docs/certification/m79.md`. Hosted Windows quality failed when the
100-name exhaustion test exceeded its unchanged 5-second timeout. Resume
repair passed focused Windows tests: the complete suffix range is proved
with the existing in-memory file port, including the last free name,
exhaustion without replacement and
reuse at the last name; retain the real-file-system publication,
collision, cleanup, bounds and junction tests. Latest-main integration,
independent review and the full candidate gates remain required.

- **Goal.** A plan the user approved survives and can drive a clean run.
- **Scope.**
  - A Plan-mode reply that holds a plan gets **Save plan** and **Implement
    in a fresh conversation**; pressing either is the approval.
  - The plan is saved as Markdown in the workspace: in Muse Code's plans
    folder if its binary or docs name one (D13), otherwise a folder
    recorded in D13 as the extension's own. On Muse Code, what marks a
    plan in a reply comes from a capture (AGENTS.md rule 13).
  - "Implement in a fresh conversation" starts one with the plan as its
    brief, through M74's `/handoff` path.
  - On the Model API the plan's steps become the todo list. On Muse Code
    the todo list is the agent's own, so the brief asks it to take the
    plan's steps as its list.
- **Backends.** Both.
- **Acceptance.** The saved file is the plan the user approved, byte for
  byte; the fresh conversation starts with it and nothing else from the
  old one.
- **Tests.** Both fakes.
- **Size.** S.
- **Research.**
  - **Muse Code 1.4.0**, one live Plan-mode turn (`denyUnmatched`, the
    contributor model, an empty folder, 19 model attempts). The model read
    its bundled `plan` skill and delivered the plan as an ordinary
    `agentMessage`, wrapped in the skill's handoff. There was no plan item,
    exit-plan request or approval event; the skill's own approval is the
    user's next message, "go".
  - **MSP 1.3.0** has `session/todoListChanged` but no command that sets a
    todo list.
  - **The Model API harness** has no plan tool.
- **Decisions.**
  - **The approval.** "Save plan" and "Implement in a fresh conversation"
    appear under the latest Plan-mode reply once no turn runs; pressing
    either is the approval. The host reads the reply back from the backend
    (`readSession`) on every press and takes it only while it is the latest
    finished reply, after the latest prompt, in Plan mode, from a turn this
    panel started in Plan mode that stayed in it (a message steered into a
    running turn does not make it one). The webview's ids only name it.
    - After a restart (a setting, trust granted, the host gone) the
      conversation is resumed first (`resumeTarget`); when the panel no
      longer holds it, the press says so. History mode `none` says the
      history was not served.
    - A second press finds the file already holding the same bytes and
      writes nothing; a plan over 256 KB is refused at save.
  - **The file (D13).** Muse Code's own convention:
    `.agents/plans/YYYY-MM-DD-<slug>.md`, a numeric suffix on a taken name,
    the plan byte for byte.
    - Between a Muse Code plan reply's two captured handoff lines;
      otherwise the whole reply.
    - The slug comes from the top-level heading, else the prompt.
    - No front matter, so the title lives in the file name, and the source
      conversation's session id in the log line that names the file.
    - It is published by a hard link from a hidden stage, so it never
      replaces a file (`createFileExclusively`, shared with memory). A file
      system without hard links refuses the save. A stage the OS holds is
      removed again; one left by a crash is swept after five minutes.
    - It is confined to the workspace's own `.agents/plans`; a link or
      junction there is refused, and the folder is checked again after it
      is made and before the link (memory too), so a swap after the check
      is refused. Node cannot link relative to a folder handle, so a swap
      between that last check and the link is outside the guarantee.
    - `.agents` is a protected path (D24), so the save asks in a modal.
    - Restricted Mode refuses it.
    - The log names the file by a short hash of its name, after its day
      only when the name verifiably starts with a real one (a file someone
      else put there may be named anything), never the slug (M39).
  - **The brief.** "Start a new conversation from a brief"
    (`ConversationBrief`, `startFromBrief`) is its own piece, for M74's
    `/handoff`.
    - The attachment is checked before the old conversation is left.
    - The conversation is then cleared (History keeps it), Plan mode gives
      way to the starting mode, and the brief goes as the first message.
      Its card is the host's `briefSubmitted`.
    - The plan file travels as named text on both backends (M54), after an
      English MODEL_TEXT request and before a MODEL_TEXT note; the card
      shows the localized text.
    - Nothing else from the old conversation comes along: no editor
      context, no reference, no goal.
    - **Two kinds of brief (D49 "Untrusted content").** A reply saved from
      a Plan-mode turn of the conversation on screen is the plan the user
      approved: its note says so, and it starts in the starting mode
      (Manual when that is Plan, never Bypass in a remote window). A file
      picked from Plans… may come from a cloned repository or a tool: it
      starts in Manual (Plan when that is the starting mode), whatever
      `initialPermissionMode` says, its note tells the model nobody
      confirmed who wrote it, and the panel names the mode.
    - **What the user saw is what the model gets, by construction** (PR
      #53's third review). A plan is parsed with the panel's own parser
      (`mdast-util-from-markdown` with `micromark-extension-gfm` and
      `mdast-util-gfm`, which react-markdown and remark-gfm use), then
      rewritten by `showPlanParts` (`shared/planView.ts`) so that every
      part is rendered text: a link's destination after its text
      (`details <https://…>`), a picture's alt text and source, titles,
      definitions, footnotes, a code fence's whole info string. The panel
      renders the reply the plan actions sit under through that transform
      (MarkdownView's `isPlan`), and the brief is the same tree written
      back with `mdast-util-to-markdown` (`briefText`), for a reply and
      for a file alike. The separate "hidden markup" predicate is gone; a
      jsdom test checks, for a corpus of tricky plans, that every character
      of the brief's text appears in order in the rendered DOM and that the
      brief holds no link, picture, definition or footnote a view could
      show only part of.
    - Raw HTML, which the panel never renders, stays the exception: a reply
      holding it is saved with a warning and not started; the user reads
      the file and starts it from Plans…, as untrusted content.
    - A control character other than a tab or a line break (DEL and C1
      included) or a format character (a direction override, a zero-width
      character) makes the panel paint the plan otherwise than the model
      reads it, which no DOM-text comparison sees: a reply or a plan file
      holding one is neither saved nor started (`hasUnshownCharacters`),
      emoji joined by U+200D and right-to-left marks included, for now.
    - A refused change out of Plan mode keeps the turns it left pending:
      Plan mode was never left on the backend.
    - Implementing a saved plan is refused in Restricted Mode.
    - A brief the backend refuses leaves nothing behind: its chip goes with
      the card, the todo list it set is taken back, and no "started" notice
      is said. A brief overtaken by another action says it was saved but not
      started.
  - **The todo list.** The top-level numbered items, else the top-level
    bullets, outside code; at most 50.
    - Model API: `AgentSession.setTodos`, before the first request, refused
      while a turn runs. The harness does not send the list to the model,
      so the note lists the steps it was set to (cut where long).
    - Muse Code: the note asks the model to take the steps as its list, and
      the panel says so.
  - **Plans…** in the palette lists `.agents/plans/*.md` newest date first
    (names start with the date), to open or implement. A plan file is read
    with the plan limit only, even when it starts like a PDF.
  - **One plan action at a time.** A second press is dropped, and said.
- **Acceptance.**
  - The captured reply saves byte for byte as its body.
  - Implement on the fake MSP host sends the file, the note and the
    display marker in a new `promptUnmatched` session.
  - On the fake Model API, the todo list lands before the brief's request,
    and nothing of the planning turn is in it.
  - Restricted Mode, a no, a stale reply, a side chat, a plan neither
    backend takes and a double press all start or write nothing.
  - A plan from Plans… starts in Manual (Plan when that is the starting
    mode) with the untrusted note, on the fake MSP host.
  - The live Model API case drove the panel's controller (10 requests):
    Plan mode, Save plan, Implement found the file saved and started a
    Manual conversation whose seeded list the model moved to completed.
    Muse Code Implement was not run live; its side rests on the capture and
    the fake MSP host.
  - The harness has `plan`, `plan-brief` (the Model API render: the seeded
    list, all pending) and `plan-narrow`.
- **Left.** None of the milestone. Not taken: the plan skill's precedence
  for a stronger plan location (`specs/…/plan.md`, `docs/plans/`), which is
  the model's judgement, not a fixed name (D13).

## M81 — Browser check (D49)

**Status 2026-10-02: lane A1 of design spec v4 built on
`feature/m81-browser`** (`docs/certification/m81.md`, "v4: lane A1"). The
owner reversed "no bundled browser": the check runs Google's Chrome for
Testing headless shell, pinned per release, behind an owned proxy (D-B1(b)).
Built: the closed failure union (lead ruling v4-M1, first commit); the
proxy boundary (plain HTTP to implicit loopback or explicit hosts, CONNECT
only to explicit hosts, auth stripping, bounds); the resolver map; the
canaries in three phases with the restart tripwire; the two lifetimes
(preparation 15 minutes, check 60 seconds); the runtime store in
`dist/browserRuntime.js` (pin, consent from the host, download, bounded ZIP,
hashes, receipt, publication, verified winner, per-check recheck); the
`browserCheckRuntime` setting and the Download command; release and weekly
pin checks. Captured on the Kubuntu, Mac mini (Intel) and Win11 rigs,
including the forced network-service restart; drilled guard by guard.
Open, the lead's: A2 (Linux namespace, a later lane); the disposable-CI
controls of spec §7 (planted policy, synthetic identities, mTLS, DoH, the
G2 N/N calibration, Windows ambient-auth calibration); a mac-arm64 run (the
Mac mini is Intel); the Download command's VS Code UI run; the aggregate
quality gate on the final tree. The record that follows is the superseded
system-browser design, kept as history.

Review fix 2026-10-04: folder cleanup survives cancellation during creation.

**Status 2026-10-01 (superseded by A1): built and certified** (`docs/certification/m81.md`),
ported from the 2026-09-28 draft (`b51c5f4c`) and largely rebuilt on the
release candidate; the independent review RV81 (one P1, four P2) fixed the
same day, each with a test and a red drill. Decisions taken while building:

- **Two blocks beyond loopback, and a watch.** The Fetch domain is enabled
  on the browser target, not the page, so it pauses every request of every
  target (the page, frames in other processes, dedicated and service
  workers, each redirect leg; probed on Chrome 150, Edge 154 and the
  154 headless shell), and fails each one that is not http(s) to an
  allowed host. What Fetch cannot see (a WebSocket handshake, a
  preconnect, the browser's own traffic) goes to a proxy that does not
  exist (`--proxy-server=http://127.0.0.1:9`), bypassed only for
  loopback and the allowed hosts; `<-loopback>` removes Chrome's implicit
  bypass, which includes link-local 169.254.0.0/16. WebRTC may not send
  UDP outside the proxy. Every target is watched (RV81): the browser and
  each target it attaches auto-attach every target they start
  (`waitForDebuggerOnStart`, flattened), and each is held until its
  Network events (and Fetch, where it has the domain; a worker does not)
  are on; one whose watch cannot be set up, or one past
  `BROWSER_CHECK_MAX_TARGETS` (64), is never let run. A WebSocket or
  WebTransport beyond the allowed hosts from any of them, or any answer
  from beyond (a response, a redirect), stops the check and returns
  nothing from the page.
- **Refused under a managed proxy policy (RV81).** Mandatory policy
  outranks the command line, so before any browser starts the check reads
  where Chrome and Edge keep it (Windows: HKLM and HKCU
  `SOFTWARE\Policies\Google\Chrome` and `…\Microsoft\Edge`, both registry
  views, through `reg.exe`; Linux: every file in the Chrome, Chromium and
  Edge `managed` folders; macOS: the machine's and the user's forced
  preferences in `/Library/Managed Preferences`, through `plutil`), and
  refuses with a translated reason, starting nothing, if any policy named
  Proxy… or a cloud management enrollment token (also its token file on
  Linux and macOS) is there, or if a location that exists cannot be read.
  Recommended policy ranks below the command line and is not read. Every
  location is read for both browsers, whichever was found.
- **One modal, one scope (RV81).** On Muse Code an open modal is shared
  only by a call of the same URL and the same widening and allowed hosts,
  and the setting is read again after the answer: a call whose scope
  changed meanwhile opens nothing.
- **An ended check sends nothing more (RV81).** A deadline, a Stop, a leak
  or a dead pipe closes the CDP connection at once, rejecting every call
  still waiting, before the browser's kill is awaited; each step checks
  the connection first.
- **Bounds on what the page controls (RV81).** A CDP message's whole
  length is checked against 32 MiB before it is joined or parsed; the URLs
  of requests in flight are kept per session, cut to 500 characters,
  dropped when the request finishes or fails, and at most
  `BROWSER_CHECK_MAX_TRACKED_REQUESTS` (512) at once.
- **Names are never looked up.** Loopback is `localhost`, 127.0.0.0/8 or
  `[::1]` as the URL parser writes them; any other name, including one
  that resolves to loopback, is beyond loopback until the user widens it.
  The draft's DNS recheck is dropped: it sent page-chosen names to the
  resolver and raced the request.
- **Widening.** The machine-scoped `museSpark.browserCheckExtraHosts`
  takes plain host names or addresses only (no port, path, wildcard or
  list separator, since each also goes into the proxy bypass list). A
  card widens one call: on the Model API a host beyond loopback and the
  setting always gets a card, Bypass included, unless the user chose
  "Always allow" for that host on one in this session; on Muse Code the
  extension's modal names the host. Plan and Restricted Mode refuse the
  check; it is a `network` tool, judged per host like web fetch.
- **The screenshot** reaches the Model API model as `read_file`'s images
  do (D47: a user message after the round), not as function output.
  Muse Code gets text only until a capture shows otherwise (rule 13).
- **Lifetime.** A check that ends by itself asks the browser to close,
  then kills it; a deadline, a Stop, a leak or the window closing kills it
  at once with everything it started (`processTree.killTree`). When the
  window itself dies, the browser exits with its pipe (drilled on Linux
  and Windows).
- **Its own bundle**, `dist/browserCheck.js` (D6 amendment), and the shared
  English table (`dist/uiText.js`) taken in as its prerequisite.
- **Left out:** console errors of frames in other processes and of
  workers (their requests are gated, and their failed ones listed); a
  bundled browser.

- **Goal.** The model sees its web change working.
- **Scope.**
  - A tool that opens a local URL in a headless browser over CDP:
    amended 2026-10-02 (design spec v4, the owner's decision reversing "no
    bundled browser"), Google's Chrome for Testing headless shell pinned
    per release and downloaded after consent, not the system Chrome or
    Edge.
    - CDP over `--remote-debugging-pipe`, never an open port, and a
      fresh private profile, never the user's.
    - All traffic goes to the check's own proxy, which passes plain HTTP
      to loopback and widened hosts only, so a page cannot reach the
      intranet or a metadata address and hand back what it found;
      `https`/WebSocket tunnels only to a widened host (opaque: residual
      in §9).
  - It returns a screenshot (image input), the console errors and failed
    requests.
  - It can click or type through a small action list.
  - Local URLs only, unless the user widens that in a machine-scoped
    setting or a card; the model cannot.
- **Backends.** The Model API; Muse Code through `ide`, under D49's rule
  for tools there, once a capture shows that an MCP tool's image content
  reaches the Muse Code model (AGENTS.md rule 13). Until then Muse Code
  gets the console and failed requests as text.
- **Acceptance.** No debugging port is opened; a request beyond loopback
  is blocked unless the user widened it; the user's profile is never used.
  A1 (spec v4): the runtime is the pin's, verified; every canary phase
  holds or the check refuses; a network-service restart refuses; open
  until captured on disposable CI: spec §7's unsafe positive controls.
- **Tests.** A local fixture page with a console error and a failed
  request; drills for the loopback block and the pipe. A1: the proxy, the
  canaries, the lifetimes, the store and ZIP reader on real folders, the
  live suite on the pinned runtime, one red drill per guard
  (`docs/certification/m81.md`).
- **Size.** M (A1: L).

## M82 — Awareness and budgets (D49)

**Resume review 2026-09-29.** The settled-spend, request-model pricing and
replayed-question fixes in the existing branch are retained. Completion
also requires the open request's reserved liability to survive a crash
before usage arrives, including a snapshot whose replay cannot be saved.
The reservation write must finish before fetch, and unavailable or failing
storage refuses the capped request. Final key/account, model, goal, trust
and paid admission checks stay synchronous after the write; a nonsent
reservation is refunded durably under its original account. Final usage
replaces the liability. A model change invalidates an
older request's or token-count call's base even if the model switches back
before it answers. Stored usage and reply spend must stay finite and
nonnegative. A failed compacted-context token count logs a status and fixed
words only. These paths are checked with held fake responses, a real
session-file readback, model changes, reloads and red/restored drills; no
new paid live run is authorized for this completion.

**Shared spending and paid fees (resume owner decision, 2026-09-29).** The
cap remains per conversation across hosts sharing its session store. A
scoped budget journal owns each request's durable liability through actual
settlement or refund; journal entries remain visible after crashes, and
stale whole-session saves cannot lower authoritative spend. Every admission
refreshes that spend, publishes its own liability and rechecks the total
synchronously after key retrieval. Missing, corrupt or unreadable journal
data refuses a capped request. Legacy spend is seeded once from the fresh
account-owned session file; unverified historical paid fees are reported
explicitly, never invented as zero.

Known image-generation fees enter that same admission and settlement.
Hosted search has no captured hard query bound, so it is unavailable while
a finite cap is active, with a localized reason; cap-off search retains its
paid consent. No unsupported wire field is added. This preserves the spend
cap rather than redefining it as a token-only budget. Real shared-disk tests
must cover two hosts publishing liabilities, a later publisher, stale
saves, crash retention, model/key/cap changes and known paid fees.

A capped response attempt that was sent but never reports usage keeps its
whole liability. An ambiguous transport or server failure cannot retry with
the same allowance; a new request needs a fresh admission. Explicit 429
refusals may retry under the original claim because no work was admitted.
Cap-off HTTP retries retain their existing behavior. Image calls already
retry only explicit 429 refusals. These limits are surfaced and documented,
without guessing a new billing field.

A request begun with the cap off still publishes an open-unbounded claim
when a shared journal exists. Finite admission refuses while that possible
charge is unsettled, even when another host has a different current setting.
Known actual usage clears that temporary uncertainty; an unverified tariff
or earlier ambiguous retry retains a permanent unknown-cost marker. The
final retry tail cannot certify earlier attempts as unbilled. Cap-off
requests without session storage keep their existing behavior; a provided
but unavailable journal fails closed. Known image fees have a hard flat
bound and publish ordinary claims in either setting. This remains scoped
owned-row metadata, with no election or shared configuration coordinator.

The owned Model API host exposes a typed immutable parent budget scope for
external trial attempts and paid voice. It contains only the session ID,
account digest, journal, current-cap getter and final owner/context fence.
An attempt host reserves and settles its own row in that parent scope;
its temporary transcript is never saved or seeded under the parent's ID.
The fence checks the originating lifetime, account, trust, model and goal
context after async storage and actual key retrieval. Unknown sessions or
managers fail closed. The backend manager already returns the typed Model
API host, so this adds no generic agent API or runtime bundle identity test.

An owned optional `ResponseAttemptGuard.onRequestStarted` observer runs
after every key, admission, Stop and confirmed-run fence and request-init
build, synchronously adjacent to fetch. It marks attempted sends and child
request debits there; preflight alone never consumes an attempt or turns a
known nonsent reservation into unknown spend. Context packing and external
trial counters compose after that marker. Transport attempts still are not
verified invoices: missing usage retains liability and uncertainty. This
is internal callback metadata, with no new HTTP/MSP fields, call arguments,
duplicate key read, body build or admission call.

**Paid voice integration (owner-approved completion).** On an actual Model
API conversation, a finite cap makes Muse Voice unavailable with a localized
reason. Cap-off voice obtains the current owned parent scope, publishes an
open-unbounded row before authentication/audio, and checks the actual key
digest and parent lifetime/context before each send. The key is reread
after the durable write; the controller fences attachment, auth admission,
restart epoch and paid availability while cancellation awaits. A context
change has its own localized reason instead of claiming the cap is on.
Stop or owner changes
before authentication refund only the proven nonsent row. Once
authentication may have been sent, local PCM duration is an estimate, not a
server billing receipt: settlement keeps an unknown-cost marker, including
a final transcript, until supported billing-duration evidence exists. The
earlier M35 record captured local recording and synthetic protocol tests,
and explicitly lacked a live paid voice call. CLI voice and free system
dictation retain their existing behavior. No new audio bound or wire usage
field is guessed. A voice stream retains its original scope while another
recording or surface begins; stale text cannot land on a replacement owner.
Paid voice captures that scope and the controller's auth admission revision,
attachment/send epochs, model and permission mode before the consent popup.
An accepted popup cannot authorize a replacement account or recreate capture
after disposal. Direct paid reviewers use their own explicit claim in the
canonical response guard, never the preceding main response's settled claim.
All owned session scopes inherit a host close-start fence, including during
awaited SessionEnd hooks. Billable usage requires safe nonnegative integer
counts and cached input no greater than total input; invalid reports retain
unknown liability rather than reducing it.
Per-reply dollar amounts are labeled estimated in every UI language. This
also covers D36's future-model tier fallback; it must not read as a verified
provider charge. The known-only turn-budget footer remains unchanged.
Cap-off paid voice keeps its no-folder/no-store behavior. Each recording
captures a separate consent fence before its popup, including the actual
account digest and auth/model/mode/attachment/lifetime revisions, even when
there is no journal. The fence is checked before authentication, audio and
end sends; a later finite cap refuses those sends. Stop and the next press
do not invalidate a finishing recording's original owner. A stale final
transcript cannot enter a replacement owner. No shared-spend or verified
audio-billing claim is made for this unshared path.
A narrow controller revision fences local model/mode changes and observed
model events, so a round trip cannot restore old no-journal consent.
Current-main adapters use the existing defaults where M82 has no setting
surface: ACP keeps the cap off and per-reply display off. The manual live
panel fixture supplies the same owned voice/notification ports; its budget
drill is case22, retaining the original case19 capture as historical evidence.

**Status 2026-09-28: built** (`docs/certification/m82.md`). Drafted by a
Muse Code instance, reviewed and finished by Claude; the record holds the
rig gate, 27 red drills, and a live check on the contributor model (two
requests) that found each request's estimate above what Meta counted.

- **Decisions.**
  - **Notifications are VS Code's own.** VS Code gives extensions no
    operating-system notification (its chat's OS toasts are internal), so
    the notice is `showInformationMessage`, raised only while
    `vscode.window.state.focused` is false; it waits in the window's corner.
    An OS-level toast would need a helper process per OS (§3).
  - A turn counts as long at 60 s (`BACKGROUND_TURN_NOTIFICATION_MIN_MS`).
    A turn whose length the backend did not report notifies; a cancelled
    one never does. The message names the terminal: completed, failed, or
    "ended" for a word the wire adds later (D36). Approvals and questions
    notify; a pending card or question replayed to a later surface (or
    pulled again by a resume) is marked `isReplayed` and does not.
  - One `BackgroundNotifier` per window raises each notice once by key
    (session and turn, approval or question), so two surfaces on one
    session do not both notify; the keys it remembers are bounded
    (`BACKGROUND_NOTICE_KEYS_MAX`).
  - `museSpark.notifyOnBackgroundTurn` is not machine-scoped: it chooses
    nothing that runs or is billed (D15), so a workspace may set it.
    `museSpark.modelApiReplyUsage` is display only.
  - **Per-reply usage** accumulates every request of the turn (tool steps,
    failed attempts that reported usage) and is told on the last message of
    the next response that has one, so a turn's lines add up to its cost.
    The host attaches it while the setting is on; Muse Code attaches nothing
    (D26).
  - **The budget's estimate** (`sessionBudget.ts`): the last reported
    request's input tokens, plus each part of this request (the
    instructions, the tools, each input item, as JSON) that the reported
    one did not carry, at one token per UTF-8 byte
    (`SESSION_BUDGET_MIN_BYTES_PER_TOKEN`), since a byte-level tokenizer
    never makes a token of less than a byte. Parts are matched by SHA-256,
    and a part the base carried and this request does not is never
    subtracted, so older media left out or a compaction can only raise the
    estimate. With no base (the first request, a model change, a cap set
    mid-conversation) every part counts; after a compaction, Meta's count
    of the new context is the base. The live check measured the estimate at
    3.6 and 2.2 times what Meta counted.
  - **The reservation** prices input and the whole output allowance at the
    model's verified list price (`modelApiPaidTier`), no cache discount; a
    model with no verified price is refused while a cap is set rather than
    priced by guess. `max_output_tokens` is the most that fits, capped at
    the usual maximum; with room for less than one output token the request
    is not sent. Every request is reserved (turns, retries, compactions),
    checked before the PreLLMCall hooks see it and again on the body sent.
  - **Settling.** A response's reported usage replaces its reservation,
    priced at the model the request was sent to, even if the session
    switched models meanwhile; a request counted for another model is no
    base. A sent response that never reported usage (a Stop, a dropped
    stream, a response timeout or a crash) retains its whole reservation.
    This is possible liability, not verified billed spending. A nonsent
    request, or an established 400/429 refusal before the response began,
    counts nothing. Other unknown sent outcomes remain reserved. A negative
    token count is no report. A reply that used every output token the
    budget left is marked as possibly cut short.
  - **Saved as it is spent.** Each reported usage saves the session. While
    a call waits for its output the replay cannot be saved (a call without
    its output cannot be replayed after a crash), so the token totals and
    the spend are written onto the session's last saved snapshot instead.
    Closing the window waits up to `MODEL_API_CLOSE_SETTLE_MS` for the turns
    it stops to charge and save. A negative stored spend or a negative count
    of the compacted context is refused.
    The request's reservation is also saved before fetch, even before any
    response frame. The save is awaited; a capped request without working
    session storage is refused. A stop or an account, model, goal, trust
    or web-search admission change during the write prevents the request
    and releases its nonsent liability. The shared journal, initialized
    once from the fresh account-owned file, supplies all subsequent spend;
    old snapshots cannot lower it. Unknown sent attempts cannot repeat
    under the same allowance; explicit rate-limit refusals can.
  - **Child tasks** retain their separate paid confirmations (D48) and
    request ceilings. Their reported usage counts toward that conversation
    and its owning goal (M45), but their requests are not reserved against
    the parent's cap and can exceed it (M82 owner decision, retained by the
    M78 lane brief). Ordinary, best-of-N and direct reviewer reservations
    remain enforced through their owned journal.
  - **Known flat fees** enter the same journal: image generation reserves
    its published fee before sending, including a billed image that cannot
    be saved. Search has no captured hard billed-query bound and is
    unavailable with a finite cap. With no cap it keeps paid consent and
    records reported search fees. Unverified historical paid fees prevent
    a cap on that history; a fresh conversation can be capped.
  - Spend persists with the session; a fork or side chat is a conversation
    of its own and starts at zero. Its controlled initial snapshot carries
    `budgetIsFreshFork: true`, `forkedFrom` and explicit zero spend so copied
    paid and closed-child history does not become an unverified new charge.
    The runtime marker clears after journal activation; the one-time intent
    prevents a repeated load or stale save from seeding again. Legacy rows
    never get this interpretation from a missing spend or a fork link alone.
    The turn's cost against the cap is shown
    after each turn with a cap.
  - Cache savings is the uncached price minus the priced one, with its
    share; its value template is a pre-formatted amount and percentage,
    allow-listed by the localization gate as such.
- **Goal.** The user knows what happened and what it cost.
- **Scope.**
  - An OS notification when a long turn ends or waits for approval while
    the window is unfocused.
  - Tokens and cost per reply (optional).
  - A session budget cap, machine-scoped, on the Model API, kept by
    reservation, since a request's cost is incurred once it is sent:
    - before each request, its input is estimated high (the previous
      request's reported input plus what was added since, counted
      conservatively), and `max_output_tokens` is set so that input plus
      output at list price fits what is left;
    - a request that cannot fit is not sent, and the turn stops and says
      so;
    - the cap uses conservative input estimates and published prices;
      actual billing can differ, and the setting makes no exhaustive
      overrun claim. The turn's reported cost and reserved unknown
      liability are documented separately.
  - Cache savings shown in Account & usage, on the Model API only (D26:
    Muse Code reports no honest cache totals).
- **Backends.** Both. Cost is for the Model API.
- **Acceptance.** A request that would not fit the budget left is never
  sent, and the turn says why; no notification shows while the window is
  focused.
- **Tests.** The fake Model API with priced usage, including a request
  whose reservation does not fit.
- **Size.** S.

## M83 — Import from other agents (D49)

**M71 integration correction (FIX78B, 2026-10-04):** canonical project scope
must also guard the Muse settings planning read, including XDG roots and
personal links into a project. Host UI trust wiring needs an executed
mutation-sensitive regression. Scope and bounded receipts belong to M71
above and `docs/certification/m71.md`; older M83 records do not prove these
two boundaries.

**Status 2026-10-02 (round 5): exposure-preserving import (D64) implemented;
prescribed scoped rig verification complete, lead certification pending.** Five
reviews found new credential spellings, so the detector and masking are
removed. Preview/picker output is metadata only; no clipboard; unchanged
config values open in unsaved target edits. Sources and targets follow the
three-class exposure matrix, with target classification repeated after final
path checks. Candidate registration reuses one Set. Latest main/M75 joined
in `f08d2f26`. Current evidence: `docs/certification/m83e.md`.

**Superseded history — round 4, replaced by D64 and m83e:**
**Historical status 2026-10-02 (round 4): refuses items that may hold a credential
instead of masking them; lead certification pending.** The fourth
independent review (RV83d, on `527da984`) found the round-3 masker still
publishing credentials: a value on the next line or after a shell line
continuation, a credential name joined from quoted parts (`Authori''zation`,
`--to''ken`), a JSON-escaped or Unicode-suffixed name, and a query after
whitespace or without a scheme (five P1s with the checkpoint finding below,
three P2s); the Muse review (mr83) found the multi-line value too. Four
review rounds each found a spelling that hid a value from span masking,
so the lead changed the approach (2026-10-01): refuse, do not mask.
`importMask.ts` is removed. `importCredentials.ts` reads each imported item
whole (a rules file, a command or agent with its file name, a hook's
command, matcher and status line, an MCP server's command, arguments, `env`
and header names and values, URL and copied tool names) in three spellings:
as written (NFKC, format characters removed, Cyrillic and Greek look-alikes
read as Latin); as a shell, a JSON reader or a URL decoder would join it
(escapes, percent and entity escapes decoded, continuations and quote marks
removed); and with other punctuation removed. A name cue with a value (on
its line or a later one), URL user-info or a credential query parameter, a
known token shape, or a long base64/hex run mixing digits and letter cases
refuses the whole item: nothing is published or copied; the preview lists
it under "Not imported: may hold a credential — copy it yourself" with the
cue's kind; a name holding a cue is hidden; the log counts kinds only. An
MCP server whose fields hold a cue is refused whole, and so is a server URL
with user-info, a query or a fragment; an admitted server's `env` and
header values stay masked whole. False positives are accepted (fail
closed): 25 of 200 open-source rule files refuse (12.5%; 8 hold a key, a
password or a placeholder for one), and this repository's own corpus 4 of
52, inside the test's 15% budget. Also fixed: a publication is noted as the
user's own write (`noteUserSave`, as `asUserEdit` does; RV83d #5); the
root check rechecks the window's folder after its awaited identity lookup
and in the clipboard's synchronous guard (#6); the generated SKILL.md is no
longer masked after serializing, so its front matter stays whole (#7);
`fenced` finds the longest backtick run in a loop (#8); a blank MCP command
is unsupported and the preview says when source files were skipped (mr83).
Merged `origin/main` `2a30b1a0` (PR #67), keeping its shared-table files
exactly. Details: `docs/certification/m83d.md`. Lead next action: full
quality, a fresh review, native VS Code import UI, other platforms and M76
runtime admission.

**Status 2026-10-01 (round 3, historical): masking redesigned.**
The third independent review (RV83c, `6db3cc9d`→`a895dbb4`) found credentials
still shown through shell word-joining (`'…?k='-value`, `'…'"value"`),
whitespace inside a quoted value, the name and scheme length caps (which
failed open), and two quadratic scans (13.8 s and 3.0 s for 64,000
characters on Kubuntu). At the third round the masker was redesigned
instead of patched (the owner's rule): free text now fails closed, line by
line. From a line's first credential cue to the line's end, everything is
masked. The cues are a URL (`://`) with a `?` or `@` before the next
whitespace, a name holding a credential word followed by `=`, `:` or
whitespace, and a known token shape, now including a JSON Web Token's start.
An argument is masked the same way as one line, and the argument after a bare
credential flag is masked whole. Dedicated `env`, header and URL fields are
unchanged. The quote and shell-join helpers and every length cap are removed;
`redact.ts` is untouched. A shared table of every reported leak (33 cases) is
checked through `maskText`, `maskArgs` and the production flow. The preview,
clipboard, published `AGENTS.md` and log hold no secret, and ordinary lines
stay unchanged. Against `a895dbb4`'s masker, 41 of 139 tests fail. Fourteen
guard drills on Kubuntu go red and restore byte-exact by SHA-256. Long lines
of 64,000 characters take 15–132 ms on the Windows host, and nine import
test files pass 260 tests on Kubuntu and the Mac mini. Scoped checks pass:
five type projects, ESLint, Prettier, zero jscpd clones, host API, knip,
localization and the build (importer 104.1/125 KiB). Lead next action: full quality, a fresh review, native VS
Code import UI, other platforms and M76 runtime admission. Details are in
`docs/certification/m83b.md`, "RV83c: masking redesigned".

**Round 2 follow-up status (historical), 2026-10-01: RV83b repairs done.**
The importer cap blocker below is fixed: the lead's `6db3cc9d` imports
`zod/mini`, as the converter does (importer 104.0/125 KiB; seven import
suites, 190 tests passed on Kubuntu). The second independent review (RV83b,
`57d01413`→`6db3cc9d`) found RV83 findings 2–4 fixed and finding 1 only in
part: a query value in quote marks or backticks (`?signature='…'`) left the
credential after the mask in MCP arguments and rules (P1), and this status
was stale (P3). `maskText` now takes a quoted value onto its URL before the
one `maskUrl` masks it: a closed quote, parts a shell joins (`'a'"b"`), and
a quote left open where a value starts. The mark the URL is wrapped in still
closes it, so the text around it is kept. The new pattern is linear. Eight
new regressions failed on `6db3cc9d` and pass now; four red drills are 0/1/0
with byte-exact SHA-256 restores. Scoped checks pass: five type projects,
changed-file ESLint/Prettier, zero jscpd clones, localization, and the build
(importer 104.4/125 KiB). The eight import test files pass on Kubuntu
(202 tests). A follow-up makes masking linear. The URL scheme is bounded to
32 characters, as the release candidate's `16f1e908` bounds the log
redactor's; `redact.ts` here is byte-identical to it. The masker's flag and
assignment scans are bounded too, and the argument checks are split into
linear tests. Long-line tests take 24–133 ms, against 30–47 s on
`6db3cc9d`, and six drills are 0/1/0. With `redact.test.ts`, 222 tests pass
on Kubuntu. Lead next action: full quality, native VS Code import UI, other
platforms and M76 runtime admission. Details are in
`docs/certification/m83b.md`.

**Round 2 status (historical), 2026-10-01: blocked by the hard import-bundle cap.**
Removal `04b3859f`, approved shared-table merge `a6672749`, and RV83 fixes
`757a4773`, `328e10df`, `4e83666e`, `490c2cc9` are committed. The initial
shared build passed; final build on `490c2cc9` failed at **530.7/125 KiB**
(`dist/agentImport.js`, 543,471 bytes). The copy-reconciliation helper's
new root `zod` import carries classic schemas and locales; the existing
converter uses `zod/mini`. Metadata measures 454,779 Zod bytes across 97
inputs. The lane brief explicitly requires reporting an exceeded cap and
stopping, so no code repair, cap/layout change or rerun followed the failure.
Seven final scoped checks pass (five type projects, changed-file lint and
format, knip, zero duplication, localization, host API); the final affected
suite batch did not run because build failed first. Per-finding tests and
28 red/restored drills passed on their recorded source snapshots. The lead
reconciled the helper in `6db3cc9d` (above). Details and actual gate exits
are in `docs/certification/m83b.md` and `docs/certification/m83b-gates.json`.

**Round 2 repair scope (2026-10-01, M83b):** remove the lane's empty
English-table stand-in, then merge the approved `build/shared-ui-text`
branch (`44d920fd`) and retain the importer's existing lazy bundle. Update
D6's artifact inventory and shared-table contract; no other build layout or
cap changes are authorized. Fix RV83 findings 1–4 in priority order using
focused failing regressions and SHA-256-checked red/restored drills: embedded
URL credentials, live scan trust/activation, current copy-target existence,
and refused-copy accounting. Reuse the existing masker, scanner, copy flow
and native UI; no new dependency, abstraction or UI is needed. The lane
brief forbids full quality and another release-candidate merge this round;
the lead owns those checks. The skill ledger validator is deferred because
this canonical milestone plan has no `quality-ledger` block and the brief
requires scoped repairs, not a plan-format migration. Readiness review:
the brief and RV83 identify observable regressions, safe synthetic fixtures,
ordered dependencies and hard caps; no owner decision remains unresolved.

**Status 2026-09-30: lane complete on the current M72 candidate; lead certification pending.**
Worktree `muse-extension-m83`, branch `feature/m83-import`, starts at
`1fd98aaf`; the initial port is `6eba5169`. The prepared integration tree
and archived work are read-only sources. The original uncommitted repair
is saved in `3dd3a450`: one host-wide import gate refuses a second request while the
first awaits any answer, and unexpected failures are reported honestly.
Project import publications use M68's existing begin/finally workspace notices,
capturing the exact live owner before the first await and counting only a true
write. Personal imports neither notify this workspace nor load the lazy host.
The append guard also reaches every native atomic write boundary.
M76 is being finished separately and is not imported into this lane. The
existing import validator checks its planned agent format until M76's
canonical reader is available. Focused checks and red drills belong to this
lane; independent review and full multi-platform gates belong to the lead.
The named `muse-extension-pr32/temp/HANDOFF_2026-09-30.md` is unavailable
on this machine; the lane brief, prepared source and preserved evidence
provide the recovery context. No model or network call is needed.
`667dd5fa` closes the request-root gaps; `66706553` joins candidate
`8e9d3a1e`, `dec33da2` joins checkpoint protection `1e8fbbde`, and
`940acc25` joins catalog retention `8d59fb5c`. Verification is pinned to
that named snapshot while the lead continues integration. `origin/main`
did not contain the candidate when the required join began.

The catalog update pushed activation to 600.1 KiB (build exit 1). Fix
`d4ad53a3` leaves a synchronous activation shim and tree-shakes the existing
picker/editor implementation into `dist/agentImport.js`. No new bundle,
dependency, option or cap change is needed. Both entry functions are
validated, and the display table is installed before either one shows
text. A real built-module test proves localization and pre-await owner
capture. Twenty-three guard drills fail as intended, restore exact source
bytes by SHA-256 and pass again.

All prescribed scoped checks pass on this source: five type projects,
changed-file ESLint/Prettier, knip, zero jscpd clones, localization and
host API inventory with zero problems, production build and eleven
owned/affected test files (219 passed; three existing Windows file-symlink
cases remain unproved). Activation is 612,881 bytes (598.5/600 KiB);
import 102.5/125 KiB, Model API 326.5/400 KiB and checkpoint store
118.7/225 KiB. Full quality, independent review, other platforms and M76
runtime admission remain lead-owned. No push or live/paid call ran.
Current receipts: `docs/certification/m83-lane-gates.json` and
`docs/certification/m83-lane-drills.json`. Prior gate records stay in Git
history and describe their own source snapshots.
The 2026-09-28 certification is historical (`docs/certification/m83.md`).

- **Goal.** Switching to Muse Spark Code takes minutes.
- **Scope.** MCP servers, mapped hooks, compatible custom agents, commands
  as skills, and project rules as `AGENTS.md` sections, from Claude Code,
  Codex and Cursor. Import copies an item only to a place no more exposed than where it was: personal stays personal, a git-ignored file is never copied into a tracked one. It does not look for credentials in what it copies.
  Metadata preview first; no overwrite, clipboard, detector or masking.
  Config entries open unsaved in the same-scope target for review/save.
  Only active MCP transport fields are copied; inactive/unknown fields are
  listed as dropped by name. Names remain visible as the source tool shows
  them; no bodies, commands, arguments, environment/header values or URLs
  in preview/picker output; no names, paths or content in logs.
- **Backends.** Both.
- **Acceptance.** All nine exposure moves follow D64. Real git ignores
  refuse ignored-to-tracked and admit ignored-to-ignored. Recheck target
  classification after final path checks at publication/editor edit time.
  Unknown classification refuses. Personal means under home and outside
  every open workspace; non-repositories count as tracked.
  Preserve bounded handle reads, exclusive complete-file publication,
  changed-prior-text/rules-size refusal, project link/junction refusal,
  request-root identity binding, live trust/activation, checkpoint leases
  and successful-publication user ownership. Apply the synchronous current
  folder guard after the last await before editor show and edit. Keep one
  host-wide import gate through all questions and effects. Personal imports
  remain available in Restricted Mode. Agents and command restrictions stay
  intact; unsupported metadata remains refused. M76 runtime admission is
  lead-owned until its canonical reader lands.
- **Tests.** Production scan/plan/apply with memoryImportIo and a fake ignore
  oracle; real git ignored source/targets and real junction cases; no
  clipboard API in host adapter; old leak corpus as metadata/log isolation
  input; final editor interleaving; Set construction work at 1k/2k/4k/8k.
  Red drills: class check, ignore query, clipboard absence, log scrub,
  current-folder guard and Set reuse; byte-exact SHA-256 restoration.
- **Size.** S.
- **As built (decisions).** A first draft by Muse Code (5094e6b4) was
  reviewed and largely rewritten; the certification record lists what
  changed and why.
  - **Sources, from each tool's documentation (2026-09-28) and Muse Code
    1.4.0-R4302.1's bundled `migrate` skill.** Claude Code: user and
    local-scope MCP servers in `~/.claude.json` (`mcpServers`,
    `projects[<root>].mcpServers`, the drive letter matched in either
    case; the file's account and usage data are parsed past and dropped),
    project servers in `.mcp.json`, hooks in `~/.claude/settings.json` and
    the project's `.claude/settings.json` and `settings.local.json`,
    agents and commands (namespaced subfolders, three deep) in `agents/`
    and `commands/`, rules in the project's `CLAUDE.md` and
    `.claude/CLAUDE.md`; `CLAUDE_CONFIG_DIR` honoured. Codex:
    `config.toml` `[mcp_servers.*]` (read with `smol-toml`, D3), prompts
    in `~/.codex/prompts` (Codex has no project prompts), `CODEX_HOME`
    honoured when absolute and refused with a warning when relative; the
    project's root `AGENTS.md` is Muse Code's own rules file, so it is not
    a source. Cursor: `mcp.json`, `agents/` and `commands/` in `~/.cursor`
    and the project's `.cursor`, rules in `.cursor/rules/*.mdc` (their
    `description` and `globs` kept in the section) and `.cursorrules`.
    Cursor's hooks are not read: its events do not share Muse Code's names.
    Codex's hooks were left unread for the same reason, but that was wrong
    (corrected 2026-10-04, D70). Codex rust-v0.160.0 uses Muse Code's event
    names (Claude Code's), matcher grammar and JSON shape for 11 of its 12
    events, and the 12th is Muse Code's `Interrupt`. M91 lane I imports them.
  - **The scope rule.** The user's own folders go only to the user's
    files; they are theirs, so links in them are followed. A repository's
    folders are read only in a trusted workspace that is not the home
    folder itself, every path confined by its canonical form
    (`confineWorkspacePath`, D24), and go only to that project's files.
    Muse Code reads MCP servers only from the user's `settings.json`
    (M31), so a repository's servers are listed and never offered there.
    The user's `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` are Muse
    Code's own `/rules import` (it names both files; the user rules file's
    name is Q9), so they are listed and not offered for a project's
    `AGENTS.md`.
  - **Preview first, nothing replaced.** A read-only Markdown document
    (M15's read-only documents, now opened before the CLI features are
    built) lists kind, item name, source scope, target path
    and every entry left out with its reason; content is not shown, beside a non-modal
    notification that asks, so the preview stays readable; nothing is
    written until Import. Complete bytes are staged with `wx` and published
    by an exclusive hard link, each destination confined again at publication, a
    project's to the workspace root itself (not its `.agents` folder, so a
    linked `.agents` is refused); a rules section is appended only if its
    heading is not in `AGENTS.md` when it is written.
  - **Never written: Muse Code's `settings.json` and `.muse/hooks.json`
    (D17, D30).** MCP entries are the `migrate` skill's shape: `type:
"stdio"` or `"streamable-http"`, always `mode: "optional"`, Codex's
    `enabled`, `tool_timeout_sec`, `startup_timeout_sec`, `enabled_tools`
    and `disabled_tools` copied, every other field named as not carried
    over; `sse`, `ws`, `sdk`, OAuth and header helpers are not converted,
    nor is a server turned off. Hook entries keep their matcher (Muse
    Code's matchers take Claude Code's tool names for its own tools),
    except where Claude Code ignores one (`UserPromptSubmit`,
    `PostToolBatch`, `Stop`); a handler converts only as a plain `command`
    with `timeout` (at most 600 s), `async` and `statusMessage`, so nothing
    that narrowed (`if`, `args`, `shell`) is widened. Only active transport fields are copied unchanged; inactive and unknown
    fields are dropped by name. The editor text is the
    whole file when it is missing (`schema_version: 1` for the settings),
    else the members to merge, with a warning for the legacy
    `mcp_servers` key; it is applied as an unsaved WorkspaceEdit in the target,
    so the user reviews and saves it.
  - **Exposure (D64, round 5).** The detector, its three readings, NFKC
    normalization and value masking are deleted. Canonical paths and safe
    git metadata classify sources, with target exposure checked again at
    publication or editor edit time. Logs contain counts and fixed reasons.
    Historical masking/refusal claims and corpora describe their old trees
    only (`m83.md`, `m83b.md`, `m83d.md`); m83e supersedes them.
  - **Custom agents before M76.** The agent files land in
    `.agents/agents/<id>/AGENT.md` and `<config>/muse/agents/<id>/AGENT.md`,
    M76's planned extension-owned layout. The directory id is the planned
    selector passed to `subagent_spawn`; frontmatter name is presentation.
    Import checks supported fields and tool restrictions; incompatible
    entries are shown as unsupported. Runtime use awaits M76 integration.
    Muse Code's own agents stay native; the
    captured CLI names no user agent folder.
  - No new setting, no model call, no paid use: D49's paid-call rules do
    not apply. Restricted Mode reads and offers only the user's own
    files. `agentImportKindHook` and `agentImportKindAgent` join
    `l10n/untranslated.json` only for the languages that use the English
    word.

## M84 — Session export, import and share (D49)

**Status 2026-10-02: the follow-up review RV84c and the Muse review fixed on
`feature/m84-export`; the four-machine gate remains the lead's.** The RV84
findings are fixed one commit each, with tests and red drills recorded from
this tree in `docs/certification/m84.md`, as are the drills of the
2026-09-29 repairs that had not run (R1 to R6). RV84 #10 and #14, open on
2026-10-01, are now fixed too (see "Follow-up reviews" below), as is #9's
single-string residual. The `m84-share.png` capture was taken on Kubuntu
on 2026-10-02 (the accessibility gate passed on its `share` scenario).
The original export lane did not run `npm run quality`, the whole accessibility
gate, the other harness shots or the integration tests. The port had put `extension.js` and `modelApi.js` over
their size budgets. They are back under after merging
`build/shared-ui-text`, the shared English table (`15f847a4`). The
redaction prefilter is proven a superset of every rule (`5df6d5c2`).
History: original `c2eb4da2` and the repair drafts are preserved; the port
to the release candidate is described below.

**M84f narrow-focus follow-up, verified 2026-10-02.** `fix/m84-share-focus`
includes main `e66263f1` (M73 and M74). Kubuntu passes 127 owning tests,
392 accessibility pages including the real 320 px share scenario in four
themes, native keyboard/focus/scroll checks, all scoped static gates and
the production build. Byte-exact red drills and current source hashes are
in `docs/certification/m84.md`. Full quality and the four-machine gate
remain the lead's.

- **Goal.** A conversation can move between machines and people.
- **Scope.**
  - Export a conversation as JSON. Credentials of a known shape (the log
    redactor's list, `src/core/redact.ts`) and the key digest are always
    left out; account ids and paths are redacted by default. A preview
    shows the file first, since a secret in another shape is not
    recognised.
  - Import resumes on the Model API. It drops the permission mode, session
    rules, goals, schedules and patches, and marks the imported turns as
    untrusted. It starts in Manual, or in Plan when
    `museSpark.initialPermissionMode` is Plan, whatever else that setting
    says; only the user's own mode change relaxes it.
  - A local share file, rendered read-only in the panel.
    - M84f: at a true 320 px viewport, code output and every control take
      keyboard focus with the VS Code focus border; Tab stays in document
      order, Escape returns to the composer, and nothing overflows the panel.
      Add `share-narrow` to all four accessibility themes and prove the
      keyboard regression by a byte-exact red drill (`docs/certification/m84.md`).
  - No hosted sharing.
- **Backends.** The Model API resumes; Muse Code exports its own log (M30).
- **Acceptance.** An export never holds the key digest or a credential of
  a known shape (amended 2026-10-01 after RV84 #1: "never a credential" is
  not something a pattern list can promise, so the UI and docs say which
  shapes are removed and that the preview is the check for the rest);
  an import starts in Manual (or Plan) even when the initial mode is Auto,
  Edit automatically or Bypass, with no session rules, goals, schedules
  or patches.
  - **Completion review, 2026-09-29:** finish `transferInvalidField` in
    all fourteen translations. JSON syntax failures expose only an
    existing localized refusal; unknown/invalid field details scrub known
    secrets, paths and account ids before their bounded display. Scrub
    every exported string, including arbitrary item ids and error labels;
    legitimate UUIDs and enum words stay intact. The share view already
    keys items by position and id, and import already mints fresh ids, so
    no new identity format is needed. Extend the existing transfer/import
    tests and prove the four guards fail under mutations before relying
    on them; earlier certificates remain tied to their earlier trees.
    (Done 2026-10-01: drills R1 to R6 in `docs/certification/m84.md`.)
    PR #32 integration must honor `record.imported` in ACP load/resume/fork
    before `matchAdvertised` sets a backend mode; reuse `untrustedStartMode`
    instead of advertising configured Auto/Bypass for imported history.
    A source handoff against `muse-extension-m69-integrate`'s
    `src/acp/agent.ts` is prepared outside the checkout. It passes the
    loaded record's imported flag into adoption and uses the existing
    `untrustedStartMode` before mode matching or replay. Draft tests cover
    imported load/resume after explicit relaxation and ordinary configured
    modes. ACP has no fork endpoint: verify M84's real backend fork/restart
    marker preservation and then safe ACP load of the marked fork.
- **Tests.** Round trips with zod on both ends, and drills for each
  dropped field.
- **Size.** S.
- **Status 2026-09-28: built.**

Status detail retained: built on `feature/m84-export`; `docs/certification/m84.md`.
A Muse Code instance drafted it (contributor model); Claude reviewed and
reworked the draft. Decisions taken:

- **One format** (`muse-spark-session-export`, version 1,
  `src/core/export/sessionTransfer.ts`) for export, import and share. It
  holds the history the Markdown export reads (`readSession`, both
  backends) with only the fields a reader needs. Live state (stored
  outputs and patches, child sessions, background and workflow handles,
  `modelVisibleContent`, `children`) and the Model API replay stay out.
- **Scrubbing.** Every string in the document, ids included, goes
  through `redactSecrets` and a 64-hex digest pattern,
  always. By default paths and e-mail addresses are redacted too:
  `file://` URIs, then this machine's own roots (workspace folders and the
  home folder, matched in either separator and any case, to the path's
  end, so a user name with a space goes), then absolute POSIX, drive and
  UNC paths. Placeholders are English (`MODEL_TEXT`), since the model reads
  them after an import. The e-mail pattern is bounded (RFC 5321 lengths)
  and `redact.ts`'s URL user-info scheme is bounded, so a long run of
  word characters scans in linear time.
  Ordinary UUIDs and enum words remain unchanged. Share section keys
  include their position; import remints ids, and live-state references
  stay excluded, so redacting a sensitive id needs no identity mapping.
- **Preview first.** The redacted file opens as a read-only in-memory
  document (the output-document scheme, never on disk), then a modal
  names what was redacted and offers **Save redacted…**, **Save without
  redaction…** or close. The suggested file name comes from the redacted
  title. A file over the import cap is not written (`tooLarge`).
- **Every imported byte parsed.** The file is read only under 16 MiB
  (bounded through one checked descriptor) and as strict UTF-8; the header
  names another format or version by name; the schema caps the
  transcript at 20,000 items and wants an ISO 8601 date; and any field
  the schema does not keep, anywhere, refuses the whole file (the parse
  is compared with what was read, as zod strips unknown keys).
  - **Independent file-reader repair, 2026-09-29:** picker reads use the
    existing checked descriptor reader on local `file:` URIs. The JSON
    cap applies even when bytes resemble a PDF; other providers fail with
    an explicit localized refusal instead of whole-file allocation.
    Draft real-file cases cover growth after metadata, opened-path
    replacement, oversize input, strict UTF-8 and unchanged source bytes.
    Tests and red drills remain queued until verifier allocation.
    (Run 2026-10-01: drills R4a, R4b and R5 in
    `docs/certification/m84.md`; a file gone before the read is now
    reported as missing, RV84 #6, and one that is not UTF-8 gets the
    translated `textFileInvalid`, RV84 #7.)
- **Import** (`ModelApiHost.importSession`, Model API only): fresh
  session, turn and item ids (turns start at each user message), the
  user's current model (the file's model id is informational; D49: nothing
  in it picks a model), the default effort, no goal, todos, outputs,
  children or usage; session rules are per session in memory, so none
  survive. The model is handed each imported turn as one user-role
  message: a lead marking it untrusted (the first also carries the full
  note) and the turn's items as JSON, never as assistant, developer,
  reasoning or tool-call items, so nothing in the file speaks with more
  authority than the user's data.
- **Asking every time.** The stored session keeps `imported: true`, and a
  fork copies it. The controller's `adopt` opens such a session in
  `untrustedStartMode`: the current mode when it already asks (Manual or
  Plan), else Manual, or Plan when the initial mode is Plan. That covers
  the import itself and every later resume, restore after a reload and
  fork; the restart-recovery path keeps the panel's own mode, which the
  user chose. A notice says why.
  - **Plans from imported history (lead decision, 2026-10-01, RV84 #2).**
    A Plan-mode reply written in a conversation that holds imported
    history is untrusted content, as a plan picked from a file is:
    "Implement in a fresh conversation" builds its brief as not approved
    (`planBriefFromFile` for the model) and starts in
    `untrustedBriefMode()`, with its own notice (`planFromImportedMode`).
    The controller knows such sessions from `adopt`
    (`importedSessionIds`). M74's `/handoff` must take the same flag when
    it lands.
  - **Export scrub cost (RV84 #9).** The scrub ran synchronously on the
    extension host. Measured 2026-10-01 on the Mac mini, a 4 MiB
    conversation (paths under a local root) held the event loop 1.4 s in
    one go, 0.35 ms/KiB (Windows 11 VM: 2.5 s), so 16 MiB was seconds of a
    frozen window. Three changes: `foldText` stopped allocating an array
    per character (half the time); a literal prefilter in `redactSecrets`
    (`MAY_HOLD_SECRET`) lets text with no credential literal skip the 24
    patterns in one scan, the e-mail pattern runs only on text with an
    `@`, and the digest pattern starts only at a hex run's start; and
    `buildSessionExport` is async and yields (`setImmediate`, not a timer:
    Windows' ~15 ms tick) after each 64 KiB of text. The same 4 MiB now
    takes 0.37 s, holding the loop at most 11 ms (Windows VM: 0.42 s, at
    most 14 ms). A long string is cut too (2026-10-02,
    `redactableSlices`), but only just after a line break that no
    credential runs across, so each pattern sees whole what it would see
    in the whole string; a single line longer than a slice (a pasted
    16 MiB line) still holds the loop for its own scrub, about 0.5 s.
  - **No Insert or Apply on imported history (RV84 #11).** `historyLoaded`
    carries `imported: true` for such a session, and the panel offers Copy
    only on its code blocks, as the share view does. The mark is the
    session's, not a turn's: a reply after the import was written over the
    same untrusted history, so its code blocks are Copy only too.
- **Share view.** The file's items render in a modal through the Markdown
  export's per-item sections (`transcriptItemMarkdown`); `MarkdownView`
  and `CodeBlock` take Insert and Apply as optional, and the share view
  passes neither. Links go through the host's http, https and mailto
  filter; relative links are refused.
- No paid call is involved (local files only), so D48 needs no consent.
  No live model check was run: the import sends user-role `input_text`
  messages, a shape the backend already sends (`noteItem`).
- **Port to the release candidate, 2026-10-01** (`feature/m84-export`,
  from `temp/port.patch` against main `32709441`): applied with
  `--exclude` for the six files `git apply --3way` cannot take (five new
  files plus `docs/certification/m84.md`, applied directly; the
  `m84-share.png` hunk is a content-less stub, so the capture is marked
  to-retake in `docs/certification/m84.md`). Four conflicts kept both
  sides: the candidate's 0.10.0/M72 entries and the patch's M84 entries in
  `CHANGELOG.md`; `editFile` (M72 checkpoint lease, kept: a workspace
  Markdown export still goes through `withCheckpointEditAt`; the JSON
  export did not until RV84 #5) beside `openPreview`
  (M84) in `CliFeatureDeps`, its tests and their setups. Decisions taken
  in the port: `Promise.withResolvers<void>` became `<undefined>` with
  `resolve(undefined)` (the gate's `no-invalid-void-type`); the
  remote-provider refusal test uses a literal remote URI (the shared mock's
  `Uri.parse` keeps `file`); the two new ACP load tests share a
  `loadOldSession` helper (the duplication gate); and the `vscode`
  dialogs moved to `src/host/conversation/transferDialogs.ts`, leaving
  `sessionImport.ts` portable for the host-API gate (its tests split the
  same way). `docs/ide-compatibility/host-api.md` regenerated: 26
  commands, 17 adapter files, 264 APIs. No new escape hatches (PLAN.md
  §8 needs no row). Checks that ran green: format, ESLint (incl. css),
  PSScriptAnalyzer, all five typechecks, knip, jscpd, dpdm, check:host-api,
  and the M84 unit suites. `check:l10n`'s own code reports 0 problems over
  14 tables, 104 manifest strings and 328 sources when its l10n modules are
  loaded via tsc instead of esbuild. Not runnable in this sandbox:
  `npm run check:l10n` (the esbuild binary's file reads are denied),
  `npm run build`/integration tests/`test:a11y`/harness shots (same cause,
  no browser), and seven unit tests that fail identically on pristine HEAD
  here: six real-git checkpoint captures plus the esbuild-bundled M57
  goal test (environmental, unrelated to M84). These checks ran on the
  port tree in that sandbox; the record for the tree after RV84 is
  `docs/certification/m84.md` (2026-10-01).
- **Independent review RV84, 2026-10-01.** Fourteen findings; the fixes
  are one commit each on `feature/m84-export` (#1 credential shapes and
  honest claims, #2 lead decision on plan briefs, #4 changelog, #5 JSON
  export lease, #6 missing file, #7 UTF-8 refusal, #8 share-view claim,
  #9 scrub cost, #11 Insert and Apply on imported history, #12 dead CSS),
  #3 is the rewritten certification, and #13 needs no change: the D60
  gate (`check:host-api`) holds only `src/core`, `src/shared`,
  `src/webview`, `src/acp`, `src/runtime` and the `PORTABLE_HOST` files
  to the boundary, so an adapter file in `src/host/conversation/` is
  allowed and recorded (17 files, 0 problems). Sibling dialogs live in
  `src/host/*Features.ts`; moving `transferDialogs.ts` beside the export
  dialogs in `cliFeatures.ts` is a tidy-up for the lead to choose. #10
  and #14 were left open that day and fixed on 2026-10-02 (below).
- **Follow-up reviews, 2026-10-02 (RV84c, Codex; the Muse review).**
  Fixed with a test and a red drill each (`docs/certification/m84.md`):
  - **C1, import after sign-out or close.** `importSession` loads the
    hooks, then checks the account and the host's closing again before
    the session exists, and the closing once more after its SessionStart
    hook, as `startSession` checks the account.
  - **C2, Unicode paths.** An absolute POSIX path's segments take any
    character outside ASCII that is not white space (`/srv/私密`,
    `/Users/José`, emoji folders); drive and UNC paths already did.
  - **C3, a share file that crashed the panel.** The fence's length is
    found in a loop (`Math.max(...runs)` threw a RangeError on 200,000
    runs), and each share section renders inside its own error boundary,
    which says so in its place and logs the error.
  - **Imported mode on a stale opening (Muse).** `adopt` applies the
    imported mode and mark only once the opening is still current, so an
    imported session overtaken by another opening leaves neither. The
    mark goes with its session when the panel drops it; a restart's resume
    reads it again from the record, and a plan reply carries the flag it
    was read with.
  - **RV84 #10, an import past the window.** Decision: refuse, not cut.
    The text an import hands the model is counted high, one token per
    UTF-8 byte, against `MODEL_API_IMPORT_MAX_REPLAY_BYTES` (the window
    less the reserve named text attachments keep, 786,432 bytes). A file
    over it is refused before the confirmation, naming both sizes
    (`importReplayTooLarge`, 14 tables), and `sanitizeImportedSession`
    refuses it too. Importing only the latest turns would show history
    the model never saw; the file can still be read as a share file.
  - **RV84 #14, the share view's single pass.** It renders
    `SHARE_VIEW_PAGE_ITEMS` (200) items at a time, with Show more.
  - **RV84 #9's residual.** Long strings are scrubbed in line-break
    slices (above).
  - **Lead decisions on the same class (released behaviour, one
    CHANGELOG Fixed entry).** `startSession`, `resumeSession` (its
    `revive`) and `forkSession` check the account and the closing after
    their hooks load and again after their SessionStart hook, as the
    import does; a SessionStart hook that fails in `revive` leaves no
    session. `adopt` switches a side chat to Plan only after its last
    currency check, beside the imported mode.
  - **0.10.1's JWT fix carried in.** The JWT rule is 0.10.1's linear
    dotted-words scan (`redactTokens`), so a token glued after `-` is
    redacted again; its tests (glued tokens, the differential against the
    old pattern, 128,000-character timing) are kept.

## M85 — TypeSafe assist, experimental and opt in (D50; folded into M98)

**Status 2026-10-04: superseded.**

**Amended 2026-10-04: M85 is now section 2c of M98, the SystemOne
adapter (D77).** It is phase 2, after M98's phase 1 and M95's keys. Read
M98 for its scope and acceptance. What remains M85's own:

- **The adapter.** A zod-validated client for `POST /v1/systemone`, with
  three routes:
  - TypeSafe direct (`api.typesafe.ai`, the user's TypeSafe key), **labelled
    untested** per the owner's ruling until a key exists;
  - OpenRouter (`/api/v1/systemone`, `typesafe/jev-1.13`), tested against
    the live shapes captured on 2026-10-04;
  - Cloudflare Workers AI Clef (`…/ai/run/@cf/cloudflare/clef`), listed once
    a Workers AI token exists (the owner's to mint).
- **The fake.** A fake SystemOne server built from those captures and
  Ollama's documented limits, used by every M98 test. A TypeSafe-only
  difference found later becomes a fixture, never a guess.
- **Unchanged.** D50's uses and its rule that a "safe" score leaves the
  verdict unchanged, now in M98's acceptance.

The original text follows for the record; where it differs, M98 wins.

- **Goal.** Cheaper, better-calibrated small decisions around the Muse
  model: which skill fits, how risky a command is, what context still
  matters. The Muse model stays the one that answers and acts.
- **Scope.**
  - A thin client over TypeSafe's HTTP API, zod-validated like the Model
    API client (D2).
  - The key is kept in SecretStorage; a machine-scoped
    `museSpark.experimental.typesafeAssist` setting is off by default and
    labelled Experimental.
  - It is disclosed in PRIVACY: the user's message and skill or agent
    descriptions for suggestion; the command or path for a risk score;
    for context relevance and grading, the tool output or file text
    judged. TypeSafe keeps
    data except on enterprise plans, so credential-shaped strings are
    redacted before a call, and the assist is off while
    `museSpark.confidentialWorkspace` is on.
  - It is a paid feature under AGENTS.md rule 12 with D50's one
    exception, the TypeSafe key: `typesafeAssist` in the `PaidFeature`
    union, `PaidFeatureGate` with its price, the badge, a paid row,
    `PaidUsage`, and D48's paid-use popup.
  - Timeouts are short; on failure there is no assist, and the failure is
    logged.
  - Uses:
    - skill suggestion first, and the same for a custom agent (M76);
    - then the Auto risk score, as M78's optional advisory layer: it can
      only add caution, never allow;
    - context relevance and evaluation grading, gated like M73: no path
      reaches them until their own M75 run passes, whatever the setting.
- **Backends.** Model API. Muse Code only where the extension decides.
- **Acceptance.**
  - With the setting off, nothing changes and nothing is sent.
  - With it on, every call is visible in the log (question ids and timing,
    never the content) and tallied in Account & usage.
  - No path lets a TypeSafe answer skip a question, allow an action, skip a
    deterministic rule, or answer the user. A test proves that a "safe"
    score leaves the verdict unchanged.
- **Tests.** A fake TypeSafe endpoint with Choice, Score and Noul shapes
  taken from the live API (AGENTS.md rule 13), plus the paired runs in M75.
  The capture needs a TypeSafe key only the owner can create, so M85 waits
  for it.
- **Size.** M.

### Preserved integration notes: M85 — TypeSafe assist, experimental and opt in (D50)

---

## M86 — Restore by the tools' own writes (D63)

**Status 2026-09-30: built.** Status evidence: `docs/certification/m86.md`.

- **DEFLAKE3 Windows follow-up (2026-10-04), verification in progress.**
  The original checkpoint-copy file passed 100 normal and 100 CPU-loaded
  invocations; the brief supplies no exact CI error, so the hosted trigger
  remains unconfirmed. Remove the count fixture's unnecessary hundreds of
  disk operations with a four-entry test-only budget, retaining real files,
  and prove exact traversal counts and second-pass cursor identity. Both
  deliberate bound/cursor breaks fail the named test and are restored
  byte-exact; the original test passes the broken cursor control. Require
  300 consecutive final-file passes, a full unit inventory run in batches of
  at most three files and shared static/build checks. Product remains
  unchanged; no timeout increases, retries or new skips. Receipts belong in
  [deflake3.md](docs/certification/deflake3.md); no pushes, merges or rebases.
- **Round-3 redesign (RD86, 2026-10-03), in progress.** R1: one core
  filesystem module owns exact BigInt identity samples and comparisons for
  the recorder, tool reservations, atomic/exclusive publication, plan cleanup,
  importer and ACP workspace fence; ESLint rejects identity reads elsewhere.
  R2: one CAS lease state machine owns cleanup/restore reservations, remembers
  failed releases and recovers abandoned values before every admission,
  including ordinary sends and trusted native startup. Live and uncertain
  owners remain fenced. R3: bounded mark-and-sweep removes unreferenced content
  copies after an in-flight-write grace period on retention and startup, under
  the cleanup lease with no live writer. F07's identity metadata exception stays.
  Owning suites on Kubuntu/Windows, Kubuntu's full checkpoint suite, static/build
  checks and byte-exact guard/gate drills belong in [m86.md](docs/certification/m86.md).
  These replace the sibling patches confirmed incomplete by RVM86Q.
- **FIX86 verified (2026-10-03).** `662be22c` fixes F01–F03 with twelve
  regression controls and seven byte-exact guard drills. `f6a33f5a` merges
  current main `17ba7deb`, including the M83 import adaptation below. Final
  scoped rigs passed: Kubuntu 438 tests, Windows 11 106 tests, with four
  existing skips on each. Required static/build checks passed on Kubuntu;
  [m86.md](docs/certification/m86.md) binds the receipts. Full quality and
  installed-editor certification remain the lead's gates.
- **Current-main import integration (FIX86).** M83 project imports keep the
  edit lease and storage refusal under M86; capture-era preimage and user-save
  callbacks are removed. Accepted imports remain the user's explicit writes,
  outside the model's recorder. Preserve both milestones' translations and
  real import/restore controls when merging the required current main.
- **FIX86 confirmation review (2026-10-02).** F01: share exact-value
  restore/cleanup lease takeover, recovering only gone owners or this serial
  instance's abandoned lease; preserve live and uncertain owners. F02: use
  exact BigInt device/inode samples for image reservations and opened-file
  checks. F03: retry retired-copy cleanup on each bounded retention pass,
  even without a newly retired unit. Regressions and byte-exact guard drills
  run on Kubuntu, with the image identity tests also on Windows 11; receipts
  belong in [m86.md](docs/certification/m86.md). The lane brief reserves full
  quality and installed-editor certification for the lead.
- **Status.** Implemented; M86P final merged-tree full suites passed on all
  three rigs, and Kubuntu coverage, static/build and accessibility gates passed.
  F07 closed by the lead's 2026-10-02 metadata lifetime decision. The lead's
  remaining full milestone quality and installed-editor certification stay open.
  [m86.md](docs/certification/m86.md) records the fix-batch gates and drills.
- **M86P merged Windows gate follow-up.** The final full Windows suite at
  `eb021063` found one real staged-file replacement admitted by the numeric
  inode guard (`fsAtomic.test.ts`, promise resolved instead of rejecting).
  Native probe IDs exceed JavaScript's safe integer range. Keep exact BigInt
  device/inode identities for atomic/exclusive stages and plan-stage cleanup;
  keep permission modes numeric. Extend the existing ownership regression and
  drill both admission and exact-stat reads, then refresh the full rig matrix.
- **M86FIX pre-merge batch.** Deduplicated eight reviews in the lead scratchpad
  `m86/FIX-PLAN.md`. Repaired confinement, durability, unit/copy retention,
  Redo completeness and child/background seams; strengthened real-recorder
  and deterministic tests. All tests, typechecks and builds run on the three
  rigs. Results and red drills belong in [m86.md](docs/certification/m86.md).
- **Goal.** Restore files without guessing who changed them.
- **Design.** [SPEC v3.1](docs/design/m86-restore-by-tool-writes.md) and
  [the build contract](docs/design/m86-build-contract.md).
- **L1 — Recorder.** Owner-bound file, image, workspace memory, rename and
  format-on-edit publications; confined copies, durable intents before
  conditional writes, outcomes and seals. User-facing extension writes
  and personal memory are outside recording.
- **L2 — Engine.** Pure range decisions from complete unit records,
  per-path byte chains and per-instance write order; unchanged-first,
  cross-window merge, not-kept poisoning and Redo bound to its conversation.
- **L3 — Store.** CAS sequence allocation, journal folding and recovery,
  restore/Redo execution, retention by sequence, archive re-keying,
  legacy read-only records and fenced-window-v2. Remove captures, ignored
  scans and attribution; report when commands, hooks or MCP tools ran
  without listing or undoing their changes.
- **L4 — Text and docs.** English and all 14 translations, checkpoint
  default and manifest descriptions, README, PRIVACY, CHANGELOG and this
  plan; certification skeleton for every lane and matrix row.
- **Acceptance.** Only the model's own file-tool writes are undone along
  an unbroken byte chain ending in the current file. Existing files keep
  their current mode; recreated files use the earlier recorded mode.
  Missing or incomplete records refuse the range. Personal memory is
  never restored. SPEC section 12's limits are stated in the README and
  certification.
- **Tests and gates.** SPEC matrix A–Y and O2; each still-valid M72 test
  ported, each moot deletion explained. Guard red drills, capped builds,
  localization, host API and the remaining section 14 gates; checkpoint
  suites on Kubuntu, Mac mini and Windows VM, followed by the lead's full
  quality matrix on the integrated tree.
- **Release.** `museSpark.turnCheckpoints` defaults on again with M86.
- **Size.** L.

## M87 — Panel polish (D66)

**Status 2026-10-04 (integration): joined on `m87/int` with main at
`2e341e4c`; hosted CI on the milestone PR's head and native VS Code Tasks
acceptance remain open.** The lead's integration lane merged `m87/pills`
(one blue pill per menu item), `m87/c2` (the centred chat column, even
approval buttons, the 20 px model pill, the one-row narrow toolbar),
`m87/shots` (`readme:shots`) and main four times (0.12.0, 0.12.1, M70's
review pane, M89, M90, the CI sharding, the activation diet, the release
reuse, the M80 live receipt, the accessibility gate's focus emulation),
keeping the approved heartbeat. It ported FIXM87W's Revert guard onto M70's
conditional Revert and lazy review bundle, made `/review` and Revert
exclude each other, wired the tally's Review to M70's pane, gave M70's six
review rows their tips, took main's fix (#115) for an accessibility focus
flake it had reproduced, and
applied the owner's two evening rules for the menu: a fan of crisp pills
with no goo, every pill one size (D66, "A fan of crisp pills, one size").
On Kubuntu: the full unit suite with coverage (7,291 passed), 564
accessibility pages at zero, the production build within every D6 cap,
seventeen red drills restored byte-exact, and the README's 15 screenshots
re-rendered. Evidence: `docs/certification/m87.md`, "Integration on
`m87/int`".

**Integration review fixes (FIXM87W, 2026-10-04).** Fence Revert's patch
loading, preparation and actual I/O with the current session and idle-turn
guard; hold turn admission until Revert I/O settles, and count unacknowledged
sends as running. Prove held-output/start-turn, held preparation and I/O
interleavings in the owning tests and red drills. Keep the native Tasks check
below explicitly open and correct the README's command-inventory claim.
Evidence: [m87-w-fixes.md](docs/certification/m87-w-fixes.md).
The scoped fix's 461 owning tests and nine scoped gates pass on macmini;
seven red/restored drills match their saved bytes. The port to newer main's
M70 Revert is done on `m87/int` (the integration status above); native Tasks
acceptance and hosted CI remain open.

**Status 2026-10-04: built.**

Status detail retained: built and joined on the integration branch `m87/l0`
(`feature/m87-panel-polish`); native VS Code Tasks acceptance and hosted CI on the
milestone PR's exact head remain open. Every lane is merged: 0 (strings), P
(plumbing), A (composer and menus), B (rows and status line), C
(transcript and backends, with the `turn/unqueue` live capture), D (tasks),
E (diff tally), F1 and F2 (the gooey menu and its rows), the plural gate
(L10NGATE: `check:l10n` samples the counts 0 to 200 with each language's
`Intl.PluralRules` and requires `{count}` in a `one` form that also covers
another count; 21 Russian, French and Brazilian Portuguese forms were
corrected) and W (wiring and join). Lane W joined App, removed the retired
strings and lane A's fixture, amended D66 (the conjunction list, item 17's
reply Retry and edit Revert), fixed the review findings left to it (RV87C 3
and 4, the independent review of F2), closed F2's label-placement drill,
recaptured the themes and ran the full gate. Review joined the tally once
M70's review pane (PR #69) reached main (the integration status above). The
evidence is
`docs/certification/m87.md`, which links every lane record.

- **Goal.** The panel can be read at a glance: how full the context is,
  what the agent did (one line per run of steps), what changed, and that it
  is working. The boxes are smaller, and the user controls queued messages
  and the task list.
- **Scope.** Items 1–10 and 12, as D66 decides them. No new setting.
- **Backends.** Both. Items 9 and 12 have backend parts; the rest is the
  webview's.
- **Size.** L, in seven lanes.

**Lanes and file ownership.**

| Lane                      | Items    | Files it owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Its regions in shared files                                                                                                                                                                         | Starts                                  |
| ------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 0 Strings                 | all      | `src/shared/l10n/en.ts`; the 14 tables `l10n/ui.{cs,de,es,fr,hu,it,ja,ko,pl,pt-br,ru,tr,zh-cn,zh-tw}.json`; `l10n/untranslated.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                          | —                                                                                                                                                                                                   | First                                   |
| P Plumbing                | 6, 9, 12 | `src/shared/protocol.ts`, `src/shared/agentEvents.ts`, `src/core/agent/agentBackend.ts`, `src/host/conversation/conversationController.ts`, `src/acp/translate.ts`, the new `src/host/views/tasksTabPort.ts`; `src/webview/state/uiState.ts` and `uiState.test.ts` only for its new messages' cases, then lane C's; tests `conversationController.test.ts` and the protocol and ACP translation tests                                                                                                                                                                                         | —                                                                                                                                                                                                   | After lane 0                            |
| A Composer and menus      | 1, 7, 8  | the new `src/webview/components/ContextMeter.tsx`, `Composer.tsx`, `Palette.tsx`, `SlashMenu.tsx`, `MenuOption.tsx`, `src/shared/palette.ts`, `src/shared/slashCommands.ts`; in `App.tsx` only the meter's lines (step 2); tests: the new `ContextMeter.test.tsx`, `Composer.test.tsx`, `Palette.test.tsx`, `paletteRegistry.test.ts`                                                                                                                                                                                                                                                         | Styles: the composer controls (the `.context-label*` rules become `.context-meter*`) and the `(0,3,0)` state block (Stop). Harness: after `palette`.                                                | After lane 0                            |
| B Rows and status line    | 2, 4     | `ToolBlocks.tsx`, `ToolRow.tsx`, `UserShellRow.tsx`, `StatusLine.tsx`, the new `HeartbeatTrace.tsx`; tests `toolRows.test.tsx`, `StatusLine.test.tsx`, the new `reducedMotion.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                        | Constants: `IO_PREVIEW_LINES` beside `OUTPUT_PREVIEW_LINES`. Styles: `.shell*`; `.status-line`, `.status-spark` and `@keyframes spin`; the closing reduced-motion block. Harness: after `thinking`. | After lane 0                            |
| C Transcript and backends | 3, 9, 12 | `Transcript.tsx`, the new `src/webview/stepSummary.ts`, `src/webview/state/transcriptEntries.ts`, `uiState.ts`, `snapshot.ts`, `src/shared/l10n/text.ts`, `src/core/backends/musecode/mapNotification.ts`, `MuseCodeHost.ts`, `src/core/backends/modelapi/ModelApiHost.ts`, `sessionStore.ts`, `test/e2e/fake-muse/serve.mjs`; tests `Transcript.test.tsx`, `uiState.test.ts`, `snapshot.test.ts`, `sessionStore.test.ts`, `MuseCodeHost.test.ts`, the Model API host tests, `l10n.test.ts`, the new `stepSummary.test.ts`, `helpers/transcriptFixtures.tsx`, the new `helpers/m87Capture.ts` | Styles: `.steps*`, and the user and assistant message block. Harness: after `focus`.                                                                                                                | After lane P                            |
| D Tasks                   | 5, 6     | `TodoPanel.tsx`, the new `src/webview/TasksApp.tsx`, `src/webview/main.tsx`, the new `src/shared/tasksProtocol.ts`, the new `src/host/views/tasksPanel.ts`, `src/host/html.ts`, `src/extension.ts`, `package.json`, `package.nls.json` and the 14 `package.nls.<lang>.json`, `docs/ide-compatibility/host-api.md` (regenerated); tests `cards.test.tsx` (its `TodoPanel` cases), `html.test.ts`, the new `tasksPanel.test.ts` and `TasksApp.test.tsx`                                                                                                                                         | Constants: the view type and command id beside `CHAT_PANEL_VIEW_TYPE`. Styles: `.todo*`. Harness: after `todo`.                                                                                     | After lane P                            |
| E Diff tally              | 10       | the new `src/webview/diffTally.ts` and `DiffTally.tsx`; the new tests `diffTally.test.ts` and `DiffTally.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Styles: a new block just before the goal pane's. Harness: after `goal`.                                                                                                                             | After lane 0                            |
| F Gooey chat menu         | 17       | F1: the new `src/webview/components/GooeyMenu.tsx` and `src/webview/gooeyLayout.ts`, `QuoteMenu.tsx` on top of it; F2: the row actions in `Transcript.tsx` / `ToolRow.tsx` (their hover rows become one "…" button) and the transcript's context-menu handler in `App.tsx`; tests `GooeyMenu.test.tsx`, `gooeyLayout.test.ts`, `QuoteMenu.test.tsx` and the Transcript/ToolRow action tests                                                                                                                                                                                                   | Styles: the quote menu's existing block. Harness: a `chat-menu` scenario after `transcript`.                                                                                                        | F1 after lane 0; F2 after F1 and lane C |
| W Wiring and join         | all      | `src/webview/App.tsx`, `test/unit/App.test.tsx`, `test/harness/themes/*.json` (recaptured), `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `AGENTS.md`, `PLAN.md`, `docs/certification/m87.md`                                                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                                                                                                   | Last                                    |

**Lane 0's strings** (English; each key also goes in all 14 tables):

- **A:**
  - `contextMeterLabel` "Context {percent} used".
  - `contextMeterOver` "Over the context window".
  - `contextMeterUnderOne` "<1", allowed in `untranslated.json`.
  - `paletteTips`: one sentence for each row id that `buildPalette()` emits,
    leaving out `skills:loading` and `skills:empty`, with the list fixed
    when lane 0 starts. For example, `compact` is "Summarise the
    conversation so far to free context."
  - `paletteSkillTip` "Run the {name} skill.", the tip of a skill whose
    description is empty or blank.
- **C:**
  - `stepSummary` plural forms: `edited` ("edited a file" / "edited
    {count} files"), `read`, `searched`, `ran`, `fetched`, `searchedWeb`,
    `used` ("used a tool"), `failed` ("{count} failed").
  - `messageSentAt` "Sent {time}" and `messageReceivedAt` "Received {time}".
  - `queuedLabel` "Queued" and `queuedMenuLabel` "Queued message actions".
  - `queuedEdit` "Edit" and `queuedEditTitle` "Take the message out of the
    queue and back into the prompt box".
  - `queuedDelivered` "Already delivered to the running turn".
  - `queuedTooLate` "This message already reached the model, so it can no
    longer be edited."
- **D:**
  - `todoProgress` "{done} of {total} done".
  - `todoOpenInTab` "Open in a tab" and `todoOpenInTabTitle` "Open the task
    list in an editor tab, which you can move into its own window".
  - `tasksTabTitle` "Tasks: {conversation}" and `tasksTabMoveToWindow`
    "Move into new window".
  - `tasksTabEmpty` "No tasks yet." and `tasksTabEnded` "The conversation
    this list belongs to was closed."
  - The manifest's `command.openTasks.title` "Open Tasks in a Tab" is lane
    D's, in `package.nls*.json`, because `check:l10n` fails a manifest key
    that `package.json` does not use.
- **E:**
  - `diffTallyFiles` plural forms ("{count} file changed" / "{count} files
    changed") and `diffTallyLines` "+{added} −{removed}".
  - `diffTallyLabel` "Changes in this conversation".
  - `diffTallyTitle` "Lines added and removed by this conversation's
    edits, added up edit by edit. Changes made by shell commands or by you
    are not counted."
  - `diffTallyReview` "Review" and `diffTallyReviewTitle` "Open the review
    pane on these changes".
- **Removed by lane W** once nothing reads them: `contextPercent`,
  `showHiddenSteps` and `hideHiddenSteps`.

**Implementation steps.**

- **P Plumbing.**
  1. `turnAccepted` gains `disposition`: the wire's `started`, `queued` or
     `steered`, kept open (D36).
  2. Three new messages: `withdrawQueued` (webview to host:
     `localId`, `turnId`, `userMessageId`), and `queuedWithdrawn` and
     `withdrawRefused` (host to webview). `queuedWithdrawn` carries
     `attachmentsKept`, as `sendFailed` does (M25).
  3. A new event, `messageAdmitted` (`userMessageId`): the moment a queued
     or steered message reaches a request.
  4. The item shape gains `recordedAt` (an RFC 3339 string, optional).
  5. `HOST_ACTIONS` gains `openTasksTab`.
  6. `AgentSession.withdrawQueued?(ref)` resolves to `withdrawn` or
     `tooLate`. A backend without it means no Edit.
  7. The controller routes the withdrawal to the session and caches each
     session's last todo list. It answers `openTasksTab` through an
     optional `TasksTabPort` (`open`, `update`, `ended`).
  8. Every exhaustive switch over the event and message unions handles the
     new members: the webview reducer (its first cases, before lane C takes
     the file), `src/acp/translate.ts` (a no-op said in its comment, never
     a silent drop), and any other consumer the compiler names.
- **A Composer and menus.**
  1. `ContextMeter` takes `state.context`. It computes the floored percent,
     the level (from the `CONTEXT_PRESSURE_*` constants) and the name and
     tooltip, and it draws a 22 px SVG ring. The circle has
     `pathLength="100"`, so the arc is `stroke-dasharray`, and no geometry
     is computed in TypeScript.
  2. The number sits in the ring at 10 px, or 9 px for "100". The meter is
     a button that keeps `onCompact`. `contextLabelFor` and
     `contextTitleFor` leave `App.tsx` for the component, and `<Composer>`
     gets `context` instead of the two strings. These are the only lines of
     `App.tsx` that lane A edits; the rest of the file is lane W's, later.
  3. Stop gets `send-button-stop`. Its hover and focus rules sit in the
     `(0,3,0)` block, with the high-contrast variants under
     `body.vscode-high-contrast`.
  4. `PaletteItem` gains `tip`, and `buildPalette()` fills it from
     `UI_TEXT.paletteTips[id]` or a skill's description, trimmed. A skill
     whose description is empty or blank (`skillsCli.ts` turns a missing
     one into `''`) gets `fill(UI_TEXT.paletteSkillTip, { name })`.
     `slashCommandsOf` carries it.
  5. `PaletteRow` and `MenuOption` set `title` and an `aria-describedby` to
     a visually hidden span holding the tip. The registry test fails on a
     row without one.
- **B Rows and status line.**
  1. `Clipped` takes `previewLines`, defaulting to `OUTPUT_PREVIEW_LINES`,
     and gives its toggle `aria-expanded`.
  2. `ShellBody` and `UserShellRow` render their boxes as one `.shell`
     block (border and radius on the block, a rule between the parts).
     Every part is `Clipped` at `IO_PREVIEW_LINES = 5`; the IN box was
     unclipped until now.
  3. `StatusLine` renders `StatusMark` (six `aria-hidden` circles, the
     owner's mark of 2026-10-04, in place of the earlier
     `<span class="tool-dot tool-dot-running">`), the
     verb, and `HeartbeatTrace`: an `aria-hidden` canvas the beam draws
     itself (amended 2026-10-04: Vahid's phosphor loop ported to our
     waveform, no static path; the working line's grid is `auto auto 1fr`
     so the trace sits right after the verb).
  4. The `.status-spark` rules and `@keyframes spin` are removed, with the
     static-path rules (`.heartbeat-base`, `.heartbeat-sweep`,
     `@keyframes heartbeat-sweep`, the dark-only glow). The beam adds no
     CSS animation, so the reduced-motion block names no heartbeat
     selector.
  5. `reducedMotion.test.ts` reads `styles.css`, collects every selector
     with an `animation` or `transition`, and fails if one is not set to
     none under `prefers-reduced-motion: reduce`.
- **C Transcript and backends.**
  1. `stepSummary(steps)` is pure. It reads `describeTool()`'s `body` and
     the edit and read tool sets, counts distinct paths, and returns the
     parts and the failed count.
  2. `text.ts` gains `formatList`, on `Intl.ListFormat` with
     `type: 'conjunction'` and `style: 'long'` (amended 2026-10-04, for
     D66's reason). For the timestamps it gains `formatTime`
     (`timeStyle: 'short'`), `formatFullDateTime` (`dateStyle: 'full'`,
     `timeStyle: 'short'`) and `isSameLocalDay(aMs, bMs)` (the same local
     year, month and day). The formats are built once per display language,
     beside `formatDate` and `formatDateTime`.
  3. `segment(entries, isFocusView)` gains the default-view rule (two or
     more finished steps, waiting steps never, running steps after the
     group). `StepsGroup` shows the summary as a button with `aria-expanded`
     and `aria-controls`.
  4. User and assistant entries gain `atMs`.
     - Muse Code fills it from `recordedAt`, through zod and a finite
       `Date.parse`; an invalid value means no time.
     - The Model API host stamps each user and reply item, and
       `sessionStore` keeps the time as an optional field (old files read
       unchanged).
     - The card renders `<time dateTime>`, revealed on `:hover` and
       `:focus-within`. Its text is `formatTime` when `isSameLocalDay` with
       the time the card renders, otherwise `formatDateTime`. Its `title`
       is `messageSentAt` or `messageReceivedAt` filled with
       `formatFullDateTime` (D66). No other formatter is used.
     - A card that renders no action button of its own gives the `<time>`
       `tabIndex={0}`, so the keyboard can reach and reveal it (D66).
  5. The user entry's status gains `queued`, kept until `messageAdmitted`
     or `turnStarted` for its turn.
     - The card's `onContextMenu` stops the event only when no text is
       selected, so M17's quote menu still wins.
     - It opens the card's menu (the `rewind-menu` pattern) with Edit, or
       the delivered note.
  6. **`withdrawQueued` on the Model API.** It removes the message from
     `queuedTurns` or `turn.steered`, synchronously, if it is still there,
     and emits `turnWithdrawn` with the reason `edited`. Otherwise it
     answers `tooLate`.
  7. **`withdrawQueued` on Muse Code** sends `turn/unqueue` only for a turn
     acknowledged `queued`. Its ack and late refusal are taken from the
     capture below. The fake CLI learns the verb.
  8. On `queuedWithdrawn` the reducer removes the card and puts the text
     (and the images, when kept) into the draft: alone in an empty box,
     otherwise first with a blank line.
  - **Lane C's decisions (2026-10-04), kept by lane W.**
    - Muse Code sessions have `withdrawQueued` too: the controller keeps
      their steers for an Edit, the backend answers a steer `tooLate`
      without a command, and the panel shows the delivered note instead.
    - A Model API queued turn taken back ends with `turnWithdrawn`
      (`UI_TEXT.turnUnqueued`), as Muse Code's `turn/unqueued` does; a
      withdrawn steer emits nothing. `messageAdmitted` is emitted for
      steers only: a queued turn's `turnStarted` already ends its card's
      queue.
    - The queued card's menu opens from the row's one "…" (lane F2's
      shared opener: a real Tab stop, shown on hover and focus, always on
      a device without hover), and from right-click, Shift+F10 and the
      context-menu key. Lane C's always-visible "…" became that opener.
    - A card's time starts at its send (`submitted` carries `at`, lane W)
      and the host's recorded time replaces it when it arrives.
    - Edit rows inside a folded group fetch their patch only once the group
      opens, as a collapsed row already did.
- **D Tasks.**
  - Implemented in lane D (`docs/certification/m87-d.md`); lane W gave the
    chat's `TodoPanel` its `onOpenInTab` (`hostAction` `openTasksTab`).
  - Protocol clarification: the tasks-only boundary also accepts
    `moveTasksToWindow`, required by the window-move button in D66. It cannot
    send prompts or other conversation actions. `revealConversation` remains
    a read-only host action.
  1. `TodoPanel` gets a header button (`aria-expanded`, `aria-controls`)
     with the title and `todoProgress`. Collapsed, it shows only the task in
     progress, on one ellipsised line. An optional `onOpenInTab` adds the
     tab button.
  2. `tasksPanel.ts` creates the `WebviewPanel` (`museSpark.tasksPanel`,
     `ViewColumn.Beside`, no serializer, no command URIs) with `html.ts`'s
     CSP and `data-surface="tasks"`. It implements `TasksTabPort`.
     - On every `tasksReady` it sends the cached list, since a moved webview
       reloads.
     - "Move into new window" reveals the panel, then runs
       `workbench.action.moveEditorToNewWindow`. The button appears only
       when `getCommands(true)` lists that command.
  3. `main.tsx` mounts `TasksApp` for the tasks surface. It is validated by
     `tasksProtocol.ts`'s zod schemas, posts only `tasksReady`,
     `revealConversation` and `moveTasksToWindow`, and renders `TodoPanel`.
  4. `extension.ts` registers `museSpark.openTasks` and passes each
     surface's controller its port. `npm run check:host-api -- --write`
     records the new command id.
- **E Diff tally.**
  1. `diffTally(entries)` is pure. It reads the edit rows' `patchSummary`
     and paths and returns files, added and removed, or undefined when there
     is no edit.
  2. `DiffTally` renders the row with the file count, the numbers
     (`formatNumber`), the tooltip and an optional `onReview`.
- **W Wiring and join.**
  1. In `App.tsx`: the meter's props, and the tally mounted above
     `GoalPanel` (and above M71's `GitPanel`), with Review opening M70's
     pane.
  2. `onEditQueued` posts `withdrawQueued`, and `TodoPanel` gets its
     `onOpenInTab`.
  3. Recapture the themes with `node scripts/capture-themes.mjs`, so that
     `--vscode-list-warningForeground` and the two `gitDecoration` tokens
     are measured. Record each D66 contrast figure from the capture. Run the
     full gate.

**Live capture (lane C, AGENTS.md rule 13).** `turn/unqueue` has never
been sent.

- **The run:** a script over `@muse-code/sdk`, as the earlier captures
  were, in an empty workspace on the contributor model. Start turn A.
  While it runs, send B with `ifBusy: "queue"`, and unqueue B: this
  captures the ack and `turn/unqueued`. Then send C the same way, let it
  launch when A ends, and unqueue it late: this captures the refusal.
- **Expected:** two short reply-only turns, A and C (B never runs). The
  expected attempts are stated in the record before the run and counted
  from the CLI's trace log afterwards (the owner's live-spend rule of
  2026-10-02).
- Frames go into `helpers/m87Capture.ts`, and the record goes into
  `docs/certification/m87-c.md`.

**Acceptance.**

- **1, the meter.** It reads the floored percent inside the ring at 0, 42,
  75, 95, 100 and 104 %, and "<1" at 0.4 %. The level changes at exactly 70
  and 90 %. At 104 % it shows "100" with the true share in its name. It is
  hidden with no window. A click compacts. Its name holds the percent and
  both token counts. The number is never under 9 px.
- **2, the In/Out boxes.** No gap between IN and OUT. Each shows five lines
  and then Show more, which toggles with `aria-expanded`. A `!` row behaves
  the same. Other tools keep 12 lines.
- **3, the step summary.**
  - Two finished steps fold under a summary naming them; one does not.
  - A waiting step and a running step stay visible.
  - A failure is named in the summary.
  - Focus view folds as before, under the summary.
  - The summary is grammatical in the pseudo-locale and in the shipped
    German, Turkish and Japanese tables.
- **4, the working indicator.** The bullet pulses in the progress colour.
  The trace is centred in a 690 px panel, never overlaps the verb at 320
  px, and is hidden under 260 px. With reduced motion nothing moves. No ✦
  remains.
- **5, the tasks pane.** It collapses to its two lines and expands back.
- **6, the tasks tab.**
  - The tab mirrors the list live and rebuilds after a reload of its
    webview.
  - "Move into new window" appears only when the command exists.
  - The tab says when its conversation ends.
  - Nothing in it can send a message.
- **7, the menu tips.** Every palette and "/" row has a non-empty tip as
  its `title` and accessible description. Skills show their own
  descriptions, and a skill with an empty or blank one shows "Run the
  {name} skill."
- **8, Stop.** It is red on hover and focus in all four themes, at the
  contrasts in D66.
- **9, timestamps.**
  - A message shows its time on hover and on keyboard focus, including a
    card with no action button (an imported user message), which Tab
    reaches through its `<time>`.
  - Today's message shows the time alone and an older one the date and
    time, in the display language, with the full date and time in the
    `title`. A message from 23:59 shows its date once the local day has
    changed.
  - Muse Code's history shows the captured times. A Model API session
    stored before M87 shows none, and a new one shows them after a reload.
- **10, the diff tally.** The row's totals equal the sum of the edit rows'
  summaries, with distinct paths. It is absent with no edit, and Review
  opens M70's pane.
- **12, Edit on a queued message.**
  - Right-click and Shift+F10 on a queued card offer Edit.
  - Edit puts the text back without losing a draft.
  - A late Edit leaves the card and says why.
  - A steered Muse Code card shows the delivered note.
  - Right-click on selected text still opens the quote menu.

**Tests.**

- **Unit and webview (vitest, jsdom).** Each lane's files above.
  - A: the meter at each level and edge, the ring's dash values, the name
    and tooltip, the compact click, Stop's class, and the registry and menu
    tips for a skill with an empty and with a blank description.
  - B: line clipping at 5 and 12, `aria-expanded`, the bullet, and the trace
    marked `aria-hidden`.
  - C: `stepSummary` and `segment` for every rule, `formatList` in four
    locales, `atMs` from captured frames and from stored sessions, and the
    queued lifecycle, withdraw races and draft merge.
  - C, the timestamps: `formatTime`, `formatFullDateTime` and
    `isSameLocalDay` in four locales, with the time zone fixed by the test
    and times on both sides of a local midnight (23:59 and 00:01) and of a
    UTC midnight that is not local; the card's text and `title` for today
    and for yesterday; the `<time>`'s `tabIndex` on a card with and without
    action buttons.
  - D: collapse; the tasks tab's ready, update, ended, reload and command
    probe.
  - E: tally sums and distinct paths.
- **End to end.** The fake CLI's `turn/unqueue` against the real backend.
  The Model API withdraw against the fake Model API, before and after
  `drainSteered`.
- **Integration (inside VS Code).** The tasks tab opens beside the editor
  and receives a list. The move command is probed, not run: the test host
  has no second window to watch.
- **Harness screenshots** at 690 px and 320 px, viewed and filed in each
  lane's record. Scenarios:
  - `context-meter`, `context-meter-warning`, `context-meter-full`
  - `palette-tips`, `slash-tips`, `stop-running`
  - `tool-io`, `tool-io-expanded`
  - `steps-summary`, `steps-summary-open`
  - `status-heartbeat`, `status-heartbeat-narrow`
  - `todo-collapsed` (named beside the existing `todo`), `tasks-tab`
  - `message-time` (keyboard focus on the time of an imported user message
    without rewind), `queued-menu`, `diff-tally`
  - Lane W adds `queued-menu-edit` (the Edit variant) beside them; lanes D
    and F add `tasks-tab-ended`, `tasks-tab-plain`, `chat-menu`,
    `chat-menu-narrow`, `chat-tool-menu` and `chat-tool-menu-narrow`.
- **Red drills.** Each new test and gate is seen to fail once on a
  deliberate break, then restored, as recorded in each lane's file:
  - thresholds moved to 0.8;
  - `IO_PREVIEW_LINES` set to 12;
  - a waiting step folded;
  - the trace left out of the reduced-motion block;
  - a drained steer withdrawn;
  - a file counted twice in the tally;
  - a row's tip removed;
  - a skill's empty description used as its tip;
  - the same-day check made in UTC instead of local time;
  - the `<time>` of a card without action buttons left unfocusable.

**Gates.**

- **Accessibility.** The 17 scenarios above in the four themes, 68 pages,
  with zero violations or undecided results. axe cannot hover, so the hover
  contrasts (Stop, the revealed time) are computed from the captured tokens
  and written into the record. Focus states are exercised in the harness.
  Until lane W recaptures the themes, a lane's own run sees the fallback
  colour for the three new tokens, so lane W reruns all 68 pages after the
  capture.
- **Localization.** Every key in all 14 tables, with plural forms per
  `Intl.PluralRules`, and `check:l10n` passes. The pseudo-locale shots
  show no clipped meter, summary or tally:
  `npm run harness:shots -- --lang=pseudo`.
- **Bundle budgets (D6).**
  - The last recorded sizes (M84): `dist/webview/main.js` 792.4 of 900
    KiB, `dist/extension.js` 551.6 of 600, `dist/uiText.js` 77.7 of 100,
    `dist/modelApi.js` 353.5 of 400.
  - M87's allowance: webview +20 KiB (the strings included, since the
    webview carries its English table), extension +8, uiText +6, modelApi
    +2.
  - The six branches above land first and add their own sizes. So lane W
    measures main when M87 starts. If what is left cannot hold this
    allowance, the lead amends D6 with the numbers before any lane merges.
    No budget is raised quietly.
  - **Measured by lane W (2026-10-04)**, production builds of the joined
    tree against the main it contains (`ba42dacd`), on the Windows host:
    `dist/webview/main.js` 833.4 → 860.3 KiB (+26.8), `dist/extension.js`
    577.6 → 586.3 (+8.7), `dist/uiText.js` 97.9 → 102.8 (+4.8),
    `dist/modelApi.js` 421.1 → 422.8 (+1.7); the stylesheet 40.8 → 46.0
    (+5.2). uiText and modelApi are inside the allowance. The webview and
    the extension are not: the allowance was set before item 17 (the gooey
    menu, its row wiring, the measured labels and the edit Revert, added
    on 2026-10-03 evening) and before the review fixes and the
    controller's Revert path. **Amended:** M87's allowance is webview +28
    KiB and extension +9 KiB, the measured deltas rounded up. D6's caps are
    unchanged and every bundle is inside them (webview 860.3 of 900,
    extension 586.3 of 600, uiText 102.8 of 125, modelApi 422.8 of 475).
  - **Measured on `m87/int` (2026-10-04)**, production builds on Kubuntu
    against main at `23f38dd6`: `dist/webview/main.js` 860.0 → 888.1 KiB
    (+28.1), `dist/extension.js` 552.6 → 562.4 (+9.8), `dist/uiText.js`
    105.0 → 110.2 (+5.2), `dist/modelApi.js` 426.3 → 428.0 (+1.7); the
    stylesheet 43.0 → 50.7 (+7.7). uiText and modelApi are inside the
    allowance; the webview is 0.1 KiB and the extension 0.8 KiB over it,
    after the pills, the chat column, the tally's Review and the Revert
    port. Every D6 cap holds (webview 888.1 of 900, extension 562.4 of
    600). **Open for the lead:** amend the allowance to webview +29 and
    extension +10, or trim.
- **Other gates.** The host-API record (`check:host-api`) and the bundle
  split are unchanged except for lane D's command id. No dependency is
  added.

**Docs.**

- **`README.md`:** the meter, the tasks tab and its limits, Edit on queued
  messages, timestamps and the tally.
- **`CHANGELOG.md`:** `[Unreleased]`.
- **`CONTRIBUTING.md`:** the new harness scenarios and the reduced-motion
  test.
- **`AGENTS.md`:** the layout entries for `TasksApp`, the tasks panel and
  `stepSummary`.
- **`PLAN.md`:** M87's status.
- **`docs/certification/m87.md`,** with the lane records.
- **`docs/PRIVACY.md`:** unchanged. Nothing new leaves the machine, and the
  timestamps are the backends' own.

**Security and privacy.**

- **The tasks webview** uses the chat's CSP (`html.ts`, nonce scripts, no
  inline styles), with no command URIs. It receives task text only. Its
  two messages are zod-validated and cannot reach the conversation.
- **The move command** is VS Code's own built-in command id, run with no
  arguments.
- **Withdrawing** acts only on the host's own ids for this session, and
  the text that comes back is the card's own.
- **Tips** render as text (`title`, a span), never as HTML. A skill's
  description is project content and stays text.
- **Times** are parsed, never evaluated.
- No secret, key or path is logged by any lane: the log gets fixed words
  and counts.

**Certification checklist.**

- [ ] §6.0's list on the integration branch's final tree.
- [ ] Lane 0's keys present in all 14 tables, and lane W's removals done.
- [ ] Every red drill above recorded, with its failing and restored runs.
- [ ] The `turn/unqueue` capture recorded: its workspace, its counted
      attempts, and the frames the tests use.
- [ ] The recaptured themes, and every D66 contrast figure confirmed from
      them; any token that misses has its fallback applied and said.
- [ ] 68 accessibility pages at zero, and the screenshots viewed and filed.
- [ ] The bundle deltas, each within the allowance, or D6 amended first.
- [ ] The README's tasks-tab limits and timestamp rules match D66.
- [ ] Hosted CI green on the milestone PR's exact head.

## M89 — Bundled skills (D68)

**Status 2026-10-03: built.** Status evidence: `docs/certification/m89.md`.

- **Goal.** The high-quality-projects workflows work out of the box on the
  Model API backend and, after one click, on Muse Code.
- **Scope.** D68: the vendored release and its sync script; the `bundled` skill
  source and its setting; the Muse Code install, update offer and removal;
  strings in all 14 tables; README, PRIVACY (the files the install writes),
  CHANGELOG, this plan and `docs/certification/m89.md`.
- **Lanes and file ownership.** One integration branch
  (`feature/m89-bundled-skills`); lane 0 first, then V, S and I in parallel,
  then W. Region-owned files follow M87's lane rules (constants, styles,
  harness).

| Lane      | Owns                                                                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0 Strings | `src/shared/l10n/en.ts`, the 14 `l10n/ui.*.json`, `package.nls*.json` (setting and command titles)                                                                                                                                                           |
| V Vendor  | `scripts/sync-bundled-skills.mjs`, `vendor/high-quality-projects-skill/**`, `.vscodeignore`, `scripts/third-party-notices.mjs` and `THIRD_PARTY_NOTICES.txt`, `scripts/check-vsix-size.mjs` only if the budget needs it; tests `bundledSkillsVendor.test.ts` |
| S Source  | `src/core/context/skills.ts`, `src/core/context/catalogFiles.ts` (if needed), the `bundled` constants region, the Model API `read_skill`/`/id` path; tests `skills.test.ts`                                                                                  |
| I Install | the new `src/host/skills/bundledSkillsInstall.ts`, its command registration region in `src/extension.ts`, the controller's one-time offer; tests `bundledSkillsInstall.test.ts`                                                                              |
| W Wiring  | `package.json` (setting, commands), README, PRIVACY, CHANGELOG, PLAN, `docs/certification/m89.md`, the full gate                                                                                                                                             |

- **Acceptance.**
  1. A fresh install on the Model API backend lists `project_setup`,
     `feature_delivery` and `quality_retrofit` in the slash menu and the
     model's catalogue; turning `museSpark.bundledSkills` off removes them.
  2. A project or personal skill with one of those ids shadows the bundled one.
  3. A bundled skill's body names the package root, and its `SKILL_ROOT`
     resolves inside the installed extension.
  4. The VSIX carries exactly the vendored paths in `VENDOR.json`, and the
     sync script refuses an archive whose SHA-256 differs from `SHA256SUMS.txt`.
  5. Install for Muse Code creates the package copy, the marker and the three
     links; an existing same-id folder is left alone and reported; Remove
     deletes only marked folders and links; both work on Windows (junctions),
     macOS and Linux (symlinks).
  6. The offer appears once; Not now is remembered; a newer vendored tag
     offers Update once.
  7. The VSIX stays within its D6 budget.
- **Tests.** Unit tests for each lane (fakes, temp folders, no network), with
  a red drill for every guard recorded in `docs/certification/m89.md`; the
  install on all three rigs.
- **Vendor review follow-up (2026-10-03).** Minimal ustar fixtures test the
  copy allow-list, required files, entry types, traversal, duplicates and the
  archive root; names that collide by case or trailing dots and spaces are
  refused before selection, so an excluded alias cannot replace an allowed
  file. `VENDOR.json` records each file's SHA-256 and the test checks every
  vendored file against it; the Muse Code installer reads the new records.
  Drills in `docs/certification/m89-vendor.md`.
- **Gates.** The full quality gate; the VSIX size gate; check-l10n; host-API.
- **Security.** Vendored files are fixed at build time and checksum-verified;
  nothing downloads at run time; the install writes only under the user's
  Muse config home, only on a click, and only removes what it marked; links
  never point outside the copied package.
- **Certification checklist.**
  - [x] Lane 0's keys in all 14 tables (2026-10-03, `check-l10n` 0 problems).
  - [ ] Every acceptance item above, with its test and drill (1, 2, 3, 5 and 6
        done by lanes S and I, `docs/certification/m89.md`; 4 and 7 are lane
        V's).
  - [ ] VSIX size within budget, measured.
  - [x] Install and remove proven on Windows, macOS and Linux (the three
        rigs, 56 tests each, real junctions and symlinks).
  - [ ] README, PRIVACY, CHANGELOG and this record updated (lanes 0, S, I
        and W done; lane V's rows to add).

## M90 — Auto on Muse Code: the reviewer (D69)

**Status 2026-10-04: PR #104, after two independent review rounds and a
live recheck; record in `docs/certification/m90.md`.** The reviewer is `src/host/review/` (`museCodeReviewer.ts`: the
side session and the window's queue; `reviewedApprovals.ts`: what follows a
review; `museCodeReviewerBundle.ts`: the window's port), built into
`dist/museCodeReviewer.js` and required on the first review; the
controller only decides which approvals go to it (`isReviewableApproval`
in `approvalRules.ts`) and what it is shown. The side session runs in an
empty folder under the extension's global storage, outside every
workspace, so `session/list` for the workspace never returns it (captured
live) and the controller filters its id as well.

- **Goal.** Auto on Muse Code may answer eligible unsettled approvals for
  the running turn once after a successful review. Exclusions and every
  failure path retain the normal card; each mode describes its backend
  truthfully.
- **Depends on.** PR #89 (M78's reviewer core) on main.
- **Scope.** The side-session reviewer, its setting and notice, the transcript
  row and card reason, the per-backend mode descriptions, strings in all 14
  tables, README, PRIVACY (what the reviewer is shown), CHANGELOG, PLAN D7
  correction, `docs/certification/m90.md`.
- **Acceptance.**
  1. In Auto on Muse Code, an approval the reviewer ALLOWs is answered allow
     once without a card and shows in the transcript with its reason.
  2. ASK, an unreadable answer, a timeout, an error and a tripped breaker each
     leave the card to the user (with the reason when there is one).
  3. Manual, Edit automatically, Plan and Bypass never consult the reviewer;
     the setting off disables it.
  4. The side session is never listed, runs in Plan mode in an empty folder,
     uses the conversation's model, and is recreated after a Muse Code
     restart or exit, timeout, busy fallback or tool activity. Any item
     other than an agent message or reasoning cancels its turn and shows
     the failure card. A command covered by an always-allow rule could run
     in that empty folder before the cancel lands; native tools cannot be
     disabled through the SDK's `SessionConfig`.
  5. The reviewer is shown the user's latest message, the turn's earlier
     calls and the request, all marked as data (M78's input), and its
     verdict text is never executed.
  6. Mode descriptions match the investigation above on both backends.
- **Tests.** Unit tests against the fake CLI for every acceptance item, each
  guard with a red drill; one live check on the contributor model in an empty
  workspace (a safe and an unsafe script) with the model calls counted.
- **Gates.** The full quality gate; activation bundle within D6 (the reviewer
  loads lazily if it is over ~3 KiB).
- **Certification checklist.**
  - [x] Acceptance 1–6 with tests and drills (`docs/certification/m90.md`).
  - [x] Live check recorded with its call count.
  - [x] README, PRIVACY, CHANGELOG, PLAN D7 and this record updated.

## M91b — Amp and OpenCode plugin dispatch (D70)

**Status 2026-10-05: done on `m91/w-plugins` (`5a2aa619` and its docs
commit); it ships with M91 in the 0.14.0 batch, not as a separate pull
request.** Split from M91 at the lead's 07:00 checkpoint, after the RVM91X
fixes (`22e9e7ff`). The record is `docs/certification/m91-wp.md`: 28 red
drills, Kubuntu and Win11 green. Its residuals are in §9 ("Amp and
OpenCode plugin hooks").

- **Scope, exactly this list:**
  - dispatch in `foreignHooksEntry.ts`, with the session's `dispose` ending
    plugin children;
  - the plugin records in `spark-hooks.json` (`format` amp or opencode, a
    `plugin` path, a `{ type: 'plugin' }` handler) and the `plugin`
    ForeignPreparation, run under the host-wide cap and the same judge;
  - the tool-name and argument maps, from the saved sources only;
  - `src/core/import/pluginImport.ts` and its glue in the importer;
  - the bundle move: the plugin host in `dist/pluginHooks.js`, required on
    the first plugin hook (D6);
  - RVM91X P2s 9, 10, 12 and 15.
- **The lead's rulings (2026-10-05):**
  - Amp's `tool.call` `error` matches Amp: the tool never runs and the turn
    ends with the plugin's reason. The fail-open and fail-closed rules cover
    transport failures only.
  - Windows job preparation: a hook never runs without a tree. A failure is
    retried once after a short delay, then stays, with a notice in the
    user's language, until **Muse Spark: Retry Plugin Hooks**.
  - P2 12: Windows bounds the job's memory; Linux bounds bun with `prlimit
--data`; elsewhere bun is refused rather than run unbounded.
- **Still planned, not in M91b's build: imported hooks on extension
  events** (lane W, 2026-10-05):
  - Cursor `workspaceOpen` and `afterAgentThought`;
  - Windsurf `post_setup_worktree`;
  - Kiro `PreTaskExec` and `PostTaskExec` (and `Manual`, which lane I
    refuses as unmapped);
  - Gemini `BeforeToolSelection`.

  They need the adapters in lane E's dispatcher (`dispatchExtensionHooks`)
  and in the window's runner, which loads `dist/foreignHooks.js` lazily.
  Until then the importer refuses them, and the preview gives the reason in
  the user's language: `weaker` where the source event can refuse or narrow
  (`HOOK_IMPORT_REFUSING_EXTENSION_SOURCES`: Gemini `BeforeToolSelection`,
  Kiro `PreTaskExec`), otherwise `unsupported`. Gemini's
  `BeforeToolSelection` also needs a source-shaped `llm_request` (lane P,
  RVM91P3). The Kiro spec-task note (`agentImportKiroTaskNote`) shows again
  once they import.

## M95b — Subscription sign-in: ChatGPT plan, Copilot models, plan keys (D74)

**M95R4 scope (2026-10-05, Windows 11 rig).** The continuation brief
authorizes `--no-ff` merges of STARTDIET3 and FIXVSIX2, installation of
PSScriptAnalyzer 1.25.0 for the current user, completion of the shared
configured-provider/plan-key transport, the Copilot integration repair,
the complete repaired accessibility scan and one final three-worker quality
run. This explicit completion instruction supersedes round three's stopped
size clarification and Copilot repair path. Keep every existing cap and gate;
split M95 code lazily where required. Use captured codecs, per-request
origin-bound credentials, DNS/address policy and pinned Node requests;
share the factory between VS Code and ACP. Copilot stays VS Code-only.
Record acceptance 1–19 and M95b 1–10 separately from the exact counted live
receipts still needed by the lead. No live/paid calls, credentials read from
the rig, push, rebase or further branch merge. Evidence: `m95-r4.md`.

The completion keeps every existing cap. Subscription execution moves to
`dist/subscriptions.js` (50 KiB) and configured-provider requests to
`dist/configuredProviders.js` (25 KiB), both loaded on first use and both
included with the nonsecret provider catalogue in the ACP package. Captured
codecs stay exclusively in `dist/providers.js`. M95 plan/provider usage sections
share the existing action-dialog cohort; the seven legacy deferred components
still count against their unchanged 50 KiB cap, with their shared dependencies.
Selected capability records, origin-bound per-request credentials, pinned DNS,
configuration revalidation and plan attempt accounting are exercised through
the real VS Code factory and shared ACP runtime. General credential-management
CLI/headless commands and live OpenRouter connect/usage remain separate open
acceptance work; no unsupported command is advertised.

The final configured-provider review also covers Gemini's captured free model
list: preserve the existing parser's normalized model ID when carrying native
metadata into the shared capability scan. The captured `models/` prefix must
not prevent catalogue evidence from joining the selected model. Prove this
with the entire transport test file failing before the product correction.

The final whole-suite integration also checks the diet's exact VSIX allowlist:
include the two new lazy bundles, remove duplicate allowlist entries and keep
the crash-report frame vocabulary equal to the actual shipped JavaScript.
Account-modal App tests must await the newly lazy account content before
checking its report, retaining immediate clearing at an account boundary.
The fake-only headless package guards must also supply the production packer's
newly required bundles and real localization/export-check inputs. Keep those
checks active and test removal of every newly required archive member.
The existing model-policy test must match D74's zero-dollar plan reserve and
settlement, retaining its refusal for unpriced models and its local assertions.
Keep the exact English/German help assertions complete by including the new
provider-command usage entry. The production browser build hook uses the rig's
120-second deadline; retain every size assertion. Package-guard fixtures may
reuse the owning packer's exact output only for identical bundle/table bytes,
while every package still runs the real localization check. For identical tar
bytes, checker source, Node version and command mode, the isolated fixture may
reuse a successful native export check; every distinct artifact runs the
owning checker, and failures are never cached. Production checking is unchanged.

**M95R3 cost and gate repairs (2026-10-05).** Strengthen the unpriced
usage regression with a cached total and retain dollar estimates only when
the legacy Model API tariff is known and pricing is not unpriced, local or
plan. Native settled costs remain in their provider rows. Consolidate the
reviewer split mutation into the existing parameterized cohort drill and
reuse the existing fake-host dependency fixture for Gemini; gates and
assertions remain unchanged or stronger. Restore the split checker to scan
every emitted JavaScript file, including browser chunks, against its own
text and declared readers; do not attribute all browser text to main.js.
Model the new Models entry point in the existing budget fixtures without
changing any cap. Replace formatter/linter-conflicting nested ternaries
with ordinary control flow. The complete accessibility scan reports zero
rule violations but 18 harness pages without a result. Start scenarios only
after the real webview ready message, wait for the Models section rather
than its early nav shell, and close the ChatGPT allowance disclosure through
its real button before opening plan usage. Keep every existing wait, scan
rule and full-run failure receipt; recheck all affected scenarios in four
themes before the final aggregate gate.

**M95R3 contributor guard repair (2026-10-05).** The release/M95 join
left a remembered-consent return ahead of the confidential-workspace check
and duplicated that return. Restore the release ordering: a confidential
contributor is refused with the warning even after earlier consent. Retain
M95's fresh qualified-provider privacy lookup. Use the existing whole-file
regression, then disable this guard once, observe red, restore SHA-256 exact
and rerun green.

**M95R3 scope (2026-10-05, Windows rig).** Merge release 0.14.0, CAPREC,
lane I, DEFLAKE5 and M95b in the brief's order. Close acceptance 9 with
a shared configured-provider registry and the five captured codecs: selected
capability records drive tools, media, reasoning and output bounds; captured
plan-key presets use plan accounting instead of a dollar price. Reuse the
existing request/retry/idle guards and pinned Node HTTP transport. Read keys
per request from the supplied SecretStorage/OS-store port, bind the exact
origin, refuse redirects and revalidate configuration and DNS before send.
Use fake servers through the real host and ACP runtime; Meta goldens stay
byte-identical. No live receipts, dependency or gate changes are authorized.
Copilot is limited to VS Code's Language Model API; other editors retain
their own Copilot plugin and this agent's ChatGPT/API-key routes.

The Copilot factory integration regression failed after two distinct merge
repairs (missing plan catalogue fields, then request dispatch refusal). The
shared lane stopping rule applies: retain the failing receipt, stop that
repair path and report it in docs/certification/m95-r3.md.

**M95BINT integration (2026-10-05, Windows 11 rig).** Merge S/C/V/X/U's
reviewed work, preserve their records, and close the production seams: exact
subscription schemas, account-catalogue discovery, a lazy provider registry
over the existing Model API client contract, panel actions and extension
commands, and the same registry in the ACP runtime. Plan attempts bypass
dollar reservations, retain their own request/token tallies, and supply the
qualified model/provider to hooks. Fake-only end-to-end checks cover browser
sign-in, catalogue selection, a turn and the captured HTTP-200 SSE limit;
Copilot uses its host adapter and remains unavailable outside VS Code. Update
all translations, subscriptions/privacy docs and acceptance 1–10 in
`docs/certification/m95b.md`. The first composed build measured chat startup
at 901.3/900 KiB; defer the optional Handoff and Best-of-N dialogs through the existing
dismissible loading surface and add it to the existing 25-KiB deferred cap
and split guard (no threshold changes). No live or paid calls; full quality and hosted
editor/live receipts remain the lead's gates under the 150-minute rig brief.
The host API gate caught a core type import reaching the VS Code entry; its
seam contract now lives with the existing pure provider ports. The compiled
Models bundle's language regression also failed before repair: subscription
factories install both their local language state and the providers bundle's.

**FIXM95BU review repair (2026-10-05, macmini rig).** Repair all three
RVM95BU P2 findings within lane U: the production notice port keys browser
acknowledgement by provider plus a host-supplied SHA-256 account-id hash,
never email/token, and reads again on account/port replacement while mounted.
The authored `authState.planAccount` bridge field carries only that provider
and hash; V/W supply it from the verified account, with missing identity
showing the notice without a persistent acknowledgement. Keep dismissed
plan limits by turn id in conversation state and its validated snapshot,
preserving them through model switches/unmounts and clearing them after a
successful new turn or conversation replacement. Derive plan billing text
from the bound qualified model reference before optional catalogue metadata,
including an empty or inconsistent catalogue. Each finding gets regression
coverage and byte-exact red drills in `docs/certification/m95b-u.md`.
No dependencies, new service-wire shapes, paid/live calls or relaxed gates;
W retains aggregate docs and host identity production.

**M95BINT U-review composition (2026-10-05).** Merge the newly arrived
`m95b/ufix` and supply its authored `authState.planAccount` from the owner's
captured OIDC `sub` claim, hashed only after signature/issuer/audience/expiry/
nonce verification. Persist only that hash in this product's secret record;
never email, a raw subject, a token-derived hash, installation id or echoed
cache key. Preserve it across refresh without an ID token; reject a verified
subject change during rotation. Legacy/missing-identity grants retain the
fail-closed disclosure until a verified sign-in/refresh supplies identity.
The VS Code auth service publishes it only for signed-in Model API state;
account changes refresh that snapshot. Test hash privacy, refresh continuity,
changed-subject refusal, host publication and U's account/dismissal regressions.
Other ACP editors still receive the explicit pre-sign-in plan notice; cross-
editor/profile webview persistence remains an installed-host receipt. Own-store identity parsing also sanitizes corrupted-record errors before the host can expose their detail.

**FIXM95BS review repair (2026-10-05, Windows 11 rig).** Repair all four
RVM95BS findings in the owned sign-in core and tests: atomically persist a
replacement grant as a pending refresh before validation, preserve it in
memory if the secret store refuses the write, and resume validation or revoke
that replacement without spending the old refresh token again. Pending grants
are never returned before ID-token/scope validation and the caller's validity
margin; an insufficient lifetime raises the typed `expired` failure without
an internal refresh loop. HTTP/network outages remain retryable
`request-failed`; only token-endpoint HTTP 400/401 `invalid_grant` asks for
sign-in. Endpoint-specific fakes must prove token/revocation refusals reach
their named endpoints. Port method signatures stay unchanged; the secret
record gains an optional pending-refresh validation marker. Regression tests,
byte-exact red drills and integration/storage limits go in `m95b-s.md` and §9.
No dependency, guard relaxation, live call or another lane's implementation.

**FIXM95BC review repair (2026-10-05, RVM95BC).** Within lane C's codec,
tests, request fixtures and certification, preserve validated reported usage
in the output-cap error for the canonical adapter's ordinary failure
settlement; prove the actual `ModelApiHost` emits all four token tallies
without replaying excess output. Add the supplied scrubbed namespace-request
comparison, preserve its description and declared strictness, and enumerate
every intentional harness adaptation beside the test. Keep the existing
contract golden, API-key profiles, guards and dependencies unchanged. Each
finding gets an owning-file red drill with byte-exact restoration, recorded
in `docs/certification/m95b-c.md`. The rig brief delegates full quality and
shared README/CHANGELOG integration to the lead/lane W and forbids
merge/rebase/push; focused checks run directly on Kubuntu.

**FIXM95BV review repair (2026-10-05).** RVM95BV-1–3 are repaired in
the VS Code adapters: publish complete lock-owner records atomically, recover
dead owners without removing live owners, bound and cancel token counting,
and settle dispatched attempts with the estimates retained through failure
or consumer closure. Offline regressions and byte-exact red drills belong in
`docs/certification/m95b-v.md`. RVM95BV-4 requires shared subscription schemas,
registry dispatch and translations that are absent from this base and outside
this repair's owned files; see the named release blocker in §9.

**FIXM95BX review repair (2026-10-05).** Finish RVM95BX's two P2s:
connect the exact ChatGPT provider grammar to runtime dispatch and expose the
same terminal actions through ACP authentication; install translated command
and callback text in all fourteen tables. Use the existing atomic providers
file with a separately pinned ChatGPT subscription entry and the owner's
captured account catalogue, without relaxing API-key or origin validation.
Classify native OS-store failures with a fixed `store-unavailable` code that
survives locking and host creation and directs the user to an interactive
desktop session. Test production parser/dispatch, ACP exposure and sanitized
failure paths, and record deliberate red drills in `m95b-x.md`. No live or
paid calls, dependency, merge, rebase or push; the lead runs full quality.
The runtime factory is exported by the existing `providers.js` entry and
resolved there by the ACP build's dynamic-import plugin. This is required by
the unchanged provider-core exclusion guard; the factory installs the caller's
language table before use. Parser-only grammar stays in cliArgs, so help,
invalid arguments and headless/Meta-only command parsing load no provider core.

**Status 2026-10-05: built.**

Status detail retained: ChatGPT/Copilot production paths integrated with
fake-server evidence; release certification remains open. The account
catalogue, headerless SSE, limit recovery, plan tallies, VS Code actions and
ACP dispatch now compose. Plan-key transports/Hugging Face registration and
the owner/live/installed-editor receipts remain prerequisites; see
`docs/certification/m95b.md` and Q-M95BINT.

- **Goal.** A user with a ChatGPT Plus or Pro plan, or a Copilot plan, runs
  the harness on that plan's inference with one click in the same panel,
  through flows the provider sanctions; the UI says which plan pays.
- **Scope.**
  - **ChatGPT plan** (`chatgpt`): OpenAI's Sign in with ChatGPT with plan
    usage, the dynamic client, the token store, refresh and revocation, the
    preview rules in a `responses` codec profile, OpenAI's required UI.
  - **Copilot's models** (`copilot`, VS Code only): a host-side
    `ProviderClient` over `vscode.lm`, opt-in and labelled reduced.
  - **Plan-key presets**: MiniMax M Plan, Alibaba Model Studio Coding Plan
    and Mistral's plans as API-key presets whose models are marked "plan".
  - **Hugging Face sign-in** (OAuth with PKCE and the `inference-api` scope)
    once the owner has registered the app; the token preset is M95's.
  - Plan tallies in Account & usage; the picker's and pill's plan marks;
    strings in all 14 tables; README, PRIVACY, CHANGELOG, this plan,
    `docs/certification/m95b.md`.
  - **Not here**: Anthropic and Google plans (prohibited; D74); xAI's,
    Z.ai's and Kimi Code's plan sign-ins (D74, settled); the Claude Code
    backend (its own milestone after this one, D74).
- **Lanes and file ownership.**

| Lane           | Owns                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Strings      | `en.ts`, the 14 tables, `package.nls*.json`                                                                                                                                                                                                                                                                                           |
| S Sign-in core | new `src/core/providers/subscriptions/chatgpt.ts` (authorize URL, token exchange, refresh, revoke, the ID-token check against the JWKS with `node:crypto`, the record schema), `huggingface.ts` (its OAuth with PKCE, once the app is registered), `planUsage.ts` (plan tallies), the plan-key presets' region of `presets.ts`; tests |
| C Codec        | the `chatgpt` profile of `modelapi/codecs/responses.ts` (preview rules, tool namespaces, the client-side output cap); goldens                                                                                                                                                                                                         |
| V VS Code side | `src/host/providers/chatgptSignIn.ts` (the loopback helper from M95, `openExternal`, the cross-window refresh lock in global storage, SecretStorage), `src/host/providers/copilotClient.ts` (the `vscode.lm` client, consent, feature detection), their rows in the Providers section; the command region of `src/extension.ts`       |
| U UI           | the pill's plan mark and **Manage usage**, the one-time plan notice, the usage-limit screen, Account & usage's plan rows, the Copilot AI-content note and report link; harness scenarios                                                                                                                                              |
| X ACP          | `muse-spark-code-acp providers add chatgpt` (a loopback server in the agent, the URL printed for the user's browser), the OS store record; no Copilot (no VS Code)                                                                                                                                                                    |
| W Wiring       | `package.json`, README (**Subscriptions**: who may use which plan, Plus and Pro only, what is reduced on Copilot), PRIVACY (what OpenAI and GitHub receive), CHANGELOG, PLAN, `docs/certification/m95b.md`                                                                                                                            |

- **Steps.**
  1. **Capture first, with the owner's own Plus or Pro sign-in** (Owner
     step; it spends his plan, not money): one short turn in an empty
     workspace with a tool call, to settle what the docs leave open: plain
     top-level function tools or namespaces; whether `reasoning` with
     encrypted content, `prompt_cache_key` and usage with cached tokens
     come back; the `models[]` list; a usage-limit error if one can be had.
     Counted from the request log. Also whether `vscode.env.asExternalUri`
     can give a remote window a `127.0.0.1` callback (else remote windows
     say to sign in from a local one).
  2. The sign-in core and record (lane S), then the codec profile (lane C),
     then the VS Code side and UI (lanes V, U), the ACP agent (X), docs
     (W).
  3. Copilot: consent from the panel's click,
     the canonical-to-`vscode.lm` mapping, feature detection for images,
     usage from the reported data part where present and `countTokens`
     otherwise.
- **Acceptance.**
  1. **Continue with ChatGPT** signs a Plus or Pro user in through the
     system browser and a `127.0.0.1` callback, stores the issued client
     and tokens in SecretStorage, and a turn with tools runs on the plan.
  2. A Free or ineligible account gets OpenAI's refusal in plain words
     before any conversation starts.
  3. The access token refreshes before it expires, once across two open
     windows; a revoked or disconnected grant asks to sign in again.
  4. **Remove** revokes the refresh token and deletes the record; nothing
     of Codex CLI's, Claude Code's, Gemini CLI's or Copilot's own storage is
     ever read (a test that the code names none of their paths).
  5. The request follows the preview rules (no `max_output_tokens`, no
     `prompt_cache_retention`, `store: false`, `stream: true`, full
     history), and a reply that passes the output cap is ended by the host.
  6. The one-time plan notice, the "Using ChatGPT plan" mark with **Manage
     usage**, and the usage-limit screen on
     `subscription_sharing_usage_limit_exceeded` appear as OpenAI's UI rules
     ask.
  7. Plan use asks no paid-use popup, is tallied per provider in Account &
     usage (tokens where reported, requests always), and is never counted
     against a dollar cap; the notice says when the provider can spend
     credits beyond the plan.
  8. Copilot: consent comes from the click; the tool loop runs;
     the model is marked reduced; budgets show estimated tokens; quota
     errors are said plainly; a confidential workspace hides it; the
     AI-content note and report link are shown.
  9. A plan-key preset shows "plan" instead of a price and links the plan's
     limits.
  10. Every hook event fires with the provider id and qualified model.
- **Tests.** The authorize URL's parameters; `state` and nonce refusals; the
  ID token's signature, issuer, audience, expiry and nonce checks (each
  drilled); the scope check (`chatgpt.tokens.use.direct` missing refuses);
  refresh rotation and the lock; revocation on remove; the preview-rule
  golden; the client-side output cap; the Copilot mapping against a fake
  `vscode.lm` (tools, tool results, consent refused, quota errors); the
  guard that no other application's credential path is read. Each with a
  red drill in `docs/certification/m95b.md`.
- **Gates.** As M95's; the sign-in code in `dist/modelsPanel.js` and the
  codec profile in `dist/providers.js`, both within their caps.
- **Security.** PKCE `S256`, `state` and nonce; the callback server on
  `127.0.0.1` only, one use, ten minutes; the ID token verified before a
  scope is trusted; the refresh token bound to `https://auth.openai.com`
  and sent nowhere else, the access token to `https://api.openai.com`;
  tokens never in the webview, logs, hooks, tools or children; the
  persistent host id opaque (never an e-mail or a user id); revocation on
  remove; Copilot's grant held by VS Code, never by us. Threat additions:
  a local process racing for the callback port gains nothing (PKCE); a
  phishing page cannot complete the flow without the verifier; a stolen
  token is bounded by its hour and by revocation.
- **Cost controls.** Plan use spends the user's plan, said before sign-in
  and in the one-time notice, with the credit caveat where it applies; the
  capture is one counted turn on the owner's plan; no background calls;
  Copilot's AI credits named in its consent step.
- **Docs.** README **Subscriptions**; PRIVACY (OpenAI receives the
  conversation as with an OpenAI key; Copilot's requests carry Copilot's
  own rules and GitHub's training terms for individual plans); CHANGELOG;
  `docs/certification/m95b.md`.
- **Owner steps** (credentials and registrations only): sign in once with
  his Plus or Pro account for step 1's capture, and allow Copilot once for
  step 3's live check (both spend his plans, not money); register the Hugging Face
  OAuth app on huggingface.co; optionally ask xAI, Z.ai and Moonshot to
  list the extension for their plan sign-ins.
- **Certification checklist.**
  - [ ] Step 1 capture recorded with its counted calls.
  - [ ] Acceptance 1–10 with tests and drills (`docs/certification/m95b.md`).
  - [x] README, PRIVACY, CHANGELOG and this record updated.

### Preserved integration notes: M95b — Subscription sign-in: ChatGPT plan, Copilot models, plan keys (D74)

**Status 2026-10-04: planned.**

Status detail retained: planned with M95; research in
`docs/certification/m95-research.md` §6. Starts when M95's seam (lanes P, T
and I) has merged.

- **Steps.**
  1. **Capture first, with the owner's own Plus or Pro sign-in** (Owner
     step; it spends his plan, not money): one short turn in an empty
     workspace with a tool call, to settle what the docs leave open: plain
     top-level function tools or namespaces; whether `reasoning` with
     encrypted content, `prompt_cache_key` and usage with cached tokens
     come back; the `models[]` list; a usage-limit error if one can be had.
     Counted from the request log. Also whether `vscode.env.asExternalUri`
     can give a remote window a `127.0.0.1` callback (else remote windows
     say to sign in from a local one).
  2. The sign-in core and record (lane S), then the codec profile (lane C),
     then the VS Code side and UI (lanes V, U), the ACP agent (X), docs
     (W).
  3. Copilot: consent from the panel's click,
     the canonical-to-`vscode.lm` mapping, feature detection for images,
     usage from the reported data part where present and `countTokens`
     otherwise.
- **Acceptance.**
  1. **Continue with ChatGPT** signs a Plus or Pro user in through the
     system browser and a `127.0.0.1` callback, stores the issued client
     and tokens in SecretStorage, and a turn with tools runs on the plan.
  2. A Free or ineligible account gets OpenAI's refusal in plain words
     before any conversation starts.
  3. The access token refreshes before it expires, once across two open
     windows; a revoked or disconnected grant asks to sign in again.
  4. **Remove** revokes the refresh token and deletes the record; nothing
     of Codex CLI's, Claude Code's, Gemini CLI's or Copilot's own storage is
     ever read (a test that the code names none of their paths).
  5. The request follows the preview rules (no `max_output_tokens`, no
     `prompt_cache_retention`, `store: false`, `stream: true`, full
     history), and a reply that passes the output cap is ended by the host.
  6. The one-time plan notice, the "Using ChatGPT plan" mark with **Manage
     usage**, and the usage-limit screen on
     `subscription_sharing_usage_limit_exceeded` appear as OpenAI's UI rules
     ask.
  7. Plan use asks no paid-use popup, is tallied per provider in Account &
     usage (tokens where reported, requests always), and is never counted
     against a dollar cap; the notice says when the provider can spend
     credits beyond the plan.
  8. Copilot: consent comes from the click; the tool loop runs;
     the model is marked reduced; budgets show estimated tokens; quota
     errors are said plainly; a confidential workspace hides it; the
     AI-content note and report link are shown.
  9. A plan-key preset shows "plan" instead of a price and links the plan's
     limits.
  10. Every hook event fires with the provider id and qualified model.
- **Tests.** The authorize URL's parameters; `state` and nonce refusals; the
  ID token's signature, issuer, audience, expiry and nonce checks (each
  drilled); the scope check (`chatgpt.tokens.use.direct` missing refuses);
  refresh rotation and the lock; revocation on remove; the preview-rule
  golden; the client-side output cap; the Copilot mapping against a fake
  `vscode.lm` (tools, tool results, consent refused, quota errors); the
  guard that no other application's credential path is read. Each with a
  red drill in `docs/certification/m95b.md`.
- **Gates.** As M95's; the sign-in code in `dist/modelsPanel.js` and the
  codec profile in `dist/providers.js`, both within their caps.
- **Security.** PKCE `S256`, `state` and nonce; the callback server on
  `127.0.0.1` only, one use, ten minutes; the ID token verified before a
  scope is trusted; the refresh token bound to `https://auth.openai.com`
  and sent nowhere else, the access token to `https://api.openai.com`;
  tokens never in the webview, logs, hooks, tools or children; the
  persistent host id opaque (never an e-mail or a user id); revocation on
  remove; Copilot's grant held by VS Code, never by us. Threat additions:
  a local process racing for the callback port gains nothing (PKCE); a
  phishing page cannot complete the flow without the verifier; a stolen
  token is bounded by its hour and by revocation.
- **Cost controls.** Plan use spends the user's plan, said before sign-in
  and in the one-time notice, with the credit caveat where it applies; the
  capture is one counted turn on the owner's plan; no background calls;
  Copilot's AI credits named in its consent step.
- **Docs.** README **Subscriptions**; PRIVACY (OpenAI receives the
  conversation as with an OpenAI key; Copilot's requests carry Copilot's
  own rules and GitHub's training terms for individual plans); CHANGELOG;
  `docs/certification/m95b.md`.
- **Owner steps** (credentials and registrations only): sign in once with
  his Plus or Pro account for step 1's capture, and allow Copilot once for
  step 3's live check (both spend his plans, not money); register the Hugging Face
  OAuth app on huggingface.co; optionally ask xAI, Z.ai and Moonshot to
  list the extension for their plan sign-ins.
- **Certification checklist.**
  - [ ] Step 1 capture recorded with its counted calls.
  - [ ] Acceptance 1–10 with tests and drills (`docs/certification/m95b.md`).
  - [ ] README, PRIVACY, CHANGELOG and this record updated.

## M99 — What's New after an update (D79)

**Status 2026-10-04: built.**

Status detail retained: built on `feature/m99-whats-new`; record in
`docs/certification/m99.md`. Activation's side is
`src/host/whatsNew/whatsNew.ts` (the check, the claim, the wait for a quiet
window, the loader) over `src/core/whatsNew/whatsNewVersions.ts` (semver,
the install or upgrade decision, the releases a page shows, page or notice).
`dist/whatsNew.js` is `whatsNewEntry.ts`, `whatsNewPanel.ts` (the tab and
its messages) and `whatsNewHtml.ts` (the page, the Try it allow list) over
`src/core/whatsNew/whatsNewContent.ts` (the schema).

- **Goal.** After an update the user sees what changed and can try it, once,
  in one window, without losing focus or interrupting a turn.
- **Scope.** D79: the content generator in `npm run build`; the update
  check, claim and timing; the page, its script and stylesheet; the setting,
  the command and the palette item; the changelog guard; strings in all 14
  tables; README, RELEASING, CHANGELOG (with this release's Highlights), the
  host API record, this plan and `docs/certification/m99.md`.
- **Acceptance.**
  1. A fresh install records its version and shows nothing.
  2. An upgrade shows the page once, in the background, after the window
     settles; the next activation of that version shows nothing.
  3. Of several windows activating together, exactly one shows it.
  4. The same version or a downgrade shows nothing, keeping the newer record.
  5. The setting off shows nothing (the version is still recorded).
  6. A fixes-only patch shows the notification; **What's New** opens the
     page, **Don't show again** turns the setting off.
  7. Nothing shows while a turn runs or within `WHATS_NEW_QUIET_MS` of an
     edit.
  8. A Try it for a command or setting the extension does not contribute
     fails the build, is never rendered, and is refused if asked for.
  9. The page has its CSP with the load's nonce, escapes the notes, and opens
     links through `openExternal` from the host's own list.
  10. `dist/whatsNew.js` and the page script are not in `dist/extension.js`;
      the page script carries no package or display table.
  11. The generator keeps released sections only (`[Unreleased]` excluded)
      and splits them at their headings.
  12. A minor release without Highlights fails the changelog test.
  13. The shipped content keeps only the newest two releases' full notes,
      plus the newest earlier Highlights when needed; upgrades from before
      that window still show Highlights and the full-changelog link.
      `dist/whatsNew.json` has a hard 40 KiB raw budget, red-drilled, and the
      packaged VSIX is compared with main `bf77aabe` on the same rig.
- **Tests.** `whatsNewVersions`, `whatsNewContent` (the generator),
  `whatsNewHtml` (with axe in jsdom), `whatsNewPanel`, `whatsNew`,
  `whatsNewPage`, `whatsNewBundle` (the shipped bundle against a stand-in
  `vscode`), `changelogVersion`, `manifest`, `settings`, `App`; each guard
  red-drilled on a rig.
- **Gates.** The full quality gate; D6 budgets with the two new rows; the
  bundle-split gate's new entries; check-l10n; host API.
- **Certification checklist.**
  - [x] Acceptance 1–12 with tests and drills (`docs/certification/m99.md`).
  - [x] Strings in all 14 tables (check-l10n 0 problems).
  - [x] Full quality gate on Kubuntu at `b23e1181`, exit 0 (m99.md).
  - [x] Acceptance 13 and FIXM99 review fixes at `696ec15d`: JSON 34,410
        bytes, hard 40 KiB cap, 282 targeted tests passed, drills fired
        (win11; m99.md).
  - [x] Local Windows VSIX 2,102,696 bytes, within 2200 KiB, +36,468 bytes
        versus main `bf77aabe` on the same rig (without the macOS helper).
  - [ ] Universal VSIX within its 2200 KiB budget (hosted CI package job).

## M41 — Install Muse Code from the panel (folded into M55)

**Status 2026-09-25: folded into M55 (D36); built there (PR #43, merged
2026-09-27).** The owner
asked whether the install could be automated rather than linking to Meta's
site. Meta publishes one-line installers (`irm https://dev.meta.ai/install.ps1
| iex` on Windows, `curl -fsSL https://dev.meta.ai/install.sh | sh`
elsewhere; to be re-read before building). The proposal: the sign-in page's
"Install Muse Code" asks first, in a modal that shows the exact command,
then runs it in a visible VS Code terminal and watches the install folder
the extension already probes, moving on to sign-in when `muse` appears.
The CLI itself is not bundled: it is Meta's closed-source binary.

## M57 — The Model API backend out of the activation bundle (D6)

**Status 2026-09-27: built.**

Status detail retained: built on `feature/m57-bundle-split` from main
`2f4f669` (0.9.0); local `npm run quality` recorded in
`docs/certification/m57.md`. Not pushed; no pull request yet.

- **Goal**: `dist/extension.js` was 596.8 KiB of its 600 KiB budget, 180.7
  KiB of it the Model API backend, which only a conversation on that backend
  uses. Load the backend when it first starts instead, without raising the
  budget or changing what the backend does.
- **Scope**: the entry `src/host/backend/modelApiEntry.ts` built to
  `dist/modelApi.js` (production, dev and watch builds); the interface module
  `modelApiBundle.ts` (types only from the backend's folder); the manager
  requiring the bundle by the path activate passes, the load failure in the
  user's language (`modelApiBundleUnavailable`, fifteen tables) with the file
  and cause in the log; the MCP pool and the hooks loader built inside the
  bundle; `confineWorkspacePath` and `resolveWorkspacePath` to
  `src/core/workspacePath.ts`, `isProtectedPath` to
  `src/core/protectedPaths.ts`, the goal record to `modelapi/goalRecord.ts`;
  the identity audit's fixes (the `is…` error guards and a lint rule against
  `instanceof` on those classes, the table and locale handed to the bundle);
  the gates (`check-bundle-split.mjs`, the budget, host globals, notices,
  knip's entry, dpdm's entry, `.vscodeignore`, CI's `.vsix` check); the live
  sweep loading the built bundle; D6's amendment.
- **Acceptance**: `dist/extension.js` 425.3 KiB and `dist/modelApi.js` 295.6
  KiB, both under budget; of the backend's 28 files only the eight on the
  allowed list are in the activation bundle, the 20 lazy ones are all in
  `modelApi.js`; the manager requires a real built bundle and completes a
  turn against the fake Model API; a missing or damaged file rejects
  `ensureHost()` in the user's language, is logged with its path, and a
  retry after the file appears works; a German table reaches a sentence the
  bundle's host writes, number grouping included; a goal refusal thrown by
  the bundle is not `instanceof` the activation bundle's class, and the
  controller, over a host from the built bundle, still says a refused
  `/goal pause` as the warning in the user's words (with `instanceof` it was
  an error); the `.vsix` lists `dist/modelApi.js`; an integration test loads
  the dev build's `dist/modelApi.js` inside VS Code's extension host and
  runs a turn.
- **Gates**: the §7 rows (bundle split, budget, host globals, notices,
  cycles) and every test fired on a deliberate break
  (`docs/certification/m57.md`).
- **Left**: the extension's own manager path (activate's
  `ModelApiBackendManager`) runs only for a conversation on the Model API
  backend, which the integration harness cannot start (a key in the
  extension's SecretStorage and a message from its panel); its integration
  test builds a manager of its own over the same path. The live sweep now
  loads `dist/modelApi.js` and was not run for this milestone (no live calls).

## M60 — The host API inventory and the `vscode` boundary (D60, phase A)

**Status 2026-09-26: built.**

Status detail retained: built and certified (`docs/certification/m60.md`).

- **Goal**: know exactly what the extension asks of its host, so each
  editor in D60's matrix can be checked against it (Theia's API
  comparator, a fork's VS Code version, a browser engine), and keep that
  knowledge true as the code changes.
- **Scope**: `scripts/check-host-api.mjs` (`npm run check:host-api`, in
  `quality:gates`; `--write` regenerates the record): with TypeScript's
  checker, every VS Code API the host uses at run time (functions,
  variables, classes, enums, members of VS Code objects) and the files
  that use it; the files that import `vscode`; the Node built-ins the host
  imports; the webview's host calls (`acquireVsCodeApi`) and the
  `--vscode-*` theme variables it reads; the manifest's facts (engines,
  `extensionKind`, entry points, capabilities, activation events,
  contribution points). The record is `docs/ide-compatibility/host-api.md`,
  formatted as Prettier would; the gate fails when it differs from the
  source. Whatever the record says, the portable code never reaches
  `vscode` through its imports, type-only ones included: everything under
  `src/core`, `src/shared` and `src/webview`, and the host modules the
  script lists (the conversation controller, both backend managers, the
  tool harness, the credential and session stores, the `ide` server). A
  VS Code object handed to portable code by shape (the log channel,
  `SecretStorage`) is still recorded, member by member, where it is handed
  over.
- **Acceptance**: a red drill for each failure; the gate green; the record
  read through.
- **Not here**: installing another editor (M62, Q62).

## M61 — Shared boundaries (D60, phase B)

**Status 2026-09-26: the first two steps built** (`docs/certification/m60.md`
records them with M60); the rest waits for M56 to merge. M56 merged
(PR #44) and was joined into this branch on 2026-09-27; steps 3, 4 and 6
are no longer blocked by it.

- **Goal**: the engine and the React UI can be driven by a host other than
  VS Code, while VS Code behaves exactly as before.
- **Scope, in order**:
  1. The webview's host bridge (`src/webview/hostBridge.ts`): posting to
     the host, the saved state and the host's messages go through one
     interface, and `main.tsx` no longer calls `acquireVsCodeApi` itself.
     **Built.**
  2. `ChatSurface` and `ConversationMessage` in a module with no `vscode`
     type (`src/host/views/chatSurface.ts`), the logger taking its channel
     by shape and `DictationSetup` in the core, so the conversation
     controller, both backend managers and the other modules the M60 gate
     lists are portable. **Built.**
  3. Theme tokens: the stylesheet reads `--muse-*` tokens mapped once from
     VS Code's variables (M60's record lists the 57), so another host maps
     its own; the harness screenshots identical before and after. After
     M56.
  4. The editor-services contract (D60's list), taken by the controller
     and the Model API tool harness, with VS Code's implementation. After
     M56.
  5. A standalone Node runtime entry that drives `AgentHost` without
     `vscode`, tested against the fake CLI and the protocol captures.
     **Built with M63a** (`src/runtime/`, on the M60 gate's portable
     list), driven over stdio against the fake CLI.
  6. Capability detection: what a host offers, and what the UI hides or
     explains when it does not.
- **Acceptance**: every gate and the integration tests unchanged; each
  moved module on the M60 gate's portable list.

## M62 — The VS Code family (D60, phases A and C)

**Status 2026-09-26: M62a built and certified**
(`docs/certification/m62.md`); the other forks and the first Open VSX
listing are M62b.

- **Goal**: every editor built on VS Code installs and runs the extension
  as it is, from a `.vsix` or Open VSX, as far back as the code allows.
- **M62a, the floor**: `engines.vscode` from `^1.125.0` to `^1.99.0`, on an
  audit and real-host tests, as the owner's plan asks
  (`docs/ide-compatibility.md` §3.1).
  - The VS Code API: the host, unit and integration projects typechecked
    against every published `@types/vscode` from 1.85 to 1.120. The host
    needs nothing newer than 1.85; the unit tests' panel fake needed 1.96
    (`IconPath`) and 1.108 (its shape) and is now typed from the interface.
  - Node: VS Code's own pins (`remote/.npmrc`, the Electron target) give
    Node 20.18.3 for 1.99, 20.19.0 for 1.100 and 22.15.1 from 1.101.
    Compiled against `@types/node` 20.19 and the ES2023 library, the host
    used one newer API, `Promise.withResolvers`, now replaced. The host
    project's library is ES2023 and its bundles target `node20.18`; the
    ACP agent keeps `node22`, run by the user's own Node.
  - Why 1.99: the first release on Node 20.18 and Chromium 132 (Electron
    34). Older releases run Node 20.9 to 20.16 and Chromium 122 to 130,
    which neither the host nor the webview (`chrome128`) was checked
    against; going lower waits for a named editor that needs it.
  - Muse Voice needs a global `WebSocket`, which Node 20 lacks; on 1.99
    and 1.100 it says so (M35's check) and dictation's other routes stay.
  - Tested: VSCodium 1.99.3 and 1.135 run the integration tests (9 each);
    code-server 4.99.4 (VS Code 1.99.3, Node 20.18.3) installs the VSIX,
    activates it and runs a conversation and an approval against the fake
    CLI in the browser, and refuses the same VSIX with the 1.125 floor.
    CI's `minimum` integration run now downloads 1.99.0.
  - **After M48–M56 joined (2026-09-27)** (`docs/certification/m62.md`,
    "The floor after M48–M56"): the host still typechecks at 1.99's
    `@types/vscode` and at `@types/node` 20.19 with ES2023, once M55's two
    `Promise.withResolvers` in the device sign-in became a plain promise;
    the host API record was regenerated (198 APIs, as before; 13 files
    import `vscode`). M56 relied on VS Code routing an extension's `fetch`
    and `WebSocket`: `fetch` is routed at every version from the floor,
    `WebSocket` only from 1.112.0, so on 1.101 to 1.111 Muse Voice's socket
    goes out without VS Code's proxy and certificate handling. Diagnostics
    now says per global whether the editor routes it, and the README says
    so. The ACP agent's backends took M48–M56's new inputs: Muse Code's
    default network sandbox, the in-memory prompt cache, M49's memory tools
    in a trusted folder, no subagents (paid, and the agent has no flag for
    them), and the shell job's C# shipped in its package.
- **M62b, the forks**: Cursor, Windsurf, Kiro, Positron, Theia (from npm),
  Firebase Studio, Che and Codespaces, each installed where it can be and
  its version recorded in `docs/ide-compatibility/hosts.md`; the Open VSX
  listing after the next tag.
  - **Theia 1.75, 2026-09-26** (`docs/certification/m62.md`): built from
    npm as a browser app; it claims VS Code API 1.134, so the floor is no
    obstacle. The panel in a tab and the sidebar run a conversation and an
    approval against the fake CLI. Found: Theia never fires `onView:` for a
    webview view (it fires only for a view with no child widget, and a
    webview view gets its widget at once), so the sidebar opened first
    stays blank until a command or the tab starts the extension. Not
    worked around with `onStartupFinished`, which would start the
    extension, and read SecretStorage, in every VS Code window; README's
    Troubleshooting gives the shortcut. The fix belongs in Theia.
  - **Forks in CI, 2026-09-26** (`.github/workflows/forks.yml`,
    `docs/certification/m62.md`): Cursor, Devin Desktop (Windsurf's new
    name), Kiro and Positron at their latest Linux builds, found through
    their own update feeds as nixpkgs and Homebrew find them; the VSIX
    installed with each fork's CLI and the integration tests run in it,
    weekly and by hand. Their feeds are refused in the container; the
    first run on GitHub's runners passed in all four: Cursor 3.22.7 (VS
    Code 1.128), Devin Desktop 3.10.35 (1.126), Kiro 1.1.70 (1.131) and
    Positron 2026.09.1 (1.130), 9 integration tests each.
- **Acceptance (M62a)**: every gate green with the floor's types; the
  integration tests on a 1.99 host; drills for the API and Node checks.

## M63 — The ACP agent (D62, phase D)

**Status 2026-09-28: M63a built and certified**
(`docs/certification/m63.md`); M63b run in Emacs, Neovim, Zed and
JupyterLab, and in CI (below); M63c's MCP servers and paid features built,
joined with M57, M58 and PR #49's sign-in
(`docs/certification/pr32-integration.md`).

- **Goal**: Muse Spark in every editor that hosts agents over ACP, on
  both backends, with the panel's approvals and none of its bills
  unannounced.
- **M63a, the agent**: `src/acp` (the translation of D62) and
  `src/runtime` (the process: arguments, the stderr log, the two backend
  managers, the OS key store of D61, the data folder for Model API
  sessions); `muse-spark-code-acp` with `auth set|status|clear` and
  `login`; the esbuild entry `dist/acp.js` and its budget; the npm package
  and its tarball on each GitHub Release; tests against the SDK's client
  in-process and over stdio to the built agent with the fake Muse Code
  CLI; README configuration for each client; drills.
- **M63b, the clients**: each ACP client installed and driven where it
  can be (Neovim with CodeCompanion, Emacs with agent-shell, Zed,
  a JetBrains IDE, Qt Creator, Xcode 27, Sublime, Devin Desktop), its
  version and results recorded in `docs/ide-compatibility/hosts.md`.
  - **Emacs, 2026-09-26** (`docs/certification/m63.md`): Emacs 29.3 from
    Ubuntu, acp.el 0.15.2, shell-maker 0.97.3 and agent-shell 0.79.2
    fetched file by file (GitHub's archives are refused here). acp.el
    alone, and agent-shell in batch, ran the agent against the fake CLI:
    the modes, the model and effort, a streamed reply, a tool call allowed
    (`y`) and one rejected (`C-c C-c`, which cancels the turn, so the
    permission answer is `cancelled` and the call is rejected). The
    agent-shell configuration is in `docs/acp.md`.
  - **Neovim, 2026-09-26**: Neovim 0.11.4 (its GitHub release),
    plenary.nvim and CodeCompanion v19.25.0 (cloned; the tag was ten days
    old), headless: a streamed reply, then CodeCompanion's approval prompt
    (Accept `g2`, Reject `g3`, Cancel `g4`) pressed in the chat buffer:
    accepted, the command ran; rejected, it was skipped. The adapter is in
    `docs/acp.md`.
  - **Zed, 2026-09-26**: Zed 1.20.2 from its GitHub release (zed.dev is
    refused here), run as an unprivileged user on Xvfb with Mesa's
    software Vulkan and driven with xdotool. Muse Spark appeared under
    External Agents; its thread showed the model and effort selectors,
    streamed the reply, and ran or skipped a command from Zed's permission
    card (Allow once, Reject). Zed now needs `"type": "custom"` in
    `agent_servers`, which `docs/acp.md` lacked; fixed.
  - **JupyterLab, 2026-09-26**: Jupyter AI 3.2.0 ships an ACP client
    (`jupyter-ai-acp-client` 0.3.0) that runs agents as chat personas, so
    JupyterLab 4 is reached through the agent now rather than waiting for
    M65's native extension. With JupyterLab 4.6.3 (4.6.4 was five days
    old) and a local persona file, the chat showed the agent's model, mode
    and effort pickers and its context gauge, and allowed and rejected a
    command from Allow once / Reject buttons. Found: Jupyter AI passes its
    notebook tools as MCP servers (HTTP ones only to an agent advertising
    `mcpCapabilities.http`) and prepends a note telling the model to use
    them; the agent passes no MCP servers on yet, so M63c's MCP item
    matters here first.
  - **In CI, 2026-09-26** (`.github/workflows/hosts.yml`, `test/hosts/`,
    `docs/certification/m63.md`): JupyterLab, Emacs (acp.el v0.15.1 and
    agent-shell v0.77.4, the newest tags seven days old) and Neovim run
    the packaged agent against the fake CLI on each pull request, with
    VSCodium, code-server and Theia for the extension, and the agent's
    package and key store on all three platforms. Zed stays manual.
- **M63c, the rest of the protocol**: file reads and writes through the
  client (`fs/*`) for the Model API backend; paid features with a
  confirmation that names the price; `session/close` and `delete`; the ACP
  Registry once Q65 is answered; the editor's MCP servers.
  - **MCP servers, 2026-09-26** (`docs/certification/m63.md`): the engine's
    per-session servers gain a stdio kind beside HTTP (MSP takes both), and
    the agent passes the editor's stdio and HTTP servers to Muse Code on
    `session/new`, `load` and `resume` when the host granted `sessionMcp`,
    each optional; it advertises `mcpCapabilities.http` on that backend.
    SSE and the unstable ACP transport are left out, the Model API backend
    runs none, and only server names are logged (headers and environments
    can hold secrets). JupyterLab's notebook tools now reach the agent.
  - **Paid features, 2026-09-26** (`docs/certification/m63.md`): web
    search and image generation behind `--web-search` and
    `--image-generation` on the Model API backend, each confirmed in the
    editor at the first prompt with its price (`src/acp/paid.ts`); a
    cancel while the price is asked ends the prompt without a turn.
    File access through the client (`fs/*`) waits for M46–M56, since it
    needs the session threaded through the Model API backend's tools.
  - **Joined with main's M57 and M58, 2026-09-27**
    (`docs/certification/pr32-integration.md`): the agent loads the
    Model API backend from the extension's own `dist/modelApi.js`, which its
    package ships (D6 amendment), and each paid use asks in the editor with
    Allow once, Allow always in this workspace (with `--trust-workspace`,
    kept in the agent's data folder) or Deny, replacing the first prompt's
    price question (D62 amendment).
- **Acceptance (M63a)**: a session created, prompted, streamed, cancelled,
  asked for permission (allowed, denied, cancelled), loaded and listed
  over stdio on the Muse Code backend (fake CLI), and on the Model API
  backend (fake server) in process through the same runtime backend,
  because the process reads the key only from the OS store; `auth set`,
  `status` and `clear` against a real Secret Service; `auth_required`
  before sign-in; the key never in a frame, an argument, the environment
  or the log; every gate green.

## ENVFENCE — Shell credential fence (D89.5, security fix for 0.14.1)

**Status 2026-10-05: built.** Status evidence: `docs/certification/envfence.md`.

- [x] Shared credential matcher and fences at model process entry.
- [x] Machine-scoped interactive name-only exception, with 14 translations.
- [x] Spawn environment snapshots and real-shell fake-credential probe;
      deliberately remove guards, observe failures and restore byte-exact.
- [x] Focused rig tests, typecheck/lint/format, localization, host API,
      deadcode/duplication and production bundle budgets.
- [x] Certification: `docs/certification/envfence.md`; hooks-on local commit.
      The lead runs aggregate quality on the rigs (lane common rules).
- [x] FIXENVFENCE: repair both RVENVFENCE P1s with regression tests and red
      drills (25 matcher failures, 2 delayed-origin failures), followed by
      byte-exact restoration. Focused certification is appended to
      `docs/certification/envfence.md`; aggregate quality remains the lead's gate.

## TRAIN15F — Close the 0.15.0 train holds (2026-10-06, win11)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

Merge main 2aa9cbff7 additively, retain immutable feature-off request goldens,
correct the D78 assertion to their contract, and make exec locale fixtures explicit.
Audit generated Help reference coverage for all train features. Measure helperless
and verified-helper universal VSIX entries, excluding only unnecessary payload.
Keep the approved 2475-KiB cap and every individual bundle cap. Reuse the shared
browser ESM graph for Help, preserving lazy loading and installed language.
Run the 132 complete owning files under default repository timeouts, static/build
gates and actual VSIX/ACP packaging; record any remaining cap excess for the lead.
No release bump, README What's New edits, push, rebase, credentials or model calls.

TRAIN15F reference size recovery: the additive reference is 115.3 KiB against
its unchanged 100-KiB cap. Encode its generated dictionary payload losslessly
with the already pinned lz-string codec; expand then validate its original
model with zod. Source JSON and Markdown remain complete. No cap changes.

TRAIN15F universal measurement uses the certified 0.13.0 helper bytes. Windows
filesystem modes cannot preserve its execute bit, so the ZIP repacker records
0755 for the known macOS helper even on Windows. Verify unchanged decoded bytes
and executable ZIP metadata in the existing packaging test; no other file mode
or package cap changes. Audit .vscodeignore for unnecessary allowlisted files.

TRAIN15F default-timeout repair: the full packaging file exposes five 5-second
failures. Prepare the real maximum-compression VSCE and reversed-order archives
once in shared setup. Encode deliberately corrupt archives at fast Brotli quality:
the decoder's bytes, digest and expansion checks remain identical. Keep all test
assertions and per-test default deadlines; name only the real archive setup limit.

TRAIN15F VSIX inventory: the first post-main helperless archive is 2,601,457
bytes and universal is 2,681,005, over 2,534,400 by 67,057 and 146,605. Exclude
models-dev/VENDOR.json: build provenance, no runtime reader or README link;
retain its required LICENSE and runtime catalog. Explicitly exclude optional
fonts and source maps even under the bundled workflow allowlist. The workflow
package's pinned manifest validates every listed file, so its docs/templates
are required payload, not removable development files. Keep walkthrough media
and local docs referenced by the manifest or README. Record the actual final
excess for the lead; no cap increase or further runtime packaging refactor.

The font drill also proves VSCE unions allowlist negations: a positive ignore
cannot override the existing whole-vendor allowlist. Filter optional font/map
extensions in that allowlist itself with minimatch's negative extglob. Repeat
the font drill with the whole-vendor allowlist restored, then verify green.

TRAIN15F installed UI-text checker: main's checker still enumerates plaintext
translation tables, while the train packages the validated solid UI archive.
Read each of the same fourteen locales through readArchivedUiTable with the
existing decoded-byte bound, retaining plaintext compatibility and exact help
comparison. Run the checker against the actual ACP stage; no new wire shape.

TRAIN15F ACP help lists /compact and the available local legal/usage handlers
alongside installed skills. Deduplicate names, preserving one /help entry and
its no-model-call behavior. The static linked panel reference remains separate.

TRAIN15F default-timeout journal stress check writes 10,000 real records in two
child processes, then checks every ordered value and line. It exceeds five
seconds on Windows. Keep that workload intact and give only this real filesystem
stress operation a named 30-second per-test deadline, with its reason beside it.

TRAIN15F ChatGPT package fixture must carry main's required reference bundle.
Prepare its real cold archive once in beforeAll with a named archive setup
deadline; keep assertions at the repository's default and keep the missing
provider rejection as a separate complete test. No production gate is bypassed.

TRAIN15F exec fixture's post-main localization failure is a missing source
dependency: loadL10n now imports runtime/cliOptions.ts for canonical help, but
the isolated packaging fixtures copied only shared and What's New sources.
Copy that exact source into exec, ChatGPT and usage localization fixtures;
retain the real gate and the now-integrated manifest entries without duplication.
This is separate from the old German inventory assertion and not ambient locale.

TRAIN15F usage package fixtures likewise include the required reference bundle.
Run each existing rejection case as its own parameterized test so four child
processes no longer share one five-second deadline. Prepare the successful real
tarball in named cold-archive setup, retaining every membership assertion.

TRAIN15F merged regression fixtures isolate the unrelated image price by
explicitly disabling M97's now-default-on legal explanation. The Unicode
fallback test compiles the generated ESM with its real codec before running it
as CommonJS, matching the production build instead of stripping only an export.

TRAIN15F final exec run proves the locale fix and all admission guards; one
combined production/private package test takes 32.3 seconds against its existing
30-second deadline. Prepare the real production archive once in named cold
beforeAll setup and clone its complete immutable fixture per package guard.
Each guard still runs its actual rejection command on an independent copy;
the private tar's digest/membership assertions remain. Do not raise deadlines.

TRAIN15F usage localization's restored source now exposes two timeout defects:
three full gate processes in one exception test, and default-quality Brotli
compression of fourteen complete tables. Parameterize each exception and staged
table case, preserving assertions, and use fast fixture-only Brotli encoding;
the gate still checks the same decoded bytes and ordinary five-second deadline.

## TRAIN15G — Shared webview payload and final train package budget (2026-10-06, win11)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

Merge sync/main-0150 (61d8647c2) with --no-ff, preserving every train feature
and the startup/deferred diet. Regenerate Help reference from merged sources.
Audit the combined browser graph for one emitted React/shared UI owner across
chat, Models and Usage; defer the optional panel bodies with DeferredSurface
and independent measured +15%, rounded-up-to-25-KiB closure budgets. Keep
shared chunk access in every editor CSP and authenticated ACP companion UI,
including dynamic imports. Normalize Windows metafile paths before traversal.
Measure actual helperless and certified-helper universal VSIX before/after.
Only if universal still exceeds 2,534,400 bytes, the lead authorizes the
compressed cap to measured universal +5%, rounded up to 25 KiB. No other cap
increase. Run complete owning files under default test timeouts, goldens,
static/build/reference gates, VSIX/ACP packaging and affected accessibility
pages. No version bump or README What’s New changes; no paid/live calls.

## TRAIN15H — Restore the inherited startup ratchet (2026-10-06, win11)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

- [x] Compare emitted startup input bytes against main `61d8647c2` and train
      `fe3c3fe16`; retain the complete module measurement with milestone owners.
- [x] Defer LegalReport and the review comment form through `deferred()`,
      preserving dismissal, focus and fresh arrivals. Harness actions use
      `whenFound` for the newly lazy form and workflow-map controls; readiness
      also requires the map's loaded tree. The first full scan's isolated
      workflow readiness failure is retained, followed by a full rerun.
- [x] Keep only first-paint English values in startup, with a complete
      canonical structure/slot contract for all installed languages. Load optional
      English before each lazy surface; preserve installed language state. Keep
      canonical keyboard matching with optional contexts beside their surfaces.
- [x] Register independent 25-KiB budgets from measured closures plus 15%,
      rounded up to 25 KiB. Keep the 900/50-KiB caps and 733.8/32.1-KiB ratchets.
- [x] Certify complete owning suites, deliberate failures and byte-exact
      restoration, full accessibility, static gates and actual VSIX measurements
      in `docs/certification/train-0.15.0.md` and its TRAIN15H receipt.

## MACSLOW — Hosted macOS memory and slow setup (2026-10-07)

**Status 2026-10-07: built.** Certification: `docs/certification/macslow.md`.

Authority: `/Users/randy/lanes/_ctx/MACSLOW.rig.md` and shared
`_ctx/codex/common.md`, on `fix/0150-macslow` from `ccce6e6ac`.
Own only unit compiler memory, companion browser lifecycle/readiness, usage
localization fixtures and exec stdio cold build/package setup. Measure unit
compiler peak RSS before and after; split the checking work structurally while
retaining every configured file and strict option. Prepare immutable expensive
fixtures once per file, keep isolated mutable cases, and pair browser event
observation with its trigger so cleanup cannot strand a rejection.

- [ ] Measure and repair each owned cause without timeout changes, retries or skips.
- [ ] Prove compiler coverage and changed fixture/security checks fail on deliberate
      regressions, restoring every mutation byte-exact.
- [ ] Run three clean `CI=true` complete-file passes at default test deadlines
      with at most three workers, plus measured compiler and scoped static/build gates.
- [ ] Commit finished pieces with hooks and explicit paths; never merge or push.

The brief expressly authorizes `git clean -xdf -e node_modules`, overriding
common.md's clean prohibition. Aggregate quality remains lead-owned under
common.md; this lane runs the listed gates directly on macmini. No live/paid
calls, credentials, new dependencies, increased budgets or timeout changes.
Receipts belong in `docs/certification/macslow.md`.

## CI0150L — Linux hosted CI round 3 (2026-10-07)

**Status 2026-10-07: built.** Certification: `docs/certification/train-0.15.0.md`.

Scope: the Linux rig brief and CI0150-os-common: private clean-shard ACP
packaging artifacts, checked-in pre-K activation sources, package badge/image
isolation, installed archived translations, Semgrep findings and fake-only
Action W/low-budget failures. Preserve every budget, assertion, timeout and
security boundary. No live/paid model calls, push, rebase or merge.

The fresh jobs expose two further causes. The hosted release PR's review diff
is 29,912,292 bytes, exceeding the generic child-output bound before the
promised 262,144-byte review prefix can be selected. Add a dedicated read-only
Git-diff prefix sink that drains/counts the complete stream under the same
phase/child deadlines while retaining at most the existing review byte cap;
ordinary child output, published patch, stderr and cancellation gates stay
unchanged. Certify a real diff larger than the generic cap and its UTF-8 cut,
then run W and low-budget against the actual installed production runtime.
Latest VS Code also resolves showTextDocument before its observable active
editor snapshot settles. Make the integration test await that same editor
condition through its existing bounded UI readiness helper, keeping its
original assertion and deadline.

- [ ] Reproduce each owned failure and fix its cause; prove changed checks fire.
- [ ] Commit finished pieces with hooks and explicit paths.
- [ ] Run Linux pull-request jobs from fresh clones of committed work with
      Node 22, CI=true, original shard/coverage and package steps; record exact
      passes, failures and unavailable hosted dependencies in the Linux round 3
      section of docs/certification/train-0.15.0.md.

Static duplication shares the inert text encoder with the lazy code-fence
renderer as well as exported chats and the companion page; the zero-clone
threshold is retained.

The first full rerun exposes the private ChatGPT fixture's combined build and
pack crossing its unchanged 60-second cold archive bound. Native export
certification's baseline and packaged observations are independent isolated
workers; start that pair together, retain every export/call comparison, and
measure the cold fixture again. No timer, retry or assertion is changed.

The concurrent rerun also exposes E5's unread-output fixture generating
104,858 five-character SSE deltas before its large-write marker. This case
tests a blocked output pipe, not fragmentation throughput. Add a test-only
single-text-delta reply option and use it only for the existing 512 KiB
blocked reply; keep its marker, unread stdout, signal, 5.4-second exit
assertion and 30-second test deadline unchanged.

The isolated three-core shard still measures 62.3 seconds for the combined
cold ChatGPT setup. Its packer serializes three independent, bounded Brotli
archives (tables, code and usage). Compress those concurrently with Node's
bounded zlib worker pool, preserving quality 11, decoded caps, canonical
ordering and exact compressed bytes. Certify byte equivalence with the
original synchronous compressor and deliberately change its quality to prove
the new comparison fails.

The complete shard 3 exposes the usage journal's warm-cache benchmark doing
its 60,000-record fixture construction and cold scan inside the five-second
warm test. Prepare and assert that cold snapshot once in the default-bounded
setup; keep the five-second test, 300 ms warm bound, full record count and
no-reread assertions. Clean failed setup roots at file teardown too.

The complete Linux aggregate passes 988 WCAG pages, then legal accessibility
refuses Playwright's bare `google-chrome` executable path. Resolve installed
browser candidates and explicit overrides to existing absolute paths through
the shared finder, keeping overrides authoritative and refusing missing
installs. Remove the test harness's duplicate PATH resolver. Certify PATH
selection and override refusals, the real legal keyboard/zoom/WCAG gate, then
repeat the complete committed Linux job set. No browser or job timer changes.

The four-CPU WCAG job has a structural floor: 988 pages each sleep five
seconds, in six lanes, consuming nearly fourteen minutes before axe and the
legal gate under a fifteen-minute job cap. Replace that blanket sleep with
tracked fake-host/scenario callbacks and the existing bounded readiness
condition. Preserve every scheduled event delay, streaming pump yield, font
and animation wait, two paint frames, error capture, focus rule and per-page
deadline. Readiness's own deadline/poll/frame timers stay untracked. Prove
nested callbacks, callback failure cleanup and readiness blocking/deadlines
with counterfactuals; rerun the complete job set from the committed repair.

The Linux aggregate's local SAST launcher then refuses duplicated `--jobs`
arguments: the inherited two-worker option and a later serial option both
reach Semgrep 1.178.0. Keep one named serial worker limit, as the existing
large-taint-analysis rationale requires; do not change rules, excludes,
severity or scan deadlines. Certify the actual local launcher against the
pinned scanner as well as CI's direct command.

The next full shard's cold package still crosses 60 seconds under concurrent
job load. Profile its unchanged production build, compression, fifteen
language-help processes and isolated native-loader checks. Remove remaining
serialized independent work or repeated setup while retaining every language,
export/call comparison and the existing cold setup deadline; then rerun the
complete Linux job set. The interrupted wave is not a passing receipt.
The measured post-archive validation through staged Help takes 13.2 seconds
of a 41.8-second cold fixture, including localization and badge gates. Run
Help's independent commands in bounded batches of three,
settling each batch before reporting a failure. Keep all fifteen language
checks, each original command/environment/output bound and every package
assertion. Final fresh-clone jobs run one at a time, as hosted jobs receive
independent machines; no test launch delay or product priority change.

The serial aggregate passes 16,622 tests and coverage, then the completed
long-stream harness scene exceeds its existing ten-second readiness bound in
two high-contrast themes. Its repeated zero-delay timers incur the browser's
nested-timer clamp. Use one MessageChannel task queue for that scene's
continuations, preserving every 100-character delta and an event-loop yield;
track each continuation, close both ports on completion/error, and retain all
readiness/paint/deadline checks. Certify complete chunk order and failure
cleanup, then repeat the complete fresh-clone job set without retries or skips.

## CI0150A — Clean-shard artifacts and portable certification (2026-10-07)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.

Scope: six owning suites in the CI0150A brief. Clean hosted shards have no
`dist/`; tests must own their required source-derived artifacts and avoid
rig-only Git objects. No production budget, timeout, retry, skip or assertion
is relaxed. No live or paid calls, push, rebase or merge.

- [x] Reproduce clean `CI=true` failures for configured providers, headless BYO,
      deferred bundles, VSIX packaging/compression and worker certification.
- [x] Use the pinned provider snapshot and private production-plugin bundles;
      isolate scanner/gate drills and compression inputs from shared `dist/`.
- [x] Remove repeated expensive packaging setup and bind historical worker
      receipts to checked-in certified bytes, preserving their original hashes.
- [x] Run each complete owning file three times after
      `git clean -xdf -e node_modules`, with default Vitest test timeouts;
      run five typechecks, lint, changed-file formatting, plain knip and duplication.
- [x] Deliberately regress one fixed behavior, observe failure, restore exact
      bytes; record results in `docs/certification/ci0150-a.md` and commit with hooks.

## FIXM116P4 — Final outcome verification repairs (2026-10-06)

**Status 2026-10-07: built.** Implementation/integration receipts remain below; this is not full certification.
**MACSLOW bounded certification (2026-10-07, macmini).** The lane's shared
rules prohibit aggregate quality and delegate it to the lead. Run complete
owned files directly, at default timeouts, three times after the explicitly
authorized clean; run each requested compiler/static/build gate separately.
The unit gate retains all 1,864 configured roots and strict options across five
sequential programs, sharing ambient declarations and matcher setup. Measured
peak RSS falls from 2,767,564,800 to 1,688,055,808 bytes (39%); no heap override,
timeout, retry, skip or other gate changes. Initial compiler probes exposed
ambient-type resolution and cross-file matcher/declaration scope; preserve
both through repository-local temporary configs and the shared support roots.
Final evidence is recorded in `docs/certification/macslow.md`.

**CI0150M round 3 aggregate status (2026-10-07).** The attempted unmodified
`npm run quality` passes static gates, then fails whole-repository tests in
unowned clean-artifact/localization suites and load-sensitive cases. The common
OS brief assigns cross-platform failures to the Linux lane. Certify this lane
with every exact macOS workflow command in fresh committed clones; record all
remaining failures rather than weaken gates or edit another lane's suites.
Aggregate release quality remains deferred to joined integration. Standalone
secret scanning passes; the inherited SAST wrapper supplies duplicate `--jobs`
options and is a shared failure, also deferred without changing its invocation.
See this lane's round 3 section in `docs/certification/train-0.15.0.md`.

The final lane follows the lead's native-Git contract: delete all Husky
startup/layout/body emulation. Only `git hook run` in the verification
worktree, with the source repository's resolved absolute hooksPath and
HUSKY/HUSKY_SKIP_HOOKS/GIT_* variables deleted, supplies the hook verdict.
Git's missing-hook error fails closed for a configured hook set. Native
Husky v9 passing/failing layouts receive real Git regressions and red drills.
Invalidate pre-repair receipts with a new hook-digest epoch.

Enumerate every worktree and snapshot its HEAD and private refs/worktree,
refs/bisect and refs/rewritten alongside shared refs. New and moved private
refs require receipts even when the worktree HEAD stays unchanged.

Contain detached descendants through parent-chain enumeration and start-time
identity checks in the existing process-tree module; the synchronous policy
needs a bounded supervisor because spawnSync cannot enumerate while blocked.
The process-tree module is the necessary shared-file extension of lane P's
scope. Prefer a prepared Linux cgroup/scope runner when the harness provides
one. Record the M107 governed-tree binding as an I/W integration handoff.
No dependency, hook rewrite, gate weakening, paid call or branch merge.
**CI0150L rolling verification.** The round-3 rig brief explicitly requires
committing finished pieces after owning tests pass, then verifying committed
work in fresh clones. Full quality and Linux CI jobs remain pending until that
fresh-clone run and are not claimed green by an intermediate commit. Record
any external hosted dependency that cannot run on this rig in the Linux round-3
certification section; no threshold, ignore, timeout or assertion changes.

**FIX0150R scoped certification.** The rig brief requires complete owning test
files in batches of at most three, with three clean `CI=true` repetitions and
individual static/build gates. Shared lane rules reserve aggregate
`npm run quality` for the lead; its whole-repository coverage invocation exceeds
this lane's test-file limit. Defer that aggregate to release integration without
changing any threshold or gate. Receipts are in `docs/certification/fix0150r.md`.

**FIX0150P scoped release-review verification (2026-10-07, linuxlt).**
The rig/common briefs prohibit a full quality run in this lane. Full quality
and cross-platform release certification remain with the lead; this lane
runs the prescribed complete owning suites and scoped static/build gates
without weakening thresholds, timeouts, isolation or hooks. Detailed red/base
and restored-green receipts belong in `docs/certification/fix0150p.md`.

**CI0150A scoped certification.** CI0150-common.md requires three clean
repetitions of complete owning files and individual static gates; the rig note
caps each test run at three files. Aggregate `npm run quality` includes an
unbounded whole-repository test/coverage run, so it is deferred to integration
under this scoped repair. Hosted OS/release checks also include CI0150B/C work
and are not certified here. This justified deferral changes no gate or threshold.

**CI0150C scoped repair certification (2026-10-07, macmini).** The rig brief
requires clean `CI=true` verification in batches of at most three test files,
three times at repository default deadlines, plus all five typechecks, lint,
changed-file formatting, plain knip and duplication. The aggregate
`npm run quality` is deferred to the joined release repair: its all-file Vitest
invocation exceeds this lane's explicit three-file limit, and the other lanes
own the remaining hosted failures. This is a scoped certification record, not
a full-release quality claim; no threshold, rule, assertion or CI gate is
disabled. The badge gate still performs real public network checks in CI.
The extra `security:audit` run reports the pre-existing, now-unreported
`GHSA-68fv-2mgg-jv7q` (`source-map-js`) exception in
`.github/audit-exceptions.json`; that unowned cleanup is deferred to the lead,
without changing an exception or suppressing the audit failure in this lane.

**CI0150B scoped verification (2026-10-07).** This lane owns the ten slow suites
in its brief. The shared CI0150 rules require three clean-tree whole-file runs,
all compiler projects, lint, formatting, plain knip and duplication. Full
`npm run quality` certification is deferred to the integrated CI repair: the
other lanes own clean-checkout artifact failures in configured-provider,
headless/package and other suites, and this lane must not edit their files.
No threshold, assertion, retry or global timeout is relaxed. This branch's
receipts certify only its named suites and checks, not a complete release gate.

**TRAIN15H scoped certification.** The lead's rig brief and shared common.md
reserve aggregate quality for the lead. This lane runs complete owning files
under default deadlines and individual gates, including every accessibility
page. No baseline increase, new feature, command, setting or escape hatch.

**TRAIN15G inherited DIET1 measurement hold (resolved by TRAIN15H).** Main adds
a regression assertion for its own 733.8-KiB startup and 32.1-KiB deferred
measurement. The integrated train measures 815,775 startup bytes (796.7 KiB)
and about 32.5 KiB deferred, within unchanged 900/50-KiB production caps.
The assertion remains enabled and unchanged. Shared ownership, deferred
loads, and package membership assertions pass. The brief authorizes only
the universal VSIX cap formula; an additional startup diet or revision of
this main-only measurement expectation needed a lead decision. TRAIN15H's
lead decision requires compaction; the restored production graph passes both
inherited assertions. The final receipt records exact bytes and all new
closure budgets. No startup baseline or existing cap is raised.

**TRAIN15G scoped certification.** The rig brief and shared common.md prohibit
aggregate quality here. Run owning default-timeout suites and individual gates;
the lead retains aggregate quality, hosted matrices and native/live receipts.
The sole authorized cap decision is the measured universal VSIX formula above.

**TRAIN15F final package cap hold (resolved in TRAIN15G).** The lead’s new
brief authorizes measured universal +5%, rounded up to 25 KiB after the
shared-browser audit. Actual TRAIN15G packages pass the resulting cap; the
measurements below retain the earlier hold’s history.

**Original TRAIN15F package cap hold (2026-10-06, win11).** Actual post-diet
helperless VSIX is 2,600,909 bytes (66,509 over);
verified-helper universal is 2,680,457 (146,057 over).
The existing 2,534,400-byte / 2475-KiB cap is unchanged. Raw bundle,
split/global, staged localization/badges and native export checks pass. The
lead explicitly requires recording this remaining decision after excluding
unneeded payload, rather than raising the cap. Full quality is reserved under
the scoped-certification rule below. Exact inventories and default-timeout
owning receipts: docs/certification/train-0.15.0-train15f.json.

**TRAIN15F scoped certification (2026-10-06, win11).** The continuation brief
requires the 132 complete owning files, default Vitest deadlines and individual
static/build/package checks. Its shared common.md explicitly prohibits full
`npm run quality` on this rig; full quality, hosted matrices, native macOS and
live paid receipts remain the lead's release checks. No gate is weakened.
The lead lifted the exec fixture's two-fix stop and authorized the exact
2aa9cbff7 main merge and correcting D78 to immutable request goldens.

**TRAIN15E exec fixture stop (2026-10-06, win11).** Exec stdio now passes
38 cases, with three existing Windows exclusions, but its first packaging
fixture expects the former single `de` table while using all fourteen real
production tables. After the missing-directory and catalog-cache fixes this
is its third failure. The common brief requires stopping after two distinct
fixes; retain the assertion and record the remaining fixture mismatch. ACP
stdio passes all ten cases, and production package/native checks pass. The
one cold packaging case now has the specifically authorized 60-second limit;
its measured 41.466 seconds includes archive compression and native checks.
Ordinary packaging and exec deadlines remain 30 seconds.

**TRAIN15E universal cap hold (2026-10-06, win11).** The real helperless VSIX is
2,505,428 / 2,534,400 bytes. The certified prior helper contributes 81,327
compressed bytes; adding that contribution alone projects 2,586,755 bytes,
at least 52,355 over the unchanged cap before its ZIP entry headers. The
289,568-byte macOS helper is absent on this rig; no placeholder is fabricated
and no universal receipt is claimed. Further universal size recovery and an
actual helper-bearing package remain for the lead. Helperless packaging and
all native export checks pass; they do not certify the universal archive.

**TRAIN15E D78 deferral (2026-10-06, win11).** Restoring M102's delayed recall
declaration passes its unused-packing-default test but fails 72 train golden
assertions by changing a tool declaration and cache key. Preserve the train's
fixture bytes: all 89 golden assertions pass, while that one D78 test remains
red. No fixture, assertion, timeout or gate is weakened. The precise conflict
and both outcomes are in the train certification; the owner's decision is pending.

**TRAIN15C M96 bounded size stop (2026-10-05, kubuntu).** The first composed
Model API build is 494,346 / 486,400 bytes. Sharing captured validators and pure
team admission brings it to 486,677 (+277); sharing the existing team bootstrap
text through that same boundary brings it to 486,463 (+63). The same raw-size
gate remains red after two distinct fixes. Under the owner's shared `common.md`
stop rule, hold further Model API recovery and subsequent ordered merges pending
an explicit continuation decision. The original deferred cohort is recovered
by conditionally lazy paid usage; no cap, threshold or feature is changed.
Independent M96 tests and packaging measurements continue for a reviewable
candidate, not release certification. The universal archive is 2,397,730 /
2,252,800 (+144,930), with exact largest-20 entry deltas retained. Static,
source and native export checks do not excuse either cap. A local review
checkpoint preserves the candidate with these explicit §7 deferrals; subsequent
merges and release remain blocked. The inherited committed-source binding is
checked after that checkpoint, because the pre-merge HEAD lacks its worker files. Full quality remains delegated to the
lead after M95/M102 join. Receipts: `docs/certification/train-0.15.0.md`.

**TRAIN15B raw-cap deferral (2026-10-05).** The resumed integration recovers
the VSIX, with universal 2,213,704 and helperless 2,132,213 bytes, both under
the unchanged 2,252,800 cap. The shared graph's original deferred cohort starts
at 51,452 bytes; the first usage reduction still prints 50.1 KiB over 50 KiB,
and the second leaves an exact 51,226 bytes (26 over). common.md requires
stopping a path after two failed fixes, and the integration brief requires
all caps to hold. Record the candidate with hooks and defer `m96/int3d`,
`m96/ifix-win4` and `m97/sr`; no further raw-cap optimization or merge is tried.
The source build completes and all other caps pass, but `npm run package`
exits 1 before its packager. Running the actual packager separately measures
exact archives and exercises strict staging, badges and native exports; that
successful measurement does not certify the failing package command. All
scoped checks and eight restored red drills are recorded in the train receipt.
No full quality, cap increase, ignore, skip, feature removal or dependency change.
This supersedes the first run's VSIX blocker below, preserving its history.

**TRAIN15A budget stop (2026-10-05).** The integration brief explicitly
forbids full quality and requires stopping after M101 if its unchanged universal
VSIX cap cannot be met without a product decision. The first M101 candidate is
2,368,627 bytes, 115,827 over. An existing-ESM shared-entry experiment preserves
startup and model-text readership but leaves the original deferred cohort over
its hard cap after two bounded fixes (57 bytes, then 10); common.md requires
stopping that path. Restore the separate Models graph and retain every shipped
feature and cap. Finish scoped checks, record the fresh artifact and exact largest
twenty base deltas in `docs/certification/train-0.15.0.md`, commit the blocked
integration locally with hooks, and do not merge steps 3–5. This is a justified
review-candidate deferral under rule 2, never a green release claim. The lead
owns a further size-recovery decision and the later continuation/full gate.

## FIXM112U — RVM112U surface repairs (2026-10-06)

**Status 2026-10-06: built.** Status evidence: `docs/certification/m112-u.md`.

**M113-Q-RVM113Q bounded rig certification (2026-10-06).** The rig/shared
brief prohibits aggregate quality and confines changes to Q. Complete owning
test files run with repository-default timeouts and at most three workers;
scoped lint/format, all-project typechecking, deadcode, duplication,
localization, reference, host API and production build checks run directly
on win11. No gate is weakened. Existing unused report manifest keys,
generated host API inventory and destination shipping registration remain
named W integration handoffs in Q's certification, with their actual exit
codes recorded. The lead must pass complete integrated quality before shipping.

**M113-R-RVM113R bounded rig certification (2026-10-06).** The lane brief
reserves full `npm run quality` to the lead and confines changes to R's
files. Default-timeout regressions, byte-exact drills, all-project
typechecking, scoped lint/format, schema/reference freshness, dead code,
zero-clone duplication and production size/split/host-global/notices gates
run directly on win11. The seven pre-existing unused report manifest keys
and the existing `node:crypto` inventory mismatch (46 to 47) remain named
W integration handoffs in `docs/certification/m113-r-renderers,-redaction,-determinism.md`;
neither gate is weakened or claimed green. W's complete integration gate
must pass before the milestone ships. RVM113R has no deferred finding.
RVM113R2 uses the same bounded certification: complete default-timeout
owning files and scoped checks run on win11, with exact-restoration drills;
the single P2 is fixed and neither existing integration handoff is hidden.

**M113-V-RVM113V bounded rig certification (2026-10-06).** The lane/shared
brief prohibits aggregate quality and merges; the lead runs integrated
quality after W's wiring. Run complete owning tests with default timeouts,
typecheck, changed-file lint/format, deadcode, duplication, localization,
reference, host API and production build directly on Windows 11. Record
the unchanged unbound manifest/reference/inventory/entry failures as W's
integration handoffs, with concrete receipts in V's certification. No rule,
ignore, threshold or timeout is weakened. All three P2s and the P3 have
named regressions and byte-exact red drills; the browser uses the compiled
host's real production CSP.

**M113-X-RVM113X bounded rig certification (2026-10-06).** The lane brief
reserves aggregate quality for the lead and forbids merges/pushes. Run the
complete owned report/ACP/CLI test files at the repository timeout (three files
and workers maximum), focused lint/format, typecheck, deadcode, duplication,
localization, host API, reference/schema freshness and production build on
Kubuntu. Certify every repaired guard with a named failing test and SHA-256
restoration. Existing unused manifest keys, host API freshness and reporting
bundle registration remain the named W handoffs; no gate is weakened.

- **M113-H2 lane certification (2026-10-06).** The lane brief prohibits
  the full quality run on this shared rig; the lead owns fleet quality.
  H runs scoped suites, typecheck, lint, format, deadcode, duplication,
  localization, reference, host inventory and production build directly on
  Kubuntu. The previously recorded seven unused manifest keys and generated
  host inventory remain W integration handoffs, never suppressed or claimed
  green; final command outcomes are in H's certification.

**M113-N-RVM113N/RVM113N2/RVM113N3/RVM113N4 bounded rig certification (2026-10-06).** The explicit
rig/shared brief reserves aggregate quality for the lead and forbids merges.
Run complete owned suites (at most three files per run), default timeouts,
scoped static checks and the production build directly in this worktree.
Existing unused report manifest keys and host API freshness remain W's
integration handoffs. Record every nonzero gate without weakening it.

**M113-L0-RVM113L02 bounded rig certification (2026-10-06).** The brief
reserves aggregate quality for the lead. Run complete owned unit files with
default timeouts and the scoped static/build checks directly on Kubuntu;
record exact-restoration drills in lane 0's certification. The seven existing
unused manifest keys remain W's wiring handoff; no gate is weakened. Full
integrated quality and native-host implementation remain the lead's work.

Authority: the rig brief and lead decisions, refining D92/M112 from
`plan/m105-m107`. No producer, wire contract or paid-call change.

- [x] P2-1: the same-session snapshot owns the open set. An absent active
      transcript card becomes locally unavailable, retaining any known terminal
      state. Counts, chip, navigation and delivery use the same derived set.
- [x] P2-2: one same-session history merge preserves approval outcomes and
      question cards/outcomes, including retired terminal records.
- [x] P2-3: approvals first, then newest waiting question; protect a question
      focus or typing in its draft; retain inactive drafts. Reminders rank only
      among deferred questions.
- [x] P3: separate lazy question renderer/dock region/chip from the small
      startup draft context and approval shell. Keep a minimal loading card;
      preserve drafts. Measure startup against the 3 KiB target and allocate the
      question closure measured size +15%, rounded up to 25 KiB, independently
      of the unchanged unclassified deferred cap.
- [x] Complete-file regressions, red drills with byte-exact restoration,
      scoped rig gates and hooks-on local commits; record in
      `docs/certification/m112-u.md`. Lead retains aggregate quality and existing
      Q/A/editor integration handoffs. No merge, push, dependency or gate widening.

## FIXAGENTOUT — Independent M119 review repairs (2026-10-07)

**Status 2026-10-07: released.** Shipped in 0.16.0 (§10).

The five confirmed findings in RVAGENTOUTC are in scope: cancellation while ACP
inspection reads history, unchanged parent request bytes, turn-local task
completion evidence, child-scoped patch reads in both editors, and preservation
of archived native attempts during active reads. Each repair gets a regression
run against the reviewed `f50425ffa` tree, then complete owning files run three
times in a fresh committed clone with CI enabled and repository-default timeouts.
No wire field, dependency, command, translation or gate cap changes. Inspection
must read output by its owning session without resuming that child.

- [x] Five regressions fail on the reviewed revision and pass after repair.
- [x] Fresh-clone repeated owning tests and individual static/build gates.
- [x] CHANGELOG and `docs/certification/agent-outcomes.md` repair receipts.

## REL0143M — Integrate the webview diet into 0.14.3 (2026-10-06)

**Status 2026-10-06: built.** Status evidence: `docs/certification/rel0143.md`.

- Merge `sync/main-0143` (`61d8647c2`) into the prepared release with both
  M112 question behavior and DIET1 optional-surface loading retained.
- Keep the immediate question arrival card and shared drafts eager; give lazy
  question controls the shared failure/retry boundary and their existing 25 KiB cap.
- Preserve DIET1's stricter 733.8/32.1 KiB regression baselines as well: defer
  MCP form controls and workflow details, and compact History's layout loop.
  Forms share the existing question cap;
  workflow details get a measured independent 25 KiB closure cap.
- Deduplicate the merged ACP question-command golden in existing test fixtures,
  retaining every command, description and input field under the zero-clone gate.
- Keep the What's New codec fixture between its unchanged 40 KiB encoded
  and 75 KiB decoded limits, even when a whole historical release jumps
  past the upper limit. The real two-release artifact remains separately checked.
- Regenerate reference artifacts, put the diet release notes in 0.14.3 and add
  the README startup bullet. Verify the unchanged 900/50/2400 KiB startup,
  deferred and VSIX caps with focused default-timeout tests and rig gates.
- Local hooks-on merge commit only; no push, extra merge or model call.

## DIET1 — Webview startup and deferred headroom (2026-10-06)

**Status 2026-10-06: built.** Status evidence: `docs/certification/diet1.md`.

- [x] Measure main `e56b795a` with the production metafile: startup 813,180 B
      (794.1 KiB); original deferred aggregate 51,157 B (49.96 KiB).
- [x] Reduce startup by at least 60 KiB and original deferred aggregate to
      at most 35 KiB without raising either existing cap or adding dependencies.
      Keep transcript, composer and approvals eager; defer optional surfaces
      and preserve the complete inline English fallback with lossless encoding.
- [x] Accessible loading, local load failure and retry; shared-host CSP/asset
      proof; owning tests and intentional static-import red drill.
- [x] Fix RVMDIET1 P2-1, P2-2 and P3 with owning regressions and byte-exact
      red drills; final 628-page accessibility matrix exits 0 on macmini.
- [~] Scoped rig gates, production/package, accessibility and browser smoke;
  certification `docs/certification/diet1.md`, contribution rule and changelog.
  Lane rules prohibit aggregate quality, network, merges and pushes; the
  lead retains integrated quality and hosted checks.

**FIXDIET1 review follow-up (2026-10-06).** RVMDIET1 P2-1 is fixed by
rebuilding the panel document on Retry; the existing persister flushes state
before the host rebuilds and the browser refetches the complete module graph,
including failed static dependencies. The dynamic-root URL rewrite is removed.
Interactive lazy surfaces use the shared deferred loader. Each open owns
an intent that is cancelled on dismissal; loading and failed nonmodal menus
retain outside-pointer/focus, Escape and trigger-focus behavior (P2-2/P3).
Regression tests and byte-exact red drills certify each fix. Keep startup at most
733.8 KiB, the original deferred group at most 32.1 KiB and each moved
surface within 25 KiB. No dependency, gate relaxation, model call or merge.

**M107-W complete-suite compatibility repairs (2026-10-06).** The first
complete run exposes M80 package fixtures missing resource artifacts/event v2
and the Action extractor rejecting H's v2 event envelopes. Keep frozen v1
schemas and result payloads, accept both strictly validated event versions in
the Action with resource variants mirrored from the existing zod contract,
and prove parity/refusal with malformed/private-field cases. Restore metadata
Git's empty-filter handling for its new typed exit error; include the four
resource artifacts in the verified report-frame vocabulary. Keep manifest
coverage exact using both runtime default tables and await admitted voice
launch failures before asserting credential-free native environments. Refresh production
and fake-only package fixtures, require the new artifacts/schema in the test
packer, and retain existing missing-artifact guards. Existing built exec rows
validate the writer's actual v2 envelope. Record before-fix failures and
byte-exact guard mutations; no new command, dependency, timeout or cap.

**M107-W native fixture deadline repair (2026-10-06).** The final complete
run exposes default-deadline native fixture pressure.
Keep every assertion and all 32 real PID-reuse births; bound that test's Linux
numerical discovery to its own real child PIDs while leaving native stat,
membership, signalling and the separate full-discovery descendant tests intact.
No production reader, timeout or attempt count changes.

**M107-W continuation qualification (2026-10-06).** The new rig brief
explicitly authorizes the final DK no-fast-forward merge and a complete
unit/e2e suite in batches of at most three files, `--maxWorkers=3`, with the
repository's default test timeout. Recheck the latest locally supplied main,
run all requested static/build/package/reference/localization/host-API gates,
fix merge failures without relaxing gates, and update the final integration
record. Aggregate quality/coverage, hosted OS/editor/native and performance
qualification remain with the lead; the prior scoped-only W restriction below
is historical to the first delivery brief. No push or unlisted merge.

**M107-W lane qualification (2026-10-06).** The rig brief explicitly forbids
aggregate quality/whole-unit coverage in this lane. Run scoped complete files
with default deadlines, all five typechecks and the required static/build/
reference/schema/package checks; record exact exits and red/restored hashes.
The lead owns full quality, hosted/native/editor checks and owner performance
receipts on the final joined tree. This is a named qualification deferral,
not a weakened gate or permission to release before those gates pass.

### Preserved integration gates

**FIXM107J scoped qualification (2026-10-06).** The rig brief forbids full
quality/full-suite runs here and assigns them to W/lead. Run complete J suites
at repository-default deadlines, all five typechecks, changed-file lint/format,
plain Knip, duplication, localization, host API and production build. The
existing host-API stylesheet-source inventory lacks J's stylesheet; W owns
that generated delivery record and its regeneration at the M102 join. Record
this exact non-green check without editing another lane's generated file or
weakening a gate. The absent feature catalog/reference generator remains
M107-J-M102-history-binding in §9. See J's certification for scoped results
and red/restored guards; neither shared check is represented as green.
**FIXM107R bounded review certification (2026-10-06).** The rig/common
brief prohibits aggregate quality, whole-unit/coverage runs and merges.
Run the complete relocation suite with default test timeouts, before-fix
regressions and byte-exact red drills, all-project typecheck, scoped
lint/format, localization, host API, plain knip, duplication, cycles and
production build under unchanged caps. The lead retains joined aggregate
quality and M100/C2/W's delivery qualification. Exact repair receipts are
in `docs/certification/m107-r-relocation.md`; no gate is weakened.

**M107INT round-3 certification (2026-10-06).** The rig brief authorizes
only the listed T2/U/H merges, scoped complete-file runs (at most three,
three workers), all-project typecheck, lint/format, localization, generated
host inventory, cycles, plain knip and production build with every unchanged
cap. Full quality and aggregate coverage remain the lead's work. The shutdown
audit repairs have before-fix failures and fourteen byte-exact red/restored
mutations. The lazy factory regression covers both window and runtime exports;
the split inventory excludes the runtime implementation from parent bundles.
See `docs/certification/m107-int.md` for exact receipts and final sizes.
**M107 DK scoped qualification.** The rig brief expressly forbids aggregate
`quality`/full unit/coverage here and assigns them to the integration lead.
DK runs complete owned test files (at most three per invocation), all
project typechecks, changed-source lint/format, localization, deadcode,
duplication, cycle, host-API and production build checks. No gate is weakened.
Scoped results and deliberate failures are in `m107-dk.md`.
`check:host-api` is deliberately left red only for W's generated Node import
counts (crypto 47→49, fs 33→34, fs/promises 51→54, os 12→13, path 92→96); DK's ownership
rule forbids editing that record. W regenerates and reviews it at integration.

**FIXM107INT bounded review certification (2026-10-06).** The user's rig
brief/common rules prohibit full quality and aggregate unit/coverage runs.
Run complete owning files in serial groups of at most three, before-fix
regressions and byte-exact red drills, native Windows receipts, all-project
typecheck, scoped lint/format, localization, host API regeneration/review,
cycles, plain knip, duplication and production build/caps. The lead owns
aggregate quality and the remaining platform/editor qualification. No gate,
threshold, cap or existing skip changes. See `docs/certification/m107-c1.md`.

**M107INT2 bounded continuation certification (2026-10-06).** The rig
brief requires the two named G/A merges, six native Windows cases and the
complete merged resource suites (at most three files per invocation),
typecheck, scoped lint/format, localization, regenerated/reviewed host API,
cycles, plain knip, duplication and production build/caps. Full quality
and aggregate coverage remain prohibited here and owned by the lead.
Native restoration assertions receive deliberate false-success helper
mutations and byte-exact source restoration. See `m107-int2.md` for results;
the member-state/native-port production binding remains W's named handoff.

**M107INT/C1 bounded integration certification (2026-10-05).** The rig
brief prohibits aggregate quality and full-unit runs. Run S/T/G's complete
owning files and complete touched spawn suites in serial groups of at most
three, with deliberate new-guard failures, all-project typecheck, scoped
lint/format, localization, host API regeneration/review, cycles, plain knip,
duplication and production build/caps. The lead owns aggregate quality,
coverage and the remaining platform/editor receipts. No gate or cap changes.
The generated host API is updated here, closing the S/T/G snapshot handoff;
their original drift records below remain historical. See
`docs/certification/m107-c1.md` for actual outcomes and lane handoffs.

**FIXM107A bounded-lane certification (2026-10-05).** The rig brief and
shared rules delegate aggregate quality/coverage to the lead. Hook-on local
commits require complete owning suites, deliberate guard-break drills,
typecheck, scoped lint/format and the required static/build checks. The
existing W-owned host-API record and native/editor/integrated-governor receipts
remain integration handoffs; no gate is weakened.

**FIXM107T bounded-lane certification (2026-10-05).** The rig brief/shared
rules prohibit aggregate `npm run quality` and full tests in this worktree.
Hook-on commits use complete owning files, deliberate guard-break drills,
typecheck, scoped lint/format and the required static/build checks. The lead
retains full integrated quality, coverage, native platform and editor receipts.
No threshold, timeout, rule, skip policy or guard is weakened.

**FIXM107T3 review certification (2026-10-06).** Both RVM107T3G P2s
are fixed; no reviewed finding is deferred. Direct complete owning batches
pass 173 tests with eight existing platform skips using repository-default
5 s timeouts, and 13 deliberate guard mutations fail and restore source
byte-exact. All five TypeScript projects, scoped lint/format, deadcode,
cycles, duplication (zero clones), localization (14 tables, zero problems)
and production build/caps pass. After final ticket normalization, host/unit
types, the 38 owning Linux tests, lint, duplication and build pass again.
The host-API record still exits 1 only for the same six W-owned import counts
listed below; its generated file is untouched. No aggregate quality, model
call, dependency, threshold or hook change. See docs/certification/m107-t3.md.

**M107 T3 scoped certification (2026-10-06).** The rig/shared brief forbids
aggregate quality and branch merges. T3 certifies complete owning files,
native cgroup launch/Stop on Kubuntu, deliberate guard mutations and serial
static/build gates. Full integrated quality/coverage and all editor/spawn
wiring remain the lead's handoff. No gate configuration or dependency changes.
The existing W-owned host-API snapshot must include the new Linux launcher
and timer imports on integration: node:child_process 13→15, node:crypto 46→47,
node:fs/promises 47→49, node:path 84→87, node:process 1→3 and
node:timers/promises 3→5. Its gate exits 1 for those six counts; the generated
file is untouched. W regenerates and reviews the record after integration.
All other required scoped checks pass, with 161 tests, eight existing platform
skips and 17 deliberately failing/restored drills; exact receipts are in
docs/certification/m107-t3.md. This is the existing deferral, not a green
host-API or full-quality claim.

**M107 T2 scoped certification (2026-10-06).** The rig brief prohibits
aggregate quality and merges; the lead retains integrated quality/coverage
and native Linux/Windows qualification. T2 runs complete owning test files,
serial typecheck/lint/build checks and 31 action/enrollment guard mutations
plus the native microsecond precision drill. Its production Mac binding adds
one `node:path` import, so the existing W-owned host-API snapshot handoff now
requires 84→87 for that row; the other original rows remain 13→14, 47→48
and 1→2. No VS Code API changes. The shared rules mention `check:reference`,
but this base has neither that script nor `featureCatalog.ts`/the generator;
T2 introduces only an internal native mode/API, no public feature. The attempted
command reports missing script, not a passing gate. See
`docs/certification/m107-t2.md` for exact receipts and reruns.

**M107-T-host-api-record (W handoff).** `npm run check:host-api` still exits 1
for the original lane's Node import counts: `node:child_process` 13→14,
`node:fs/promises` 47→48, `node:path` 84→86, `node:process` 1→2. FIXM107T adds
no production import or host API. W owns the generated file; after integration
run `npm run check:host-api -- --write`, review those four rows and rerun the
gate. This is the named existing snapshot deferral, not an unfixed review
finding or a green host-API claim. See `docs/certification/m107-t.md`.

**FIXM107S bounded review certification (2026-10-05).** The rig brief and
shared lane rules prohibit aggregate `npm run quality` and whole-unit runs.
Run the three complete sampler owning files, typecheck, changed-file
lint/format and static/build checks directly on Kubuntu with normal hooks.
The pre-existing host-API importer-count drift stays W's responsibility;
the gate remains red until its generated record is updated at integration.
No gate, timeout, threshold, ignore or bundle cap is weakened. Receipts
and deliberate failures are in `docs/certification/m107-s.md`.
**FIXM107H bounded repair certification (2026-10-06).** The explicit rig
brief and shared lane rules prohibit aggregate `npm run quality` and full
test suites here, and prohibit merges. Local hook-on commits use the owning
resource regressions, byte-exact guard drills, scoped lint/format and all
five typecheck projects. The final repair receipt also runs the ACP/runtime
compatibility tests, dead-code, duplication, localization, host API and
production build checks. W/lead retains the joined full quality, coverage,
cross-platform and native surface certification. No gate is weakened;
exact results and inherited integration failures are recorded in
`docs/certification/m107-h.md`.

**FIXM107H inherited wiring deferrals.** The fresh production build passes
all existing caps (ACP 827.2/850 KiB) but exits 1 at the unchanged seven
`src/shared/resources.ts` reads of `zod/mini._default`, absent from
`dist/validation.js`. W owns exporting that mini-parser member and the
resource bundle's split/package wiring. The host API check also exits 1:
generated Node-importer counts require child_process 13 → 14, fs/promises
47 → 49, os 9 → 10 and path 84 → 89. Neither repair adds a Node import;
W owns refreshing/reviewing the integrated host record. The gates remain
red, with no ignore, cap change or release approval. Named integration
residuals and follow-up are in §9 and `docs/certification/m107-h.md`.

**REL0143M bounded integration certification (2026-10-06, Kubuntu).** The
specific rig brief authorizes only the main diet merge and local hooks-on
commit. Shared rig rules prohibit aggregate `npm run quality`; the lead owns
integrated quality, hosted CI and live/editor release receipts. Preserve all
existing caps and DIET1's regression baseline assertions. Add the measured
workflow closure in D6; MCP forms share the existing question closure. Five
intentional guard failures are restored byte-exact before default-timeout
verification. No dependency, wire shape, paid call, extra merge, push, rebase,
timeout override or hook change. Local package badge validation uses the
existing named network skip, which CI rejects. Receipts and conflicts:
`docs/certification/rel0143.md`.

**DIET1 bounded rig certification (2026-10-06).** The user-provided lane brief
and shared rules prohibit aggregate quality and public network, merges and
pushes. The local commit uses scoped typecheck, lint/format, Knip, duplication,
localization, reference, host API, webview suites, production/split/size,
accessibility matrix, real-browser fake-host smoke and VSIX packaging. Local
packaging uses the existing named badge-network skip; CI rejects it. The lead
must run integrated `npm run quality` and hosted checks before integration.
See `docs/certification/diet1.md` for measurements and byte-exact red drills.
The initial second accessibility scan reported zero violations/undecided rules
across 628 pages but exited 1 when light/usage-install missed the unchanged
10-second readiness deadline. FIXDIET1's final complete matrix supersedes that
outstanding receipt: 628 pages (157 scenarios × four themes), exit 0, zero
violations, zero undecided rules, zero exemptions and zero missing results.
No timeout, exemption, worker policy or accessibility rule changed. The lead
still owns integrated aggregate quality and actual host/release certification.
**FIXM115U7 gate allocation (2026-10-06).** The final rig lane retains
FIXM115U6's aggregate-quality prohibition. Complete owning files use the
repository's default timeouts and at most three files/workers per invocation.
All static/build gates and restored guard drills run directly on Kubuntu;
W/lead owns aggregate quality, full coverage and unrun editor/OS integration.
No gate or timeout is weakened; no command or setting is added.

**FIXM117C scoped rig certification (2026-10-06).** The lane/shared brief
prohibits aggregate quality and full unit runs, merges, pushes and rebases.
Run owning default-timeout tests, byte-exact red drills, all five typechecks,
scoped lint/format, deadcode, duplication, localization, reference, host API
and production build on Mac mini. W/lead retains the integrated full quality
and cross-rig checks. No gate, timeout, threshold or cap is weakened; the
existing generated host-API import-count refresh remains W-owned.

**FIXM117S scoped rig certification (2026-10-06).** The explicit rig/shared
brief prohibits aggregate `npm run quality`, full test runs and merges in
this lane; W retains those integration gates. S runs full typecheck and
scoped ESLint/Prettier, deadcode, duplication, localization, host API,
reference, production size/split/global/notices checks, and its three owning
unit files directly on Mac mini, one heavy command at a time. Each reviewed
fix and new admission proof has a named byte-exact red drill, followed by
green verification. All gate levels, caps and the 2,000 ms benchmark bound
are unchanged. Receipts: `docs/certification/m117-s-schedule-and-simulation.md`.
**M117-P scoped rig certification (2026-10-06).** The explicit lane/shared
brief prohibits aggregate quality/full suites and assigns them to W/lead.
P runs its owning fake-only files directly on MacBook Pro, at most three per
run with repository timeouts, one heavy command at a time. Typechecks,
scoped lint/format, deadcode, duplication, localization, reference, host API
and the unchanged production size/split/global/notices gates are required.
Every new guard has a named deliberate failure and SHA-256 restoration in
`docs/certification/m117-p-spin-it-up.md`. Only the two expressly listed
S/C no-fast-forward merges are authorized; hooks stay on. No UI is changed;
W owns browser/all-editor and lazy-estimator bundle certification.

**FIXM117R scoped rig certification (2026-10-06).** The lane/shared brief
prohibits aggregate `npm run quality`; the lead owns that gate. Run owning
recommendation, price and exact-money tests with the default timeout, red
drills, all five typechecks, scoped lint/format, deadcode, duplication,
localization, reference, host API and production build directly on Mac mini.
Keep hooks on; no merge, rebase, push or weakened gate is authorized.

**FIXM117L0 scoped rig certification (2026-10-06).** The lane/shared brief
prohibits aggregate `npm run quality` and assigns it to the lead. This repair
runs owning test files at the repository default timeout, red drills with
SHA-256 restoration, all five typechecks, scoped lint/format, deadcode,
duplication, localization, reference, host API and production build checks
directly on Mac mini. Hooks remain enabled. No merge, rebase or push is
authorized for this lane, and no gate or cap is weakened.

**FIXM115U6 gate allocation (2026-10-06).** The same rig prohibition on
aggregate quality applies. The lane runs complete owning files with default
timeouts, source-boundary lint tests, restored red drills and the required
static/build gates. W/lead retains full quality/coverage, packaged network
badge validation, editor integration and other-OS execution. `check:reference`
remains unavailable as recorded below; no command or setting is added.

**FIXM115U5 lane gate allocation (2026-10-06).** The rig brief forbids
aggregate quality in lane U; W/lead owns `npm run quality`. This lane runs
complete bounded owning suites with default timeouts and the required
static/build checks. No threshold, ignore, timeout or rule changes.
The common brief's `check:reference` cannot run on this branch: there is no
script, generator or feature catalogue. The attempted command reports a
missing script; no pass is claimed and no gate is introduced or weakened.
The repair adds no feature, command or setting; W/lead owns any later
reference tooling adoption.
**FIXM115V bounded repair certification (2026-10-06).** The explicit
rig/shared brief prohibits aggregate quality, full tests and branch merges.
Run the nine owning unit files in three-file/three-worker batches, scoped
lint/format, all five typecheck projects, localization, host API, deadcode,
duplication, production build and the owned accessibility scenes directly
on the Mac mini. Keep all gates and budgets unchanged. The review repair
has 23 new regressions and 21 byte-exact restored red drills; W/lead retains
aggregate quality and final host, editor and paid/live certification.
Receipts and the named HELPREF-M115V binding residual are in
`docs/certification/m115-v.md` and §9.

**BADGEFIX bounded rig certification (2026-10-05).** The lane/shared brief
prohibits aggregate `npm run quality`, pushes, merges and rebases. Run owning
test files, deliberate failures, typecheck, scoped lint/format, deadcode,
duplication, localization, host API and production/package checks directly on
Kubuntu; the lead retains full integrated quality and hosted service proof.
Local badge requests use the explicitly permitted named skip because the shared
rig lane forbids public network. CI and CI packaging reject that override and
must validate actual SVG responses. PNG screenshots remain HTTPS content images;
the SVG requirement applies to badges. No threshold or existing gate is relaxed.
Focused certification passed: 86 tests, 23 byte-exact red drills, required
static/build/package checks and actual VSIX/ACP archive version inspection.
The 0.14.0 VSIX is 2,168,278 bytes under the unchanged 2,252,800-byte cap; the
ACP tarball is 1,295,446 bytes. Both carry exact static v0.14.0 badges, and a
future-version fixture proves no manual badge bump is needed. The Kubuntu
package lacks the compiled macOS helper; hosted universal packaging remains
unchanged. Receipts: `docs/certification/badgefix.md`.

## FIXHELPREF4 — Final focused help audit repairs (2026-10-06)

**Status 2026-10-06: built.** Status evidence: `docs/certification/help-reference.md`.

Scope: fix RVHELPREF4's P1 and both P2 findings. Best-of-N's finite session
budget requires an owned parent scope shared by candidates; derive that help
prerequisite from the production manager's admission in a truth regression.
Correct English and all fourteen translations, then regenerate every output.
Reject the closed state-predicate vocabulary in every plain description by
walking the complete built reference, including keyboard rows and nested facts.
Move existing state claims into typed conditions rather than rewording them.
Prove the review's exact sentences fail at buildReference/referenceMarkdown,
accept neutral prose, and retain the original 100-KiB reference cap.

The complete walk exposed existing conditional enum meanings and paid-default
facts as well as ordinary descriptions. Preserve them with typed localized
references and the same selector on every surface. The first production build
correctly rejected the resulting reference at 103,230 bytes / 102,400. Extend
the existing lossless string packing with shared technical prefixes, certify
whole-model equality and a rejecting restoration drill, and retain every cap.

- [x] Budget truth regression, all translations and generated outputs.
- [x] Vocabulary/output-walk regressions and byte-exact red drills.
- [x] Scoped Kubuntu validation and hook-on commits; no merge or push.

Evidence: `docs/certification/help-reference.md`. The rig brief reserves full
quality and release integration for the lead. No new dependency, paid/live
call, guard weakening or cap change is authorized; time box: ninety minutes.

## FIXHELPREF3 — Third truth audit repairs (2026-10-06)

**Status 2026-10-06: built.** Status evidence: `docs/certification/help-reference.md`.

Scope: resolve all six RVHELPREF3 findings at their source. Describe both Auto
reviewers and ordinary model questions separately from MCP elicitation; prove
the prose against runtime paths. Use one JSON formatter for displayed/searchable
facts, schemas and CLI contracts. Escape argument slots throughout Markdown.
Represent forward and backward modal focus in the shared handler table. Replace
the historical-sentence blacklist with a structural conditional-description
rule and typed conditions rendered on every reference surface. Audit every
human-written catalogue description against its code path and record corrections.

- [x] Six regressions and twelve deliberate red drills, with SHA-256 restoration.
- [x] Whole-catalogue truth pass, translated tables and generated reference.
- [x] Scoped Kubuntu checks and hook-on local commits; no merge or push.

Evidence: `docs/certification/help-reference.md`. The rig brief prohibits
aggregate quality; integrated quality remains the lead's gate. No new dependency,
live/paid request, relaxed guard or budget change is authorized.

## REDHELPREF — Runtime-owned reference facts (2026-10-05)

**Status 2026-10-05: built.** Status evidence: `docs/certification/help-reference.md`.

Scope authorized by FIXHELPREF.rig.md: replace heuristic reference facts with
typed runtime registries for CLI options, webview keys, slash grammar and paid
identity. Settings retain the complete contributed schema; command conditions
retain the contributed menus. Human descriptions live in the catalogue and all
14 translations, never in generated fact strings or failure-message lookups.
Conditional state is expressed as conditions, with a rejecting catalogue lint.
The independent gate inventories all keyboard handlers and parser routes,
regenerates every committed output in both directions, and tests actual actions,
defaults, paid registry identity and route option acceptance. Preserve all
existing audits' regressions, add the second audit's 16 regressions and repair
deferred build fixtures. Search includes every displayed field and retains
visible relationship targets. No native/phone implementation is added; ACP and
CLI consume the same lazy reference through their existing bridges.

- [x] Runtime-owned typed sources and translated catalogue descriptions.
- [x] Complete action coverage, independent truth tests and 19 red drills.
- [x] Search/navigation, fixtures and scoped static/build validation.

The rig brief forbids aggregate quality, merge, rebase and push. Hook-on local
commits follow scoped green checks. Receipts: docs/certification/help-reference.md.

## FIXHELPREF — Reference truth audit repairs (2026-10-05)

**Status 2026-10-05: built.** Status evidence: `docs/certification/help-reference.md`.

Scope: resolve RVHELPREF findings 1–23 in the existing help lane. Derive paid
membership from the paid registry, complete setting schemas from the manifest,
CLI options from the parser, slash syntax from its parsers, and command
conditions from menus. Record explicit host/backend combinations and effective
availability; distinguish extension workflows from ACP's local help/skills.
Inventory existing palette, bridge and keyboard actions independently of the
catalogue, then check their reference coverage. Correct release placement,
installed-language output, first-help skill refresh, unavailable values and
loading failures with retry. Each repair has a failing regression/drill and
byte-exact restoration in `docs/certification/help-reference.md`.

- [x] Repair all 23 findings, with exact implemented surfaces and complete contracts.
- [x] Certify 571 scoped tests and 59 deliberate failures with byte-exact restoration.
- [x] Pass existing static/build gates, production help parity/localization and
      wide/narrow English/French accessibility; preserve every budget.

The rig brief overrides common.md's old merge step: no merge, push or rebase.
Scoped checks run on Kubuntu; aggregate quality remains the lead's gate. No
dependency, live/paid call, credential access or gate/cap weakening.

## HELPREF — Generated Help & Reference (2026-10-05, release 0.14.1)

**Status 2026-10-05: built.** Status evidence: `docs/certification/help-reference.md`.

Owner requests `/help` opening an always-current, searchable reference of every
feature, slash command, palette command, setting and keyboard shortcut. Build
on the shared palette, manifest translations, host bridge and modal UI.

Startup comparison against `2d4d72bd` measured 914,658 bytes before help and
917,333 bytes with help's entry points and English controls. Keep the existing
inline fallback and lossless dictionary; use reserved two-byte UTF-8 dictionary
characters (U+0100–U+05FF) instead of three-byte private-use characters. The
canonical English table has no collision and uses 953 of 1,280 slots. The
existing collision guard and exact full-table round-trip remain mandatory;
verify smaller startup and unchanged limits before certifying this lane.

- [x] Generate the lazy reference model and `docs/reference.md` from the
      manifest, palette, typed feature catalogue and ACP/CLI command table.
      Validate coverage, descriptions, links and freshness in `check:reference`;
      add that check to local quality and CI without changing any cap.
- [x] Add shared React reference page, translated controls, current/default
      values, settings links and an explicit safe command allowlist. Host bridge
      messages are schema-validated. VS Code filters settings by `@id:`; native
      bridges use their settings page anchors with the same requested key.
- [x] Wire panel `/help`, Open Help & Reference palette command, ACP's compact
      `/help`, CLI `help --all` and headless help. The generated GitHub reference
      is the companion link for ACP editors; the React page is portable through
      the shared bridge. No backend or model invocation is required for help.
- [x] Prove generator/page tests and red drills; check accessibility in all
      four themes, capture wide/narrow light/dark, measure unchanged startup caps,
      update README, CONTRIBUTING, AGENTS and CHANGELOG, commit with hooks.

HELPREF lane runs on macmini. The explicit rig rules prohibit full `quality`,
push, merge and rebase; the lead retains integrated quality/release approval.
Scoped tests and all available static/build checks run directly here. No paid
or live model calls, dependency changes, credential access or cap changes.
Certification: `docs/certification/help-reference.md`.

## M98 — Muse Judge: a calibrated judge for any agent (D77, phase 1 integration)

**Status 2026-10-05: built.** Status evidence: `docs/certification/m98.md`.

Lane D integration (2026-10-05, Kubuntu): merge A's review fixes and G's
M91-G goldens into U, activate the same-model sources through a lazy window
bundle, retain A's live binding and dispatch guards, and connect dispatch
receipts to U's separate usage rows. Repair the recorded 320 px tool-row
overflow. Document and certify only the behaviour exercised on this tree.
D78's `paidDailyBudget.ts` and setting are absent from this checkout; its
historical `3db0ef37` factory exposes `capUsd`/`reserve`, not A's complete
daily-ledger interface. Metered Judge stays unavailable until that real
adapter and D77's entry-criteria receipts land; no competing store is added.
The exact handoff is recorded in `docs/certification/m98.md`. Prefixes with
hosted billable tools use a standalone body with no tools: Judge token
consent cannot authorize a separate hosted-search charge.
The full rig gate also exposes Chrome CLI `--dump-dom` stalls on ordinary
pages. Use the existing Playwright page driver for every accessibility
scenario, preserving the four themes, real 690/320 px viewports, 120-second
page timeout and every axe finding rule; prove the ordinary-page failure
and the restored driver before rerunning the complete quality command.
Lane D's final Kubuntu `npm run quality` exits 0 (7,317 passing tests;
464 accessibility pages). Package and raw size check exit 0 at 2,113,751
bytes against the unchanged 2,252,800 cap. The universal macOS helper is
absent; CI's exact presence check fails only for that helper. The combined
final-tree checkbox stays open. Receipts and the D78 handoff are in the
aggregate certification record.

- **Goal.** Small, calibrated, advisory decisions, on out of the box (D78),
  from the user's own chat model first, with separate judges later. The Muse
  model, or a deterministic rule, still decides.
  - Redesigned after the third review round (RVM98C): **phase 1 is the
    same-model judge only.**
  - Every other part is a named phase-2 section that stays planned.
- **Phase 1 scope.**
  - **The same-model judge** on the Model API and on Muse Code:
    - stated confidence on every model, batched;
    - logprobs where a model offers them, with binary-from-top-1 under its
      floor;
    - results labelled "uncalibrated" or "approximate (top-1)".
  - **Speed:**
    - Model API side requests that share the main cached prefix exactly
      (redaction first);
    - Muse Code redacted standalone prompts in a fresh hidden session per
      batch;
    - background calls with stale results dropped, and a memory-only result
      cache.
  - **One use:** the Auto risk advisory, through the synchronous caution
    latch at the reviewer-held and card-held fences only (D77, "Where
    phase 1 intervenes"). Not started on immediate allows.
  - **Admission** through D78's daily ledger; the ask-once consent;
    confidential rules; privacy.
  - **Modes:** `auto` (= `same`), `same`, `off`.
  - **Per-backend invariance goldens:** M91-G's raw-body harness for the
    Model API, MSP frames for Muse Code.
- **Phase 2 sections**, each with its own lanes, acceptance, drills and
  certification when it starts:
  - 2a cascade and `both`;
  - 2b calibration fitting;
  - 2c SystemOne adapters and `judge serve` (M85);
  - 2d sampling and contrastive framing;
  - 2e BYO providers;
  - 2f the other uses, the Judge panel section, and pre-execution fences;
  - 2g the CLI and MCP;
  - 2h lint;
  - 2i the embedding fast path;
  - 2j the local judge, after its design spike.
- **Depends on.**
  - **Phase 1:**
    - M78 and M90 (the reviewer-held approval paths, `reviewedApprovals.ts`,
      and the CLI settings reader);
    - D78's daily ledger and M82's claim journal (FIXDEF);
    - M91-G's raw-body harness (`6cfb19e4`, not yet on main);
    - D48 and D78 (consent).
  - **Phase 2:**
    - M95 (2c keys, 2e, the 2f panel);
    - M91 (2f pre-execution hooks, 2g `judge hook`);
    - M96 (2f hints);
    - M75 (2a, 2b, 2d, 2f, 2i);
    - D68 (2h).
- **Phase 1 lanes and file ownership.** Muse codes each lane. Codex
  independently reviews each lane's finished diff and gate-fire evidence. The
  lead serializes shared files, integration and the aggregate gates; no lane
  rewrites another's region.
  - **Start now on the rigs:** lanes 0, J and A. They are pure or
    interface-level, and need no host integration.
  - **After them:** S needs J. U needs S and A. G needs S and M91-G's
    merge. D runs alongside, closing last.

| Lane                  | Starts                        | Muse implementation ownership                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Codex review / acceptance focus                                                                                                                                                                |
| --------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Contract / strings  | now                           | new `src/core/judge/schema.ts` (zod request/answer/`muse` schemas, bounds, labels); named limits in `src/shared/constants.ts` (`JUDGE_TOP1_MIN_PROB`, `JUDGE_MIN_READY_RATE`, the advisory threshold, deadlines, caps); the `judge` paid feature in `PAID_FEATURES`; `museSpark.judge.engine` (`auto`, `same`, `off`) in `package.json` and `package.nls*.json`; English and the 14 `l10n/ui.*.json`                                                                                                           | Byte-compatible `answers`; option letters `A`–`Z`; no content in log fields; complete real translations                                                                                        |
| J Judge core          | now                           | new `src/core/judge/{judge,math,techniques,prompt,resolve,entries}.ts`: the entropy confidence, logprob renormalization over distinct alternatives, `partial`, binary-from-top-1 with its floor and stated fallback, the stated-confidence parser, the state-first prompt builder, batching (questions split, never the state), the over-context refusal, the phase-1 mode resolver, and the exact-action entry store (key, states, discard rules, the synchronous latch read); new `test/unit/judge*.test.ts` | The RVM98 top-1 counterexample; variants counted once; top-1 never a distribution; a missing field read as failure; no state split; a late result never readable after its fence               |
| A Admission           | now (against D78's interface) | new `src/core/judge/admission.ts`: worst-case uncached reservation per call, refusal of unpriced and over-budget calls, settlement, refunds of known non-sends, liability for uncertain outcomes, re-binding after waits; the adapter onto `src/host/paid/paidDailyBudget.ts` (D78), with no store of its own; integration tests against the real ledger once FIXDEF merges                                                                                                                                    | Entry criteria 1–7 of D77 verified, or a gap filed against FIXDEF; kill after dispatch, corrupt store, lock contention, network-home refusal, two windows, held modal; M80 and D78 regressions |
| S Same-model source   | after J                       | new `src/core/judge/same/**` and host adapters: the Model API side request built from `ModelApiHost`'s own request builder (prefix copied only when redaction leaves it unchanged; standalone otherwise); Muse Code's fresh hidden session per batch (`session/start`, an empty temporary folder deleted after, Plan, no MCP servers, the user-settings allow-rule check, the M90 item guard); background scheduling and the memory-only result cache                                                          | No model switch; main request or session untouched; redaction first; no reuse of M90's session; judge off on standing allow rules; Muse Spark never awaited                                    |
| U Use / UI            | after S and A                 | the latch reads at M78's reviewer fence (Model API) and in `src/host/review/reviewedApprovals.ts` (Muse Code, extension-owned held approvals); the caution note on cards; no start on immediate allows; the ready-rate and precision recorder for M75 replays; the Judge status line; the ask-once modal hook-up; usage rows; harness and accessibility cases                                                                                                                                                  | A ready caution turns ALLOW into ask; a pending one leaves it; the card never waits; never an allow; results kept out of the ALLOW parsers; themes, narrow panel, keyboard and screen reader   |
| G Golden / invariants | after S, and M91-G's merge    | the Model API: an extension of M91-G's raw-body harness (`test/unit/modelApiGoldenRequests.test.ts` at `6cfb19e4`), with the full body byte-identical when `off` or with no hint, the side prefix equal to the main cached prefix, and the redaction case standalone; Muse Code: main-session MSP frames unchanged through the real adapter and fake CLI, and the judge session carrying only the standalone prompt; the SoL-Pi regression files rerun                                                         | Red on any main-body byte change, a side-prefix divergence, a prefix reused despite redaction, or a changed main-session frame; no independent baseline; no claim about the CLI's HTTP bytes   |
| D Docs / integration  | alongside; closes last        | README, `docs/judge.md` (phase 1), `docs/PRIVACY.md`, SECURITY, CHANGELOG, PLAN, `docs/certification/m98.md`, the bundle and package scripts, knip and dpdm entries                                                                                                                                                                                                                                                                                                                                            | Documented behaviour only after real runs; costs from receipts; Muse Code's narrowed claim stated                                                                                              |

- **Phase 1 acceptance.**
  - **FIXM98J review repairs (RVM98J, 2026-10-04).** Findings 1–10
    corrected within lanes J/0: finite JSON booleans; generation-bound entry handles;
    complete-request context admission and splitting; single-character
    answer tokens; no judge in the legacy activation paid review; explicit
    `same` below the automatic ready-rate floor; singular `logprob` metadata;
    ask-once wording with the shared daily budget in every language; a
    schema-free engine predicate; and honest top-1 `partial` metadata.
    Each fix has a regression and a byte-exact red drill in
    `docs/certification/m98-j.md` (16 drills, full hashes beside it).
    Lane U retains first-charge consent;
    no judge call runs in this repair lane.
  1. **Invariance, per backend.**
     - When `off`: no request, no file, no log line, no bundle load.
     - Model API with no hint: the main body is byte-identical (the M91-G
       harness), and side prefixes are exact or standalone under redaction.
     - Muse Code: main-session MSP frames unchanged, and the judge frames
       carry only the standalone prompt.
  2. **The contract.**
     - Jev shapes for noul, choice and score.
     - `muse` carries the source, technique, model, label, our confidence,
       `vendorConfidence`, `partial`, and the reserved and settled cost.
     - The bounds refuse 65 questions, 27 options, 11 levels and an oversized
       body.
  3. **Techniques.**
     - **Stated:** batched and labelled "uncalibrated".
     - **Logprobs:** renormalized over distinct variants.
     - **Top-1:** only for a noul with a yes/no token at or above the floor,
       labelled "approximate (top-1)"; the RVM98 counterexample falls back.
     - **A missing field** is a failure.
  4. **Fences** (C3).
     - A ready caution at the reviewer's verdict turns ALLOW into ask.
     - A fast reviewer with a delayed judge: ALLOW stands, and the late
       result is dropped.
     - An immediate native or Auto allow: no judge started, nothing charged.
     - A card with a caution ready before the answer gets a note; after the
       answer, nothing.
     - A replaced session, turn or action discards the entry.
     - The card never waits.
     - Ready rate and precision recorded per backend; under
       `JUDGE_MIN_READY_RATE`, the backend's default is off, with the reason.
  5. **Muse Code isolation** (C4).
     - A fresh session per batch, never M90's or the main one.
     - An empty temporary folder, removed after.
     - Plan mode with no MCP servers.
     - The judge is off when user-level always-allow rules exist.
     - The tool-item guard cancels.
     - The residual and the narrowed claim appear in §9, in PRIVACY and in
       the first-use note.
  6. **Admission** (C5). Through D78's ledger only:
     - worst-case reservation before dispatch;
     - kill after dispatch, then restart: the liability is kept;
     - a corrupt store or a lock failure: refused;
     - a network home: refused;
     - two windows: one admitted;
     - a held modal: re-checked;
     - unpriced: refused;
     - re-binding after every wait.
  7. **State size.** An over-context state gets an explicit no-answer, and
     questions split across requests each carry the full state.
  8. **Consent and billing.** Model API asks once (D78) with the price and
     daily budget; Muse Code shows the subscription note.
  9. **Confidential.** Same-model calls run exactly when the chat model may.
  10. **Advisory only.** A "safe" answer leaves every verdict unchanged
      (D50's test); results never reach the ALLOW parsers.
  11. **Privacy.** Redaction before any remote call wins over prefix reuse.
      Logs carry ids, source, technique, model, timing and cost only.
- **Phase 1 tests and red drills.** Fakes only under `test/**`:
  - a fake provider with stated-JSON, top-5, top-1, silent-drop,
    reasoning-forced and cache modes;
  - a fake Muse CLI with a hidden-session recorder, an always-allow settings
    fixture and a tool-item emitter;
  - fake reviewers with controllable delays.

  Each new assertion and guard is broken once on purpose, observed failing,
  restored byte-exact (SHA-256), and its whole test file rerun. The record
  goes in `docs/certification/m98.md`. The required drills:
  - **Invariance:** a main-body byte change; a side-prefix divergence; a
    prefix reused despite redaction; a changed main-session MSP frame.
  - **Math:** the top-1 complement under the floor; variants counted twice;
    top-1 used for a choice; a dropped field read as certainty; a state
    split.
  - **Fences:**
    - the latch awaiting the judge;
    - a late result applied after its fence;
    - a judge started on an immediate allow;
    - a judge result parsed as ALLOW;
    - an entry surviving a turn replacement.
  - **Isolation:** reuse of M90's session; judging in the workspace folder;
    running despite a user-level always-allow rule.
  - **Admission:** a dispatch before the durable reservation; a liability
    dropped on restart; two windows admitted for the last claim; dispatch
    after a held modal without re-checking.
  - **Behaviour:** a "safe" score that allows; a user path awaiting Muse
    Spark; the judge doing anything while `off`; contributor tier in a
    confidential workspace.

  Never drill against a user's repository.

- **Phase 2 sections.** Planned, not dropped. Each starts after its
  dependency and the evidence it names.
  - **2a — Cascade, `both`, and `auto` → `both`.**
    - **Design:** the separate judge first; the same model under the entropy
      `JUDGE_CASCADE_CONFIDENCE` or for a high-stakes family;
      profile-weighted combination; disagreement only adds caution.
    - **Needs:** 2b, a verified separate judge (2c or 2j), and M75's
      families. The round-2 numbers are offline prototypes.
  - **2b — Calibration fitting and the report.**
    - Platt first, isotonic at 200 or more labels.
    - Per-family targets with independent labels; outcome signals kept
      apart.
    - Disjoint grouped splits; metrics from the evaluation set only.
  - **2c — SystemOne adapters and `judge serve`** (M85).
    - **Adapters:** OpenRouter Jev (tested), TypeSafe (untested), Clef
      (after a key), over M95's keys.
    - **`serve`:** an IP-literal bind, a per-start token in a user-only file
      deleted on exit, Host and `Origin` refusal (an absent `Origin` never
      skips the token), 64 KiB, per-request admission.
  - **2d — Sampling and contrastive framing,** under the cost gate,
    measured first.
  - **2e — BYO providers** after M95, with per-model capability blocks from
    captures.
  - **2f — The other uses, the Judge panel section and pre-execution
    fences.**
    - **Uses:** skill suggestion, relevance and grading, M96's hints, M90's
      signal, and the three testing uses, each measured first.
    - **Fences:** a deadline-bounded or hook-based fence for immediate
      allows, only with a captured pre-execution hook (M91) and a measured
      ready rate.
    - **The panel section** sits in M95's panel.
  - **2g — The CLI and MCP.** `judge ask`, `calibrate`, `report` and `mcp`,
    plus `judge hook` after M91; exit codes 0, 2 and 4; `--budget-usd`
    defaults to 0; hooks emit caution only.
  - **2h — Lint,** within D77's declared limits: a strict, pinned
    `jevlint.json`; a separate Muse config; Tree-sitter for the kinds
    symbols cannot cover; a "not checked" coverage report; the first-party
    pack.
  - **2i — The embedding fast path,** after a measurement with hundreds of
    labels.
  - **2j — The local judge.** First, a design spike answering C1 and C2
    (D77): verified local inference checked per connection, against the
    named fixtures, or else only a user-configured, unverified endpoint
    that is never confidential and never auto-selected. The build follows
    the spike's verdict, starting from D77's carried design: the pinned
    `node:net` transport, provenance, consented pulls and `tev1:4b`.
    **Amended 2026-10-06** (D90.27's amendment): M110t's lane TJ owns the
    hardware scan and recommendation table that 2j's setup in every editor
    also uses, and the OS installers install and register the judge on hosts
    and nodes once 2j has merged with outcome (a).
- **Gates.**
  - The lead runs the full `npm run quality` and the required CI checks on
    the final integrated tree. Lane tests and builds run on the rigs; local
    work is limited to changed-file formatting and lint.
  - All existing budgets are preserved.
  - New external shapes need counted captures before their parsers: for
    phase 1, Muse Code's hidden-session frames and the CLI's user-settings
    allow-rule format.
  - This planning lane authorizes no paid or live call beyond its recorded
    probes.
- **Security.**
  - Inputs are bounded by named constants.
  - State is data, and the judge can only add caution.
  - Keys stay in SecretStorage or the OS store.
  - Muse Code's judge session carries M90's recorded residual (§9), with
    the narrowed claim.
  - No local endpoint is contacted in phase 1.
- **Docs and owner steps.** None for phase 1. The owner-only keys (TypeSafe,
  Cloudflare) are needed only for 2c. Each surface is documented only after
  a real successful run.
- **Certification checklist.**
  - [x] Owner requests and rulings; D77's policy of record; research and
        probes (41 live attempts, ≈ $0.015; local CPU and GPU runs; round-2
        prototypes labelled).
  - [x] RVM98 (12 findings) answered in `96d7b669`; RVM98C (C1–C6) answered
        by this redesign. C1 and C2 move with the local judge to the 2j
        spike; C3–C6 are fixed for phase 1.
  - [x] RVM98J findings 1–10 repaired in FIXM98J with owning regressions
        and byte-exact red drills; no finding remains as an accepted residual.
  - [ ] Phase 1 acceptance 1–11, each with its failing drill and passing
        receipt.
  - [x] M91-G's harness merged with `--no-ff` in `e64ced28`; lane G's
        golden and MSP receipts are linked in `docs/certification/m98.md`.
  - [ ] D78's ledger meets entry criteria 1–7, or FIXDEF gaps are closed.
  - [ ] Phase-1 final tree: full quality, a11y, package and bundle caps,
        installed-host receipts.
  - [ ] Each phase-2 section certified on its own when it ships.
- **Size.** Phase 1: M, in seven lanes. Phase 2: about XL across 2a–2j.

### Preserved integration notes: M98 — Muse Judge: a calibrated judge for any agent (D77, phase 1 integration)

Never drill against a user's repository.

- **Phase 2 sections.** Planned, not dropped. Each starts after its
  dependency and the evidence it names.
  - **2a — Cascade, `both`, and `auto` → `both`.**
    - **Design:** the separate judge first; the same model under the entropy
      `JUDGE_CASCADE_CONFIDENCE` or for a high-stakes family;
      profile-weighted combination; disagreement only adds caution.
    - **Needs:** 2b, a verified separate judge (2c or 2j), and M75's
      families. The round-2 numbers are offline prototypes.
  - **2b — Calibration fitting and the report.**
    - Platt first, isotonic at 200 or more labels.
    - Per-family targets with independent labels; outcome signals kept
      apart.
    - Disjoint grouped splits; metrics from the evaluation set only.
  - **2c — SystemOne adapters and `judge serve`** (M85).
    - **Adapters:** OpenRouter Jev (tested), TypeSafe (untested), Clef
      (after a key), over M95's keys.
    - **`serve`:** an IP-literal bind, a per-start token in a user-only file
      deleted on exit, Host and `Origin` refusal (an absent `Origin` never
      skips the token), 64 KiB, per-request admission.
  - **2d — Sampling and contrastive framing,** under the cost gate,
    measured first.
  - **2e — BYO providers** after M95, with per-model capability blocks from
    captures.
  - **2f — The other uses, the Judge panel section and pre-execution
    fences.**
    - **Uses:** skill suggestion, relevance and grading, M96's hints, M90's
      signal, and the three testing uses, each measured first.
    - **Fences:** a deadline-bounded or hook-based fence for immediate
      allows, only with a captured pre-execution hook (M91) and a measured
      ready rate.
    - **The panel section** sits in M95's panel.
  - **2g — The CLI and MCP.** `judge ask`, `calibrate`, `report` and `mcp`,
    plus `judge hook` after M91; exit codes 0, 2 and 4; `--budget-usd`
    defaults to 0; hooks emit caution only.
  - **2h — Lint,** within D77's declared limits: a strict, pinned
    `jevlint.json`; a separate Muse config; Tree-sitter for the kinds
    symbols cannot cover; a "not checked" coverage report; the first-party
    pack.
  - **2i — The embedding fast path,** after a measurement with hundreds of
    labels.
  - **2j — The local judge.** First, a design spike answering C1 and C2
    (D77): verified local inference checked per connection, against the
    named fixtures, or else only a user-configured, unverified endpoint
    that is never confidential and never auto-selected. The build follows
    the spike's verdict, starting from D77's carried design: the pinned
    `node:net` transport, provenance, consented pulls and `tev1:4b`.
- **Gates.**
  - The lead runs the full `npm run quality` and the required CI checks on
    the final integrated tree. Lane tests and builds run on the rigs; local
    work is limited to changed-file formatting and lint.
  - All existing budgets are preserved.
  - New external shapes need counted captures before their parsers: for
    phase 1, Muse Code's hidden-session frames and the CLI's user-settings
    allow-rule format.
  - This planning lane authorizes no paid or live call beyond its recorded
    probes.
- **Security.**
  - Inputs are bounded by named constants.
  - State is data, and the judge can only add caution.
  - Keys stay in SecretStorage or the OS store.
  - Muse Code's judge session carries M90's recorded residual (§9), with
    the narrowed claim.
  - No local endpoint is contacted in phase 1.
- **Docs and owner steps.** None for phase 1. The owner-only keys (TypeSafe,
  Cloudflare) are needed only for 2c. Each surface is documented only after
  a real successful run.
- **Certification checklist.**
  - [x] Owner requests and rulings; D77's policy of record; research and
        probes (41 live attempts, ≈ $0.015; local CPU and GPU runs; round-2
        prototypes labelled).
  - [x] RVM98 (12 findings) answered in `96d7b669`; RVM98C (C1–C6) answered
        by this redesign. C1 and C2 move with the local judge to the 2j
        spike; C3–C6 are fixed for phase 1.
  - [x] RVM98J findings 1–10 repaired in FIXM98J with owning regressions
        and byte-exact red drills; no finding remains as an accepted residual.
  - [ ] Phase 1 acceptance 1–11, each with its failing drill and passing
        receipt.
  - [x] M91-G's harness merged with `--no-ff` in `e64ced28`; lane G's
        golden and MSP receipts are linked in `docs/certification/m98.md`.
  - [ ] D78's ledger meets entry criteria 1–7, or FIXDEF gaps are closed.
  - [ ] Phase-1 final tree: full quality, a11y, package and bundle caps,
        installed-host receipts.
  - [ ] Each phase-2 section certified on its own when it ships.
- **Size.** Phase 1: M, in seven lanes. Phase 2: about XL across 2a–2j.

M106 W scoped validation continuation (2026-10-06): the lead lifted the two-fix
stop for the cut-short host terminal assertion and the first lazy Goal-body
assertion. Both now pass without changing their expected behavior. The L2 merge
removed M101's terminal failure; bind that failure to the captured continuation-off
arm. The Goal test awaits its first body content. Factory-boundary regressions,
guard-fire receipts and scoped verification are recorded in
`docs/certification/m106-w-wiring,-docs-and-gates-(last).md`.
M106 still awaits the lead's aggregate and live certification.
**M96INT3C full-profile timing deferral (2026-10-05).** The one requested
`VITEST_MAX_WORKERS=3 npm run quality` finishes red at coverage tests:
12,514 pass, 69 fail, 151 existing/platform/setup skips. Besides the
product/fixture repairs in M96's record, the fixed 5 s test profile times
out real SSH, native retirement, landing/batch, detached descendants,
HTML expansion and a VSCE inventory call. A staging hook also exceeds
its unchanged 10 s deadline under this concurrent coverage profile.
The rig brief prescribes scoped runs at at most three files with
`--maxWorkers=3 --testTimeout=120000`; receipts of those runs are separate
from full-quality certification. Gates remain unchanged. Full-quality
certification requires a fresh owner-authorized run after these repairs
and resolution of the shared archived-ref history blocker; round 3c's
single invocation is never relabelled green. Windows proof belongs to
REDWINI96/round 3d. No live/paid attempts.

M106 W Node build binding (2026-10-06): the standalone exec split carries the
ACP SDK's classic Zod browser detector. The existing no-navigator gate observed
two references in `dist/exec.js`; define navigator as unavailable for the ACP's
Node-only build options (inherited by exec), preserving the strict gate.
The later standalone audit is repaired by pinning the existing dev-only
source-map-js leaf to 1.2.2; private script-free leaf/full-lock installs and
the unchanged audit pass. The shared worktree tooling stays at 1.2.1 under
the lane rule. Refresh an isolated development install to the committed
lock before the next full-profile run. Final complete accessibility,
SAST and localization pass; their receipts do not replace that full run.

M106 W integration follow-up (2026-10-06): the inherited partial M95 panel,
provider suggestions and portable codecs still expose numeric USD amounts.
Bind those current money ports to H's canonical `UsdAmount`, parse numeric
historical/wire amounts once at their validated boundaries, and keep numeric
price-card rates only as the existing planned M95 pricing compatibility port.
The focused money-port gate must stay unchanged.
**M96INT3D single aggregate receipt (2026-10-05).** On `79b6589c`,
`VITEST_MAX_WORKERS=3 npm run quality` exits 1 at the zero-duplication
gate: two paid-consent tests repeat the same six-line, 61-token observation
block. Formatting, JavaScript/CSS lint, all five typecheck projects,
localization, host API, knip and cycles pass first; PowerShell lint retains
its existing Windows-only policy. Share the exact test assertions, then
the affected paid-budget file passes all 17 cases and the unchanged
duplication gate reports zero clones. Coverage tests and later aggregate
gates were not reached. The twelve prescribed files separately pass 306
assertions; they are not a green coverage-profile receipt. No second full
run is authorized in this lane; the lead decides it. The default history
scan is now clean after archive refs moved outside this repository, and
the shared install now contains the pinned source-map-js 1.2.2. Windows
proof remains WINPUB on win11 for the lead's release batch.

**REL0160B release qualification deferral (2026-10-07, macmini).** The cold
ChatGPT ACP package fixture requires checkout `dist/acp.js`; hosted coverage
shards have no static-job build artifacts. Two owned-build fixes fail on the
integration inventory and provider catalog respectively. common.md's
two-failed-fixes rule stops this path; the attempted changes are removed.
Keep the existing test and all gates unchanged and report this release blocker
explicitly. The badge override repair is separately verified with CI enabled.
Independent job receipts and the cold failures are recorded in
docs/certification/rel0160.md; a sequential warm-dist run cannot certify this
dependency. No skip, timeout increase or gate exemption is added.

**M113 W integration boundaries (2026-10-06).** The rig note explicitly
requires the complete configured Vitest suite in three-file batches, overriding
common.md's normal scoped-suite rule. Aggregate `npm run quality` remains
forbidden by that shared brief; the named component gates run separately.
Public badge/audit traffic and live captures are also forbidden on this lane.
The supported package badge check uses its existing documented network-skip
reason solely for offline packaging; its local badge/template checks remain.
Coverage aggregation, installed editor/live service/platform receipts and the
hosted M80 matrix stay with the lead. No threshold, timeout, rule or size cap
is lowered or raised to replace one of these receipts.

M113 dependency handoffs remain explicit: S session activity and usage need
M84's retained activity/M102's actual aggregate; native/companion/TUI/desktop
hosts and runtime settings need M104/M110/M111; N stores, workflow/release and
posting await approved captures; Q scheduling/occurrences, vault mail, node
browser and editor/CLI creation need M115/M109/M110/M104; H check-slot records
await M96c and the runtime verify adapter, which is absent on this base.
The shipped portable bindings reject missing adapters or report unavailable
sources. The shared engine, private cache/history/check journal, manifest,
reference, lazy entries, budgets, docs and host inventory are W's scope.

M113 W keeps schema-derived comparison bounds without importing Zod's JSON
schema processors into browser first paint: the pinned, typed max-length
check definitions supply the minimum actual bound. The structural section-key
coverage and unbounded-array refusal remain; schema generation still uses
`toJSONSchema` in its lazy/script reader. The existing 733.8 KiB startup
regression and every production cap remain unchanged. CI's static job also
runs P's new `check:plan` gate, matching `quality:gates`.
