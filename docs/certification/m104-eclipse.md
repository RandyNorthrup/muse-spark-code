# M104 — Eclipse receipt

Lane RLF-HOSTSLAND. Base: int/recovery 0a5ebd7189. Rig: linuxlt. No pushes,
paid calls, live model calls, or credential reads. Date: 2026-10-30.

**Status: waiting — the 9 runnable legs are green, 13 legs wait.**
`node test/hostApi/run.mjs eclipse` exits 0 (Tycho under Xvfb, Maven
3.9.11, JDK 21). The full `mvn verify` is 59/61; the two failures need
WebKitGTK, which this rig does not have. Record: `m104-eclipse.json`.
The scripted runtime.py peer is deleted.
