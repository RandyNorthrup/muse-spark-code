# PR #51: Android/Termux regression tests

Contributor commit `29fe2d8a111e5424c69c3ad0e7328b53a98646af` adds four cases
in `launch.test.ts` and `helperLocation.test.ts`, preserving existing behavior:

- Android PATH discovery and the Termux home fallback, including missing CLI.
- Android credential location honoring `XDG_CONFIG_HOME`.
- No bundled dictation helper on Android.
- No Linux recorder offered on Android even when `arecord` is found.

Read-only review confirmed the test scope and actual implementation branches.
The original contributor head passed all seven CI jobs in run `36381716502`.
Those results are historical; the current-main integration needs its own gates.

Current proof: pending focused tests, intended red/restored drills, staged secret
scan, independent review, full quality and Windows host/VM, Mac and Kubuntu
checks. These tests simulate Node's Android platform and filesystem probes;
no physical Android/Termux installation or microphone has been tested.

Focused current-main verification on Windows passed all **35 tests** in
the two affected files. Four production mutations each failed an intended
assertion with exit 1: Android routed through Windows discovery, Android
XDG config ignored, a bundled Darwin helper offered on Android, and Android
admitted to the Linux recorder path. Every baseline/restored run exited 0
and production source SHA-256 matched before/after. Evidence and recipe are
outside the checkout at `muse-goal-evidence-20260929/pr51-android-drills/`.
Full quality, platform and hosted proofs are still pending; no device or
microphone claim follows from these simulated-platform cases.

The integration preserves contributor ancestry and includes current main's
PR32, M67 and M69 code plus verified M79 head `0ec35c76`, without changing
those product files. Before final gates, the staged comparison against
that next-main candidate is limited to the two test files and the scoped
changelog, plan and certification records. M79 must merge before this PR
lands, and final main ancestry must retain the tested content. The
pending normal merge retains its original parent; current-main ancestry
will be joined normally after verified content is committed, with tree
equality checked before the second commit. No branch history is rewritten.
