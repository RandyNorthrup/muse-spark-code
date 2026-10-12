# ACPDOG certification

Release base: 4d28a4f84 (0.17.1), macmini, fake-only, no model attempts.
Rig brief owns validation scope; full quality/integration/live receipts are lead-owned.

## Item 7 — backend notices

Pinned ACP SDK 1.7.0 schema has `notice` and requires `clientCapabilities.session.notices`.
All `backendNotice` producers (compaction evaluation, MCP, retry pacing, hook and backend state) now use it once per text per session. Clients without it receive no advisory answer chunks.
Red: complete acpTranslate suite failed (1 failed / 43 passed) before fix;
`temp/acpdog-7-red.log`. Full-turn ACP test checks concatenated answer text
with and without negotiated notices. Explicit slash-command answers remain answers.

Green: acpTranslate + acpAgent: 2 files / 189 tests at repository deadlines.

## Item 1 — request-local credential reads

PLAN D89.3 requires the first-party host to read its key per request, register
request-local redaction and keep it no longer. D61 requires in-process OS
storage, never children. Kept fresh reads (no turn cache). Each native read
gets three attempts, a 1 s deadline and 100 ms backoff; a missing entry is an
answered absence and is not retried. Store mutations are not retried. Native
errors are discarded. Transport and ACP distinguish the unsent credential
refusal from internal failure; a subsequent prompt can succeed.
Red: acpDogfoodStore 4 failed / 1 passed before the fix (busy, no answer,
retry bound and typed unsent cause); `temp/acpdog-1-red.log`.
Dependency: the sibling lane owns the configured-provider catch-all and
reservation release. Its fix must preserve `credential_store_unavailable`;
this lane does not edit that catch-all or reservation code.

Green: store + ACP agent + runtime ChatGPT: 3 files / 185 tests; localization 14 languages / 0 problems.

## Item 4 — settlement token classes

The catalogue adapter dropped `cache_write` while constructing its price
card; only that rate projection is repaired, with no catalogue or reservation
algorithm changes. The shared exact-money settlement prices fresh input,
cached reads, 5 m writes, 1 h writes, output (including reasoning) and flat
request/image prices. Missing cache class prices use the highest input-side
rate and the journal marks `upperBound: true`. Exact `usdAmount` accompanies
the existing numeric display field. Reported provider prices remain authoritative.
Removed the registry's obsolete one-hour uncertainty guard now that settlement
already supports the captured subset. Invalid fractional counts are refused.
Red: pricing/configured suites failed 5 tests / passed 46 before fixes;
`temp/acpdog-4-red.log`. Hand totals include 16,168 writes at $5/M plus
347 output at $16/M = exact $0.086392. Captured decoder tests cover
Anthropic TTL, OpenAI/xAI subsets, OpenRouter reported USD, Gemini reasoning
and Ollama; no new provider shape is invented.

Green: pricing + configured providers passed; journal records + model API providers + provider model policy: 3 files / 48 tests at repository deadlines.

## Item 2 — ACP failure boundaries

Every registered request (initialize, authenticate, new/load/resume/list/close,
mode/configuration, prompt) and cancellation notification passes one failure
boundary. Known availability, backend, deadline, store and validation refusals
keep typed codes and existing localized sentences. Unexpected failures log
class plus redacted message once; MSP messages remain suppressed per AGENTS.
Prompt text, embedded resources/media and authorization headers are withheld.
Red: all 16 failure-injection cases failed before the boundary;
`temp/acpdog-2-red.log`. Green: 16/16, plus the existing 145 ACP cases.

## Item 3 — protocol accounting

ACP prompt responses and session-info metadata carry journal-exact request,
token-class and decimal USD figures, with session totals and daily/session
remaining budget views. Reads never reserve and are bounded at 1 s.
Internal journal records now correlate session/turn and parent session/turn;
no provider wire field changed. Upper bounds, missing counters, uncertain
liability, legacy numeric costs and unavailable history remain explicit.
Strict ACP SDK validation accepts the metadata; a strict client can ignore
its unknown keys. Red: all three protocol cases failed without the binding;
`temp/acpdog-3-red.log`. Green: accounting + ACP agent + usage recording:
3 files / 174 tests, at repository deadlines.

