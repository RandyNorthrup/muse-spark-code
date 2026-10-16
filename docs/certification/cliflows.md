# Lane CLIFLOWS certification — terminal commands confirm, explain and exit as helped

## RVCLIFLOWSFIX review — terminal fixes after the CLIFLOWSFIX lane (2026-10-16, linuxlt rig)

Review branch `rv/cli-flows-final` from lane head `5f70929b9`; `main`
(`898a26c5e`, 0.18.2) was already an ancestor (`git merge --no-ff main`:
"Already up to date", no conflicts). Every proof below ran on the packed
`dist/acp.js` from `npm run build` (exit 0) under a scratch HOME with
`DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/no-bus`, or through the
real modules in the named unit files. No model call was made.

Fixed, one commit each:

- `exec --help` / `report --help` printed the whole 158,854-byte reference
  (measured); each now prints its own screen with real exit codes (exec's
  list matches `EXEC_EXIT`; report 0/1/2) — `499473d8a`. Packed after:
  exec 894 bytes, report 549 bytes, both exit 0.
- A `copilot/…` plan model with no Meta key was refused with "No Meta
  Model API key is stored" (`backends.ts` refusal only special-cased
  `chatgpt/`); it now names Copilot — `57c4db615`, branch form in
  `c453b0fa5`. Proof: real `createRuntimeBackend` readiness cases in
  `runtimeServices.test.ts` (chatgpt signed-out, copilot unavailable,
  Meta model needs the key); 18 passed.
- F46: with `openai` in the runner's providers file, `providers accounts
list` said "unavailable until this runtime is connected" while the same
  process listed `meta` accounts (both measured). It now fills the new
  `accounts.providerUnavailable` key in all 15 tables — `822512bc0`.
  Packed after: `Accounts for openai are not available in this terminal
