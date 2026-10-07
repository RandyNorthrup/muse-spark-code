# M95INT — completed-lane integration on Kubuntu (2026-10-05)

## Round two — integration and gate repairs (2026-10-05)

The second rig brief authorizes five ordered fix-branch merges and a final
full quality run, with a 150-minute budget. All work runs in this worktree on
Kubuntu, with hooks on, explicit staging and no push/rebase/live model call.
The historical round-one receipts below remain historical, not final results.

| Lane         | Head       | Merge commit | Resolution                                                                                                                                    |
| ------------ | ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| K fixes      | `e12b86cc` | `89197f6f`   | Keep repaired host/tests and union prior PLAN/CHANGELOG records; retain early OAuth rejection assertions.                                     |
| M/U fixes    | `b64ef06f` | `12e08a23`   | One strict shared panel contract; remove host-local edit schemas; keep new translations and shared page reset; deduplicate checkbox styles.   |
| Chat fixes   | `ea6d2e9a` | `69bd715b`   | Union the codec repair and integration records.                                                                                               |
| Ollama fixes | `70e11526` | `085558ae`   | Preserve release deferrals/text guards, M95 routes and scenarios, all UI/controller tests, translated append blocks and one capture deadline. |
| S/C fixes    | `e5a114b4` | `75b42ec0`   | Preserve catalogue shipping, all panel bundles and both repair records.                                                                       |

The local S/C branch contains `a95f24cf`, **not** the brief's `928a9200`.
The latter exists locally but is not an ancestor of any named fix branch.
The explicit rig prohibition on a separate main merge requires clarification
before adding that release. The universal macOS helper is also absent; an
approved local path or permission to extract it from a released VSIX is
requested. Neither elapsed time nor an unanswered question is approval.

The existing localization gate passes (14 UI tables and 127 manifest
strings). A separate strict JSON object-pair check of all 29 UI/manifest
tables confirms zero duplicate keys; no exemptions are added.

Integration corrections:

- The host parses only `shared/modelsPanel.ts`, including M's strict edit,
  scoped prefill and cancellation variants. No duplicate temporary schemas.
- Captured Chat and Ollama codecs join the separate providers entry. The
  existing required/excluded membership guard covers all five codecs.
- The new release tooltip field is supplied on both BYO picker footer rows.
  All five TypeScript projects pass after this merge correction.
- The Z.ai preset selects a fixed literal pattern; no configurable RegExp
  source is compiled. OAuth callbacks return localized **text/plain**, so
  callback text is never interpreted as markup and needs no HTML escaping.
  The two repaired files have zero SAST findings/errors with the full auto
  rules. Reinstating the old sources reproduces all four blocking findings.
- M/U's selected-description rule inherits the active selection foreground,
  resolving the exact dark-theme 4.41:1 contrast. Persistent browser workers
  and focus emulation preserve the release driver; M95 bundle routing and
  one 120-second capture budget remain. Harness conflict repair closes the
  Models fake-host handler and retains one readiness dispatch for chat,
  task and Models surfaces. Every inline script passes Node syntax checking.
  Both failing scenarios pass: eight pages, zero violations/undecided/missing.

The full scanner subsequently found a fifth, in Chat's native reasoning
fragment `Object.assign`. Replace target mutation with a data-property copy,
retaining future fields and concatenated text. The captured-fragment replay
regression remains the behavior check. The final serial full scan returns 0:
**287 rules, 947 targets, zero findings, no timeout warnings**. The default
nine-worker scan timed out the Express SSRF rule on two large TypeScript
files. A one-worker scan of those files completes all rules at the unchanged
five-second rule deadline; the complete one-worker scan then does likewise.
Only concurrency changes; no rule, target, ignore, suppression or timeout.

The complete unit sweep also exposes release-tooltip text appended to the
M95 row text assertions and a stylesheet test treating the new `@import`
as part of `:root`. Keep tooltip behavior, update the expected accessible
help text, and make the test's rule reader ignore CSS imports. No product
style, selector or assertion is weakened.

