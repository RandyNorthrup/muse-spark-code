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
| `e9dd258b8` | Bundle-split listing for the three new modules; MCP deferral default 0 until the live pair                        |
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

| Drill | Break (file)                                                                                                     | Red (exit, failing test)                                                                                                                   | Restore, green                      |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| A     | `sortedCatalog` returns its input unsorted (`deferredTools.ts`)                                                  | exit 1: "gives byte-identical definitions for a reversed listing and reversed servers"                                                     | byte-exact, exit 0                  |
| B     | deferral never applies (`planDeferral` condition `true \|\| …`)                                                  | exit 1: "measures the large catalogue past 55k…", "appends discoveries in discovery order…", "shows deferral cutting declared MCP tokens…" | byte-exact, exit 0                  |
| C     | search needs any query word, not every one (`searchCatalog` `every` → `some`)                                    | exit 1: "finds tools by description words", "needs every query word, and a wordless query matches nothing"                                 | byte-exact, exit 0                  |
| D     | mid-turn apply: requests read the live pool catalogue, not the turn's frozen one (`declarations.ts` `current()`) | exit 1: "applies a mid-turn tools/list change at the next user turn, said once" (request bytes differed mid-turn)                          | byte-exact, exit 0 (17/17)          |
| E     | an undiscovered deferred tool counts as callable (`declarations.ts` `isUndiscovered` → `false && …`)             | exit 1: "declares tool_search alone past the threshold, then appends what a search loads" (expected false to be true)                      | byte-exact, exit 0 (17/17)          |
| F     | (the bundle-split gate, `npm run build`) the three new backend modules on neither list (`d39a4a391`)             | exit 1: "is on neither list in scripts/check-bundle-split.mjs" for each                                                                    | listed in `e9dd258b8`, build exit 0 |

A–C ran in the first run (2026-11-02) against code the finishing run did
not change (`sortedCatalog`, `planDeferral`, `searchCatalog`); D and E ran
in the finishing run, first on `47e5bb291` and again on `d39a4a391`
(same failing tests, restored byte-exact, 17/17 green).

## Gates

Finishing run, 2026-11-02, on the final tree (`e9dd258b8` plus this
record), with the repository's own test timeouts. The second half of the
run had the command sandbox off, which let it list the bundle split,
package, and reach the OS keyring.

| Gate                                                                                                                    | Exit          | Note                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check`, `eslint --max-warnings 0` (touched files)                                                           | 0, 0          |                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run typecheck`                                                                                                     | 0             |                                                                                                                                                                                                                                                                                                                                                                     |
| `node scripts/check-l10n.mjs`                                                                                           | 0             | 0 problems                                                                                                                                                                                                                                                                                                                                                          |
| `npm run check:reference` / `check:host-api` / `check:plan` / `check:roadmap`                                           | 0 / 0 / 0 / 0 |                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run check:catches`                                                                                                 | 0             | counts match the baseline                                                                                                                                                                                                                                                                                                                                           |
| `npm run duplication` / `cycles` / `deadcode`                                                                           | 0 / 0 / 0     | 0 clones                                                                                                                                                                                                                                                                                                                                                            |
| `npm run build`                                                                                                         | 0             | every budget holds (`dist/modelApi.js` 524.4 of 525 KiB, `dist/modelApiMcp.js` 72.5 of 75 KiB); bundle split, lazy registry, host globals, notices, legal build records (0 problems) all pass                                                                                                                                                                       |
| `vitest run` mcpDefer, manifest, noDefaultLimits, execArgs, featureCatalogDetails, cliArgs, teamStartup, acpTeamPackage | 0             | 17 + 152 + 39 + 7 tests                                                                                                                                                                                                                                                                                                                                             |
| `vitest related` (the five changed MCP/meter sources; 68 files)                                                         | 1             | 64 passed, 1 skipped; failing: `teamProcessWorkers` and `teamWorkerChecks` (both fail the same way on base `72d8d5003`) and `providerHeadersStore`, which failed only for lack of a DBus socket inside the sandbox and passes 3/3 with the sandbox off (rig `randy-lt`, linuxlt); `externalOrchestrator` failed once under load and passed alone twice, and on base |
| `node scripts/package-vsix.mjs --target linux-x64` (after `npm run package`'s build)                                    | 0             | `muse-spark-code-linux-x64-0.19.0.vsix`, 4,632,956 bytes (budget 4,915,200). The all-platform `npm run package` exits 1: `Required native helper excluded from VSIX: native/linux/arm64/muse-created`, a helper this rig does not build                                                                                                                             |

The first run's build never finished (the lane stopped inside it); the
finishing run found `dist/modelApi.js` at 528.6 KiB against its unchanged
525 KiB budget and fixed it in `d39a4a391` (the pool builds the session's
declarations, so the deferral code loads with `dist/modelApiMcp.js`). No
budget was raised. The build's `check-legal-build-records` first failed on
an empty `pnpm-lock.yaml` the sandbox had created in the worktree; the
empty `pnpm-lock.yaml` and `yarn.lock` placeholders were removed (never lane
files), and the remaining empty placeholders (`.gitmodules`, `.yarnrc`,
`.yarnrc.yml`, `bunfig.toml`) stay untracked.

Packed-product check, no model call: the packed `package.json` declares
`museSpark.modelApiMcpDeferTokens` as an integer, default 0, minimum 0,
machine scope. Inside the packed `dist/runtime.bundles.json.br`,
`modelApi.js` carries the request meters and the cache-miss attribution
but no deferral code, and `modelApiMcp.js` carries the `tool_search`
definition and the turn-change words; the model texts (`tool_search`
answers, the not-connected sentence, the load-first refusal) ride the
build's shared text table, as every model text does.

## Not run, and why

- **The counted live pair** (full vs deferred, 16 eval tasks, one real
  local MCP server; worst case 294 attempts, expected ~135): the lead
  saved Muse's weekly allowance for merging and this lane may make no
  Muse request. The brief ships deferral default-suggested only if the
  floors hold, so the shipped default is 0 (always load every schema) and
  README, CHANGELOG and PLAN name 10,000 as the suggestion; the lead
  switches the default after the pair holds the floors.
- **The packed-product real use** of `tool_search` on
  `muse-spark-1.3-contributor`: same reason.
- **`npm run ui:look`** of Account & usage (two new rows, light and dark):
  Chromium starts, but the harness throws `themed is not defined` in
  `waitForHarness` before the page renders, for `usage-page-one-provider`,
  `usage` and the unrelated `palette` alike, so the harness fails on this
  base for every scene; no look was taken.
