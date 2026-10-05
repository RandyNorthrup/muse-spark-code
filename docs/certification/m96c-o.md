# M96c lane O — check slots and runners

Rig: macmini. Base: `dfbedc5c`; plan of record: `e23ec61c`.
Read the rig brief, shared Codex rules, AGENTS.md, PLAN.md D75 and M96c,
`m96-research.md` (including §8) and lane 0c's contract record before editing.
No network, live model or paid calls. All remote execution tests use fakes,
local child processes and temporary repositories inside this worktree.

## Configuration and routing

User-level `runners.json` is read only beneath the supplied config home, with
an explicit bounded reader and lane 0c's strict schema. Credentials and Git
process overrides are removed; only the extension's SSH transport retains
its agent. Health is validated and expires after the plan's 60 seconds.
Routing passes shell admission before probing or dispatching, checks trust
again after waits, matches command classes/OS labels, follows runner affinity,
samples load and slots before dispatch, and falls back on busy, offline or
uncertain runners. A Windows-only check cannot fall back to a Mac local slot.
A late result's run id cannot admit another run.

Verification: `runnerRouting.test.ts`, 10 passing tests, directly on macmini.
ESLint and Prettier on these files passed; host typecheck passed.
Full quality is reserved to integration/X2 by the lane brief's shared rules.

## Red drills: configuration and routing

Each listed mutation failed the named test; every source was restored
byte-exact, checked with SHA-256. No test-name filters or skipped tests.
The first size drill showed the initial oversized fixture also failed JSON
parsing without the size guard. The fixture was corrected to valid padded
JSON, and the size guard then demonstrably failed when removed.

| Guard removed or changed | Named failure                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| config authority         | reads only the config-home file and refuses unknown authority and oversized data                            |
| config size              | reads only the config-home file and refuses unknown authority and oversized data                            |
| credentials              | drops credential names case-insensitively even when allowlisted, and keeps the SSH agent only for transport |
| allowlist                | drops credential names case-insensitively even when allowlisted, and keeps the SSH agent only for transport |
| health freshness         | expires health, refuses malformed measurements, and treats a clock rewind as unknown                        |
| health rewind            | expires health, refuses malformed measurements, and treats a clock rewind as unknown                        |
| health cores             | expires health, refuses malformed measurements, and treats a clock rewind as unknown                        |
| health load              | expires health, refuses malformed measurements, and treats a clock rewind as unknown                        |
| health slots             | expires health, refuses malformed measurements, and treats a clock rewind as unknown                        |
| health boundary          | expires health, refuses malformed measurements, and treats a clock rewind as unknown                        |
| shell admission          | runs every shell guard before any probe or dispatch                                                         |
| trust admission          | refuses untrusted work and trust lost while sampling                                                        |
| labels                   | matches Windows-only labels and command classes instead of routing to a Mac                                 |
| command class            | matches Windows-only labels and command classes instead of routing to a Mac                                 |
| affinity                 | tries affinity first, then falls back from offline, busy and uncertain runners                              |
| local platform           | refuses a Windows-only job when no Windows runner or local slot is available                                |
| load guard               | samples before dispatch and refuses overloaded, full, input-hung and offline runners                        |
| free slots               | samples before dispatch and refuses overloaded, full, input-hung and offline runners                        |
| input ready              | samples before dispatch and refuses overloaded, full, input-hung and offline runners                        |
| late remote result       | rejects late remote and local answers by run id, and respects cancellation                                  |
| late local result        | rejects late remote and local answers by run id, and respects cancellation                                  |
| cancel                   | rejects late remote and local answers by run id, and respects cancellation                                  |

Restored SHA-256 values before commit formatting:

- `src/core/runners/runnerConfig.ts`: `9a99a0a33b339716cf492bf6480851fa126dc5f257456fd9eefbba352b4155bc`
- `src/core/runners/health.ts`: `0a653fa81bf72719cf472d853187a1ce8fcf974c6e3880fe3866b11965ba570b`
- `src/core/runners/routing.ts`: `cbf8b11d78b2b49fa4220190e28b755f3983328c364bee3bbb0c63d04386fdef`

## Check slots and the two calling regions

`CheckSlots` snapshots the caller's working edits with a private Git index,
keeps one persistent copy per window slot, resets tracked and untracked
files, and caches configured install artifacts under the exact lockfile,
setup-command and cache-key hash. Copies use `COPYFILE_FICLONE`, with Node's
ordinary copy fallback, and never hard-link mutable installs. Failed setup
returns its exit code and complete diagnostic output without starting the
check. Canonical-path checks refuse the user's checkout, aliases to it,
and slot storage inside it. Trust, cancellation, host pressure, slot
ownership and descendant uncertainty are checked before reuse.

