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

## Notes for the lead

- The `-32603` message for unexpected sharing faults is the fixed
  `promptFileInvalid` sentence (same as the CLI surface); for legal/vault
  faults it is `actionFailed`. Both say the log has the details, and both
  log server-side via `failureForLog`.
- Future `instanceof AcpSharingFailure` outside its own bundle would miss
  silently; the guard and the bundled-copy test carry this. Not added to
  the eslint `instanceof` rule (brief: no widened guards).
- Pre-existing failures left open (verified on pristine HEAD): the ChatGPT
  actions test in acpAgent.test.ts and the `aliased workspace` pair in
  runtimeSharing.test.ts (this rig).
