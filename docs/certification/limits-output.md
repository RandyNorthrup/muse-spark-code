# LIMITSB — no answer, file, page or output is cut short without a way to get the rest

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

## Qualification

All work runs directly in `/home/randy/lanes/LIMITSB` on linuxlt. No
browser, paid/live request, dependency installation, credential access
(beyond test-owned fakes), merge, push or rebase. Commits carry the hooks
(`.husky/_`, never `--no-verify`) and the exact trailer. Every command's
output went through `| cut -c1-300 | head -n 80`. Gate exit codes above are
the commands' own (`$?` to a file, never through a pipe).
