# Certification — the Linux sandbox that cannot start says so (F91)

## 2026-10-15 (lane SANDBOXSAY, rig `linuxlt`)

### The finding (REALLIFE-1014 F91)

Our app starts `muse serve` with Muse Code's shell sandbox on by default
(`resolveShellSandbox`: `museSpark.shellSandbox` `auto` → sandbox on,
reason `default`). On a Linux host where bubblewrap cannot create a user
namespace, every command Muse Code runs without asking fails with the raw
line `bwrap: No permissions to create new namespace, likely because the
kernel does not allow non-privileged user namespaces`. Two coding jobs
stopped with `LANE BLOCKED`; the model had concluded the shell was dead.
Our app logged `Shell sandbox on (default) for this host` and nothing else.

### The measured mechanism (this machine, no model call)

- Muse Code 1.4.6 (`muse-bin-1.4.6-R6000.1`, ELF) runs its Linux sandbox
  under the **system `bwrap` from PATH** with a user namespace. Its binary
  carries `LinuxBwrapSelection` / `LinuxBwrapCapabilities`
  (`supports_perms`, `supports_ro_bind_symlink`, `supports_ro_bind_data`,
  `supports_cap_drop`, `supports_ro_bind_try`), the `TBH_BWRAP_EXE` /
  `TBH_INTERNAL_MODE=linux-sandbox` markers, `--unshare-user`,
  `--die-with-parent`, `--ro-bind`, `--unshare-net`, and the message
  `no capability-valid system bwrap was found on PATH and no usable
embedded fallback is available; install your distribution's bwrap
package`.
- The refusal on this rig, measured directly:
  `bwrap --ro-bind / / --unshare-user --unshare-pid --unshare-net
--die-with-parent -- /bin/true` → exit 1 with the F91 line verbatim.
  Minimal form `bwrap --unshare-user -- /bin/true` fails identically
  (exit 1, same line). Machine state: bubblewrap 0.11.0 at
  `/usr/bin/bwrap`, `kernel.unprivileged_userns_clone=1`,
  `kernel.apparmor_restrict_unprivileged_userns=1`.
- The same refusal text sits in a real session journal on this machine
  (`~/.local/share/muse/sessions/...`), confirming the line the model saw.

### The fix

- `src/shared/constants.ts`: `LINUX_SANDBOX_PROBE_COMMAND/ARGS`
  (`bwrap --unshare-user -- /bin/true`, the same mechanism minimally),
  `LINUX_SANDBOX_PROBE_TIMEOUT_MS` (10 s),
  `LINUX_SANDBOX_NAMESPACE_MARKER`, and `SANDBOX_CANNOT_START_MODEL_NOTE`
  (model English, beside `CHOICE_STEERING_NOTE`, not a `MODEL_TEXT` block,
  so the bundle-split gate needs no new declaration).
- `src/core/backends/musecode/sandbox.ts`: pure `parseLinuxSandboxProbe`
  (exit 0 → can start; marker → `userNamespacesBlocked`; anything else →
  `bwrapFailed` with the probe's first line) and `probeLinuxSandboxShell`
  (never throws; a spawn that never ran is `bwrapFailed` with the errno).
- `src/host/backend/museCodeBackendManager.ts`: at each host start, while
  sandboxed on Linux, a fresh probe; when it cannot start, one
  `log.warn(UI_TEXT.sandboxCannotStartNotice)`. The posture is untouched:
  no silent switch to off. Cached as `shellSandboxReadiness()` /
  `readShellSandboxReadiness()` (the latter probes on demand for
  Diagnostics before any host has started).
- Panel: `conversationController.noteShellSandbox` warns once per
  conversation (sharing `hasWarnedSandbox`, so a later raw bwrap line never
  piles on); the first Muse Code turn appends the model note at the tail
  (`hasToldModelSandboxCannotStart`), earlier request bytes untouched.
- Editor protocol: `AcpBackend.shellSandboxReadiness?(cwd)` (optional, so
  older backends keep working), implemented in `src/runtime/backends.ts`
  from the folder's host; `adopt` sends the notice as one
  `agent_message_chunk` per adopted session; the first prompt appends the
  model note at the tail. Terminal stderr is the manager's warn (the
  runtime logger writes it to stderr).
- Diagnostics: `SupportFacts.shellSandboxReadiness` +
  `sandboxReadinessLine` (fixed words, safe for public issues); the
  command probes on demand when no host has started.
