# Security audit of the 0.19.0 release tree (AUDITSEC)

Date: 2026-10-18. Rig `linuxlt`, worktree `/home/randy/lanes/AUDITSEC`,
branch `audit/0190-security`, HEAD `186f08d437` (JOINB: release/0.19.0 with
the truth and platform groups merged). Read the source folder by folder
(`src/host`, `src/runtime`, `src/core`, `src/acp`, `src/shared`, `scripts/`,
`native/` helpers' callers) looking for real, exploitable defects in the
brief's classes: secrets reaching logs, errors, telemetry, temp files, child
environments or the webview; path steering (traversal, symlink, UNC/device
spellings); shell/argument construction from untrusted text; deserialization
or regex a hostile input can crash or hang; permission/approval bypasses; and
webview messages trusted without validation.

One defect found and fixed (finding 1). Everything else examined held; the
examined-and-clear list below names what was checked and why it is safe, so a
later reader need not re-walk it. No credentials were read, printed or stored;
no paid or live model calls were made. SAST (`security:sast`, semgrep `auto`)
is clean on the final tree.

## Finding 1 (fixed): media children inherited non-key secrets

- **Files:** `src/core/media/convert.ts:89-97` (`converterEnvironment`),
  `src/core/media/record/macos.ts:116-127` (`childEnvironment`).
- **The defect:** both filters stripped only names ending in `_API_KEY` plus
  `HOOK_FORBIDDEN_ENV_NAMES`. Any other credential shape the shared rule
  knows (`*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_AUTH`, `*_PAT`,
  `*_CREDENTIALS`, `*_PRIVATE_KEY`, `*_ACCESS_KEY`, `DOCKER_AUTH_CONFIG`,
  …) passed through into the converter/helper child environments, which do
  not need them. The module header of `convert.ts` claims "No … credentials",
  and the downstream governed launcher (`resourceEnvironment`,
  `src/core/resources/launch.ts:229-238`) does not strip credentials either,
  so the values really reached the child: `GITHUB_TOKEN`- and
  `*_PASSWORD`-shaped variables were observed in the assembled child env.
- **Attacker / impact (low):** whoever can read the converter/helper child's
  environment (same-user process listing, crash dump, a less-trusted
  user-configured converter binary) learns ambient secrets such as the
  user's `GITHUB_TOKEN`. The stock converters (ffmpeg/avconvert, our own
  helper) do not exfiltrate their environment, so this is unnecessary
  exposure rather than an exfiltration path. Fixed anyway: the brief names
  exactly this class, and the fix is two lines.
- **Fix (at the cause):** both filters now use the shared credential-name
  rule `isCredentialVariable` (`src/shared/credentialEnvironment.ts`), the
  same rule the hook, worker, git, ACP-start and `muse serve` boundaries
  enforce; the macOS filter additionally keeps dropping
  `MUSE_DICTATE_DISCLAIMED`. The native helpers read no credential-shaped
  environment, so nothing legitimate is lost.
- **Proof:** `temp/auditsec-probe.mjs` (scratch, gitignored) drives the real
  `locateMediaConverter` → `hasKnownVersion` → `converterEnvironment` path
  with `AUDITSEC_PROBE_GITHUB_TOKEN` and `AUDITSEC_PROBE_DB_PASSWORD` set.
  Pre-fix: `converter child env holds probe token: true`,
  `holds probe password: true`. Post-fix: both `false`.
- **Durable test:** `test/unit/mediaConverterEnv.test.ts` drives the real
  discovery path and asserts the three hostile shapes are absent and a benign
  variable survives. It fails on the old filter (verified by restoring the
  narrow predicate: 1 failed) and passes on the fix. CHANGELOG entry under
  `[Unreleased]` → `Security`.

## Examined and clear

- **Credential strip at ACP start:** `takeCredentials(process.env)` runs at
  `src/runtime/main.ts:163` before any child starts; `keepGitCredentialRoutes`
  keeps only the `GIT_PUSH_CREDENTIAL_VARIABLES` allow-list for the confirmed
  push / PR fetch (D104). Nothing writes a secret back into `process.env`
  (no `process.env[…] =` assignment of a secret in `src/`).
- **`muse serve` environment:** `childEnvironment`
  (`src/host/backend/museCodeBackendManager.ts:469-484`) = allow-list +
  vault fence; the stored Model API key lives in SecretStorage, never in the
  environment, so it cannot be inherited. `museCode: true` keeps the CLI's own
  credential handling (D1) by design.
