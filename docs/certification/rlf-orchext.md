# RLF-ORCHEXT — the orchestrator can be any available agent (D250) (2026-10-31, macmini)

Recovery lane. Base: int/recovery at `0a5ebd718` (CC-INT5: the team cluster is
on int; `cc-int5.md` and `rlf-teamwire.md` are the records it builds on). The
lane ran first in Muse Spark Code (`22fe21fd3` to `c0da0006c`) and stopped
when Muse's weekly allowance ran out (429, resets 2026-11-02T00:00:00Z); it was
finished here, in Claude Code (Claude Sonnet 5.5) on the same rig, worktree and
branch. This record is the lane's proof. **No Muse request of any kind was
made in the finishing run, no paid provider call, no Claude Code, Codex, Gemini
or Copilot was started, and no credential was read.** The two real runs the
brief names (below) are written out for the lead.

## The decision, and what it changed

The owner, 2026-10-30: "the orchistrator needs to be able to be and available
provider same as the team agents ... we dont [modify the agent behaviors] we
just provide the agent with tools and the instruction on how they can be
used." Recorded first as **D250** in PLAN.md §2 (amending D75, archive
pointer in `docs/plan-archive/decisions.md`), then built:

- **The slot offers what the pools offer.** `buildTeamModelOffers` adds the
  five presets (Claude Code's `claude-agent-acp`, `codex-acp`, `gemini --acp`,
  `copilot --acp`, our own `muse-spark-code-acp`) and the person's own agents
  by command (`museSpark.teamExternalAgents`, machine-scoped, validated, a
  broken row dropped), each marked lead-only where this editor can lead but
  not run it as a worker (`worker: false`; a pool entry on it refuses in
  words). An agent whose command is not on the machine is left out and
  recorded as absent. `orchestratorSlot.ts`, `teamPanelViews.ts`,
  `teamHost.ts` and `RolesSection.tsx` no longer drop, invalidate or treat
  as Default an external pick.
- **A third conversation host kind, `external`** (`BackendKind`), so the
  controller, auth, paid boundary, schedules and best-of-N treat it as its
  own host with its own payer, never as a sign-in of ours.
- **The host** (`src/host/team/externalOrchestrator.ts`, lazy bundle
  `dist/externalOrchestrator.js`) runs the agent as itself over ACP on lane
  W's one connection (`acpProcess.ts`, now conversation-grade): one process
  per window and pick, a child of the window (tree killed on close, respawned
  on demand, `session/load` where the agent advertises it), environment minus
  credential variables. Messages, reasoning, tool calls, plans and usage
  stream as conversation items; the agent's permission requests become the
  person's cards; Stop is `session/cancel`; `fs/*` is served confined to the
  workspace; a model the person named is confirmed by the agent or nothing
  starts; the agent's permission mode is mapped only where a preset's captured
  table (or identity) allows, else it keeps its own and the pill says so.
- **Tools and instructions, nothing else.** The conversation's own `team`
  endpoint (and the `ide` server) go in `session/new` `mcpServers`: HTTP when
  the agent advertises it in `mcpCapabilities`, otherwise the shipped stdio
  bridge (`dist/teamHttpBridge.js`) that forwards every JSON-RPC line to the
  same endpoint — never a second implementation of the tools. The server's
  `instructions` (the MCP `initialize` field) carry how to lead with the five
  tools; the tools' descriptions are the rest. The agent's loop, system prompt
  and sign-in are untouched.
- **Sign-in stays the agent's.** No login of ours, no credential file read.
  `AcpAuthRequiredError` becomes the sentence "{agent} is not signed in. Sign
  in with its own command: run {command}…" (for Claude Code: `claude`); an
  `authenticate` the agent itself offers (agent-kind method) is passed
  through once, as the agent's own flow; a terminal method is never run by us.
- **Who pays** is said in three places: the switch confirmation, the
  conversation's first notice, and the Roles slot itself (this finishing run
  added the last one: `teamExternalLeaderNotice` under the orchestrator in
  `RolesSection.tsx`).

## Commits