## Item 8 — useful failure logs

Exec stderr prints the turn's typed kind and redacted reason. Resource errors
name their fixed port (`resources.settings`, `.resume`, `.sample`, `.history`,
`.status` or `.admission`), discard native diagnostic text and report each
reading once per connected process. Red: verbose exec lacked the typed cause
(1 failed / 94 passed); `temp/acpdog-8-red.log`. Green: exec run + named
resource errors + runtime resources: 3 files / 116 tests at default deadlines.

Real stack: ACP SDK → real ModelApiHost → HTTP on loopback → fake provider,
with in-process fake OS-store entries: busy, never answering, absent and
unavailable after two settled calls. Four complete cases pass at default
5 s test deadlines. Failed requests do not reach HTTP and the next prompt
succeeds. Receipts and metadata share the journal's exact $0.000548 per
request. All servers and keep-alive sockets close in finally.

## Items 5 and 6 — boundaries and host facts

Outside writes/edits/read failures and outside list/search globs are typed
`outside_workspace` results, visible to model and client, with no approval or
I/O. Linked escapes retain their technical detail. Windows separators and
absolute/traversal paths are covered. Red: 3/3 cases failed without the guard;
`temp/acpdog-5-red.log`. Green: paths + host environments + complete tools:
3 files / 88 tests at repository deadlines.

Runtime host identity, absent shell, questions, language services, diagnostics
and unavailable git facts name their actual host. VS Code defaults retain
identical text. Red: environment suite 7 failed / 1 passed before the fix.
Added deliberate host goldens: `hosts/acp-meta.json`, `hosts/acp-provider.json`,
`hosts/cli-meta.json`, `hosts/cli-provider.json`, `hosts/exec-meta.json` and
`hosts/exec-provider.json`, under `test/fixtures/golden-requests/`.
Each records its actual standalone host; exec also records absent questions.
Original VS Code goldens are unchanged.

Item 7 sweep: resource/account state and unsolicited question-delivery/status
notices use negotiated notices; resource/account machine data use session-info
metadata. An elicitation without forms stays under its tool row (or a notice
when standalone). Schedule startup failures use notices. Explicit local command
answers remain answers. ACP agent/resources/accounts: 3 files / 181 tests pass.

## Intentional-break drills after implementation

Each mutation failed its owning suite at the repository deadline, in batches
of at most three files and three workers. A `finally` restored the original
bytes and compared SHA-256. No gate, timeout, baseline or hook was weakened.
Mutation receipts: `temp/acpdog-drill-{0,1,2}.{log,json}`.

| Item | Deliberately broken guard       | Restored SHA-256                                                   |
| ---- | ------------------------------- | ------------------------------------------------------------------ |
| 7    | notice channel                  | `6979370a674b4d8677928108eede820999288c5cf541f8b8b4fbbd53ef6d393c` |
| 1    | request-local retry loop        | `23b65d867ef79e334343a4b1b67bcfd3722bb03746e63a2cb0bfd5ca53eef463` |
| 4    | 5 m write rate                  | `759fc7e67844582b3e6373012dc5259f45749978ffd0f07fd6f46e55dc91bd7b` |
| 2    | internal failure cause log      | `92ad9f77fe57de97f1894e0a35488718aebdc18bbb7faa7a204dfa8a7c19ad9a` |
| 5    | outside-workspace typed result  | `a674c30b9719ee0fa6580d9aa8d7c2c8b3e6af78ddbe26bcb4f3dc1452c85ce6` |
| 6    | runtime identity and host facts | `581b174ad4c619881c7e5ff238c21dcfdbcdd26698fb68c5ebbd60349825e03a` |
| 3    | turn record selection           | `8ccd86e60132ba952a96719942657b40c7e6eb04766e8f6680db5366afcec1d2` |
| 8    | named reading deduplication     | `049ce444049097b5c8e6e41807f4dc9ed55575dde7242b9f1c01f111b9ccaa2f` |
| 8    | exec typed cause log            | `dece600b6ab7b8940268fca61d60a6813f3be97bcf26fa8016f58c77e931a66a` |