The full static pass confirms all five TypeScript projects, localization,
host API, knip, dpdm and audit. Formatting caught two merged lines and
lint caught only six temporary harness syntax files outside TypeScript
projects; normalize the lines and rename the temporary inputs as text,
with no new ignore. Duplication found two clones. Share only the identical
non-secret routing schema outside provider core, and build the schema-test
empty state through its existing fixture. All three owning files pass
43/43, and the unchanged duplication gate finds zero clones.

Seven deliberate drills returned 1, restored bytes in `finally` and compared
SHA-256; exact hashes are in `m95-int2-drills.json`. The Chat drill restores the original assignment and reproduces the fifth
finding. The contrast drill
reproduces the exact 4.41:1 failure. The readiness drill produces four named
missing-nav failures. The existing membership tests themselves inject/remove
metafile membership and compare restored hashes. Focused merged tests also
pass: K host 23, M schema/components/app 33, panel/Palette 41, Chat 74,
Ollama/App/controller 707, and threats/catalogue/redactor 278. These are
scoped receipts. The complete 406-file sweep in 141 sequential batches
returns 8,068 passed, three failed and 56 existing live/platform skips. All
three failures are the tooltip/import mismatches described above. The three
corrected whole files (including Chat) then pass 98/98, so every offline test
has passed. Final complete quality and package results follow later.

The first complete current build (before further deferral) also confirms
Providers at 115.7/125 KiB; Models host is 94.5/75 and chat 905.0/900.
The brief permits further deferral. Adopt the release's shared Node mini-parser
pattern independently of a main merge, with only the API members current Node
sources read. Extract the existing authored `setupComplete` shape once and
reuse it in both the chat parser and panel publisher, removing unrelated chat
and agent schema initialization from the panel. Account & usage loads through
an optional ESM chunk with a focused, dismissible loading modal. Late import
completion cannot reopen a closed dialog. Models and chat keep separate ESM entries with shared browser libraries;
each webview has its own module and installed-language state.

All static startup chunks count toward chat's unchanged 900-KiB cap. Require
reachable deferred chunks, reject stale/unlisted outputs, enforce a 25-KiB
optional-dialog cap (12.6 KiB measured + 15%, rounded to 25), and ship them
through the allowlist. Node parser is initially 39.5 KiB with a 50-KiB cap by
the same D6 rule; remove six unused API exports. Every existing cap stays fixed.
ACP production and fake-only packages include the shared parser. Regenerated
notices change only their bundle header; all 84 package notices stay intact.
Host API regeneration remains 283 APIs/23 import files/23 built-ins/57 variables,
zero problems.

The original module-tag HTML assertion fires before correction. App and panel
owning files pass 156 assertions; the corrected HTML, bundle and pending-dialog
files pass 37/37. Six more deliberate drills (13 total this round) restore exact
bytes: disabling the three new split checks fails their three new tests;
changing loading text and disabling Escape fails both pending-dialog tests;
removing `safeParse` fails API completeness; parser and optional-dialog cap + 1
fail their budgets; adding `navigator` fails the new Node member's global guard.
The subsequent production build passes every size, split, global and notices
check. The complete browser gate passes all **668 pages (167 scenarios × four
themes)**: zero violations, zero undecided rules, zero missing results. Eight
existing obscured-menu/listbox exemptions remain separately reported; no
exemption changes. Final full-quality receipts follow below.

The raw helper-free VSIX initially weighs 2,336,691 bytes (83,891 over).
The packaging stage keeps only the VSCE allowlist, compacts translation and
manifest JSON without changing values, and ships a concise truthful landing
guide plus two recent changelog releases with links to full docs. Source docs
and tables stay complete. The staged strict localization check compares all
29 JSON documents against source and runs the same schema checks. Sixteen
fake-only package tests cover exclusion, helper/runtime/chunk membership,
source hash equality, docs and stage ownership. Deliberately allowing excluded
files, disabling compaction and allowing an unowned stage makes those checks
fail. Corrupting one staged German value fails the staged localization gate;
all three packaging drills restore bytes exactly (16 drills total this round).