| Commit      | What                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `22fe21fd3` | D250 in PLAN.md §2 and the archive pointer (before any code)                                     |
| `302c0cf64` | the orchestrator slot offers external agents (registry, slot, views, host reading, Roles picker) |
| `17cade768` | MCP `instructions` and a conversation-grade ACP connection                                       |
| `c52631ee5` | a third conversation host kind, `external`                                                       |
| `e341ce9a1` | the external host, the entry, the bridge, the wiring, the lazy bundles                           |
| `d3e82cfb7` | suites over a real ACP agent process and the real bridge                                         |
| `c0da0006c` | the renamed fixture flag in the orchestrator suite                                               |
| `7dc64a196` | the `teamExternalAgents` setting text in the 14 manifest tables (check-l10n was red: 14 rows)    |
| `fb22ef843` | narrow catches, the host's refusals in the 14 tables, the MCP-use proof                          |
| `4620db3d5` | the Roles slot says who pays; two assertions that fail when they should                          |
| `0bb42f515` | the external bundle named as an ACP SDK classic-zod carrier (`check-bundle-split` was red)       |
| `dd2622efe` | zero clones, no dead exports, knip entries, host-API record, a resume test that loads            |
| `2355e8486` | the slot reader without a nested ternary; the chunk-packaging suite names the spawned bridge     |

The closing commit adds this record and the CHANGELOG, README, PLAN §6 and
roadmap entries.

## Proof (real code only)

No stand-in for our modules, a provider, the CLI, GitHub, an MCP server or a
store. The "outside world" in the suites is a real ACP agent process
(`test/fixtures/external-orchestrator/agent.mjs`: the pinned SDK's own agent
builder over real stdio with a scripted turn instead of a model, every frame
validated by the SDK, everything it observes recorded as JSON lines), the
real loopback team endpoint behind the real `TeamHostBinding` and the real
team host bundle's factory, and the built bridge process.

- `test/unit/team/externalOrchestrator.test.ts` (10 tests): the endpoint
  travels in `session/new` over the bridge (agent without HTTP) and over HTTP
  (agent with it); **the agent opens the server it was handed — over HTTP and
  by spawning the bridge command, as a real agent does — and reads the
  instructions, the five tools and the roster**; the turn streams as items
  (thought, message, tool call, plan, usage); a permission request is the
  person's card and the chosen option is what the agent receives; cancel
  reaches the agent (`session/cancel`) and the turn ends `cancelled`; a named
  model is confirmed or the start refuses; a terminal-auth agent names its own
  sign-in command; an agent-kind `authenticate` is passed through; the agent
  dies on its first prompt, the open turn fails in words, and resume starts it
  again and goes through `session/load` with the replayed history (before this
  run the "resume" test passed through the still-live path and never loaded).
- `test/unit/team/teamHttpBridge.test.ts` (2): the built bridge carries
  `initialize` instructions, the five tools and a roster answer, refuses a
  forged token as a JSON-RPC error naming 401; a down endpoint is answered
  with an error naming the errno word and the bridge stays up for the next
  call.
- `test/unit/team/externalAgents.test.ts` (7), `test/unit/teamOrchestratorSlot.test.ts`
  (25): offers, lead-only honesty, a removed entry resolves to nothing, the
  stored external pick is read as itself, and the panel accepts it as lead.
- `test/unit/teamRolesSection.test.tsx` (the new case): the Roles section,
  rendered, shows who pays for an external pick and nothing for an engine pick.
- `test/unit/teamMcpWiring.test.ts` (existing, now on the shared binding
  helper `helpers/teamMcpBinding.ts`): real HTTP, other tokens refused.

## Red/green drills

Each: break the code on purpose, run the named suite, read the non-zero exit,
restore the file byte-for-byte (from a copy taken before; `git diff --stat`
showed the tree back to the change under test), run it green.