yet.`, exit 1. The same commit corrects the stale
  `runtimeAccountsService` expectation (failing on the merge base too, as
  the section below records) and pins the configured branch; 43 passed
  with `accountsCommand`.
- `share --help` / `prompts --help` answered "Unknown argument" (exit 2)
  and the catalog's `prompts use` syntax omitted the lane's own
  `--var`/`--confirm`; both now print the sharing screen and the
  regenerated reference lists the flags — `cf759136c`. Packed after: both
  exit 0 with the sharing syntax lines, including
  `[--var name=value ...] [--confirm]`.
- README/CHANGELOG claimed "sessions still open" without a store and
  called grant-backed dispatch "owner-verified"; neither is measured
  (fully-keyless `session/new` still refuses at account identity, per the
  section below). The words now say the agent starts and the host opens,
  a session starts only with a run key or file-configured provider, and
  the owner run is still needed — `bf03e82fe`.

Re-run drills on the final build (all exit codes observed): F80 exec
`chatgpt/gpt-6.1-sol` and `copilot/gpt-6.1` on the dead store both exit 3,
requests 0, naming the store, never a Meta key; `auth status`,
`auth status --provider openai` and `providers status chatgpt` each print
the one store sentence, exit 1; `auth set` with a valid-shaped fake key
exits 1 with the scratch HOME still empty; `scan-secrets` clean → `0`
exit 0, dirty → `1` exit 10, no file → usage exit 2; `prompts use` with
`--var name=Tester` previews `Hello Tester` and stops exit 7, with
`--confirm` prints it exit 0, with the variable missing stops exit 7.

Gates on the final tree (direct runs, repo-default timeouts): typecheck
0; ESLint `--max-warnings=0` and Prettier on every changed file 0;
`check-l10n` 0 (0 problems); `check:reference` 0; `deadcode` 0; `cycles`
0; `duplication` 0 (0 clones); `npm run build` 0. Touched/dependent unit
files: `runtimeServices` 18, `runtimeAccountsService` + `accountsCommand`
43, `referenceEntry` 15, `sharingTerminal` + `execArgs` + `scanSecrets`
74 — all passed.

Owner limits rule (2026-10-16): the lane adds and keeps no limit of its
own. Plan attempts count against the person's own `--max-requests` flag;
the exec output cap and scanner lifetime predate the lane and are
unchanged by it.

Not fixed (named in the review report): a fully-keyless Model API
session still cannot start (account identity owns spend — needs a design
decision, not a patch); terminal Copilot models have no dispatch adapter
in the runtime, so they refuse as unavailable; most other commands'
`--help` still prints the compact root usage rather than a screen of
their own; `developer --help` prints a stack trace (pre-existing, outside
this lane's diff).

## Lane CLIFLOWSFIX — finish the terminal fixes (2026-10-15, linuxlt rig)

Worktree `/home/randy/lanes/CLIFLOWSFIX`, branch `fix/cli-flows-final`.
Base `0a9ffb7ac` (review branch) merged with main `d842cad5d` (test
overhaul) as `12bf22822`: both CHANGELOG sides kept; the overhaul's
deletion of `test/unit/runtimeChatGpt.test.ts` stands, and its 8
real-module ChatGPT command-boundary cases move into the surviving
`test/unit/accountsCommand.test.ts` (`389ef7020`, 31 tests pass).
No fake is added anywhere; the packed `dist/acp.js` (`npm run build`)
is the proof surface throughout, under a scratch HOME with
`DBUS_SESSION_BUS_ADDRESS` pointing nowhere and no secret service.

### F80 (P1): plan-model exec on the shared subscription path (`2a9904ed9`)

`createProviderClient`/`getProviderAccountId` no longer exclude exec:
a terminal plan-model run builds the subscription client and account
identity exactly as the editor protocol does. The session tap carries
the run's `--model` as the readiness hint, so the session gate sees
the same plan hint as the run's own check. A plan run bypasses the
Meta-only transport (which refuses non-Meta origins); its attempts are
admitted through the shared accounting wrapper's zero-price tickets —
the same single-admission pattern as a configured-provider run, so
`--max-requests` still bounds it — and the ledger preview reserves $0
instead of refusing the model as unpriced.

Packed proof (no grant, dead store), exit 3, requests 0:

```text
[info] Authentication Required; requests 0; settled $0.000000; uncertain $0.000000; image attempts 0; returned 0; uncertain images 0
[error] This computer's credential store is unavailable, so stored keys cannot be checked.
```

No Meta-key wording anywhere. With a working store and no grant the
same path returns `ChatGPT is not signed in.` (readiness plan branch);
with a grant the run dispatches on the ChatGPT sign-in. Both need a
real grant/store and are owner real-life steps (no model call is made
from any lane).

### F43 (P1): sessions open with no unlocked store (`d7ec13ea3`, `3c7b54863`)

A `signedOut` readiness caused by a dead store carries a `storeDown`
marker and the agent opens the host anyway. The gate's Meta-key probe
is cached, so the model list skips the doomed catalogue dial
(`hasMetaCredential`, previously unwired) and the host builds without
stored history when nothing can be attributed. A step that needs the
stored key throws the store failure instead of claiming no key is
stored; account identity falls back to the subscription account; failed
turns name the store in the one sentence. `auth status`,
`auth status --provider openai` and `providers status chatgpt` print
exactly that sentence (exit 1). `auth set` with a valid-shaped key
refuses the same way with the filesystem unchanged (no plain text).
`session/new` on a bare scratch HOME reaches model availability and
refuses `Authentication required: This computer's credential store is
unavailable, so stored keys cannot be checked.` (authRequired,
no store access, no dial) instead of the old pre-host refusal.

Remaining wall (named, not patched): `startSession` pins spend to an
account identity, and with no readable store or key there is none, so
a fully-keyless session cannot start by design. A `--key-stdin` key
gives the sha identity and opens end to end (owner run needs the
network for the catalogue list). ACP file-model listing stays a
Models & Agents panel capability: the configured-client list throws
`Models & Agents is not available in this build` in a terminal
session, which is accurate and unchanged.

### F46 (P2): advice follows the file the service reads (`0c315b1e1`)

`providers accounts list --provider openai` with no providers-file
entry keeps `openai is not configured; add it with providers add
first.` (exit 1); with a valid `openai` entry in the runner's own
providers file it now says `Accounts are unavailable until this
runtime is connected to the shared account service.` (exit 1),
because the account service reads its own metadata rows, not that
file. `meta` still lists its default account (exit 0). No new
strings; the check reuses the runner's file read.

### F44 (P2) + help (P2): scripted use, true words, own screen (`06e318dfc`)

`prompts use` takes repeatable `--var name=value` and `--confirm`.
Without `--confirm` a script sees the preview and stops, exit 7;
with both it prints the prepared text, exit 0 (proven with a
`Hello {{name}}` prompt: `Hello Tester`). The terminal review asks
`Print prepared text (y/N)` — nothing is inserted into an editor —
in English and all 14 translations (new key `promptPrintConfirm`,
order-verified). `scan-secrets --help` prints its own 545-byte screen
(usage, description, `--key-stdin`, `Exits 0 when clean, 10 when a
secret is found, 2 for misuse.` — new key `scanSecretsExits`,
order-verified) instead of the 158,621-character reference, exit 0.
`exec --help`/`report --help` routing is untouched for the CLI-help
owner; the reference gate still passes.

### Gates (final tree, exit codes)

All gates ran on the final tree (`15ae62c7a` plus this file) on the
linuxlt rig, direct runs, repo-default timeouts throughout:

| Gate        | Command                                                                                            | Exit |
| ----------- | -------------------------------------------------------------------------------------------------- | ---- |
| format      | `npm run format:check`                                                                             | 0    |
| lint        | `npm run lint` (js main+unit+tests, css; `lint:ps` skips: PSScriptAnalyzer runs on Windows only)   | 0    |
| typecheck   | `npm run typecheck` (host, webview, unit, e2e, integration)                                        | 0    |
| deadcode    | `npm run deadcode` (knip; 3 pre-existing config hints, no findings)                                | 0    |
| cycles      | `node scripts/cycles.mjs` (no circular dependency)                                                 | 0    |
| duplication | `npm run duplication` (jscpd: 0 clones)                                                            | 0    |
| l10n        | `node scripts/check-l10n.mjs` (14 UI + 14 usage tables, 0 problems)                                | 0    |
| reference   | `node scripts/gen-reference.mjs --check` (73 features, 65 commands, 89 settings, 244 CLI; current) | 0    |
| host-api    | `node scripts/check-host-api.mjs` (0 problems)                                                     | 0    |
| plan        | `node scripts/check-plan.mjs` (218 milestones, 0 drift)                                            | 0    |
| build       | `npm run build` (production + size/split/globals/notices)                                          | 0    |
| sast        | `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast` (533 rules, 3232 files, 0 findings)         | 0    |

Lint note: the first `lint:js:main` run flagged one error in
`temp/acp-probe.mjs` — gitignored scratch from the earlier run, not a
deliverable. It moved to `$TMPDIR` and the full `npm run lint` passes.

Touched unit tests (real modules only, `--maxWorkers=3`):

| Files                                                                  | Result                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| `accountsCommand` (31) + `providersFileStore` + `sharingTerminal` (14) | 64 passed                                      |
| `execArgs` (55) + `scanSecrets` + `referenceEntry` (15)                | 75 passed                                      |
| `runtimeAccountsService` + `runtimeServices` + `runtimeChatGptPackage` | 30 passed, 1 failed — pre-existing (see below) |

Pre-existing failure, not a lane regression:
`runtimeAccountsService.test.ts > reports unavailable for an unconfigured
provider and never writes it` expects `UI_TEXT.accounts.unavailable` but
gets `openai is not configured; add it with providers add first.`
Every file deciding that outcome (`accounts.ts`, `runtimeServices.ts`,
`providersFileStore.ts`, the test itself) is byte-identical between the
merge base `12bf22822` and this tree, and the lane's `accountsCommand.ts`
change returns the identical string on this path (no `isProviderConfigured`
dep in that rig). Re-ran that single test on a pristine `12bf22822`
worktree: same 1 failure. It encodes a stale expectation (the
F46-intended contract says unconfigured reads as unconfigured); left for
the overhaul fallout owner, not re-asserted here.

### Packed-product runs (final `dist/`, scratch HOME, dead secret service)

`DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/no-bus`, fresh
`HOME`/`XDG_*_HOME` under `$TMPDIR`. No real grant, no network model call.

F80 — `exec --backend modelApi --model chatgpt/gpt-6.1-sol --max-requests 1 --max-budget-usd 1 "say hi in five words"`, exit 3:

```text
[info] Display language en-us: the panel is in English
message withheld: the response did not complete
[info] Authentication Required; requests 0; settled $0.000000; uncertain $0.000000; image attempts 0; returned 0; uncertain images 0
[error] This computer's credential store is unavailable, so stored keys cannot be checked.
```

No Meta-key wording: the plan run builds the subscription client and
reaches the grant check (requests 0, $0 settled). With a working store
and no grant the same shared path returns `ChatGPT is not signed in.`
(`acpChatGpt.states.signed-out`); observing that needs a real
store/grant and stays an owner real-life step.

F43 — `auth status`, `auth status --provider openai`,
`providers status chatgpt`: each prints exactly
`This computer's credential store is unavailable, so stored keys cannot
be checked.`, exit 1. `auth set` with a valid-shaped but fake key
(`LLM_` + 20 chars, never real, never stored) prints the same sentence,
exit 1, and `find $HOME -type f` is empty before and after: nothing is
written in plain text. (`auth set --key-stdin` without `--provider` is
usage exit 1: `--key-stdin` belongs to the provider-key grammar.)

F43 — ACP `initialize` succeeds and the host opens (`Model API backend
ready`); then both `session/list` and `session/new` (each probed
directly with the real ACP SDK client) refuse:

```text
RequestError: Authentication required: This computer's credential store is unavailable, so stored keys cannot be checked.
```

No store access, no catalogue dial before the refusal — the old
pre-host refusal is gone; the remaining keyless wall is by design
(`startSession` pins spend to an account identity).

F46/F44 re-checked on this build: `scan-secrets --help` is 545 bytes,
exit 0; `providers accounts list --provider openai` (unconfigured)
prints `openai is not configured; add it with providers add first.`,
exit 1.

### Per-finding table

| Finding                      | Fix commit               | Packed proof (this run)                                                                                     |
| ---------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| F80 P1 plan-model exec       | `2a9904ed9`              | exec exit 3, requests 0, $0; no Meta wording                                                                |
| F43 P1 dead-store sessions   | `d7ec13ea3`, `3c7b54863` | 3 status commands exit 1 with the store sentence; `auth set` exit 1, no files; list+new refuse authRequired |
| F46 P2 account advice        | `0c315b1e1`              | unconfigured openai exit 1 with the add-first advice                                                        |
| F44 P2 scripted prompt words | `06e318dfc`              | unit-covered; terminal asks `Print prepared text (y/N)`                                                     |
| help P2 scan-secrets screen  | `06e318dfc`              | 545 bytes, exit 0                                                                                           |

No `bwrap` namespace failure was hit in this run. Temp-space note:
`/var/tmp/l-CLIFLOWSFIX` exists but is read-only (stale mount from the
earlier run), so scratch lived in `$TMPDIR` and the worktree `temp/`
(only `$TMPDIR/acp-probe.mjs` retained for the record).

## RVCLIFLOWS review — readable terminal results (2026-10-14, Windows)

P2: `--json` opt-in suppressed the entire result of ordinary prompt save,
list and variable-free use. Baseline production build exited 0; each of
those commands produced empty stdout (`.lane/product-before.log`). Reuse
ACP's existing result formatter for saved ids, listings and cancellation;
terminal prepared text prints without claiming an editor insertion. No new
strings, provider calls or credentials. `docs/acp.md`, README and the generated
sharing reference describe the terminal behavior.

Proof: production build before/after both exit 0; isolated HOME/LOCALAPPDATA
runs via `.lane/review-product.mjs` show save with title/id, list with titles/ids,
plain use with exact body (all exit 0), cancelled file share with preview plus
`Sharing cancelled` on stderr (exit 7); explicit JSON remains structured.
The before run is the failing behavioral proof, not a stand-in or a new
process test. It also confirms `playbook settings` has no `(panel)` suffix.

The historical lane record below is not final review acceptance; in particular,
F43 and F80 remain open as described in the review handoff.

## RVCLIFLOWS review — preserve headless limits (2026-10-14)

P1: the `isPlanRun` prefix check disabled the request/ USD ledger, transport
metering and settlement validation even for a configured paid API provider
whose user-chosen id was `chatgpt` or `copilot`. `providerEntrySchema` permits
those ids for API-key entries; only entries with `auth: subscription` have
subscription-specific restrictions. Input: `exec --backend modelApi --provider
chatgpt --model chatgpt/MODEL --max-requests 1 --max-budget-usd 0.05 ...` with
an API-key provider row named `chatgpt`. The prefix made `ledger` undefined;
BYO response accounting was then omitted and completion accepted on the turn
alone. No provider request was made to demonstrate an unsafe dispatch.

Fix: remove all prefix-based accounting exemptions from `runExec`. Every
Model API/BYO run retains the existing ledger, dispatch guard and verified
settlement path. F80 remains refused until a complete subscription binding
can retain request counting, safe no-USD settlement and released output.
The readiness hint by itself is not that binding: backend construction still
excludes exec subscriptions and their account resolver; ACP subsequently
rechecks readiness without the hint. `sessionTap` also releases Model API
messages only after accounting outcomes, absent in the removed bypass.
These coupled fixes are deferred rather than bypassing ownership/accounting.

The earlier F80 claim below describes the submitted attempt, **not verified
working behavior**. Its positive path was not run and is not certified.

## RVCLIFLOWS review — F46 remediation does not configure accounts

P2: the new `providerNotConfigured` text directs a person to `providers add`,
but accounts read a different file/envelope (`runtime/providers/providersFileStore.ts:67`,
`main.ts:935`) from M95's provider configuration. Real isolated product run
with a valid OpenAI `providers add` envelope at XDG_CONFIG_HOME's
`muse-spark-code/providers.json` still exits 1 with `openai is not configured;
add it with providers add first.` (`.lane/accounts-config-proof.log`).
Binding two canonical stores safely exceeds this review's scoped repair;
F46 remains open and CHANGELOG now limits the working claim to Meta accounts.

## RVCLIFLOWS review — scanner owns its output (2026-10-14, Windows)

P2/F48: real `node dist/acp.js scan-secrets clean.txt` printed stdout `0`
and stderr `[info] Display language en-us: the panel is in English` (exit 0),
contrary to the count-only terminal contract. Run the existing scanner before
language loading: it has no translated output or refusal text. Real clean,
canary and missing-file commands retain exits 0/10/2 and no panel diagnostic.
No logger suppression, gate exemption or new string is needed.

## RVCLIFLOWS review — unknown is not absent (2026-10-14)

P2: a locked or unavailable credential store can still contain a key. Every
failed status read nevertheless said `No key is stored`. The fixed sentence
in English and all fourteen tables says the store is unavailable and stored
keys cannot be checked; it preserves the distinction from a successful
missing-key read and never offers plaintext fallback. Proof is the throwing
read branch in `authStatus`/`authStatusProvider` and real text-module tests;
no owner's credential store was touched. F43's session creation remains open.

## RVCLIFLOWS review — selector identity (2026-10-14, Windows)

P2: deduplication keyed on selector plus metadata, so two `plan` entries
with different descriptions still announced `/plan` twice. Exact selector
identity now keeps the first entry; the `X`/`X:X` alias rule remains narrow.
Real helper regression with two different descriptions fails before (1 failed,
10 passed, exit 1) and passes after (11 passed, exit 0). This is plain input
data, not a simulated CLI. Logs: `.lane/red-dedupe.log`, `.lane/green-dedupe.log`.
The lane's real Muse skill capture remains the historical provenance for the
alias case; no CLI/provider was run by this review.

## RVCLIFLOWS review — remove stand-in proof (2026-10-14, Windows)

P2: the submitted localization deletion leaves `runtimeChatGpt.test.ts:423,501`
referencing a removed key: measured `npm run typecheck` exit 1 (unit tsc exit 2,
two TS2339 diagnostics). This is not certified as a failure on base. Its 27
original test definitions use an invented OAuth issuer, map credential store,
replaced process/keyring and provider callbacks; one is a source-text guard.
`scanSecrets.test.ts` has four original definitions using a hand-built writer,
replaced reader and mocked flush. Neither qualifies as product proof.

Rewritten both files rather than repairing their fakes: 8 pure command/text
cases and 4 scanner cases with real temp input/output files and the production
fd writer. Both suites pass (12 tests, exit 0). No provider or OS credential
store is accessed. Auth lifecycle replacement requires dated real OpenAI
discovery/JWKS/token/catalogue/response exchanges plus an owner-run OS-store
sign-in/refresh/revoke drill; absent here, those claims are unverified.

Red/restored drills: change scanner output to append ` secret matches`;
three exact-output assertions fail, exit 1; restore and 4 pass, exit 0.
SHA-256 restored `C5E033462CC4765CCF2C460DD5DAA4DA4D76F8C7368ACBBBAE50B63879B38E07`.
Change ChatGPT store-unavailable text to generic sign-in failure; the intended
assertion fails (1 failed/7 passed), exit 1; restore and 8 pass, exit 0.
SHA-256 restored `E506EE46BEDC5F6AF61D9CC64F45468C0DE06AA75EF6093A1D4D8B32FA6D8A74`.
Logs: `.lane/red-scan.log`, `.lane/restored-scan.log`,
`.lane/red-chatgpt-text.log`, `.lane/restored-chatgpt-text.log`.
The final duplication gate exposed repeated scanner setup (exit 1, one clone).
Consolidating it into one table preserves all assertions and independently
exercises missing-file/invalid-UTF-8 cases: 5 scanner tests pass, exit 0;
duplication then exits 0 with zero clones.

Worktree `/home/randy/lanes/CLIFLOWS` from origin/main 0.18.2 (`898a26c5e`).
Product under test: production build (`npm run build`) run as
`node dist/acp.js` with a scratch `HOME` (`$TMPDIR/clihome`, no Secret
Service, no stored keys). These were built-bundle runs, not an extracted
production npm package. They do not prove packaged-product behavior. Real-SDK drivers live in `temp/` (gitignored scratch):
`temp/acp-new-session.mjs` (real `@agentclientprotocol/sdk` client against
the real agent) and `temp/pty-drive.py` / `temp/pty-use.py` (real
pseudo-terminals). No model call was made; no credential was printed,
copied or stored.

Reproduction (before) and proof (after) per finding. Commits cited are on
branch `fix/cli-flows`.

## F53 — y/yes at "Confirm Sharing (y/N)" cancelled; process never exited

- Cause: `src/runtime/sharing/sharingEntry.ts` `terminalUi()` compared the
  raw answer with `=== 'y'`, so `Y` and `yes` fell through to `cancelled`
  (exit 7, no file). The readline interface was closed without pausing a
  TTY stdin, which keeps the event loop alive on some platforms.
- Before (0.18.2, real pty): `prompts share … --destination file` answered
  `Y` printed `{"kind":"cancelled",…}`, exit 7, no file written.
- Fix (`d696e8dcd`): new `isAffirmativeAnswer` (trimmed, case-insensitive
  `y`/`yes`) used by both `confirmShare` and the review question;
  `question()` pauses `process.stdin` after closing the interface.
- After (real pty): answered `yes` → `{"kind":"shared",…}` (with `--json`),
  exit 0, `shared.md` written (24 bytes), child reaped (no hang).
  Answered `y` still works. Unit: `test/unit/sharingTerminal.test.ts`
  (14 tests) covers the answers and `--json` parsing through the real
  modules. The Linux hang half did not reproduce here (the answered process
  exited); the stdin pause is a mitigation, not proof of exit behavior on
  every platform. A real terminal drill is still required on each target.

## F44 — no script confirm path; raw JSON always printed

- Cause: `runRuntimeSharing` (`src/runtime/sharing/sharingEntry.ts`)
  always wrote the result JSON, and the `--confirm`/`--exported-at` repeat
  existed only in code and `docs/acp.md`, not in the terminal reference.
- Before: headless `prompts share` printed the preview plus
  `{"kind":"cancelled","exitCode":7}`, exit 7.
- Fix (`d9c61c0cb`): `--json` flag on every `share`/`prompts` command
  (`src/runtime/sharing/args.ts`); the result JSON prints only with it.
  The CLI reference (`src/shared/featureCatalog.ts`, regenerated
  `docs/sharing-reference.md`) shows the scripted repeat
  (`--confirm PREVIEW_ID --exported-at TIME`), and `docs/acp.md` says the
  same for `save`/`list`/`use`.
- After: headless share prints only the preview (`# Greet…`), exit 7, no
  file; with `--json` the last line parses to `kind=cancelled` with
  `previewId`; the identical repeat with `--confirm`/`--exported-at`
  exits 0 with `kind=shared` and writes the file (verified contents).

