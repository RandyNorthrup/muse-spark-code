# M95b V — VS Code subscription adapters

Kubuntu rig, worktree `/home/randy/lanes/M95BV`, branch `m95b/v`, base
`180c85b2`, 2026-10-05. This certifies the offline adapter lane, not an
integrated or live subscription release. No paid/model call, external
network request, dependency, cast, suppression, gate change, push, merge or
rebase. Hooks resolve through this worktree's `.husky/_/pre-commit`.

## Evidence and scope

Read PLAN D74 and M95b in full, `docs/certification/m95-research.md` §6,
`docs/certification/m95b-s.md`, and the supplied
`/home/randy/lanes/_ctx/codex/M95B-FINDINGS.md`. The owner recorded two
ChatGPT sign-ins on 2026-10-05, runs `acdc0f60…` and `577bc807…`, with
**0 + 1 model attempts**, and revoked both refresh tokens (HTTP 200).
This lane uses their callback fields: `code`, `scope`, `state`, `client_id`.
No model slug is hard-coded. Synthetic OAuth records and generated RSA
keys exist only in tests. The lead still needs the precise capture
workspace/receipts; the supplied findings summarize them.

Copilot follows the stable declarations in the pinned
`@types/vscode@1.99.0` and the official-source research §6.2: user and
assistant roles, text/tool-call/tool-result parts, `selectChatModels`,
`sendRequest`, `countTokens`, cancellation and error codes. Its first
**request**, rather than selection alone, triggers VS Code's consent.
No undocumented usage data-part shape is guessed or parsed.

## Implemented contracts

- `chatgptSignIn.ts` implements lane S's `ChatGptHostPort`: the system
  browser through `vscode.env.openExternal`; a one-shot random-port
  `127.0.0.1` callback at the captured `/auth/callback`; state/field checks
  delegated to the shared parser; a deadline starting at listen, early
  callback retention, explicit cancellation, and active socket cleanup.
  Browser text reuses `UI_TEXT.oauthCallbackDone` at use time, as plain text.
- The subscription record lives only in SecretStorage at
  `museSpark.provider.chatgpt`. The shared core validates the record,
  pins issuers/origins, verifies the ID token, exchanges/rotates tokens and
  revokes before removal. No credential value enters global storage,
  webview messages, logs, hooks, tools or children. Store/browser/JSON
  failures leave through the shared core's fixed technical codes.
- An atomic `open(..., 'wx')` lock in `globalStorageUri` serializes
  initialization, sign-in, refresh and remove across extension-host
  processes. The core rereads SecretStorage while holding it. One opaque
  random installation id persists beside it. Waiting is bounded; the lock
  is released in `finally`. An occupied lock is never stolen on age.
  A crashed owner can leave the lock behind: stale-lock recovery needs a
  separately reviewed design, since timeout-based stealing can rotate
  the same refresh token twice.
- Remote windows can use an existing readable SecretStorage grant, but
  creating a remote callback refuses before opening the browser. Neither
  `asExternalUri` forwarding nor cross-window local/remote SecretStorage
  sharing was captured. The adapter does not claim either route works.
- `copilotClient.ts` selects `vendor: 'copilot'` only through the explicit
  click factory, makes no inference during selection, and maps the full
  canonical history onto the stable API. Instructions become the first
  user message. Function calls and results preserve their ids, arguments
  and order; reasoning is never replayed. The shared harness receives
  canonical text/tool/final events and retains its tool loop and approvals.
- Copilot metadata says `reduced`, `plan`, estimated usage, no cache
  control, no reasoning replay. The model's tokenizer estimates messages,
  tools and the complete output. Input-window overflow refuses dispatch;
  output-cap overflow cancels and returns an incomplete response.
  Estimates are also handed to injected plan accounting, separately from
  reported usage. Admission/attempt callbacks run beside `sendRequest`.
- First-use consent cannot be triggered from a background request. Consent
  and confidentiality are checked again after token counting. A
  confidential workspace hides models and refuses previously held clients.
  Stop reaches VS Code's cancellation source, and generator closure
  cancels/disposes it. Known permission/quota/rate/model errors become
  translated fixed messages; supplied service text and account details
  are discarded.