The first stage is 2,166,671 bytes. Sharing chat/Models browser libraries cuts
that to **2,050,278 bytes**, with each entry's static chunk sum counted under
its original cap. The two roots are both visited in reachability; stale
separate-build metadata is removed. All three owning files pass 44/44.
`npm run package` exits 0 with exact staged localization checks. The real
universal helper remains absent, so this is a **helper-free diagnostic package**,
not the requested universal-package receipt. Its 202,522-byte headroom exceeds
the released helper's recorded 119,342-byte compressed contribution; that
arithmetic is conditional and does not certify an absent binary. Final full
quality and remaining prerequisite status are recorded below.

The single final full-quality invocation runs on `b4ffa572`, with three
workers and all live flags off. Format, full lint, all five type projects,
localization, host API, deadcode, cycles and duplication pass. Unit execution
then returns 1: **399 files pass, five fail and four skip; 8,059 tests pass,
27 fail and 63 skip**. One of those failed files fails its setup, leaving six
tests unrun. The real build's required parser is absent from two fake package
fixtures; four panel/sidebar assertions expect the old non-module tag, and
one handoff assertion expects the newly deferred usage surface synchronously.
These are missed fixture updates, not product failures or successful drills.

Both fixtures now supply `validation.js` (the launcher fixture builds the real
entry); panel/sidebar assertions require module plus nonce, and the handoff
test waits for the real dialog before checking focus, exclusivity and close.
All five complete files pass **73/73**, in two runs of at most three files.
Together with the full sweep this is **8,092 unique tests passed and 57 existing
live/platform skips**. V8 produces no coverage report after the failed suite.
The original full wrapper remains **exit 1**, and is not repeated under the
brief's single-full-run limit. Its remaining gates run separately below;
a new complete wrapper/coverage receipt belongs to the lead after the two
prerequisites are resolved. No assertions, thresholds or deadlines are removed.

### Final round-two receipts

The tested code/package head is `e9c3d21d`; the final receipt commit changes
only PLAN and this certification record. The remaining sequence is run directly:

```text
node_modules/.bin/run-s build security:audit test:a11y security:secrets security:sast
exit 0
```

| Check                         | Final result                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Format and full lint          | 0; unchanged Windows-only PowerShell check skips on Linux                                                            |
| Types                         | All five projects 0; unit/e2e repeated after fixture repairs, 0                                                      |
| Localization                  | 14 tables, 127 manifest strings, 491 source files, 0 problems; duplicate-key check 0                                 |
| Packaged localization         | 29 exact JSON tables plus manifest equal source values; strict staged check 0                                        |
| Host API                      | 283 APIs, 23 VS Code import files, 23 built-ins, 57 theme variables; 0 problems                                      |
| Deadcode, cycles, duplication | 0; duplication repeated after fixture edits, zero clones                                                             |
| Offline unit/e2e behavior     | 8,092 unique tests pass across the full sweep and repaired whole-file reruns; 57 existing live/platform skips        |
| Coverage and full wrapper     | Unverified coverage; the one authorized full wrapper exits 1 before its remaining gates                              |
| Build                         | 0; all size, split, Node-global and 84-package notice checks pass                                                    |
| Audit                         | 0; existing exception and low-severity note unchanged                                                                |
| Accessibility                 | 668 pages, 167 scenarios × four themes; zero violated/undecided rules or missing results; eight unchanged exemptions |
| Full-history secrets          | 1,487 commits / 369.62 MB, 0 leaks                                                                                   |
| Full serial SAST              | 287 rules / 954 tracked targets, 0 findings, no timeout warnings                                                     |
| Packaging                     | 0; helper-free diagnostic VSIX only                                                                                  |
| Deliberate drills             | All 16 exit 1 and restore byte-exact; `m95-int2-drills.json`                                                         |

