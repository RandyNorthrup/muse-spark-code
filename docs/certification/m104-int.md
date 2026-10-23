# M104INT — integration trunk

Worktree `/Users/randy/lanes/M104INT`, branch `m104/int`, macmini,
2026-10-06. Base `35ce56f8`. Model attempts and paid calls: **0**.
No push, rebase, main merge, other-worktree edits or credential-store reads.
The rig brief overrides the common legacy merge/full-quality instructions.
Hooks exist and run unchanged. No cap, threshold or rule level is weakened.

## Ordered integration

| Lane             | Merge      | Conflicts/resolution                                                                                                          | Cap receipt                         |
| ---------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| D `62ce36ad`     | `48912048` | Additive docs/real translations; preserve current crash/report UI and both guarded browser graphs; regenerate host inventory. | `temp/m104-int/build-d.log`, exit 0 |
| E `aabc1a04`     | `bc79256f` | Additive PLAN and Unreleased entries.                                                                                         | `build-e.log`, exit 0               |
| G `023e682a`     | `3377647e` | Additive PLAN; leave 1.2 proposal gated.                                                                                      | `build-g.log`, exit 0               |
| F `a50329ff`     | `5de32b37` | No conflicts.                                                                                                                 | `build-f.log`, exit 0               |
| I `37a5f363`     | `8b9d738f` | Union gate scripts, retain badge gate and add MHP/conformance gates.                                                          | `build-i.log`, exit 0               |
| Xcode `2ea599ae` | `f2efec7a` | Union native/UI translations and docs; retain current README release links.                                                   | `build-xcode.log`, exit 0           |
| H `c38ef8a5`     | `9257bd16` | Additive PLAN; retain both Xcode and shim records in m104-h.md.                                                               | `build-h.log`, exit 0               |

The LSP regions remain at this trunk's baseline; `m104/lsp` is not merged.
Released CHANGELOG bytes are verified separately before final certification.

## Integration regressions found

Eclipse's obsolete lowercase properties fixture aliases its correctly cased
replacement on macOS. Verify actual directory-entry spelling, with a distinct
obsolete file, so the same freshness behavior is exercised on all platforms.
Xcode's old `/post`/202 receipt fails against B2's frozen `/panel/message`/204
carrier. Align the native dispatch, fake bootstrap and assertions with the
shared bridge's ordered envelopes rather than reopen the retired route.

Implementation, tests, byte-exact guard drills, final cap values and the
56-feature status inventory are appended as each piece qualifies.

## Runtime and ACP integration

`runPanel` serves the exact portable build, including What's New and all
static/deferred chunks. A generated AST-based import manifest records byte
lengths, SHA-256 and exact import spans. The classic loader uses C's private
authenticated fetch closure, checks bytes/imports, maps static imports to
nonce-authorized Blob modules and fetches deferred imports only when used.
No bearer enters the renderer, module manifest, stdout or browser storage.
C's `guard.ts` and security policy are unchanged; launch installation preserves
its nonce when the shared renderer contributes another CSP meta element.
Package assets come from an exact URL map; requests never become disk paths.

The bridge uses `/panel/message`, `/panel/events`, `/panel/surface` and empty
204 admissions, opens before ready, and preserves sequence counters. The
runtime sends a schema-validated `init` with public settings before history.
Native stdio requests use existing correlated MHP HostServices. Companion
React confirm/pick/input/notify/status/progress use a distinct bearer-bound
`/host/events` / `/host/message` channel, never new frozen panel payloads.
Correlated params/results, cancellations, disconnects, bounds, late replies
and duplicate refusal are validated. Multiple active browser views refuse
ambiguous UI ownership. Paid consent is requested by the actual runtime gate;
it is never an ordinary approval or remembered panel rule.

