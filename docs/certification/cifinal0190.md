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

## 8. The vault's Expires box took any date the engine could guess

Real use of the packed product on Windows (Models & Agents → Vault → Add
to Vault → Named Secret): the box said only "Expires", and a wrong answer
was asked again with "That date is not valid. Leave it empty for no
expiry, or type a date.", which never said what a date looks like.
`readExpiry` stored whatever `new Date(answer)` parsed: "1" as 2001-01-01,
"12/1" as 2001-12-01, 2026-02-30 as 2026-03-02, a date alone as UTC
midnight and a date and time without a zone as local time, so an item
could be stored already expired, or off by the person's time zone. The
OAuth and session login expiry and the grant form's Expires parsed the same
way.

Fix: one reading, `readVaultExpiry` (`src/shared/vaultExpiry.ts`), for the
item's own expiry, the required login expiry and the grant form. Two shapes
only: YYYY-MM-DD, the start of that day in the person's time
(`new Date(y, m - 1, d)`, refused unless the day round-trips), or
YYYY-MM-DDTHH:MM with optional `:SS`, `.fff` and `Z` or `±HH:MM` (local
without a zone; the edit pre-fill's `toISOString()` form unchanged).
Anything else asks again with the typed text kept; a moment at or before
now asks again with "That date has already passed.", except an edit that
keeps the item's stored date. The prompts name both shapes, the item's own
adds "Leave it empty for no expiry."; English and all 14 tables.

Tests: the real `editVaultItem` through `VaultNativeInput`
(`vaultNativeEditor.test.ts`: "1", "12/1", "next tuesday" and 2026-02-30
asked again with the shape sentence and the text kept; a past date and the
seam clock's own moment asked again with the passed sentence; local
midnight, local time, a `Z` and a `+05:30` instant stored; an expired
item's pre-filled date kept on edit while another passed date is refused;
OAuth and session refuse empty); the helper in UTC, America/New_York,
Asia/Kolkata, Pacific/Kiritimati and Pacific/Pago_Pago with `TZ` set for
the suite as `l10n.test.ts` does (`vaultExpiry.test.ts`); the real grant
form in jsdom (`vaultGrantExpiry.test.tsx`).

Break on purpose, one exact replacement each, suites `vaultNativeEditor`,
`vaultExpiry` and `vaultGrantExpiry` (43 cases), the file restored byte for
byte (sha256 checked) after each:

| Break                                                          | Exit | Failed |
| -------------------------------------------------------------- | ---- | ------ |
| The engine's guess back in `expiryInstant` (`new Date(typed)`) | 1    | 21     |
| The kept-date exception removed                                | 1    | 6      |
| The passed check removed                                       | 1    | 8      |
| The zone dropped before `Date.parse`                           | 1    | 10     |
| The OAuth/session expiry accepts empty                         | 1    | 2      |
| The grant form skips the refusal                               | 1    | 1      |
| The grant form reads the picker's value as UTC                 | 1    | 1      |
| The grant form sends an empty box to the reading               | 1    | 1      |

Every new case failed in at least one row. Restored: 43/43, exit 0; with
`vaultGrantHints` 45/45.

`windowsVaultPanelFlow.test.ts` still scripted the Add dialog in its order
from before VAULTTARGET's Target picker: its second pick
(`askEveryTime`) went to the picker and `keep` to the mode, so the flow
ended in "The vault operation failed. Try again." and `service-key` was
never added. Its script now follows the current order (Target: nowhere
yet, then no expiry); the old and new scripts were run against the real
`editVaultItem` (old: that failure; new: the `apiKey` item with every
answer used). The suite itself, the other Windows broker and pipe suites
and `writerCrashPosix` cannot build their helper on this PC: its Temp and
profile folders grant Modify to `CodexSandboxUsers` and another SID, so the
guard refuses both (`Bootstrap command failed (code=23)`) before any case
runs. `brokerSocketDirectory`'s two symlink cases need Developer Mode
(`EPERM … symlink`). Hosted Windows CI decides all of them.

Gates on this tree (Windows): `prettier --check` and
`eslint --max-warnings 0` on the touched files 0 and 0; `npm run typecheck`
0; `npm run check:catches` 0 (no count moved); `npm run duplication` 0 (0
clones); `npm run cycles` 0; `npm run deadcode` 0;
`node scripts/check-l10n.mjs` 0; `node scripts/gen-reference.mjs --check`
0; `npm run check:roadmap` 0. `npx vitest run test/unit/vault` 1: 268
passed, 59 skipped, and the six files above refused in their setup.
`npx vitest related src/host/vault/vaultNativeEditor.ts --run` 1:
`vaultNativeEditor` 15/15, `windowsVaultPanelFlow` refused at its helper
build. `npm run build` 1, at `check-bundle-split` only: its eight "no
longer carries node_modules/…" lines come from `node_modules` being a
junction (the metafiles read `../mx-final/node_modules/…`); the build and
all 199 budgets passed, `dist/vaultActions.js` at 25,504 of its 25,600
bytes.
