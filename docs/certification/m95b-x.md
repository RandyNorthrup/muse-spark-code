# M95b X — ACP runtime sign-in adapter

## FIXM95BX review repair — RVM95BX (2026-10-05, win11)

The follow-up worktree is `C:/lanes/FIXM95BX`, branch `m95b/xfix`, base
`9e4be782`. The rig brief authorizes the previously missing runtime/ACP,
provider configuration and translated-text integration. Its no-merge and
direct-test rules override the older shared host/merge instructions; full
quality remains the lead's gate. No live/paid call or native credential read.

**Finding 2:** every synchronous entry-open and asynchronous read/write/delete
failure at `keyringSecretStore` becomes `StoreUnavailableError` without raw
message, cause or credential. The refresh lock maps it to
`ChatGptSignInError('store-unavailable')`; host creation preserves that fixed
category. This covers Windows logon-session errors, locked/denied macOS
Keychains and absent Linux Secret Service without fragile native-text matching.
Other dependency/network failures retain `request-failed`.

Regression: `classifies native store unavailability through factory and grant
lock` (four synthetic platform failures), and `classifies asynchronous native
read, write and delete failures without retaining their text`.
Whole-file validation: runtimeChatGpt, runtimeChatGptLock and acpRuntime,
**65/65**, exit 0, `--maxWorkers=3 --testTimeout=120000`.

| Drill | Deliberate break                                       | Named failure                                                           | Result                               |
| ----- | ------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------ |
| BX1   | Return generic private error from native store wrapper | Both classification regressions above and real main                     | exit 1, 8 failures; SHA-256 restored |
| BX2   | Remove store category mapping in refresh lock          | `classifies native store unavailability through factory and grant lock` | exit 1, 7 failures; SHA-256 restored |
| BX3   | Remove category preservation in host factory           | Same four platform cases and real main                                  | exit 1, 6 failures; SHA-256 restored |

Receipts: ignored `temp/fixm95bx-drills.json` and per-drill logs. Each mutation
ran the whole runtimeChatGpt file and restored its original bytes in finally,
with SHA-256 equality checked. Native persistence/rotation remains the
previous environment certification limit below, not an outstanding review fix.
These three drills were repeated after wrapping the SecretStore interface:
host-id get/store and record get/store/delete also reduce directly injected
raw errors to the same fixed category. The four platform cases test native
and direct host-port failures; record-operation tests hold the grant lock.

**Finding 1:** cliArgs parses only the exact provider grammar and main dispatches
it to the production runtime factory. ACP advertises add/remove/status as
terminal methods, or full manual commands when the editor lacks terminal auth.
Authentication verifies each action's own local result independently of Meta
and refuses unadvertised methods. Every ACP editor uses this same path;
no editor-specific sign-in implementation or credential bridge was added.

Add reads the owner's captured account catalogue (`models[]`, `slug`,
`visibility`, `supported_in_api`) and atomically saves eligible visible models.
No model slug is invented. The shared file accepts a separate strict variant
pinned to `chatgpt`, its preset, Responses and `https://api.openai.com`; existing
API-key/local guards are unchanged. Invalid or duplicate configuration refuses
and rolls back the grant; removal clears its default model as well as its row.
Notices, actions, status, failure and ACP-neutral callback text are in English
and all fourteen translated tables. Store recovery now says to sign in from an
interactive desktop session with an unlocked store and names Linux's Secret
Service prerequisite, without raw error interpolation.

The unchanged split guard requires provider core exclusively in providers.js.
The existing entry now exports the runtime factory; the ACP dynamic import
resolves to it, installs the caller's language and stays within both budgets.
Packaging includes providers.js and rejects its absence before replacing the
stage. The real main regression bundles the entry with an explicitly synthetic
keyring and HTTP transport, and drives the real callback on loopback; no native
store or live endpoint is reached. README's three new commands each completed
successfully through that entry. The focused package suite executes the real
packager and extracts the provider member from its actual npm tarball.

Production build exited 0 with size, split, host globals and 84-package notices:
activation **553.1/600 KiB**, Model API **413.4/475**, providers **110.5/125**,
Models host **51.0/75**, Models browser **412.4/475**, conversation browser and
its shared chunk **897.3/900**, ACP **800.2/850**, checkpoint store **88.4/225**.
No cap, dependency, suppression, cast or gate changed.