The `engineWorker.ts` and `mcpBridge.ts` files contain only O's marked
regions, because W/B's full files are absent on this base. The bridge uses
the existing `run_checks` definition and check-command schema, bounded
strict arguments, injected canonical path resolution, current authenticated
attempt/tool-policy admission, all shell guards, hook rewrites, and injected
M73 packing of complete results. Admission is rechecked after packing too.
Tests cover ordinary test commands and `then_run`; no guard refusal probes
a runner or snapshots/installs anything.

Required caller bindings, deliberately explicit rather than production
stand-ins:

- K supplies `CheckProcess`: a trusted executable resolver, credential-free
  journalled launch, bounded output/timeout/cancellation, and actual
  container retirement evidence. `descendantsEnded: true` means proof,
  never a PID observation, process-group exit or `userDecision`.
- K supplies a window-owned slot root, load pressure, and recovery/admission
  for copies left by an earlier window. An uncertain slot remains occupied;
  its copy has no reuse/release API here. The scheduler's user-decision and
  fresh-copy handoff policy remains distinct from proof. On macOS, no
  whole-descendant proof is claimed by this lane's test adapter.
- W routes its classified test commands and `then_run` through
  `routeWorkerCheck`, injecting the full ordinary shell guard chain. Its
  guard returns the admitted final command; routing freezes the other job
  fields.
- B registers `bridgeRunChecks` on its authenticated endpoint and binds its
  token/attempt/tool checks, path resolver, job ids, output packing, and the
  same routing/guard chain. No token transport, engine loop or MCP server
  is stubbed in these region files.

The finite local test child adapter is test-only. It is not production
process-lifetime evidence. All temporary fixtures remain inside `temp/`.

## SSH runners and helper protocol

Every helper connection uses the user's SSH with `-n`, batch mode, strict
host keys, no agent forwarding, and the pinned connection timeout. Git's
SSH command retains the four security options and deliberately omits `-n`:
Git's duplex pack protocol needs standard input. Credential variables are
removed from local children and forwarded command environments; the host
SSH transport alone may retain its own agent. Both helpers strip credential
names from the runner's own inherited environment before executing setup
and checks. Only the public SHA-256 host fingerprint is extracted from
verbose stderr; the raw text is never logged or shown.

The pushed snapshot contains uncommitted and untracked files without moving
the caller's index or refs. Pushes originate in a temporary shared bare
copy with global/system Git configuration disabled, so repository
`url.*.insteadOf` cannot redirect them. A fixture plants precisely that
redirect and the fake SSH transcript proves it is unused. Helpers are
versioned by their content hash and installed through unique temporary
files followed by rename. Output is streamed by append-only deltas and
bounded by bytes; malformed markers, stale ids, regressed output and an
uncertain local transport cannot admit a result.

Remote allocation uses exclusive create. Slots are reclaimed only after
that job's exit marker exists, never because SSH disconnected, a timer
expired, or a PID looked dead. Setup caches have separate exclusive
creation; a busy creator produces a tagged fallback, while an actual
check's exit code 75 remains a check failure. An exclusive cache owner
removes its incomplete old install before rebuilding. A killed cache
creator's stale creation lock is conservative and is never stolen.

The POSIX supervisor detaches from SSH, owns the job's process group,
terminates it on timeout and after command exit, waits for the group to
end, then renames the exit marker. A descendant that deliberately escapes
with `setsid` is outside this process-group guarantee; no OS sandbox or
whole-descendant proof is claimed. The Windows helper launches its
supervisor with direct inheritable NUL/output handles (no SSH-owned pipe
pump), and launches checks suspended into a kill-on-close Windows job
before resume. Retirement waits for the job's active count to reach zero.
The Windows self-test exercises detached launch and closed-input reading;
a refusal/hang offers the existing scheduled-task-wrapper notice.

The helper protocol is owned by these bundled scripts, not guessed Muse
Code/Model API wire data. Its strict health/start/end schemas correspond to
frames generated by the helpers in the fake-SSH/local-Git tests. No model
attempts or real remote connections were made.

## Red drills: slots and calling regions

All 30 mutations below failed a named test in the whole owned test file,
without a name filter. Each source was restored byte-exact and SHA-256
checked before the next mutation. The path-boundary follow-ups below were
added after reviewing Windows case folding and a child named `..cache`.