## Final verification and remaining integration

All eight implementation items are present. The final read-only session budget
projection preserves canonical cap, spend and liability amounts instead of
round-tripping page numbers. Its $0.100000000000000001 precision regression
and unavailable exact-reader case pass. A cache class with no positive known
input-side bound stays unknown; an explicitly quoted zero still settles as zero.
Both follow-up guards fired deliberately and restored their byte hashes:

- `src/runtime/acpAccounting.ts`: `3ccad17eefbbd83934501f1ff28d31b0a10e0101f2e346a756de466650f7a990`.
- `src/core/providers/priceCard.ts`: `6cab161e1fc0157cf0f05b946babf07b2cbe46665507337ef2650e9de8f8e0f1`.

The final ACP fixture updates assert the new response metadata, typed refusals
and notice channel. Full suites: pricing/budget/attempt budgets 28 tests;
ACP Model API/questions/usage 99; ModelApiHost 670; ACP stdio 13, all passing
at repository deadlines. The earlier broad run's five failing suites had stale
expectations; each complete suite was corrected and rerun, without relaxing
assertions or gates. Exec stdio and the fake Action launcher passed unchanged.

The related selection covers all 28 changed non-hub source modules. The union
with explicitly named/owned suites contains 636 files. 112 were invoked;
524 remain in [acp-dogfood-not-run.txt](acp-dogfood-not-run.txt). The 150-minute
time box prevents completing that set here. The milestone stays building
until the lead completes those, aggregate quality and VS Code integration.
The broad run's receipts are `temp/dependent-*.{json,log}`; repeated transforms
used Vitest's file cache, with no test timeout overrides and at most three
files/three workers per invocation. Its opt-in live suite was skipped; no
live or paid model calls ran.

HUB: integration run required for constants, English/translated tables,
featureCatalog and the generated reference. The sibling dependency remains
item 1's configured-provider typed-error preservation and reservation release.
This lane changed only cache-write rate projection and settlement, never the
reservation functions or the configured catch-all.

Header stripping precedes prompt redaction, so a one-letter prompt cannot
change a header name and let its value reach an internal-error log. The guard
fired deliberately, restored SHA-256 `3c61640e469367ac402c8629398bcae4c90666b05c12d4657b34ce0e4b28da56`,
and the full failure/accounting/budget suites passed 22 tests afterward.

Final checks: all five typechecks passed; changed-file ESLint passed (the one
remaining budget-fixture style error was fixed and checked separately);
duplication zero; localization 14 languages / zero problems; reference and
host API current; production build, size/split/globals/notices gates passed.
Knip and cycle checks passed earlier in the lane, before the final read-only
budget projection; their final repeat remains lead-owned with aggregate quality.
No full visual baseline comparison was completed; no visual styling changed.

- `dist/acp.js`: 259470 bytes.
- `dist/headless.js`: 102132 bytes.
- `dist/modelApi.js`: 533473 bytes.
- `dist/extension.js`: 563567 bytes.

## Round 2 — review RVACPDOG findings (2026-10-11, macmini lane ACPDOG)

All eight findings (P1/P2/P3) fixed by class, each with a regression test
that fails without it. No residuals. Commits `b2fbd09f5`, `a614dae4c`,
`64ea77233`, `08131a3e9` on branch `fix/acp-dogfood`.

### (a) Nothing submitted leaves through an error or a log