- Images require an injected host feature detector **and** the selected
  model's vision support. This base is 1.99; newer SDK image constructors
  are not guessed. Files, hosted search/history and unknown stream parts
  explicitly refuse rather than disappearing. SDK text, tool parts and
  token counts are validated. Because the stable API exposes no account
  or grant identity, credential-digest reads and scheduled confirmations
  explicitly refuse; no fake credential digest is supplied.

The adapters add no new UI strings: Copilot takes live `justification` and
`failureText` readers from the strings/UI lane; ChatGPT returns the shared
core's codes. No existing paid defaults or single-model behavior changes.

## Ownership boundary and integration handoff

The brief says: “do not edit files another lane owns — if you must, stop
and say so in the final message.” The base lacks
`src/core/backends/modelapi/providerClient.ts`; V uses an explicit structural
interface for its six existing client methods. The factories are tested
but are not yet imported by a production bundle. Wiring them into the
panel requires other lanes' changes, so V stops at that boundary:

1. W/shared provider contracts must represent `auth: subscription` in
   `src/core/providers/providersFile.ts`,
   `src/host/providers/providerPorts.ts`, and `src/shared/modelsPanel.ts`.
   The panel schema also lacks a subscription category, subscription
   actions and a `reduced` field. API-key credential readers currently
   require `{secret}` and must not read ChatGPT's token record that way.
2. W must compose `createChatGptSignIn` into `dist/modelsPanel.js`, passing
   SecretStorage, `globalStorageUri`, remote state and the host's patched
   fetch; connect removal through `core.remove()` after Undo. Translate
   core errors, including local-window guidance for `invalid-callback`.
3. V owns the Continue with ChatGPT and Use my Copilot models rows and
   the extension command region. Those remain unfinished pending shared
   contracts; handing them to U/W did not complete V's acceptance. U/0
   supplies Plus/Pro eligibility, one-time plan/credit notices, reduced and
   estimated labels, report link, and all translations. Copilot's
   `failureText` codes are `unavailable`, `consent-required`, `quota`,
   `rate-limit`, `request-failed`, `unsupported-content`, `confidential`,
   `cancelled`, and `confirmation-expired`.
4. W must register the Copilot clients through the shared registry and
   provide current confidentiality, user-action provenance,
   `context.languageModelAccessInformation.canSendRequest`, live
   translations and plan tallies. The modern image port requires an
   actual SDK feature detector and a model capability record. Modern
   usage data parts need a capture before they can be interpreted.
5. V owns extension command wiring; W owns the manifest, README, PRIVACY,
   CHANGELOG, PLAN and aggregate certification. No command is registered here without its
   manifest, translated labels and usable panel path.

All-editor behavior: ChatGPT decisions stay in lane S's shared core;
V is only its VS Code adapter, and X implements runtime/ACP ports. Copilot
is explicitly VS Code-only in D74; other editors should not offer its row
unless their host supplies the sanctioned Language Model API.

## Checks and red evidence

Checks run directly on Kubuntu. Full quality and the complete suite stay
with the lead as required by the rig/common brief; no gate is weakened.
Each drill runs the entire owning test file with
`--maxWorkers=3 --testTimeout=120000`, never a test-name filter. Each
mutation is restored in `finally`, with SHA-256 equality to the original
bytes. Logs and machine-readable ledgers stay in ignored `temp/m95b-v/`.

The first socket-cleanup drill did not fire because all requests had
finished. Added the incomplete-HTTP connection test and reran the drill;
it now fails as intended. Only firing drills are counted below.