**Named residuals (also PLAN §9):** BX-WIN32-ATOMIC-RENAME is an inherited
Windows EPERM in the simultaneous-save test, reproduced with the original
9e4be782 writer and then restored byte-exact; the writer is unchanged except
the exact subscription schema. Its command failures remain explicit and setup
rolls back. Lane P/integration owns the transaction/retry follow-up.
BX-NATIVE-STORE-CERTIFICATION needs a logged-in desktop session; the brief
forbids native credential reads here. BX-AGGREGATE-M95B retains combined
inference/per-editor acceptance and the owner's precise raw capture receipts
(findings summary: acdc0f60 and 577bc807, 0 + 1 model attempts, revoked grants).
The commands themselves make no inference request. Neither assigned P2 remains.
The attempted broad execStdio file could not collect tests because the rig has
no Bash; it is unchanged in the final Git diff. Focused npm-pack regressions pass (2/2),
and actual deferred-bundle regressions pass (28/28).
BX-HOST-API-INVENTORY is exactly the inherited stale Node import inventory
from RVM95BX: crypto 35→36, http 3→4, net 4→5, timers/promises 3→4.
The check finds no portable-boundary violation; integration owns regeneration
and review of that shared record. No assigned finding is deferred by this
inventory failure.

### Final scoped validation

All checks ran directly on win11. Test commands ran whole files, at most three
per invocation, with `--maxWorkers=3 --testTimeout=120000`.

| Check                                                                      | Result                                                                                                                                                                      |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| runtimeChatGpt, acpAgent, runtimeChatGptPackage                            | Exit 0; 127/127 (35 + 90 + 2)                                                                                                                                               |
| runtimeChatGptCallback, runtimeChatGptLock, acpRuntime                     | Exit 0; 59/59 (18 + 5 + 36)                                                                                                                                                 |
| deferredBundles, actual production build                                   | Exit 0; 28/28                                                                                                                                                               |
| providersPolicy                                                            | 24/25 on the failing Windows run; the identical simultaneous-rename failure reproduces with the original writer. Earlier whole-file runs also passed; no assertion changed. |
| npm run typecheck                                                          | All five projects, exit 0                                                                                                                                                   |
| Scoped ESLint, max-warnings=0; Prettier on changed files                   | Exit 0                                                                                                                                                                      |
| npm run deadcode; npx jscpd                                                | Exit 0; duplication reports zero clones                                                                                                                                     |
| node scripts/check-l10n.mjs                                                | Exit 0; 14 languages, 127 manifest strings and 497 source files, zero problems                                                                                              |
| node scripts/check-host-api.mjs                                            | Exit 1; BX-HOST-API-INVENTORY only, same four counts as baseline review                                                                                                     |
| npm run build                                                              | Exit 0; unchanged size/split/globals/notices gates, sizes above                                                                                                             |
| node scripts/package-acp.mjs; staged acp.js --help; tar member listing     | Exit 0; actual 0.12.1 tarball includes providers.js, and the packaged entry prints the provider grammar without a native store or network call                              |
| Full quality, native store, live inference and installed-editor acceptance | Reserved for the lead or prohibited by this rig brief; not claimed                                                                                                          |

The worktree's pre-commit hook runs serial lint-staged and staged redacted
gitleaks. The rig's portable sh lacks Bash, so ignored temp/hook-bin/npx
delegates to the already installed npm CLI; no hook, Git configuration or
machine setting is changed. The first repair commit passed both hook steps.

### Additional red drills

Every row below exited **1**, failed the named whole-file regression and
restored the original source bytes in finally with matching SHA-256. All
Vitest invocations used `--maxWorkers=3 --testTimeout=120000`; no name filter
or new skipped test. BX21/BX22 run the whole deferredBundles file, including
its real production build; BX20 runs the real npm-pack fixture suite.
Receipts and per-drill logs are in ignored temp/fixm95bx-integration-drills.json,
temp/fixm95bx-port-drills.json and temp/fixm95bx-schema-drills.json.