## F54 — `prompts use` asked twice

- Cause: the terminal `preparePrompt` asked `Insert Into Chat (y/N)`
  before the variables, then `usePrompt`'s `review` asked again.
- Before: reasoned from code (`src/runtime/sharing/sharingEntry.ts`
  calling `question` then `usePrompt`); the review's question is the
  product's single gate.
- Fix (`d696e8dcd`): the upfront question is removed; variables are
  collected, then the review asks once.
- After (real pty, `prompts use ID --chat new`, answered `Tester`/`y`):
  exactly one `(y/N)` occurrence, exit 0, process exited.

## F45 — own prompt called imported/untrusted

- Cause: the terminal printed `UI_TEXT.promptUntrusted` unconditionally.
- Before (built product, headless, own prompt with `untrusted:false`):
  `Imported prompt: untrusted text. …`, then cancelled, exit 7.
- Fix (`d696e8dcd`): the notice prints only when `prompt.untrusted`.
- After (real pty): no `ntrusted` text for the own prompt. An actually
  imported prompt still takes the notice branch (code-gated; no import
  path was available in the sandbox to render one).

## F48 — scan printed words, exit 10 undocumented

- Cause: `src/runtime/exec/scanSecrets.ts` printed the pluralised
  `execScanMatches` string though the usage line promises only the number.
