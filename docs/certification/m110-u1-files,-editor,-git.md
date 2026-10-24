# M110-U1 files, editor and Git

Mac mini, 2026-10-06; `/Users/randy/lanes/M110U1`, branch `m110/u1`,
base `989077534`. The accepted [A0 threat model](m110-threat-model.md),
including H19/H20, is binding. No live/model call, credential read, deploy
key generation, external Git push, merge, rebase or OS setting change was performed.
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
The JavaScript editor adapter declares its explicit `focus`/`destroy` handles,
so consumer lint does not require SDK types in that shared install. The first
UI commit hook refused SDK-referencing handle types; restoring this explicit
adapter contract fixes the unresolved calls without a lint escape hatch.

No M104 envelope is invented. All incoming/outgoing method values use the
lane-0 catalog. The memory bearer is supplied by A1 through a callback;
no key, cookie, persistent state or bearer-valued HTML field is introduced.
Missing factories or ports fail explicitly. The ordinary VS Code chat
surface keeps its existing bridge; only `data-surface="node"` uses U1.

## Named integration bindings

| Binding                | Required owner action                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M110-U1-M104-D-SURFACE | M104-D/A1 installs the trusted memory-only `window.museNode` binding after sign-in: `port`, `auth`, registered `workspaceId`, and `loadWorkspace()`. The loader returns U1's independent module; its factory installs the embedded language table before rendering. Clear/dispose the page on session end. No envelope or bearer is placed in the page's HTML.                                                                           |
| M110-U1-C-BUILD        | C/M104 calls `buildNodeWorkspace` from `test/harness/build-node.mjs` in the release build and packages `dist/webview/node/**`. This separate entry preserves the main webview's existing 900/50 KiB caps. Include its metafile and package licences in node distribution notices. U1 does not edit the C-owned production build or packaging files.                                                                                      |
| M110-U1-N-FILE-PUBLISH | N/C implements `NodeFileWorkspacePort.root` from registered canonical workspace state, plus tools-UID atomic `replace` with containment, identity and expected-digest comparison at publication. U1 passes the original expected digest and exact bytes/digest, and validates the receipt. No asynchronous precheck/rename is claimed to be an atomic compare-and-swap. An absent publisher must refuse.                                 |
| M110-U1-N-GIT-RESULTS  | N binds `NodeGitPagePort.inspect/run` to the existing closed runner's structured inspection, pagination, private snapshot and tools-UID publication. U1 parses every result, rechecks remote/destination/key/ref/head before dispatch and computes N's canonical action digest. N's `NodeGitNetworkPort.use` still owns the atomic final recheck and isolated socket; U1 never runs repository Git as the service user.                  |
| M110-U1-N-ERRORS       | N's listener currently recognizes only `NodeListenerError` and its small code union excludes `conflict`. The binding must translate U1/runner/publication failures into the catalog's fixed codes, including stale-write/head `conflict`, without exposing raw filesystem or Git text. U1's browser scrubs unknown failures to `unavailable`; this fails closed but is insufficient for the installed conflict message until N binds it. |
| M110-U1-A1-STEPUP      | A1 binds `NodePageAuthPort.verify` to fresh UV. U1 shows host, port, user, repository, verified host key, remote, ref and head; the proof binds the whole tuple and operation. Changed status while verifying refuses without dispatch. N consumes proofs once. No test fake is a cryptographic verifier.                                                                                                                                |
| M110-U1-J-REFERENCE    | No `featureCatalog.ts` or reference generator exists on this base. J records files/search/transfers, save/discard, editor/diff, Git status/stage/commit/branches/fetch/pull/push and verification in the reference, README and Unreleased notes after binding. No executable command or setting is added here, so manifest translation tables need no new key.                                                                           |

**M110-U1-J-HOST-API:** J regenerates
`docs/ide-compatibility/host-api.md` with
`npm run check:host-api -- --write` after integration, reviews it and reruns
the check. The current record omits N's node-service import counts and U1's
file methods/stylesheet. This document is J-owned and was not edited by U1.
No new VS Code API or theme variable is introduced.