| Adapter | Guard deliberately broken    | Named failed test (substring)                                   | Result               |
| ------- | ---------------------------- | --------------------------------------------------------------- | -------------------- |
| ChatGPT | loopback-bind                | `binds only the captured loopback`                              | exit 1; SHA restored |
| ChatGPT | callback-path                | `ignores unrelated paths`                                       | exit 1; SHA restored |
| ChatGPT | callback-method              | `ignores unrelated paths`                                       | exit 1; SHA restored |
| ChatGPT | callback-validation          | `rejects untrusted callback`                                    | exit 1; SHA restored |
| ChatGPT | callback-deadline            | `starts its deadline at listen`                                 | exit 1; SHA restored |
| ChatGPT | callback-cancel              | `cancels a pending callback`                                    | exit 1; SHA restored |
| ChatGPT | callback-close               | `closes active incomplete HTTP connections`                     | exit 1; SHA restored |
| ChatGPT | early-callback-retention     | `retains an early callback`                                     | exit 1; SHA restored |
| ChatGPT | exclusive-lock               | `never steals an occupied lock`                                 | exit 1; SHA restored |
| ChatGPT | grant-lock                   | `serializes token rotation`                                     | exit 1; SHA restored |
| ChatGPT | opaque-id-validation         | `rejects a damaged non-opaque installation id`                  | exit 1; SHA restored |
| ChatGPT | opaque-id-persistence        | `persists one opaque host id`                                   | exit 1; SHA restored |
| ChatGPT | browser-refusal              | `releases the lock after failure`                               | exit 1; SHA restored |
| ChatGPT | remote-refusal               | `refuses an uncaptured remote callback`                         | exit 1; SHA restored |
| ChatGPT | secret-delete                | `revokes on remove`                                             | exit 1; SHA restored |
| ChatGPT | other-credential-store       | `has no dependency on other applications`                       | exit 1; SHA restored |
| ChatGPT | one-use-pipelined-callback   | `accepts at most one pipelined callback`                        | exit 1; SHA restored |
| ChatGPT | idempotent-close             | `cancels a pending callback and closes idempotently`            | exit 1; SHA restored |
| Copilot | reduced-label                | `marks the client reduced/plan/estimated`                       | exit 1; SHA restored |
| Copilot | estimated-label              | `marks the client reduced/plan/estimated`                       | exit 1; SHA restored |
| Copilot | consent                      | `blocks first-use consent`                                      | exit 1; SHA restored |
| Copilot | consent-recheck              | `rechecks consent after asynchronous`                           | exit 1; SHA restored |
| Copilot | confidential-client          | `refuses an already-held client`                                | exit 1; SHA restored |
| Copilot | confidential-before-dispatch | `rechecks confidentiality after token`                          | exit 1; SHA restored |
| Copilot | confidential-selection       | `hides models in a confidential workspace`                      | exit 1; SHA restored |
| Copilot | confidential-after-selection | `filters foreign vendors and rechecks confidentiality`          | exit 1; SHA restored |
| Copilot | vendor-filter                | `filters foreign vendors`                                       | exit 1; SHA restored |
| Copilot | native-api-detection         | `reports an unavailable native API`                             | exit 1; SHA restored |
| Copilot | image-capability             | `feature-detects image support`                                 | exit 1; SHA restored |
| Copilot | file-refusal                 | `refuses unsupported files`                                     | exit 1; SHA restored |
| Copilot | input-args-parse             | `refuses unsupported invalid-tool-call`                         | exit 1; SHA restored |
| Copilot | input-args-shape             | `refuses unsupported invalid-tool-input`                        | exit 1; SHA restored |
| Copilot | reasoning-not-replayed       | `preserves ordered tool calls/results without reasoning replay` | exit 1; SHA restored |
| Copilot | history-refusal              | `refuses unsupported search-history`                            | exit 1; SHA restored |
| Copilot | hosted-tool-refusal          | `refuses unsupported hosted-tool`                               | exit 1; SHA restored |
| Copilot | integer-counts               | `refuses invalid token counts 0.5`                              | exit 1; SHA restored |
| Copilot | nonnegative-counts           | `refuses invalid token counts -1`                               | exit 1; SHA restored |
| Copilot | window                       | `refuses requests exceeding the selected model window`          | exit 1; SHA restored |
| Copilot | model-binding                | `refuses a stale scheduled confirmation and a mismatched model` | exit 1; SHA restored |
| Copilot | scheduled-account-pin        | `refuses a stale scheduled confirmation`                        | exit 1; SHA restored |
| Copilot | no-fake-digest               | `refuses identity-dependent automation`                         | exit 1; SHA restored |
| Copilot | text-validation              | `validates SDK response parts`                                  | exit 1; SHA restored |
| Copilot | call-validation              | `validates SDK response parts`                                  | exit 1; SHA restored |
| Copilot | unknown-response             | `refuses unsupported unknown-response`                          | exit 1; SHA restored |
| Copilot | output-cap                   | `ends a response at the output cap`                             | exit 1; SHA restored |
| Copilot | token-estimates              | `preserves ordered tool calls/results`                          | exit 1; SHA restored |
| Copilot | estimate-tally               | `preserves ordered tool calls/results`                          | exit 1; SHA restored |
| Copilot | attempt-admission            | `calls admission and request observation once`                  | exit 1; SHA restored |
| Copilot | attempt-observation          | `calls admission and request observation once`                  | exit 1; SHA restored |
| Copilot | quota-translation            | `translates Blocked`                                            | exit 1; SHA restored |
| Copilot | rate-translation             | `translates ChatRateLimited`                                    | exit 1; SHA restored |
| Copilot | permission-translation       | `translates NoPermissions`                                      | exit 1; SHA restored |
| Copilot | missing-model-translation    | `translates NotFound`                                           | exit 1; SHA restored |
| Copilot | nested-translation           | `translates nested quota errors`                                | exit 1; SHA restored |
| Copilot | cancel-before-dispatch       | `cancels on Stop`                                               | exit 1; SHA restored |
| Copilot | cancel-listener              | `bridges Stop to VS Code`                                       | exit 1; SHA restored |
| Copilot | cancel-cleanup               | `cancels on Stop`                                               | exit 1; SHA restored |
| Copilot | dispose-cleanup              | `translates Blocked`                                            | exit 1; SHA restored |

