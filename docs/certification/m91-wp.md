# M91b: Amp and OpenCode plugin dispatch

Branch `m91/w-plugins`. It builds on `22e9e7ff`, the RVM91X fixes in
`m91-x.md`. The lead split this work from M91 on 2026-10-05; PLAN.md has its
entry ("M91b"). Every mapping follows the binding "Lane X event mapping" table
in PLAN.md M91 and cites the saved sources under `hooks-parity/raw/`:

- A: `amp_plugin-api.md`
- AC: `amp_customize_plugins.md`
- AS: `amp_cli_streaming-json.md`
- OI: `oc_plugin_index.ts`
- OP: `oc_plugins.mdx`
- OT: `oc_sdk_types.gen.ts`
- OS: `oc_config_schema.json`
- OC: `oc_config.mdx`

Nothing here was captured live, and no model was called.

## What was built

- **Records.** An Amp or OpenCode hook is one `spark-hooks.json` group:
  `{ format, sourceEvent, plugin, hooks: [{ type: 'plugin', timeout? }] }`,
  under the Muse event its route names.
  - `hooks.ts` `pluginGroup` builds the definition directly, never through
    the native `handler()`. The command is the plugin path, which must be
    absolute and already in normal form. The timeout is checked by the
    native rules, with `PLUGIN_HOOK_TIMEOUT_MS` as the default, and the
    matcher is parsed by `matcherFor`. `foreign.plugin` is set.
  - Every other format still refuses `type: 'plugin'`, and a `plugin` field
    on any other format is refused by name.
  - `PLUGIN_FORMATS` is its own list. `HOOK_FORMATS`, lane P's adapter list,
    is unchanged. `HOOK_FORMAT_NAME_KEYS` names both formats, so the Hooks
    picker lists them.
- **Dispatch.**
  - `ForeignPreparation` gains `{ outcome: 'plugin', run }`.
    `runForeignHandler` runs it under the host-wide cap
    (`acquireCommand`/`release`) and through the same judge, which strips
    every grant and turns a failure into a log line, never feedback.
  - In `foreignHooksEntry.ts`, each record's payload is built per the
    mapping (`pluginFormats.ts`) and run through `PluginSession.run`. There
    is one `PluginSession` per adapter, so one per Model API session.
  - The adapter's new `dispose` ends its children. `ModelApiSession.dispose`
    calls it.
  - A stopped turn's signal ends the running child.
  - A plugin child counts as a process the turn started (M86's checkpoint
    mark).
- **Fail-closed rule.** The rule is fail-closed only for OpenCode
  `tool.execute.before`, where a throw blocks (OI:266). Everything else fails
  open.
- **Amp's `error` result** (A:1978) matches Amp, per the lead's ruling: the
  call is refused, the tool never runs, and the turn ends with the plugin's
  reason.
  - `dispatchHooks` lets a stop at PreToolUse also refuse the call. Only an
    imported hook can stop there, because Muse's own parser refuses
    `continue` at PreToolUse.
  - `runCall` and `then_run` end the turn on it.
- **Answers.**
  - Amp `synthesize` (A:1974) becomes a refusal that carries its output: the
    tool must not run, and a PreToolUse answer has no result of its own here.
  - A `tool.result` or `tool.execute.after` replacement becomes its output
    text, so `replaceOutput` gets a string.
  - `updatedInput` goes back under our argument names, for the same tool
    only.
  - Amp `agent.end` `continue` is a Stop block, so the turn goes on. It is
    no longer also a stop.
- **Tool names and arguments** (`pluginFormats.ts`).
  - Amp: `Bash`, `Read`, `create_file`, `edit_file`, `Grep`, `glob`,
    `todo_write`, `read_web_page` (AS:51). `Read` takes `path` (AS:63), the
    same as ours.
  - OpenCode: `bash` (OP:94), `read` (OP:251), `write` (OC:352), `edit`
    (OC:520), `grep`, `glob`, `todowrite` and `webfetch` (OS:117-160). `read`
    takes `filePath` (OP:251), and `bash` takes `command` (OP:94), the same as
    ours.
  - Every other tool and argument keeps the runtime's name, as lane P does:
    no source shows one.