These ports and React surfaces are shared by browser and embedded-editor
hosts. There is no `vscode` import in U1, no provider capability change and
no new paid path. ACP/headless/TUI adapters bind the same catalog rather
than receiving editor-specific logic. Real A0-GIT/A0-PUBLISH and installed
editor receipts remain their named owners' work in the capture ledger.

## Controls and verification

Every final Vitest run uses the repository timeout and at most three files/
workers. No gate, threshold, ignore or existing cap is weakened. The two
JSON ledgers contain **62 red drills**: every mutation exits 1 with a named
test failure, and every source's before/restored SHA-256 matches exactly.

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

## Browser implementation decisions

The explorer is a small ARIA tree rather than a new tree-library dependency;
lane 0 froze no tree-library interface or pin. Directory pages load on
expansion, search retains its submitted query across pagination, loaded
entries are capped at 10,000 and the DOM window at 12 rows plus overscan and
one retained active row. Arrow keys, Home/End and Enter/Space operate on
that same tree. IDs encode filenames so spaces remain one ARIA ID reference.

The independent node build keeps its inline fallback for `node*`, `git*`
and `shareShowMore`, generated from the canonical English table. Its build
checks every actual source input's `UI_TEXT` read against that set. The
factory projects the caller's full language table onto the same keys and
uses the existing locale/template/plural checks. It neither changes the
ordinary browser fallback nor relaxes the repository localization gate.

CodeMirror uses the pinned package's minimal editor setup (typing,
selections, undo/redo and highlighting), with the public state constructor's
`create`/`phrases` facet. This avoids an additional unapproved state-package
import. Its control-character labels and selection-deletion announcements
come from the installed language at mount; all 14 tables contain the real
translations. Diff panes are the actual `@codemirror/merge` implementation,
read-only. Each view is destroyed at effect cleanup. A pending save captures
one text snapshot and digest, preserving further typing in the draft.

The standalone build emits `THIRD_PARTY_NOTICES.txt` beside the chunks,
from the exact dependency inputs and their licences. C must package this
file along with the entry and CSS, and bind the host's resource/CSP policy.
It resolves the approved packages from the chosen dependency install and
selects their ESM entries. Accidentally selecting CommonJS raised the editor
to 460.3 KiB; the ESM regression was deliberately broken and restored, and
the final editor is 307.4 KiB without changing its 600 KiB cap.

## Remaining control drills

The [surface ledger](m110-u1-surface-drills.json) records all **46** additional
drills below, including the exact named failing test and restoration hashes.
Together with the 16 boundary drills above, these cover each new guard.

| Control                                                                                                                          | H-row / decision | Drill IDs                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Opened inode, size and link count; final size/timestamps and exact read length; regular-file admission                           | H10              | F-held-inode, F-held-size, F-held-link, F-final-size, F-final-mtime, F-final-ctime, F-short-read, F-leaf-type |
| Growing read cap, cancellation barriers and parsed-path snapshot                                                                 | H09/H08/H10      | F-growing-cap, F-cancel-barriers, F-parsed-path                                                               |
| Outgoing JSON bound, response MIME, nonempty body and strict UTF-8                                                               | H09/H10          | B-outgoing-cap, B-response-type, B-empty-body, B-utf8                                                         |
| Canonical network action digest, complete destination/head/ref binding, local expected head, parsed results and cancellation     | H14/H10/H08      | G-digest, G-destination-head-ref, G-local-head, G-results, G-cancel, G-canonical-browser                      |
| Proof purpose/digest, post-verification status recheck and unknown/detached/unborn refusal                                       | H14/H08          | G-proof-purpose-digest, G-after-verification, G-unborn-detached-unknown                                       |
| Read-path match, unsaved draft preservation, serialized/cancelled work, upload preflight/draft protection and download digest    | H10/H08/H09      | U-open-path, U-unsaved, U-serial, U-upload-cap, U-upload-draft, U-download-digest                             |
| Installed table validation and projection, localized real editor announcements                                                   | D33              | U-table-check, E-locale-projection, E-localized-phrases                                                       |
| One pending page per directory, total loaded-entry bound, mounted active row, safe IDs, search query snapshot and lifetime abort | H09/D32/H10/H08  | T-singleflight, T-entry-cap, T-active-mounted, T-identifiers, T-query-snapshot, T-dispose                     |
| Unbound surface admission and changed/cleared binding during loading                                                             | H06              | S-unbound, S-binding-epoch                                                                                    |
| Separate startup/editor caps, ESM dependency graph, complete fallback reads and shipped licences                                 | H09/D33/D6       | C-workspace-budget, C-editor-budget, C-esm, C-text-coverage, C-licences                                       |