- **Hook `extraEnvNames`:** `managedEnvNames`
  (`src/core/backends/modelapi/hooks.ts:272`) is narrower than the shared
  rule, but the single host implementation `hookEnvironment`
  (`src/host/backend/toolIo.ts:355-385`) re-checks every name with
  `isCredentialVariable` and drops credentials; all runners (extension, ACP
  runtime, checkpoints) funnel through it. Not exploitable; left unchanged.
- **Workspace confinement:** `resolveWorkspacePath`/`confineWorkspacePath`
  (`src/core/workspacePath.ts`) refuse `~`, `file://` oddities, drive
  letters, UNC without UNC ancestry; `windowsPathSpelling.ts` refuses device
  names, drive-relative, verbatim namespaces and trailing dots/spaces;
  `protectedPaths.ts` judges canonical paths case-folded. Callers (tools,
  hooks, imports, image generation, schedules, foreign hooks, plans) all go
  through them; `extraRoots` and `approvedTarget` come from the user's
  permission profile, not the model.
- **Worktree folders:** branch names pass `git check-ref-format --branch`
  before `worktreeFolder` is used (`src/host/commands/worktreeCommands.ts`);
  run ids match `^[a-z0-9][a-z0-9-]*$` before reaching the runner helpers.
- **Shell construction:** arg arrays everywhere (`spawn`/`execFile`, no
  `shell: true`, no `eval`/`new Function` in `src/`); the team launcher's
  `/bin/sh -c` runs a fixed script with `exec "$@"`; runner-helper
  parameters travel base64; the vault askpass wrapper interpolates only
  `posixQuoted` pieces. `shellSyntax.ts`/`looseWords` fail closed to
  `complex` for approval.
- **Approvals:** unattended schedules deny physical/protected/requiresAsking
  and re-check grants (`src/core/schedules/unattended.ts`); ACP
  `askPermission` denies on client failure and defaults to denial
  (`src/acp/agent.ts:1010-1094`); `editAutomaticallyChoice` excludes
  protected writes, replays and judge escalations; foreign hook grants are
  stripped (`withoutGrant`); paid ACP use denies without flag/asker.
- **Webview boundary:** inbound messages are zod-parsed
  (`parseWebviewToHostMessage`, `webviewSetup.ts:164-215`); the IDE MCP
  server uses a per-host bearer compared timing-safely; OAuth callback
  validates host header, origin, path and PKCE state.
- **Reports/exports:** problem reports carry a second full-draft scrub plus
  vault-value scrub (`src/core/support/problemReport.ts:353-372`); session
  export redacts credentials, digests, e-mails and local roots; diagnostics
  reports state only booleans/counts for secrets.
- **Secrets at rest/in transit:** provider records are origin-bound
  (`credentialRecords.ts`); the vault MCP routes re-check use at release and
  scrub responses; the loopback token file is owner-only (`tokenFile.ts`).
- **ReDoS:** the redaction table documents linear-time patterns; glob
  compilation is length/alternative-capped; no nested quantifiers on
  untrusted input were found. Semgrep `auto` reports no findings.
- **Scripts:** `GITHUB_TOKEN`/`JUDGE_BENCH_API_KEY` travel only as
  `Authorization` headers, never into logs.

## Gates (final tree)

- `security:sast` (semgrep `auto`): exit 0, no findings (3 rule timeouts on
  `ModelApiHost.ts` for `tainted-html-string`, a scanner limit, not a
  finding).
- prettier: changed files clean. eslint on the changed files: zero
  errors, zero warnings. `npm run typecheck` (all projects): exit 0.
- Touched suites, repository's own timeout, `--maxWorkers=3`:
  `mediaConverterEnv` (1 passed), `mediaContracts` + `mediaBudget` +
  `mediaSniffMalformed` (40 passed), `mediaLocalization` (17 passed).
- New test `test/unit/mediaConverterEnv.test.ts`: 1 passed post-fix, 1 failed
  on the restored narrow filter, 1 passed after re-applying the fix.
- `npm run build`: STOPS pre-existing at the What's New bound
  (`CHANGELOG.md 0.19.0` notes decode to 90480 bytes vs the 76800-byte
  bound). This change touches only `[Unreleased]` (diff-proven above), so the
  stop is independent of it; trimming the 0.19.0 notes is the join's job
  (brief: "the join trims the notes"), not this audit's. Bundle-size/split
  gates below the stop were therefore not reached on this tree.