Exact final artifact bytes (browser startup counts every static JS chunk,
once per entry; the shared chunks also count in the Models cap):

| Artifact                    |         Bytes | Fixed cap (bytes) |
| --------------------------- | ------------: | ----------------: |
| Activation                  |       566,392 |           614,400 |
| Model API                   |       423,269 |           486,400 |
| English fallback            |       123,893 |           128,000 |
| Shared Node validation      |        38,645 |            51,200 |
| Providers                   |        97,961 |           128,000 |
| Models host                 |        52,215 |            76,800 |
| Models browser startup      |       449,227 |           486,400 |
| Chat browser startup        |       918,418 |           921,600 |
| Deferred Account & usage    |        12,878 |            25,600 |
| ACP                         |       817,931 |           870,400 |
| Helper-free diagnostic VSIX |     2,050,323 |         2,252,800 |
| Universal-helper VSIX       | Not available |         2,252,800 |

`npm run package` returns 0 on the final code/manifest/changelog state.
Independent archive inspection confirms all six emitted browser JS outputs,
the shared parser, Providers, Models host and catalogue, plus exact source
values for all 29 tables and the manifest. The real universal helper is absent.
The diagnostic archive is `muse-spark-code-0.12.1.vsix`, ignored and not published.
The final docs-only receipt does not change any packaged file.

The full-quality tail is retained literally; the successful 73-test repair
runs and separately successful remaining gates do not replace this failure:

```text
 Test Files  5 failed | 399 passed | 4 skipped (408)
      Tests  27 failed | 8059 passed | 63 skipped (8149)
   Start at  11:33:21
   Duration  243.43s (tests 71%, import 9%, setup 9%, environment 6%, transform 3%, worker 2%)

    Isolate  408 workers spawned · ~228ms startup each (spawn + environment, per file)
             at least ~30.78s faster with isolate: false — reuses workers across files instead of one per file

ERROR: "test:unit" exited with 1.
ERROR: "quality:gates" exited with 1.
```

The separately completed scanner tail is:

```text
Findings: 0 (0 blocking)
Rules run: 287
Targets scanned: 954
Ran 287 rules on 954 files: 0 findings.
```

Local logs and detailed test results live in ignored `temp/m95-int2/`:
`quality-final.log`, `quality-fixtures-{1,2}.log`, `quality-remaining.log`,
`package-final.log`, `duplication-final.log` and `artifact-sizes-final.json`.
All five fix branches were merged in the requested order with `--no-ff`.
No T/X/I/W implementation, separate main merge, push, rebase, live/paid
model attempt, credential read, dependency addition or gate weakening.

**Completion remains open.** At the final recheck, `m95/scfix` is still
`e5a114b4`, without `928a9200`; version remains 0.12.1. The explicit rig
rule forbids a separate main merge, and the common rule forbids downloading
the absent real helper without authorization. Both questions remain pending
in PLAN §3. A 0.13.0 merged-baseline receipt, an actual universal-helper VSIX
receipt and a fresh complete quality/coverage receipt are not claimed.

## Round one — historical integration receipts

This branch starts at `1ca53611` and integrates only the eight lanes named
in `/home/randy/lanes/_ctx/M95INT.rig.md`, following that brief and
`codex/common.md`. The rig brief explicitly authorizes these merges and the
final full quality run, overriding the common lane's old main-merge and
no-full-quality instructions. No push, main merge, rebase, live/paid model
call, credential read or new dependency. This is an intermediate integration
branch; it does not certify M95 for release.

## Ordered merge commits