H19 physical-action step-ups and H20 console lockout recovery remain A1/N/T/C
controls; U1 adds neither physical actions nor a recovery grant. The accepted
threat model is unchanged. UI proof checks supplement A1/N's real verifier,
one-use consumption and session termination; they do not replace them.

## Real local fixtures

`nodeGitLocalBare.test.ts` creates a temporary writer, bare repository and
working clone. Real Git pushes the approved commit only to that bare path,
fetches and fast-forward pulls incoming data, and refuses a competing local
head before dispatch. The semantic fixture port maps the approved synthetic
destination onto that one local bare path; no SSH server, deploy key or
external remote is used. It proves U1's operation/data behavior, not N/C's
key socket, two UIDs or atomic publication.

`nodeBrowserWorkspace.test.mjs` builds and drives actual CodeMirror in
Chrome: keyboard typing and undo/redo, exact UTF-8 save with original digest,
stale-save draft/data preservation, read-only merge panes, German screen-reader
announcements and control-character labels, and keyboard opening at 320 px.
It uses the repository test timeout. The [dark narrow screenshot](m110-u1-shots/editor-dark-320.png)
is captured from this fixture; no screenshot contains a credential. A test run
writes its picture to the gitignored `temp/m110-u1-shots/`, never over this one
(cc-tests, 2026-10-23).

## Final verification

Mac mini, 2026-10-06. All guarded sources were restored before these runs.

| Check                                                      | Result                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File runtime / HTTPS port / Git runtime and proof contract | 61 tests passed: `nodeFilesPage`, `nodeBrowserPort`, `nodeGitPage`                                                                                                                                                        |
| Workspace / virtual tree / lazy surface                    | 25 tests passed: `nodeWorkspaceUi`, `nodeFileTree`, `nodeSurface`                                                                                                                                                         |
| Real local bare Git and standalone build                   | 5 tests passed: `nodeGitLocalBare`, `nodeWorkspaceBuild`                                                                                                                                                                  |
| Real CodeMirror in Chrome                                  | 5 tests passed: `nodeBrowserWorkspace`; the build and browser suites passed again after the final ESM change                                                                                                              |
| Accessibility                                              | 120 pages passed: all ten U1 cases, four themes, English/German/pseudo, 320 px cases included; 0 violations, 0 undecided, 0 exempt, 0 missing results                                                                     |
| TypeScript                                                 | All five projects passed; unit project checked again after the final test-helper changes                                                                                                                                  |
| Scoped ESLint / Stylelint / Prettier                       | Passed on owned changes; no suppression or ignore added                                                                                                                                                                   |
| Dead code                                                  | Plain `knip` passed; only the two existing configuration hints are printed                                                                                                                                                |
| Duplication                                                | `jscpd` passed: 0 clones, unchanged zero threshold                                                                                                                                                                        |
| Localization                                               | 14 tables, 164 manifest strings, 0 problems                                                                                                                                                                               |
| Production build                                           | Passed all existing size/split/global/notices checks; 83 existing bundled-package notices                                                                                                                                 |
| Independent node build                                     | Startup 295.6/375 KiB; lazy editor/merge 307.4/600 KiB; real merge implementation and separate licences included                                                                                                          |
| Host API record                                            | **Fails only the generated record comparison**; 332 VS Code APIs, 31 VS Code-importing files, 25 Node built-ins, 61 theme variables. Required J regeneration is named above; portable-boundary checks report no violation |

The **96 unique tests** use the default timeout, with no skipped/filtered test
or exploratory timeout increase. Production activation is 437.0/600 KiB,
Model API 447.0/475, ACP 817.9/850 and node service 64.9/75. Main webview plus
static imports is 897.3/900; its existing deferred JavaScript is 49.7/50.

