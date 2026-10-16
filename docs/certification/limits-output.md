# LIMITSB — recovery paths (acceptance incomplete)

**RVLIMITSB status, 2026-10-14: NOT CERTIFIED / not mergeable.** The Linux
receipts below are historical lane claims, not review-tree results. Superseding
review receipts are at the end. The packed stand-in test has been deleted;
claims below that call it proof are withdrawn, not current guarantees.
A10's fallback is real legacy enforcement, not documented absence: its
`imageConfirmed`/`documentConfirmed` booleans have no production readers and
are not written into a capability record. The request builder passes no
resolved record to `MediaBudget.fit`; model-id-only helpers cannot read a
configured provider's record. Honest evidence is `unknown` per missing field,
with any temporarily enforced local policy separately named and sourced.
Meta's preset also builds sizes from constants; equality tests alone do not
establish documentary provenance. No provider limits were newly captured.

Other unaccepted claims: every continuation still consumes one of 50 rounds;
tool repeat guards do not inspect text-only continuations; a zero interactive
session budget is uncapped; retained outputs are in-memory only; 128 MiB is an
invented range-edit refusal; HTML conversion discards text past 100,000;
verify overflow file names are chosen before the diagnostic sort. These need
follow-up implementation and real-life evidence, not broader certification.

Linux rig `linuxlt`, worktree `/home/randy/lanes/LIMITSB`, branch
`fix/limits-output` from `origin/main 898a26c5e` (0.18.2), 2026-10-14/15.
Direct runs only (`npx vitest run <files> --maxWorkers=3`); repo-default
timeouts; no sub-agents; scratch under `$TMPDIR`. No paid or live model
calls. The provider side is NOT a recorded real exchange: it is the
hand-written scripted stand-in `test/unit/helpers/fakeModelApi.ts` (a
`fetch` answering from a script of replies in the documented SSE framing)
plus a test-owned keyring hook. The owner's testing rule of 2026-10-12
allows only a loopback server replaying a recorded real exchange, so this
proof is owed a conversion before it counts as a claim's proof (lead,
2026-10-14 8:55 PM PT; the branch's review decides how).