| Drill | Guard broken                       | Named failed regression                                                                                                            |
| ----- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| BX4   | Real CLI provider parser           | `parses real provider commands and rejects extra credentials and options without echoing them`                                     |
| BX5   | Main dispatch                      | `dispatches real main add, status and remove using only the captured account models and atomic configuration`                      |
| BX6   | ACP action advertisement           | `exposes all three ChatGPT actions to terminal and manual editors and verifies them independently of Meta`                         |
| BX7   | ACP action verification route      | Same ACP regression                                                                                                                |
| BX8   | Unadvertised method refusal        | Same ACP regression, ready backend with unknown method                                                                             |
| BX9   | Pinned subscription origin         | `pins subscription configuration without widening existing auth or origin guards`                                                  |
| BX10  | Strict secret-free entry           | Same schema regression                                                                                                             |
| BX11  | Captured boolean catalogue field   | `rolls back sign-in when the captured catalogue has no usable model or is malformed`                                               |
| BX12  | Hidden-model exclusion             | Real main add/status/remove regression                                                                                             |
| BX13  | API eligibility filter             | Real main add/status/remove regression                                                                                             |
| BX14  | Invalid provider-file refusal      | `preserves invalid or existing provider configuration and rolls back the grant`                                                    |
| BX15  | Duplicate provider refusal         | Same configuration regression                                                                                                      |
| BX16  | Removed default-model reference    | Real main add/status/remove regression                                                                                             |
| BX17  | Actionable store message           | `reports an actionable native store failure from the real main without raw text`                                                   |
| BX18  | Add requires a local grant         | `supplies an actionable fixed store-unavailable message and verifies provider actions independently of Meta`                       |
| BX19  | Remove requires local absence      | Same action verification regression                                                                                                |
| BX20  | Required packaged provider bundle  | `ships the lazy ChatGPT runtime in the actual npm tarball`; missing-member stage-preservation regression also fails                |
| BX21  | Lazy bundle language installation  | `installs the caller language before translated ChatGPT failures leave the lazy bundle`                                            |
| BX22  | ACP/provider split mapping         | `keeps ChatGPT runtime and core in providers.js behind the real ACP dynamic import`; the unchanged split guard rejects leaked core |
| BX23  | Host-id read error classification  | Four native/direct factory classification cases                                                                                    |
| BX24  | Host-id write error classification | Same four factory cases                                                                                                            |
| BX25  | Record read error classification   | `classifies every failing injected record operation inside the grant lock`                                                         |
| BX26  | Record write error classification  | Same record-operation regression                                                                                                   |
| BX27  | Record delete error classification | Same record-operation regression                                                                                                   |
| BX28  | Empty usable catalogue refusal     | Catalogue rollback regression requires the fixed sign-in-required code                                                             |
| BX29  | Nonempty configured model list     | Pinned schema regression                                                                                                           |
| BX30  | Pinned provider id                 | Pinned schema regression                                                                                                           |
| BX31  | Pinned preset                      | Pinned schema regression                                                                                                           |
| BX32  | Pinned Responses format            | Pinned schema regression                                                                                                           |
| BX33  | Nonempty configured model id       | Pinned schema regression                                                                                                           |
| BX34  | Nonempty captured catalogue slug   | Catalogue rollback regression requires invalid-token before file commit                                                            |

## Original lane record (historical; the repair above supersedes its dispatch boundary)

Worktree `C:/lanes/M95BX`, branch `m95b/x`, base `180c85b2`, Windows 11
rig, 2026-10-05. This certifies the offline runtime adapter and injected
command front end, **not executable CLI dispatch or aggregate M95b support**.
No live sign-in, model request, paid call, other application's credential
read, dependency, cast, suppression, gate change, push, merge or rebase.

## Implemented contract

- `src/runtime/chatGptCallback.ts`: real one-shot
  `http://127.0.0.1:<random-port>/auth/callback`, GET/path/Host/origin checks,
  S's captured callback validation, a deadline starting at listen and capped
  at ten minutes, cancellation, idempotent close and destruction of incomplete
  connections. The fixed translated page is read at response time and sent
  as plain text with no-store, no-referrer and nosniff headers. Provider errors,
  callback values and HTML metacharacters are never reflected as HTML.