- Before: `1 secret match` on stdout, exit 10 (the `[info] Display
language…` line goes to stderr, where logs belong).
- Fix (`1923e6ea4`): stdout carries the bare count; the usage line names
  the exits in all 15 tables; the now-unused `execScanMatches` key was
  removed from all 15 tables. `npm run check:l10n`: 0 problems.
- After: dirty file → stdout `1`, exit 10; clean file → stdout `0`,
  exit 0.
- Left as named: `test/unit/scanSecrets.test.ts:26` asserts the old
  wording with hand-built fakes; per the owner's testing rules it is
  named here and untouched.

## F51 — "Playbook Settings (panel)" in the terminal

- Cause: `settingsText` (`src/runtime/playbook/text.ts`) interpolated the
  journal team id, which the terminal sets to `panel`
  (`src/runtime/main.ts` `teamId: 'panel'`).
- Before: `playbook settings` printed `Playbook Settings (panel)`.
- Fix (`ff28d809e`): the heading is the surface name alone.
- After: first line `Playbook Settings`, exit 0.

## F52 — `/threejs` listed twice

- Provenance, not a guess: with the real `muse` 1.4.6 on this rig (which
  has the threejs plugin installed: `muse skills list --source all --json`
  shows `plugin:threejs:threejs`), the real agent announced
  `commands (24): … threejs threejs:threejs …` after a local `/agents`
  prompt. Our mapping (`src/acp/agent.ts` `availableCommands`, via
  `MuseCodeHost.listSkills` which passes selectors through verbatim,
  `src/core/backends/musecode/MuseCodeHost.ts:1907`) emits one command per
  returned skill, and `threejs` is not a local command — so both selectors
  come from the CLI's `skill/list` frame: the bare plugin-name alias and
  the self-qualified selector with the same text. No screenshot or fake
  was involved.
