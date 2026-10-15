# PRTH154 — PR 154 review fixes

Windows, Node 24.20.0, npm 11.19.0, 2026-10-15. No provider requests and
no credential access in this lane. Tests use real modules and real folders;
no stand-in, source-text guard, screenshot comparison or coverage target.

## T1 — uncertain credential deletion

Before: `removeStored` discarded both delete results, treated any nonzero
`auth status` as absence, and dropped ownership. Input: remove, clear and
status all exit 1 because the OS store is unavailable. That path previously
removed the route from `configured` with an empty `left` list.

After: require at least one successful provider deletion (or successful Meta
clear) as well as a non-present status. Failed ownership remains for the
next cleanup, is listed as possibly left, and fails the final exit. Meta's
marker remains until a clear succeeds. Evidence: real `authClearProvider`
returns 0 only after awaiting store deletion (`src/runtime/authCommands.ts`).

Lead real-life proof: interrupt a keyed run while the OS credential service
is unavailable. Both deletions failing must leave the provider in the
record and exit 1; restore the service before the final cleanup to observe
the retry clear it. Repeat for Meta and check its recovery marker remains
on failure. No fake-store test added; this path needs the real OS service.

## T2 — failed route setup

Before: a present provider credential returned `ok: false` with no `seen`;
all cells became `notRun` and the final check looked only at failed cells.
After: any `!state.ok` sets exit 1 at the setup boundary, regardless of
whether a setup observation exists. No credential is replaced or removed.

Lead real-life proof: reserve the route name before setup using the real
product. The run must exit 1, name the occupied entry and leave it alone.
The per-run identity repair in T4 removes ordinary cross-run collisions;
the failure boundary still handles an occupied generated name or failed add.

## T3 — unread ledger liability

`heldUnsettled(...).unread` now sets exit 1 and ends admission; the text
record names unknown liability rather than showing only the readable sum.
A null JSON claim is retained as unread instead of throwing.

Fail-first command: `npx vitest run test/unit/realLifeGuards.test.mjs
--maxWorkers=2`. Before the null guard, exit 1, 6 passed / 1 failed:
`TypeError: Cannot read properties of null (reading 'settledUsd')` at
`ledger.mjs:43`. With the fix, exit 0, 7 passed. Logs:
`.lane/T3-red.log`, `.lane/T3-green.log`. T10 records deliberate mutation
and byte-exact restoration. Real-life lead step: corrupt an unsettled
`claim.json` in a kept fresh run before final accounting; expect exit 1,
`unread` in JSON and `UNKNOWN DAILY-LEDGER LIABILITY` in the text record.

## T4 — concurrent provider identities

Removed the shared static account from active setup. Every invocation gets
96 random bits; each route uses that identity plus its ordinal (under the
32-character provider id bound), including every matrix model. Cleanup only
owns that invocation's names. Key-free per-provider recovery notes survive
root removal and let the next run report a killed run's entries. Legacy
static and diagnostic names are still reported, never removed.

Real-module test: different run identities across all configured routes
produce distinct valid accounts; notes in a real folder preserve all names
and clearing one retains the others. `npx vitest run
test/unit/realLifeGuards.test.mjs --maxWorkers=2`: exit 0, 8 passed.
T10 includes deliberate break and hash restoration. Lead step: start two
runs of the same route concurrently; observe different `added as` names,
then end one and confirm the other still completes with its own key.

## T5 — terminal journal reconciliation

Before: exec always chose `person.made`, and matrix cells never read the
journal. A child ending without a result could count zero despite a written
journal request. After: journal snapshots bracket every cell; terminal
accounting keeps the greater of result/journal counts in each category,
without double counting. Missing/incomplete results or a rejected launch
mark the cell failed and stop all further admission, even if the journal
recovers some usage: it cannot prove no other dispatch was lost. The record
always keeps the cell's journal count.

Lead real-life proof: during a paid exec (also matrix), terminate the child
after the product has journaled usage but before the result is printed.
Expect recovered requests/cost, a failed missing-result observation, and
no later paid cell dispatched. A real provider/credential is required;
no stand-in or new process test was introduced. Static evidence is the
removed `!isMatrix` branch and the new missing-result admission stop.

## T6 — ACP request admission honesty

The review's permitted alternative is used: no invented ACP option, no
product protocol change, and no limit increase. `--max-requests` is now
explicitly an admission stop, not a hard in-flight ACP request bound, in
help, preflight, README, guide and text records. Exceeding a cell's request
declaration fails it and stops all later scenario admission, rather than
continuing when the overall allowance still has room.

Lead step: run a real ACP tool scenario whose model takes extra turns.
Preflight must warn before spending; after usage exceeds the declaration,
observe the failed request count and no later admitted scenario. For a
strict hard request ceiling use the product's bounded exec surface, not
ACP; this lane does not claim ACP acquired a request limiter. No application
command/setting or feature-catalog entry changed (runner-only tooling).

## T7 — Node preload injection

The shared environment filter now excludes `NODE_OPTIONS` and `NODE_PATH`
case-insensitively for both installer and product. Pure test data contains
`--require`/`--import` strings; they are never placed in the actual process
environment or executed. Existing PATH remains. No hook environment changed.

Fail-first: `npx vitest run test/unit/realLifeGuards.test.mjs
--maxWorkers=2`, exit 1, 8 passed / 1 failed, `expected '--require
outside.cjs' to be undefined`. After fix: exit 0, 9 passed. Receipts:
`.lane/T7-red.log`, `.lane/T7-green.log`. T10 records deliberate break and
SHA-256 restoration. Lead step: start the runner from a shell with a benign
preload configured; it must not run in npm or installed product children.
The runner's own parent process remains the operator's responsibility.

## T8 — unconsumed model overrides

Each override route must appear exactly once in `--routes`; validation is
before any install, key access or dispatch. Valid selected overrides remain
unchanged. Pure parser test red: exit 1, 9 passed / 1 failed, `expected true
to be false`; after fix exit 0, 10 passed. Commands:
`npx vitest run test/unit/realLifeGuards.test.mjs --maxWorkers=2` (logs
`.lane/T8-{red,green}.log`). Real command with `--routes openai --model
openia=gpt-x --artefact package.json --max-requests 1 --max-usd 1 --record
.lane/no-spend-record` exited 2 with `--model route openia must be selected
exactly once in --routes`, before keys or install. No provider needed.

## T9 — localized usage labels

The allowed explicit-locale alternative is used: all product child
environments pin `LC_ALL`, `LC_MESSAGES`, `LANG` to `en_US.UTF-8`. This
also overrides Windows' runtime fallback, unlike `C` (the real
`src/runtime/locale.ts` falls back to runtime locale for `C`). The guide
states that UI scenarios certify English only, not translations.

Pure environment test red: exit 1, 10 passed / 1 failed, `expected
'de_DE.UTF-8' to be 'en_US.UTF-8'`; after fix exit 0, 11 passed. Command:
`npx vitest run test/unit/realLifeGuards.test.mjs --maxWorkers=2`; receipts
`.lane/T9-{red,green}.log`. Lead real-life step: invoke the usage scenario
on both surfaces from a German-locale shell; English usage labels and the
request/cost assertions must succeed. No paid request made here.

## Merge

Merged `ac21f1d24` in `c1ead3231`, hooks on. Only AGENTS.md and CHANGELOG.md
conflicted: kept both changelog additions, kept the real-life contract and
main's real-product-only testing rule. Main's test deletions remain deleted;
neither real-life test file was deleted by main.