ACP's registry publishes only a prepared `RuntimeConversation` built through
`runtimeConversationDeps` / `composeConversationDeps` and the shipped
`conversation.js` factory. Rich parts pass through controller admission.
ACP retains its event translator, permission/question view and paid prompts;
external permissions suppress the controller's automatic/reviewer/judge
choices. Mode changes synchronize the controller. Headless uses the same
factory while its tap, lifecycle and per-attempt ledger remain authoritative.
Controller disposal drains admitted settings/storage writes before release.
Unit translation fixtures isolate the ACP view; real composition and stdio
suites exercise the production factory. No new model/provider wire shape is
invented and no live/model/paid capture was attempted (count **0**).

## Feature inventory and M110a0 qualification

`P` means an integrated partial receipt; `M` means missing owning adapters or
qualification. No row is promoted to `W` on this rig. Shared registry cells
remain pending and no approved feature exception is invented. All editors
must still run the same scenario inventory against the assembled product;
fake backend and component evidence is scoped to exactly what it exercises.

Native E/G/F development implementations are retained. Their frozen 1.1
initialize direction/host metadata does not match B2's host-initiated bootstrap.
Xcode/H companion launchers also need an owning MHP parent rather than a raw
URL on stdout. This blocks assembled native qualification across this table.
The opt-in 1.2 proposals stay gated. What's New's actual entry/assets are
served and its native renderer remains present; a runtime auxiliary view,
release-note indices/actions and Tasks binding still require owning ports.
These are M110a0 prerequisites, not permission to remove those features.

