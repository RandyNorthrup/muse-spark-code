# RLF-TEMPLEAK — temp trees whose owner died are reclaimed

2026-10-30, macbook rig (macOS 15, x86_64), base `int/recovery` dfcb45936.
Found by the lead in real use: under `<data>/Muse Spark Code/resource-created/`,
every finished ACP lane left `trees/muse-tree-*` (50–520 MB) at
`"kind":"temp","state":"created","endedAtMs":null` long after its processes
exited; one sandbox held 15 such entries. Disk filled to 4.6 GB free.

## Cause (confirmed in code)

1. `CreatedRegistry.removeEntry` returned false when
   `entry.endedAtMs === null && entry.state !== 'pending'` after the exit
   proof. `endedAtMs` is set only by `finish()`, which a killed, crashed or
   powerless host never calls.
2. No later start could prove the exit at all: the production
   `proof.exited(owner)` reads the _current_ process's retired set
   (`ResourceLaunchHost.hasRetired`), and an entry's owner is a per-work
   random UUID. Even a properly finished failed tree (kept 24 h by design)
   was therefore unreclaimable by any later process.
3. Nothing swept at start. `clean()` ran only on governor pressure changes
   and on a per-process 24 h timer after a failed finish — the timer dies
   with the process.
4. The VS Code window passed no `registryFile`, so its governor used a fresh
   random manifest per window under the OS temp folder; its trees were not
   in any registry a later start reads.

Normal-exit inventory: per-work `finish()` runs on every observed tree exit
(`ResourceLaunchHost` retire → `TreeTempRoots.finish` = registry finish +
release). Host disposal calls it too: the ACP agent on stdin close
(`connection.closed` → `resources.dispose()` in `src/runtime/main.ts`), the
VS Code window through `configureResources`' disposer, the CLI/exec through
`processResources.dispose()`. Disposal is fire-and-forget async and macOS has
no native tree-gone binding, so a tree whose exit was never observed stays
unended by design ("left for recovery") — recovery is the sweep below.
SIGTERM paths that run disposal behave the same; SIGKILL and power loss run
nothing.

## Fix

- An entry names its creating process (`creator`: host, pid, birth; Linux
  boot id), read by `currentProcessOwner` at creation. `creatorExited` is
  the locks' `isProcessOwnerGone`: gone only when no process has the pid,
  the pid's birth differs (reuse), or the boot changed; anything unreadable
  proves nothing. All identity, marker, confinement, quarantine and
  archive/clean checks are unchanged; `worktree`/`dependencies` still need
  the archive proof.
