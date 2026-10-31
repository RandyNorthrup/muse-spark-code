# RLF-TEAMWORKERS2 — external workers that can start, and the governed check slots (2026-10-31)

Lane `RLF-TEAMWORKERS2`, worktree `/Users/user/lanes/RLF-TEAMWORKERS2`, branch
`rec/rlf-teamworkers2`, on the test rig `MacBookPro.ivettnet`, in Claude Code
(Sonnet 5.5). Base: `rec/rlf-teamworkers` at `f96b69586` (RLF-TEAMWORKERS,
`docs/certification/rlf-teamworkers.md`, §6 and §7). **Muse requests: 0. Model
turns: 0. Paid provider calls: 0.** The Muse Code hosts this lane started ran
Muse Code's own `echo` provider with `--no-session-log` against a scratch
`XDG_CONFIG_HOME` under the ignored `temp/`, so no Muse session record was
written and no real sign-in file was read. No other vendor's agent was run
against an account: the four packages were installed with `--ignore-scripts`
into `temp/pkgs/<name>`, their code and README were read, and only
`--help`, `codex mcp list` and `codex features list` were run, under
`env -i` with a scratch `HOME` and `CODEX_HOME`. Nothing was pushed, rebased,
stashed or tagged. The real OS credential-store suites and the vault suites
were not run (MacBook rule); no browser or GUI app was started. Temporary
folders were under `temp/tmp` (a canonical path: `/var/folders` is a link the
worker fence refuses, as the base record measured).

## 1. What landed

| Piece                                                                                                                                                                                                                     | Where                                                                                                                     | Proof                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| The governor host lends a team's slots exactly its queue's `request`, its `capacity` and its running count                                                                                                                | `ResourceLaunchHost.teamSlotPorts` (`launchHost.ts`), on the window host's port (`admission.ts`)                          | `teamCheckSlotsGoverned` cases 1–6                                                                                                |
| `GovernedTeamSlots` is constructed for heavy checks: a check takes the governor's `check` permit (disk-heavy), then a folder; a folder whose processes are not proved ended keeps both. `requestCheckSlot` has its caller | `CheckSlots` (`checkSlots.ts`); the join is `createGovernedCheckSlots` in the runners runtime (`teamRunnersEntry.ts`)     | `teamCheckSlotsGoverned`                                                                                                          |
| The scheduler's slot travels back to the caller (`GovernedTeamSlot.slot`), and a queue that grants while the scheduler's count says full is asked again after a poll, not in a microtask loop                             | `scheduler/slots.ts`                                                                                                      | §4 (the freeze measured; the poll alone has no suite)                                                                             |
| `dist/teamRunners.js` reads the slots module from `dist/teamScheduler.js` instead of carrying a second copy                                                                                                               | `scripts/lib/deferredBundles.mjs`, `teamSchedulerEntry.ts`                                                                | `npm run build` (the split gate failed on the second copy; green after)                                                           |
| Presets carry either kind of switch for leaving out the person's MCP servers: spawn arguments, or the `_meta` of `session/new`                                                                                            | `acpWorker.ts` (`withoutUserServersSwitch`, `withoutUserServersMeta`), `workerFence.ts` (`acpSpawnArgs`), `acpProcess.ts` | `acpPresetSwitches` (7)                                                                                                           |
| `claude` and `gemini` start with their captured switch; `codex` and `copilot` keep refusing, in words                                                                                                                     | `ACP_PRESETS`                                                                                                             | `acpPresetSwitches`; `teamProcessWorkers` (the codex refusal, no launch record)                                                   |
| `muse-spark-code-acp --no-user-mcp-servers`, and the `own` preset starts with it: no session opens while the person's Muse settings turn an MCP server on or cannot be read                                               | `userMcpServers.ts`, `agent.ts` (`openHost`), `main.ts`, `cliArgs.ts`, `cliOptions.ts`, `cliHelp.ts`, `docs/acp.md`       | `noUserMcpServers` (5); `teamProcessWorkers` (the real packed agent refuses; the sign-in case still reaches its sign-in sentence) |
| Two new sentences and the flag's help text in English and all 14 tables; the generated reference                                                                                                                          | `en.ts`, `l10n/ui.*.json`, `docs/reference.md`                                                                            | `node scripts/check-l10n.mjs`, `npm run check:reference`                                                                          |
| The relocation, governed-check and process-worker suites share one launch host helper and one packed-agent rig                                                                                                            | `helpers/resourceRig.ts`, `teamProcessWorkers.test.ts`                                                                    | `npm run duplication` (0 clones)                                                                                                  |