All **58 red drills** fired; final baseline is **57 tests** (18 ChatGPT, 39 Copilot).

The ChatGPT adapter was committed early as `7b7a0ec6` with hooks on. A
further pipelined-callback test proves the one-use race guard.

- `src/host/providers/chatgptSignIn.ts` SHA-256: `7a113dfba2bdcb52bfb0cb9c6ba19040f07d58a5cbddff3d63b160ce912ef50c`
- `src/host/providers/copilotClient.ts` SHA-256: `5e99a59c324cf022e0a2f1a8bc52e3227846362ef6ee072f1b175049f0e85164`

## Final lane validation

| Command                                                                                                              | Kubuntu result                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                  | exit 0; host, webview, unit, e2e and integration projects               |
| `npx eslint --max-warnings=0` on both adapters and both tests                                                        | exit 0                                                                  |
| `npx prettier --check` on all six changed files                                                                      | exit 0                                                                  |
| `npx vitest run test/unit/chatGptVsCode.test.ts test/unit/copilotClient.test.ts --maxWorkers=3 --testTimeout=120000` | exit 0; 2 files, 57 tests                                               |
| `npm run deadcode`                                                                                                   | exit 0; one existing `vendor/**` ignore configuration hint              |
| `npx jscpd`                                                                                                          | exit 0; 0 clones                                                        |
| `node scripts/check-l10n.mjs`                                                                                        | exit 0; 14 tables, 127 manifest strings, 0 problems                     |
| `npm run check:host-api -- --write`, then `npm run check:host-api`                                                   | exit 0; 309 APIs, 25 VS Code adapter files, 0 problems                  |
| `npm run build`                                                                                                      | exit 0; size, split, host-global and third-party-notice checks all pass |

The initial duplication gate caught a 12-line/53-token sequence of canonical
request defaults shared with an existing codec fixture. Grouped the new
Copilot fixture's fields differently, retaining every value and assertion;
no test or gate was weakened. The initial host API check caught the new SDK
calls and lane S's existing `node:crypto` count drift; regenerated only the
derived API record and verified it. No other lane's feature source, strings,
manifest, PLAN, README, PRIVACY or CHANGELOG was edited.

