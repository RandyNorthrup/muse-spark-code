# Certification: DFACPERR — ACP reports refusals honestly, not as "Internal error"

Lane DFACPERR2, branch `fix/acp-refusal-honesty`, from e4111825c.
Scope/status/checklist: PLAN.md §6 `DFACPERR` (round-2 record; round 1
below is the prior certification, kept for traceability).

## Round 2 — repair of review RVDFACPERR (1 P1, 4 P2, 2 P3), 2026-10-10

Worktree `/Users/randy/lanes/DFACPERR2`, rig macmini. No new strings, no new
commands/settings/features, no new dependency, no widened guard.

- **P1 — one RequestError identity.** `src/acp/sharing.ts` no longer imports
  the SDK. Refusals, bad input and internal faults cross the lazy sharing
  bundle as `AcpSharingFailure` (code `-32600 | -32602 | -32603`), read with
  `isAcpSharingFailure` (name + code, never `instanceof` — the class is
  bundled twice). `src/acp/agent.ts` owns the single `RequestError`
  constructor and maps failures at the sharing call site
  (`sharingRequestError`; cancellation passes through). Verified:
  `dist/sharingRuntime.js` back under its 175 KiB cap (see Gates).
- **P2 validation.** Caller-owned mini-zod failures in `SharingCommands`
  become the flag that carried them via `SharingArgumentError`
  (`src/runtime/sharing/args.ts`, `commands.ts`): `--exported-at`,
  `--attachment-content` (incl. empty), `--title`/`--tag`, `--from/--to`,
  `--mode`/`--format`/`--destination`. Service-data validation
  (`previewSchema`, stored prompts, `promptLoadSchema`) rethrows and stays
  internal. The existing legal test that pinned a scanner `Error` to -32600
  was updated to the new contract (unexpected scanner fault is -32603; the
  defined `legalScanUnavailable` refusal keeps -32600).
- **P2 lifecycle.** `AcpSession.sessionCommand` maps the backend's typed
  `SessionNotLoadedError` (MSP `sessionNotLoaded`: evicted/closed) to
  `RequestError.resourceNotFound(sessionId)` on every mode/model/effort
  command (`setMode`, `setConfigOption` model, `applyEffort`,
  `matchAdvertised`). Other backend failures propagate as before.