| ID  | Feature                       | INT runtime/companion status and remaining work                                                                                                        |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | `streaming-chat`              | P: shared React mounts in authenticated Chrome and both fake backends stream; installed-editor conformance remains.                                    |
| F2  | `tool-rows-and-output`        | P: shared tool renderer is served; native tool/output, file/edit and streaming conformance remain.                                                     |
| F3  | `approval-cards`              | P: shared cards and ACP/native-MHP allow/deny retain exact choices; full browser/native card scenarios remain.                                         |
| F4  | `question-cards`              | P: shared question renderer and ACP translation retained; assembled editor question scenarios remain.                                                  |
| F5  | `permission-modes`            | P: controller modes synchronize with ACP; native trust/mode transitions need conformance.                                                              |
| F6  | `auto-reviewer`               | M: Unavailable extension reviewer/paid host adapters.                                                                                                  |
| F7  | `inline-diffs`                | M: Diff port explicitly refuses.                                                                                                                       |
| F8  | `hunk-review`                 | M: Edit-review ports explicitly refuse.                                                                                                                |
| F9  | `verify-loop`                 | M: Diagnostics, formatting and verify editor ports absent.                                                                                             |
| F10 | `turn-checkpoints`            | M: No runtime shadow/checkpoint store or recorder; off/restricted.                                                                                     |
| F11 | `rewind`                      | M: Checkpoint/diff restore ports unavailable.                                                                                                          |
| F12 | `history`                     | P: current auth/settings/history replay and reload counters tested; switching/active-turn crash restoration remain.                                    |
| F13 | `fork-and-side-chat`          | M: Fixed session binding rejects new/fork/switch; needs fresh registry/surface binding.                                                                |
| F14 | `slash-palette`               | P: shared slash palette now mounts; unsupported feature actions refuse and require owning ports.                                                       |
| F15 | `mentions-and-selection`      | M: Confined mentions and versioned editor writes tested; selected text/notebooks/caret incomplete.                                                     |
| F16 | `attachments`                 | P: ACP rich image/text parts use the composed controller; file dialogs and native attachment flows remain.                                             |
| F17 | `subagents-and-map`           | M: Backend-owned behavior unqualified; IDE map and extension paid subagent adapters absent.                                                            |
| F18 | `workflows`                   | M: Inherited shared/backend behavior unqualified; runtime editor/feature ports incomplete.                                                             |
| F19 | `tasks`                       | M: No Tasks view/runtime adapter.                                                                                                                      |
| F20 | `goals`                       | M: Shared/backend events unqualified end to end.                                                                                                       |
| F21 | `plan-files`                  | M: Plan port absent.                                                                                                                                   |
| F22 | `compaction-and-handoff`      | P: shared controller/backend path retained for ACP and panel; restored-turn/handoff workflows need parity receipts.                                    |
| F23 | `background-and-shell`        | M: Backend shell behavior inherited; native terminal and foreground/background task conformance absent.                                                |
| F24 | `best-of-n`                   | M: Attempt-host, budget, judge/edit admission ports explicitly refuse.                                                                                 |
| F25 | `scheduled-and-saved-prompts` | M: Saved/scheduled prompt and foreground/background ownership not qualified.                                                                           |
| F26 | `replies-and-quotes`          | P: shared replies/quotes UI is served; assembled browser/native interaction scenarios remain.                                                          |
| F27 | `rules-skills-memory-agents`  | M: Existing backend context retained; bundled skill installer, native trust changes and editor flows incomplete.                                       |
| F28 | `mcp-servers`                 | M: No IDE MCP endpoint; custom backend MCP/editor-equivalent configuration remains unqualified.                                                        |
| F29 | `hooks`                       | M: Inherited runtime/backend hooks unqualified with panel settings and native event paths.                                                             |
| F30 | `code-intelligence`           | M: No IDE code-intelligence endpoint/adapters.                                                                                                         |
| F31 | `web-fetch`                   | M: Inherited portable backend fetch unqualified in the panel.                                                                                          |
| F32 | `paid-search-and-images`      | P: native and browser priced Deny occur before fake dispatch; cross-backend images/search adapters remain.                                             |
| F33 | `browser-check`               | M: No pinned browser-check runtime/editor adapter.                                                                                                     |
| F34 | `session-import-export-share` | M: Export/import ports explicitly refuse; share integration absent.                                                                                    |
| F35 | `worktrees`                   | M: Fixed workspace/session binding; worktree and folder workflow adapters absent.                                                                      |
| F36 | `git-and-pull-requests`       | M: Git actions refuse; authorization/PR/worktree adapters absent.                                                                                      |
| F37 | `cli-install-and-login`       | M: Startup requires readiness; terminal login exists, install/sign-out and signed-out initialization incomplete.                                       |
| F38 | `account-and-usage`           | M: Sign-in method/CLI version facts only; account manager and full usage integration incomplete.                                                       |
| F39 | `paid-use-consent`            | P: browser priced per-use dialog and native-MHP Deny tested; persistence/revocation and every-editor receipts remain.                                  |
| F40 | `daily-paid-budget`           | M: Runtime interactive account/budget host adapter unavailable; no shared hard-budget parity claim.                                                    |
| F41 | `voice`                       | M: Voice/dictation port unavailable.                                                                                                                   |
| F42 | `tab-completions`             | M: No editor Tab runtime adapter in this lane; LSP owning lane untouched.                                                                              |
| F43 | `settings`                    | P: init carries validated public settings and runtime store/cache work; native settings coherence/reconfiguration remain.                              |
| F44 | `walkthrough`                 | M: No walkthrough view.                                                                                                                                |
| F45 | `whats-new`                   | P: authenticated portable What's New entry/chunks and native renderer retained; runtime view/actions remain.                                           |
| F46 | `display-languages`           | P: runtime installed language and native theme are rendered; all 14 tables match and fallback scans cover 15 languages; host locale/bootstrap remains. |
| F47 | `accessibility`               | P: D fallback/browser accessibility suite is rerun; assembled editor/theme/accessibility qualification remains.                                        |
| F48 | `logs-and-diagnostics`        | P: fixed-word logs and six correlated browser UI methods are wired; diagnostics/title/unread/reload native mapping remain.                             |
| F49 | `commands-and-keybindings`    | P: shared command UI and native registration are retained; only implemented actions work, full editor keybindings remain.                              |
| F50 | `problem-report`              | M: Existing standalone CLI report unchanged; panel journal/dialog/report adapter not integrated.                                                       |
| F51 | `models-and-providers`        | M: Fixed backend and session model list; backend/provider replacement and full model settings incomplete.                                              |
| F52 | `roles-and-traffic`           | M: No role/traffic specialized runtime views.                                                                                                          |
| F53 | `legal-scan`                  | M: No panel/editor conformance receipt for legal scan.                                                                                                 |
| F54 | `judge`                       | M: Judge/attempt-host adapters absent.                                                                                                                 |
| F55 | `paired-devices`              | M: Local companion launch pairing tested; device-pairing product absent.                                                                               |
| F56 | `remote-control`              | M: M110 remote-control broker/authorization/rendering integration still required.                                                                      |