The lane does not run full `quality`, full unit coverage, live/paid calls or
installed-editor/OS qualification: the brief delegates those to the lead
and the named owners. No M110 support/release certification is claimed before
the real bindings, capture receipts, host API regeneration and lead gates.

## Review fix round: RVM110U1's five P2s

Mac mini, 2026-10-09; `/Users/randy/lanes/FIXM110U2`, branch `m110/u2`,
base `f6821a988` (m110/u1). No live/model call, credential read, push,
merge or rebase was performed. Model attempts: **0**. No user-visible
string was added or changed (14 tables, 164 manifest strings, 0 problems);
no bundle cap was touched (`dist/extension.js` 437.0/600 KiB,
`dist/modelApi.js` 447.0/475 KiB, both unchanged from U1). Every test below
ran with the repository default timeout, at most three files per run.

| #   | Finding (report §)                                                                                   | Fix                                                                                                                                                                                                                                                                                                                                    | Regression test                                                                                                                                                                                                                                                                                                                                                                                                                              | Red drill (base behaviour)                                                                    | Restore               |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------- |
| 1   | Show more replaces the visible list (`FileTree.tsx:295`, `GitPage.tsx:129,202`)                      | Search (`FileTree.tsx:293-300`), status (`GitPage.tsx:129-136`) and branches (`GitPage.tsx:208-214`) append pages with a functional state update, like the directory tree (`FileTree.tsx:88-89`); the search pager no longer jumps to the top                                                                                          | `nodeFileTree.test.tsx` search test now asserts the first-page row stays and the button disappears; new `nodeWorkspaceUi` test appends two status and two branch pages and asserts both pages stay                                                                                                                                                                                                                                           | Base files restored: search test fails (first row gone), git append test fails (`a.txt` gone) | SHA-256 OK both files |
| 2   | Cancel clears the single-flight lock (`main.tsx:173-176`)                                            | Cancel only aborts (`main.tsx:176-178`); the lock and `busy` clear in `run`'s `finally` after the aborted promise settles (`main.tsx:105-113`)                                                                                                                                                                                         | New `nodeWorkspaceUi` test: after cancel a second open starts no request and Cancel stays; after settle the lock is free (second open dispatches) and the late reply is dropped                                                                                                                                                                                                                                                              | Reverted hunks: second open dispatches immediately (2 reads), test fails                      | SHA-256 OK            |
| 3   | Upload over the open file keeps the old buffer/digest (`main.tsx:227-238`)                           | Dirty-draft guard fires whether the path box names the file or is cleared (`main.tsx:223-228`); after upload the open buffer, draft and digest reload from the server (`main.tsx:243-258`); Save then sends the new digest                                                                                                             | New `nodeWorkspaceUi` tests: editor shows the uploaded bytes, Save rests, a follow-up edit saves with the new digest; cleared-box dirty upload refuses with `conflict` and sends nothing                                                                                                                                                                                                                                                     | Reverted hunks: both tests fail (old bytes shown; cleared-box upload proceeds)                | SHA-256 OK            |
| 4   | Plain `Error`s become `unavailable` at the listener (`web/git.ts:55,69`, `web/files.ts:77` et al.)   | All `new Error(UI_TEXT.nodeErrors.*)` in `web/files.ts` (16 sites) and `web/git.ts` (3 sites) throw `NodeListenerError`; `conflict` joins `NodeListenerErrorCode` (`listenerGuard.ts:36-44`) and `NODE_HTTP_STATUS` (`constants.ts:92`, 409). Same messages, so in-process assertions and the client code-to-message map are unchanged | New `nodeFilesPage` test (receipt/stale `conflict`, oversize `tooLarge`, over-bound cursor `invalidRequest`, symlink `forbidden`) and `nodeGitPage` test (changed head `conflict`, altered digest `forbidden`, stale local head `conflict`) assert `instanceof`/code via shared `test/unit/helpers/nodeErrorCode.ts`; new live `nodeListener` test asserts 409/`{"code":"conflict"}` for a typed throw and 503/`unavailable` for a plain one | Reverted throws: both unit tests fail with `expected 'plain' to be 'conflict'`                | SHA-256 OK both files |
| 5   | Network `ref` requires `refs/heads/` but status `branch` may be short (`network.ts:53`, `git.ts:51`) | Shared `nodeNetworkBranchRef` (`shared/node.ts:291-297`): the page builds the tuple with the full path (`network.ts:53`), N admits it by comparing normalized (`web/git.ts:48-56`, detached still refuses)                                                                                                                             | New `nodeGitPage` tests: short-branch `runNetworkGit` sends `refs/heads/main`; admission accepts the full ref against an inspected short branch                                                                                                                                                                                                                                                                                              | Reverted lines: short-branch send throws a Zod error, admission refuses; both tests fail      | SHA-256 OK both files |