- Fix (`5fb530e3d`): exported `dedupeSkillSelectors` collapses exact
  repeats and an identically-reading `X`/`X:X` pair (keeping the bare
  form); anything reading differently stays. Invocation is unaffected
  (selectors still route to the CLI).
- After (same drill, rebuilt): `commands (23): … threejs …`, one entry.
  Unit: `test/unit/skillDedupe.test.ts` (3 dedupe cases through the real
  helper). Upstream note: the CLI emits both forms; we dedupe at
  announcement per the brief rather than changing CLI behaviour.

## F43 — Model API session cannot start without a credential store

- Before: `session/new` (real SDK client) failed with `Internal error:
This computer's credential store cannot be used (store-unavailable)…`;
  `auth status` and `auth status --provider openai` failed the same way,
  exit 1.
- Causes: `modelApiReadiness` (`src/runtime/backends.ts`) let the store
  throw through to `unavailable`; several session-creation reads
  (`chatgpt` secret probe, snapshot redaction key, provider account id)
  did the same. A cross-bundle trap was found on the way: lazy bundles
  carry their own copy of `keyStore.ts`, so `instanceof
StoreUnavailableError` is false across bundles (the existing
  `isInvalidProvidersFileError` already uses name matching for this
  reason); the new `isStoreUnavailable` predicate matches by name.