The pending LSP supervision redesign is not merged. No LSP source/config was
changed. M80 supported/live receipts, native signing/notarization, registries,
IC/IU/PC/WS/GO/CL/RR/RD/AS and the hosted all-editor matrix remain train work.
The featureCatalog/reference tooling named in common rules is absent on this
trunk; the frozen 56-feature authority is `src/shared/hostApi/features.ts`.
No placeholder registry/tooling was created to claim that check passed.

## Platform receipts

Checks run directly on macmini in sequential bounded batches, at most
three Vitest files/workers per invocation and no aggregate quality. Xcode 26.3
build/test succeeds with ad-hoc local test signing: **37 native + 3 UI tests**.
This is the fake companion/native editing fixture, not installed Xcode/runtime
parity; Xcode 26.6/27 and supported installations remain train work.
JetBrains Node bridge/size tests: **8 passed**. Eclipse asset freshness:
**1 passed** after actual-case correction. Neovim and Qt Creator Lua fixtures
pass; Sublime **13**, Qt Creator Python **8**, Zed **8** pass.
No usable JVM, Gradle/Maven or Emacs is present on this rig. .NET 10 is present,
but the Visual Studio net48/Windows job/editor suite requires Windows.
Re-run JetBrains/Eclipse JVM builds on Kubuntu, VS 17/18 + x64/arm64 on Windows,
Emacs/shim/native installations and the declared editor-version matrices in
the 0.16.0 train. No tool/dependency was installed, no global config changed.

## Inherited protocol gate blocker

`npm run check:mhp` fails at `MHP_VERSION_LOCK` for 1.1, with computed digest
`ffe801752a24baa897efbd819fc289fe1ea6b7a21e765e18924bb5d45d49fa93`.
An isolated `git archive 35ce56f8` of the unchanged shared sources and generator,
using this rig's installed dependencies, produces the identical failure.
The current shared chat payload union has 93 requests; the frozen panel
snapshot has 84. This lane changes neither those payload schemas nor the
four snapshots/locks. It leaves the check failing and records the justified
versioning deferral in PLAN §7. The protocol owner must qualify a versioned
contract update; a lock rewrite or implicit 1.2 activation would hide the issue.
Logs: `temp/m104-int/resume-gate-mhp.log`, `mhp-baseline.log`.

Two new fixture clones initially failed the zero-duplication gate. Factoring
controller bundle preparation and companion launch acknowledgement into
reused test helpers preserves the checks without changing the threshold.
During the storage investigation, one test batch briefly overlapped a
compiler invocation. Subsequent final checks use one heavy invocation at a
time; this scheduling mistake is not a green sequential-check receipt.

## Headless contributor regression

The first final stdio batch passes the panel and ACP suites but fails five
headless rows: two contributor-model completions and three signal scenarios
waiting for a dispatch which never occurs. Shared-controller restoration was
trying the panel's contributor confirmation although ACP/headless already
requires the explicit contributor flag. ACP composition supplies that flag's
answer at the feature port. The interactive panel keeps its confirmation, and
confidential-workspace checks still apply before dispatch. The E3 diagnostic
prints only the test-owned validated result; it contains no real credential.
The initial batch had 53 passed / 5 failed. The retained red receipt is
`exec-stdio-diagnosis.log` (2 selected failures). The final complete stdio
batch has 58 passed (`resume-test-stdio.log`).

## Portable graph budget correction

The first resumed production build counts the independently compiled loader
and fails at 1152.0 / 1100 KiB. Lossless browser encoding reduces it to 1117.2
but still exceeds the unchanged cap. The loader does not read UI text; marking
only the fresh descriptor clone and canonical build-only unpack call as pure
lets esbuild discard that unused second table. The complete graph is 1007.4
KiB. The classic bootstrap is guarded separately from each ESM graph: it must
carry its manifest validator and loader, must carry no English table, and
remains among every model-text block's forbidden non-readers. All ESM graph
and reachability checks remain in place. No cap or threshold is raised.