- **P2 classification.** `runLegalScan` and the vault command catch now
  distinguish the defined refusal (message equals `legalScanUnavailable` /
  `vault.brokerBlocked`, as the real scanner and vault loader throw) from
  genuine faults, which stay -32603 with the fixed `actionFailed` reason;
  the raw failure is logged server-side via `failureForLog` (never the
  CLI's message).
- **P2 privacy.** `createAcpSharing` never rethrows an unexpected error:
  it becomes `AcpSharingFailure(-32603, promptFileInvalid)`, so SDK 1.7.0
  finds no path, prompt text or diagnostics for `error.data.details`.
- **P3 localization.** Parser failures surface the installed-language
  `acpUnknownArgument` reason: the parser's own `SharingArgumentError`
  message passes through; Node option diagnostics and JSON quote failures
  become `localArgumentError(text)`. Pinned in German.
- **P3 traceability.** PLAN.md §6 `DFACPERR` carries scope, status and the
  checklist; `docs/roadmap/entries.json` carries the internal entry;
  `ROADMAP.md` regenerated (`check:plan` 208 milestones, 0 drift;
  `check:roadmap` current).

Sibling sweeps: all `this.session.*` mode/model/effort commands routed
through `sessionCommand`; all caller-owned schema parses in
`SharingCommands.share`/`execute` classified; both ACP catch-alls that
mapped unexpected faults to refusals fixed; both sharing error exits
(parse + execute) sanitized and localized. Turn-path backend failures keep
their terminal channel; `accountErrorText` already emits fixed strings
only; media-attach and estimate paths untouched (outside the findings).

## Tests (repository timeouts, no `--testTimeout`)

New/updated per handler, all through the real SDK client except where noted:

- `test/unit/acpSharing.test.ts`: caller-owned validation trio (-32602 +
  flag); failure identity (`isAcpSharingFailure`, not an SDK `RequestError`);
  independently esbuild-bundled sharing copy still maps to -32600 (the
  shipped split); unexpected preview/store faults internal with no raw text;
  German parser pair (bad flag, bad quotes).
- `test/unit/acpAgent.test.ts`: unloadable scanner -32600; scanner
  `TypeError` -32603 + `actionFailed`, no raw text; evicted-session trio
  (`set_mode`, model and effort options) -32002 with the session id, no
  backend message.
- `test/unit/acpVault.test.ts`: broker-cannot-start -32600; throwing broker
  and malformed broker status -32603 + `actionFailed`, no raw text.

Results (macmini, this worktree): acpSharing 42/42; acpVault 23/23;
acpAgent 149/150 — the one failure (`exposes all three ChatGPT actions…`)
also fails on pristine HEAD e4111825c, pre-existing and unrelated.
acpAccounts 29/29 (portion of the joint run). `runtimeSharing.test.ts`
`aliased workspace` pair fails identically on pristine HEAD on this rig
(symlink/canonicalization environment), pre-existing and unrelated; all
other cases in that file pass.

## Red drills (byte-exact restores, SHA-256 verified)

Pre-drill hashes: sharing.ts `5688bd99…`, agent.ts `38995bf6…`, args.ts
`fea43fa0…`, commands.ts `503f4237…`; all four match after every drill.

1. D1 (P1): SDK import + SDK-constructed refusal restored in sharing.ts →
   `maps an independently bundled sharing copy…` fails; restored.
2. D2 (P2 validation): `callerOwnedError` forced to undefined →
   attachment-content and save-tag naming tests fail (-32603); restored.
   (`--exported-at` has its own inline guard and stays -32602.)
3. D3 (P2 lifecycle): `sessionCommand` rethrows without mapping → evicted
   trio fails; restored.
4. D4a (P2 classification): legal catch back to unconditional refusal →
   scanner-fault test fails; restored.
5. D4b (P2 classification): vault catch back to unconditional refusal →
   both broker-fault tests fail while the defined-refusal test passes;
   restored.
6. D5 (P2 privacy): sharing catch back to `throw error` → both sanitized
   tests fail (secret in `data.details`); restored.
7. D6 (P3 localization): parse catch back to raw `error.message` → both
   German tests fail; restored.

## Gates

`tsc --noEmit` 0; `eslint --max-warnings=0` on changed files 0;
`prettier --check` on changed files clean; `check:l10n` 0 problems (no new
text); `check:host-api` 0 problems; `check:plan` 0 drift; `check:roadmap`
current; `npm run build` exit 0 with `dist/sharingRuntime.js` back under
its 175 KiB budget and `dist/acp.js` back to its pre-lane size;
`deadcode` exit 0. No `featureCatalog`/reference change (no new command,
setting or feature). No `check:tokens`/`check:visual` impact (no visual
change). The common.md merge step was skipped: the rig note forbids merges
the brief does not list, and this brief lists none.

## Round 3 — repair of review RVDFACPERR2 (1 P3), 2026-10-10

Worktree `/Users/randy/lanes/DFACPERR2`, rig macmini. No new strings, no new
commands/settings/features, no new dependency, no widened guard.

- **P3 — honest unexpected-fault message.** `src/acp/sharing.ts:210`: the
  execute catch-all now throws
  `AcpSharingFailure(-32603, UI_TEXT.actionFailed)` (`That did not work (the
Muse Spark log has the details)`) instead of `UI_TEXT.promptFileInvalid`.
  A failed chat export or an unreadable prompt library is not a prompt-file
  format error, and the new sentence points at the log. Genuine prompt-file
  format errors still pass through as defined refusals with their own
  sentence via the `sharingRefusal` list (unchanged).
- **Log honesty.** `src/acp/agent.ts:1920-1929`: the sharing call-site catch
  now logs an internal sharing fault server-side via `failureForLog` (name
  only, never raw text or paths) before mapping it, so the wire sentence's
  "the log has the details" is true. Refusals and bad input stay unlogged,
  as do cancellations (non-`AcpSharingFailure` passes through untouched).
  This mirrors the legal (`:1191`) and vault (`:1689`) catches.

Sibling sweep (whole class, lane files only): `sharing.ts:138` keeps
`promptFileInvalid` as a _defined-refusal_ passthrough (thrown deliberately
by `commands.ts:190` scope/duplicate validation, `:366` prompt-not-found,
promptStore/promptLibrary/promptImport and the host prompt commands — all
fixed sentences, nothing raw); `commands.ts:190/:366` stay refusals, not
unexpected faults; `agent.ts:1890` stays deterministic caller-shape
validation (-32602, pinned by `rejects mixed/attached content`); legal and
vault catches already send `actionFailed` with a log entry (review found
them fine). No other sharing/prompt catch maps an unexpected fault to a
bad-prompt-file sentence.

## Tests (repository timeouts, no `--testTimeout`)

`test/unit/acpSharing.test.ts` — the two privacy tests now also assert the
wire message contains `UI_TEXT.actionFailed`, the wire carries no
`promptFileInvalid` sentence, the server log got a `sharing command failed`
entry, and the log entries carry no path or prompt text. Both run end to
end through the real SDK client into the agent.

Results (macmini, this worktree): acpSharing 42/42; acpVault 23/23;
acpAgent 149/150 — the one failure (`exposes all three ChatGPT actions…`)
fails identically on pristine lane base `e4111825c` in a temporary worktree
with this rig's `node_modules` (then removed), pre-existing and unrelated
(authenticate flow; this lane touches only sharing paths).

## Red drill (byte-exact restore, SHA-256 verified)

Pre-drill hashes: sharing.ts `c325e10f…`, agent.ts `7f30a4fd…`,
acpSharing.test.ts `e5124e46…`; all three match after the drill.

8. D8 (P3): catch-all back to `UI_TEXT.promptFileInvalid` →
   `keeps an unexpected sharing failure internal with no path or prompt
text` and `keeps a prompt-store failure internal with no raw text` both
   fail; restored (all three hashes match).

## Gates

`npm run typecheck` exit 0 (all five projects); `eslint --max-warnings=0`
on changed files clean; `prettier --check` on changed files clean;
`check:l10n` 0 problems (reused key, no new text); `npm run build` exit 0
with `dist/sharingRuntime.js` 160.8 KiB (budget 175 KiB),
`dist/extension.js` 550.1 KiB (budget 600 KiB). No `featureCatalog`/
reference change. No `check:tokens`/`check:visual` impact.

Incidental pre-existing fix (same files, one line): `typecheck:unit`
failed at lane HEAD `f31798e75` on
`test/unit/acpAgent.test.ts:998` (`userMessageId: undefined` against
`exactOptionalPropertyTypes`). The property is simply omitted now; the
`refuses a turn the backend would not take` test passes unchanged
(verified with `-t`), and the full typecheck is green. Not a review
finding; recorded here so the lead sees it.

## Round 4 — repair of review RVDFACPERR3 (1 P2, 2 P3), 2026-10-10

Worktree `/Users/randy/lanes/DFACPERR2`, rig macmini. No new strings, no new
commands/settings/features, no new dependency, no widened guard. Supersedes
the round-2 privacy bullet (the catch-all sentence), the round-2 sibling-sweep
claim that no other catch maps an unexpected fault to a bad-prompt-file
sentence, and the lead note's `-32603` sentence below — all three described
the pre-fix contract.

- **P2 — the log names the underlying fault.** `AcpSharingFailure` carries
  the original fault as `cause` (the `src/acp/sharing.ts` execute catch-all
  passes `{ cause: error }`). The engine logs
  `internalFaultForLog(error)` — new in
  `src/core/backends/musecode/logText.ts`: it walks the `cause` chain to the
  root fault, then `failureForLog`, so the log keeps a name only, never raw
  text, a path or prompt text — at `src/acp/agent.ts:1926`. A `TypeError`
  from the preview renderer now logs `sharing command failed: TypeError`,
  not `AcpSharingFailure`. The wire is unchanged: the engine maps only the
  fixed message, and the SDK never serializes `cause`. Headless ACP
  (`serve`) uses the same agent class, so it logs the same line.
- **P3 — headless `share`/`prompts` keep defined refusals.**
  `runRuntimeSharing` (`src/runtime/sharing/sharingEntry.ts`) keeps every
  defined refusal through the shared `sharingRefusal` list (now exported from
  `src/acp/sharing.ts`) — including `exportNothing` on an empty chat and
  `promptStoreDamaged` on an unreadable library — and reports anything else
  (including non-`Error` throws) as `actionFailed` on stderr, with the
  underlying fault's name in the log via a new optional `log` argument wired
  from `src/runtime/main.ts`.
- **P3 — the editor boundary keeps defined refusals.** `safePromptFailure`
  (`src/host/prompts/promptEntry.ts`) keeps the same refusal list plus the
  `promptVariables:` prefix the ACP adapter already keeps, and maps anything
  else to `actionFailed` with the original as `cause`, logging the underlying
  name through a new optional `PromptHostDeps.log` (set in `nativeDeps`;
  used at the `runPromptCommand` catch and both webview sharing-action
  sites). Same-class siblings fixed too: `promptBundleLoader` and
  `runtimeSharingLoader` `unavailable` are now `actionFailed` — an unloadable
  bundle is an installation fault, and the loader already logged the cause —
  instead of `promptFileInvalid`.

## Tests (repository timeouts, no `--testTimeout`)

- `test/unit/acpSharing.test.ts`: the two privacy tests throw `TypeError`
  fakes and now assert the log names `TypeError` (and never the
  `AcpSharingFailure` wrapper, path or prompt text), all through the real SDK
  client; new `carries the original fault as cause on an internal sharing
failure` pins the adapter's `cause` chain directly.
- `test/unit/runtimeSharing.test.ts`: new `keeps a defined empty-chat
refusal instead of a prompt-file error` (empty chat keeps `exportNothing`,
  exit 7, nothing logged), new `reports an unexpected headless fault as
internal with the fault named in the log` (`TypeError` backend read keeps
  raw text off stderr and names the fault in the log), new `reports an
unloadable sharing bundle as internal, not a prompt-file error`. The file
  pins `userInfo()` to `fixture`: this sandbox has no passwd entry, so the
  real call throws `SystemError` and every real-`renderPreview` share test
  failed here — including the round-2/round-3 `aliased workspace` pair, which
  now passes (environmental, not a product change).
- `test/unit/promptEntry.test.ts`: the init-failure test now throws a
  `TypeError` with a planted path and asserts `actionFailed`, the `cause`
  chain and the named log entry; new `keeps a defined prompt refusal…`
  (blank share text keeps `promptFileInvalid`, nothing logged), new `keeps a
variable-prompt refusal…` (the `promptVariables:` prefix passes through);
  the malformed-bundle test now expects `actionFailed`.

Results (macmini, this worktree): acpSharing 43/43; runtimeSharing 10/10;
promptEntry 5/5. Neighbours: promptNative all pass (the two
`promptFileInvalid` pins ride deliberate throws, unchanged); acpAgent
149/150 and promptHostLifecycle 1/3 — the same failures run identically on
pristine lane HEAD `153a2ca04` in a temporary worktree (since removed):
the ChatGPT-actions authenticate-flow test and two 5 s-timeout lifecycle
tests, pre-existing, unrelated, and outside this lane's files.

## Red drills (byte-exact restores, SHA-256 verified)

Pre-drill hashes: sharing.ts `f5685392…`, agent.ts `a26da61c…`,
sharingEntry.ts `63e91d3a…`, promptEntry.ts `1b1a1fb7…`, promptBundle.ts
`a8cac74b…`, sharingBundle.ts `4538ed82…`; `sha256sum -c` passes on all six
after every drill.

1. D1 (P2 cause): `cause` dropped from the sharing catch-all →
   `carries the original fault as cause…` and `keeps an unexpected sharing
failure internal…` fail; restored.
2. D2 (P2 log): agent line back to `failureForLog` →
   `keeps an unexpected sharing failure internal…` fails on `TypeError`;
   restored.
3. D3 (P3 headless fallback): catch fallback back to `promptFileInvalid` →
   `reports an unexpected headless fault…` fails; restored.
4. D3b (P3 headless refusals): `sharingRefusal` call forced to `undefined` →
   `keeps a defined empty-chat refusal…` fails; restored.
5. D4 (P3 editor): `safePromptFailure` unexpected branch back to
   `promptFileInvalid` → `sanitises initialization failures…` fails;
   restored.
6. D5 (bundle siblings): both loaders back to `promptFileInvalid` →
   `refuses a malformed bundle…` and `reports an unloadable sharing
bundle…` fail; restored.

`logText.ts` (`internalFaultForLog`) and `main.ts` (log pass-through) carry
no guard of their own: both are exercised by D1/D2 and the headless tests.

## Gates

`npm run typecheck` exit 0 (all projects); `eslint --max-warnings=0` on
changed files clean (four rule hits fixed: promise-chain, string-repeat and
`import()`-type style in the new tests); `prettier --check` on changed files
clean; `check:l10n` 0 problems (reused key, no new text); `npm run build`
exit 0 with `dist/sharingRuntime.js` 161.3 KiB (budget 175 KiB),
`dist/extension.js` 550.1 KiB (budget 600 KiB) and `dist/prompts.js`
161.8 KiB. No `featureCatalog`/reference change (no new command, setting or
feature). No `check:tokens`/`check:visual` impact (no visual change).

## Round 1 record (kept)

The ACP SDK turns any non-`RequestError` thrown by a request handler into
`-32603 Internal error`, dropping the message. The agent threw plain
`Error`s for product-defined refusals and used `RequestError.internalError`
for typed refusal/unavailable states. Nine sites in `src/acp/agent.ts`
converted to `refusalError()` (-32600); `startAccounts()` maps a dead
account service through `accountRequestError`; sharing shaped bad arguments
(-32602) and refusal sentences (-32600). Round-1 drills: `requireReady`
restored to `internalError` failed the auth test; `exportNothing` removed
failed the empty-share test; both restored byte-exact.

## Round 5 — all RVDFACPERR4 findings repaired (4 P2, 1 P3), 2026-10-10

Base `9945d153f`, same worktree and branch, directly on macmini. No new
command, setting, localization key, dependency, wire shape or model call.
The rig brief reserves the aggregate quality run for the lead; this lane
runs the required targeted suites and static/build gates directly.

| Finding                              | Fix and sibling sweep                                                                                                                                                                                                                                                                                                                                                                                                                              | Regression                                                                                                                                                                                                                                                                                                                                                                            | Red drill          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| P2 invalid-file/limit classification | `shared/prompts.ts` classifies malformed JSON, strict metadata/schema and body-variable mismatches as `promptFileInvalid`. `PromptImporter` classifies invalid sources; `PromptLibrary.prepare` preserves title/body limits and rejects invalid draft shapes. Prompt-panel schemas classify caller input before their internal catch. File and stdin readers classify only Node's defined malformed UTF-8 error; unrelated errors still propagate. | `promptEntry`: native malformed JSON, unsupported schema, inconsistent variables, UTF-8 and oversized composer text, with installed French reasons; `promptHostLifecycle`: draft and panel input refusals; `promptImport`: invalid source; `runtimeSharing`: UTF-8 stdin.                                                                                                             | R5-D1–D5, R5-D10   |
| P2 native Library privacy/retry      | All command/panel initialization uses `hostCommands`, which evicts only its own rejected promise. The actual `createPromptHost.run(PROMPT_COMMAND_IDS.library)` route sanitizes failures and logs the original cause by name. The panel uses the same initialization retry and logs once at its sanitizing boundary.                                                                                                                               | `promptHostLifecycle`: actual native Library sanitization and retry, plus panel fault logging and retry; existing cached-command locale regression remains.                                                                                                                                                                                                                           | R5-D6–D8           |
| P2 headless argument honesty         | `runRuntimeSharing` preserves typed `SharingArgumentError` before the unexpected-fault fallback, for every flag classified by the shared command engine.                                                                                                                                                                                                                                                                                           | `runtimeSharing`: invalid `--exported-at` and empty `--attachment-content` retain their French flag-specific reason, with zero backend reads/warnings.                                                                                                                                                                                                                                | R5-D9              |
| P2 common-username export failure    | Prompt and chat adapters share `scrubUserIdentity`: ordinary words and structural fields stay intact; full path segments and explicit identity fields are scrubbed. Neighbor filenames such as `test-guide` and `prefix.test` stay intact. Registered-secret checks still cover the complete final serialization.                                                                                                                                  | `promptImport`: actual file release/metadata round trip for `user`, `admin`, `test`, `randy.northrup`, and a newly registered structural secret; both privacy suites cover identity fields, POSIX/Windows paths, name boundaries and escaped regex characters. `promptHostLifecycle` retains the real Save-dialog cancellation regression and pins username `user` on every platform. | R5-D11–D14, R5-D16 |
| P3 certification scope               | Corrected the lead note: cause-aware logging applies to sharing/prompt catches; legal/vault catches use `failureForLog` on the outer error; installation loaders keep their existing path/load diagnostics. Removed the obsolete residual-timeout claim.                                                                                                                                                                                           | `logText`: wrapped faults return `TypeError` at cause-aware sites and `Error` through the legacy reader, without the personal message. Existing loader and ACP tests verify their actual contracts.                                                                                                                                                                                   | R5-D15             |

Baseline regressions reproduced all four production findings: three malformed
import cases and a composer limit returned `actionFailed`; the native Library
leaked its raw mirror error and cached the rejection; both typed headless
flags lost their reason; all four ordinary account-name exports changed text.
The unchanged Save-dialog cancellation test, with username `user`, timed out
at the repository's five-second deadline before the privacy repair and passes
afterward. A second privacy sweep reproduced eight partial-segment failures
before tightening the segment boundary. No deadline was raised.

The unchanged zero-duplication gate also fired on eight test-fixture clones,
four inherited in ACP sharing and four in runtime sharing. Consolidated setup
and privacy assertions in those owning suites, retaining every wire code,
message, cause, backend/release fence and negative privacy assertion. The
second cleanup removed the last remaining clone; the gate reports zero.

### Round 5 deliberate red/restored receipts

Every command below ran whole test files, at most three per run, with
`--maxWorkers=3` and repository deadlines. Each mutation produced exit 1 at
the named regression; restoration used the saved bytes in `finally`, and
SHA-256 before/after matched. R5-D11–D14 precede the additional complete-path
segment refinement; R5-D16 verifies that final refinement separately.
R5-D9, R5-D10 and R5-D16 were replayed after the final lint cleanup;
their receipts below are those final byte-exact restorations.

| Drill                   | Deliberate break / named failing regression                                            | Restored SHA-256                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| R5-D1-file              | Restore raw JSON/zod parsing → native malformed-import refusal                         | `997d08218d4c73e45b5832d1bce16bd4bcf7d32f22c08e4cd7c63dcdbad8a913` |
| R5-D2-draft             | Restore raw draft parsing → oversized-composer localized limit                         | `895835961b1373a04381078975dd3e0f076b6c150c4bb8c26504d5fab8d92226` |
| R5-D3-panel             | Replace panel input reasons with actionFailed → defined saveDraft/input refusals       | `31faa7286774c04db4582d6f3e4d802187647fb36756933ebac95efd00945d2d` |
| R5-D4-source            | Replace invalid import-source reason → malformed/oversized import inputs               | `000c8f7776f8d5c9c3a2e24b429c14af614f2389f6e48d529a7511ce14e58c65` |
| R5-D5-file-encoding     | Disable the known UTF-8 classification → native invalid UTF-8 import                   | `26771ec72015d159ffdfc90b4530d908d7260632d904c8f85a132f6e100e2cc9` |
| R5-D6-native-catch      | Rethrow the raw native Library initialization error → actual Library sanitization      | `09f3ffb7815e0ece47698268265e020a5f4b3398152b3536a268b063c09431ed` |
| R5-D7-eviction          | Remove rejected-promise eviction → actual Library and panel retries                    | `09f3ffb7815e0ece47698268265e020a5f4b3398152b3536a268b063c09431ed` |
| R5-D8-panel-log         | Drop the panel logger → original root-fault-name assertion                             | `09f3ffb7815e0ece47698268265e020a5f4b3398152b3536a268b063c09431ed` |
| R5-D9-typed-argument    | Disable typed argument recognition → localized exported-at/attachment-content refusals | `4d04c072c7ca99d2830265ea04bd0405c04ed32f40904c3cd58ac8ec30c13b0c` |
| R5-D10-stdin-encoding   | Disable the known stdin UTF-8 classification → malformed UTF-8 stdin refusal           | `4d04c072c7ca99d2830265ea04bd0405c04ed32f40904c3cd58ac8ec30c13b0c` |
| R5-D11-ordinary-words   | Restore whole-word replacement → ordinary personal exports for all four usernames      | `5535c8728b475eb98ba294c1cbc8ddf0eb4e6ed4581804cba66247d7e6548bd1` |
| R5-D12-path-segments    | Remove path-segment replacement → prompt/chat path privacy regressions                 | `5535c8728b475eb98ba294c1cbc8ddf0eb4e6ed4581804cba66247d7e6548bd1` |
| R5-D13-identity         | Remove identity-field replacement → prompt/chat identity privacy regressions           | `5535c8728b475eb98ba294c1cbc8ddf0eb4e6ed4581804cba66247d7e6548bd1` |
| R5-D14-escaping         | Remove username regex escaping → literal-metacharacter privacy regressions             | `5535c8728b475eb98ba294c1cbc8ddf0eb4e6ed4581804cba66247d7e6548bd1` |
| R5-D15-log-scope        | Log the wrapper instead of the root → cause-aware vs legacy root-name regression       | `9db3a54e9a9bb8aa7d1844ce3336c5f0fa2abe57d8930d8a3a635de1731e422f` |
| R5-D16-complete-segment | Remove complete-segment admission → ordinary neighboring filename regressions          | `9ed930f2dd320af0e106176f5b32872375c5c11f9e6ccca1ef6cb61c79d48827` |

### Round 5 final test receipt

Whole files, directly on macmini, repository timeouts, no `--testTimeout`,
no skipped or filtered cases:

| Files passed to `npx vitest run … --maxWorkers=3`              |  Passed |
| -------------------------------------------------------------- | ------: |
| `promptEntry`, `promptHostLifecycle`, `runtimeSharing`         |      40 |
| `promptImport`, `promptPrivacy`, `chatShareScrub`              |      37 |
| `prompts`, `logText`, `acpSharing`                             |      77 |
| `acpAgent`, `acpVault`, `acpAccounts`                          |     202 |
| `promptNative`, `promptStore`, `promptWorkspaceIntegration`    |      20 |
| `chatShareRange`, `chatShareFilter`, `chatShareFormats`        |      17 |
| `chatShareRelease`, `chatShareDestinations`, `chatSharingHost` |      19 |
| **Total: 21 files**                                            | **412** |

All names above resolve to `test/unit/<name>.test.ts`. `acpAgent` passes
150/150, including ChatGPT actions. The native Library/panel regressions,
UTF-8 refusals and the common-account Save-dialog cancellation case all
pass at the repository's five-second macOS deadline. The two aliases in
runtime sharing pass. No review finding remains open.

### Round 5 gates and delivery

- `npm run typecheck`: exit 0 across all five projects on the final source.
- Targeted `npx eslint --max-warnings=0`: exit 0 across every changed TS file.
- `npx prettier --check` on all changed files and `git diff --check`: exit 0.
- `npm run deadcode`: exit 0 using plain knip; its two existing configuration
  hints remain unchanged. `npx jscpd`: zero clones, unchanged zero threshold.
- `npm run check:l10n`: 14 UI tables, 14 usage tables, 0 problems.
- `npm run check:host-api`: 375 APIs, 48 VS Code-importing files, 0 problems.
- `npm run check:reference`: 77 features, 71 commands, 100 settings,
  29 slash commands and 257 CLI entries, current; sharing catalog matches.
- `node scripts/check-plan.mjs PLAN.md DFACPERR`: built.
  Roadmap regenerated; `npm run check:roadmap`: exit 0, 208 entries current.
- `npm run build`: exit 0, including token, size, split, host-global and
  notice checks. Extension 550.1/600 KiB; prompts 163.5/200 KiB;
  sharing runtime 162.3/175 KiB. Every existing budget is retained.
- No visual/style change, new feature/command/setting, dependency install,
  live/paid model call, credential access, branch merge, push or rebase.
  All tests are local fakes or owned local-file operations; model attempts 0.
  The rig brief reserves `npm run quality` for the lead.

## Round 6 — repair of review RVDFACPERR5 (1 P2), 2026-10-11

Base `bd4a11c37`, same worktree and branch, directly on macmini. No new
command, setting, localization key, dependency, wire shape or model call.
The rig brief reserves the aggregate quality run for the lead; this lane
runs the required targeted suites and static/build gates directly.

Lead design rule (records the class fix, not the cited line): THE SCRUB IS
IDEMPOTENT AND THE FINAL CHECK IS ITS FIXED POINT. (1) Every marker the
scrubber itself emits is an atomic token: no later rule may match inside
it, across it, or treat the text after it as the start of a new absolute
path. The exemption derives from the single `SCRUB_MARKERS` list in
`src/shared/share.ts`, never from a hand-written case per marker.
(2) The release confirmation accepts exactly what the scrub produced: it
re-runs the same `scrubShareText` and requires `scrub(x) === x`; there is
no second, independent detector that can disagree. (3) A property test
over a generated corpus asserts `scrub(scrub(x)) === scrub(x)`, and a
preview that nothing changed always exports.

| Finding                         | Fix and sibling sweep                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Regression                                                                                                                                                                                                                                                                                                                                                                                                                                  | Red drill |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| P2 username-path export refusal | `src/core/sharing/privacy.ts` `isPathBoundary` exempts every `SCRUB_MARKERS` entry (`[home]`, `[user]`, `[path]`, `[workspace]`, `[redacted]`, `[redacted path]`, `[redacted account]`) instead of only `[home]`. `src/core/sharing/shareRelease.ts` needed no change: `confirm` already re-runs the same scrub and requires the fixed point, and no second detector exists on that path. The prompt adapter (`promptPrivacy.ts`) needed no change: its absolute-path branch already refuses a `/` after `]`, and the new property corpus passes on it unchanged. | `chatShareScrub`: exact review case plus fixed-point property over usernames `user`/`home`/`src`/`team`, POSIX/Windows/UNC roots, nested and repeated username segments, and an identity-rule marker adjacent to a path. `chatShareRelease`: unchanged preview carrying `team/[user]/src/main.ts` confirms to `shared` with one sink call, in all three formats and both modes. `promptPrivacy`: same property corpus as the sibling sweep. | R6-D1     |

Baseline reproduction (before the fix, repository deadlines, no
`--testTimeout`): the new release test refused with `sharePreviewExpired`
at `shareRelease.ts:128` with zero sink calls, and the property tests
showed `team/[user][path]` where `team/[user]/src/main.ts` was expected
(`user`, `home`, `team` cases). The sibling prompt-adapter corpus passed
before and after, with no source change.

### Round 6 deliberate red/restored receipt

Whole files, at most three per run, with `--maxWorkers=3` and repository
deadlines. The mutation produced exit 1 at the named regressions;
restoration copied back the saved bytes and SHA-256 before/after matched.

| Drill                  | Deliberate break / named failing regression                                                                                                                                        | Restored SHA-256                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| R6-D1-marker-exemption | Restore the `[home]`-only exemption in `isPathBoundary` → the username-segment release test plus the `user`/`home`/`src`/`team` fixed-point property tests (5 failures, 28 passes) | `37ba3f20414124944b3ab557692e080a2ec1674350a3b9c5faccbefbf1ceb318` (`src/core/sharing/privacy.ts`) |

### Round 6 final test receipt

Whole files, directly on macmini, repository timeouts, no `--testTimeout`,
no skipped or filtered cases:

| Files passed to `npx vitest run … --maxWorkers=3`              |  Passed |
| -------------------------------------------------------------- | ------: |
| `promptEntry`, `promptHostLifecycle`, `runtimeSharing`         |      40 |
| `promptImport`, `promptPrivacy`, `chatShareScrub`              |      46 |
| `prompts`, `logText`, `acpSharing`                             |      77 |
| `acpAgent`, `acpVault`, `acpAccounts`                          | 201 + 1 |
| `promptNative`, `promptStore`, `promptWorkspaceIntegration`    |      20 |
| `chatShareRange`, `chatShareFilter`, `chatShareFormats`        |      17 |
| `chatShareRelease`, `chatShareDestinations`, `chatSharingHost` |      20 |
| **Total: 21 files**                                            | **422** |

All names above resolve to `test/unit/<name>.test.ts`. Ten tests are new
(1 release, 5 chat scrub, 4 prompt property); every other count matches
round 5. The single `acpAgent` failure (`exposes all three ChatGPT actions`,
`chatgpt-status` rejected as temporarily unavailable) is pre-existing on
this rig, not a regression: it fails identically on a pristine `HEAD`
export with none of this lane's changes, and nothing on the ChatGPT auth
path imports the changed scrub files. The review certified 150/150 on
macbook; macmini refuses that status check at base.

### Round 6 gates and delivery

- `npm run typecheck`: exit 0 across all five projects on the final source.
- Targeted `npx eslint --max-warnings=0`: exit 0 across every changed TS file.
- `npx prettier --check` on all changed files and `git diff --check`: exit 0.
- `npm run check:l10n`: 14 UI tables, 14 usage tables, 0 problems.
- `npm run check:host-api`: 375 APIs, 48 VS Code-importing files, 0 problems.
- `npm run check:reference`: 77 features, 71 commands, 100 settings,
  29 slash commands and 257 CLI entries, current; sharing catalog matches.
- `node scripts/check-plan.mjs PLAN.md DFACPERR`: built.
  Roadmap regenerated; `npm run check:roadmap`: exit 0, 208 entries current.
- `npm run build`: exit 0, including token, size, split, host-global and
  notice checks. Extension 550.1/600 KiB; prompts 163.6/200 KiB;
  sharing runtime 162.5/175 KiB; Model API 515.8/525 KiB.
  Every existing budget is retained.
- No visual/style change, new feature/command/setting, dependency install,
  live/paid model call, credential access, branch merge, push or rebase.
  All tests are local fakes or owned local-file operations; model attempts 0.
  The rig brief reserves `npm run quality` for the lead.

## Notes for the lead

- The `-32603` message for unexpected sharing, prompt and headless faults
  is the fixed `actionFailed` sentence. Cause-aware names-only logging via
  `internalFaultForLog` applies to the ACP sharing catch, headless sharing
  boundary, and editor prompt command/panel catches. Legal/vault catches
  also return `actionFailed`, but use `failureForLog`, which names the outer
  error and does not traverse its cause. The two installation loaders use
  `lazyBundleLoader`: its own diagnostic includes the installation path
  and load-error message. Those loader diagnostics are outside the
  cause-aware names-only contract; round 4 did not change their logger.
- Future `instanceof AcpSharingFailure` outside its own bundle would miss
  silently; the guard and the bundled-copy test carry this. Not added to
  the eslint `instanceof` rule (brief: no widened guards).
- The previously reported ACP ChatGPT-actions failure and prompt host
  lifecycle timeouts are not residual findings: RVDFACPERR4 passed the
  ChatGPT-actions test and identified the Save-dialog timeout as the common
  username collision fixed in round 5. Round 5 reruns the complete owning
  suites with repository deadlines and pins `user` for that lifecycle case.
  The runtime aliased-workspace pair pins its account name because workers
  without a passwd entry cannot call `os.userInfo()` successfully.
