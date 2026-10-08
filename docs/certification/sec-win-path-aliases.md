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
a test share was needed. Different SMB volume IDs and unreadable identity are
tested with explicit injected failures; they retain protection, not a guessed
DOS mapping. Actual SMB returned matching identities on both loopback hosts.

## Base failure proof and unchanged controls

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