- Strings: `sandboxCannotStartNotice` in `src/shared/l10n/en.ts` and all 14
  `l10n/ui.*.json`, in English order (`npm run check:l10n`: 0 problems).
- No `doctor` command exists in the product (searched `src`, `test`,
  `package.json`): the health surfaces are the Diagnostics command (panel)
  and the host-start stderr line (terminal/serve/exec). Adding a `doctor`
  command is left as an owner decision (it is a new command: catalog,
  reference, README table).

### Proof by real use of the packed product (no model call)

Driver `temp/sandbox-say/probe-acp.mjs` (scratch, gitignored): packed
`dist/acp.js --backend museCode --shell-sandbox auto --trust-workspace`,
fabricated dummy `META_API_KEY` (readiness `ready` without sign-in),
`initialize` → `session/new` → `session/new` again, no prompt ever sent.

BEFORE (baseline `dist`, trusted workspace, 2026-10-15):

```text
session/new ok: 01a13dc8-4440-7f22-baf4-adb62ee95544
--- session/update texts ---
{"configOptions":[...]}            # no words about the sandbox
--- stderr ---
[info] Display language en-us: the panel is in English
[info] muse-spark-code-acp 0.18.2 serving ACP on stdio (museCode)
[info] Shell sandbox on (default) for this host
[info] muse serve credentials: the CLI's own (credential file inline, ...)
[info] Spawning /home/randy/.local/bin/muse serve --trust-workspace
...                                # nothing actionable follows
```

AFTER (fixed `dist`, two sessions, one host start, 2026-10-15):

```text
session/new ok: 01a13dd4-95fd-79d1-b947-3eadec11b3be
second session/new ok: 01a13dd4-9728-7573-a411-978cd066b84f
--- session/update texts ---
{"configOptions":[...]}
"Muse Code's shell sandbox cannot start on this machine: its bubblewrap sandbox cannot create a user namespace here, so commands it runs without asking (such as git status) will fail. Set museSpark.shellSandbox to off, or allow unprivileged user namespaces on this machine (sysctl kernel.unprivileged_userns_clone=1; where AppArmor restricts them, kernel.apparmor_restrict_unprivileged_userns=0). The sandbox stays on until you choose."
"Muse Code's shell sandbox cannot start on this machine: ... (same, second session)"
--- stderr ---
[info] Shell sandbox on (default) for this host
[warn] Muse Code's shell sandbox cannot start on this machine: ... (once)
```

Once-semantics measured: 2 sessions → 2 notice chunks; 1 host start →
1 stderr warn. Posture unchanged (`Shell sandbox on (default)`, serve
started without `--disable-sandbox`).

### Field practice (read 2026-10-15; UNVERIFIED where marked)

- **Codex CLI** — the same should, built in. Its Linux-sandbox README
  (read verbatim from the repo):
  "If bubblewrap cannot create user namespaces, Codex surfaces a startup
  warning instead of waiting for a runtime sandbox failure." The same
  warning path fires when `bwrap` is missing (then it falls back to its
  bundled `codex-resources/bwrap`).
  URL: https://github.com/openai/codex/blob/main/codex-rs/linux-sandbox/README.md