Owner (2026-10-14): invented limits bind only if other harnesses do the same.
Out of scope: B2 compaction timing (M101), LIMITSA money/stopping, LIMITSC
silent drops. PLAN D114 records the decision and names the harness
comparison (the lead's 73-row, five-harness audit).

## What each ruling does

- **B1 long answers** (`src/core/backends/modelapi/modelPolicy.ts`,
  `ModelApiHost.ts`, `src/runtime/exec/sessionTap.ts`, `runExec.ts`):
  the request's output allowance is the selected model's own maximum from
  its capability record (`outputCapForRequest`: explicit override, else the
  record maximum, else the legacy cap while the record has none). A reply
  stopped on max tokens continues automatically until the model finishes
  (`shouldContinueOutput`, unbounded by count; round, repeat and loop guards
  still apply); each continuation is announced (`modelApiContinuing`), and a
  provider refusal after partial output is said in words
  (`modelApiContinuationRefused`). Two presentation defects found by the
  packed proof are fixed: an incomplete segment stayed withheld in headless
  output forever (the tap judged each message by its own response's
  terminal), and per-response drains froze that verdict (withheld messages
  now wait for the final drain). Failures, aborts and uncontinued responses
  still withhold.
- **B5 search/list/read** (`tools.ts`): `search`/`list_files` take `offset`;
  every clipped page names its range and the next offset
  (`[matches a-b of N; call search again with offset N]`,
  `[files a-b of N; call list_files again with offset N]`); at search's own
  hit/timeout total the total is a floor and the note redirects to a
  narrower pattern/glob. `clipWithNote` reserves marker plus note so the
  note survives clipping; `read_file`'s range note survives too. Past-end
  offsets fail naming the valid range.
- **B6 diagnostics** (`src/core/diagnostics.ts`,
  `src/core/verify/diagnosticsReport.ts`): entries page by offset worst
  first; every page names the next offset; past-end throws `RangeError`
  with the valid range. The verify report names the files holding unshown
  entries (5 via `VERIFY_UNSHOWN_FILES_NAMED`), readable via
  `getDiagnostics`.
- **B7 web pages** (`src/core/web/webFetch.ts`, `webFetchDefinition.ts`):
  `web_fetch`/`mcp__ide__webFetch` take `offset`; `pageText` windows the
  converted text (`Showing characters start–end of total{+}; fetch <url>
again with offset <next>`; `+` while the converter itself truncated; no
  note on the final window; past-end names the valid range).
- **B3 retained output** (`observationPack.ts`, `tools.ts`): every session
  retains full observations (`retain`/`has`/`size`, ids `retained-N` that
  never match replay calls); shell/vault/MCP/IDE/browser/verify clips are
  kept whole and paged back via `recall_output` (`retainNote`,
  `retainedHead`); recall is offered while packing or anything is retained.
- **A9 files over 10 MiB** (`tools.ts`, `src/host/backend/toolIo.ts`):
  `read_file`/`edit_file` take `byteOffset`/`byteLength`
  (`TOOL_FILE_RANGE_MAX_BYTES` 1 MiB windows, 128 MiB edit cap);
  whole-read/edit refusals name the range path; range edits match inside
  the window with host-side splice, fingerprint and no format-on-window.
  Partial UTF-8 edges decode out; BOM/NUL/invalid refuse like whole reads.
- **A10 attachments** (`modelPolicy.ts`, `mediaBudget.ts`,
  `src/core/media/replayMedia.ts`, `ModelApiHost.ts`, `src/acp/translate.ts`,
  `agent.ts`): per-request image/document size and count limits resolve from
  the capability record (`attachmentLimitsForRecord` /
  `attachmentLimitsForModel`): Meta models read their record's documented
  values (confirmed); other references keep today's enforcement values,
  reported unconfirmed. Wired through budget fit, admission checks, replay
  and the ACP prompt path. The composer staging store and the host
  capability projection keep the same constants with pin comments: neither
  surface may bundle the backend-only policy module (D6 split); the pin
  test holds them equal to the record. The reader lives in `modelPolicy.ts`
  (not `capabilityRecord.ts`) so the request path does not bundle the
  record's zod machinery: modelApi.js 525.4 → 519.9 KiB, headless.js
  101.1 → 97.9 KiB (budgets 525/100).

## Packed-product proof (`test/e2e/limitsOutput.e2e.test.ts`)

`node scripts/build.mjs --production`, then packed `dist/acp.js exec` on
the Model API backend (test-owned key via `--key-stdin`, `--max-budget-usd
1.00`, `--max-requests 40`) against a preloaded stand-in provider:
fakeModelApi's replayed exchange over a test-owned fetch plus test-owned
keyring hook, every request body on disk, all assertions parsed with zod
(the report, bodies and tool outputs; a malformed report fails the test).
No network, no paid calls. 3/3 green (repo-default timeouts; per-test
120 s named reasons):

- (a) scripted `PART-ONE ` + `incomplete: max_output_tokens`, then
  `PART-TWO`: exit 0, status completed, 2 `POST /responses`, the second
  carrying `PART-ONE`; both windows arrive as complete messages joining to
  `PART-ONE PART-TWO`; stderr warns `incomplete: max_output_tokens`.
- (b) 30 MiB ASCII file, thirty scripted 1 MiB `read_file` ranges: all 30
  windows arrive whole (header `bytes first–last of 31457280`, window
  start bytes, next-`byteOffset` note; `end of file` on the last). The
  final request replays all thirty packed with `recall_output` notes.
- (c) scripted `search`/`list_files`/`read_file` pages: first pages carry
  `[matches 1-5 of 12; call search again with offset 5 for the rest]`,
  `[files 1-5 of 13; call list_files again with offset 5 for the rest]`,
  `[lines 1-10 of 40; offset=11]`; follow-ups return the later items.
- Web pages and diagnostics paging stay at unit level (37 + 25 green):
  `web_fetch` refuses private addresses, so no loopback page exists
  without network, and the headless run offers no language service.

## Red drills (repo-default timeout unless noted)

- B1 `outputCapRecord`: `?? policy.output.maxTokens ?? legacyCap`
  reordered to prefer legacy — fails as expected; restored byte-exact.
- B1 tap: `isContinued` forced false — both new tap tests fail, 9 old
  pass; restored. E2E level: same sabotage rebuilt into the packed
  product — proof (a) fails with exactly the shipped bug (`PART-TWO`
  only); restored and green.
- B1 drain: final `drain(sink, true)` sabotaged to `false` — proof (a)
  still passes, proving the tap fix (not the drain) carries the release;
  the drain hold remains for fail-closed withholding. Restored.
- B5 `skip=0` — 1/6 fail (also exposed a weak aggregate assertion,
  strengthened to `rows[0]==f1.ts`); restored.
- B6 `skip=0` — 3/16 fail; restored.
- B7 `start=0` — fails; restored.
- B3/B9 analogues per row records; A9 `&&` vs `||` window-containment —
  fails; restored.
- A10 fallback `MAX_IMAGE_BYTES` → `MAX_DOCUMENT_BYTES` — the
  unconfirmed-fallback test fails (`expected 32000000 to be 10485760`);
  restored.
- Proof schema: `body` made required — GET entries without bodies fail
  the report parse loudly instead of silently dropping; made optional
  with per-body filtering. (Drill by construction; kept fail-closed.)

## Gates with exit codes (this lane, final tree)

- `npx tsc --noEmit -p tsconfig.json` → 0.
- `npx eslint --max-warnings=0` (touched files; hooks run it per commit) → 0.
- `npx prettier --check` (touched files) → 0.
- `node scripts/check-l10n.mjs` → 0 (14 UI tables, 0 problems; no new strings).
- `node scripts/gen-reference.mjs --check` → 0 (73/65/89/244 current).
- `node scripts/check-host-api.mjs` → 0.
- `npx knip` → 0. `node scripts/cycles.mjs` → 0. `npx jscpd` → 0
  (7 clones; 2 touch lane tests under threshold: a 7-line helper shape
  shared with `execStdio`, and the two tap tests, since deduped to one
  helper).
- `npm run build` (tokens, production, size, split, lazy-registry,
  host-globals, notices) → 0.
- Unit neighbors re-run green: `attachmentLimitsRecord` 5,
  `mediaBudget` 11, `attachments` 18, `acpTranslate` 44, `acpMedia` 11,
  `capabilityRecord` 35, `mediaProviders` 6, `sessionTap` 11,
  `outputCapRecord` + `modelApiLoopContracts` + `toolPaging` +
  `diagnostics`/`diagnosticsReport` + `webFetch` + `retainedOutput` +
  `fileRange` per row records.
- `node scripts/check-plan.mjs` → 0; `node scripts/gen-roadmap.mjs --check`
  → 0 (after the PLAN/CHANGELOG edits below).

## APP PROBLEMS (findings for the lead)

1. Exec's money reservation caps `max_output_tokens` at 32,768
   (`resolveExecOutputCap`: `Math.min(MODEL_API_MAX_OUTPUT_TOKENS, …)`),
   so a headless Model API run never sends the model's record maximum even
   when the budget allows it. LIMITSA territory; this lane proves the
   continuation mechanism through that window, not the window itself.
2. Continued reply segments were withheld from headless output forever
   (fixed here: tap release + drain hold). The ACP/editor surface always
   streamed every segment live; only exec/jsonl consumers lost the first
   window.
3. The lane's first shape pushed `dist/modelApi.js` to 525.4 KiB (budget 525) and `dist/headless.js` to 101.1 KiB (budget 100) because the
   request path bundled the capability record's zod machinery. Fixed by
   moving the limits reader next to its callers in `modelPolicy.ts` and
   pinning the Meta values equal to the record by test (519.9 / 97.9 KiB).
   Composer staging and the host capability projection keep the same
   constants with pin comments: neither surface may bundle the
   backend-only policy module (D6 split gate fired once, then green).
4. `web_fetch` refuses private addresses by design, so packed proof of page
   paging cannot use a loopback server; it stands on unit coverage of the
   same shipped code. Diagnostics paging likewise (no language service in
   the headless run).
5. Raw `dist/acp.js` + fake-OS-keyring store auth did not reach readiness
   in this harness (M80's packaged agent + same fake passes); the proof
   uses `--key-stdin`, which M80 also covers. Not root-caused here.
6. `exec`'s `finalMessage` is the last complete message, not the whole
   transcript; whole-reply consumers must concatenate message events (the
   proof does). Pre-existing convention, unchanged.
7. Jscpd notes (under threshold, gate green): the proof's report helpers
   share a 7-line shape with `execStdio.e2e.test.ts`.

## RVLIMITSB review receipts (Windows, 2026-10-14)

These receipts supersede the affected claims above; historical Linux results
are not a certification of this review tree. Native inventory succeeded with
no `error`; observed Node v24.20.0 and Python 3.14.0. The delivery validator
is not applied to the repository's legacy, non-ledger PLAN format.

- F1 exec cap: `npx vitest run test/unit/outputCapRecord.test.ts --maxWorkers=2`
  failed before the fix (exit 1, expected 131072, received 32768), then passed
  after it (exit 0, 5 tests). Logs: `.lane/exec-cap-{red,green}.log`.
  `resolveExecOutputCap` now uses the record maximum; the existing per-request
  ledger still refuses an unaffordable reservation rather than shrinking it.

- F2 range-edit safety: `fileRange.test.ts` now runs with the actual platform.
  Before the repair, editing `éA` at byteOffset 1/byteLength 2 replaced `é`
  outside that window (exit 1 on the new assertion). A read of `abc`, followed
  by a person writing `abc changed by the person`, also allowed the stale edit
  (exit 1). After repair all 11 tests pass (exit 0). The scan records a full
  digest; the edit checks that digest and publishes through the existing
  `writeFileIfUnchanged`, with exact byte containment and no formatter. BOM and
  a split CRLF are checked byte-for-byte. Logs: `.lane/range-*.log`.
  The 128 MiB edit refusal remains an unresolved design finding, not a
  provider/harness limit. A streaming splice needs a separate implementation.

- F3 range-read paging: real-file regressions pass (13 tests, exit 0). A
  100,000-byte range now advertises only bytes actually delivered in the
  64,000-character tool result. UTF-8 and CRLF boundaries are completed by the
  adapter and the next offset uses that actual aligned end. Before repair,
  `aé😀z` with byteLength 2 returned `a`, then offset 2 discarded the remaining
  byte of `é`; byteLength 100000 on ASCII clipped text but said end of file.
  Logs: `.lane/range-read-{green,restored}.log`. A deliberate edge regression
  could not be executed: the app's shell launcher failed in
  `MuseSparkCreated.Execute(... publish ... registry.json ...)`, before the
  command started. Restored SHA-256s match `.lane/range-read-hashes.json`;
  this red drill is **deferred**, not passing.

- F4 clipped lists/search and verify recall: list/search pages that overflow
  the character window retain their entire page (including its next-row note)
  in the existing recall store. Long line clips name byte addressing. Verify
  clips restart recall at zero; the former maxChars offset skipped the space
  consumed by the clip marker and recall note. A real 500-file listing and
  real `DiagnosticsHistory`/`ObservationPack` assertions pass: 28 tests in
  3 files, exit 0. Deliberately restoring the wrong verify offset fails the
  new report assertion (exit 1, `.lane/paging-red.log`); restored afterwards.
  The unrelated existing no-note clip budget assertion also found maxChars
  plus marker output; fixed by reserving the marker in `clipWithNote`.

- F5 owner's testing rule: removed 8 lane-added/modified stand-in cases: 3 from the
  deleted `test/e2e/limitsOutput.e2e.test.ts`, 2 fake-agent cases from
  `sessionTap.test.ts`, and 3 fake-world cases from `webFetch.test.ts` (one
  new and two modified by LIMITSB).
  Existing stand-in suites remain TESTCUT-owned and were not run here.
  The removed packed test exercises real bundles/tools but scripts provider
  decisions, replaces fetch and keyring, uses nine literal output characters
  rather than exhausting a real token window, and checks only range headers
  and prefixes, not full 30 MiB equality. Its 3 passes are not product proof.
  A dated, sanitized real capture must include the actual max-token terminal,
  continuation request and completed terminal, usage, tool calls/results and
  ordered deltas; replay it without replacing fetch or the keyring, and compare
  all delivered file bytes. Lead-owned real use must cover Stop, budget refusal,
  repeated continuations, web and editor diagnostics.

- F6 headless release authority: a later `completed` terminal formerly
  released any earlier incomplete segment, including `content_filter` or a
  chain whose terminal had a transport/accounting failure. The real tap's
  continuation predicate now requires max_output_tokens and a clean chain,
  stopping at failures. Data-only tests through the real exported predicate
  pass (6 tests with output-cap checks, exit 0, `.lane/tap-green.log`). This
  does not certify full event delivery or provider behavior.

- F7 diagnostic message tails: `getDiagnostics` now offers `messageOffset`;
  a clipped message names its entry offset and next message offset, preserving
  any `uri` filter. The formatter is the real module, driven with data: the
  1,000-character prefix and important tail are separately reachable. Both
  diagnostic suites pass (exit 0, `.lane/diagnostics-green.log`). Verify's
  separate summary remains pageable through getDiagnostics.
- Final authority/message red drills: removing the max-token source check
  fails `expected true to be false` (exit 1); forcing diagnostic messageOffset
  to zero fails `important tail` (exit 1). Both sources restored byte-exact:
  sessionTap SHA-256 `0f52dff54777808228f659bb159387eb9922133ff55722798703d48c944c66a5`,
  diagnostics SHA-256 `86095827415b77b1d14896e36ef690ba2c88251b1e23ef26164c076f3a273592`.
  Restored run passes 23 tests / 2 files, exit 0 (`.lane/restored-drills.log`).

## RVLIMITSB final gate record (Windows, review tree 5ced4e321)

- `git merge --no-ff origin/main` → 0, `Already up to date.` The local
  origin/main is 898a26c5e304426f2fb374910ec700b51b5260d1, already an ancestor;
  no conflict or merge commit. No fetch, push, rebase or reset.
- `npm run typecheck` → 0, all five projects. An earlier run failed the
  lane helper's exact-optional return type; corrected in 55a8fcf06.
- Changed-file ESLint → 0; changed-file Prettier → 0; `check:l10n` → 0;
  `check:reference` → 0; `check:roadmap` → 0; `deadcode` → 0; `cycles` → 0.
- `check:host-api` initially → 137 with no diagnostic; standalone rerun → 0
  (380 APIs, 48 importing files, 30 built-ins, 71 theme variables).
- `check:plan` initially → 1 (3,567,743 bytes, 2,585 over the unchanged cap).
  Archived D114's own record with the canonical generator (reassembly and
  parsed facts identical); then → 0. Archive integrity suite passes.
- `duplication` → 1: four clones / 65 lines in tools.ts and toolIo.ts;
  no threshold changed. This is a remaining release blocker.
- `build` → 1: production compilation and size checks succeed (extension
  554.4 KiB / 600; modelApi 521.0 / 525; headless 98.2 / 100). Bundle split
  fails eight inventory checks: pageWorker parse5/entities/html-encoding-sniffer/
  @exodus/bytes; agentImport smol-toml; imageResizeWorker jpeg-js/pngjs;
  validation mini-parser. Cause UNMEASURED; not labelled pre-existing.
- `security:sast` → 2: `semgrep-core rule validation failed (SemgrepError)`
  and `[ERROR] Failed to obtain target files from semgrep-core`. Not clean.
- `security:audit` → 0: two advisories, one configured high exception.
- Final allowed tests → 0: 104 tests / 9 files (`outputCapRecord`, `fileRange`,
  `toolPaging`, `retainedOutput`, `diagnostics`, `diagnosticsReport`,
  `attachmentLimitsRecord`, `runLedger`, `planArchive`), maxWorkers=2.
- `node scripts/package-acp.mjs` → 1: `Required Darwin created-path helper
is missing: native\\darwin\\muse-dictate`. No packed-product proof available.
  Built `node dist/acp.js help` → 0; local invalid exec flag → 2 as expected.
  Neither action starts a provider or opens the credential store.
- Stand-in suites including `sessionTap`, `webFetch`, and `execStdio.e2e`
  were not run under the owner's final testing rule. Related-suite breadth
  and remaining red drills are not certified. The attempted related listing
  used an unsupported `--list` flag and exited 1; no test result is claimed.

Full logs are under `.lane/`; final finding/handoff report is
`.lane/RVLIMITSB.report.md`. Required acceptance work and failed gates remain;
this is **not mergeable**, even after main is merged.

## Qualification

All work runs directly in `/home/randy/lanes/LIMITSB` on linuxlt. No
browser, paid/live request, dependency installation, credential access
(beyond test-owned fakes), merge, push or rebase. Commits carry the hooks
(`.husky/_`, never `--no-verify`) and the exact trailer. Every command's
output went through `| cut -c1-300 | head -n 80`. Gate exit codes above are
the commands' own (`$?` to a file, never through a pipe).

## LIMITSBFIX (Codex-review follow-up, 2026-10-15, linuxlt)

Branch `fix/limits-output-final` from `731f9e670`, merged PR 172 head
`d1271bd70` (both sides kept in append-only files; overhauled test
deletions stay deleted). All work runs directly in
`/home/randy/lanes/LIMITSBFIX` on linuxlt. No browser, paid/live request,
dependency installation, credential access, push or rebase. Commits carry
the hooks (`.husky/_`, never `--no-verify`) and the exact trailer.

### Per-finding record

- P1 retained-output authority: every kept output stores its origin (tool,
  touched paths, file-policy revision, workspace trust, taint source)
  through one retention choke point (`retainFullText`); `recall_output`
  re-checks it under the live policy through one recall choke point
  (`recallPacked` + `judgeRetainedRecall`). Denied/untrusted/stale sources
  are refused in words, never returned. Real-module tests prove
  denied-path, trust-loss, stale-opaque, unrecorded and allow cases.
  Red drill: fence disabled → 4 fence tests fail; restored byte-exact
  (sha256 `9bb4dc3a…` before and after).
- P2 128 MiB cap: removed (`TOOL_FILE_EDIT_MAX_BYTES` deleted). Range
  reads are window-only (window-local shape, window digest, no full-file
  scan); range edits read the window and splice it through a streaming
  temp-file copy (flat memory: window + 64 KiB chunk). Freshness is the
  window's bytes/size/mtime as read; matching is window-scoped. Proved by
  editing a 128 MiB + 1 byte sparse file by range, plus BOM/CRLF/partial/
  stale cases. Red drill: splice forced `changed` → 5 edit tests fail;
  restored byte-exact (`8eff31ca…`).
- P2 A10: a record that states no limit leaves it unknown (no legacy
  fallback); nothing local enforces it and the provider's own refusal
  comes back in words. Meta models keep their capability record's values.
  Tests prove unknown pass-through and stated-limit refusal at record,
  budget and ACP layers. Red drill: fallback reintroduced → unknown test
  fails; restored byte-exact (`61bdcc26…`).
- P2 rest-paths: subagents recall their own kept outputs through the
  fenced choke point; retained ids carry a per-store tag so a resumed
  session never rebinds an old note; diagnostics overflow names come from
  the sorted snapshot (`sortWorkspaceDiagnostics`) with per-file offset
  paging; a converter-cut page tail, a runner-dropped shell middle and a
  cut search hit each name the way back or say why not (live probe through
  the real built search worker confirmed the cut-hit note; probe file
  removed after).
- Deliberate schema moves with their pins: edit-schema hash
  `fcde96bd…` → `a2be6849…` (1707 bytes; A9 byte args) with the m101-t.md
  row; strict-tool goldens gain `byteOffset`/`byteLength` (chat +
  responses codecs).
- Duplication gate fixed: 6 clones / 72 lines → 0 (shared window address,
  edit matching/apply, test builders).

### Gates with exit codes (final tree, this machine)

- `format:check` → 0; `lint` (js main/unit/tests, css, ps) → 0
  (ps skipped: Windows-only, on linux); `typecheck` (all 5 projects) → 0.
- `knip` → 0; `cycles` → 0 (no circular dependency).
- `duplication` → 0 (0 clones; was red at review).
- `check:l10n` → 0; `check:reference` → 0; `check:host-api` → 0;
  `check:plan` → 0.
- `build` → 0 (production + size/split/globals/notices all pass; the
  review's Windows build failures were the shared-install junction,
  re-measured clean here).
- `security:sast` → not runnable: semgrep fails to start, `OSError:
[Errno 30] Read-only file system` writing its version-check cache.
- Touched unit suites → 0 (26 files in rig-sized batches plus
  planArchive; totals include retainedOutput 10, fileRange 15,
  mediaBudget 12, attachmentLimitsRecord 5, acpTranslate 44,
  diagnosticsReport 11, webFetch incl. 2 new, m101Certification,
  both codec goldens).

### What integration with LIMITSFIX needs from this branch

- The text-only continuation repeat joins LIMITSFIX's one repeat policy
  for every tool class (untouched here by design): the continuation
  call sites are `ModelApiHost` continuation loop + `repeatGuard.ts`
  consumers, and the recall fence's `packRecallWithheld` wording assumes
  the model is told not to retry a withheld id (a repeat policy must not
  re-issue `recall_output` for a refused id).
- `AttachmentLimits` fields are now `number | undefined`; any LIMITSFIX
  consumer of the old always-number shape must handle unknown.
- `FileRangeRead.fingerprint` is now the window digest (not the file);
  `ToolContext.retainOutput`/`ShellRetain.keep` take an optional touch;
  `readFileCapped` is removed in favor of `spliceFileRange`.
- Open for the owner: Meta's attachment numbers are record preset values,
  not separately published provider docs (32 MB local PDF table vs the
  provider's 50 MB allowance stands); MCP-server-gone is not re-checked
  on recall (trust-flip is); the Composer's client-side size guards still
  enforce legacy numbers pre-send.

### Lead's real-life steps (updated)

1. Pack and install this branch; run a real Model API conversation.
2. Attach 21 images with no provider record stating a count: all send;
   the provider's refusal (if any) arrives in words.
3. Clip a long shell output, change a file permission mid-session, call
   `recall_output`: refused in words, nothing returned.
4. Edit a >128 MiB file by byte range after reading the window.
5. Fetch a page whose conversion exceeds the cap: last window says the
   tail is not reachable as Markdown.

## Integration with LIMITSFIX (branch `fix/limits-integrated`, 2026-10-16, Windows)

Merged in order onto `origin/main` `ba995775f`: rv/invariants `004db738e`,
fix/limits-final `e8a6c3adc` (D112, D113), this branch `1e43abd0d` (D114).
No provider call, no stand-in, no limit or gate changed.

- **Continuations join the one repeat policy.** `RepeatGuard` (D113, F4)
  gains `observeContinuation(text)`; it records through the same private
  `record` as `observe`, under a key that cannot equal any tool call's
  (`toolRepeatKey` always encodes two elements, the continuation key one).
  In `ModelApiSession.loop`, a reply cut short by `max_output_tokens` with
  continuations on is observed with its own text (`StreamedCall.replyText`:
  the cut-short response's message text). The 3rd and 4th identical text
  queue `MODEL_API_MODEL_TEXT.continuationRepeatWarned` (model text, in
  place of the plain continuation prompt); the 5th emits the translated
  `modelApiToolStuck` notice and ends the turn. Text that changes is never a
  repeat; a tool call in between starts the count over. No second counter,
  constant or threshold exists: `TOOL_REPEAT_LIMIT` 3 and
  `TOOL_REPEAT_STOP_LIMIT` 5 decide both.
- **Round bound.** `shouldContinueOutput` lost its `round`/`maxRounds`
  arguments: `MODEL_API_MAX_TOOL_ROUNDS` is gone with D112, and
  `MODEL_API_CONTINUATIONS_MAX` with D114. A limit the person set ends the
  turn at the next round's start with D112's summary. The branch that showed
  `modelApiContinuationLimit` became unreachable and was removed with its
  key from all 15 tables (order kept).
- **Money.** The settle-time "budget lowered the output" notice and its
  `uncappedOutputTokens` field are dropped: D113 never lowers
  `max_output_tokens`, so the notice could not be true.
- **Recall fence.** The repeat policy never re-issues a call; a refused
  `recall_output` repeated with the same refusal warns at 3 and stops at 5
  like any tool, matching `packRecallWithheld`'s "do not retry" wording.
- **Red drills** (`test/unit/repeatGuard.test.ts`, real module, 11 tests):
  (1) `observeContinuation` made to ignore its text: 1 failed ("never calls
  changing continued text a repeat…": the eight changing texts gave ok,
  warn and stuck instead of only ok); (2) continuations never counted: 1
  failed ("warns at the third identical continued text…": five times ok
  instead of ok, ok, warn, warn, stuck). Source restored byte-exact both
  times, SHA-256
  `42a8b02a657bd3d5a8e82f71ce6914d2c2d6707bd2e2f215ac4c3d8328e837eb` before
  and after; restored run 11 passed.
- **Not proven here.** The loop wiring needs a real turn whose answer is cut
  by the output limit and keeps returning the same text: the model is warned
  at the 3rd and 4th continuation and the turn stops at the 5th with "The
  turn stopped because the same tool call kept returning an unchanged
  result…". That sentence names a tool call; whether a continuation needs
  its own translated sentence is the lead's call.
