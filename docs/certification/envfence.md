# ENVFENCE — Credential environment fence (D89.5)

2026-10-05, Kubuntu rig, `fix/shell-credential-fence`, based on `2d4d72bd`
(0.14.0). No live model requests, paid calls, credential-file reads, pushes or
merges. All credential probes use fake values.

## Process paths

| Path                                                                   | Fence and exception                                                                                                                                                                                                     | Evidence                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Model API shell, including terminal overrides                          | `shellEnvironment` uses the shared `isCredentialVariable` matcher after overrides. Only an explicitly interactive entry may honor name-only `shell.passEnvironmentVariables`.                                           | `credentialEnvironment`, `toolIoCommandAdmission`, `shellEnvironmentOrigins`                        |
| Background shell                                                       | Same native entry; unattended origins remain fenced. Moving an admitted interactive command to the background preserves its starting environment and does not spawn a new process.                                      | Existing shell/process lifecycle tests, origin marker and native-entry probes                       |
| Verification and `then_run`                                            | `ModelApiSession.runCommand` never supplies the interactive marker.                                                                                                                                                     | `shellEnvironmentOrigins` checks both native calls                                                  |
| Schedules                                                              | A confirmed scheduled turn's shell supplies `false`, even after its ordinary command approval.                                                                                                                          | `shellEnvironmentOrigins`                                                                           |
| Child/team worker and side-session tools                               | Child/side-session shell entries cannot pass the interactive marker; no worker can use the setting.                                                                                                                     | Actual idle-child follow-up in `shellEnvironmentOrigins`; source admission check                    |
| Checkpoint shell wrapper                                               | Forwards the owner's marker through the awaited activity mark to the real adapter.                                                                                                                                      | `checkpointHost` marker test, native shell probe                                                    |
| Script hooks                                                           | `hookEnvironment` shares the matcher and rejects credential names even in extra-name lists. Never reads shell pass-through settings.                                                                                    | Environment snapshot and real `runHook` probe with the fake key named                               |
| Amp/OpenCode plugin version probes and children                        | Shared `withoutCredentials` replaces the duplicate matcher.                                                                                                                                                             | `pluginHost` records both probe and child environments                                              |
| MCP stdio servers                                                      | Existing narrow host projection excludes credentials. Explicitly configured entry `env` remains allowed; the new shell setting does not affect MCP. Windows launcher receives that same projected/explicit environment. | `credentialEnvironment`, `mcpProcess`, existing launcher tests                                      |
| Git text, probes, checkouts, worktrees and binary checkpoint processes | `quietGitEnvironment` and `createGitProcess` strip credentials, with no pass-through exception.                                                                                                                         | Both native-entry snapshots, `git`, `checkpointHost`, ACP runtime tests                             |
| PowerShell/process-tree cleanup helpers                                | `windowsPowerShell` and `runProgram` strip credentials.                                                                                                                                                                 | Snapshot and real local Node subprocess probe, `processTree`                                        |
| Windows job compilation and self-tests                                 | Compiler environment stripped; PowerShell self-test uses the stripped environment, MCP self-test already uses SystemRoot only.                                                                                          | Both compiler seams in `jobBuild`, native helper tests                                              |
| Browser                                                                | Existing private projection now rejects credential-shaped locale variables too; spawn and Windows cleanup strip credentials.                                                                                            | Projection, native spawn and Windows cleanup snapshots; `browserLaunch`, `browserRun`               |
| Voice/dictation helper and Linux recorder                              | Strip credentials at native entry, including helper overrides.                                                                                                                                                          | Both spawn snapshots, `voiceBundle`, `museVoice`                                                    |
| Search and HTML workers                                                | Worker options explicitly supply credential-free environments.                                                                                                                                                          | Both worker-entry snapshots; actual `searchWorker`, `pageConverter` suites                          |
| Image tools                                                            | In-process HTTP and file IO; no native image-generation child receives an environment. Their shared file-search worker is fenced above.                                                                                 | `imageGenerationIo` fake-only suite, source spawn inventory                                         |
| Muse Code `serve`, account, login, skills and CLI checks/terminals     | D1 credential inheritance unchanged. The pasted Model API key still never enters a CLI environment.                                                                                                                     | `buildChildEnvironment` preservation snapshot and existing `acpRuntime` Muse Code preservation test |
| ACP/headless in every supported editor                                 | Shared matcher removes credential variables at startup and at tool entry. No new pass-through CLI flag; shell/worker/plugin logic remains portable.                                                                     | `acpRuntime`, shared-core imports, host API gate                                                    |