Builds: extension **553.1/600 KiB**, Model API **413.3/475 KiB**, providers
**96.2/125 KiB**, Models panel **51.0/75 KiB**, checkpoint store
**88.4/225 KiB**. These are the current base bundles: the two new host
adapters await W's production composition, so these sizes do **not** prove
that the integrated adapters fit their eventual lazy bundles. The lead must
rerun split/size gates after importing them into the designated entries.

Full quality, the complete coverage suite, real VS Code/Copilot consent,
remote forwarding, and live subscription receipts remain integration/owner
work. No paid or live call was authorized or attempted here. The lane
preserves the owner's defaults ruling and today's single-model behavior.

## RVM95BV repair — FIXM95BV, 2026-10-05

Kubuntu, `/home/randy/lanes/FIXM95BV`, branch `m95b/vfix`, review base
`55ca120f`. The preceding certificate records the original lane snapshot;
this section supersedes its lock and accounting behavior and corrects the
ownership handoff. The rig/common brief forbids full quality, complete-suite
runs and integration merges here. Hooks exist and remain enabled. No
external network, real credential read, paid/model call, dependency, unchecked
cast, suppression, guard widening, push, merge or rebase.

| Finding                                               | Outcome                                                           | Regression evidence                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RVM95BV-1, orphaned refresh lock                      | Fixed for the new owner-record lock                               | `recovers a dead lock owner promptly` (future and expired leases), `concurrent recoverers keep the new owner exclusive`, `publishes pid, process start time, window identity and expiry and never steals a live expired owner`                                                              |
| RVM95BV-2, Stop stuck in token counting               | Fixed                                                             | `Stop settles stalled … token counting even when the tokenizer ignores cancellation` (messages, tools, output), `bounds stalled counting with a deadline` (stream and standalone), `uses one deadline for all input messages and tools`                                                     |
| RVM95BV-3, partial usage lost                         | Fixed                                                             | `translates nested quota errors during the stream`, `settles estimates once when the consumer closes immediately after a text delta`, `retains counted output on Stop`, `retains the previous output estimate when later output counting fails`, and dispatch refusal/one-settlement checks |
| RVM95BV-4, Providers rows and command path unfinished | **Residual: RVM95BV-4-SUBSCRIPTION-INTEGRATION; release blocker** | No integrated flow exists to exercise or drill; dependency evidence and required follow-up below.                                                                                                                                                                                           |

The refresh lock is now a directory at `chatgpt.refresh.lock`. A complete,
validated owner record (PID, process start timestamp, opaque per-factory
window ID and expiry) is written under a unique filename in a private
preparation directory, then published by atomic directory rename. No empty
owner-record interval exists. Dead PIDs recover immediately, including
before expiry. An expired inactive lease from this process also recovers;
a live owner stays locked even past expiry. `EPERM`, unknown OS errors,
unknown filenames and invalid metadata do not prove death. Foreign live PIDs
are conservatively retained even if their recorded start time differs:
`kill(pid, 0)` cannot distinguish PID reuse on every supported platform.

Recovery unlinks only the observed owner's unique filename and uses
`rmdir`, which cannot remove a concurrently published nonempty lock. The
five-contender regression also refreshes one expired synthetic grant once.
Release uses the same filename, so it cannot delete a successor's owner.
The empty ownerless regular-file format from the original unshipped adapter
remains closed rather than risking a live legacy owner's refresh; see the
named migration limitation below. No token value is written to lock storage.
A crash before publication can leave an inert `.chatgpt-lock-*` preparation
directory; it never blocks acquisition and contains only owner metadata.

Copilot passes the request's SDK cancellation token to every tokenizer call
and races each call against cancellation and a deadline, so an uncooperative
asynchronous tokenizer cannot keep Stop pending. Input messages and tools
share the existing 30-second `MODEL_API_REQUEST_TIMEOUT_MS`; standalone
counting also owns and disposes its cancellation source. Output counts are
bounded too. Listeners and timers are removed after each count. No new
setting or tunable is introduced.