- Fix (`165ac06be` + `eb9b5109f`): a dead store reads as no key at every
  session-creation choke point; readiness reports `signedOut` with the one
  F47 sentence, so `session/new` is refused as `Authentication required:
No key is stored, and this computer's credential store is unavailable.`
  (code -32000, was -32603 Internal error). `auth status` (both forms)
  prints the same sentence, exit 1.
- Boundary, stated plainly: starting the session itself with no readable
  credential at all remains refused. A Model API session is account-owned
  (`ModelApiHost.startSession` → `requireAccountId`,
  `src/core/backends/modelapi/ModelApiHost.ts:17759`; ownership also gates
  `ownedSnapshot` and `storedSession`/`listSessions`), and with no key
  store there is no account to own it — no turn could succeed either
  (Meta needs the key, subscriptions keep their secrets in the store).
  Only a stored key, `--key-stdin`, or a file-configured subscription
  signs a session; the earlier attempt to let keyless sessions start was
  reverted because it also downgraded the ordinary signed-out refusal from
  `authRequired` to an internal error. This last step needs ModelApiHost
  surgery and is left for the owner.

## F47 — one sentence for one condition

- Before: `providers status chatgpt` printed the two-clause message
  (`…unavailable. Sign in from an interactive desktop session…; on Linux,
start Secret Service first.`), different words for the same outage.
- Fix (`eb9b5109f`): new `acpStoreDown` key in all 15 tables —
  `No key is stored, and this computer's credential store is
unavailable.` — used by `providers status chatgpt`, both `auth status`
  forms, readiness, and the accounts command. The old
  `acpChatGpt.storeUnavailable` key is removed from all 15 tables.