## Setting and documentation

`museSpark.shell.passEnvironmentVariables` is machine-scoped, defaults to `[]`,
and validates an array of environment-variable names, never values. Windows
names match case-insensitively; POSIX pass-through names match exactly. The
description warns that command output can expose a passed credential to the
conversation/model provider and that unattended origins ignore the exception.
All 14 manifest translations are supplied. README settings/security and
CHANGELOG Security move with the change; PLAN contains D89.5 and the milestone.

HELPREF merge item: this base has no `src/shared/featureCatalog.ts` or reference
generator. Add this exact setting, its machine scope, default, name-only rule,
interactive restriction, unattended exclusions and exposure warning to that
catalogue when HELPREF joins the release.

## Green tests

All runs used `npx vitest run <files> --maxWorkers=3 --testTimeout=120000`, at
most three files per run, directly in this worktree. No test was newly skipped
or filtered by name. Nineteen files: **401 passed, 12 existing platform skips**.

| Files (all under `test/unit/`, suffix `.test.ts`)             | Passed | Existing skips |
| ------------------------------------------------------------- | -----: | -------------: |
| credentialEnvironment, toolIoCommandAdmission, checkpointHost |     79 |              0 |
| shellEnvironmentOrigins, jobBuild, pluginHost                 |     49 |              1 |
| toolIo, acpRuntime, git                                       |    101 |              2 |
| mcpProcess, browserLaunch, browserRun                         |     71 |              6 |
| pageConverter, searchWorker, processTree                      |     28 |              3 |
| voiceBundle, museVoice, imageGenerationIo                     |     38 |              0 |
| manifest                                                      |     35 |              0 |

The real native probe calls `env` (`Get-ChildItem Env:` on Windows) through
`createToolIo` with a fake `OPENAI_API_KEY` in the parent. It proves absence by
default, absence with names on an unattended entry, and presence only with
both interactive admission and the matching name. A hook given the same
extra name still cannot see the fake key. The probe assertions compare fake
presence, without printing the parent's environment.

## Gate-fire drills

Each guard was deliberately removed or bypassed, the named assertion failed
with exit 1, then the source was restored byte-exact and SHA-256 verified.
Twenty-one independent mutations; all fired. The native shell-fence mutation
specifically made the probe see the fake parent key. After lint's readability
change, the three `toolIo` mutations were repeated against the final source.

| Mutation                  | Failed assertions | Result                     |
| ------------------------- | ----------------: | -------------------------- |
| `shared-matcher`          |                26 | exit 1; byte-exact restore |
| `scheduled-child-origin`  |                 2 | exit 1; byte-exact restore |
| `then-run-verify-origin`  |                 1 | exit 1; byte-exact restore |
| `checkpoint-forwarding`   |                 1 | exit 1; byte-exact restore |
| `git-text`                |                 1 | exit 1; byte-exact restore |
| `git-binary`              |                 1 | exit 1; byte-exact restore |
| `process-cleanup`         |                 1 | exit 1; byte-exact restore |
| `powershell-helper`       |                 1 | exit 1; byte-exact restore |
| `job-compiler`            |                 2 | exit 1; byte-exact restore |
| `plugin-probe-child`      |                 1 | exit 1; byte-exact restore |
| `browser-locale`          |                 1 | exit 1; byte-exact restore |
| `browser-spawn`           |                 1 | exit 1; byte-exact restore |
| `browser-cleanup`         |                 1 | exit 1; byte-exact restore |
| `voice-helper`            |                 1 | exit 1; byte-exact restore |
| `voice-recorder`          |                 1 | exit 1; byte-exact restore |
| `html-worker`             |                 1 | exit 1; byte-exact restore |
| `shell-fence`             |                 1 | exit 1; byte-exact restore |
| `interactive-admission`   |                 1 | exit 1; byte-exact restore |
| `search-worker`           |                 1 | exit 1; byte-exact restore |
| `setting-name-validation` |                 1 | exit 1; byte-exact restore |
| `setting-machine-scope`   |                 1 | exit 1; byte-exact restore |

Restoration digests (verified again against final source):

