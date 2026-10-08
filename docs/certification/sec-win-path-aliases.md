# SECWINPATH — Windows path alias security repair

2026-10-08, Windows 11 rig `win11`, branch `fix/win-path-aliases`, base
`67099ce1b34c9f5d6bc61cef379508e1e3407817`. Audit:
`AUDITWINPATH.report.md` (2026-10-08). Model attempts: **0**. No paid/live
calls, elevation, share creation, ACL/permission changes, merges or push.

## Implementation

- `src/core/windowsPathSpelling.ts` is the shared refusal for Windows
  namespaces, UNC outside a UNC workspace, streams, reserved devices (including
  superscript COM/LPT digits and spaces before extensions), and trailing dots
  or spaces. It never rewrites a refused spelling. POSIX backslashes remain
  filename characters. Navigation components still pass ordinary confinement.
- Workspace admission checks raw normalized input before `path.resolve`; UNC
  workspace targets also require proven native ancestry. Worker admission and
  handle-bound ACP read/write use the same refusal before opening the target.
  Held-tree admission retains its additional git/name/collision restrictions
  and uses the shared reserved-name list.
- Muse Code `fileAccess` write approvals with flagged spellings are protected.
  The real mapper removes persistent approving choices on both requested and
  updated frames; automatic edit and Auto review gates independently refuse
  them even with a false mapped flag. The captured frame remains the one from
  `protect-agent-folders.md` (workspace `protect-live/ws2`, 28 original counted
  model attempts); these are adversarial substitutions, not new wire captures.
- `src/core/pathIdentity.ts` walks the destination's nearest existing ancestor
  to its namespace root and compares exact native identities through the
  existing `src/core/fs/fileIdentity.ts` sampler. Checkpoint storage includes
  journals/blobs, not only `shadow.git`. Unknown exclusion refuses writes;
  unknown UNC hold proof retains the hold. Missing DOS storage roots reserve
  their literal descendants until the root exists; no UNC fallback guesses
  an identity. The existing canonical separation check now uses native ancestry.

## Native oracle

Every fixture was an owned temporary folder removed afterward. Node `stat`
uses `{ bigint: true }`; volume serial and file index are compared exactly.
`test/unit/helpers/secWinPathOracle.ps1` calls `GetFullPathNameW`, `CreateFileW`
and `GetFileInformationByHandle`. The test sends trusted script text as a
PowerShell command because Windows PowerShell's script-file execution is
disabled on this rig; no execution policy is changed. Expensive preparation
is in the default-timeout `beforeAll`, with no deadline override.

| Spelling of an existing fixture                     | Native result on this rig                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Ordinary `AGENTS.md`                                | Volume `4262757232`; nonzero native file index                                              |
| `AGENTS.md.`                                        | Win32 open has the same identity; Node `stat` returns `ENOENT`                              |
| `AGENTS.md `                                        | Win32 open has the same identity; Node `stat` returns `ENOENT`                              |
| `AGENTS.md::$DATA`                                  | Both Win32 open and Node `stat` have the same identity; read returns original bytes         |
| `.claude./settings.json`                            | Win32 open has the ordinary settings file's identity; Node `stat` returns `ENOENT`          |
| `.claude /settings.json`                            | Win32 error 3 (path not found); Node `ENOENT`; refusal remains conservative                 |
| `\\?\<DOS file>` and `\\.\<DOS file>`               | Node `stat` has the ordinary file's exact identity; native realpath returns DOS spelling    |
| `\??\<DOS file>`                                    | Node `ENOENT`; no claim of native equivalence                                               |
| `\\localhost\C$\<fixture>`                          | Accessible without changing permissions; exact DOS `dev`/`ino`; native realpath retains UNC |
| `\\127.0.0.1\C$\<fixture>`                          | Accessible without changing permissions; exact DOS `dev`/`ino`; native realpath retains UNC |
| COM/LPT superscript variants, `aux .md`, `NUL .txt` | Node `ENOENT`; no claim of device I/O or a hang                                             |
| Junction to storage, missing journal leaf           | Native ancestor identity catches storage despite different spelling                         |
| Junction/loopback window into a held folder         | Native ancestry retains the hold; loopback workspace/storage overlap is refused             |