| #   | Break                                                                                 | Suite                                        | Red                                                                                                                                                                       | Green              |
| --- | ------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1a  | `readOrchestratorOverride` drops an external pick again (D75's keep)                  | `teamOrchestratorSlot.test.ts`               | exit 1: "reads an external orchestrator as itself, never as another backend (D250)"                                                                                       | exit 0, 25 pass    |
| 1b  | `deriveTeamPanel` marks an external orchestrator invalid again                        | `externalAgents.test.ts`, `teamRolesSection` | exit 1 twice: the lead-accepted assertion (after it was strengthened; the first drill passed it by mistake) and the Roles case "expected [ Array(1) ] to deeply equal []" | exit 0, 7 / 8 pass |
| 2   | `acpMcpServers` returns no servers: the endpoint is missing from `session/new`        | `externalOrchestrator.test.ts`               | exit 1, 4 tests fail (bridge form, HTTP form, and both "agent uses the team tools" cases)                                                                                 | exit 0, 10 pass    |
| 3   | `isSameSecret` accepts a wrong token at the endpoint                                  | `teamHttpBridge.test.ts`                     | exit 1: the forged token got an answer, `error` undefined                                                                                                                 | exit 0, 1 pass     |
| 4   | `cancel()` no longer sends `session/cancel`                                           | `externalOrchestrator.test.ts` ("cancel")    | exit 1: the turn never ended, "Test timed out in 5000ms"                                                                                                                  | exit 0             |
| 5   | the bridge treats no errno word as a transport failure (rethrows, so the bridge dies) | `teamHttpBridge.test.ts` (down endpoint)     | exit 1: "Test timed out in 5000ms"                                                                                                                                        | exit 0, 2 pass     |

Logs of the runs are in the lane's `temp/drill/` (gitignored).

## Bundles and budgets (D6)

Production build on macmini, 2026-10-31. **`npm run build` exits 1: four size
rows are over, all four already over on the base `0a5ebd718`**
(`cc-int5.md`, open decision 1; RLF-TEAMFIT is shrinking `dist/teamHost.js` on
another rig). The base was rebuilt here for the comparison (`git archive` into
`$TMPDIR`, the same `node scripts/build.mjs --production`, removed after).
No budget was raised.

| Bundle                         | Budget  | Base (`0a5ebd718`) | This lane             | Lane's change                                                                                                      |
| ------------------------------ | ------- | ------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `dist/teamHost.js`             | 130 KiB | 140.2 KiB — OVER   | 141.0 KiB — OVER      | +785 B `constants.ts` (the MCP `instructions` text), +56 B `mcp.ts`, +31 B `teamMcpServer.ts`, −21 B `teamHost.ts` |
| `dist/teamRunners.js`          | 75 KiB  | 78.4 KiB — OVER    | 78.5 KiB — OVER       | +19 B `teamPanelDefinition.ts` (the offer's `worker` flag)                                                         |
| `dist/teamScheduler.js`        | 75 KiB  | 76.5 KiB — OVER    | 76.5 KiB — OVER       | 0                                                                                                                  |
| `dist/uiText.js`               | 125 KiB | 125.3 KiB — OVER   | 125.8 KiB — OVER      | about +0.5 KiB: the lane's team and external sentences                                                             |
| `dist/externalOrchestrator.js` | 250 KiB | —                  | 208.7 KiB (213,690 B) | new, lazy, loaded on the first external pick; 213,690 × 1.15 = 240 KiB → next 25 KiB multiple                      |
| `dist/teamHttpBridge.js`       | 25 KiB  | —                  | 2.2 KiB (2,282 B)     | new, lazy, spawned by an agent without HTTP MCP                                                                    |

The lane's only addition to `dist/teamHost.js` is the instructions text the
brief requires on the MCP server, which is in that bundle today; it moves with
the server when RLF-TEAMFIT gives the team MCP server its own bundle
(`cc-int5.md`, option (a)). Everything else of the lane's code is in its own
lazy bundles. The rest of the build chain, run by hand because `&&` stops at
the size check: see Gates.

## Gates (final tree)

Run on macmini, 2026-10-31, on the closing tree. Every suite ran with the
repository's own timeouts (no `--testTimeout`, at most 3 files per run).

| Gate                                                                                                                                   | Exit    | Note                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prettier --check` on the 94 touched files (`.vscodeignore` has no parser)                                                             | 0       | this record formatted by the hook at commit                                                                                                                                                                                                                                                |
| `eslint --max-warnings 0` on the 49 touched code files                                                                                 | 0       | three nested ternaries in the Muse run's committed code were rewritten (prettier strips the parentheses the rule asks for, so only a rewrite satisfies both)                                                                                                                               |
| `npm run typecheck` (host, webview, unit, e2e, integration, faults)                                                                    | 0       |                                                                                                                                                                                                                                                                                            |
| `node scripts/check-l10n.mjs`                                                                                                          | 0       | 0 problems; was 14 (the manifest setting text) before `7dc64a196`                                                                                                                                                                                                                          |
| `npm run check:reference`                                                                                                              | 0       |                                                                                                                                                                                                                                                                                            |
| `npm run check:host-api`                                                                                                               | 0       | record regenerated for the new node built-ins                                                                                                                                                                                                                                              |
| `npm run check:plan`                                                                                                                   | 0       |                                                                                                                                                                                                                                                                                            |
| `npm run check:roadmap`                                                                                                                | 0       | M96's entry updated, `ROADMAP.md` regenerated                                                                                                                                                                                                                                              |
| `npm run check:catches`                                                                                                                | 0       | host GENERIC 95 = base; no SWALLOW, GENERIC or CLEANUP count rose (the Muse run had left it at 96)                                                                                                                                                                                         |
| `npm run duplication`                                                                                                                  | 0       | 0 clones (was 14)                                                                                                                                                                                                                                                                          |
| `npm run cycles`                                                                                                                       | 0       |                                                                                                                                                                                                                                                                                            |
| `npm run deadcode`                                                                                                                     | 0       | two entries and a dead re-export fixed                                                                                                                                                                                                                                                     |
| `npm run build`                                                                                                                        | **1**   | the four base rows above, nothing else; `externalOrchestrator.js` 208.7/250 and `teamHttpBridge.js` 2.2/25 hold                                                                                                                                                                            |
| `check-bundle-split.mjs`                                                                                                               | 0       | was 1: classic zod in the new bundle (named carrier, `0bb42f515`)                                                                                                                                                                                                                          |
| `gen-lazy-registry.mjs --check`                                                                                                        | 0       |                                                                                                                                                                                                                                                                                            |
| `check-host-globals.mjs`                                                                                                               | 0       |                                                                                                                                                                                                                                                                                            |
| `third-party-notices.mjs`                                                                                                              | 0       |                                                                                                                                                                                                                                                                                            |
| `check-legal-build-records.mjs`                                                                                                        | 0       |                                                                                                                                                                                                                                                                                            |
| `SSL_CERT_FILE=/etc/ssl/cert.pem SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`                                                 | **1**   | 6 blocking findings in `scripts/build-packs.mjs`, `src/core/backends/modelapi/mcp/headers.ts`, `src/runtime/node/keyStore.ts`; none is a file this lane touched                                                                                                                            |
| `npm run security:audit`                                                                                                               | **1**   | high GHSA-mrwp-f3q8-3g9p in `follow-redirects`; `package-lock.json` is untouched by the lane                                                                                                                                                                                               |
| `node scripts/package-vsix.mjs`                                                                                                        | **1**   | "Required native helper excluded from VSIX: native/linux/x64/muse-created": the helpers are built per platform and none was built on this rig; not run, the lead packages                                                                                                                  |
| Lane suites (`externalOrchestrator`, `teamHttpBridge`, `teamMcpWiring`)                                                                | 0       | 3 files, 14 tests                                                                                                                                                                                                                                                                          |
| Lane suites (`teamRolesSection`, `teamOrchestratorSlot`, `externalAgents`)                                                             | 0       | 3 files, 91 tests                                                                                                                                                                                                                                                                          |
| Packaging lists (`manifest`, `packagedBundles`, `teamChunkPackaging`, `legalDistribution`, `legalCoverage`, `estimatorPricePackaging`) | 0       | `teamChunkPackaging` failed on `dist/teamHttpBridge.js` ("shipped but unreachable": it is spawned, never imported); the suite now names spawned team bundles, the bridge only, and every other `dist/team*.js` still has to be reached. This is the one existing gate test the lane edited |
| l10n suites (`l10n`, `l10nPackParity`, `l10nPacked`)                                                                                   | 0       | 45 tests                                                                                                                                                                                                                                                                                   |
| `npx vitest related` on the 24 non-hub changed sources                                                                                 | 1       | 384 files, 5608 pass, **11 fail in 5 files, all measured on the untouched base `0a5ebd718`** (below)                                                                                                                                                                                       |
| `npx vitest related` on `conversationController`, `agentBackend`, `settings`, `protocol`, `featureCatalog`                             | 1       | 243 files, 3759 pass, 7 fail in 3 files, all among the same five                                                                                                                                                                                                                           |
| `related` on `extension.ts`, `constants.ts`, `l10n/en.ts`, `l10n/text.ts`                                                              | not run | every suite in the repository depends on them; the l10n, packaging and lane suites above are the ones that name what changed                                                                                                                                                               |

**The related failures, each measured on the untouched base** (the base
extracted with `git archive` into `$TMPDIR`, the same command, then removed):

| Suite                                | Lane                                                                   | Base `0a5ebd718`                                                   | Cause as measured                                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectorStorageGuard` (3 tests)    | 3 fail                                                                 | the same 3 fail                                                    | fails identically on base                                                                                                                                                                                   |
| `teamEnginePorts` (5 tests)          | 5 fail, "The team copy is outside canonical storage"                   | the same 5 fail                                                    | fails identically on base; cause not investigated here                                                                                                                                                      |
| `providerHeadersStore` (2 tests)     | 2 fail, "User interaction is not allowed"                              | the same 2 fail                                                    | identical on base; the error is the keychain's own, "User interaction is not allowed"                                                                                                                       |
| `vault/chatgptSubscriptionMigration` | 1 fail, "run bash native/darwin/build.sh first"                        | the same fails                                                     | identical on base; the error says the native broker app is not built (`bash native/darwin/build.sh`)                                                                                                        |
| `scheduleFireFailures` (8 tests)     | 1 to 3 time out at 5 s under the full run; **8 of 8 pass twice alone** | 1 of 8 times out at 5 s alone, 8 of 8 passed in the first base run | a 5 s test timeout: it passes alone on the lane (twice) and times out alone on the base too, so it is not this lane's; the rig was busy (5-minute load average 6 to 7), the cause beyond that is UNMEASURED |

The OS credential-store and vault suites ran because this is the Mac mini, not
a MacBook; they wrote nothing the lane read.

## What the lead runs: Claude Code as the orchestrator (outside the sandbox)

Claude Code is the lead's own sign-in; nothing here was run from the rig.
Prerequisites: the packed product of this branch installed in VS Code with a
fresh `--user-data-dir` and `--extensions-dir`; `claude-agent-acp` on `PATH`
(the preset's command); `claude` signed in as the lead; an empty git
workspace (`git init`, one empty commit); `museSpark.team` on and a second
model set up so the team is runnable (D227), e.g. one Model API or local model
beside the conversation's own. Because `npm run build` is red on the four
base rows, build the product with `node scripts/build.mjs --production`
and package with `node scripts/package-vsix.mjs` (the same two steps
`npm run package` runs after the red check).

1. **Roles → Orchestrator.** The picker lists "Claude Code" (and the other
   presets whose commands are installed; not the ones that are not). Pick it.
   Expect the confirmation naming Claude Code as an external agent running as
   itself that is paid by its own plan or key; Continue. Expect the same
   sentence under the slot in Roles and no issue lines.
2. **New conversation.** Expect the info notice "Led by Claude Code, running
   as itself over ACP…". Send: "Call the team server's roster tool and list
   the roles it returns." Expect a `roster` tool-call item (its output is the
   roster) and an answer listing the roles; the reply streams in the panel.
3. **Instructions reached it.** Ask: "What does the team server tell you about
   how to lead?" Expect an answer that paraphrases the server's instructions
   (roster once, delegate whole independent tasks with a `command_id`,
   collect, review, merge; merges and paid work ask the person).
4. **Permission request.** Ask it to create `note.txt` containing `ok`.
   Expect a permission card with Claude Code's own options; allow once;
   expect the file. Repeat and reject: expect no file.
5. **Stop.** Send a long task ("write a 300-line essay to long.txt in 20
   steps"), press Stop. Expect the turn to end cancelled and Claude Code to
   stop (`session/cancel`); the next message works.
6. **Not signed in.** Sign out with Claude Code's own command, send a message.
   Expect: "Claude Code is not signed in. Sign in with its own command: run
   claude in a terminal, then send your message again." Sign in with `claude`,
   send again, expect a normal answer. (We never show a login of ours; the
   extension strips credential variables from the agent's environment, so a
   key exported only in the editor's environment does not reach it.)
7. **A worker is not Claude Code.** Roles → a pool entry: Claude Code is
   refused with "Claude Code can lead the team, but cannot run as a worker."
8. **Reset to Default** returns the orchestrator to the composer's model; a
   new conversation is single-lead again.
9. Record: the Claude Code and `claude-agent-acp` versions, the VS Code
   version, what each step showed, and the pictures (light and dark) of the
   Roles slot line (`ui:look` could not run here: see Not run).

The cost is Claude Code's, on the lead's plan; the extension makes no model
request of its own in these steps. No Muse request is needed.

## The Muse run to make after 2026-11-02T00:00:00Z

The brief's real run: our own packed `muse-spark-code-acp` as the **external**
orchestrator on `muse-spark-1.3-contributor` (by name), in an empty workspace
with a fresh HOME, contributor tier only. **Not run here: Muse's allowance is
used up until the reset (the lead's instruction), so zero Muse requests were
made.**

Expected request count, stated first: **8, hard cap 12** (the brief's cap):
about 2 for the roster turn (call, answer), 2 to 3 for the permission turn,
1 to 2 for the Stop turn, 1 to 2 for the instructions question. Stop and
report if the running count passes 12. Count from the session records after,
as `test/e2e/team.live.e2e.test.ts` does (`muse trace inspect --session-log`
on the sessions under the fresh HOME), and report the count.

Commands (lead; every path under one scratch folder outside the repository):

```sh
RUN=$(mktemp -d); export HOME="$RUN/home"; mkdir -p "$HOME" "$RUN/ws"
(cd "$RUN/ws" && git init -q && git commit -q --allow-empty -m init)
cd <the lane's worktree>
node scripts/build.mjs --production      # npm run build is red on four base rows
node scripts/package-vsix.mjs            # the .vsix for this platform
npm run package:acp                      # the muse-spark-code-acp tarball
npm install --prefix "$RUN/acp" <the tarball>   # no global install
code --user-data-dir "$RUN/ud" --extensions-dir "$RUN/ext" --install-extension <the .vsix>
```

Sign in to Muse on the fresh HOME with the CLI's own flow (the lead's usual
method for the real runs), then in `$RUN/ud/User/settings.json`:

```json
{
  "museSpark.team": true,
  "museSpark.teamExternalAgents": [
    {
      "name": "muse-own",
      "command": "<RUN>/acp/node_modules/.bin/muse-spark-code-acp",
      "args": ["--allow-contributor-models", "--trust-workspace"],
      "model": "muse-spark-1.3-contributor",
      "pays": "subscription"
    }
  ]
}
```

(`--allow-contributor-models` lists the contributor tier; `model` names it,
and the host starts nothing unless the agent confirms that exact id.) Open
`$RUN/ws`, configure a second model so the team is runnable, pick `muse-own`
as the orchestrator, then run steps 1 to 5 above with this agent. Refuse the
run if the session's provider model is not `muse-spark-1.3-contributor`.

**Blocked, not by the allowance: the worker leg.** The brief adds one worker on
`muse-wonder-full-1.0-contributor` and a delegate-and-merge task. The product
cannot run a Muse Code worker today: `canRunKind` is `kind === 'engine'`
(`extension.ts`), and `runMuseCodeWorker` / `runAcpWorker` have no product
caller (`rlf-teamwire.md`, open question 2: the assembly site was never
assigned). A `delegate` to a contributor-tier worker therefore cannot run in
the packed product, with or without Muse's allowance; the orchestrator side
(instructions, roster, permission, Stop) can. The same gap bounds step 7 of the
Claude Code check: the lead can see the refusal, not a delegated task.

## Not run, and why

- **The packed-product real runs** above: VS Code (Electron) cannot start on a
  macOS lane; Muse's allowance is used up until the reset; Claude Code is the
  lead's.
- **`npm run ui:look`** for the Roles slot line: no browser on this lane.
- **VS Code integration suites, `test:a11y`, `test:legal-a11y`**: Electron and
  Chrome (macOS lane).
- **Windows**: the new code compares paths through `path` and `realpath`
  only; hosted CI's Windows legs must confirm the bridge and the fixture agent
  (both spawn `process.execPath`).

## Open questions for the lead

1. **Who binds a Muse Code (and ACP) worker?** Without it the brief's worker
   leg cannot be run for real. Options: (a) the `museCode` `TeamWorkerPort`
   first, as a composite beside the engine port in the lazy team bundle
   (`rlf-teamwire.md`, recommendation); (b) bind external ACP workers after
   the held-session design; (c) accept orchestrator-only real runs for D250.
   Recommendation: (a), then rerun this record's Muse run with the worker.
2. **The four base budget rows.** Left as they are (no budget raised, none
   hidden). This lane adds 0.8 KiB to `teamHost.js` (the instructions text)
   and 0.5 KiB to `uiText.js`. Options: land RLF-TEAMFIT first and move the
   server (and the instructions) into `dist/teamMcp.js`; or give the
   `teamExternal*` sentences a lazily read English region of their own.
   Recommendation: TEAMFIT first, then re-measure this lane.
3. **README and CHANGELOG state the feature before the packed run.** The brief
   asks for both; AGENTS.md says a claim waits for real use. They say only what
   the real-code suites above proved. If the lead's Claude Code check (or the
   Muse run) contradicts a sentence, fix the code first, then the sentence.
