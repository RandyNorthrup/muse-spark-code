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
