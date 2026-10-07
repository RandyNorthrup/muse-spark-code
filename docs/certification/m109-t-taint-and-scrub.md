# M109 T: taint and scrub

Rig: Mac mini, worktree `/Users/randy/lanes/M109T`, branch `m109/t`, base
`8a151dd40`. Scope: PLAN D89.7–8 and M109 lane T. No credentials were read,
no dependency was installed, no live/paid model call was made (zero attempts),
and no other lane's source was changed. The rig brief overrides common.md's
obsolete merge/rig forwarding instructions: no merge/push/rebase and no
aggregate quality run; the lead owns joined-tree quality.

## Implemented boundaries

`VaultTaintSession` validates and copies provenance. Model API requests use
only the context sent in that request; replies, tool outputs and summaries
retain their dependencies. Muse Code observations remain tainted for that
session. Restricted Mode marks both backends. Reasons are bounded and
deduplicated without clearing the tainted bit; callers cannot clear the
owner by mutating a snapshot. The tests call B's actual broker with Always
and unattended grants: each of the eight external sources forces an approval
and unattended use is denied.

The Model API adapter publishes the producing request's context to B through
an injected callback, tags replies and tool results, preserves tags through
session storage and compaction, and keeps metadata off the provider wire.
Hosted search taints calls in that same reply. Web fetch, browser check and
configured MCP results get provenance from host routing, regardless of text
claims; a configured MCP server named `ide` remains untrusted. Old history
without provenance is conservatively tainted. Trusted issue/PR/agent/device
adapters supply their actual context through an explicit port. Preview,
reviewer and other ancillary body builds cannot clear the producing context.

`VaultScrubber` builds Aho–Corasick code-point edges over raw UTF-8, JSON,
percent escapes in both cases, hex in both cases, base64 and base64url,
including the fixed interiors of all three byte alignments. Matches ignore
line breaks and complete ANSI runs, merge overlaps and preserve surrounding
text. Each command gets its own stream: its longest-pattern suffix and
incomplete ANSI sequence stay pending; oversized pending text closes without
output. Decoration-only values refuse unlock instead of yielding an empty
match. Lock/disposal clear the trie and close further use. `VaultScrubService`
serializes loads, invalidates immediately, refuses a late installation and
wipes transferred values in finally, including construction failure. Scratch
form buffers are unpooled and wiped, including partially built forms.

The shared `SecretScrubPort`/`scrubSecrets` hook adds no regex pattern. Exact
scrubbing precedes existing privacy/pattern edits. Optional injected ports
preserve behavior until the broker/host lane binds them; a bound service's
failure refuses delivery instead of falling back to raw text.

- Model API: the complete JSON body is scrubbed on every try, including token
  counting. Invalid scrubbed JSON refuses sending; cancellation and admission
  are checked again after the await. Headers remain the intended trusted
  authentication path. No provenance is added to provider fields.
- M84: the entire portable document is scrubbed before slicing or privacy
  edits, even for a full export. Markdown, previews and filenames use the
  service. Cached JSON and its filename are scrubbed again after the preview,
  so newly stored values or Lock cannot bypass that boundary. The opaque CLI
  log writer refuses export with a bound port until a safe writer exists.
- M93: raw final title/text are scrubbed before sealing; export rechecks the
  service and requires a new preview if a newly vaulted value changes it.
  Delayed builds cannot replace a newer preview. ACP's report command uses the
  same core builder. Journal writes refuse records changed by exact scrubbing;
  old journals are scrubbed before parsing, repair or delivery.

No command, setting, dependency, UI text or bundle cap was added. No new wire
shape was guessed: provider/tool fakes reuse the existing capture-backed
schemas; provenance is local replay metadata using lane 0's schema.

## Threat controls and red drills

