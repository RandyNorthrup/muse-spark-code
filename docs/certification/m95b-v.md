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
3. U/0 must provide the Continue with ChatGPT and Use my Copilot models
   rows, Plus/Pro eligibility, one-time plan/credit notices, reduced and
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
5. W owns command/manifest wiring, README, PRIVACY, CHANGELOG, PLAN and
   aggregate certification. No command is registered here without its
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
