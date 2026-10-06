# M110-U1 files, editor and Git

Mac mini, 2026-10-06; `/Users/randy/lanes/M110U1`, branch `m110/u1`,
base `989077534`. The accepted [A0 threat model](m110-threat-model.md),
including H19/H20, is binding. No live/model call, credential read, deploy
key generation, push, merge, rebase or OS setting change was performed.
Model attempts: **0**. Full quality belongs to the lead under the rig brief.

## Implementation and ownership

U1 implements validated file methods, the browser method port, and an
independent workspace entry with a keyboard file explorer, filename search,
bounded uploads/downloads, digest-preserving saves, CodeMirror 6, merge
diffs, and a Git page. Git supports status, stage, commit, branch listing
and creation, diffs, and fresh destination-bound fetch/pull/push.

CodeMirror `6.0.2` and `@codemirror/merge` `6.12.2` are exact pins authorized
by the brief and research §3.2/3.7. Both report no peer dependencies. The
new dependency graph's audit has **0 vulnerabilities**; the repository audit
reports 13 pre-existing tooling issues (2 low, 10 high, 1 critical).
The manifest and lockfile were updated without modifying the shared
`node_modules`. The test install is isolated in gitignored `temp/u1-deps`.

No M104 envelope is invented. All incoming/outgoing method values use the
lane-0 catalog. The memory bearer is supplied by A1 through a callback;
no key, cookie, persistent state or bearer-valued HTML field is introduced.
Missing factories or ports fail explicitly. The ordinary VS Code chat
surface keeps its existing bridge; only `data-surface="node"` uses U1.

## Named integration bindings

| Binding                | Required owner action                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M110-U1-M104-D-SURFACE | M104-D/A1 installs the trusted memory-only `window.museNode` binding after sign-in: `port`, `auth`, registered `workspaceId`, and `loadWorkspace()`. The loader returns U1's independent module; its factory installs the embedded language table before rendering. Clear/dispose the page on session end. No envelope or bearer is placed in the page's HTML.                                                          |
| M110-U1-C-BUILD        | C/M104 calls `buildNodeWorkspace` from `test/harness/build-node.mjs` in the release build and packages `dist/webview/node/**`. This separate entry preserves the main webview's existing 900/50 KiB caps. Include its metafile and package licences in node distribution notices. U1 does not edit the C-owned production build or packaging files.                                                                     |
| M110-U1-N-FILE-PUBLISH | N/C implements `NodeFileWorkspacePort.root` from registered canonical workspace state, plus tools-UID atomic `replace` with containment, identity and expected-digest comparison at publication. U1 passes the original expected digest and exact bytes/digest, and validates the receipt. No asynchronous precheck/rename is claimed to be an atomic compare-and-swap. An absent publisher must refuse.                |
| M110-U1-N-GIT-RESULTS  | N binds `NodeGitPagePort.inspect/run` to the existing closed runner's structured inspection, pagination, private snapshot and tools-UID publication. U1 parses every result, rechecks remote/destination/key/ref/head before dispatch and computes N's canonical action digest. N's `NodeGitNetworkPort.use` still owns the atomic final recheck and isolated socket; U1 never runs repository Git as the service user. |
| M110-U1-A1-STEPUP      | A1 binds `NodePageAuthPort.verify` to fresh UV. U1 shows host, port, user, repository, verified host key, remote, ref and head; the proof binds the whole tuple and operation. Changed status while verifying refuses without dispatch. N consumes proofs once. No test fake is a cryptographic verifier.                                                                                                               |
| M110-U1-J-REFERENCE    | No `featureCatalog.ts` or reference generator exists on this base. J records files/search/transfers, save/discard, editor/diff, Git status/stage/commit/branches/fetch/pull/push and verification in the reference, README and Unreleased notes after binding. No executable command or setting is added here, so manifest translation tables need no new key.                                                          |

These ports and React surfaces are shared by browser and embedded-editor
hosts. There is no `vscode` import in U1, no provider capability change and
no new paid path. ACP/headless/TUI adapters bind the same catalog rather
than receiving editor-specific logic. Real A0-GIT/A0-PUBLISH and installed
editor receipts remain their named owners' work in the capture ledger.

## Controls and verification

The final check results, per-control red drills and source hashes are added
as each piece passes. Every final Vitest run uses the repository timeout;
no gate, threshold, ignore or existing cap is weakened.

## First piece: file and HTTP boundaries

Mac mini: the file and browser suites passed **25 tests** at the
repository default timeout (2026-10-06 16:22 PDT). All five TypeScript
projects passed during implementation. The file and browser piece adds
**16 deliberately broken controls**; each mutation
exited 1 with named test failures and restored its source byte-exact. See
[the SHA-256 ledger](m110-u1-control-drills.json). Scoped ESLint passes;
Prettier leaves the guarded source files unchanged.

| Control                                                      | H-row   | Named regression and red drill                                                                                    |
| ------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------- |
| Canonical registered root, no link alias                     | H10     | `refuses a workspace root reached through a symlink above that root`; F-root                                      |
| No symlink ancestors or hard-link reads                      | H10/H11 | `refuses leaf/ancestor symlinks and hard-linked files`; F-links, F-hardlinks                                      |
| Held-file identity and parent recheck                        | H10     | `refuses an ancestor swap during a held-file read before returning bytes`; F-identity-recheck                     |
| File/UTF-8/transfer caps before work                         | H09     | `rejects oversized files, multibyte writes and uploads before publication`; F-file-cap                            |
| Exact upload bytes/digest and publication receipt            | H10     | `rejects wrong upload digest and wrong publisher receipt`; F-upload-digest, F-publication-digest                  |
| Params/results validated at browser transport                | H10     | `parses params before dispatch and results before use`; B-params, B-results                                       |
| Memory-only Authorization and trusted canonical HTTPS origin | H06/H07 | `uses only the Authorization header` and `refuses noncanonical origin`; B-memory-only, B-origin                   |
| Bounded streamed response, reader disposal                   | H09     | `bounds streamed responses before parsing JSON`; B-stream-cap                                                     |
| Cancelled reply is never applied                             | H08     | `refuses a result delivered after cancellation`; B-cancelled-result                                               |
| Bounded directory work and cursor admission                  | H09     | `stops a directory flood` and `refuses invalid or over-bound cursors before filesystem access`; F-scan, F-cursors |
| Invalid UTF-8 is refused rather than silently replaced       | H10     | `refuses unknown workspace, missing file, invalid UTF-8 and cancellation`; F-utf8                                 |

The publisher fixture tests digest preservation against a competing edit.
It is not an OS receipt for atomic replacement or the tools UID; that
mandatory production binding is named above. Transport tests prove the
client contract, while A1/N own bearer verification, origins and proof
consumption.