- The sweep ends a proven-gone unended `created` entry at proof time
  (`endedAtMs` = the sweep's clock, `failed` = true, persisted), so a temp
  tree is still kept `RESOURCE_TEMP_KEEP_MS` (24 h) for diagnosis, then
  removed by a later sweep. `clean()` first reloads the live manifest, so a
  sweep visits every entry, including other processes'.
- Every governor host sweeps at start (`resourceGovernorHost`, shared by the
  VS Code window, the runtime's ACP/CLI/exec host and the vault broker),
  reporting through `onCleanup`/`onError`. No new timer: the existing cleans
  (pressure change, post-failed-finish) are the continuing cadence.
- The VS Code window shares the persisted agent-data registry
  (`<agentDataFolder>/resource-created/registry.json`), one registry for
  every host on the machine.
- Sweep outcomes are said in the log in the editor and the runtime
  (`resourceCleanupRemoved` / `resourceCleanupRefused`, all 15 tables;
  never a path or entry id).
- Entries written before the creator field carry no exit proof and are left
  in place (reported only by staying); sizes and counts are never capped.

## Proof — real processes (durable suite)

`test/unit/createdRegistryReclaim.test.ts` (child bundle
`createdRegistryReclaimEntry.ts`, driver
`test/hosts/created-registry-reclaim-worker.mjs`): a real child process
creates a tree through the real registry and the product's native commands;
a fresh registry in the parent sweeps with the product's process-owner
proof; the keep period is driven through the registry's existing `now`
seam. No credential store involved.

- Killed creator (SIGKILL mid-hold): manifest shows `created`/`null`; first
  sweep ends it failed at the sweep clock and keeps the tree; past the keep
  period the next sweep removes tree and entry. **Pass.**
- Live creator: sweep at a clock past any keep period touches nothing;
  entry stays `created`/`null`, tree intact. **Pass.**
- Creator finished as failed then exited: next start keeps it for the keep
  period, then removes it (cross-process reclaim of an ended entry). **Pass.**
- Wrong marker after creator exit: sweep reports the entry in `refused`,
  removes nothing, entry stays. **Pass.**

Red before the fix: the same suite on the base failed 3 of 4 (killed,
finished, marker — nothing was ended, attempted or removed), exit 1.
Green after: 4 of 4, exit 0.

Drills (break on purpose, restore byte-exact, `git diff` empty after):

- Drill A: restore the old `return false` for unended created entries →
  killed and marker cases fail, exit 1 (2 failed, 2 passed). Restored.
- Drill B: drop the creator clause from the gone proof → killed, finished
  and marker cases fail, exit 1 (3 failed, 1 passed). Restored.
- After restore: 4 of 4 pass, exit 0.

Neighboring suites after the change: `resourceCreatedSweep` 4,
`createdRegistrySaveErrors` 3, `createdRegistryRace` 1,
`createdRegistrySpaces` 2 — all pass. (Spaces needs a C compiler; this rig
is Command-Line-Tools-only, so `test/unit/helpers/createdNative.ts` now
passes `DEVELOPER_DIR` through to `/usr/bin/cc` when set.)

## Proof — packed product, two starts

`npm run build`, `node scripts/package-acp.mjs --target darwin-x64`
(the universal package needs Linux/Windows helpers this rig cannot build),
installed into an empty folder under `temp/templeak-real/`. Fresh `HOME`
(fresh agent data folder and registry), empty workspace; `XDG_DATA_HOME`
kept on the lane's existing Muse Code sign-in — no credential was read,
copied or stored. The agent ran with `--trust-workspace` and
`--shell-sandbox off` because `sandbox-exec` itself is denied inside the
lane sandbox (`sandbox_apply: Operation not permitted`, exit 71), the same
way this rig runs the product; approvals were answered by the driver as an
editor answers them. The session model was set by name and verified before
any prompt: `muse-spark-1.3-contributor`.

- First start (pid 24387): one turn ran
  `printf templeak > "$TMPDIR/templeak-payload.txt" && sleep 120`; the
  registry held the in-flight entry (`creator.pid` 24387, `created`,
  `endedAtMs` null) with the payload inside the tree. The agent was killed
  with SIGKILL; the registry stayed exactly as the leak left it.
- Second start (pid 24576): one turn (`echo templeak-second`, `end_turn`),
  then stdin closed; the agent exited 0. The killed entry then read
  `"endedAtMs":1793409626889,"failed":true` — ended by the second start's
  sweep at proof time, tree kept for its diagnosis day. Removal after the
  keep period is the unit proof above (24 h is not waited out here).
- The second turn's own tree stayed unended after the normal exit (macOS
  cannot observe that tree gone at disposal; left for recovery as before)
  — the next start's sweep ends it the same proven way.

Requests, counted from the product's own records: the final two-start
sequence made **3 model requests** on `muse-spark-1.3-contributor`
(the fresh home's `usage --json`: 1 for the killed turn, 2 for the second),
all served as `muse-spark-1.3-contributor`. Five earlier diagnostic
attempts in wiped homes (untrusted workspace, sandbox-exec denial) made
1–2 requests each on the same named model (Muse sessions
`01a18f7c…`, `01a18f7f…`, `01a18f82…`, `01a18f85…`, `01a18f87…` under
`$XDG_DATA_HOME/muse/sessions/2026/10/30/`), at most 11 nested requests in
all. None was sent on any other model: the driver refuses to prompt unless
the session's current model is the named one.

## Gates (this rig, repository timeouts)

Recorded with the lane's final message; see the commit list there.
