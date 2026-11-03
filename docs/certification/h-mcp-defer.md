# H-MCP-DEFER (4-H4) — deferred MCP loading, cache-stable catalogue, prefix meters

Lane RLF-DEFERTOOLS, rig `linuxlt`, branch `rec/rlf-defertools`, base
`72d8d5003` (rv/int9). PLAN.md §6 M128. No Muse request and no paid
provider call in either run: the first run (in Muse Spark Code, stopped
when Muse's weekly allowance was saved for merging) built and committed
parts 1–4; the finishing run (Claude Code, 2026-11-02) closed the design
gaps below, ran the drills that were missing and every gate.

## Commits

| Commit      | What                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `7acf00c31` | Deterministic catalogue order, deferral planning, prefix meters (pure modules + tests)                            |
| `69db9174d` | Deferred loading in the host, request meters, usage journal and Account & usage counts                            |
| `4adcc5bf4` | Defer threshold setting, `exec --mcp-defer-tokens`, feature catalog, docs, 14 locales                             |
| `47e5bb291` | One tested owner for per-turn declarations; `tool_search` names its servers; no-match names servers not connected |
| `d39a4a391` | Deferral code out of the main Model API bundle (budget), search answer and turn words composed in the class       |
| (this file) | Records: this certification, PLAN status, fixture manifest                                                        |

## One design for the three reports

- **Harness science 1.2/1.4 (the brief):** the catalogue is sorted by
  server id, then tool name, in code-unit order, before any request
  (`mcp/deferredTools.ts` `sortedCatalog`, `fitCatalogEntries`; the pool's
  `catalog()`); function-name collisions resolve in that same order. Each
  user turn freezes the catalogue and the threshold
  (`mcp/declarations.ts` `McpDeclarations.beginTurn`, called from the
  host's `prepareMcp`), so a `tools/list` change learned mid-turn reaches
  the prefix once, at the next turn, logged with counts only.
- **RSCH-CC R1 (Claude Code's tool search):** past the threshold a request
  declares `tool_search` plus the discovered tools in discovery order;
  `tool_search`'s description names each server and its tool count (a
  server costs its name up front, not its schemas); a search that finds
  nothing names the servers not connected now (`unconnectedMcpServers`),
  so a missing tool is never silently absent. Built-in and IDE tools
  always load. Behaviour matches, wire is ours (Model API function tools).
- **RSCH-PI R3 (the token measurement):** every counted request logs and
  journals its estimated tool-definition and rules tokens at the
  product's chars-per-token rule (`requestMeters.ts`) beside the
  provider's cached tokens; Account & usage shows the totals. A reported
  cache miss names which prefix component moved (model, instructions,
  tools), by short digest only (`promptCache.ts` `changedComponents`).
  R3's own goal — deferring rarely-first-turn _core_ tools (goal, todo) —
  is out of this brief, which keeps core tools always loaded.
- **Providers P6 (Anthropic's wire):** Anthropic's native `defer_loading`
  plus `tool_reference` needs its own paid capture first (P6 says so); this
  lane ships the provider-neutral local search the brief specifies, which
  works on every codec. P6's drill — a deferred tool the model never loaded
  is never callable — is drill E below.

Safety: `tool_search` only reads the session's local catalogue; it starts,
asks and runs nothing (tool class `read`). A discovered tool goes through
the same admission and permission path as any MCP call; an undiscovered
deferred one is refused in words (`toolSearchLoadFirst`). An allowlist
that leaves out `tool_search` declares the whole catalogue instead, so
deferral never makes an allowed tool unreachable. No credential reaches
any child (no new child). MCP list fetches keep their existing bounds
(D208). The threshold is a load preference the person sets, never a work
cap (D121): 0 never defers.

## Captures (AGENTS.md rule 14)

Captured 2026-11-02 on `linuxlt`, Node v24.21.0, no account, no model call,
HOME pointed at a throwaway folder under the lane's gitignored `temp/`:

1. `npm install @modelcontextprotocol/server-everything@2.1.0 @modelcontextprotocol/server-filesystem@2026.7.4`
   in an empty scratch folder.
2. Spawn `node node_modules/@modelcontextprotocol/server-everything/dist/index.js stdio`
   (and `.../server-filesystem/dist/index.js <scratch folder>`), write
   newline-delimited JSON-RPC to stdin: `initialize` (protocol
   `2025-06-18`, empty capabilities), `notifications/initialized`,
   `tools/list`; for `everything` a second identical `tools/list` (the
   no-op refresh). Each reply line is kept as received.
3. Saved as `test/fixtures/mcpDefer/everything-tools-list.json` (16 tools,
   two replies) and `filesystem-tools-list.json` (14 tools);
   `manifest.json` names the versions.

The scratch script passed the lane's whole environment to the server; a
recapture should pass only `PATH` and `HOME`.

## Proof (real code only, 0 model calls)

`test/unit/mcpDefer.test.ts`, 17 tests, replays the captured frames
through the pool's own boundary parsers (`listToolsResultSchema`,
`toolInfoSchema`) and fitting (`fitCatalogEntries`), and the session's
requests through the real core tool builder (`tools.ts`
`toolDefinitions`) and `promptCacheKey`:

- sorted order: a reversed listing and reversed servers give
  byte-identical definitions;
- the prefix digest holds across the captured no-op refresh and changes
  only in `tools` when a tool really leaves;
- the ≥55k-token catalogue (the captured `everything` tools under 32
  server ids, 512 tools, ≥55,000 estimated definition tokens) defers at
  10,000, and the deferred MCP surface is under a twentieth of it;
- request 1 past the threshold carries the core tools plus `tool_search`
  alone; a search loads its match, the next request's tool bytes start
  with the previous request's (append-only), a repeat search changes
  nothing, and the next turn keeps the discovery and says deferral once;
- a mid-turn `tools/list` change keeps the turn's request bytes and cache
  key; the next turn applies it once (15 tools, counted tokens), and the
  turn after says nothing;
- threshold 0 declares the whole catalogue and loads nothing;
- search by description words, argument name, name fragment; every query
  word is needed; a wordless query matches nothing;
- the meters measure definitions and rules at the chars-per-token rule.

## Red/green drills

Each break went red on the named test, then the file was restored from
its copy and `cmp` confirmed it byte-exact before the green run.

| Drill | Break (file)                                                                                                     | Red (exit, failing test)                                                                                                                   | Restore, green             |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| A     | `sortedCatalog` returns its input unsorted (`deferredTools.ts`)                                                  | exit 1: "gives byte-identical definitions for a reversed listing and reversed servers"                                                     | byte-exact, exit 0         |
| B     | deferral never applies (`planDeferral` condition `true \|\| …`)                                                  | exit 1: "measures the large catalogue past 55k…", "appends discoveries in discovery order…", "shows deferral cutting declared MCP tokens…" | byte-exact, exit 0         |
| C     | search needs any query word, not every one (`searchCatalog` `every` → `some`)                                    | exit 1: "finds tools by description words", "needs every query word, and a wordless query matches nothing"                                 | byte-exact, exit 0         |
| D     | mid-turn apply: requests read the live pool catalogue, not the turn's frozen one (`declarations.ts` `current()`) | exit 1: "applies a mid-turn tools/list change at the next user turn, said once" (request bytes differed mid-turn)                          | byte-exact, exit 0 (17/17) |
| E     | an undiscovered deferred tool counts as callable (`declarations.ts` `isUndiscovered` → `false && …`)             | exit 1: "declares tool_search alone past the threshold, then appends what a search loads" (expected false to be true)                      | byte-exact, exit 0 (17/17) |

A–C ran in the first run (2026-11-02) against code the finishing run did
not change (`sortedCatalog`, `planDeferral`, `searchCatalog`); D and E ran
in the finishing run, first on `47e5bb291` and again on `d39a4a391`
(same failing tests, restored byte-exact, 17/17 green).

## Gates

Finishing run, 2026-11-02, on the final tree (`d39a4a391` plus this
record), with the repository's own test timeouts:

| Gate                                                                          | Exit          | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check`, `eslint --max-warnings 0` (touched files)                 | 0, 0          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run typecheck`                                                           | 0             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `node scripts/check-l10n.mjs`                                                 | 0             | 0 problems                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm run check:reference` / `check:host-api` / `check:plan` / `check:roadmap` | 0 / 0 / 0 / 0 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run check:catches`                                                       | 0             | counts match the baseline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `npm run duplication` / `cycles` / `deadcode`                                 | 0 / 0 / 0     | 0 clones                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `npm run build`                                                               | **1**         | every budget holds (`dist/modelApi.js` 524.4 of 525 KiB, `dist/modelApiMcp.js` 72.5 of 75 KiB); it stops at `check-bundle-split.mjs`: the lane's three new backend files are on neither list, and `scripts/` is read-only to the lane's sandbox (patch below). The steps after it, run directly: `gen-lazy-registry --check` 0, `check-host-globals` 0, `third-party-notices` 0, `check-legal-build-records` 1 (it reads an empty `pnpm-lock.yaml` placeholder the sandbox created in the worktree, not a lane file) |
| `vitest run test/unit/mcpDefer.test.ts`                                       | 0             | 17/17                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `vitest related` (the five changed MCP/meter sources; 68 files)               | 1             | 64 passed, 1 skipped; failing: `providerHeadersStore` (no DBus socket for the OS keyring inside the sandbox), `teamProcessWorkers` and `teamWorkerChecks` (both fail the same way on base `72d8d5003`); `externalOrchestrator` failed once under load and passed alone twice, and on base                                                                                                                                                                                                                            |

The first run's build never finished (the lane stopped inside it); the
finishing run found `dist/modelApi.js` at 528.6 KiB against its unchanged
525 KiB budget and fixed it in `d39a4a391` (the pool builds the session's
declarations, so the deferral code loads with `dist/modelApiMcp.js`). No
budget was raised.

The bundle-split listing the lead applies (three lines):

```text
scripts/lib/deferredBundles.mjs, MODEL_API_OPTIONAL_ONLY, after 'mcp/verdicts.ts':
  'mcp/declarations.ts',
  'mcp/deferredTools.ts',
scripts/check-bundle-split.mjs, LAZY_ONLY, after 'promptCache.ts':
  'requestMeters.ts',
```

## Not run, and why

- **The counted live pair** (full vs deferred, 16 eval tasks, one real
  local MCP server; worst case 294 attempts, expected ~135): the lead
  saved Muse's weekly allowance for merging and this lane may make no
  Muse request. The brief ships deferral default-suggested only if the
  floors hold, so the 10,000 default is the lead's decision (open
  question in the final report).
- **The packed-product real use** of `tool_search` on
  `muse-spark-1.3-contributor`: same reason.
- **`npm run package`**: it runs `npm run build` first, which stops at the
  bundle-split listing above; packaging follows once the lead adds it.
- **`npm run ui:look`** of Account & usage (two new rows, light and dark):
  Chromium started, but the harness threw `themed is not defined` in
  `waitForHarness` before the page rendered, for both `usage-page-one-provider`
  and `usage`; not investigated further on this budget.