Administrative shares were already available: neither an elevated helper nor
a test share was needed. Different SMB volume/file IDs and unreadable identity are
tested with explicit injected failures; they retain protection, not a guessed
DOS mapping. Actual SMB returned matching identities on both loopback hosts.

## Base failure proof and unchanged controls

| Audit finding                                                           | Status and production location                                                                                                    | Regression                                                                                                                                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| P2 raw MSP DOS aliases bypass automatic/persistent protection           | Fixed: `src/core/protectedPaths.ts:63`, reused by the existing mapper and both answer gates                                       | `secWinPathAliases.test.ts`: twelve captured requested/updated subjects, false flags, automatic answers and standing choices                  |
| P2 checkpoint guard compares storage spelling                           | Fixed: `src/host/checkpoints/checkpointStore.ts:1969`, `checkpointHost.ts:241`, shared native ancestry                            | `secWinPathAliases.test.ts`: all three writer adapters, junction journals with missing leaves, unreadable exclusion                           |
| P2 candidate loopback UNC can release a held worktree / overlap storage | Fixed and measured: `src/core/worktreeConversations.ts:154`, `src/host/checkpoints/shadowGit.ts:156`                              | `secWinPathAliases.test.ts`: both loopback hosts, junction holds, separation, unknown SMB volume; native oracle confirms identities           |
| P3 incomplete reserved-device refusal                                   | Fixed: `src/core/windowsPathSpelling.ts:5`, `workspacePath.ts:118`, `team/workers/workerFence.ts:238/:279`, `git/heldTree.ts:104` | `secWinWorkerPaths.test.ts`: eight previously admitted names through worker and both ACP handlers; workspace table; unchanged held-tree suite |

The spelling table in `secWinPathAliases.test.ts` includes every audit refusal
input: both extended/device separator forms and bare device roots, NT prefix,
both loopback UNC hosts, default/named streams and device colons, ordinary and
superscript devices, `.git` trailing-dot/space final/intermediate segments,
and trailing characters in absolute and relative parent components. The mapper
table also covers `.claude.`, `AGENTS.md.`/space/default stream, prefixed and
UNC journal paths, `checkpoints.` and `shadow.git.`. `PROGRA~1/x`,
`GIT~1/config`, `.GIT\\config` and `.Git/hooks` retain textual admission;
canonical confinement/protected-folder rules still judge their actual target.

The first regression file ran directly against unchanged `67099ce1b`: **16
failed, 1 passed**, exit 1. The complete regression files were copied into an
owned base clone and used the worktree's existing dependency install read-only:
**25 failed, 1 passed**, exit 1. Native characterization and POSIX controls
intentionally describe platform behavior and pass on the base; they are not
claimed as failing security regressions. Additional unknown-identity cases
are included in the final base replay below.

The final complete replay (three new files, including native characterization)
on `67099ce1b` yields **28 failed, 3 passed**, exit 1. The three positive
controls are POSIX spelling behavior and the two native oracle measurements.
Every new security regression fails there. All **31 tests pass** after repair
at repository deadlines. The UNC-junction regression also proves that the
ancestor walk follows native realpath after crossing a junction, rather than
following the junction's lexical parent back into the workspace.

The existing protected-folder suite was first run unchanged: **13 failures**
in `museCodeProtectedWrites.test.ts`, all due to its prefixed ordinary-path
controls becoming protected under the owner's new namespace policy. Only
those ordinary controls now use the same DOS workspace without the verbatim
prefix. Every assertion and all protected-folder cases are retained; new
mapper regressions assert manual once-only decisions for prefixed paths.
`permissions.test.ts` and `modelApiHost.test.ts` remain unchanged.

## Drills and fresh-clone verification

The final receipts below record full-file runs, repository deadlines, at most
three files and three workers, byte-exact mutation restoration, normal hooks
and the fresh `npm ci`, `CI=true` clone. Aggregate quality is delegated to the
lead by `common.md`; no gate, cap, assertion, ignore or deadline is weakened.

Six deliberate red drills ran both complete security regression files (29
tests), each exit 1. The runner itself exits 0 only after every drill fires
and its original SHA-256 is restored byte-exact.