## 2. Item 1b: what each vendor's package says (captured 2026-10-31)

Every package was read from its published tarball. Nothing below was run
against an account, so each switch's _effect_ is from source and
documentation, not from a session.

| Preset    | Package at version                                                              | The switch                                                                                                                                                                                                            | Source read                                                                                                                                                                                                                                                                                                                                                                                       | Wired                                     |
| --------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `claude`  | `@agentclientprotocol/claude-agent-acp` 0.99.1 (SDK `claude-agent-sdk` 0.3.312) | `session/new` `_meta.claudeCode.options.strictMcpConfig: true`, the SDK's `--strict-mcp-config`: only the MCP servers passed in, "ignoring all other MCP configurations: project `.mcp.json`, user settings, plugins" | `dist/acp-agent.js`: `userProvidedOptions = sessionMeta?.claudeCode?.options` (8933), spread into the SDK options (9052), `strictMcpConfig` classified in `OPTION_REBUILDS_SESSION` (437); the SDK's `sdk.d.ts` 2371–2379 for the option's meaning                                                                                                                                                | yes (`withoutUserServersMeta`)            |
| `gemini`  | `@google/gemini-cli` 0.66.0                                                     | `--allowed-mcp-server-names <name>`: with a list, "only servers from this list ... will be connected to"; an empty list means no list, so one name no server carries allows none                                      | `gemini --help`; `bundle/docs/reference/configuration.md` (the flag), `bundle/docs/tools/mcp-server.md` (`mcp.allowed`); the bundle: `loadCliConfig` sets `allowedMcpServers` from `argv.allowedMcpServerNames`, `isBlockedBySettings` blocks a name outside a non-empty list, and `GeminiAgent.newSessionConfig` calls `loadCliConfig(settings, sessionId, this.argv, …)`, so `--acp` honours it | yes (`muse-team-no-user-mcp-servers`)     |
| `codex`   | `@agentclientprotocol/codex-acp` 2.5.0 (Codex CLI 0.165.0)                      | none that is all-off. `mcp_servers.<name>.enabled=false` per server works; `-c mcp_servers={}` does not                                                                                                               | `codex mcp list` over a real `config.toml` with two servers: plain, both enabled; `-c 'mcp_servers={}'`, both still enabled; `-c mcp_servers.docs.enabled=false`, `docs` disabled and the other enabled. The adapter reads names from Codex's layered config (`config/read` with layers)                                                                                                          | no: the names live in files not read here |
| `copilot` | `@github/copilot` 1.0.105                                                       | none that is all-off. `--disable-mcp-server <name>` is per server, `--disable-builtin-mcps` covers the two built-ins, and `--additional-mcp-config` only adds                                                         | `copilot --help` (a scratch `HOME`). Whether `--acp` honours the per-server flag is **UNMEASURED**                                                                                                                                                                                                                                                                                                | no                                        |

`codex` and `copilot` stay refusing with the words the base lane added
(`hostExternalNoSwitch`); a name-by-name switch would need this product to read
each vendor's layered config files, which is the owner's call (§7). `gemini` and
`copilot` still have no captured mode, so a role refuses them one step later
(`hostExternalNoMode`); that is the `initialize` captures' to fill, not this
lane's.

A bridge server passed in `session/new` is outside "the person's own" servers
and the team passes none today (`bridgeServers: []`). Gemini's allow-list would
block one that is not named, and Claude's strict mode keeps it (it is passed in).

## 3. Item 1a: the Muse Code switch the base record recommended does not work