- **Amp shim.** `amp.helpers.shellCommandFromToolCall` is offered as pure
  data (A:2262-2278): a `Bash` or `shell_command` call gives
  `{ command }`, and anything else gives `null`. Every other helper still
  fails the hook.
- **RVM91X P2s.**
  - 9: OpenCode gets a copy of the args, so an in-place rewrite shows
    (OP:91-99).
  - 10: every exported plugin function runs, in load order (OP:66-70).
  - 12: memory is bounded:
    - on Windows, a job memory limit (`JOB_OBJECT_LIMIT_JOB_MEMORY`, added to
      M50's launcher as an optional `jobMemoryLimit`);
    - on Linux, bun runs under util-linux `prlimit --data`;
    - elsewhere, bun is refused rather than run unbounded.

    The bound is `PLUGIN_CHILD_MAX_MEMORY_BYTES`, 1 GiB: node does not start
    under a 512 MiB data limit, while bun 1.3.14 does.

  - 15: Amp `tool.result` carries `toolUseID`. Amp `agent.end` carries
    `messages`, built from the reply in the Stop payload (A:1583-1590).
- **Windows job preparation** (the lead's ruling).
  - A hook never runs without a tree.
  - A failed preparation is tried once more, from a fresh preparation, on a
    dispatch at least `PLUGIN_JOB_RETRY_BACKOFF_MS` (5 s) later. After a
    second failure it stays off.
  - Each refused hook carries a notice in the user's language,
    `pluginHooksNoJob`, in all 14 tables.
  - **Muse Spark: Retry Plugin Hooks** (`museSpark.retryPluginHooks`, shown
    in the palette on Windows) clears the failure and says so
    (`pluginHooksRetried`).
- **Importer** (`src/core/import/pluginImport.ts`; the glue is `scanAmp`,
  `scanOpenCode` and two collectors in `agentImport.ts`).
  - Amp sources: project `.amp/plugins/`; system
    `$XDG_CONFIG_HOME/amp/plugins/`, else `~/.config/amp/plugins/`
    (AC:49-52). Single files with `.ts` or `.js` (AC:100).
  - OpenCode sources: `.opencode/plugins/` and `~/.config/opencode/plugins/`
    (OP:20-23), with `.js`, `.mjs`, `.ts` and `.mts` files.
  - Hooks come from the literal names in the text. A name that is not a
    literal, a computed key, a bus handler that names no type, or no name
    found at all registers every mapped hook.
  - Lane I's rules, as for `checkClineScript`:
    - a personal plugin whose canonical path is in an open folder is refused
      `outside`;
    - project plugins are confined and read only when trusted;
    - the preview shows the file name and hook only;
    - directory plugins, and npm plugins (`plugin` in `opencode.json`,
      OP:31-36), are refused `unsupported`.
  - Refused hooks are listed with their reasons:
    - Amp `changes.prompt` (`unmapped`);
    - OpenCode `chat.params`, `chat.headers`, `small_model` and
      `tool.definition` (`chooses`);
    - the transforms and `shell.env` (`unsupported`);
    - `autocontinue` and `text.complete` (`unmapped`).
- **Bundles** (D6, option (b), the lead's call). The plugin host, its child's
  source and the mapping are `dist/pluginHooks.js`.
  `foreignHooksEntry` requires it on the first plugin hook. Neither the
  activation bundle, nor `modelApi.js`, nor `acp.js`, nor `foreignHooks.js`
  carries it; `check-bundle-split.mjs` checks all four. The bundle is also
  added to:
  - `.vscodeignore`;
  - the `.vsix` member list in `build.yml` (with `foreignHooks.js`, which
    lane W had left out);
  - `check-host-globals.mjs` (likewise with `foreignHooks.js`);
  - the notices header;
  - knip's entries;
  - the `cycles` script.

  The child stays `-e <source>`.

Measured on Kubuntu (`node scripts/build.mjs --production`, then
`check-bundle-size`, `check-bundle-split`, `check-host-globals` and
`third-party-notices`, all exit 0):

| Bundle                      | Size                    | Budget                                                           |
| --------------------------- | ----------------------- | ---------------------------------------------------------------- |
| `dist/pluginHooks.js` (new) | 51.6 KiB (52,823 bytes) | 75 KiB: measured plus 15%, rounded up to 25 KiB (PLAN.md D6 row) |
| `dist/foreignHooks.js`      | 69.5 KiB (71,145 bytes) | 75 KiB, unchanged                                                |
| `dist/agentImport.js`       | 154.5 KiB               | 175 KiB                                                          |
| `dist/modelApi.js`          | 444.0 KiB               | 475 KiB                                                          |
| `dist/extension.js`         | 595.3 KiB (was 593.8)   | 600 KiB                                                          |
| `dist/acp.js`               | 801.1 KiB               | 850 KiB                                                          |

The plugin host first went into `dist/foreignHooks.js` and took it to
97.6 KiB, so the lead chose option (b): the host gets its own lazy bundle.

## Tests

All are fakes or real children under the rig's own runtimes, and nothing
calls a model.

| Suite                                           | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pluginDispatch.test.ts`                        | records and refusals; the maps; payloads and answers; real children end to end (an Amp reject blocks and the guard sees `Bash`; an allow never grants; an Amp error refuses and stops; synthesize; an Amp crash fails open; P2 15; an OpenCode throw and crash block; P2 9; P2 10; the timeout; adapter dispose); the cap; grant stripping; containment notices; no host side; OpenCode under the installed bun and `prlimit` (Kubuntu) |
| `modelApiForeignHooks.test.ts` (its M91b block) | in a running session: an Amp error leaves the tool unrun and ends the turn; a reject-and-continue goes on; the session's dispose ends a straggler and an in-flight child; no plugin hook runs natively                                                                                                                                                                                                                                  |
| `pluginContainment.test.ts`                     | process groups off Windows; the launcher starts only `.exe`; the retry, the delay, the stay and Retry; on Win11, kill-on-close on answer and on timeout, and the job memory limit                                                                                                                                                                                                                                                       |
| `pluginImport.test.ts`                          | literal and open registration; records parse back; discovery in every folder with XDG; refusals (directory, npm, `outside`, untrusted reads nothing)                                                                                                                                                                                                                                                                                    |
| `pluginHost.test.ts`                            | the RVM91X regressions, and `prlimit`, Windows and macOS for bun                                                                                                                                                                                                                                                                                                                                                                        |
| `deferredBundles.test.ts`                       | `foreignHooks.js` requires `./pluginHooks.js` and carries none of it; the split guard fires for it                                                                                                                                                                                                                                                                                                                                      |
| `foreignHooks.test.ts`, `manifest.test.ts`      | updated: `amp` is a known format now; the palette lists Retry on Windows                                                                                                                                                                                                                                                                                                                                                                |
| `helpers/processes.ts`                          | `isRunning`, `markedPid` and `expectEnded`, shared with `mcpProcess.test.ts`, so the duplication gate finds no new clone                                                                                                                                                                                                                                                                                                                |

These are the final runs, on the committed tree (after the duplication fix
that moved the session cases into `modelApiForeignHooks.test.ts`):

| Run | Rig, slot, snapshot           | Files                                                                                    | Result                                                                                                                                                          |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fa  | Kubuntu `m91wp-fa` `ed74653b` | pluginDispatch, mcpProcess, pluginContainment                                            | 50 passed, 9 skipped (Windows only), exit 0                                                                                                                     |
| fb  | Kubuntu `m91wp-fb` `9291015b` | pluginHost, pluginImport, deferredBundles                                                | 66 passed, exit 0                                                                                                                                               |
| fc  | Kubuntu `m91wp-fc` `51a8694e` | foreignHooks, modelApiForeignHooks (with the M91b session cases), modelApiGoldenRequests | 40 passed, exit 0 (golden requests unchanged with hooks off)                                                                                                    |
| fd  | Kubuntu `m91wp-fd` `650b20c0` | agentImport, agentImportCommands, manifest                                               | 146 passed, exit 0                                                                                                                                              |
| fe  | Kubuntu `m91wp-fe` `584b298d` | modelApiHooks, museConfigCommands, jobSource                                             | 38 passed, exit 0                                                                                                                                               |
| ff  | Kubuntu `m91wp-ff` `b9970e84` | modelApiHost, importHookSources, importConvert                                           | 702 passed, exit 0                                                                                                                                              |
| w4  | Win11 `m91wp-w4` `5b310f42`   | pluginContainment, pluginHost, mcpProcess                                                | 59 passed, 14 skipped (POSIX only), exit 0: the real kill-on-close job on answer and timeout, the job memory limit, and M50's own job tests after the C# change |

Static checks in slot `m91wp-ff`, each exit 0 or clean:

- `tsc` on the host and unit projects;
- ESLint `--max-warnings=0` and Prettier on every changed file, README,
  CHANGELOG and PLAN;
- `knip`;
- `check-l10n`: 14 tables and 0 problems;
- `npm run cycles`;
- `check-host-api`, with the record regenerated;
- the production build, `check-bundle-size`, `check-bundle-split`,
  `check-host-globals` and `third-party-notices`.

The duplication check (`jscpd`, threshold 0) finds 25 clones, the same set
the base `5c746a48` has, so this branch adds none. It still exits 1 on the
base's clones, which come from other lanes.

SAST (semgrep `auto`) flagged the scan's `new RegExp` in `pluginImport.ts`;
the scan is now a plain string search. The one remaining finding is lane P's
`hookFormats/engine.ts:38`, which the integrator is fixing.

One flake was seen once, and never in the final runs. Lane W's
`an imported Cursor shell guard blocks a then_run command it selects` failed
once while real plugin children ran in a parallel worker. Its 25 ms regex
deadline (`HOOK_MATCHER_TIMEOUT_MS`) lapsed, and the guard ran, by design
("unsure runs the guard"). It passed alone twice and in run fc.

Live model calls: 0.

## Red drills

Harness: `m91b-drills.py` (scratchpad), the `m91wp-drills.py` driver from
`m91-x.md`. All 28 ran again on the committed tree. Each drill applies one exact single-match mutation, then runs the
named suite on the rig (`rig-test.sh`, `--maxWorkers=2 --testTimeout=120000`).
It requires a non-zero exit with the named test among the failures, restores
the file byte-exact by SHA-256, and requires an unchanged `git status`.

All 28 drills fired, and every file was restored byte-exact.

| ID  | Guard                                       | File                     | Mutation                                                                                                                                                                                                                         | Named test that failed                                                                | Rig     | Tests                             | Exit | Restored SHA-256 (first 16) |
| --- | ------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------- | --------------------------------- | ---- | --------------------------- |
| B01 | plugin path absolute and normal             | `hooks.ts`               | `return p.isAbsolute(value) && p.normalize(value) === value ? value : undefined` → `return value`                                                                                                                                | refuses a relative path                                                               | kubuntu | 2 failed, 27 passed (29)          | 1    | `8209fd023684726c`          |
| B02 | plugin path on other formats                | `hooks.ts`               | `group['plugin'] !== undefined && !PLUGIN_FORMAT_NAMES.has(format),` → `false,`                                                                                                                                                  | refuses a plugin path on another format                                               | kubuntu | 1 failed, 28 passed (29)          | 1    | `8209fd023684726c`          |
| B03 | host-wide cap                               | `hooks.ts`               | `release = await acquireCommand(signal)` → `release = () => undefined`                                                                                                                                                           | runs plugin hooks under the host-wide cap                                             | kubuntu | 1 failed, 28 passed (29)          | 1    | `8209fd023684726c`          |
| B04 | same judge strips grants                    | `hooks.ts`               | `return signal?.aborted === true ? undefined : judgeAnswer(answer)` → `return signal?.aborted === true ? undefined : answer`                                                                                                     | strips a grant from a plugin answer, as from every imported hook                      | kubuntu | 2 failed, 27 passed (29)          | 1    | `8209fd023684726c`          |
| B05 | a PreToolUse stop also refuses              | `hooks.ts`               | `blockedReason ??= answer.reason ?? answer.stopReason` → `void answer`                                                                                                                                                           | an Amp error refuses the call and ends the turn, whatever the fail-open rule          | kubuntu | 1 failed, 28 passed (29)          | 1    | `8209fd023684726c`          |
| B06 | the turn ends on a PreToolUse stop          | `ModelApiHost.ts`        | `stopReason: post.stopReason ?? hookEffects?.stopReason ?? pre.stopReason,` → `stopReason: post.stopReason ?? hookEffects?.stopReason,`                                                                                          | an Amp error refuses the call, the tool never runs, and the turn ends with its reason | kubuntu | 1 failed, 8 passed (9)            | 1    | `81e3f7e867614ab3`          |
| B07 | session dispose ends the adapter            | `ModelApiHost.ts`        | `adapter?.dispose?.()` → `void adapter`                                                                                                                                                                                          | dispose ends a straggler                                                              | kubuntu | 1 failed, 8 passed (9)            | 1    | `81e3f7e867614ab3`          |
| B08 | adapter dispose ends children               | `foreignHooksEntry.ts`   | `this.plugins?.dispose()` → `(deleted)`                                                                                                                                                                                          | dispose ends a running plugin child                                                   | kubuntu | 2 failed, 27 passed (29)          | 1    | `9bb56cd6cc34cccb`          |
| B09 | OpenCode read takes filePath                | `pluginFormats.ts`       | `opencode: { [MODEL_API_TOOLS.readFile]: { path: 'filePath' } },` → `opencode: {},`                                                                                                                                              | an OpenCode throw blocks; a crash blocks by its fail-closed rule                      | kubuntu | 5 failed, 24 passed (29)          | 1    | `1d39fd9a59a9992d`          |
| B10 | Amp names the shell Bash                    | `pluginFormats.ts`       | `[MODEL_API_TOOLS.bash]: 'Bash',` → `[MODEL_API_TOOLS.bash]: 'bash',`                                                                                                                                                            | an Amp reject-and-continue blocks; the guard sees Bash and its command                | kubuntu | 3 failed, 26 passed (29)          | 1    | `1d39fd9a59a9992d`          |
| B11 | arguments back under our names              | `pluginFormats.ts`       | `return renamed(input, back)` → `return { ...input, ...renamed({}, back) }`                                                                                                                                                      | an OpenCode in-place args rewrite narrows the call, under our argument names (P2 9)   | kubuntu | 3 failed, 26 passed (29)          | 1    | `1d39fd9a59a9992d`          |
| B12 | synthesize never runs the tool              | `pluginFormats.ts`       | `if (event === 'PreToolUse' && replacement !== undefined) {` → `if (event === 'PreToolUse' && replacement === null) {`                                                                                                           | an Amp synthesize never runs the tool; its output is what the model reads             | kubuntu | 2 failed, 27 passed (29)          | 1    | `1d39fd9a59a9992d`          |
| B13 | Amp error is a refusal and a stop           | `pluginChild.ts`         | `'      return { status: "blocked", reason: result.message, stopReason: result.message };',` → `'      return { status: "failed", reason: result.message };',`                                                                   | an Amp error refuses the call and ends the turn, whatever the fail-open rule          | kubuntu | 1 failed, 28 passed (29)          | 1    | `c612cd354106626d`          |
| B14 | agent.end continue is no stop               | `pluginChild.ts`         | `'  return { status: "blocked", reason: result.userMessage };',` → `'  return { status: "blocked", reason: result.userMessage, stopReason: result.userMessage };',`                                                              | Amp tool.result and agent.end get every field their types require (P2 15)             | kubuntu | 1 failed, 28 passed (29)          | 1    | `c612cd354106626d`          |
| B15 | OpenCode args are a copy (P2 9)             | `pluginChild.ts`         | `'  const output = { args: payload.args === undefined ? undefined : structuredClone(payload.args) };',` → `'  const output = { args: payload.args };',`                                                                          | an OpenCode in-place args rewrite narrows the call, under our argument names (P2 9)   | kubuntu | 2 failed, 27 passed (29)          | 1    | `c612cd354106626d`          |
| B16 | every exported plugin function (P2 10)      | `pluginChild.ts`         | `'  for (const value of Object.values(mod \|\| {})) if (typeof value === "function" && !factories.includes(value)) factories.push(value);',` → `'  if (mod && typeof mod.default === "function") factories.push(mod.default);',` | every exported OpenCode plugin function runs, in load order (P2 10)                   | kubuntu | 6 failed, 23 passed (29)          | 1    | `c612cd354106626d`          |
| B17 | tool.result carries toolUseID (P2 15)       | `pluginChild.ts`         | `'  if (hook === "tool.result") return { toolUseID: payload.toolUseID, tool: payload.tool,` → `'  if (hook === "tool.result") return { tool: payload.tool,`                                                                      | Amp tool.result and agent.end get every field their types require (P2 15)             | kubuntu | 1 failed, 28 passed (29)          | 1    | `c612cd354106626d`          |
| B18 | shellCommandFromToolCall offered            | `pluginChild.ts`         | `'    helpers: strictApi("amp.helpers", { shellCommandFromToolCall }),',` → `'    helpers: strictApi("amp.helpers", {}),',`                                                                                                      | an Amp reject-and-continue blocks; the guard sees Bash and its command                | kubuntu | 1 failed, 28 passed (29)          | 1    | `c612cd354106626d`          |
| B19 | bun bounded by prlimit (P2 12)              | `pluginHost.ts`          | `return boundedBun(command, env, platform, deps)` → `return { ok: true, command, args: ['-e'] }`                                                                                                                                 | refuses an allocation past the bound                                                  | kubuntu | 1 failed, 28 passed (29)          | 1    | `f239ba33dda79e20`          |
| B20 | a second failure stays                      | `pluginContainment.ts`   | `if (state.failures >= MAX_FAILURES) {` → `if (state.failures >= MAX_FAILURES * 100) {`                                                                                                                                          | tries a failed preparation once more after the delay, then stays off until Retry      | kubuntu | 1 failed, 3 passed, 3 skipped (7) | 1    | `8bb079f8a92e0e89`          |
| B21 | the retry waits its delay                   | `pluginContainment.ts`   | `if (deps.now() - state.failedAt < PLUGIN_JOB_RETRY_BACKOFF_MS) {` → `if (deps.now() - state.failedAt < 0) {`                                                                                                                    | tries a failed preparation once more after the delay, then stays off until Retry      | kubuntu | 1 failed, 3 passed, 3 skipped (7) | 1    | `8bb079f8a92e0e89`          |
| B22 | Windows job memory limit (P2 12)            | `MuseSparkMcpJob.cs`     | `limits.BasicLimitInformation.LimitFlags \|= JOB_OBJECT_LIMIT_JOB_MEMORY;` → `(deleted)`                                                                                                                                         | bounds the whole job                                                                  | win11   | 1 failed, 6 passed (7)            | 1    | `0a67f93cfdfd1799`          |
| B23 | a name that is not a literal registers all  | `pluginImport.ts`        | `if (literal?.[2] === undefined) {` → `if (literal?.[2] === undefined) {`                                                                                                                                                        | registers every mapped Amp event for a name that is not a literal, or none found      | kubuntu | 1 failed, 7 passed (8)            | 1    | `e0b5b4c59f3cb2e6`          |
| B24 | personal plugin into the project is outside | `pluginImport.ts`        | `if (origin === 'user' && io.isWorkspaceTrusted() && (await io.isInOpenWorkspace(file))) {` → `if (origin === 'user' && io.isWorkspaceTrusted() && file === '') {`                                                               | refuses a personal plugin that leads into the open project                            | kubuntu | 1 failed, 7 passed (8)            | 1    | `e0b5b4c59f3cb2e6`          |
| B25 | a directory plugin is refused               | `pluginImport.ts`        | `findings.push({ kind: 'hook', label: entry.name, file, converted: refusal('unsupported') })` → `(deleted)`                                                                                                                      | finds plugin files in the documented folders, names only file and hook                | kubuntu | 1 failed, 7 passed (8)            | 1    | `e0b5b4c59f3cb2e6`          |
| B26 | npm plugins are listed, refused             | `agentImport.ts`         | `await collectOpenCodeNpm(scan, 'user', p.join(input.homeDir, ...names.userConfigSegments))` → `(deleted)`                                                                                                                       | finds plugin files in the documented folders, names only file and hook                | kubuntu | 1 failed, 7 passed (8)            | 1    | `31391a7d72595e15`          |
| B27 | containment notice reaches the user         | `foreignHooksEntry.ts`   | `systemMessage: tree,` → `(deleted)`                                                                                                                                                                                             | says why in the user                                                                  | kubuntu | 1 failed, 28 passed (29)          | 1    | `9bb56cd6cc34cccb`          |
| B28 | the adapters never carry the plugin host    | `check-bundle-split.mjs` | ``dist/foreignHooks.js carries ${file}, which loads only on the first plugin hook`,` → ``dist/foreignHooks.js holds ${file}`,`                                                                                                   | fires the foreignHooks split guard                                                    | kubuntu | 1 failed, 14 passed (15)          | 1    | `a0781bec91738614`          |

## Open points for the lead

1. **Five mapped OpenCode hooks wait for lane E**, which lands the extension
   events: `command.execute.before` (UserPromptExpansion), and the bus's
   `todo.updated`, `permission.replied`, `file.watcher.updated` and
   `message.updated`. `parseForeignHooks` dispatches imported groups on
   Muse Code's events only, so the import lists these with `unmapped`
   rather than writing records that never fire.
2. **OpenCode's other argument names.** Only `read.filePath` and
   `bash.command` are in the saved sources. A guard that reads
   `output.args.filePath` on `edit` or `write` sees `undefined`. At
   `tool.execute.before` the resulting throw blocks, which is never weaker.
   Capturing OpenCode's real `edit` and `write` arguments would let them
   pass.
3. **Amp `Read` and `read`.** The CLI's tool list says `Read` (AS:51), while
   one recorded call is named `read` (AS:63). The map follows the list.
4. **Amp `agent.end` `message`** is empty: the Stop payload carries the
   reply, not the prompt.
5. **macOS refuses OpenCode plugins.** bun's memory cannot be bounded there
   (no enforced data limit), so P2 12 refuses rather than run it unbounded.
6. **The ACP agent** gives no plugin host side, so plugin hooks are refused
   there ("cannot run here"), and `pluginHooks.js` is not in its package.
7. **`extension.js` grew 1.5 KiB.** The containment source with the retry,
   the Retry command, its notices, and the two picker labels take it to
   595.3 of 600 KiB.
8. **For the integrator's budget change:** `foreignHooks.js` is 69.5 KiB
   with the plugin glue. With the record parser's move (about 4 KiB) it
   should stay under 75.
9. **bun 1.3.14 is installed on Kubuntu**, in `~/.bun`, from bun.sh's
   installer. It is used only by the tests above, which skip where it is
   absent.