| File                                         | SHA-256 before and after restore                                   |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `src/core/credentialEnvironment.ts`          | `0563f30e16c7bdeac747eec47dbf869ecb196265fe96024cb3b6f1e91b6c94a4` |
| `src/core/backends/modelapi/ModelApiHost.ts` | `3beb3b77c90fc25d8f47eaa25e651b2c0cfc48ba578c7343a7cd8d8f01cf06a1` |
| `src/host/checkpoints/checkpointHost.ts`     | `8f2dc0a431d0fed177d75f7c4676f254a50085a10e115c0ef407a7be6ebf82c4` |
| `src/host/git.ts`                            | `330f861433cc3ade988620bd347c8828be5d9621f072c284d689bea2f087bb4d` |
| `src/host/processTree.ts`                    | `50d7480f17633266a5bac20b95cf22b9057b3d41e06ac8adf2502e598b1be7b1` |
| `src/host/backend/jobBuild.ts`               | `891dc6111576a6e07f67ae1e756e48ab08bed4b33fd32bf556d0734faebb0dba` |
| `src/core/backends/modelapi/pluginHost.ts`   | `25475f197b88cd8e27230f552f382530a0f2e0210679f96e3ccd9f8d4565adad` |
| `src/core/browser/browserLaunch.ts`          | `10fc0b22d030741a1eb0340d575af07bd2a5da05e179d28ae4af26e14b0cc884` |
| `src/host/browser/browserProcess.ts`         | `02190d6b4d8499ed19e1a85a8859bd593cc038cde2d486e4094062a8a996ff9a` |
| `src/host/voice/voiceProcesses.ts`           | `dcf215b0ea3d30f2ec35cbcfac7250b67cee7c6af714898afaaca091763830cb` |
| `src/host/web/pageConverter.ts`              | `e8663ea8ee21df292eaa49885ea5dd4119664163812a65628d72e26a3aa79678` |
| `src/host/backend/toolIo.ts`                 | `ad037cedb54c5292633ca262e025d3b64fe09d18a21d564d07f50b787a9cdfe8` |
| `src/host/settings.ts`                       | `02185a1c4a955db22d070b5779db84471c0c06521f849f8a3440a375a83fd7b4` |
| `package.json`                               | `6363ab57546954cd94bf6671354bd1151a973e5762f3dea37a572e0f7867bd1b` |

## Gates

| Command                                                                                   | Result |
| ----------------------------------------------------------------------------------------- | ------ |
| `npm run typecheck`                                                                       | exit 0 |
| `npx eslint --max-warnings=0 src/core/backends/modelapi/ModelApiHost.ts` on changed files | exit 0 |
| `npx prettier --check CHANGELOG.md` on changed files                                      | exit 0 |
| `npm run check:l10n`                                                                      | exit 0 |
| `npm run check:host-api`                                                                  | exit 0 |
| `npm run deadcode`                                                                        | exit 0 |
| `npx jscpd`                                                                               | exit 0 |
| `npm run build`                                                                           | exit 0 |

Production sizes: extension **437.4 / 600 KiB**, Model API **446.8 / 475 KiB**,
checkpoint store **76.9 / 225 KiB**, ACP **817.2 / 850 KiB**. All other bundle
budgets, split checks, host globals and notices passed. Localization: 14 tables,
165 manifest strings, 591 source files, 0 problems. Host API: 332 APIs, 31
VS Code-importing files, 25 Node built-ins, 61 theme variables, 0 problems.
Knip and jscpd passed; jscpd found 0 clones.

Aggregate `npm run quality`, coverage and cross-platform native execution
remain the lead's rig gates under the lane common rules, which prohibit the
aggregate run in this lane. No threshold, ignore, timeout policy, rule level or
dependency pin changed. No unsafe cast or suppression was added.

## FIXENVFENCE — RVENVFENCE review repair

2026-10-05, directly on the Kubuntu rig, `fix/shell-credential-fence-2`,
reviewed base `7a20ac0fe479985d9e1e0041b5d18c69ca10658d`. Both confirmed P1
findings are fixed. There were no P2/P3 findings and none is deferred.

