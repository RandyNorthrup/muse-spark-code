# WINTEAM — hosted Windows team repair

2026-10-07, kubuntu; branch `fix/0150-winteam`, base `ccce6e6ac`.
The rig brief and `_ctx/codex/common.md`, `CI0150-common.md`, `WINTEAM.md`
authorize scoped direct verification and local hooks-on commits. Full quality
and the actual hosted windows-latest probe remain the lead's gates. No Windows
native execution, push, merge, paid/live model call, dependency or gate change.

## Causes and repairs

- `teamNativeLifetime`: hosted confirmation timeouts precede EBUSY cwd removal
  and EPERM DLL removal. The launcher used unqualified `ConvertFrom-Json`,
  triggering cold PowerShell module discovery. Pass safely quoted string arrays
  directly to the existing native `RunTeam` method. The retirement path also
  returned immediately when no control pipe had connected: terminate our owned
  helper and await `close`, retaining uncertain descendants without END proof.
  Windows-control tests model a loaded DLL lock and assert that both END and
  helper closure precede cleanup. Existing job ownership and journal fences stay.
- `teamWorkerFence`: the captured failure is the native path helper's existing
  five-second timeout. Replace `New-Object` with a .NET constructor and qualify
  Utility's Add-Type/ConvertTo-Json so discovery searches only that named module.
  The native inode/volume root comparison already resolves path spellings; a
  new disjoint short-name test proves admission and replacement-root refusal.
- `teamHintsAndLoad`: native hooks run several unqualified PowerShell commands.
  Use .NET constructors and qualified Add-Type. The owner-only-folder hook now
  prepares/verifies the folder via advisory rather than unnecessarily publishing
  a file (two helper starts reduced to one). Publication/ACL/handle assertions
  remain in the separate native security fixture. `assertHintPath` also mistook
  native short/long names for a changed path: compare native realpath spellings
  and check every ancestor with lstat before accepting a spelling difference.
  Links/junctions and a different resolved folder still refuse; separators are
  normalized for comparisons. Missing file tails remain checked on disposal.

## Regression receipts

- Original complete three-suite Linux baseline: 3 files, 94 tests passed;
  repository deadlines, three workers, 10.51 seconds.
- Against original product code: complete hints/control files failed four new
  cases (short spelling, slow discovery, DLL lock, team JSON cmdlet); 23 passed.
  Complete worker-fence file failed its new helper-discovery assertion; 53 passed.
- First repaired hints/control/worker batch: 3 files, 81 tests passed at default
  deadlines. Subsequent final receipts and byte-exact drills are recorded below.

## Verification scope

All runs use repository deadlines and at most three complete files/three
workers. No testTimeout override, skipped new test, retry or assertion weakening.
Clean CI verification removes ignored outputs with the CI brief's authorized
`git clean -xdf -e node_modules`; source and this record are staged first so
they remain tracked. Hooks are recreated from the repository using husky after
cleaning. Final static/build receipts and three-run results follow below.