| Deliberately removed                                            | Failed | Passed | Restored source SHA-256                                            |
| --------------------------------------------------------------- | -----: | -----: | ------------------------------------------------------------------ |
| Stream refusal                                                  |      3 |     26 | `D3D8657584C8A2062182FDD5CC763755B20EAA71A08ADAE3103962F835DCF53C` |
| Trailing-dot/space refusal                                      |      7 |     22 | same spelling module hash                                          |
| Native storage ancestry, replaced with spelling comparisons     |      2 |     27 | `F11B4B6E05BAC30C93E2046F6C3D82B03B1C3F018CFCE422F1AEB05363A70E26` |
| Superscript device entries                                      |      7 |     22 | same spelling module hash                                          |
| Native ancestry after a junction, replaced with lexical parents |      1 |     28 | `97BD6F9840C8FEF084DBB330629163A7334FC9871BBCCE1396BB982B8ECCCB04` |
| SMB comparable-volume requirement                               |      1 |     28 | same identity module hash                                          |

The earlier four-drill preparation ran before the final UNC-junction test and
central model-text move, with 28 tests: stream 3 failed, trailing 7 failed,
storage spelling 2 failed, superscript 7 failed. Final receipts above supersede
those preparation hashes. All five typecheck projects passed before commit.

### UNC identity namespace follow-up

Review of `006ea4ec3` found that an SMB volume serial alone cannot establish
that its file indexes use the DOS namespace. UNC exclusion now also requires
an exact matching native volume-root identity. Injected changes to either
`dev` or `ino` retain the hold. The nearest existing ancestor is resolved once
and bound by an immediate native identity comparison before its canonical
parents are walked. Replacement or disappearance during that resolution
refuses exclusion. No cache or timeout change is introduced.

The first fresh replay passed its first six complete groups (616 tests and
six existing platform skips), then was deliberately interrupted for this
follow-up; it is not counted as final qualification. Final regressions on the
unchanged release base: **31 failed, 3 passed**, exit 1. Repaired: **34 passed**,
exit 0. The three positive controls remain POSIX spelling and native behavior.

Seven final drills run both complete regression files (32 tests), each exit 1:
stream **3 failed**, trailing **7**, storage spelling **4**, superscript **7**,
lexical junction ancestry **1**, missing SMB root comparison **2**, and missing
canonical identity binding **2**. All source bytes are restored by SHA-256:
spelling `9A2CDC5A72E14B06B746C682BDC879074D792A69A9C5BD121AB6FE32ADFA0FCE`,
storage `F11B4B6E05BAC30C93E2046F6C3D82B03B1C3F018CFCE422F1AEB05363A70E26`,
identity `3967D59DB674F3DF5AA22D606882A4C97FD834883D82A92DFC5AA17CBF1C918A`.
These are the bytes at drill time, before the final lint/format hook.

### Proven UNC workspace writes

Checkpoint admission now carries its existing workspace root into the shared
UNC exception. A proven descendant of a UNC workspace can be excluded from
storage and passed through the port; a junction from it into storage remains
refused. With no store/root authority, the port still refuses flagged names.
This is covered in the UNC-junction regression without dropping any assertion.
All 34 new tests pass. The owning suites and static gates are restarted on
the complete committed correction; interrupted preparations are not final
qualification receipts.

### Unchanged bundle caps

The first fresh static qualification passed typecheck, lint, format, knip,
duplication, cycles, localization and reference. Its build correctly refused
sharingRuntime at 176.1 KiB against the unchanged 175 KiB cap. Native identity
now ships once in the existing shared Node boundary bundle, reached through
the existing build plugin. The regenerated host API inventory records the new
Node imports. Production build passes: sharingRuntime **173.3/175 KiB**, shared
boundaries **27.4/50 KiB**; split, globals and notices pass too.

Removing identity routing deliberately fires the complete deferred-bundle
suite: **65 failed, 26 passed**, exit 1. Restoring the plugin byte-exact restores
all **91 passed**, exit 0. SHA-256:
`D8F6C499F0E8B49303620C637FC68D6C7C5FFAF82BEC1BDFEA41608C46CE576A`.
The initial restored run exposed an uncompressed hook-runtime fixture (90
passed, one size failure). It now uses the production prompt-compression
plugin already used by that shipped bundle; the size gate and cap are unchanged.
The next fresh webview typecheck correctly refused the Node export placed in
its shared-source include. A dedicated core entry now exports the existing
shared boundaries and native identity for the same output bundle; knip's entry
inventory follows that entry. Browser types, include patterns and gates stay
unchanged. Qualification restarts after this correction.