- `src/runtime/chatGptRefreshLock.ts`: an exclusive loopback listener at
  `CHATGPT_REFRESH_LOCK_PORT` (49953) serializes OS-store mutations across
  processes. A crash releases it in the OS, without a stale file or a lease
  that could expire while its owner still works. Waiters have a ten-minute
  admission deadline, honor cancellation and never steal an occupied port.
  The listener closes accepted connections; it transmits no data. This is
  machine-wide, intentionally conservative across users. A conflicting local
  service can deny availability; contention fails closed and is reported.
- `src/runtime/chatGptHost.ts`: S's `ChatGptHostPort` over the existing
  `keyringSecretStore` / `SecretStore` contract. The grant is under the
  `museSpark.provider.chatgpt` account and a separate
  `museSpark.provider.chatgpt.host-id` account keeps the opaque installation
  id across removal. Initialization and every grant mutation use the process
  lock. Records are parsed with S's origin/issuer-bound zod schema, and HTTP
  cancellation combines the caller and request signals. Browser/terminal
  handoff, translated callback text and fetch are injected; no editor API,
  credential file, child launcher or user/account identity is involved.
- `src/runtime/chatGptProviderCommands.ts`: exact
  `providers add|remove|status chatgpt` grammar, rejecting Copilot and all
  extra arguments, including credential arguments. Add requires the plan
  notice before browser handoff, refuses to overwrite an unrevoked grant,
  and reports success only after the required injected nonsecret provider
  configuration commits. Failure attempts revocation and deletes the grant.
  Remove clears configuration even when revocation fails. These operations
  hold the same grant lock through setup/removal/rollback. Status reads only
  local state (present, expired or absent), never refreshes or calls a model.
  Wire/store/browser/dependency failures are reduced to technical codes before
  translated output; no record or identity enters that output.

Integration must use this runtime host for every non-VS Code editor named
in the brief: JetBrains, Visual Studio, Eclipse, Zed, Xcode, Neovim, Emacs,
Sublime and the companion page, through their runtime/ACP integration.
There is no CLI-only credential or refresh implementation. Editor shells and
the shared React UI remain their existing host integrations' responsibility.
The single-model Meta path and paid defaults/consent are untouched. Plan use
does not introduce a paid popup or a dollar-budget tally.

## Evidence and boundaries still owned by other lanes

Read AGENTS, PLAN D74/M95b in full, m95-research §6, m95-captures,
m95b-s and the supplied shared rules/findings. The owner's findings name
`acdc0f60…` and `577bc807…` on 2026-10-05, **0 + 1 model attempts**,
and successful revocations. This lane reuses S's parser/schema and makes no
new inference-wire assumptions. Its tests generate RSA material and synthetic
grants. Precise raw capture workspace/receipts and the earliest-refresh policy
remain the inherited S/W certification dependency; no capture is invented.

**Stopped at the ownership boundary.** The brief says “do not edit files
another lane owns — if you must, stop and say so in the final message.”
Lane 0 owns en.ts/all fourteen tables/manifest text, and W owns provider-file/
registry wiring, README, PRIVACY, CHANGELOG, PLAN and aggregate certification.
The base has no ChatGPT terminal notice/status/failure text, and its existing
callback page says to return to VS Code. An asynchronous ownership ruling was
requested; no affirmative answer was received. No other lane's files were edited.

Integration must supply the **required** `ChatGptCommandText` and
`providers.add/remove` ports, then connect the exact parser/handler to
main.ts/cliArgs.ts. The factory's `openBrowser` prints the authorize URL
for a terminal; editor adapters may open their own browser. Pass an abort
signal for editor cancellation/terminal shutdown. Text must state Plus/Pro
eligibility and the plan/credit caveat before browser handoff, provide an
ACP-neutral completion page, describe local expired/absent state, and map
the core's technical errors without service text. Provider configuration must
accept subscription auth, obtain models from the account's catalogue, commit
atomically and register S's access-token source with C's codec. No production
no-op, guessed model slug or credential-schema widening was added as a seam.
**The installed executable does not yet dispatch these provider commands.**

## Windows native-store limitation

`node test/hosts/runtime-chatgpt-store.mjs` bundles the real runtime adapter
and keyStore.ts, uses @napi-rs/keyring under a fresh UUID-named synthetic test
service, and checks persistence plus one rotation across two real child
processes. Only nonsecret service/bundle/tally paths reach child arguments;
no credential reaches their environment, arguments or files. The tally holds
only the word “refresh”; cleanup attempts both isolated entries and removes
the workspace scratch directory.