## Final focused verification

The final owning-test matrix runs **50 files, 801 passed / 1 inherited failure**,
in 18 sequential groups of at most three files/workers, each with
`--testTimeout=120000`. No test is skipped or changed to evade the protocol
failure. The sole failure is `mhpContract`: “exports current JSON Schemas for
the native plugins”, invoking the same frozen-lock check described above.
The remaining 54 boundary/contract assertions pass. Installed-editor and
aggregate quality/coverage certification remain outside this rig brief.

| Owning group                                        | Tests passed | Result                               |
| --------------------------------------------------- | -----------: | ------------------------------------ |
| Localization                                        |           26 | pass                                 |
| Panel / ACP / exec stdio                            |           58 | pass                                 |
| Chrome companion / packaged modules / Xcode carrier |           10 | pass                                 |
| ACP engine/view/runtime (three groups)              |          239 | pass                                 |
| Headless fetch/exec and real controller composition |           92 | pass                                 |
| Panel delivery/surfaces/runtime ports               |           14 | pass                                 |
| UI correlation/responder and atomic storage         |           18 | pass                                 |
| Companion server/browser/assets (three groups)      |          117 | pass                                 |
| Bridges/fallbacks/shared page                       |           74 | pass                                 |
| Bridge state/failures and What's New                |            8 | pass                                 |
| Existing host bridge / Tasks / What's New HTML      |           17 | pass                                 |
| Webview graph and size fixtures                     |           16 | pass                                 |
| Frozen MHP boundaries                               |           54 | 1 inherited schema-generator failure |
| Distribution / release / workflow fixtures          |           58 | pass                                 |

D's full `fallbackAccessibility` file separately passes **21 tests / 2520
scans**: three bridges, four themes, fifteen languages and fourteen surfaces.
The adjoining bridge/fallback files pass in that 88-test run. Thus the owned
Vitest files contain 822 distinct passed tests and one inherited failure;
repeat green runs and mutation failures are not added to that total.
Logs/commands: `temp/m104-int/resume-tests.json` and `resume-test-*.log`,
`resume-a11y.log`. These receipts include no live backend or paid dispatch.

Fresh native receipts: `resume-native.json` / `resume-native-*.log`:
JetBrains 8 Node tests, Eclipse 1 Node test, Sublime 13 / Qt Creator 8 / Zed 8
Python tests, both Neovim/Qt Lua fixtures, and Xcode **37 native + 3 UI tests**.
Each invocation exits 0. This rig's Xcode test uses local ad-hoc signing and
fake-only companion fixtures, not release signing or full product parity.

## Deliberate guard failures

[The source-drill receipts](m104-int-drills.json) record **20 controls**,
including the three recovered pre-crash drills and the storage repair.
Each has a named behavioral failure, nonzero test exit and byte-exact source
restoration. The sixteen resumed controls cover renderer parameters/results, exact IDs
and values, cancellation/disconnects, single streams, shared admission,
cancelled-request bounds, duplicate modules, exact import spans, cycles,
unlisted imports, manifest symlinks, external ACP approvals and explicit
contributor consent. Every new test case has been observed failing under a
corresponding behavioral mutation.
The cycle mutation deadlocks the invalid import graph and fails the browser's
unchanged 30-second wait; it is reported as that timeout, not as an immediate
error assertion. Mutation logs are `resume-drill-*.log` and `drill-*.log`.
After all mutations, the restored owning files run again before commit.

The resumed size gate also fires at 1152.0 and then 1117.2 KiB before the
unused fallback is removed. The webview fixture initially includes all new
approved lazy closures in the old aggregate and fails at 157647 / 51200
bytes; a second attempt exposes 51307 / 51200 because its build options differ
from production. The final fixture uses production Unicode encoding, lossless
English encoding and short hashed names, pins all four existing group caps,
and counts all groups. No bytes, threshold or new lazy surface are ignored.

