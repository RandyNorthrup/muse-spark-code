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