The [machine-readable receipt](m109-t-drills.json) contains 38 deliberate
mutations, named failed assertions and the SHA-256 restored byte-exact after
each mutation. Every receipt's source hash matches the final source. Runs used
whole owned test files, at most three files/workers, default five-second
Vitest timeouts and no skips or test-name filters. The throughput drill adds
redundant scans without changing output, proving the unchanged floor rejects
a performance regression. Ordinary known throughput failures were never
counted as evidence for another scrub mutation.

| Threat                    | Control                                                                                                   | Drills                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------- |
| V1 prompt injection       | Actual context, derived/restore/summary taint, Restricted Mode, source routing and forced ask             | T01–T06, T16–T20, T37–T38 |
| V2 granted-command output | Encodings, aligned base64, overlap, streaming and ANSI retention; X owns feeder admission/network         | T07–T09, T31              |
| V3 malicious MCP          | Host-owned source facts, including configured `ide` spoof, ignored trust claims                           | T01, T18                  |
| V7 memory reads           | Byte ownership, wipe on failed/late build, immediate invalidation and disposal                            | T10–T15, T32              |
| V9 logs/exports           | Pre-send, complete export, sealed/final report, fresh filename, journal write/repair and fail-closed hook | T21–T30, T33–T35          |
| V12 unattended            | Real B broker denies tainted unattended uses despite standing grants                                      | T01, T04–T05              |
| Performance               | 1,000-value unchanged 50 MB/s floor                                                                       | T36                       |

## Verification and performance history

All five typecheck projects passed. Subsequent test-only additions also receive
the unit typecheck. Existing regression batches passed: Model API host +
session store + request provenance 637 tests; client/Markdown/portable exports
59; report handler/ACP report/journal 102; report builder 68. Final owned files
contain 45 tests (12 taint, 8 requests, 11 scrub, 9 boundaries, 5 reports).
Final restored-source batches passed **25 + 20 = 45** owned tests, including
the unchanged throughput floor. The final client/export regression batch also
passed all 59 tests after the additional post-preview guard. The native fetch
fixture first used a UI mode instead of an MSP mode, then a loopback URL the
public fetch correctly refused; correcting those test inputs produced eight
passing request tests without changing production policy or the timeout.
The restored-source throughput test passed standalone (11 tests) and again in
the final boundary/scrub batch (20 tests): the assertion establishes at least
50 MB/s for those samples; the earlier below-floor measurements stay recorded.

| Final check                                            | Result                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `npm run typecheck` and final `npm run typecheck:unit` | All five projects, then final unit additions pass                     |
| Changed-source/test ESLint, `--max-warnings=0`         | Pass; no new escape hatch                                             |
| Changed-file Prettier                                  | Pass                                                                  |
| `npm run deadcode` (plain Knip)                        | Pass; two existing configuration hints                                |
| `npx jscpd`                                            | Pass, zero clones                                                     |
| `node scripts/check-l10n.mjs`                          | 14 tables, 164 manifest strings, 612 source files, zero problems      |
| `npm run build`                                        | Pass: all size/split/host-global/notice gates                         |
| `npm run check:host-api`                               | One inventory drift problem, named `T-W-host-api` deferral in PLAN §7 |

Final bundle sizes: extension 447.7/600 KiB, Model API 460.1/475,
checkpoint store 77.1/225, report 22.3/75, recorder 24.5/75, ACP 828.0/850,
webview static 897.9/900 and deferred 49.7/50. The scrub automaton is not
imported into a host bundle: B/W bind it in broker memory. No cap or gate was
weakened. The host API's 332 VS Code APIs, 31 `vscode` importing files, 25 Node
built-ins and 61 theme variables are unchanged. Its stale Node totals are
`buffer` 39 → 40 (T), `child_process` 13 → 14, `crypto` 46 → 53, `fs` 33 → 36,
`fs/promises` 47 → 49, `net` 7 → 10, `path` 84 → 89 (the latter six from the
base). The W-owned file is left untouched; the lead regenerates and reviews it
from the joined source. Aggregate quality, full suites, packaging and platform
captures remain lead-owned under the rig brief.