- After: `providers status chatgpt` → exactly that sentence, exit 1.

## F46 — terminal accounts list claimed a missing connection

- Cause: with no `openai` provider configured, `AccountStore.list`
  throws `AccountStoreError('unavailable')`
  (`src/core/providers/accounts.ts:105`), and the terminal mapped every
  such error to `accounts.unavailable` ("…until this runtime is connected
  to the shared account service") — but the terminal IS the account
  service in its process (`src/runtime/providers/runtimeServices.ts`).
- Fix (`165ac06be`): `unavailable` from the store now reports
  `providerNotConfigured` with the provider name; a dead store reports the
  F47 sentence.
- After: `providers accounts list --provider openai` → `openai is not
configured; add it with providers add first.`, exit 1; `… --provider
meta` → the JSON account list, exit 0 — the terminal serves accounts as
  helped.

## F80 — plan model refused for want of the Meta key

- Cause: `modelApiReadiness` skipped the ChatGPT-subscription probe
  whenever `deps.exec` was set (`src/runtime/backends.ts`), so
  `exec --backend modelApi --model chatgpt/…` with no Meta key was refused
  (`signedOut` → `auth_required`, exit 3) although the plan needs no Meta
  key — the editor path does send plan requests.
- Before (this rig has no store, so the refusal read `Backend
Unavailable`, exit 3 — same gate, earlier branch).
- Fix (`165ac06be`): readiness takes the run's model (`AcpBackend.readiness`
  gained an optional `modelHint`; `runExec` passes `options.model`). A
  plan ref (`chatgpt/…`, `copilot/…` via the new shared
  `isPlanModelRef`/`PLAN_MODEL_PROVIDERS` in
  `src/shared/providerRouting.ts` — provider core stays out of the
  headless/engine bundles per the split gate) with a ChatGPT sign-in is
  ready; without one the refusal names the plan sign-in
  (`ChatGPT is not signed in.`). The submitted attempt skipped the USD
  ledger, priced reservation and settlement check based on the model prefix.
  RVCLIFLOWS removed those unsafe exemptions: provider ids are configurable,
  and `--max-requests` must not silently stop applying. Pre-session refusal
  reasons still print on stderr; positive plan dispatch remains unfinished.