| Lane       | Merged head | Merge commit | Resolution                                                                                                              |
| ---------- | ----------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `m95/0`    | `ad916bbc`  | `48adf368`   | Clean; original translated strings retained.                                                                            |
| `m95/pfix` | `a0d95109`  | `fa310193`   | Union English and fourteen translated append blocks.                                                                    |
| `m95/gfix` | `e2769440`  | `55827c4d`   | Preserve both PLAN and CHANGELOG repair records.                                                                        |
| `m95/afix` | `599e7707`  | `a45a1b16`   | Union translations and both repair/release-prerequisite records.                                                        |
| `m95/r`    | `f45f6b9c`  | `16eaebc9`   | Clean.                                                                                                                  |
| `m95/k`    | `c6ddc6f3`  | `0708c91d`   | Preserve changelog and escape reasons; one shared scan-age constant; attach rejection assertions before real callbacks. |
| `m95/m`    | `48a0074d`  | `6ced07c1`   | Union translations; translate five rejected labels; use P's numeric Ollama choices with Intl formatting.                |
| `m95/u`    | `9197d82a`  | `6f721c73`   | Preserve both Added entries alongside all Fixed entries.                                                                |

Every merge is `--no-ff`. Conflict commits use explicit staging and the
unchanged lint-staged/gitleaks hooks. Each lane's certification record was
read before merging. After strings were combined, the full localization
script caught five M labels: German vision/reasoning, French vision/docs,
and Italian provider; real translations fixed them, with no new exemption.

## Integration fixes

- `providersEntry.ts` exports the actual captured Responses, Anthropic and
  Gemini codecs and provider core. It also exports the installed-language
  setter: Node bundles share `uiText.js`, with independent language state.
  The new `dist/providers.js` is built in production, development and watch
  modes and listed in knip/dpdm/package membership. It supplies no fake
  registry, network adapter or panel seam; lane I composes those after T.
- The split guard requires every on-disk codec in `providers.js`, and
  rejects any codec or provider-core module in every other emitted JS
  output, including activation, ACP, Model API, panel host and future
  outputs/codecs. Tests inject forbidden and missing membership and verify
  their restored metafiles' SHA-256.
- Explicit browser entry names emit `dist/webview/models.js` and
  `models.css`. The initial combined build emitted the nested
  `models/models.js` instead and failed its own size report. The panel now
  loads its own CSS instead of the chat stylesheet; its test pins the path.
- New budgets follow D6/D74's measured + 15%, rounded up to 25 KiB:
  providers 125 KiB, panel host 75 KiB, panel browser 475 KiB. Every existing
  cap remains unchanged; activation stays under the hard 600 KiB cap.
  Both new Node bundles join the existing host-global guard.
- `FIXM95P-HOST-API` is closed: regenerate with the existing `--write`
  script and review the four Node import-count changes plus the panel's
  CSS source. The check reports zero problems. Notices regenerated with
  the existing script; all 83 package notices remain byte-unchanged.
- Full duplication checking found repeated picker list markup and two
  restart/removal fixtures. One list keeps the same model/action behavior;
  parameterized restart cases keep both auth modes and now verify secret
  deletion and removal cleanup in both. Owning tests pass and the unchanged
  zero-clone threshold passes.
- Lane 0's three throw-only command stubs are gone: lane K supplies real
  lazy handlers for `startWithOwnModel`, `modelsAndAgents` and
  `addModelProvider`. No manifest command lacked a landed handler, so none
  was removed. Runtime composition still waits on the named lanes below.
- The complete sweep exposed lane 0's `suggestedProvider` default missing
  from `readSettings`. Its host-only type, string schema and read now match
  the landed manifest/default. The existing default equality test failed
  before the fix; configured-value and host-only snapshot assertions pass
  after it. No provider suggestion or final runtime wiring is added.

## Meta byte invariants

The client, ModelApiHost, instructions, ObservationPack and SSE source are
byte-unchanged against main `1e93c67c`. Five synthetic canonical scenarios
are serialized through that revision's real `ModelApiClient`, bundled from
an archived source tree inside the ignored local workspace. Fetch is
injected and records the raw body; it answers only offline `[DONE]`.
The checked-in expectations come from that baseline client, never from the
current client under test. No provider is configured and no network request
or model attempt occurs. The existing M75 eval wire tests also pass.

