# M104 — JetBrains receipt

Lane RLF-HOSTSLAND. Base: int/recovery 0a5ebd7189. Rig: linuxlt. No pushes,
paid calls, live model calls, or credential reads. Date: 2026-10-30.

**Status: waiting — the 9 runnable legs are green, 13 legs wait.**
`node test/hostApi/run.mjs jetbrains` exits 0 against the production
runtime (`dist/acp.js panel --stdio`) through the production bridge;
the full Gradle suite is 52/52 and the host's node suites are 17/17.
Record: `m104-jetbrains.json`. The scripted python peers are deleted;
their claims are in `docs/real-life/unproven.md`.