| Mutated guard              | Named failure                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| hook rewrite               | dispatches the command after a hook rewrite and refuses an empty hook command                    |
| empty hook command         | dispatches the command after a hook rewrite and refuses an empty hook command                    |
| routing labels after hook  | matches Windows-only labels and command classes instead of routing to a Mac                      |
| snapshot private index     | snapshots working edits and untracked files without touching the real index or refs              |
| snapshot dirty bytes       | snapshots working edits and untracked files without touching the real index or refs              |
| snapshot descendant proof  | keeps slots occupied when descendants are uncertain or a transport fails                         |
| git descendant proof       | keeps slots occupied when descendants are uncertain or a transport fails                         |
| command descendant proof   | keeps slots occupied when descendants are uncertain or a transport fails                         |
| launch failure reservation | keeps slots occupied when descendants are uncertain or a transport fails                         |
| slot exclusive owner       | isolates installs between concurrent slots and never shares mutable cache files                  |
| uncertain slot retention   | keeps slots occupied when descendants are uncertain or a transport fails                         |
| slot trust                 | refuses the user checkout, host pressure, untrusted work, escaped installs and missing lockfiles |
| slot cancel                | refuses late trust loss and cancellation before starting another child                           |
| slot load                  | refuses the user checkout, host pressure, untrusted work, escaped installs and missing lockfiles |
| user checkout fence        | refuses the user checkout, host pressure, untrusted work, escaped installs and missing lockfiles |
| storage inside checkout    | refuses the user checkout, host pressure, untrusted work, escaped installs and missing lockfiles |
| install path fence         | refuses the user checkout, host pressure, untrusted work, escaped installs and missing lockfiles |
| git metadata exclusion     | refuses the user checkout, host pressure, untrusted work, escaped installs and missing lockfiles |
| slot count                 | refuses the user checkout, host pressure, untrusted work, escaped installs and missing lockfiles |
| source reset               | resets source and installs once per exact lockfile hash in each slot                             |
| exact lockfile cache       | resets source and installs once per exact lockfile hash in each slot                             |
| cache reuse                | resets source and installs once per exact lockfile hash in each slot                             |
| failed setup stops check   | does not run checks after a failed install and strips credentials from every child               |
| slot credentials           | does not run checks after a failed install and strips credentials from every child               |
| bridge strict boundary     | rejects unknown fields, missing checks, unknown names, unsafe paths and oversized calls          |
| bridge call bound          | rejects unknown fields, missing checks, unknown names, unsafe paths and oversized calls          |
| bridge auth and attempt    | binds access to the current authenticated attempt and rechecks it after waits                    |
| bridge paths resolved      | rejects unknown fields, missing checks, unknown names, unsafe paths and oversized calls          |
| bridge packing complete    | offers the existing run_checks definition, quotes paths, runs guards and packs the full output   |
| bridge post-pack admission | binds access to the current authenticated attempt and rechecks it after waits                    |

Restored source SHA-256 values for these drills:

- `src/core/runners/routing.ts`: `bc0b98a6d6521a4328adcc8cde3a36190b33d02c3f717e82bd10c27206d95f62`
- `src/host/team/checkSlots.ts`: `06990625ce512526897eaf68b0b3ea78e22f18519b9ff49e5452816e98117cb2`
- `src/host/team/mcpBridge.ts`: `e902daf152cf1de8cb8015527ecc82b5681c7fa33ae1f24252aa38a1c7cbb9ab`

The two follow-up guards were also deliberately removed and failed:

- case insensitive metadata path: refuses the user checkout, host pressure, untrusted work, escaped installs and missing lockfiles. Restored SHA-256 `2351e77348944b1ba26f8199e0b76752c30f837dec8e4e7b4ea0c71e3b5a3f35`.
- dot prefix storage fence: refuses the user checkout, host pressure, untrusted work, escaped installs and missing lockfiles. Restored SHA-256 `2351e77348944b1ba26f8199e0b76752c30f837dec8e4e7b4ea0c71e3b5a3f35`.

## Red drills: SSH and native helpers

All 47 mutations below failed named tests in the complete SSH test file;
each source was restored byte-exact and checked with SHA-256. Windows
helper assertions are source contract checks and fake-transport checks,
not native Windows execution certification.

The first Windows self-test drill exposed a weak fixture: its health
response failed even after removing the input-readiness guard. The fixture
now makes that later health response succeed, and removing the input guard
then fails the named test. The encoded helper upload uses gzip, quotes the
root once, round-trips to identical helper bytes, and stays below Win32
CreateProcess's command-line limit at the schema's longest folder value.
PowerShell command files carry a UTF-8 BOM for Windows PowerShell 5.1.