| Scenario                               | Exact UTF-8 body bytes |
| -------------------------------------- | ---------------------: |
| First turn                             |                    619 |
| Three-step tool loop with reasoning    |                   1639 |
| User image                             |                    832 |
| Real sticky ObservationPack projection |                   1983 |
| Meta compaction with empty tools       |                   1762 |

`metaRequestGoldens.test.ts` compares each raw string with a checked-in
`.request.txt` without parsing or normalizing it. The helper uses the actual
packing thresholds and compaction prompt; these are synthetic regression
inputs, not new live wire captures. Transport lane T may add its broader
host-level goldens without discarding these client-byte regressions.

## Deliberate failure drills

Every named file ran in full with `--maxWorkers=3 --testTimeout=120000`,
without filtering. Each mutation returned exit 1, then original bytes were
restored in `finally` and SHA-256 compared. A pristine combined rerun of
bundle, panel and Meta goldens passed 33/33.

| Mutation                                | Observed failure                                                               | Restored source SHA-256                                            |
| --------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Remove required codec membership        | Three missing Anthropic/Gemini/Responses cases in `deferredBundles` fail.      | `4218e41a225fcd5e2ed0ec0976194a6f54fe2578d2f5e4a2f2976a0846f94e2a` |
| Remove provider-core exclusion          | Injected core in Models panel output is accepted incorrectly; test fails.      | Same split-script hash.                                            |
| Remove codec exclusion                  | Six injected codec cases in activation, Model API, ACP and future output fail. | Same split-script hash.                                            |
| Load `main.css` instead of `models.css` | Panel CSP/bundle-path assertion fails.                                         | `ec5d43dfb9b67510551fd30863b9ec6335f473dfe836d522bd9fbde075129f90` |
| Add a request timestamp field           | All five Meta exact-byte scenarios fail.                                       | `ce5f5a1bd40b09e1adf3e91a857391a3dbf0ad1a82b338769bc880b90bf8e0bc` |

Integration failures seen before correction: duplicate scan/context
constants fail transforms; late rejection expectations produce three
unhandled errors despite 21 passing assertions; untranslated labels fail
localization; wrong browser output paths fail production build; duplicate
markup/fixtures fail jscpd. Each unchanged gate passes after the correction.

The new artifact memberships also fired their existing guards. Each new
bundle was independently replaced with exactly cap + 1 byte; the size
check returned 1 and named that artifact. Appending `void navigator` to
each new Node bundle independently made the host-global check return 1.
Both checks returned 0 after restoration. SHA-256 receipts:

| Artifact            | Size cap (KiB) | Restored artifact SHA-256                                          |
| ------------------- | -------------: | ------------------------------------------------------------------ |
| `providers.js`      |            125 | `cdbf684a91e58a809b586f653b00ae941c3bb03bb12a19ce3dc1137552a696de` |
| `modelsPanel.js`    |             75 | `9cf6d098809a5ed04c3bde88a308193663ad75f195bd3c80e49b4e75fe9ead29` |
| `webview/models.js` |            475 | `229311afa18bf64e869fccaecb6c385ce0b4c21c68cedb1982598ace08a8e189` |

These artifact hashes precede the final production rebuild. There are twelve
deliberate mutations in total: five source/test guards, five artifacts and
the real-browser driver and deadline drills below.

## Complete offline test sweep

All 382 unit/e2e files ran, unfiltered, in 128 sequential batches of at
most three files with `--maxWorkers=3 --testTimeout=120000`. The first
sweep returned 7,375 passed, one failed and 56 existing live/platform
skips. The sole failure was the missing settings read above; its whole
three-file batch then passed 22 tests with two existing skips. No skips,
timeouts, thresholds, filters or gate levels were changed. Every test
file has passed after correction. The full quality run supplies the
final coverage and whole-suite receipt below.

## Final quality and production receipts

The initial full-quality invocation stopped at formatting in three inherited
lane files: `m95-m.md`, the harness HTML and `helpers/fakes.ts`. Prettier
changed only layout, then the final complete chain ran with
`MUSE_LIVE_E2E=0 MUSE_LIVE_MODEL_API=0 MUSE_LIVE_REVIEWER=0 VITEST_MAX_WORKERS=3`.
The explicit full-quality requirement in the rig brief permits this whole
coverage run after the separate three-file sweep; worker concurrency stays
bounded. No configuration, threshold, rule, exemption or timeout was weakened.

