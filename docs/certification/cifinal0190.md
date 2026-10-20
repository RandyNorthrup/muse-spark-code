# CIFINAL0190 — hosted CI on the final 0.19.0 tree (bc71fc506b)

Hosted run 39474751738 (scnetsolutions/muse-spark-code-ci, `ci/pr-237`)
on bc71fc506b: Forks, Hosts and Browser check green; nine unit shards red.
Each red has its own row below; product defects went to their own lanes
(WINPSMOD, SKILLROOT, BROKERMAC) with their own records.

## 1. `webviewBundleRoot.test.ts` read the checkout's dist (all three OSes)

Cause: the suite (VSIXWEB) read real webview build output from
`dist/webview` of the checkout at module load. A unit job builds nothing,
so the file failed to collect: `ENOENT: no such file or directory, scandir
'dist/webview/chunks'` (ubuntu shard 1, windows shard 2, macos shard 2).
It passed on rigs only because a developer build had left `dist/` behind.

Fix: the suite joins `PRODUCTION_BUILD_SUITES`
(`test/unit/helpers/productionPackage.ts`), so the once-per-run shared
production build (`test/unit/globalSetup.mjs`) is made for it, and it reads
`main.js`, `main.css` and the first content-hashed chunk from that build
through `inject(PRODUCTION_BUILD_KEY)`, never from the checkout.

Red/green (linuxlt, fresh worktree at bc71fc506b, no `dist/`): base suite
red with the same ENOENT; with the fix 7/7 green. This PC with the
checkout's `dist` moved aside: 7/7 green from the shared build.

## 2. `elicitationHookSeam.test.ts` used a hand-written process runner (ubuntu shard 4)

Cause: the suite ran hook scripts through its own `spawn('/bin/sh')`
runner, standing in for the product's hook process entry. Its stdin write
had no `error` listener, so a hook that exits before reading its payload
raised an uncaught `write EPIPE` (Vitest "1 unhandled error", the run
red). The product's runner (`runCommand` in `src/host/backend/toolIo.ts`)
already listens for that error ("A hook may exit before consuming stdin.
EPIPE must not crash the host.").

Fix: the stand-in is gone; the suite runs every hook through the product's
`runCommand` with the product's `hookEnvironment`, the payload on stdin and
`HOOK_OUTPUT_MAX_BYTES`, as `runHook` in toolIo does (only resource
admission and the Windows job object, which the host adds around it, are
absent on these POSIX cases).

Green: linuxlt 18/18. The red is the hosted run's uncaught EPIPE above
(timing-dependent: the hook must exit before the write lands).