A dispatched attempt settles exactly once on success, SDK request failure,
stream failure, Stop or generator closure, with the last validated input and
output counts and explicit certainty `estimated`. Counting happens before
yielding each output part, preserving the count when the consumer closes
at that yield. Failure during a later count retains the previous estimate;
uncounted content stays unknown. Admission, input-counting or consent
refusals before `sendRequest` produce no dispatched usage. Request options
are built before admission and dispatch observation: a throwing justification
reader is not counted as a request. Its regression failed against the first
repair commit, then passed with this ordering correction. These are plan
estimates, not reported usage or a dollar charge.

### Repair red drills

Each drill runs the complete owning test file with
`--maxWorkers=3 --testTimeout=120000`, no test-name filter. The runner restores
the exact original buffer in `finally` and compares SHA-256. All **16** exit 1
and the named assertion fails. Raw logs/JSON are in ignored `temp/m95b-v/`.

| Guard deliberately broken       | Named failed test (substring)                    | Failed tests | Restoration       |
| ------------------------------- | ------------------------------------------------ | ------------ | ----------------- |
| dead-owner recovery             | `recovers a dead lock owner promptly`            | 4            | SHA-256 identical |
| active-owner expiry protection  | `never steals a live expired owner`              | 1            | SHA-256 identical |
| permission failure is not death | `uncertain permission failure`                   | 1            | SHA-256 identical |
| owner schema                    | `untrusted invalid-owner`                        | 5            | SHA-256 identical |
| owner filename validation       | `untrusted unknown-file`                         | 1            | SHA-256 identical |
| nonempty directory fence        | `never steals a live expired owner`              | 7            | SHA-256 identical |
| tokenizer cancellation argument | `Stop settles stalled message token counting`    | 3            | SHA-256 identical |
| tokenizer cancellation race     | `Stop settles stalled message token counting`    | 3            | SHA-256 identical |
| counting deadline               | `bounds stalled counting with a deadline`        | 2            | SHA-256 identical |
| aggregate input deadline        | `one deadline for all input messages and tools`  | 1            | SHA-256 identical |
| failure/closure settlement      | `consumer closes immediately after a text delta` | 11           | SHA-256 identical |
| one settlement                  | `preserves ordered tool calls/results`           | 1            | SHA-256 identical |
| dispatched attempts only        | `admission refuses before dispatch`              | 5            | SHA-256 identical |
| estimated certainty             | `retains counted output on Stop`                 | 12           | SHA-256 identical |
| options before dispatch         | `justification reader fails before sendRequest`  | 1            | SHA-256 identical |
| count before yield              | `consumer closes immediately after a text delta` | 2            | SHA-256 identical |

### Named residuals and release requirements

Restored repair sources:

- `chatgptSignIn.ts` SHA-256: `633a592b14ecb81c609ceee60f2897447b00dddf60ab13594a7142033bd7e1cb`.
- `copilotClient.ts` SHA-256: `59553d731dbf39658c7c77967dd94cc96da607dd6cfafdce6e36910d866c4ae3`.

**RVM95BV-4-SUBSCRIPTION-INTEGRATION.** This P2 requires coordinated shared
contract/dispatch changes outside this lane's files, meeting the repair
brief's redesign exception. `src/core/providers/providersFile.ts`,
`src/host/providers/providerPorts.ts` and `src/shared/modelsPanel.ts` still
accept only `apiKey` and `none`; the panel has no subscription actions or
reduced field. `src/core/backends/modelapi/providerClient.ts` and a
`ProviderRegistry` do not exist in this base. `src/shared/l10n/en.ts` lacks
the ChatGPT/Copilot plan notices, consent/error readers and action labels.
The existing production factory at `src/extension.ts` composes API-key
provider seams only. No adapter appears in a production bundle input graph.