Drill mechanics: each drill saved the fixed file under `$TMPDIR`, restored
the base behaviour (whole-file checkout for F1, surgical revert for
F2–F5), ran the named test (exit 1 with the named failure), and copied the
saved file back with `sha256sum -c` passing on all six restored sources.
One F4 drill iteration ran against a perl-mangled import (suite transform
error, not an assertion); the import was repaired and the drill re-ran to a
real assertion failure before restore.

Test-only helpers (`beginPendingOpen`, `settleLateReply` in
`nodeWorkspaceUi.test.tsx`, shared `nodeErrorCode`) exist only to satisfy
the zero-duplication gate after it flagged four clones in the new tests;
`jscpd` is back to 0 clones, `knip` shows only the two pre-existing hints.

Not run here, left for the lead outside the sandbox: the new live
`nodeListener` mapping test. This rig's sandbox denies loopback `listen`
(`node:net` probe returns `EPERM`; the suite's `beforeAll` TLS setup times
out), so `nodeListener.test.ts` cannot execute here — pre-existing
environmental block, unrelated to the change; the file typechecks
(`typecheck:unit` passes). One unreproduced flake: a single failure in an
early three-file run (test name not captured) followed by three consecutive
71/71 green runs of the same files; recorded, not chased further on the
shared rig.

## Review fix round 2: RVM110U2's two P2s

Mac mini, 2026-10-09; `/Users/randy/lanes/FIXM110U3`, branch `m110/u3`,
base `47639a728` (m110/u2). No live/model call, credential read, push,
merge or rebase was performed. Model attempts: **0**. Two user-visible
strings were added (`nodeErrors.notText`, `nodeWorkspace.binaryReplaced`)
with real translations in all 14 tables (`check-l10n`: 0 problems); no
bundle cap was touched (`npm run build` passes all existing size/split/
global/notices checks). Every test below ran with the repository default
timeout, at most three files per run.

The round does not patch the two spots: one request runner
(`src/webview/node/requestRunner.ts`, `useRequestRunner`) carries every
request the node files/Git pages make, and one typed boundary
(`guardNodeHandler`/`guardNodeMethod` in `listenerGuard.ts`) carries every
handler in `web/files.ts` and `web/git.ts`.