One redactor: `respond()` in `src/acp/agent.ts` redacts every non-internal
`RequestError` message with the request's own private text (code and data
untouched); unexpected-error logs go through `requestFailureText` with the
same text; all other log lines use `failureForLog`, which names only. The
private text for `session/prompt` is `promptPrivateText`: text blocks, media
`data`, image `uri`s, resource `uri`/`text`/`blob` bytes, and `resource_link`
uris (the blob and link uri are new). `session/new`, `session/load` and
`session/resume` pass the `cwd`. Path enumeration, each proved by a test:

- failed-turn `RequestError(turnFailed, event.reason)` → redacted rethrow
  (finding 1: `acpAgent.test.ts` "redacts the submitted prompt from a
  failed turn reason"; benign reasons still pass, per "turns a failed turn
  into an error with its reason").
- `sendTurn` rejection echoing an embedded PNG blob → log holds no blob
  bytes (finding 2: "keeps embedded resource bytes out of the
  unexpected-error log", real 1x1 PNG).
- `ModelApiError` / `RangeError` branches already redacted with the same
  text; verified by existing suites (`acpDogfoodErrors`, `acpModelApi`).
- `backendNotice` texts reviewed: hook result messages (the user's own
  machine output to their own client), fixed budget/retry wording —
  none echo the submitted prompt.
- `redactDiagnosticEvent` covers credential patterns on the ModelApiHost
  diagnostic path; prompt text there reaches the client only via the
  settled failed-turn reason, which (a) covers.

### (b) Usage is read once, in order

`tokenUsage` no longer reads: `queueUsage` is replaced by `readUsage`, one
bounded journal read per completed request in `promptResponse` (success and
failure paths), never chained on the outbox. `UpdateTranslator`'s journal
`readCost` seam is removed, so a `usage_update` cost is the turn's own
running tally (which includes the request it describes), never the previous
snapshot; the settled figures land in one `session_info_update` plus the
response `_meta`. Tests: "reads the settled figures once, on completion,
never per token event" (3 token events → 0 reads, tally cost, then exactly
1 read with journal-exact `_meta`) and "delivers answers while a hung
journal read is still outstanding" (chunk arrives with the journal gated).
The obsolete during-turn snapshot test was rewritten to this contract, as
was the `readCost` injection test in `usageRecordingAux.test.ts`.

### (c) Known failures are named

`respond()` maps `ResourceReadingError` to typed `unavailable`
(`-32012`) naming the reading (`resources.settings: …unavailable…`,
a "Label: detail" splice, no new l10n key), and reports it once through the
deduplicated `resourceFailureReporter`. Test with the real
`createRuntimeResourceHost` (first settings read ok, later reads failing):
two `/resources status` prompts both return the named reason with exactly
one warning and no error log (finding 5).

### (d) Windows paths

`confinedGlob` normalises root and glob with `normalWindowsPath`, exactly
as `resolveWorkspacePath` does for plain paths, so a valid
`\\?\C:\workspace\*.md` glob is in-workspace while another drive, UNC and
junction escapes stay refused (finding 6: verbatim accept + search/list
proofs). `pathRefusal` keeps the fixed shown sentence but carries the
specific reason in `failureReason`, which the translator copies to the
client's refusal reason; the glob guard names its glob too (finding 7:
link-escape and verbatim-drive refusal proofs, updated
`modelApiTools`/`modelApiHost`/`acpDogfoodPaths` expectations).

### (e) Policy test vs guard

PLAN (M101 P2 rows) confirms 1-hour-write settlement exists in
`priceCard.ts`, so the code is right and the test was obsolete: it now
expects the independently computed settlement (10 five-minute writes at
`cacheWrite` + 10 one-hour writes at `cacheWrite1h` = `0.06`), keeping the
reported-cost passthrough assertion (finding 8).

### Round-2 red drills

Each guard was broken in memory, the named test observed red at repository
timeouts, and the file restored byte-exact (`sha256sum -c` clean, empty
`git status`):