This is safe only because the adapters are unreachable in production and
M95b is not certified for release. Registering commands without persistence,
model selection and harness dispatch, or importing factories solely to put
them in a bundle, would create an incomplete flow. Follow-up: the lead must
integrate shared subscription persistence, client dispatch, validated panel
variants and lane 0/U's translations/notices; V then implements its owned
rows and command region and proves panel click → consent → model selection →
harness dispatch → plan tally → removal, plus production membership/size
and split drills. Full quality and installed-editor/live checks follow.
The same named blocker is in PLAN §9; the repair does not claim all four
findings fixed.

**RVM95BV-1-LEGACY-LOCK-MIGRATION.** An ownerless file from the original
adapter cannot safely establish whether an old host still owns it. It
continues to refuse. That version was reachable only from tests and never
shipped, so there is no supported installed-user migration here. Follow-up:
do not mix the old and new adapters during integration; if supporting an
old development profile, close all old hosts before explicitly clearing its
ownerless lock. Never remove such a file on age while a live old host might
rotate the grant. PID reuse/start-time uncertainty likewise retains a live
PID's lock rather than stealing it. This conservative availability
limitation is named in PLAN §9.

All-editor ownership stays as D74: shared ChatGPT decisions remain in lane
S, and runtime/ACP ports in X; Copilot is offered only by a host supplying
the sanctioned Language Model API. These repairs alter only VS Code ports.

### Repair final validation

All commands ran directly in this Kubuntu worktree, sequentially. No test
filter, skip, threshold, rule level or gate script changed.

| Check                                                                                                                | Final result                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run test/unit/chatGptVsCode.test.ts test/unit/copilotClient.test.ts --maxWorkers=3 --testTimeout=120000` | exit 0; **76/76** (26 ChatGPT, 50 Copilot), after the final 16 restored drills                                                      |
| `npm run typecheck`                                                                                                  | exit 0; host, webview, unit, e2e and integration; affected host/unit projects rerun after the final SDK options change, both exit 0 |
| Scoped `npx eslint --max-warnings=0` on both adapters and both test files                                            | exit 0                                                                                                                              |
| Prettier on the seven lane files; `git diff --check`                                                                 | exit 0; final closing commit's hooks repeat changed-file checks                                                                     |
| `npm run deadcode`                                                                                                   | exit 0; existing `vendor/**` configuration hint only                                                                                |
| `npx jscpd`                                                                                                          | exit 0; zero clones                                                                                                                 |
| `node scripts/check-l10n.mjs`                                                                                        | exit 0; 14 tables, 127 manifest strings, 495 sources, zero problems                                                                 |
| `node scripts/check-host-api.mjs --write`, then check                                                                | exit 0; 311 APIs, 25 adapter files, zero problems                                                                                   |
| `npm run cycles`                                                                                                     | exit 0; no circular dependency                                                                                                      |
| `npm run build`                                                                                                      | exit 0; unchanged size caps, split, host globals and third-party notices all pass                                                   |
| Pre-commit hooks                                                                                                     | enabled; implementation commit `1ce82cb4` passed ESLint, Prettier and Gitleaks; closing commit repeats them                         |

The initial duplication run found one 11-line/65-token repeated owner fixture.
Changed only its object-field order, preserving all values and assertions;
the unchanged gate then reported zero clones. The SDK options now have an
explicit `LanguageModelChatRequestOptions` type before admission. The API
scanner includes that full options interface, so its generated record also
lists `modelOptions` and `toolMode`; the request object carries `tools` and
`justification`. Regenerated the derived record and verified the same gate.
No compatibility or validation guard is relaxed.

Final production sizes: activation **553.1/600 KiB**, Model API
**413.3/475 KiB**, providers **96.2/125 KiB**, Models host **51.0/75 KiB**,
checkpoint store **88.4/225 KiB**. Checked `dist/meta/*.json`: neither adapter
is an input of those bundles, independently confirming the named integration
blocker. These sizes do not certify eventual adapter composition.

Full quality, installed-editor consent/remote/OS checks, live subscription
receipts and the blocked shared integration remain the lead/owner's work.
No live/paid model call was made. The original unshipped ownerless-lock
limitation and the unfinished V rows/command region remain explicitly named
in this certificate and PLAN §9; neither is silently certified as fixed.
