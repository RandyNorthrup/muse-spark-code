# Certification — Muse Code's unasked file writes (musecode-write-asks)

## 2026-10-04

### The finding

The protect-agent-folders lane (docs/certification/protect-agent-folders.md on
its branch, "What remains Muse Code's") ran Muse Code 1.4.2 with the
extension's arguments for a workspace under the user's profile
(`muse serve --disable-sandbox --trust-workspace`), in Manual
(`promptUnmatched`). Muse Code wrote `.claude/settings.json` inside the
workspace and a file outside it, and raised no approval for either.

### Why the extension turns the sandbox off

- `src/core/backends/musecode/sandbox.ts`: `resolveShellSandbox` returns
  `{ isSandboxed: false, reason: 'profileWorkspace' }` for
  `museSpark.shellSandbox: auto` when `isProfileWorkspace` holds, and
  `serveArguments` then passes `--disable-sandbox`
  (`MUSE_DISABLE_SANDBOX_ARG`). `isProfileWorkspace` is true only for
  `platform === 'win32'` and a workspace inside `%USERPROFILE%`
  (`isInsideDirectory`, case-insensitive). So it is Windows-only.
- The reason is PLAN.md D12, "Known CLI limitation" and "Resolution —
  `museSpark.shellSandbox`" (2026-09-22): Muse Code's Windows sandbox could
  not run commands in a workspace under `C:\Users\<user>`; 1.3.0 and 1.4.0
  started them in `C:\Windows\System32\WindowsPowerShell\v1.0` after about
  34 s (meta-models/muse-code-sdk#26). The sandbox runs commands as
  separate local sandbox users, which then lack access to the profile tree;
  it is not an AppContainer setting the extension can change. The owner
  ruled out changing folder permissions ("change how the sandbox is used,
  never the user's folder permissions").
- A narrower exception is not available. `muse serve`'s posture is fixed for
  the host's lifetime and `--disable-sandbox` is all or nothing (shell OS
  sandbox, file-tool confinement and network together). Muse Code has no
  documented per-path grant that would let its sandbox enter one profile
  folder. Its own 1.4.x read worker ("Root:Read … through an optional
  background worker") is the only thing that grants the sandbox group
  access, and the retest below shows it is not enough on a fresh setup.

### What Muse Code 1.4.2 offers to force an approval

Local reads only (`--help`, `muse schema generate-json-schema`, the binary's
strings, `muse config status`) and Meta's docs, read 2026-10-04:

| Mechanism                                      | What it allows                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MSP `session/start`, `session/setApprovalMode` | Select one of `allowAll`, `promptUnmatched`, `onRequest`, `denyUnmatched` (closed enum, "select, never create"). `session/start.config` admits only `mcpServers`. 1.4.2 has no `session/setPermissionProfile` or `permissionProfile/list`; the `next` SDK site lists both as experimental and says "there is no inline-rule member and none may be added under this contract".                                                       |
| `muse serve` flags                             | Posture only: `--disable-sandbox`, `--sandbox-network`, `--disable-write`, `--disable-shell`, `--trust-workspace`. No `--permission-profile` (the TUI and `exec` have one), no `--approval-judge`.                                                                                                                                                                                                                                   |
| Settings (`~/.config/muse/settings.json`)      | Documented: `permissions.default_profile` (built-in `:ask-me`, `:auto-review`, `:read-only`, `:unrestricted`). Custom profiles with `filesystem` rules exist in the binary but are undocumented, and its startup text says that with `--disable-sandbox` "permission-profile filesystem and local-command network restrictions remain recorded but are not enforced".                                                                |
| Managed policy                                 | `execution.permission_profiles`, `execution.tool_rules`, `execution.approval_modes`: administrator planes (system file, Windows machine policy); `muse config status` showed all absent.                                                                                                                                                                                                                                             |
| Hooks                                          | A PreToolUse hook can block a call. Sources: the user's settings `hooks` block, `managed_hooks_path`, or the repository's `.muse/hooks.json` (trusted workspaces only).                                                                                                                                                                                                                                                              |
| What the extension writes at launch            | Only the environment (`museCodeBackendManager.ts` `childEnvironment`: the extension host's environment, the PowerShell module path, VS Code's proxy, `museSpark.environmentVariables`, loopback `NO_PROXY`) and the serve flags above. It never writes Muse Code's settings (PLAN D17; `museSettings.ts` reads them only). `src/host/backend/environment.ts` is the Model API prompt's git facts and has nothing to do with the CLI. |

So no mechanism a client can use makes Muse Code ask before these writes.
Writing the user's settings file, a managed policy or the repository's
hooks file would change machine-wide or repository state behind the user's
back, and D17 rules out the first.

### Is it documented?

Yes, all of it (dev.meta.ai/docs/muse-code/permissions):

- "`--disable-sandbox`: keep approval, but skip the sandbox. This flag also
  removes workspace confinement from the file tools, so write_file and
  edit_file can write anywhere on the filesystem."
- "`untrusted` … escalates shell execution only. File reads and in-workspace
  write_file and edit_file writes still pass in any mode."
- "Inside the writable workspace, the .git, .muse, and .agents directories
  stay read-only."

Manual's "does not ask for workspace edits" (D69) is documented. Writing
outside the workspace without asking is documented as the effect of
`--disable-sandbox`; nothing says approval covers those writes, and it does
not. The earlier capture's outside target sat under `%TEMP%`, which Muse
Code's Ask me profile treats as writable temporary space when the sandbox
is on; the probes below used a second target outside `%TEMP%` as well.

### Probes with forced tool calls (0 model calls)

`scratchpad/mcwrite/probe-policy.mjs` with `fake-provider.mjs`: a real
`muse-bin-1.4.2-R4684.1.exe serve` over the SDK's `spawnMspConnection`,
with an isolated `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` and
(except run t18) `XDG_DATA_HOME` under the run folder. The isolated
settings point `endpoint_transport.base_url` at a loopback stand-in
(`auth: "bearer"`, `META_API_KEY` a dummy string, every other key and token
variable removed), which answers `POST /responses` with scripted function
calls in the Responses SSE order of `test/unit/helpers/fakeModelApi.ts`.
Every provider request reached the stand-in (39 to 47 `POST`s per run in
its log) and none reached Meta; no sign-in existed in the isolated home.
The probe rejects every approval except one shell call to
`(Get-Location).Path`, so a file exists afterwards only if Muse Code wrote
it unasked. Steps: `write_file` `notes.txt`, `.claude/settings.json`,
`.git/probe.txt`, a file outside under `%TEMP%`, a file outside under
`%LOCALAPPDATA%`, then `powershell (Get-Location).Path`.

| Run | `serve` flags, mode                                                     | `notes.txt` | `.claude/settings.json` | `.git/probe.txt`                      | outside, `%TEMP%`                        | outside, `%LOCALAPPDATA%` |
| --- | ----------------------------------------------------------------------- | ----------- | ----------------------- | ------------------------------------- | ---------------------------------------- | ------------------------- |
| t12 | `--disable-sandbox`, `promptUnmatched`                                  | written     | written                 | asked (`protectedWrite`), not written | written                                  | written                   |
| t13 | `--disable-sandbox`, `denyUnmatched`                                    | written     | written                 | asked, `resolvedBy: policy`           | written                                  | written                   |
| t14 | `--disable-sandbox`, `onRequest`                                        | written     | written                 | asked, not written                    | written                                  | written                   |
| t15 | sandbox on, `promptUnmatched`                                           | written     | written                 | asked, not written                    | `absolute path is outside the workspace` | same                      |
| t16 | sandbox on, `denyUnmatched`                                             | written     | written                 | asked, `resolvedBy: policy`           | refused, same text                       | same                      |
| t17 | sandbox on, workspace `C:\Users\<user>\mcwrite-probe-ws`                | written     | written                 | asked, not written                    | refused                                  | refused                   |
| t18 | as t17, workspace under `C:\Users\<user>\Coding`, the owner's data root | written     | written                 | asked, not written                    | refused                                  | refused                   |

The shell call was asked in every mode; under `denyUnmatched` the approval
was raised and then resolved `denied`/`policy`. Runs t1–t11 were the rig's
bring-up (no tool ran; also 0 model calls).

### #26 on 1.4.2

- **The owner's machine:** in t15, t17 and t18 the sandboxed shell printed
  the workspace (`Microsoft.PowerShell.Core\FileSystem::\\?\C:\Users\…`)
  in about 5 s (`security_mode.resolve sandbox="normal"`, backend
  `windows_elevated`). Its sandbox log shows complete read refreshes
  (`refresh-finished`).
- **The Windows 11 rig, freshly set up** (the 1.4.2 binary copied in,
  `muse sandbox windows setup` run elevated, `status=ready`; the probe
  started in the interactive session through a scheduled task):
  - A workspace outside the profile (`C:\mcwrite-probe-ws`) ran the shell in
    place (v7).
  - The first call in a profile workspace failed after 120 s: "…: ACL
    publication lock Global\TbhWindowsSandboxAclPublication: timed out: owner
    S-1-5-21-…: wait timed out after 120000 ms" (v6; captured in
    `failureReason` and `visibleOutput`, both carrying "sandbox enforcement
    unavailable"). Muse Code's read worker
    (`__tbh_internal_windows_sandbox_read_worker`) held the lock for about 70
    minutes while it granted read access to the profile's top-level entries,
    and ended `refresh-partial`.
  - After it ended, the call in a profile workspace never finished (v8, v9:
    8 minutes each; the last trace event `sandbox.prepare …
outcome="prepared"`).
  - Runs over SSH (session 0, no interactive desktop) hung or failed with
    "The pipe has been ended", in and out of the profile, and are not
    counted.

So #26 is not reliably fixed, and the version-gated posture built first
(keep the sandbox for a profile workspace on 1.4.2 or later) was dropped.

### The change

- **The sandbox-off warning** (`conversationController.ts`
  `noteShellSandbox`): whenever the host runs without the sandbox, for
  either reason, the first Muse Code conversation of the window shows
  `sandboxOffProfileWarning` (`auto` in a profile workspace) or
  `sandboxOffSettingWarning` (the `off` setting) at warning level. The text:
  the file tools can write anywhere the account can, outside the workspace
  too, without asking in any mode, Plan included; commands run as the user
  with the user's network; approval still covers commands and writes to
  `.git`, `.muse` and `.agents`; a workspace outside the profile keeps the
  sandbox. Once per window: `shouldWarnSandboxOff`, a closure in
  `extension.ts`. It replaces the info notice that said "Approval prompts
  still apply".
- **The posture** gains `isUnsupportedWorkspace` (`sandbox.ts`); the
  wrong-folder warning for `muse` forced in a profile workspace now reads it
  instead of recomputing, and says commands "can start in the PowerShell
  folder instead of the project, or never finish". The controller's unused
  `userProfileDir` dependency is gone.
- **The preparing notice** (`noteSandboxFailure`): a shell failure whose
  text holds `SANDBOX_PREPARING_MARKER` ("ACL publication lock") shows
  `sandboxPreparingNotice` (wait and try again) and does not offer the
  setup, which has already run.
- **Diagnostics** (`report.ts`): `muse code file writes: workspace only
(writes outside it fail); inside it, only .git, .muse and .agents ask`, or
  `anywhere this account can write, without asking, in every mode (shell
sandbox off); …`. The spawn log adds a warning line when the sandbox is
  off.
- **The Modes menu**: Plan on Muse Code reads "Muse plans first; Muse Code
  refuses commands, but its file tools can still edit files without
  asking"; the Model API keeps "present a plan before editing"
  (`modelApiPermissionModeDetails.plan`).
- **The settings text** for `auto` and `off` says the file tools can write
  outside the workspace without asking.
- All new and changed strings are in the 14 tables; `check:l10n` reports 0
  problems.
- Docs: README (permission modes table, the sandbox paragraph, "Plan on
  Muse Code", protected writes, the settings row, two troubleshooting
  entries), SECURITY.md, docs/PRIVACY.md, CHANGELOG, PLAN.md (D7 and D12
  corrections, §9).

### Tests

| Test                                                                               | File                             | What it pins                                                                 |
| ---------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| warns that the file tools can write anywhere when auto turned the sandbox off      | `conversationController.test.ts` | The exact warning, level warning, for `profileWorkspace`                     |
| warns the same way when the user chose off                                         | same                             | `sandboxOffSettingWarning` for `setting`                                     |
| warns once per window: the window claims the warning for its first conversation    | same                             | Two controllers sharing the claim: one warning in all                        |
| warns once per session when the sandbox is forced on where it may not run commands | same                             | The wrong-folder warning from `isUnsupportedWorkspace`                       |
| stays quiet where the sandbox runs                                                 | same                             | No notice outside the profile, off Windows, or forced on outside the profile |
| says the sandbox is still preparing, and offers no setup, when the lock timed out  | same                             | The captured `failureReason`; no `onSandboxUnavailable`                      |
| resolveShellSandbox (two tests)                                                    | `sandbox.test.ts`                | `isUnsupportedWorkspace` for each mode and place                             |
| says that without the sandbox the file tools can write anywhere without asking     | `supportReport.test.ts`          | The Diagnostics line for both postures                                       |
| says on Muse Code that Plan does not stop the file tools                           | `permissionModes.test.ts`        | The Muse Code Plan line, distinct from the Model API's                       |
| the Modes menu                                                                     | `App.test.tsx`                   | The menu shows the new Plan line                                             |

Run on the Kubuntu rig (`scratchpad/rig-gate/rig-test.sh kubuntu`, slot
`mcwrite-a`): `sandbox`, `museCodeBackendManager`, `launch`,
`supportReport`, `permissionModes`, `conversationController`, `App`,
`sandboxSetup`, `acpRuntime`, `--maxWorkers=2`: **9 files, 730 passed**.
On the rig through `scratchpad/m71rv/rig-run.sh`: `check:l10n` 0 problems,
`deadcode`, `cycles`, `build` (bundle budgets, split, host globals,
notices) and `duplication` (0 clones) passed. On this host: eslint and
prettier on the changed files, `tsc -p tsconfig.json` and
`tsc -p test/unit/tsconfig.json`, all clean. The full `npm run quality` was
not run; CI runs it.

### Test-fire proof (red drills)

`scratchpad/mcwrite/drill.cjs` broke one thing at a time, the run went to
the rig, and the file was restored from a backup whose SHA-256 it matched
(`sha256sum -c` after the batch: all OK).

| Drill | Broken                                            | Result (exit 1 each)                                                                                 |
| ----- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| D     | The old rule: only `profileWorkspace` warns       | "warns the same way when the user chose off" and "warns once per window" failed (2 failed, 9 passed) |
| E     | The window's claim ignored (`if (true)`)          | "warns once per window" failed (1 failed)                                                            |
| F     | The preparing branch never matches                | "says the sandbox is still preparing" failed (1 failed)                                              |
| G     | The Diagnostics line always says "workspace only" | "says that without the sandbox …" failed (1 failed, 6 passed)                                        |
| H     | The old Plan line back for Muse Code              | `permissionModes` and the `App` Modes menu test failed (2 failed)                                    |
| I     | `isUnsupportedWorkspace` always false             | both `resolveShellSandbox` tests failed (2 failed, 12 passed)                                        |
| J     | The wrong-folder warning never shown              | "warns once per session when the sandbox is forced on …" failed (1 failed)                           |

Drills A–C covered the dropped version gate (the gate in
`resolveShellSandbox`, the manager passing the version, the version read
from `muse-bin-<version>.exe`); each failed its tests (4, 2 and 2 failed)
and the code was removed with the gate.

### Live turns (AGENTS rule 13)

`scratchpad/mcwrite/live-turn.mjs`: the owner's signed-in Muse Code 1.4.2,
`muse-spark-1.3-contributor`, Manual (`promptUnmatched`), each in a fresh
empty folder under the scratchpad (under the profile). The prompt asked for
`notes.txt` in the workspace, `%LOCALAPPDATA%\mcwrite-live-outside…\notes.txt`
outside it, and `(Get-Location).Path` with the shell (allowed once). Stated
beforehand: about 8 to 16 model attempts each, at most about 25.

| Turn | `serve` flags                                                 | Outside write                                                                               | Inside write | Shell                       | Model attempts (trace)                    |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------ | --------------------------- | ----------------------------------------- |
| A    | `--trust-workspace` (sandbox on)                              | `tool failed: absolute path is outside the workspace`                                       | written      | asked, ran in the workspace | 6: 2 main-loop steps, 4 reminder children |
| B    | `--disable-sandbox --trust-workspace` (`auto`'s posture here) | `wrote 7 bytes to C:\Users\…\AppData\Local\mcwrite-live-outside-off\notes.txt`, no approval | written      | asked, ran in the workspace | 6: 2 main-loop steps, 4 reminder children |

**Spend: 12 model attempts in all.** The outside files were deleted
afterwards. Turn B is the posture the warning describes; turn A is the one
every workspace outside the profile keeps.

### What remains Muse Code's

- Asking before (or refusing) file-tool writes outside the workspace roots
  when the shell sandbox is off.
- A read-only Plan: `denyUnmatched` refusing file writes, or the Read-only
  profile selectable over MSP (#43).
- Protecting other agents' configuration folders, or letting a client name
  protected paths.
- #26 on a fresh setup.

Upstream draft (not filed; the lead files it):
`scratchpad/upstream/07-musecode-unasked-writes.txt`, with the body in
`07-musecode-unasked-writes.txt.body` and a comment for #26 in its notes.
The lead filed it the same day as
[meta-models/muse-code-sdk#86](https://github.com/meta-models/muse-code-sdk/issues/86)
(open at integration).