| #   | Finding (report §)                                                                                                                                                             | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Regression test                                                                                                                                                           | Red drill (base behaviour)                                                                                                                  | Restore               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | Search Show more is untied to any abort and applies late pages onto cleared/replaced results; double click appends twice (`FileTree.tsx:281`)                                  | `FileTree` search submit and Show more share the runner kind `search`: submit starts with `supersede` (aborts the pending page), clearing the results or the query calls `invalidate` (aborts and retires the id), a second Show more drops while the kind is busy, every response checks `isCurrent()` and the signal before touching state, and both Show more buttons are disabled while their kind is busy. Directory pages ride `directory:<name>` kinds, keeping one pending page per directory. `main.tsx`'s `run()` becomes two thin kinds over the same runner (`file` for open/save/upload/download, `git` for the Git page): a second start of a busy kind drops and the lock clears only on settle, preserving RVM110U1 P2 #2 byte for byte | `nodeFileTree` supersede/clear/double-click tests (one shared `pendingSearch` harness); existing H08/H09 tree and workspace tests unchanged and green                     | Base `FileTree.tsx` restored: all 3 new tests fail                                                                                          | SHA-256 OK            |
| 2a  | Upload of non-UTF-8 bytes over the open file reloads through fatal UTF-8 decode, throwing raw `TypeError` → `unavailable` with a stale buffer (`main.tsx:249`, `files.ts:238`) | `read` decodes through `decodeText`, which throws typed `notText` ("This file is not UTF-8 text.", HTTP 415, in the client error enum so the browser maps it instead of scrubbing). The upload handler catches `notText` from its reload read and closes the buffer (`opened`/`draft` cleared) with the translated `binaryReplaced` notice instead of `unavailable`. Opening a non-UTF-8 file now reports the same typed message through the existing error map                                                                                                                                                                                                                                                                                         | `nodeHandlerErrors` notText case (real `0xFF` fixture file: code, message, 415, enum entry); `nodeWorkspaceUi` binary-upload case (notice shown, editor closed, no alert) | `notText` Demoted to `unavailable`: the code/message/enum test fails. Base `main.tsx` restored: the binary-upload test fails, other 19 pass | SHA-256 OK both files |
| 2b  | Raw `TypeError`/`Error` can escape any of the 15 handlers in `web/files.ts`/`web/git.ts`                                                                                       | Every handler is wrapped in `guardNodeMethod`: `NodeListenerError` passes through, the caller's own cancellation passes through, anything else becomes typed `unavailable` (the listener's existing mapping for internal failures, now asserted at the handler boundary). The guard test walks both handler tables with fault-injecting ports (`TypeError`/`Error` rejections) and asserts every throw is `NodeListenerError`, with the case list pinned to the table keys so an added handler without a case fails. The `nodeFilesPage` competing-edit fixture now refuses a stale digest with typed `conflict` instead of leaking its raw message; the test's no-overwrite assertion is unchanged                                                     | `nodeHandlerErrors` file/git walks (6 + 9 handlers); `nodeFilesPage` competing-edit test updated to the typed refusal                                                     | Guard replaced with a passthrough in `files.ts`: file walk + unavailable-mapping tests fail. Same in `git.ts`: git walk fails               | SHA-256 OK both files |

Drill mechanics: each drill saved the fixed file under `$TMPDIR`,
applied the break (whole-file base checkout for the two webview files,
one-line revert for the three server breaks), ran the named suite (exit
1 with the named failures), and copied the saved file back with
`sha256sum -c` passing on all five restored sources. One exploratory
drill (removing only the `isCurrent()` check) stayed green because the
abort gate subsumes it; the recorded D1 drill uses the base file instead.

Runner design (per-kind state, one implementation, two instances: the
workspace's for `file`/`git`, the tree's for `search`/`directory:*`):
each kind holds a generation counter plus the live `{ id, controller }`;
`start` drops when the kind is live unless `supersede` aborts it first;
`isCurrent()` compares against the generation, so `invalidate` (abort +
retire, used on every clear) drops late pages even from ports that ignore
the signal; `busy` is a state set that disables the matching controls;
`abortAll` (Cancel, unmount) aborts without clearing locks, which release
in each request's `finally` only for the still-current id. A realm-proof
`name === 'AbortError'` check (not `instanceof`) keeps cancellation
silent after the validated port throws the runtime's `AbortError`.

Final verification (all guarded sources restored, Mac mini, 2026-10-09):
`nodeHandlerErrors` 4, `nodeFileTree` 9, `nodeWorkspaceUi` 21,
`nodeFilesPage` 29, `nodeGitPage` 23, `nodeListenerGuard` 60,
`nodeSurface` 4, `nodeBrowserPort` 13, `nodeGitLocalBare` 2,
`nodeWorkspaceBuild` 3 — all passed at the repository default timeout
(counts are executed tests per file, including the `it.each` rows and the
new binary re-upload case in `nodeWorkspaceUi`). Full `typecheck`
(host/webview/unit/e2e/integration) passed; scoped ESLint, Prettier,
`check:l10n` (14 tables, 164 manifest strings, 0 problems),
`npm run build` (all size/split/global checks), `knip` (only the two
pre-existing hints) and `jscpd` (0 clones) passed. No gate weakened, no
suppression added, no `as` cast, no new dependency. `nodeListener.test.ts`
still cannot execute on this rig (loopback `listen EPERM` in `beforeAll`,
pre-existing, also blocks U2); it typechecks.
