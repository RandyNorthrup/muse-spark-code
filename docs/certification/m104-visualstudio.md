# M104g — Visual Studio receipt

Recovery lane RLF-M104G. Base: main at 0.19.0 (`4ecbbd9cc5`). Rig: `macmini`
macOS 15.7.4 Intel (worktree `/Users/randy/lanes/RLF-M104G`). No pushes,
paid calls, live model calls, or credential reads. Date: 2026-10-23.

**Status: pending.** The runner refuses here with:

`MHP_CONFORMANCE_PENDING: Windows with Visual Studio 2022/2026 (VSSDK
workload) and the experimental instance`

There is no .NET SDK on this Mac and the harness needs Windows with the
VSSDK workload regardless. The `Test/` project holds unit tests
(`ProtocolTests`, `PanelCarrierTests`, …); no MHP conformance cases driving
the shared suite exist there. This row moves when they exist and run green
in the VS experimental instance on Windows.