| Mutated guard                       | Named failure                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| SSH batch mode                      | pins every SSH option, including ports, and closes Windows command stdin                                              |
| SSH host key policy                 | pins every SSH option, including ports, and closes Windows command stdin                                              |
| SSH agent forwarding                | pins every SSH option, including ports, and closes Windows command stdin                                              |
| SSH connect deadline                | pins every SSH option, including ports, and closes Windows command stdin                                              |
| SSH stdin closure                   | pins every SSH option, including ports, and closes Windows command stdin                                              |
| Windows noninteractive transport    | shows only the public host fingerprint and rejects a Windows shell waiting on input                                   |
| Windows launcher self-test          | tests the actual detached Windows launcher and rejects an input-hung self-test                                        |
| transport trust                     | refuses unsafe runner config, trust loss and working-copy admission, and reports offline instead of hanging           |
| working copy admission              | refuses unsafe runner config, trust loss and working-copy admission, and reports offline instead of hanging           |
| run id path fence                   | refuses unsafe runner config, trust loss and working-copy admission, and reports offline instead of hanging           |
| run id byte bound                   | refuses unsafe runner config, trust loss and working-copy admission, and reports offline instead of hanging           |
| active run id                       | refuses duplicate active run ids before another dispatch                                                              |
| atomic helper publication           | pushes working edits and untracked files, streams exact output, caches setup and installs only by rename              |
| repository push redirect fence      | pushes working edits and untracked files, streams exact output, caches setup and installs only by rename              |
| exact remote lockfile cache         | pushes working edits and untracked files, streams exact output, caches setup and installs only by rename              |
| strict end marker                   | rejects uncertain local children and malformed, late or regressed remote streams                                      |
| late end run id                     | keeps the remote slot after disconnect until an exit marker, rejects late run ids and respects maxJobs across windows |
| late start run id                   | rejects uncertain local children and malformed, late or regressed remote streams                                      |
| output byte bound                   | rejects uncertain local children and malformed, late or regressed remote streams                                      |
| stream append guard                 | rejects uncertain local children and malformed, late or regressed remote streams                                      |
| cache-busy fallback                 | falls back on a cache creator without hiding a check exit code of 75                                                  |
| exclusive runner slots              | keeps the remote slot after disconnect until an exit marker, rejects late run ids and respects maxJobs across windows |
| cache creator exclusion             | pushes working edits and untracked files, streams exact output, caches setup and installs only by rename              |
| remote command credentials          | pushes working edits and untracked files, streams exact output, caches setup and installs only by rename              |
| job timeout result                  | ends the remote process group at timeout and writes the marker only afterwards                                        |
| job group termination               | ends the remote process group at timeout and writes the marker only afterwards                                        |
| helper exit marker authority        | keeps the remote slot after disconnect until an exit marker, rejects late run ids and respects maxJobs across windows |
| Windows allocation exclusive create | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                          |
| Windows detached supervisor         | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                          |
| Windows inherited stdin             | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                          |
| Windows suspended job child         | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                          |
| Windows kill-on-close               | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                          |
| Windows child binding               | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                          |
| Windows descendant retirement       | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                          |
| Windows atomic exit publication     | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                          |
| Windows slot exclusive create       | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                          |
| Windows cache exclusive create      | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                          |
| SSH child retirement                | rejects uncertain local children and malformed, late or regressed remote streams                                      |
| self-test child retirement          | shows only the public host fingerprint and rejects a Windows shell waiting on input                                   |
| push-copy child retirement          | rejects uncertain local children and malformed, late or regressed remote streams                                      |
| push child retirement               | rejects uncertain local children and malformed, late or regressed remote streams                                      |
| blob child retirement               | rejects uncertain local children and malformed, late or regressed remote streams                                      |
| Windows upload command-line bound   | tests the actual detached Windows launcher and rejects an input-hung self-test                                        |
| Windows UTF-8 command decoding      | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                          |
| Windows handle allowlist            | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                          |
| Windows extended startup flag       | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                          |
| Windows extended startup passed     | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                          |

Restored source SHA-256 values (the upload-size fix separates the two host versions):

- `native/runner/runner-helper.ps1`: `2a549079a31cd18e8f040a56c394cf76a5e8fb727b7d1f4b6052fcbf494d35bd`
- `native/runner/runner-helper.ps1`: `efb3620cedfc6bd83496774084dcc65d6105ab5cd1fa855c47093394d37783c7`
- `native/runner/runner-helper.sh`: `44a47d0991845401ec10633417a3363087f2b5a665da68a564b9189ff1ad823a`
- `src/host/runners/sshRunner.ts`: `5ec1d37e8d6164125aa64dc90ad67b2ef0902859942493d036a048a52244b9c3`
- `src/host/runners/sshRunner.ts`: `9a507b9caa5e82608b154cb02a30b4f85fbc7d6e4dd0234cee623ace4155bf2f`

The embedded helper compiled offline as C# 5 with the installed .NET SDK.
A deliberate `Thread.Missing` call failed with CS0117; the PowerShell source
was restored byte-exact to SHA-256 `efb3620cedfc6bd83496774084dcc65d6105ab5cd1fa855c47093394d37783c7`.
The detached supervisor now uses STARTUPINFOEX's handle allowlist for only
its NUL input and output file. It does not inherit other SSH-owned pipes.

## Integration handoff and remaining certification

X2 owns `scripts/build.mjs`, bundle gates, `.vscodeignore`, the host API
record, README, PRIVACY, CHANGELOG and PLAN. No shared gate or owned file
was changed to force a pass. The first host API check reported only these
Node import counts; X2 must regenerate and review the record:

| Built-in         | Previous | Lane O |
| ---------------- | -------- | ------ |
| node:buffer      | 27       | 28     |
| node:crypto      | 32       | 34     |
| node:fs          | 24       | 25     |
| node:fs/promises | 34       | 36     |
| node:path        | 65       | 68     |
| node:zlib        | 1        | 2      |

X2 must add the lazy `dist/teamRunners.js` factory, install the caller's
language table before construction, include `native/runner/` in the VSIX,
and measure its budget. The existing PowerShell gate scans only
`native/windows/`; X2 must extend its owned script to include
`native/runner/`. Its macOS skip cannot certify this Windows helper.
The lead's three-rig remote self-tests, native Windows execution and
scheduled-task fallback remain the lead's work, as the rig brief requires.
No real remote machine was contacted here.

Suggested shared documentation: explain the user-level runners file,
trusted-workspace requirement, fixed SSH options and host fingerprint,
snapshot transfer and exact lockfile caches, complete check output,
remote-slot retention after disconnect and process-group limitation, and
Windows launch/input self-test. Record the final lazy bundle sizes after
W/B/K/X2 bind the explicit interfaces above.

First resume action: bind K's journalled launcher and window-owned roots
to CheckSlots and SshRunner, and splice O's marked W/B regions into their
full files before adding X2's lazy factory and native packaging.

## Binary lockfiles and final validation

A new local regression test first failed: different invalid UTF-8 bytes
(255 and 254) collapsed to one decoded string and reused an install.
Both local and SSH caches now key on the snapshot's Git blob id, which
hashes the original binary bytes. The existing text/newline cases still
rerun setup as required. Deliberately reverting each lookup to decoded
`git show` output failed the named test and was restored byte-exact:

- local binary lockfile hash: hashes binary lockfiles without collapsing distinct invalid UTF-8 bytes; restored SHA-256 `c2583f0f8d42e18bd5bf17183ca8a748df4a8858c1cddf07f42ec1bc0511c156`.
- remote binary lockfile hash: pushes working edits and untracked files, streams exact output, caches setup and installs only by rename; restored SHA-256 `6bfd4f78cd2f72e469fa8dbf25e5335341873ae85bd7b16869314cf3ad951534`.

Final verification ran directly on macmini, one heavy tool at a time:

| Check                                              | Result                                                        |
| -------------------------------------------------- | ------------------------------------------------------------- |
| All five TypeScript projects                       | exit 0                                                        |
| ESLint on all owned TypeScript                     | exit 0, zero warnings                                         |
| Prettier on owned TypeScript and this record       | exit 0                                                        |
| Plain knip                                         | exit 0                                                        |
| jscpd                                              | exit 0, no duplicates                                         |
| Localization                                       | 14 tables, 120 manifest strings, 426 source files; 0 problems |
| Host API record                                    | exit 1; six Node import counts only, X2-owned update above    |
| Production build, size/split/globals/notices gates | exit 0                                                        |
| Bash syntax                                        | exit 0                                                        |
| Embedded C# 5 compile, offline installed SDK       | exit 0; native Windows APIs were not executed                 |
| PowerShell gate                                    | macOS skip; Windows analysis is pending                       |
| runnerRouting.test.ts                              | 10 passed                                                     |
| checkSlots.test.ts                                 | 9 passed                                                      |
| bridgeChecks.test.ts                               | 5 passed                                                      |
| sshRunner.test.ts                                  | 11 passed                                                     |

Total: **35 passing tests; 105 deliberate red drills**, including the
compiler drill. Every source mutation was restored with SHA-256 checked.
Vitest used at most three files and `--maxWorkers=3 --testTimeout=120000`;
no test-name filters, skipped tests, gate weakening or new dependencies.
Full `quality` remains X2's integration responsibility under the rig brief.

Existing built bundles: extension 590.7/600 KiB; Model API 430.2/475 KiB;
webview 866.2/900 KiB; shared UI fallback 110.5/125 KiB; checkpoint store
135.7/225 KiB; ACP 801.0/850 KiB. All other existing caps passed too.
These are the base's wired bundles; X2 must separately build and measure
the new lazy runner bundle after integration.

Owned implementation: runnerConfig/health/routing, SshRunner, CheckSlots,
the marked bridge and worker regions, both native helpers, four test files
and their shared finite-child helper. No file belonging to another lane
was edited. No model attempts, paid calls or real remote connections.

Final source SHA-256 values before hook formatting:

- `src/core/runners/runnerConfig.ts`: `9a99a0a33b339716cf492bf6480851fa126dc5f257456fd9eefbba352b4155bc`
- `src/core/runners/health.ts`: `0a653fa81bf72719cf472d853187a1ce8fcf974c6e3880fe3866b11965ba570b`
- `src/core/runners/routing.ts`: `3ccedc8ea745af68b0ed408132dcb5db032d67238bfdf2698e034f94084a0190`
- `src/host/runners/sshRunner.ts`: `6bfd4f78cd2f72e469fa8dbf25e5335341873ae85bd7b16869314cf3ad951534`
- `src/host/team/checkSlots.ts`: `c2583f0f8d42e18bd5bf17183ca8a748df4a8858c1cddf07f42ec1bc0511c156`
- `src/host/team/mcpBridge.ts`: `e902daf152cf1de8cb8015527ecc82b5681c7fa33ae1f24252aa38a1c7cbb9ab`
- `src/core/team/workers/engineWorker.ts`: `ce8cf358bfcfd21b10cb39575a66245ff12a8c8cb324fe6737293269cb89eeb4`
- `native/runner/runner-helper.sh`: `44a47d0991845401ec10633417a3363087f2b5a665da68a564b9189ff1ad823a`
- `native/runner/runner-helper.ps1`: `efb3620cedfc6bd83496774084dcc65d6105ab5cd1fa855c47093394d37783c7`

Final OS-label hardening: a Darwin runner advertising `os:windows` first
failed the Windows-routing case. Reserved `os:` labels now match the
runner's declared OS only. Removing that branch failed the same named test
and restored byte-exact SHA-256 `3ccedc8ea745af68b0ed408132dcb5db032d67238bfdf2698e034f94084a0190`.
The whole routing file then passed all 10 tests; host typecheck was rerun.

## RVM96CO repair — FIXM96CO (2026-10-05)

All seven RVM96CO P2 findings have implementation fixes; native Windows
certification remains explicitly pending. Findings 1–3 are fixed. The bridge performs common unsafe-path validation,
then builds and guards the exact scoped command for the selected runner's
OS (or the local OS on fallback). Hook rewrites retain final-command
admission; trust, cancellation and the authenticated attempt are checked
again before dispatch. Slots use `clone --no-local --no-checkout`, which
also prevents a source clone's alternates file from being copied. Snapshot
uncertainty is updated for each launched child before the next admission.
Missing proof and rejected transports still retain ownership.

Regression tests: `quotes scoped files for the declared runner OS and guards
the final command`, `refuses Windows-unsafe scoped paths on a Windows runner
from a POSIX host`, `owns persistent objects after the first task copy is
removed`, and `releases snapshot ownership on cancellation and Git failures
with proven retirement`. The real Bash/Node regression receives the exact
`test/O'Brien.test.ts` argument. The slot regression deletes task A's copy
before running task B and asserts there is no alternates file.

Deliberate drills ran the complete owned test files (no name filters):

| Finding | Mutation                                                | Named failure                                                                       | Restored SHA-256                                                   |
| ------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1       | Replace runner OS with host platform at scoped dispatch | Both destination-OS regressions above                                               | `f24ebbbe3788ec60744c5d2242eb38a53767384694d9ff775d160104dc00394d` |
| 2       | Replace `--no-local` with `--shared`                    | owns persistent objects after the first task copy is removed                        | `118dccd72117832bca41c8e0ebe81f579593a8fec5b38e27e069edc057dea75c` |
| 3       | Keep snapshot child uncertainty after proved retirement | releases snapshot ownership on cancellation and Git failures with proven retirement | `118dccd72117832bca41c8e0ebe81f579593a8fec5b38e27e069edc057dea75c` |

Each drill exited 1 and restored the exact original bytes with SHA-256
comparison. An initial finding-3 mutation targeted the ordinary command's
retirement assignment instead of the snapshot wrapper; existing lifecycle
tests caught it. The targeted snapshot mutation then failed the new test.
The first object-ownership regression also exposed Git's copied alternates
file when merely removing `--shared`; `--no-local` fixes that case.
Findings 4–7 are fixed in the second piece:

- **4 — setup timeout.** The surviving supervisor exclusively creates the
  cache lease, records its run ID and deadline/expiry, and removes it only
  after child retirement and an owner match. Setup cannot be killed between
  taking a lock and publishing its owner record. POSIX timeout/retry and
  foreign-owner preservation run against the real local helper; Windows
  ownership/cleanup is covered by source contracts pending native execution.
- **5 — output bytes.** The bundled helpers return canonical base64 in the
  strict `{ bytes }` boundary. Windows opens the live log with read/write
  sharing. The host rejects over-limit and rewritten raw bytes before
  decoding new bytes with a streaming UTF-8 decoder, flushed on the end
  marker. Partial `é` and emoji bytes survive polls without replacement or
  duplicated output. A leading UTF-8 BOM is retained, matching the prior
  byte-to-text behavior, and an incomplete terminal sequence is flushed
  only on retirement. Invalid bytes rewritten to different invalid bytes are
  rejected even when both snapshots would decode to the same text.