| Finding | Broken guard                               | Named test red                                                       | Restored SHA-256                                                   |
| ------- | ------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 8       | `splitCacheWrites` oneHour → 0             | "settles one-hour writes…" (`'0.04'` vs `'0.06'`)                    | `516f2183db1ce7e61bbcf6bf1e15a51a7b1038262668f7ab9e3e1b052141b6e0` |
| 6       | glob guard without verbatim normalisation  | "accepts a valid Windows verbatim glob…" (`'outside the workspace'`) | `cceb78676c06f6cce174d66a7e543f9eb6974b1a1acc0a269d96e8eaf9d95eb0` |
| 7       | `pathRefusal` back to the generic sentence | "makes the file tools refuse a linked escape…" (no `through a link`) | same tools hash                                                    |
| 7       | glob reason back to the bare sentence      | verbatim-drive refusal naming                                        | same tools hash                                                    |
| 5       | `ResourceReadingError` branch disabled     | "reaches the client as the named reading…" (got `-32603`/generic)    | `73bf7c6f60ccc6197370cae7925a83e1cac09e2b3432d03b71c05ca1dd040109` |
| 1       | `RequestError` rethrown as-is              | "redacts the submitted prompt…" (sentinel in message)                | same agent hash                                                    |
| 2       | blob dropped from private text             | "keeps embedded resource bytes…" (PNG base64 in log)                 | same agent hash                                                    |
| 3+4     | a read per token event re-added            | "reads the settled figures once…" (3 reads, not 0)                   | same agent hash                                                    |

The finding 4 stall test additionally passes with the fix; the old code's
queue-behind-read shape is gone (`readUsage`/`tokenUsage` hold no outbox
reference), so there is nothing left to stall behind.

### Round-2 verification

Focused suites green at repository timeouts, `--maxWorkers=3`: modelPolicy
14, modelApiTools 78, acpDogfoodPaths 3, acpDogfoodResources 2,
acpDogfoodAccounting 4, acpAgent 146 (+1 pre-existing ChatGPT failure, also
red on pristine `5121bacf1`, and 1 load-flake reviewer failure that passes
solo), acpTranslate/usageRecordingAux/modelApiArgumentPreview/toolArgumentPreview
green, modelApiHost 669 + the same solo-green reviewer test. All 58 test
files importing the three changed source modules were run: every file green
except `acpDogfoodLoopback.test.ts`, which this sandbox cannot run
(`listen EPERM` on 127.0.0.1 — lead to run outside the sandbox). Host and
unit typechecks clean; changed-file ESLint/Prettier clean; `check:l10n`
0 problems (no new keys). The review appendix's remaining 261 suites do not
import the changed modules and were not run here.

Bundle bytes (fresh `npm run build`): `dist/acp.js` 259470 (unchanged),
`dist/modelApi.js` **533619** — +146 B over the review's 533473, all of it
this round's required guard code (verbatim normalisation, specific glob
reason; comments strip out). The release pin 532537 and the diet gate
530883 were already red at the base (2590 over); they stay red (+146).
No cap was raised and no code was moved to another bundle to hide it; the
bytes cannot come out without removing the fixes themselves.

## Round 2 continued — appendix sweep, one more sibling, byte verdict

### All 261 appendix suites ran (2026-10-11, same rig)

The review's 261 unrun files were executed in batches of at most three
(`--maxWorkers=3`, repository timeouts). 247 unit files ran; 4 live e2e
suites (`eval/modelApi/reviewer/tab.live`) were not attempted (no live or
paid calls on this lane) and 2 browser suites (`resourceHarness.test.mjs`,
`usageCompanionChunks.test.ts`) were not attempted (no browser launches
from a lane sandbox). Every red file below was checked for imports of the
three changed source modules (`src/acp/agent.ts`, `src/acp/translate.ts`,
`src/core/backends/modelapi/tools.ts`): none imports any of them. One red
(`toolImages`) was a genuine finding-7 sibling and was fixed (commit
`0128dc944`); the rest are sandbox blocks or rig-load failures:

| Red file (tests)                                                         | Signature                                              | Placement                                                                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acpDogfoodLoopback` (4)                                                 | `listen EPERM 127.0.0.1`                               | Sandbox blocks loopback; lead runs outside                                                                                                                          |
| `playbookOutcomes` (4)                                                   | ENOENT pid markers; Husky allow/refuse                 | Sandbox blocks process probing (`ps` denied here too)                                                                                                               |
| `promptHostLifecycle` (2)                                                | 5 s timeouts, Save-dialog/disposal timing              | Loaded-rig timing; no shared modules                                                                                                                                |
| `reportEngine` (1), `reportHistory` (33), `reportNetworkBinding` (1)     | "The report could not be saved" (process locks/probes) | Sandbox process restrictions                                                                                                                                        |
| `runtimeSharing` (2)                                                     | unexpected "prompt file is invalid"                    | Proven pre-existing: identical 2 failures on pristine `5121bacf1`                                                                                                   |
| `scheduleMigrate` (6)                                                    | 5 s timeouts, migration receipts/crash                 | Loaded-rig timing; no shared modules                                                                                                                                |
| `shellMonitor` (1)                                                       | `isAlive(own pid)` false                               | Sandbox blocks process probing                                                                                                                                      |
| `spawnProfiles` (1), `subscriptionIntegration` (2), `teamMcpBridge` (43) | `listen EPERM` root cause                              | Sandbox blocks loopback                                                                                                                                             |
| `teamNativeLifetime` (1)                                                 | `uv_os_setpriority EPERM`                              | Sandbox blocks priority changes                                                                                                                                     |
| `vault/channel` (44), `vault/peer` (1), `vault/sshTransport` (1)         | unix-socket `listen EPERM` / listen refusal            | Sandbox blocks socket listen                                                                                                                                        |
| `toolImages` (1)                                                         | exact `toEqual` missed round-1 `code`                  | **Fixed**: expectation now pins `code: 'outside_workspace'` + specific reason; drill (expectation without `code`) fails, restored file green, ESLint/Prettier clean |

Also green in this sweep: `toolIo`/`verifyLoop`/`writeRecorder` (153),
`shellEnvironmentOrigins`/`toolArgumentPreview` (53), all team/vault
non-socket suites, and the eval pack suites. Earlier-noted flakes
(`modelApiHost` reviewer test, `acpAgent` ChatGPT test) stand as recorded.

### Byte verdict: the 532537 pin needs scope removal, not this round

Minified attribution, measured from deterministic builds (base `tools.ts`
rebuilds to exactly the review's 533473 on this rig):

- `confinedGlob`: two `win32 ? normalWindowsPath(…) : …` ternaries plus
  two cross-chunk calls (`(0,Yl.normalWindowsPath)(…)`, the body already
  living in `dist/modelApiBoundaries.js`), minus a shorter `relative`
  expression: about +136 B. The reason template adds 9 static bytes over
  the bare sentence.
- `pathRefusal` (`failureReason: refusal.reason`) saves about 10 B.
- The new import adds one `require("./modelApiBoundaries.js")` binding
  (34 → 35), about 38 B.
- Net: +146 B → 533619. Drive-letter case needs no code (verified:
  `path.win32.relative` already folds it both ways); comments strip to
  zero (0 `//` lines in the bundle).

There is no further honest reduction: the ~146 B is the two required
fixes, and the only larger savings available (re-inlining the shared
normaliser, dropping a ternary, shortening the mandated specific reason)
each weaken finding 6/7's parity or specificity. Reaching 532537 needs
−1082 B, i.e. removing about 1 KB of shipped milestone scope from the
earlier lane commits (credential transport mapping, typed refusal
results, host instructions, budget projection) — a residual the owner
rule forbids. The pin and the 530883 diet gate were already red at the
review base and belong to the diet lane (`MODELAPIDIET`), which exists
for exactly this. This round's bytes are proved minimal and load-bearing.

## Round 3 — RVACPDOGB failure-boundary redesign (2026-10-12, same rig)