Weak canaries found during drills were replaced: a 64-hex export value was
already recognized by the legacy export redactor, and the first journal
version exceeded its existing length cap. The final export uses opaque values;
the journal asserts its generated version is valid before reaching the guard.
The filename test uses a valid short filename value, avoiding an unrelated
sanitizer's transformation. Final drills observe the intended assertions,
including repair of a journal written before the value was vaulted.

The performance path initially failed at 36.24 MB/s. Reducing map lookups
measured 39.80, and shallow dense ASCII transitions measured 32.70. Shared
rules required stopping after those two unsuccessful fixes; no further
performance optimization was made. A later standalone run measured 40.77.
Final restored-source runs subsequently passed the unchanged floor, including
all 20 boundary/scrub tests and all 11 standalone scrub tests. This variability
is retained as a lead-owned integrated-rig check, not hidden by a timeout,
threshold, filter or benchmark change. The benchmark keeps one warm-up and
one measured pass over 1,000 generated values and 4.7 MB of compiler text.

## Named integration handoffs and limits

- **T-B-scrub-owner:** B alone creates/loads the service in broker memory and
  binds its existing `scrub`/`taint` ports. Unlock/rotation rebuild it; every
  invalidation locks it. Hosts receive only the text port, never a value list
  or trie. A late loader delays later queued loads, but cannot install after
  invalidation; its owned bytes are wiped on return.
- **T-B-request-context:** bind `noteVaultTaint` to the authenticated channel's
  trusted snapshot and issue/PR/agent/device adapters to
  `vaultContextProvenance`; neither accepts a tool's trust claim. Keep one
  `VaultTaintSession('museCode')` per Muse Code session; observe each untrusted
  source and publish before a vault request. ACP/shared core uses the same
  owner; all editor adapters bind these ports, not only VS Code.
- **T-X-stream:** one stream per command/output route, proper incremental
  UTF-8 decoding before string writes, normal-EOF finish only, dispose in
  finally on cancellation/failure/connection loss. Never flush an aborted
  suffix or combine separate commands. X owns feeder release/termination.
- **T-W-storage:** inject `SecretScrubPort` before logs, transcript/history
  retention and every physical writer, including writes after a file dialog.
  The synchronous legacy logger/history API needs that host binding; the
  asynchronous service hook does not silently alter it. Keep generation
  checks in adapters across their own awaits and invalidate on Lock.
- **T-W-opaque-log:** the CLI `session export` directly writes a raw file;
  provide a safe byte-returning/staged writer before re-enabling that route
  with a vault. Current refusal reaches the existing export-failure notice.
- **T-M102-journal / T-M96-ledger-report:** these owners are absent on this
  base. Bind the same explicit scrub port before each physical write and
  outgoing report. No fake production implementation substitutes for them.
- **T-M100/M107-results:** receiving adapters scrub before keeping or
  delivering relocated/device reports and attach source provenance.
- **T-W-host-api/help:** the lead refreshes the joined host inventory and
  feature reference when binding the feature. `featureCatalog.ts` and the
  referenced orchestration gotcha register are absent on this base; no
  command/settings entry is invented. The gotcha file was also absent from
  local `main`; no network fetch, process capture or external temp directory
  was used. Tests remove their own `temp/m109t-journal-*` directories.

Remaining security limits are those in the threat model: JS strings/copies,
code-point edges, swap/debuggers and same-user memory are not guaranteed erased;
unknown encodings and one character per independent command are residuals.
A granted process can send arbitrary encodings over its own network. The
scrubber is a second line, not that boundary. Broker text frame limits may
refuse a large complete export; integration needs a bounded bulk writer rather
than passing slices that could reveal a split value. Decoration-only values
are refused. Nothing here certifies the absent host/feeder bindings or another
platform's performance, and no M109 support/release claim is made.
