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

## Merge

Merged `ac21f1d24` in `c1ead3231`, hooks on. Only AGENTS.md and CHANGELOG.md
conflicted: kept both changelog additions, kept the real-life contract and
main's real-product-only testing rule. Main's test deletions remain deleted;
neither real-life test file was deleted by main.
