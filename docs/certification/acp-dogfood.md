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