The base record (§2 "Measured facts", §6) took `-c mcpServers.<name>.enabled=false`
as the switch for leaving out a user's server, measured on Muse Code 1.4.10
with no such server configured. Measured here on **Muse Code 1.4.14
(1.4.14-R7309.1)**, `muse serve --provider echo --no-session-log` with
`XDG_CONFIG_HOME` pointing at a scratch folder whose `muse/settings.json` is the
file named in the first column:

| Settings file holds                     | `-c` given                                                               | Result                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| no server                               | `mcpServers.docs.enabled=false`                                          | accepted (the host runs until stdin closes)                                          |
| `mcpServers.docs`                       | `mcpServers.docs.enabled=false`                                          | **refused**: `refusing run: the server name is reserved`                             |
| `mcpServers.docs`                       | `mcpServers.docs.enabled=true`, or `mcpServers.docs.command="/bin/true"` | **refused**, the same words                                                          |
| `mcpServers.docs` with `enabled: false` | `mcpServers.docs.enabled=false`                                          | **refused**, the same words                                                          |
| legacy `mcp_servers.docs`               | `mcpServers.docs.enabled=false`                                          | **refused**, the same words                                                          |
| `docs`, `my-server_2`, `alpha`          | the same switch for each name                                            | each **refused**; `nosuch`, `beta`, `ide`, `team`, `muse` (not in the file) accepted |
| `docs`                                  | none                                                                     | the host runs                                                                        |
| a name with a dot, `b.c`                | `mcpServers.b.c.enabled=false`, `mcpServers."b.c".enabled=false`         | refused as `unknown key`: such a server cannot even be addressed                     |