- **6 — Windows command length.** Before dispatch, the host checks the
  encoded command against the immutable 32,767 UTF-16-unit CreateProcess
  limit including its terminating NUL. Windows hosts also bound quoted SSH
  argv including the executable. Before allocation, the helper bounds the
  longer native `execute` invocation, which also bounds `job`; both C# launch
  functions check their exact native line. A native `commandTooLong` refusal
  is strictly parsed and translated; it is never treated as retirement.
  The schema-valid 179-character root / 8,000-character setup / 1,000-character
  check regression is rejected before start. An ordinary start still succeeds.
- **7 — statement separator.** `Initialize-RunnerJob` and the `execute`
  arguments assignment are separate statements. The real PowerShell parser
  test also inspects command ASTs, since the old line can parse as a command
  consuming assignment text without a syntax error. The Windows-only test
  runs real setup/check through the native job and asserts the exit marker.

The translated refusal requires the only shared-file changes: one immutable
constant, one English key and real translations in all 14 language tables.
No new dependency, manifest change, gate change, production fake or paid
call was introduced. No real SSH connection was made. The cross-OS bridge test executes real
Bash/Node on macmini and checks the exact sent command on a Windows test
host, where a Darwin shell is unavailable. The typed internal
length error keeps translation text out of control-flow classification.

Additional red drills (complete files, no test-name filters):

| Drill                                             | Mutation / regression failure                                                                                                           | Restored SHA-256                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| F4-timeout (remove supervisor cleanup)            | releases the owned cache creation lease after a setup timeout and permits retry                                                         | `4bcfb70d584d2381cb9bd6e7a57917fa010d4dd5fb4a68c6545c5beb249c5969` |
| F4-owner (omit owner match)                       | retains a cache lease whose recorded owner differs from the retired job                                                                 | `4bcfb70d584d2381cb9bd6e7a57917fa010d4dd5fb4a68c6545c5beb249c5969` |
| F4-Windows (remove native supervisor cleanup)     | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                                            | `39d0aafaa8477d90f9f07e6aa63a9bc7ca1cd83da6eed89074e65563dbf58d48` |
| F5-bytes (compare decoded text)                   | rejects raw output rewrites even when the decoded text stays identical; checks raw output prefixes and decodes split UTF-8 exactly once | `7c00db3bc5911f36b70079e04bf6b31b9d5ed2bbd6a9d6ed045cece46dc67bd5` |
| F5-decoder (disable streaming decode)             | checks raw output prefixes and decodes split UTF-8 exactly once                                                                         | `7c00db3bc5911f36b70079e04bf6b31b9d5ed2bbd6a9d6ed045cece46dc67bd5` |
| F6-transport (remove encoded transport bound)     | refuses oversized accepted Windows starts with a translated reason before dispatch                                                      | `7c00db3bc5911f36b70079e04bf6b31b9d5ed2bbd6a9d6ed045cece46dc67bd5` |
| F6-local (remove quoted local SSH bound)          | includes the local Windows SSH executable and quoted arguments in the launch bound                                                      | `7c00db3bc5911f36b70079e04bf6b31b9d5ed2bbd6a9d6ed045cece46dc67bd5` |
| F6-native (remove pre-allocation native bound)    | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification                                            | `39d0aafaa8477d90f9f07e6aa63a9bc7ca1cd83da6eed89074e65563dbf58d48` |
| F6-refusal (ignore native refusal)                | translates a native Windows command-length refusal without treating it as retirement                                                    | `7c00db3bc5911f36b70079e04bf6b31b9d5ed2bbd6a9d6ed045cece46dc67bd5` |
| F7-separator (join initialization and assignment) | separates Windows job initialization from the execute arguments assignment                                                              | `39d0aafaa8477d90f9f07e6aa63a9bc7ca1cd83da6eed89074e65563dbf58d48` |

Additional final-command/native-bound drills:

| Drill                                        | Named failure                                                                                | Restored SHA-256                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| F1-final-trust (omit trust recheck)          | rechecks trust, cancellation and refusal after the destination-command guard                 | `8549131d6abe7c83e97ff17e64e8b93c87bc28d70c3e84733dbd79dad340ed77` |
| F1-final-cancel (omit cancellation recheck)  | rechecks trust, cancellation and refusal after the destination-command guard                 | `8549131d6abe7c83e97ff17e64e8b93c87bc28d70c3e84733dbd79dad340ed77` |
| F1-final-empty (omit empty-command refusal)  | rechecks trust, cancellation and refusal after the destination-command guard                 | `8549131d6abe7c83e97ff17e64e8b93c87bc28d70c3e84733dbd79dad340ed77` |
| F6-CSharp (remove one exact C# launch bound) | keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification | `39d0aafaa8477d90f9f07e6aa63a9bc7ca1cd83da6eed89074e65563dbf58d48` |

Completion/attempt drills:

| Drill                                           | Named failure                                                                | Restored SHA-256                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| F1-final-attempt (omit final attempt admission) | rechecks trust, cancellation and refusal after the destination-command guard | `8549131d6abe7c83e97ff17e64e8b93c87bc28d70c3e84733dbd79dad340ed77` |
| F5-BOM (strip a leading BOM)                    | preserves a UTF-8 BOM and flushes incomplete final bytes only on retirement  | `7b868820ec6217412c23d1db8361f59db192680dc6503a3b88341b50ca9c0520` |

All mutations exited 1 and were restored byte-exact with SHA-256 comparison.
Windows drills are source/fake-transport assertions; they do not substitute
for the native Windows parser/runtime receipt.

Named residuals (also recorded in PLAN §9):

- **Native Windows certification pending:** this Mac has no `pwsh` or
  Windows parser assembly. `runnerHelperNative.test.ts` contains the parser
  test (runs wherever PowerShell is installed) and native job test
  (Windows-only). The lead must run both on Windows before certifying the
  runner. No Windows support claim is made by this repair.
- **Cache-creator supervisor loss:** an independently killed supervisor
  may retain its creation lease past expiry. Expiry never proves descendant
  retirement. Work remains busy, safely retaining exclusion; use a fresh
  user-selected root after manually retiring the old supervisor. Automatic
  reclamation requires native retirement-backed recovery in follow-up.

Final validation ran directly in this worktree on **macmini**, one heavy
process at a time. All Vitest runs used `--maxWorkers=3 --testTimeout=120000`
and at most three complete files; no test-name filter was used. Only the
explicitly requested native parser/kernel guards skip tests on this Mac.

| Check                                                     | Result                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| All five TypeScript projects                              | exit 0; host/unit checked again after final TypeScript changes                                         |
| ESLint on all nine changed TypeScript files               | exit 0, zero warnings                                                                                  |
| Plain knip                                                | exit 0                                                                                                 |
| jscpd                                                     | exit 0, zero clones; the duplicated health fixture was shared rather than weakening the gate           |
| Localization                                              | 14 tables, 120 manifest strings, 426 source files; 0 problems                                          |
| Host API                                                  | exit 1, exactly the six pre-existing X2-owned Node import-count changes listed above; record untouched |
| Production build and size/split/globals/notices gates     | exit 0                                                                                                 |
| Bash syntax                                               | exit 0                                                                                                 |
| Embedded C# 5 compiler, installed offline .NET references | exit 0; no native Windows API executed                                                                 |
| runnerRouting.test.ts                                     | 10 passed                                                                                              |
| checkSlots.test.ts                                        | 11 passed                                                                                              |
| bridgeChecks.test.ts                                      | 8 passed                                                                                               |
| sshRunner.test.ts                                         | 20 passed                                                                                              |
| runnerHelperNative.test.ts                                | 2 explicitly guarded tests pending PowerShell/Windows                                                  |

Total: **49 passing tests; 19 targeted red drills**, plus the earlier
ordinary-command retirement mutation described above. Every source
mutation restored its exact bytes and checked SHA-256. The BOM regression
also proves incomplete terminal UTF-8 is flushed only at retirement.

Built bundle sizes (unchanged caps): extension **590.7/600 KiB**, Model API
**430.2/475**, webview **866.3/900**, shared English UI **110.7/125**,
checkpoint **135.7/225**, ACP **801.0/850**. All other existing caps passed.
These are the base's wired bundles. X2 still owns the separate lazy runner
bundle, native packaging and full integration/quality certification.
Full `quality` was not run, as the rig brief expressly forbids it here.

The two native tests for the lead are named above and live in
`test/unit/runnerHelperNative.test.ts`. The parser AST check should run via
PowerShell 5.1 on Windows (or `pwsh` on a Mac where installed); the setup/check
job test requires Windows APIs. This rig has neither `pwsh` nor a Windows
parser assembly. Their guards are certification limits, not passing native
receipts.

Repair commits: first piece `060d47d8` (findings 1–3); the second piece is
this certification update and findings 4–7. Both use normal commit hooks.
No push, merge, rebase, new dependency, paid call, live model attempt, real
SSH connection, or credential read occurred. The host API mismatch and
supervisor-loss residual are recorded in PLAN §§7/9.

Final implementation hashes (drill hashes above identify the exact versions
restored during those drills):

- `src/host/team/mcpBridge.ts`: `8549131d6abe7c83e97ff17e64e8b93c87bc28d70c3e84733dbd79dad340ed77`
- `src/host/team/checkSlots.ts`: `118dccd72117832bca41c8e0ebe81f579593a8fec5b38e27e069edc057dea75c`
- `src/host/runners/sshRunner.ts`: `7b868820ec6217412c23d1db8361f59db192680dc6503a3b88341b50ca9c0520`
- `native/runner/runner-helper.sh`: `6820f2827f5265033414b885b63a31f57d03ff554fe29ab323e1480e0b31d478`
- `native/runner/runner-helper.ps1`: `39d0aafaa8477d90f9f07e6aa63a9bc7ca1cd83da6eed89074e65563dbf58d48`
