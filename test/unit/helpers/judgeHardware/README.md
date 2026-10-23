# judgeHardware fixtures (M125 lane H)

Parser inputs for the hardware scan. Each file names its provenance:
recorded bytes, an M98 capture, a public standard, or a documented
tool format. Documented-format samples (marked below) are replaced by
a rig capture when one lands — PLAN.md §3 tracks each.

| File                      | Provenance                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| cpuinfo-linuxlt.txt       | Recorded: `/proc/cpuinfo` on linuxlt (i7-10510U, 8 cores), 2026-10-22                                                                                                                                                          |
| nvidia-smi-cuda.csv       | MARKED documented format: `nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader,nounits` per `nvidia-smi --help`, the M107 sampler's identical live flags; values shaped like the owner's GTX 1080 Ti |
| sysctl-leaf7.txt          | MARKED documented format: `sysctl -n machdep.cpu.leaf7_features` on darwin/x64 (Apple sysctl; AVX2/AVX-512 tokens per the Intel SDM CPUID leaf 7)                                                                              |
| cim-video.json            | MARKED documented format: `Win32_VideoController` Name/DriverVersion as PowerShell `ConvertTo-Json` renders it                                                                                                                 |
| ollama-version-stdout.txt | MARKED documented shape: `ollama --version` stdout; the 0.35.1 version matches M98's captured pin                                                                                                                              |

The Ollama wire bodies (`/api/version`, `/api/tags`, `/api/ps`) are
parsed from M98's captures directly
(`test/unit/fixtures/localJudgeCapture.json`,
`test/unit/fixtures/localJudgeSystemOneCapture.json`), not copied here.
PCI vendor ids in tests are PCI-SIG assignments (0x10de NVIDIA, 0x1002
AMD, 0x8086 Intel), and the sysfs layout is this rig's own
(`/sys/class/drm/card1/device/vendor` reads `0x8086`).