| Finding                                                                                          | Repair                                                                                                                                                                                                                                                                                                         | Regression                                                                                                                                                                                                                                                                                                                                                                     | Red drill                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: common credential names escaped the shared matcher                                           | Fence every standard suffix family, including passphrases, access/private/secret keys, credentials, auth and PATs; retain existing cloud exclusions; recognize `SYSTEM_ACCESSTOKEN`, Docker auth configuration, Azure storage SAS and Terraform's `TF_TOKEN_*`. Harmless look-alikes have an exact allow-list. | `credentialEnvironment`: 48 credential names, both cases, removal from editor/tool environments and ACP startup; 10 harmless names preserved; `KEY_PATH_TOKEN` and `TOKENIZERS_PARALLELISM_API_KEY` still fenced. `toolIoCommandAdmission`: real unattended shell cannot see any of the three reviewed names even with all three named in pass-through; harmless names remain. | Revert matcher to the reviewed base: **25 failures**, including all three reviewed names and the real-shell probe. Broaden harmless-name matching to prefixes: **6 failures**, including both credential look-alikes. Both runs exit 1. |
| P1: a backgrounded scheduled shell acquired interactive pass-through after directory preparation | Capture the command's owning turn and interactive status at `runCall`, before hooks, approval or directory waits; pass that immutable status to the shell. Native entry still checks captured owner/lifecycle and policy admission after adapter waits. Missing/mismatched owners cannot grant pass-through.   | `shellEnvironmentOrigins`: hold actual sidecar `mkdir`, move the row to the background, await real turn completion, then release; repeat while a later interactive turn is held active. Both real shells withhold the fake named credential. A delayed interactive command retains its permitted environment.                                                                  | Restore the live `this.active?.confirmedRequest` lookup after the wait: **2 failures**, both scheduled cases, at the real-shell credential-absence assertion. Exit 1.                                                                   |

Each regression was observed failing before its fix. The drills were repeated
against the final assertions and shared schedule fixture. Each mutation used
an in-memory byte backup, restored in `finally`, with byte equality and SHA-256
checked. The final green regression run passed **83 tests** after restoration.

| File                                         | SHA-256 before and after every restoration                         |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `src/core/credentialEnvironment.ts`          | `05a5b24ece8c36f35e7eef9aa873c774b0200bd3615d61b18932e2e7654bf0d3` |
| `src/core/backends/modelapi/ModelApiHost.ts` | `b50729660c9c0db4fcad315e49a5745ab19de0c7657d5759960dc26545dd40b1` |

All tests used `npx vitest run <files> --maxWorkers=3 --testTimeout=120000`,
at most three complete files per invocation; no test-name filtering, new skips,
live or paid model requests, credential-file reads or golden regeneration.

| Files (under `test/unit/`, suffix `.test.ts`)                          |  Passed | Skips |
| ---------------------------------------------------------------------- | ------: | ----: |
| credentialEnvironment, shellEnvironmentOrigins, toolIoCommandAdmission |      83 |     0 |
| modelApiHost, modelApiShellDirectory, modelApiGoldenRequests           |     664 |     0 |
| acpRuntime, pluginHost, checkpointHost                                 |     125 |     0 |
| **Total: 9 files**                                                     | **872** | **0** |

The same shared matcher serves VS Code and ACP/headless in every editor.
Muse Code's documented credential route and the interactive `!` command
remain covered by positive tests. Name-only pass-through, POSIX exact matching,
Windows case-insensitive matching and unattended exclusions stay in place.
No dependency, wire shape, paid setting, approval guard or gate was widened.
README, CHANGELOG and PLAN move with the repair. The inherited
**ENVFENCE-HELPREF** catalogue follow-up is named in PLAN §9: this base has no
catalogue or generator; the manifest, translations and README already describe
the setting. Add it when HELPREF joins the release.

Production build passes all size, split, host-global and notice gates:
extension **437.6 / 600 KiB**, Model API **446.9 / 475 KiB**, checkpoint store
**76.9 / 225 KiB**, ACP **817.5 / 850 KiB**. Localization reports 14 tables,
165 manifest strings, 591 source files, 0 problems; host API reports 332 APIs,
31 VS Code-importing files, 25 Node built-ins, 61 theme variables, 0 problems.
Deadcode and duplication pass without changing their configuration.

Final `npm run typecheck` passes all five projects. Changed-file ESLint and
Prettier checks, `git diff --check`, localization, host API, deadcode,
duplication and production build all exit 0. The initial lint and typecheck
briefly overlapped, contrary to the lane's shared-resource rule; remaining
heavy checks were serialized, including the final typecheck and lint runs.

Aggregate quality, coverage and native Windows/macOS execution remain with
the lead under the rig/common rules. No merge, push, remote/config change or
external write was performed. The existing worktree-local Husky pre-commit
hook was present before commit and remains enabled.
