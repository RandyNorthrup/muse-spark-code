# RLF-SECMCP — MCP tool-definition pinning and the read-only hint (SEC-MCP-PIN, SEC-MCP-HINT)

Date: 2026-11-02. Rig: linuxlt, worktree `/home/randy/lanes/RLF-SECMCP`,
branch `rec/rlf-secmcp` from main at 0.19.0. Record:
`PLAN.md` D42 amendment of 2026-11-02.

## What landed

- `src/core/backends/modelapi/mcp/toolText.ts` — the canonical written
  form of one tool's definition (name, title, description, inputSchema,
  annotations; object keys sorted) and `escapeHiddenChars`, which spells
  every control/format/separator character out as a `\u{XXXX}` escape.
- `src/core/backends/modelapi/mcp/toolPins.ts` — the pin hash (SHA-256 of
  the canonical definition), `partitionByPins` / `repinned`, and
  `McpToolPinStore`: `tool-pins.json` beside the era verdicts in the same
  folder, keyed by the launch identity's verdict key, storing tool names
  and hashes only, written atomically, read failures said out loud.
- `src/core/backends/modelapi/mcp/pool.ts` — every listing (a start's
  first, `list_changed`, a stale `ttlMs` refresh, a header-mismatch
  relist) goes through `offer`, which now partitions by the pins: a first
  listing records and offers; a changed or new tool is held back,
  unoffered, logged by server and tool name only, its old pin kept.
  `acceptTools` re-pins and re-offers from the last listing and answers
  the accepted function names. The snapshot carries each server's
  held-back tools and every kept tool's full text. An offered tool is by
  construction the pinned text, so `McpToolRef.isPinnedReadOnly` is its
  server's claim with the pin behind it.
- `src/core/backends/modelapi/permissions.ts` — `PermissionQuery`
  carries `isPinnedReadOnly`; `mcpVerdict` eases only on claim × pin, so
  an unpinned hint asks in Auto and is refused in Plan.
  `forgetForSession` drops one session rule.
- `src/core/backends/modelapi/ModelApiHost.ts` — both MCP query sites
  carry the pin fact; the B1 floor's `mcpWrite` and the team in-place
  writer check read it too. `prepareMcp` drops every held-back tool's
  session rule the moment drift is seen and says one notice per
  held-back set (an unchanged relist repeats the notice key, so it is
  silent). `acceptMcpTools` drops the old text's rules in every live
  session before and after the pool re-pins.
- `src/host/team/mcpBridge.ts` — a read-only caller is offered only
  pinned read-only tools.
- Elicitation: `validateElicitationSchema` marks a field whose name
  `isSecretFieldName` as `isSecret`; the panel card types it as a
  password with a "this asks for a secret for {server}" note; ACP, whose
  form vocabulary has no secret marker, carries the same sentence in the
  field's description.
- `src/host/commands/museConfigCommands.ts` — a connected server's row
  says how many tools are held back; from its row, "Show Tool
  Descriptions" opens every tool's full text read-only at any time, and
  "Review Held-Back Tools" opens the changed text first, then offers
  Accept / Keep Refusing; dismissing accepts nothing. Wired through
  `cliFeatures`, the backend manager and `extension.ts`.
- Sixteen new sentences in English and all 14 tables
  (`node scripts/check-l10n.mjs`: 0 problems); the desktop l10n tables
  regenerated; the host-API record regenerated for the two new modules'
  Node imports.

## Red/green drills

1. **The pin reads the definition, not the name.** `toolPinHash` was
   broken on purpose to hash only `tool.name`.
   `npx vitest run test/unit/mcpToolPins.test.ts` → **3 failed, 7 passed**
   (the change-detection and drift cases). Restored; the suite is green
   again in the final runs below.
2. **The hint needs the pin.** `verdictFor`'s MCP arm was broken on
   purpose to ease on the bare claim.
   `npx vitest run test/unit/permissions.test.ts` → **3 failed, 82
   passed** (the hint×pin table, the session-rule case, the reviewer's
   reach). Restored; green again below.

## Proof

- `test/unit/mcpToolPins.test.ts` (10 tests) — canonical hashing and the
  partition over tools read from recorded listings
  (`test/fixtures/mcpEra/tools-list-modern.json`,
  `tools-list-annotations.json`); the store in real files, keyed by
  identities the product's own settings reader plans; the escaping.
- `test/unit/mcpPoolPins.test.ts` (3 tests) — the real pool over a real
  SDK stdio server process (`test/fixtures/mcpPins/server.mjs`) whose
  listing the test rewrites between starts: first start pins and offers
  with `isPinnedReadOnly`; drift holds the changed and new tools back,
  the log never carries the new description, the session rule dropped
  over the real snapshot by `heldBackFunctionNames` ends the old text's
  "always allow"; acceptance re-pins and offers; a later start is
  silent. A mid-session `list_changed` relist runs the same `offer` and
  partition, proven at that seam; the fixture server does not emit the
  notification, so no separate live relist is claimed.
- `test/unit/permissions.test.ts` — all four hint×pin combinations in
  every mode, through `verdictFor` and the engine, plus the rule drop.
- `test/unit/museConfigCommands.test.ts` — the row's held-back wording,
  the descriptions document, and the review's accept / refuse / dismiss
  paths over the command's own ports.
- `test/unit/mcpEra.test.ts`, `test/unit/acpElicitation.test.ts` — the
  secret marking on the recorded legacy form (renamed to a key field)
  and its ACP description.

No `ui:look` picture: the harness has no elicitation scene, so the
card's masked input was not rendered; the change there is the input
type and the note line, proven by typecheck and the schema-layer tests.
No packed-product or live-provider run is claimed.

## Gates

All run on this rig in this worktree: `npm run typecheck` 0;
`node scripts/check-l10n.mjs` 0; `npm run check:reference` 0;
`npm run check:host-api` 0 (record regenerated); `npm run check:plan` 0;
`npm run check:roadmap` 0; `npm run check:catches` 0 (baseline
unchanged); `npm run duplication` 0 clones; `npm run cycles` 0;
`npm run deadcode` 0; `npm run build` 0, every budget held; eslint
`--max-warnings 0` and prettier `--check` clean on every touched file.
`npx vitest related` over the pool, permissions and functions sources:
78 files, 1134 passed, 8 skipped, and 2 failed — both in
`test/unit/teamProcessWorkers.test.ts`, which times out running real
Muse Code worker turns on this rig; the same two tests fail the same
way on the untouched base (run in a throwaway worktree at HEAD), so
they are pre-existing here, not this change.