The next invocation passed `quality:gates` but its Chrome 150 CLI sweep
advanced only six pages per 120-second capture deadline. It was interrupted
in its first theme rather than consuming the rest of the timebox. A blank
page works, the harness HTTP response is 200, and two separate CLI flag
probes still produced no capture output after 30 seconds. That path stopped.
The existing Playwright driver returned the same page's real axe result in
5.624 seconds with zero violations. The gate now uses that driver for all
pages. CLI's actual standard viewport was measured as 690×673 with a data
page; that size is preserved, along with the narrow check's 320×760. All
137 scenarios, four themes, axe rules, exemptions and 120-second deadlines
remain unchanged. No new browser dependency or machine setting.
Launch, navigation, axe readiness and result reading share one 120-second
capture budget, so the replacement does not restart that deadline between
operations. The script-only tightening receives fresh scoped lint and
format checks after the full chain; the full browser gate loads it.

Driver drill: append an actual empty button to the real harness and run the
`empty` scenario in all four themes through the existing scenario argument.
The gate returns 1: `button-name` violates on all four elements, with zero
pages without a result. Restore original HTML in `finally`, SHA-256
`b9d1d2d3dcc951dd611eb25b80e703e4f77eb56e05402cc2a39d67068a95baf3`.
The complete full-quality invocation includes the entire 548-page browser gate.
It returns 1: 3 rules violated on 1,069 elements, color contrast undecided
on 869 elements and four pages without a result. Those failures share
panel-level causes: missing themed body background; control inheritance
overriding button colors; an unmatched heading term in the usage definition
list; narrow checkbox targets; and U's `models-byo` chat scenario routed
to M's panel. Each was repaired in its owning source or harness route,
without changing any rule or exemption. The error and warning text now
uses the theme's readable failure-text token with its error fallback.

The three affected whole unit files pass 26/26 after those repairs,
including all five Meta byte goldens. Production build and all caps pass.
The final full 548-page browser rerun and scoped static/security checks
provide the final source receipt. **There is no final zero exit from the
complete `npm run quality` wrapper after the last repairs:** repeating all
its already-passing stages exceeds this lane's 120-minute deadline.
PLAN §7 explicitly records that whole-chain receipt deferral for the lead;
release acceptance remains pending. This is not a rule or gate waiver.

Deadline drill: change only the helper's 120,000 ms constant to 1 ms.
The gate returns 1 with all four theme pages missing results, rather than
an empty success. Restore the helper byte-exact in `finally`, SHA-256
`ff07680cb970c15fc40fedd80e4626655c994a0df6c32deeef1b3a7d09db7b6b`.

| Check                                                   | Result                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Whole-repository formatting                             | 0                                                                                         |
| JavaScript / CSS lint                                   | 0; PowerShell lint has its existing Linux skip                                            |
| Five TypeScript projects                                | 0                                                                                         |
| Localization                                            | 14 tables, 126 manifest strings, 469 source files, 0 problems                             |
| Host API                                                | 276 APIs, 22 adapters, 23 Node built-ins, 59 theme variables, 0 problems                  |
| Plain knip                                              | 0; existing `vendor/**` configuration hint only                                           |
| dpdm cycles                                             | 0 circular dependencies                                                                   |
| Duplication                                             | 917 files, 0 clones                                                                       |
| Full coverage suite                                     | 378 files passed, 4 existing skipped files; 7,376 tests passed, 56 existing skipped tests |
| Coverage                                                | Statements 93.78%, branches 89.22%, functions 94.67%, lines 93.93%                        |
| Production build / all size caps / split / host globals | 0                                                                                         |
| Third-party notices                                     | 0; 83 packages, generated notice unchanged                                                |
| Dependency audit                                        | 0; two advisories under the unchanged policy, including one existing exception            |