The same on a real host over the SDK (`MuseClient.spawn` with the echo provider,
a user server that is a node script appending a line to a marker file, then
`startSession`): default start, the server **ran** (marker written twice, the
host and the session); a config home without it, no marker; with
`-c mcpServers.docs.enabled=false` the host never answers `initialize` (`configError
(exit code 3, retry: fix-config)`); with `--preset empty` the server still **ran**.
`muse config status` shows only system-file and managed-preference planes
(absent here), not a per-run layer. The exported MSP schema's `SessionConfig`
admits only `mcpServers` ("native MCP servers added only to this session
runtime"), and the SDK's `StartSessionOptions` omits `config`; whether a session
server of a configured name could replace it is **UNMEASURED**.

So no `muse serve` argument leaves a configured server out. What the lane built
instead is the fail-closed form (`--no-user-mcp-servers`): the agent reads the
settings file before it opens a session (`$XDG_CONFIG_HOME/muse/settings.json`,
else `~/.config/muse/settings.json`; the worker's scrubbed environment keeps
`HOME` and drops `XDG_CONFIG_HOME`, so a worker reads the second), under either
spelling of the key, and refuses in words while any server there is on
(`enabled` other than `false`) or the file cannot be read or parsed. A missing
file holds none. It never writes the file (D17). The Model API backend loads none
of the person's MCP servers, so the flag changes nothing there. The refusal is
checked before the sign-in, so a settings problem is not hidden behind "not
signed in". Not built, with the reason:

- _Relocating `XDG_CONFIG_HOME` for the worker._ Muse Code keeps its sign-in in
  that home; the agent may not copy a credential file (AGENTS.md rule 8), and a
  link to it could be replaced by a token refresh. Not built.
- _Turning the servers off in the person's file._ The extension never writes that
  file (D17).
- _`--preset empty`._ Measured: the server still runs.

## 4. Item 2 (Q3): the governed check slots

The shape: `teamSlotPorts()` returns `{ queue: { request }, governor: { capacity },
running: { backgroundCount } }` and nothing else, and throws on a disposed host or
on a host whose admissions go to the runtime's queue (`options.admission`, the
ACP agent's shape), which owns no queue to join. `CheckSlots` takes it as
`governor` and builds `GovernedTeamSlots` over it with its own folders as the
scheduler's side: `preflight` fails at once when every folder is uncertain (no
wait could end), `acquire` takes the free folder, and the `TeamCapacityPort` is
the folder count and the busy count. `run` and `installInCopy` go through one
`withFolder`. A folder whose descendants are not proved ended is not given back,
and neither is its permit (the M96c rule: "release only after observed
retirement"). `requestCheckSlot` asks for `kind: 'check'`, `diskHeavy: true`: every
governed `check` launch (`admit`) is disk-heavy, so a disk hold the person's floor
causes keeps a team check waiting too.

**The caller is `CheckSlots`, and the check path above it has no caller yet.**
`createTeamRuntime().loadRunners()` has no caller in `src`, `CheckSlots` is built
nowhere, and `bridgeRunChecks` / `routeWorkerCheck` are `@unwired`. This lane
built the join and its caller inside the check slots and proved them on real
parts; no check in the product has waited on the governor, because none runs
through this path. Wiring the check route is a separate lane (§7).

`dist/resourceGovernor.js`: 120.0 → **120.4 KiB** of its 125, budget unchanged.
The slots module moved out of the runners bundle by structure: the split gate
failed ("`dist/teamRunners.js` carries shared implementation
`src/core/team/scheduler/slots.ts`"), so the runners build now reads it from
`dist/teamScheduler.js` through the deferred cohort, which re-exports
`GovernedTeamSlots` (the window bundle already reads the same module there).
`dist/teamRunners.js` 34.2 of 75, `dist/teamScheduler.js` 61.2 of 75 (60.2 at
RLF-TEAMFIT), `dist/team.js` 58.3 of 75, `dist/teamProcess.js` 313.4 of 375.

**A poll in `GovernedTeamSlots`.** While drilling the folder rule, the break that
frees an uncertain folder's permit but keeps the folder busy froze the vitest
worker for over nine minutes (I stopped it): the queue granted, the scheduler's
count said full, and the loop asked again in microtasks without ever yielding.
That is the loop's own hazard, and it would freeze the extension host the same
way for any adapter whose count and the queue disagree. The loop now waits
`RESOURCE_LAUNCH_POLL_MS` (100 ms, the constant the governed launches already
poll with) before it asks again, stops at once on its signal, and the wait stays
a poll, not a count: it exists to survive a disagreement and ends as soon as the
queue's and the scheduler's counts agree.

## 5. Real suites and red/green drills

Real code only: the real governor reading this machine's live sampler under a
limit the person set (`memoryMaxPercent: 0` holds it at throttle; a disk floor
above the free space holds disk-heavy work), the real launch host and queue, real
git repositories and clones, real node processes as the checks, the real `muse
serve` on its echo provider, and the real packed ACP agent (staged by
`stageAgentBundle`, an empty home). The test transport for a check is the
established one (`sshRunnerUnreachable`): the real process, a clean exit read as
the container's proof; one command names an exit without that proof. Repository
timeouts throughout; the governed-check cases and the real-agent cases carry one
named per-test timeout each with its reason in the file (real clones and process
waits).

- `teamCheckSlotsGoverned.test.ts` (6): under throttle two checks run one after
  the other, and without a governor the same two overlap; a disk hold keeps a
  check waiting until the person resumes; a check stopped while it waits never
  starts; a check whose processes are not proved ended keeps the one place
  throttle allows; the accessor refuses a delegating host and a closed one.
- `noUserMcpServers.test.ts` (5): the guard over real settings files (missing,
  empty, all off, one on, the legacy key, invalid JSON, a folder where the file
  belongs), the parser, and the packed agent's `--help` and `help serve`.
- `acpPresetSwitches.test.ts` (7): each preset's arguments, the two refusals, an
  extra argument, and Claude's `session/new` request.
- `teamProcessWorkers.test.ts` (10, was 9): the real packed agent refuses its
  session in words for settings that turn a server on; the codex refusal; the
  sign-in sentence still comes through the new flag.

Each drill: one break, the owning suite's non-zero exit, byte-exact restore
(SHA-256, `temp/drill/drill.py`), green in the final runs.

| Break                                                        | Caught by                                                                 | red |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | --- |
| `withFolder` ignores the governor and takes a folder at once | throttle case (`expected 1 to be greater than 2`) and the disk-hold case  | 1   |
| `requestCheckSlot` drops `diskHeavy`                         | disk-hold case (`['start held', 'end held']` where `[]` was due)          | 1   |
| `teamSlotPorts` lends a delegating host its own queue        | accessor case                                                             | 1   |
| An uncertain folder and its permit both freed                | place-keeping case (`['start next', 'end next']`); green 0 after restore  | 1   |
| `own` preset without its switch                              | `acpPresetSwitches`                                                       | 1   |
| `session/new` request without the preset's `_meta`           | `acpPresetSwitches` (Claude)                                              | 1   |
| `acpSpawnArgs` accepts an extra argument                     | `acpPresetSwitches`                                                       | 1   |
| Guard refuses a server that is turned off                    | `noUserMcpServers`                                                        | 1   |
| Guard lets an unreadable file pass                           | `noUserMcpServers`                                                        | 1   |
| Parser drops `--no-user-mcp-servers`                         | `noUserMcpServers`                                                        | 1   |
| `openHost` never asks the guard                              | `teamProcessWorkers` (the agent reaches its sign-in instead)              | 1   |
| The two sentences left off the outbound allow-list           | `teamProcessWorkers` (the generic "That did not work" reaches the person) | 1   |
| `main.ts` never hands the guard to the agent                 | `teamProcessWorkers`                                                      | 1   |

Two measured non-drills:

- The release of an uncertain folder's _permit alone_ no longer shows: the
  scheduler's own busy count keeps the one place throttle allows, so that single
  break is masked (before the poll existed it froze the worker, §4). The compound
  break above is the drill for the place-keeping case.
- Removing the 100 ms poll leaves the suite green: it guards a disagreement no
  real part produces now. It has no suite; the freeze above is its measurement.

## 6. Gates (final tree)

Exit codes are each command's own; the suites ran with the repository's own
timeouts, `--maxWorkers=3`.

| Command                                                     | Exit         | Result                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx prettier --check` on every touched file                | 0            |                                                                                                                                                                                                                                                                |
| `npx eslint --max-warnings 0` on every touched `.ts`/`.mjs` | 0            | one nested ternary in `deferredBundles.mjs` found and fixed (its commit)                                                                                                                                                                                       |
| `npm run typecheck`                                         | 0            | six projects                                                                                                                                                                                                                                                   |
| `node scripts/check-l10n.mjs`                               | 0            | 14 UI tables, 14 usage tables, 0 problems                                                                                                                                                                                                                      |
| `npm run check:reference`                                   | 0            | current (365 CLI entries)                                                                                                                                                                                                                                      |
| `npm run check:host-api`                                    | 0            | after `--write`: the slots poll counts one more `node:timers/promises`                                                                                                                                                                                         |
| `npm run check:plan`                                        | 0            | 244 milestones, 0 drift                                                                                                                                                                                                                                        |
| `npm run check:roadmap`                                     | 0            | 244 entries, current                                                                                                                                                                                                                                           |
| `npm run check:catches`                                     | 0            | counts equal the baseline; the new catch (`userMcpServers.ts`) is NARROW                                                                                                                                                                                       |
| `npm run duplication`                                       | 0            | 0 clones (four found in the first draft, shared into `launchHostOver` and `packedAgentRig`)                                                                                                                                                                    |
| `npm run cycles`                                            | 0            | none                                                                                                                                                                                                                                                           |
| `npm run deadcode`                                          | 0            | knip clean (tag hints only)                                                                                                                                                                                                                                    |
| `npm run build`                                             | 0            | every size row holds (§4); split gate, lazy registry (187 bundles, 295 loads), host-globals, notices, legal records green                                                                                                                                      |
| Touched suites                                              | 0            | `teamCheckSlotsGoverned` 6, `noUserMcpServers` 5, `acpPresetSwitches` 7, `teamProcessWorkers` 10, `resourceRelocationDevices` 12, `cliHelp`/`cliHelpConsistency`/`cliArgs` 94, `teamChunkPackaging`/`acpTeamPackage`/`governorWindowsBundle`/`lazyBundleFiles` |
| `npx vitest related <16 changed sources> --run`             | RELATED_EXIT | RELATED_RESULT                                                                                                                                                                                                                                                 |
| `npm run package:acp -- --target darwin-arm64`              | not run      | the base record: this rig lacks a prebuilt native helper; the staged agent (`stageAgentBundle`) is what the suites and `--help` ran                                                                                                                            |
| `npm run security:audit`, `npm run security:sast`           | not run      | not in this brief's gate list; no dependency changed                                                                                                                                                                                                           |

`src/shared/l10n/en.ts` is a hub every suite imports: it is covered by
`check-l10n`, `typecheck` and the suites above, not by a related run.

## 7. Not built, open questions, and what I recommend

1. **`own` needs the person's Muse settings to turn no MCP server on** (§3). The
   a profile like the owner's (the M96 research found a Chrome Control server in
   it) needs those servers set `enabled: false`, or a clean profile, for the live
   run's external half. **Recommendation:** ask the Muse Code owners for
   a real per-run switch ("start without user MCP servers"), since
   `-c mcpServers.<name>.enabled=false` was meant for this and refuses exactly
   the names that matter; until then the fail-closed flag is the guarantee. I
   cannot file that upstream.
2. **A contributor-tier model on the `own` worker.** The agent lists contributor
   models only with `--allow-contributor-models` (`openHost` filters them without
   it), the `own` preset passes no such flag, and `acpSpawnArgs` refuses extra
   arguments by design. So the live run's external entry on
   `muse-wonder-full-1.0-contributor` could not select its model (read from the
   code; the agent asks for sign-in first, so it is not run). Options: (a) the
   `own` preset adds the flag when its pool entry names a `-contributor` model id,
   so the person's choice of that id in the pool is the opt-in; (b) keep refusing
   and run the external half on no contributor model, which this lane's rules do
   not allow. **Recommendation:** (a). It is a consent decision (Meta may train on
   the content), so I did not build it.
3. **The check route has no caller.** `loadRunners`, `bridgeRunChecks`,
   `routeWorkerCheck` and the construction of `CheckSlots` are unwired, so Q3's
   caller is proven on real parts and not yet live. **Recommendation:** one lane
   that wires the check route and calls `createGovernedCheckSlots` there, with a
   real heavy check in the packed editor.
4. **Codex and Copilot per-server switches.** Wiring them means reading each
   vendor's layered config files for server names (`$CODEX_HOME/config.toml` and
   project `.codex/config.toml`; `~/.copilot/mcp-config.json`), which sit beside
   those vendors' credentials. **Recommendation:** do not; ask each vendor for an
   all-off switch, as in (1).
5. **Claude's and Gemini's switches have not been seen to work**, only read: they
   need a signed-in account, which this lane may not use. The first live run that
   uses either should list the agent's MCP status (`/mcp` in Claude's adapter) and
   record it here.
6. **Q1, the roles snapshot, stays out** and waits for the Roles panel's file
   roles (the panel builds its roles from `builtinRoles()` only), as the base
   record's §6 and the lead's brief say.
7. **The refusal is checked when a session opens**, not for the life of a running
   host. The team starts one agent process per task, so the file is read afresh;
   an editor that keeps the agent for hours with the flag would not notice a server
   added later.
8. **Project servers.** Muse Code may also read a project's own MCP
   configuration (UNMEASURED here); the flag guards the person's settings only,
   as the lead's wording ("the person's own") says.

## 8. Decisions for the lead (notes, no D number)

1. `own` stays startable by refusing, not by switching (§3): a settings file with a
   server on makes a team worker fail with the guard's sentence, which reaches the
   person behind the protocol's fixed "Invalid request:" prefix.
2. Heavy-check permits are disk-heavy and background class (the same as every
   governed `check` launch) and take priority 0.
3. The 100 ms poll in `GovernedTeamSlots` (§4) reuses `RESOURCE_LAUNCH_POLL_MS`.
4. A host whose admissions go to the runtime's queue (the ACP agent) cannot lend
   `teamSlotPorts`; a team in the ACP agent has no governed checks until the
   runtime's queue can be joined.
