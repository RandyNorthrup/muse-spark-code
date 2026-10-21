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

## 3. macOS session-broker cases timed out (macos shard 7)

Cause: the suite forks its client with only `HOME` (the fixture root) and
`XDG_RUNTIME_DIR`. The product forwards `TMPDIR` too
(`posixClientPlatform`), but the fixture's client had none, so the broker's
temporary root fell to `/tmp` (world-writable, refused as a socket base)
and then to the fixture HOME, whose socket path under `/var/folders/...`
exceeds the bind limit: `assertVaultSocketLength` refused ("The broker
cannot start") and three cases waited out the test clock. Found with a
diagnostic run on the mirror (client and broker failures printed) and
reproduced on the macmini with its default `TMPDIR`; the earlier lane ran
with `TMPDIR=/tmp/bmt`, where the fallback fits.

Fix: the fixture passes the worker's `TMPDIR` to the client as the editor
host has it. macmini, default `TMPDIR`: 3 red without the change, 4/4
green with it.

## 4. Windows integration teardown (VS Code 1.142)

`unsaved buffers refuse memory writes (D27)` failed in its after-all hook:
`EBUSY: resource busy or locked, rmdir …\.agents\memory\notes` right after
closing the editors. The teardown now uses `removeFolder`, the retrying
removal the unit suites use for the same Windows behaviour.

## 5. check:catches after the Windows real-use fixes

Passing the error to `onError` from four governor catch sites moved them
from SWALLOW to GENERIC, and `clearMarker` copied two catch sites. The
governor sites went back to their accepted form and the journal's marker
removals share one method; no count rose, so the baseline was regenerated
(615a0ae396).

## 6. Two Windows timing failures on 6d580d2cdf

- `questionDeferLongWait.test.ts` (lane NOLIMITSQ) waited a fixed 50 ms for
  the registry's file-store work after each timer piece; a loaded Windows
  runner finished later, and the deferral read as missing. The test now
  waits on the registry's own events (a timer armed, a deferral delivered,
  a change published), never on a clock of ours. 3/3 green locally.
- Integration `schedule background entry in the real host`: its teardown
  hit `ENOTEMPTY` removing the governor folder right after disposal. Every
  recursive removal in `test/integration` now uses `removeFolder`, the
  retrying removal the unit suites use, instead of fixing them one flake at
  a time.

## 7. The bad-value answer pointed at a help command no one can run

Real use of the packed agent (win32-x64, 5646155a6b + VAULTTARGET +
LEASEFIX): `muse-spark-code-acp --questions-defer-after abc` answered
"Invalid value for --questions-defer-after; run serve --help for the
accepted values and bounds." with exit 2. `serve --help` is not a command
a person can type; the unknown-option answer beside it already names
`muse-spark-code-acp serve --help`. Every topic's bad value now names the
full command, and exec's separate copy of the sentence is gone (its 15
table entries removed).

- Break on purpose: `test/unit/cliArgs.test.ts` now requires
  `run muse-spark-code-acp <topic> --help for`; on the old helper it failed
  (1 failed | 10 passed, exit 1), green after the fix (11/11; with
  cliHelp, cliHelpConsistency and execArgs 151/151).

## 8. The vault logged a failure each time its panel opened

Real use on Windows (separate VS Code, packed win32-x64 build): every first
open of Models & Agents → Vault wrote `Vault operation failed: Error` to the
extension log, with no toast and a correct panel. Traced through the
extension host's inspector: the panel's first load is overtaken by the
broker's own events, so its generation check throws "The use changed after
approval"; the failure path already kept that retirement off the screen
(the newer operation owns the view), but the queue logged it as a failure
first. One predicate (`isRetiredByBarrier`) now decides it for the
screen and the log alike.

- `test/unit/vault/windowsVaultPanelFlow.test.ts` gains a reload
  overtaken by Lock and requires a log with no failure: red on the old host
  (5 × `Vault operation failed: Error`, exit 1), green after (exit 0).
- The same suite still typed `[]` into the Target step that VAULTTARGET
  made a picker (the suite runs on Windows only, so the Linux lane did not
  see it); its scripted answers now pick "Nowhere yet".
- This PC's `%TEMP%` grants Modify to `CodexSandboxUsers` and an unknown
  SID (added by other software), so the vault guard rightly refuses to
  build helpers under it, and every Windows vault suite stops at its
  fixture with `code=23` here. Local runs use `TEMP`/`TMP` pointed at an
  owner-only folder; hosted CI is unaffected.