- After: the same command exits 3 with `Authentication Required` plus
  `[error] No key is stored, and this computer's credential store is
unavailable.` on stderr. The positive path (ChatGPT signed in, no Meta
  key) cannot run on this store-less rig and was not run: it needs the
  owner's real-life drill (Windows, ChatGPT signed in) — the exact command
  from the finding.
- Unit: `isPlanModelRef` cases in `test/unit/skillDedupe.test.ts`.

## Submitted lane gates (historical; superseded by RVCLIFLOWS)

- `npm run build`: exit 0.
- `npm run check:l10n`: exit 0 (0 problems).
- `npm run check:reference`: exit 0 (sharing reference matches the catalog).
- `npx vitest run test/unit/sharingTerminal.test.ts
test/unit/skillDedupe.test.ts --maxWorkers=3`: 24 passed, exit 0.
- `npx vitest run test/e2e/acpStdio.e2e.test.ts
test/e2e/execStdio.e2e.test.ts --maxWorkers=3`: 59 passed, exit 0 —
  including the packed-product E7 scanner cases (counts-only, no keyring).
- `npm run typecheck`: host/webview/e2e/integration pass; `typecheck:unit`
  was red on `test/unit/runtimeChatGpt.test.ts:423,501`, which referenced the
  key this lane removed using hand-built rigs. No untouched-base comparison
  was supplied, so this is not called pre-existing. RVCLIFLOWS replaces the
  stand-ins and measures a passing full typecheck.
- ESLint (`--max-warnings=0`) and Prettier on every changed file: clean.
- `npm run check:host-api`: exit 0 (0 problems).
- `npm run deadcode` (knip): exit 0 (2 configuration hints; origin unmeasured).
- `npm run cycles` (dpdm): exit 0, no circular dependencies.
- `npm run duplication`: exit 0, 0 clones.
- `npm run security:audit`: exit 0 (2 advisories, 1 exception-file entry).
- `npm run security:sast`: scan completed, 0 findings (0 blocking,
  533 rules, 3226 files). The process exits 2 only because semgrep's
  post-scan version check cannot write its cache on this rig's read-only
  filesystem (`OSError: [Errno 30] Read-only file system:
'/home/randy/.cache/semgrep_version'`); the failure is after the scan,
  not in it.

## What was not run and why

- No live or paid model call (brief forbids it): F80's positive
  plan-model run and any keyed turn are left for the owner's real-life
  drill. `muse serve` was used only for session/skill listing, never for
  a turn.
- `npm run test:a11y` / harness screenshots: no UI surface changed
  (terminal text only).
- An actually-imported (`untrusted:true`) prompt was not rendered: no
  import path exists in the terminal sandbox; the branch is code-gated
  (`if (prompt.untrusted)`).