## Remaining train work

Before M110a0, the protocol owner must resolve the inherited frozen-schema
blocker and the native initialize direction/metadata ownership; all owning
native parents must bind real editor services, installed runtime launchers and
auxiliary Tasks/What's New actions. The 56 rows above identify missing runtime
feature adapters. Lane I's native integration manifests, verified Node pin,
actual all-editor conformance reports, signing/notarization, publication and
registry outcomes are not completed by merging its tooling. Distribution
fixtures validate refusal/accounting paths; they do not prove publication.
The LSP supervision redesign remains with its owning lane. Hosted Node 22,
Kubuntu/Windows builds and editor-version matrices, full integrated quality,
coverage, M80 live receipts and every-editor feature qualification remain
required. No feature exception or unsupported-editor support claim is added.

Three additional [loader split-gate drills](m104-int-gate-drills.json) mutate
only the generated metafile fixture: insert an English-table input, remove
the loader entry, and remove the manifest validator. Each produces the exact
new gate error, exits 1 and restores the original metafile bytes/hash. Together
with the source drills, **23 deliberate controls** are observed firing.

## Final static gates and bundle caps

All five compiler projects, scoped ESLint (zero warnings), Prettier write/check,
localization, host API regeneration/check, exec schema check, cycles, plain
knip, zero duplication and the production size/split/globals/notices checks
exit 0 (`resume-gates-final.json` / `resume-gate-*.log`). `check:mhp` and its
single invoking test remain failed as explicitly recorded, never skipped or
weakened. The host inventory changes only crypto 52→53, fs/promises 51→52,
path 88→90; the 349 VS Code APIs, 32 importers, 25 built-ins and 61 tokens
remain unchanged. No dependency, cap, threshold, rule level or hook changes.
Knip retains its two pre-existing configuration hints; they are not failures.

These are this earlier integration's measurements. Current portable startup
and delivery sizes and the lead-approved independent caps are recorded in
[m104.md, F4 round 2](m104.md#m104-f4-round-2--independent-portable-startup-and-total-caps-kubuntu-2026-10-09).

| Production artifact                               |    KiB | Existing cap, KiB |
| ------------------------------------------------- | -----: | ----------------: |
| Extension                                         |  458.7 |               600 |
| Model API                                         |  447.1 |               475 |
| ACP                                               |  822.0 |               850 |
| Conversation                                      |  193.7 |               250 |
| Runtime panel                                     |   83.1 |               100 |
| Runtime feature ports                             |   53.7 |                75 |
| Checkpoint store                                  |   77.1 |               225 |
| VS Code eager graph                               |  793.5 |               900 |
| Complete portable graph, including classic loader | 1007.4 |              1100 |
| Existing deferred graph                           |   49.7 |                50 |
| Code highlighting                                 |   93.1 |               125 |
| Action dialogs                                    |    9.1 |                25 |
| Tasks tab                                         |    1.3 |                25 |

Released changelog bytes match base `35ce56f8` exactly (one Unreleased section):
SHA-256 `6ec0ee1bc4a97bee7afe6edef99aedf17a20f55e046c316b80cd63e242a3160d`.
C's guard, all four frozen MHP snapshots/locks, and the LSP regions are unchanged.
No live/costed model attempts, credentials, push or rebase occurred.

Post-mutation restored runs pass **11 core + 14 UI/storage + 58 stdio tests**,
then the seven additional source drills restore and their three owning files
pass **12/12** (`resume-restored.json`, `resume-extra-restored.log`). Repeats
are not counted as additional unique tests. The ACP serve cleanup closes the
backend and journal even if a controller release reports a storage failure.

The fresh offline ACP package is inspected without starting an installed agent:
all manifest module byte lengths, SHA-256 and UTF-16 import spans match archive
bytes; required controller/carrier/loader files are present; no test/temp entry
is packaged. Receipt: `temp/m104-int/resume-package-receipt.json`. This verifies
local artifact contents, not publication, Node distribution pins or native
signing. Its ordinary production package name/version remains 0.14.1.