Both native attempts here failed with
`Windows ERROR_NO_SUCH_LOGON_SESSION` (exit 1). The initial check and final
actual-keyStore/preflight check found the same unavailable Windows logon
context. No machine setting or user credential was changed. **Native OS-store
persistence/rotation is not certified**; rerun this exact script from the
rig's logged-in user session. Map-backed OS-port tests pass; actual loopback,
cross-process exclusion and crash recovery also pass on this rig.

## Tests and deliberate failures

Runs were direct on win11, whole files, at most three files and
`--maxWorkers=3 --testTimeout=120000`; no skipped test or name filter.
Final suite: **42/42** across runtimeChatGpt.test.ts (19),
runtimeChatGptCallback.test.ts (18), runtimeChatGptLock.test.ts (5).

One initial callback harness failure was Node fetch ignoring a forged Host
header. Replaced that request with node:http so the test exercises the
intended header; it passes. The initial release mutation left its deliberately
broken fixture child alive; that exact workspace test process was stopped,
a bounded child-exit check added and drill 21 repeated with automatic cleanup.
An initial configuration-admission mutation made a readiness await reach the
test deadline; the test now races readiness against premature completion,
and drill 41 was repeated without that wait. Initial logs are retained.

**44 distinct guard drills** each exited 1 with the named test below and
restored the original source bytes in finally, comparing SHA-256. Command
drills 34–40 were repeated after the configuration-lock refinement and grammar
formatting. Complete JSON/log receipts remain in ignored temp/m95b-x/;
drills-final.json consolidates the latest successful evidence.