Seven lead rulings, every P1/P2/P3 fixed with no residuals. Each fix got a
regression test that fails without it; each drill broke the guard, saw the
named test fail, and restored the file byte-exact (sha256 verified). No new
dependency; no guard widened (no pin or cap moves; `check:l10n` 0 problems
with 2 new keys × 14 tables).

| Finding                           | Fix                                                                                                                                                                                                                                                                                                                  | Regression test                                                                                                                                                                                                                                                                                                                                            | Red drill                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| R1 one outbound error shape       | `respond` builds every error through `outboundError` (src/acp/agent.ts): allow-listed code, allow-listed sentence (SDK prefixes accounted), rebuilt data (kind/reading/requestSent vocab + schema-validated `_meta.museSpark.usage` only); `promptPrivateText`/`requestFailureText` deleted — nothing left to redact | `acpDogfoodOutbound` (9): property test over the inventory (RequestError, ResourceReadingError, StoreUnavailable, MissingApiKey, Deadline, MSP via real `MspError`, ModelApiError, RangeError, AbortError, unexpected, failed-turn echo, forged reading); sentinels in message/data/kind/code/cause absent from rehydrated message, data and all log lines | allow-list disabled → `withholds sentinels in a typed RequestError` + `failed turn echo` red; restored (sha `f2d83a14`)                 |
| R2 brand, never instanceof        | `ResourceReadingError.code = 'resource_reading'` (src/runtime/resources/text.ts); `isResourceReadingError` matches brand + vocabulary; agent `respond`, `entry.ts` onError and the reporter use it; `isResourceReadingName` for data rebuilds                                                                        | R2 block in `acpDogfoodResources`: the real text module compiled a second time via esbuild and loaded as its own file (two class objects, `instanceof` false) — failure still arrives named `-32012`                                                                                                                                                       | guard back to `instanceof` → separately-compiled test red; restored (diff-verified + re-backed-up)                                      |
| R3 every /resources command typed | `history.read` and `writeResumeUntil` wrapped in `readResource` (src/runtime/resources/host.ts) with `resources.history` / `resources.resume`; status/history/resume + `/usage resources` all flow through it                                                                                                        | R3 block: `it.each` over `/resources history`, `/resources resume`, `/usage resources` — each rejects `-32012` with its named reading, warn once, no `log.error`                                                                                                                                                                                           | history wrap removed → history + usage-resources red, resume still green; restored (sha `e2a87673`)                                     |
| R4 resolved identity              | `confineWorkspacePath` judges alias spellings by real-path-of-nearest-ancestor identity (spelling/home/UNC refusals stay; link/junction refusals stay); `confinedGlob` delegates spelling to `resolveWorkspacePath` and rewrites alias globs onto the real folder                                                    | `acpDogfoodPaths` R4 block: fake-8.3 read + glob rewrite, POSIX symlink-alias accept + link-escape refusal, Windows 8.3 short-name test (skips with reason when the volume offers none)                                                                                                                                                                    | identity accept disabled → both alias tests red; restored (sha `88546585`)                                                              |
| R5 one source for cost            | `tokenUsage` carries `{usd, certainty}` settled per request at the billed model (host: noteUsage certainty, child-delta propagation, emit; `agentEvents.ts` schema); translator takes it verbatim (`isPricedCarriedCost`), `estimateCostUsd` removed from the answer path; journal stays out                         | host `carries each request's settled cost…` (contributor 1000 in → `0.0001` computed); aux reviewer-exact case (parent-model totals + carried `0.0001` → shown, not `0.00125`); accounting suite uses carried costs                                                                                                                                        | host emit disabled → host test red; translator guard disabled → 3 aux/accounting tests red; both restored (shas `5cfbc0cf`, `aa6d5882`) |
| R6 translated refusal reasons     | `acpRefusalOutsideWorkspace` / `acpRefusalLinkEscape` in `en.ts` + all 14 `ui.*.json` (English key order); `pathRefusal` builds `failureReason` from them (model detail stays English); translator copies it through untouched                                                                                       | `modelApiTools` German-table test: link + plain refusals in German naming the path, model detail still English                                                                                                                                                                                                                                             | `failureReason` back to English → German test red; restored (sha `a86f202f`)                                                            |
| R7 bytes                          | below (byte verdict)                                                                                                                                                                                                                                                                                                 | measurement, not a guard test: same-machine deterministic builds (base clone at `5121bacf1` rebuilds to exactly the review's 533473)                                                                                                                                                                                                                       | n/a                                                                                                                                     |

### Round-3 verification

Focused suites green at repository timeouts, `--maxWorkers=3`: outbound 9,
resources 6, paths 5 (+1 Windows-only skip on this rig), accounting 4,
errors 9, aux + translate 51, tools 79, agent 146 (+1 pre-existing ChatGPT
failure, also red on pristine `5121bacf1`), host 671 (incl. the new R5
test). Host + unit typechecks clean; changed-file ESLint clean;
Prettier clean; `check:l10n` 0 problems; `check:reference`,
`check:host-api` clean; knip clean (2 pre-existing config hints);
`cycles` clean (the new `agentEvents → usageJournal` edge is acyclic).
Pre-existing assertion updates required by the redesign (all behaviour the
rulings forbid): failed-turn reason, backend-stop words, `expectCause` log
shape, English refusal reasons, static-price tallies.

Cannot run in this sandbox (lead to run outside; listed by file for the
reviewer): the 4 browser suites (`visualCapture`, `visualReadiness`,
`visualStability`, `m114ConversationReview` — Chrome/loopback blocked),
`test:a11y` + `test:integration` (browser/VS Code), `check:visual`
(browsers), and the 4 live e2e suites (no live/paid calls on this lane).
The full unit run below excludes only the 4 browser suites; its global
setup stages fine and only the browser spawn fails.

### Byte verdict: round-2's 146 B are gone; round-3's mandated code is itemised

Same-machine deterministic builds: base `5121bacf1` → `dist/modelApi.js`
**533473** (exactly the review's number); this tip → **535527**
(+2054). Per-module `bytesInOutput` delta (esbuild metafiles):

- `ModelApiHost.ts` **+1093**: R5 settled-cost fields, per-request
  certainty at the sent model, event carriage, child settled-delta
  propagation (the reviewer's exact bug), `ChildRecord` snapshot,
  `editTarget` path threading. Hot path (every request/event); cannot load
  on use.
- `tools.ts` **+461**: R4 glob spelling delegated to `resolveWorkspacePath`
  (deletes round-2's verbatim block and its `normalWindowsPath` import),
  alias-glob identity fallback + rewrite, R6 translated `failureReason`.
  Every search/list pays the lexical path; only the rare outside-spelling
  fallback is lazy-eligible.
- `workspacePath.ts` **+500**: R4 identity comparison in
  `confineWorkspacePath` (every file op already paid a `realPath`; the
  addition is the alias accept branch), `isLinkEscapeRefusal` for the R6
  wording split.
- `agentEvents.ts` +0: the optional `cost` object shakes out to nothing
  measurable. `dist/acp.js` +145 (`text.ts` brand) — no acp budget exists.

Round-2's +146 B (verbatim ternaries, `glob … is outside the workspace`,
the extra import binding) is structurally gone: every line of it is
deleted or replaced in the diff above — verified by rebuilding the base
clone, not by arithmetic. What remains is round-3's ordered redesign, all
of it hot-path. Moving hot code to a bundle loaded on use would mean a new
esbuild entry plus budget/split-gate edits outside this lane's files —
guard-widening the brief forbids — so no lazy move was made; the lead owns
that trade. No pin or cap moved. Inherited overage, stated separately:
533473 is 2590 over the 530883 diet gate (936 over the 532537 pin); with
this round the file stands 4644 over the gate. The diet lane resolves it
at integration.