- **Claude Code** — official sandboxing page (read verbatim):
  a startup dependency check (`/sandbox` shows a Dependencies tab listing
  which of `ripgrep`, `bubblewrap`, `socat` and the seccomp filter the
  platform lacks; "The dependency check runs at startup"); a real
  `claude doctor` terminal command ("Run `claude doctor` in your terminal
  to list the leftover placeholder files"); and for Ubuntu 24.04+ AppArmor
  (`kernel.apparmor_restrict_unprivileged_userns=1`) a dedicated AppArmor
  profile granting `bwrap` the `userns` rule plus
  `sudo systemctl reload apparmor` — the better-practice alternative to
  the sysctl named in our notice; README points at it.
  URL: https://code.claude.com/docs/en/sandboxing
- **Gemini CLI** — official sandbox page (read):
  methods are macOS Seatbelt, Docker/Podman containers, Windows native,
  gVisor/runsc and LXC; sandboxing is opt-in (`-s`, `GEMINI_SANDBOX`,
  `settings.json`) with a documented off switch
  (`security.toolSandboxing: false`).
  URL: https://geminicli.com/docs/cli/sandbox/
  UNVERIFIED: the exact words Gemini prints when its sandbox provider is
  missing (a secondary source says a wrong `GEMINI_SANDBOX` value "is a
  fatal error, not a silent run without a sandbox"; Google's disclosure
  team says running unsandboxed shows "a persistent warning in red text
  throughout their session" — both unconfirmed against their docs/repo in
  this lane's time box).

### Tests (real code only)

- `test/unit/sandbox.test.ts` +4 (`parseLinuxSandboxProbe` over the real
  module: exit 0; the verbatim captured bwrap refusal of 2026-10-15;
  never-ran; another failure keeps its own first line).
- `test/unit/supportReport.test.ts`: new fact on the base fixture and its
  exact line; `sandboxReadinessLine` over all four shapes.
- Red drills (2026-10-15): broke the blocked branch to `canStart: true`
  → 1 failure (`reads the kernel refusing the user namespace as blocked
namespaces`); broke `can start here` → `ready here` → 1 failure
  (`says a sandbox that can start`). Restored (a `sed` restore touched the
  exit-0 branch too; repaired with the file editor, re-ran green, verified
  by reading the function back).
- Dependents (`vitest related`, repo default timeout): sandbox, report,
  manager, agent, backends → 4 files / 60 tests green (incl.
  `acpStdio.e2e`, 13 tests over real packed stdio); controller,
  extension → only the self-skipping live e2e. The `.live.e2e` skips need
  a real provider (lead's real-life run).

### Real-life scenarios for the lead (need a person/provider)

1. VS Code on an affected Linux host, Muse Code backend, trusted folder:
   open a conversation → the panel shows the sandbox-cannot-start warning
   once; Diagnostics shows `shell sandbox readiness: cannot start here:
bubblewrap cannot create a user namespace`.
2. Same host, editor protocol: `session/new` → the notice chunk arrives
   once; first prompt's model context ends with the harness note (no
   earlier bytes changed).
3. Same host, `muse-spark-code-acp exec --shell-sandbox auto …`:
   stderr carries the warning once before anything else runs.
4. A machine where userns works: no notice anywhere; Diagnostics says
   `can start here`.

### Gates (final tree)

- `prettier --check` on all 27 changed files → clean (4 files reformatted
  with `--write`: only the lane's own lines).
- `eslint --max-warnings=0` on the 11 changed source/test files →
  exit 0. (8 rule hits fixed in code, no suppressions:
  `prefer-ternary`, `no-unnecessary-condition`,
  `no-useless-coercion`, `prefer-early-return`,
  `prefer-minimal-ternary`, `consistent-class-member-order`.)
- `npm run typecheck` (all 5 projects) → exit 0.
- `npm run deadcode` (knip) → exit 0.
- `npm run cycles` → no circular dependencies, exit 0.
- `npm run duplication` (jscpd) → 0 clones, exit 0.
- `npm run check:l10n` → 0 problems, exit 0.
- `npm run check:reference` → catalog match, exit 0.
- `npm run check:host-api` → first failed (exit 1) on the generated
  `docs/ide-compatibility/host-api.md`: the new `node:child_process`
  import moved its count 30 → 31. Regenerated with `-- --write`
  (one-line diff, reviewed), re-run → 0 problems, exit 0.
- `npm run build` → exit 0 (extension 552.5 KiB, Model API 507.2 KiB,
  caps hold; full sizes in `temp/sandbox-say/build.log`, gitignored).
- `npm run security:sast` → exit 2, NOT RUN: semgrep cannot start on
  this rig (`OSError: [Errno 30] Read-only file system:
'/home/randy/.cache/semgrep_version'`); the exact error is in
  `temp/sandbox-say/sast.log` (gitignored). The lane's only
  scanned-text use is the locally spawned `bwrap` binary's first stderr
  line, kept as a log/diagnostics detail, never executed or interpolated
  into a command.
- `npm run security:audit` → exit 0 (2 advisories: 1 exceptioned, 1 note).
- Touched unit tests → `sandbox.test.ts` (18) + `supportReport.test.ts`
  (12) green; dependents via `vitest related` green (see Tests).
- `l10n-pack-diag.mjs` is absent from this rig's `_ctx`; equivalent
  check instead: the new key sits at index 1719 in `en.ts` and in all 14
  `l10n/ui.*.json`, with the same neighbours
  (`sandboxPreparingNotice` / `rulesFileNoWorkspace`) — ORDER-OK × 14.

### APP PROBLEMS

1. No `doctor` command and no terminal health command exist; the closest
   are the Diagnostics command (panel) and host-start stderr (terminal).
   Claude Code ships `claude doctor`. Owner decision: add a `doctor`
   command or keep Diagnostics + stderr.
2. The notice names the `kernel.apparmor_restrict_unprivileged_userns=0`
   sysctl; Claude Code's docs instead recommend a dedicated AppArmor
   profile for `bwrap`. The README cites it; the notice keeps the
   one-command check.
3. `muse serve --help` (1.4.6) says sandbox posture and session
   durability "apply to every session the host loads; neither is
   negotiable over the wire" — the editor-protocol notice is therefore
   words only, by design; the posture cannot be changed per session.

## Review addendum — RVSANDBOXSAY, 2026-10-14 (rig `linuxlt`)

The record above stands as the lane wrote it; four of its claims did not
survive review and are corrected here, with the fixes on branch
`rv/sandbox-say`.

1. **P1 — the probe could not pass on a healthy machine.** The shipped
   probe was `bwrap --unshare-user -- /bin/true` with no bind. bwrap
   starts "a new, completely empty, filesystem namespace where the root
   is on a tmpfs" (bwrap(1), read on this rig), so `/bin/true` does not
   exist inside it and the probe fails wherever user namespaces work
   too: every sandboxed Linux user would have been told the sandbox
   cannot start. "Minimal form fails identically" (above) is true only
   on a blocked machine, where both forms die at namespace creation
   before exec. Fixed in `e650111b0`: the probe is now
   `bwrap --ro-bind / / --unshare-user -- /bin/true` (the full form this
   record measured at line 29), and the host-start-awaited timeout drops
   from 10 s to 2 s (measured refusal here: 4 ms). The probe's success
   path remains UNVERIFIED on this rig — user namespaces are refused
   here — and is exactly real-life scenario 4 above, still owed.
2. **P2 — cannot-start was said for unproven causes.** Any probe failure
   (no `bwrap` on PATH, a timeout, any other bwrap error) produced the
   notice and model note naming the user-namespace cause and the sysctl
   remedy. Muse Code's own message (quoted above) names an embedded
   bwrap fallback, so those failures do not prove the sandbox cannot
   start. Fixed in `81fc89efd`: `isLinuxSandboxBlocked` is the one gate
   for the cannot-start words on every surface; other failures get a
   fixed-words log line and an honest Diagnostics line. This corrects
   "fixed words, safe for public issues" above: the `bwrapFailed`
   Diagnostics branch carries the probe's own detail (bwrap's first
   stderr line or the spawn errno from a fixed-args local probe), now
   worded as a failed check, never "cannot start".
3. **P2 — "once per conversation" was once per surface.** The panel
   notice shared `hasWarnedSandbox` and `hasToldModelSandboxCannotStart`
   was never reset, while the controller lives per surface across
   sessions: a second conversation's model was never told and its
   person never re-shown the notice. Fixed in `690bb252a`.
4. **P2 (partial) — the editor-protocol notice was unmarked model
   speech (F82's class).** The AFTER capture above shows it as a plain
   text chunk. `fix/provider-truth` (F82) is not in this tree, so its
   session-notices update cannot be used from here; fixed as far as
   this branch can in `dd51230a9`: the chunk carries
   `_meta {sandboxCannotStartNotice: true}` (the `accountNotice`
   precedent) and the code records the merge step — clients advertising
   F82's notices capability must get its separate notice update
   instead. Re-proven on the packed product after the fixes (same
   driver shape as above, scratch `temp/rv-probe-acp.mjs`): 2 sessions
   → 2 marked chunks, 0 unmarked, 1 stderr warn, posture still
   `Shell sandbox on (default)`.

Red drill (review): `isLinuxSandboxBlocked` broken to ignore the reason
→ `holds only for the proven user-namespace refusal` failed (1 of 20);
reverted, green. A real-probe test (`probeLinuxSandboxShell` against the
machine's real bwrap or its real absence) now covers the spawn path the
lane's parse-only tests never reached.

Gates on the reviewed tree (main `898a26c5e3` is already an ancestor of
the lane base, so the merge is "Already up to date", no conflicts):
typecheck 0, eslint `--max-warnings=0` on the 8 changed code/test files
0, prettier clean, `check:l10n` 0, `check:reference` 0,
`check:host-api` 0, `deadcode` 0, `cycles` 0, `duplication` 0 clones,
`npm run build` 0; `sandbox.test.ts` (20) + `supportReport.test.ts`
(12) green; `vitest related` for the ACP agent and backend manager
green (30 passed, 3 live-provider skips). `security:sast` not re-run
(semgrep cannot start on this rig, as above).

Real-life scenario 1 gains one step: start a SECOND conversation in the
same panel — the warning shows again and the new session's first turn
carries the model note (item 3).