| #   | Guard deliberately broken                        | Named failed test                                                                                                                                  | Result               |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | Loopback-only listener                           | ACP ChatGPT callback binds the exact loopback route and returns one captured callback with a plain localized page                                  | exit 1; SHA restored |
| 2   | Opaque state input                               | ACP ChatGPT callback refuses an invalid state and an already cancelled start                                                                       | exit 1; SHA restored |
| 3   | Finite callback deadline                         | ACP ChatGPT callback refuses an invalid callback lifetime NaN                                                                                      | exit 1; SHA restored |
| 4   | Positive callback deadline                       | ACP ChatGPT callback refuses an invalid callback lifetime 0                                                                                        | exit 1; SHA restored |
| 5   | Ten-minute callback maximum                      | ACP ChatGPT callback refuses an invalid callback lifetime 600001                                                                                   | exit 1; SHA restored |
| 6   | GET-only callback                                | ACP ChatGPT callback ignores wrong paths, methods and Host headers without consuming the callback                                                  | exit 1; SHA restored |
| 7   | Host header match                                | ACP ChatGPT callback ignores wrong paths, methods and Host headers without consuming the callback                                                  | exit 1; SHA restored |
| 8   | Absolute callback origin                         | ACP ChatGPT callback ignores wrong paths, methods and Host headers without consuming the callback                                                  | exit 1; SHA restored |
| 9   | Exact callback path                              | ACP ChatGPT callback binds the exact loopback route and returns one captured callback with a plain localized page                                  | exit 1; SHA restored |
| 10  | Captured callback validation                     | ACP ChatGPT callback rejects malformed, forged or refused callback ?code=synthetic&state=wrong&client_id=issued&scope=direct without reflecting it | exit 1; SHA restored |
| 11  | Plain-text localized body                        | ACP ChatGPT callback binds the exact loopback route and returns one captured callback with a plain localized page                                  | exit 1; SHA restored |
| 12  | No-store callback                                | ACP ChatGPT callback binds the exact loopback route and returns one captured callback with a plain localized page                                  | exit 1; SHA restored |
| 13  | No-referrer callback                             | ACP ChatGPT callback binds the exact loopback route and returns one captured callback with a plain localized page                                  | exit 1; SHA restored |
| 14  | No content sniffing                              | ACP ChatGPT callback binds the exact loopback route and returns one captured callback with a plain localized page                                  | exit 1; SHA restored |
| 15  | One callback waiter                              | ACP ChatGPT callback binds the exact loopback route and returns one captured callback with a plain localized page                                  | exit 1; SHA restored |
| 16  | Deadline begins on listen                        | ACP ChatGPT callback starts its deadline before wait and closes on timeout                                                                         | exit 1; SHA restored |
| 17  | Abort settles callback promptly                  | ACP ChatGPT callback cancels and destroys incomplete requests, including cancellation before wait                                                  | exit 1; SHA restored |
| 18  | Incomplete connections destroyed                 | ACP ChatGPT callback cancels and destroys incomplete requests, including cancellation before wait                                                  | exit 1; SHA restored |
| 19  | Language read at response time                   | ACP ChatGPT callback binds the exact loopback route and returns one captured callback with a plain localized page                                  | exit 1; SHA restored |
| 20  | No concurrent lock ownership                     | ACP ChatGPT process lock serializes callers and releases after success                                                                             | exit 1; SHA restored |
| 21  | Release lock on operation failure                | ACP ChatGPT process lock releases after a thrown operation and withholds its secret-bearing error                                                  | exit 1; SHA restored |
| 22  | Lock acquisition deadline                        | ACP ChatGPT process lock never steals a live process lock, and times out or cancels without running work                                           | exit 1; SHA restored |
| 23  | Cancellation before dispatch                     | ACP ChatGPT process lock refuses an already cancelled acquisition before running work                                                              | exit 1; SHA restored |
| 24  | Lock failure text withheld                       | ACP ChatGPT process lock releases after a thrown operation and withholds its secret-bearing error                                                  | exit 1; SHA restored |
| 25  | Provider OS account name                         | ACP ChatGPT OS-store adapter and commands adds through the real callback, keeps only our origin-bound OS record, then reports and revokes it       | exit 1; SHA restored |
| 26  | Opaque persistent installation id                | ACP ChatGPT OS-store adapter and commands refuses a nonopaque host id and sanitizes secret-store failures                                          | exit 1; SHA restored |
| 27  | Installation id initialization lock              | ACP ChatGPT OS-store adapter and commands initializes one opaque installation id under the process lock                                            | exit 1; SHA restored |
| 28  | OS-record read validation                        | ACP ChatGPT OS-store adapter and commands refuses a malformed stored record before a request                                                       | exit 1; SHA restored |
| 29  | OS-record write validation                       | ACP ChatGPT OS-store adapter and commands refuses an invalid record at the write boundary before touching the OS store                             | exit 1; SHA restored |
| 30  | OS-record deletion                               | ACP ChatGPT OS-store adapter and commands adds through the real callback, keeps only our origin-bound OS record, then reports and revokes it       | exit 1; SHA restored |
| 31  | Runtime refresh serialization                    | ACP ChatGPT OS-store adapter and commands rotates once across two runtime hosts and rereads the OS record inside the lock                          | exit 1; SHA restored |
| 32  | Cancellation reaches HTTP                        | ACP ChatGPT OS-store adapter and commands propagates cancellation to HTTP requests without sending any credential to a child                       | exit 1; SHA restored |
| 33  | Other credential stores forbidden                | ACP ChatGPT OS-store adapter and commands has no dependency on another application credential path or a child launcher                             | exit 1; SHA restored |
| 34  | Status host-port validation                      | ACP ChatGPT OS-store adapter and commands validates status records from the injected host port                                                     | exit 1; SHA restored |
| 35  | Never overwrite an unrevoked grant               | ACP ChatGPT OS-store adapter and commands refuses to overwrite a grant, including two concurrent add commands                                      | exit 1; SHA restored |
| 36  | Command failures withheld                        | ACP ChatGPT OS-store adapter and commands sanitizes a secret-bearing command dependency failure                                                    | exit 1; SHA restored |
| 37  | Provider-command verb                            | ACP ChatGPT OS-store adapter and commands accepts only the three exact ChatGPT provider commands                                                   | exit 1; SHA restored |
| 38  | No Copilot outside VS Code                       | ACP ChatGPT OS-store adapter and commands accepts only the three exact ChatGPT provider commands                                                   | exit 1; SHA restored |
| 39  | No extra credential argument                     | ACP ChatGPT OS-store adapter and commands accepts only the three exact ChatGPT provider commands                                                   | exit 1; SHA restored |
| 40  | Only supported provider actions                  | ACP ChatGPT OS-store adapter and commands accepts only the three exact ChatGPT provider commands                                                   | exit 1; SHA restored |
| 41  | Configuration commits before success             | ACP ChatGPT OS-store adapter and commands adds through the real callback, keeps only our origin-bound OS record, then reports and revokes it       | exit 1; SHA restored |
| 42  | Configuration removed even on revocation refusal | ACP ChatGPT OS-store adapter and commands deletes locally and reports a revocation refusal without its body                                        | exit 1; SHA restored |
| 43  | Setup failure revokes and deletes the grant      | ACP ChatGPT OS-store adapter and commands revokes and rolls back the grant if provider configuration cannot be saved                               | exit 1; SHA restored |
| 44  | Configuration and removal share the grant lock   | ACP ChatGPT OS-store adapter and commands holds the grant lock until provider configuration finishes before removing                               | exit 1; SHA restored |

