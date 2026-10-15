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

## Merge

Merged `ac21f1d24` in `c1ead3231`, hooks on. Only AGENTS.md and CHANGELOG.md
conflicted: kept both changelog additions, kept the real-life contract and
main's real-product-only testing rule. Main's test deletions remain deleted;
neither real-life test file was deleted by main.