Production artifact sizes below come from the final quality build's actual
files, not estimates. Activation has 3,797 bytes remaining under its fixed
614,400-byte cap. All twenty budgets pass.

| Artifact                   |  Bytes | Cap (KiB) |
| -------------------------- | -----: | --------: |
| `dist/extension.js`        | 610603 |       600 |
| `dist/modelApi.js`         | 441189 |       475 |
| `dist/providers.js`        |  95188 |       125 |
| `dist/modelsPanel.js`      |  51320 |        75 |
| `dist/webview/models.js`   | 414462 |       475 |
| `dist/review.js`           |  44316 |        50 |
| `dist/sessionBoard.js`     |  63649 |        75 |
| `dist/reviewer.js`         |  56022 |        75 |
| `dist/planMarkdown.js`     | 142363 |       150 |
| `dist/checkpointStore.js`  | 139058 |       225 |
| `dist/agentImport.js`      | 118549 |       125 |
| `dist/bundledSkills.js`    |  23550 |        50 |
| `dist/codeIntel.js`        |  78879 |       100 |
| `dist/voice.js`            |  35646 |        50 |
| `dist/museCodeReviewer.js` |  43874 |        75 |
| `dist/uiText.js`           | 117765 |       125 |
| `dist/searchWorker.js`     |  18571 |        50 |
| `dist/pageWorker.js`       | 208040 |       300 |
| `dist/webview/main.js`     | 897045 |       900 |
| `dist/acp.js`              | 821796 |       850 |

## Deferred to the named lanes

SAST receipt: **exit 1**, four blocking findings on the merged P/K code:
dynamic `RegExp` at `src/core/providers/presets.ts:53` and three manual
`replaceAll` HTML-escape reports at `src/host/providers/oauthLoopback.ts:32`.
The scan reports 287 rules across 859 tracked targets and timeout warnings
on six files; it predates staging the new integration files. S owns those
security surfaces and must obtain a complete clean scan after repair/review.
No suppression, exception, gate level, timeout or dependency was changed.
The secret scanner returns 0. These findings do not establish exploitability;
they remain blocking gate results, not accepted release risks.

Final browser receipt: **exit 1**, all 548 pages attempted, one contrast
violation, zero undecided contrasts, 44 unchanged exemptions and one page
without a successful result. The remaining violation is the selected
description in `dark/models-pick`: 4.41:1 against the required 4.5:1.
`hc-light/models-table` reports the harness's existing "never rendered"
readiness error. This resolves 1,068 initially violated elements and all
869 undecided contrasts, but does not pass the gate. No rule, exemption or
timeout changes hide the remainder. Further repair stops under the common
brief's two-fix rule and the 120-minute timebox. M/W and the lead must close
both outcomes and rerun the full quality chain before release acceptance.
The full wrapper's final exit remains 1; the whole-chain receipt is deferred
in PLAN §7. The integration commit is for review, not certification of release.

H fixes, O fixes, C, T, S and X are still being finished elsewhere, then I
and W integrate them. This branch does not implement their scope. In
particular, K's `ModelsPanelSeam` and local payload bridge must be composed
with P/T and reconciled with M's strict `modelsPanel/*` state/message
contract, including draft credentials held only by the host. Until that
composition lands, the exported codec bundle does not satisfy K's nine
seam members, so its loader refuses with the existing localized
unavailable error. The final panel/quick-pick and first-run acceptance are
not claimed complete here. No fake implementation is added to make them
appear to work. Final wiring must also update installed-package/CI member
checks and catalogue data shipping.

The inherited Gemini tool-result image refusal, Anthropic upstream SSE
buffer bounds and preserved-thinking/rolling-marker live receipts remain
as documented in G/A and PLAN §9. Bundling the codecs does not dispatch
them: these prerequisites must close before provider transport is wired
and released. A complete M95 live/platform acceptance remains the lead's
work. Zero new model attempts, zero spending.