## Validation

| Check                       | Result                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Full five-project typecheck | Exit 0 after final setup/rollback refinement                                                                                           |
| Scoped ESLint               | Exit 0, all ten changed code/test files, zero warnings                                                                                 |
| Scoped Prettier             | Exit 0, all eleven changed files                                                                                                       |
| knip                        | Exit 0 after placing the process fixture under test/hosts (an existing entry glob); inherited vendor configuration hint only           |
| jscpd                       | Exit 0 after final refinement; 974 files, zero clones                                                                                  |
| check-l10n                  | Exit 0; 14 tables, 127 manifest strings, 497 source files, zero problems                                                               |
| check-host-api              | Exit 1: generated import counts only (crypto 35→36 inherited from S, http 3→4, net 4→5, timers/promises 3→4); W/lead owns regeneration |
| Production build            | Exit 0; size, split, host globals and 84-package notices pass                                                                          |
| Native store                | Exit 1; Windows logon-session limitation above                                                                                         |

Full npm run quality is reserved for the lead by the supplied common.md
(“NEVER run npm run quality or the full npm test”), as is final aggregate
certification. The rig brief also forbids merging/rebasing/pushing, overriding
the older shared merge instruction. No gate was weakened. Hooks were installed
with npx.cmd --no-install husky, and .husky/_/pre-commit exists.

Current production sizes: activation **553.1/600 KiB**, Model API
**413.4/475 KiB**, providers **96.2/125 KiB**, Models panel **51.0/75 KiB**,
Models webview **411.4/475 KiB**, conversation webview including its shared
chunk **896.4/900 KiB**, ACP **798.8/850 KiB**, checkpoint store
**88.4/225 KiB**. The new adapter is not imported by main.ts yet; these
are the current shipped-entry sizes. W must recheck integrated budgets and
split guards when wiring it. No cap changed.

Implementation commit `dfa2e7ae4018bcfa530dc09bcf44aebc6fbbfa3f` ran the
unchanged pre-commit hooks: serial lint-staged ESLint/Prettier and staged
gitleaks (**70,240 bytes**, no leaks). The first commit attempt failed before
those checks because this portable Windows rig has sh but no Bash, while
its installed npx launcher requires Bash. An ignored workspace-local
`temp/m95b-x/hook-bin/npx` invokes the same installed Node/npm npx-cli.js
through sh; only that commit process's PATH was prefixed. No hook, shared
installation, machine/user setting or gate was changed. Source checksums
below remained equal after the successful hooks. The documentation follow-up
also uses those unchanged hooks and the process-local launcher.

### Source checksums

- `src/runtime/chatGptCallback.ts`: `455e583a6dc1e4cd5c9cf158dffd875c8eb28d13b86464e55f7a0757aae6af91`
- `src/runtime/chatGptRefreshLock.ts`: `66e972341e2015a4cadb5e9b1b4f0265d0e545e7c7687627e7575b3846792095`
- `src/runtime/chatGptHost.ts`: `cafcc7bee7a9e8b17b5abce2e456bcaca165fd53bf845f08d7dd9be9cd4cf2a8`
- `src/runtime/chatGptProviderCommands.ts`: `96c41e9b7ccad946a9797f2d7f60b07c98bf89de7f585d2402d809095966d64a`
