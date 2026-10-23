# M98 CS — authenticated SystemOne boundary (2026-10-05, Kubuntu)

Worktree `/home/randy/lanes/M98CS`, branch `m98/cs`, base `3e192331`.
Read the rig brief, shared `codex/common.md`, AGENTS, PLAN D77/M98 in
full and their research/P0/planning/J certification records. The explicit
rig brief permits this fake-only boundary before the remaining phase-1
integration. This base is not the completed release tree.

## Delivered boundary and handoff

`src/runtime/judge/serve.ts` exports `startJudgeServer` with the P0
`JudgeRuntime`, an existing token parent directory, optional literal host
and chosen port, and optional lifecycle signal. It returns the endpoint,
token file path, ACL receipt and idempotent asynchronous `close()`. It
returns no bearer header or token. G owns CLI parsing/dispatch and Z owns
runtime/backend/build/package assembly; those files are untouched.

- Only `127.0.0.1` and `::1` can bind. A random port is the default; Host
  must exactly match the literal and actual bound port, with brackets for
  IPv6. Duplicate security headers are refused. Every Origin, including
  empty and `null`, refuses the request. An absent Origin does not bypass
  bearer authentication; comparisons use equal-length `timingSafeEqual`.
- Only `POST /v1/systemone` reaches request parsing. The entire streamed
  body, including unknown fields and whitespace, is capped at the existing
  64 KiB limit before zod parsing. The captured P0 request/outcome schemas
  validate both boundaries. Answers must align by question id, count and
  type. Success returns the native result, preserving `answers` and sibling
  `muse`; refusal is HTTP 403 with the bounded no-answer outcome. Internal
  failures are HTTP 500 with only `engine-failure`, never thrown content.
- Each validated inference request independently invokes the injected
  runtime exactly once, with its own cancellation signal. There is no
  response cache, shared claim, reservation store, scheduler, key store,
  provider transport or production fake. P0 assigns durable reservation,
  source resolution, redaction, consent rebinding, settlement and uncertain
  liability to that runtime. The concurrent/retry fixture emulates one
  remaining admission and proves the boundary does not reuse its result
  for another request. It does not certify the absent A/FIXDEF ledger.
- Request/body/inference deadlines use the existing judge limit. Shutdown
  aborts calls before destroying HTTP connections, closes incomplete raw
  sockets, removes the bearer and its directory, and disarms lifecycle
  listeners. SIGINT/SIGTERM and caller cancellation invoke shutdown; the
  process exit handler supplies synchronous cleanup. SIGKILL cannot run
  cleanup; a restart always generates a different credential and ignores
  old files. The engine retains responsibility for possibly sent claims.

`src/runtime/judge/tokenFile.ts` creates a fresh private subdirectory and
opens `bearer` exclusively. It verifies directory and file permissions
before its single token write, using the existing 32-byte random bearer
limit. It checks file type and single-link ownership, never follows a
preexisting token path, and removes artifacts on startup failure.

On POSIX, real `lstat` receipts verify current UID, directory 0700 and file
0600 after chmod; group/other mode bits must be zero. On Windows, the
bounded existing `runProgram`/`windowsPowerShell` launcher runs a fixed
script that removes inherited/explicit grants, assigns the current SID,
and rereads the protected DACL with Get/Set-Acl. The parsed descriptor must
have only explicit current-owner allow/full-control entries. Both paths
are checked before a token is generated. Only encoded paths reach the
helper; no bearer reaches an argument, environment, child or output.
Existing credential/keyring-route filters sanitize its environment.
The Windows adapter is an explicit trusted injected interface for fake
OS receipts and future installed-host verification, not a production fake.

No source/model is selected by this lane. Enhancements and paid first-charge
policy are untouched. There is no CLI support or README claim until G/Z
wire and successfully run that surface. Shared README, CHANGELOG, PLAN,
localization, host-API snapshot and bundle/package edits belong to P0/Z
and are intentionally left for serialized integration. No new user-facing
string, dependency, tunable, cast or suppression is introduced.

## Owning checks and guard-fire evidence

All tests run directly in this worktree on Kubuntu, whole files with
`--maxWorkers=3 --testTimeout=120000`, never a test-name filter. The first
fake socket suite failed before the implementation existed. The initial
finished boundary has 56 passing tests: 32 socket and 24 token/ACL cases.
All five `npm run typecheck` projects pass. Final scoped lint, formatting,
lane gates and lifecycle receipts are recorded below as completed. The
final three owning files pass **64/64** (36 socket, 24 token/ACL, 4 process).

Full SHA-256 restoration and the named failing assertions for each deliberate
mutation are in [m98-cs-drills.json](m98-cs-drills.json). Each counted drill
has exit 1, restoration in `finally`, SHA equality, then exit 0 for the
whole owning file. No credential or raw subprocess failure output is
stored in that record. Production sources are never left mutated.

Fixture corrections are disclosed: namespace spies needed a mockable copy
of the Node module; HTTP/1.1 missing Host is Node's 400; the Node HTTP client
refuses a Host array, so duplicate Host is tested with a real raw socket and
valid body (403). The first streamed-cap mutation left its producer waiting
forever for EOF; that incomplete 45-second control is excluded. The helper
now ends an unfinished producer after a bounded fallback, so removing the
cap gives a named assertion failure rather than a hung drill. The first cancellation mutation also exposed an observer that had not
been injected into startup; it was connected to the real seam and rerun
red/green. Changing the stream iterator destroy option produced no
different verdict on this Node and is excluded, not claimed as a guard.
No gate, coverage level, test timeout, rule, ignore or production limit is weakened.

## Delivery conditions still owned by integration

- G/Z must inject the real admitted runtime and wire the lazy command. A's
  durable D78 adapter, shared namespace, kill/restart liability, corrupt
  store/lock/network-home refusal and two-window receipts remain required.
- Windows fixtures and mocked launcher tests prove descriptor refusal logic
  and path-only invocation, not Windows ACL behavior. Actual Windows
  icacls/GetSecurityInfo corroboration and installed Node/VS Code receipts
  are required before shipping there. macOS has no receipt here; Linux
  permission/socket receipts do not certify it.
- Real-source captures/smoke, npm/VSIX installation, cross-OS installed
  extension hosts, full quality/coverage/a11y/hosted checks and documentation
  belong to the integrated delivery. None is claimed completed here.
- No release support promise is made from fake sources or historical
  OpenRouter research. TypeSafe/Jev remains experimental and opt-in.

This lane makes **0 live, 0 paid and 0 local model calls**. It reads no
credential file and installs no dependency. Local sockets and synthetic
ACLs/providers are the only service activity.

## Completed red drills and installed Node receipt

The first **43** controls below, on implementation commit `f8058ad3`, have named red exits, full SHA-256 restoration
and whole-file green reruns. `serve.ts` restores to
`d2405d89b6654e295b582d2bcbe8367c556576d4a617edbd06b2680d5617a19a`;
`tokenFile.ts` restores to
`7efd0eafb1b3b4a3ea45bc2d1598c8539abf3c099ce68b497ab7f0aa022376ad`.
The JSON record retains every full hash, source version and failure name.
A subsequent strict UTF-8 fix adds control **44**, on the final source
`7336db6a5b081a038e6f7e063d1603a4835a246e87822c1628eb4ecae2068f65`.
Only decoding changes after the first 43 controls; their guards are unchanged.

| #   | Guard deliberately broken                  | Named failing assertion                                                                                                                                                                                                                                                                                                                                                                          | Restored whole file       |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| 1   | loopback literal bind                      | rejects nonapproved bind localhost before creating a token; rejects nonapproved bind 0.0.0.0 before creating a token; rejects nonapproved bind :: before creating a token; rejects nonapproved bind 127.0.0.2 before creating a token; rejects nonapproved bind 192.0.2.1 before creating a token; rejects nonapproved bind [::1] before creating a token                                        | 32 passed (32); SHA equal |
| 2   | duplicate security header                  | refuses missing and repeated security headers before inference                                                                                                                                                                                                                                                                                                                                   | 32 passed (32); SHA equal |
| 3   | bearer length                              | requires the bearer token with no Origin (); requires the bearer token with no Origin (wrong); requires the bearer token with no Origin (Basic wrong)                                                                                                                                                                                                                                            | 32 passed (32); SHA equal |
| 4   | bearer equality without Origin             | requires the bearer token with no Origin (wrong); requires the bearer token with no Origin (Basic wrong); rotates credentials across restarts and deletes the old file and listener                                                                                                                                                                                                              | 32 passed (32); SHA equal |
| 5   | foreign Host                               | binds IPv6 literally and requires brackets in its Host; refuses foreign or incomplete Host attacker.example:1234; refuses foreign or incomplete Host localhost:1234; refuses foreign or incomplete Host 127.0.0.1; refuses foreign or incomplete Host 127.0.0.1:1                                                                                                                                | 32 passed (32); SHA equal |
| 6   | Origin including null and empty            | refuses any Origin including https://attacker.example; refuses any Origin including null; refuses any Origin including                                                                                                                                                                                                                                                                           | 32 passed (32); SHA equal |
| 7   | request path                               | rejects invalid method/path/body before inference (404); rejects invalid method/path/body before inference (404)                                                                                                                                                                                                                                                                                 | 32 passed (32); SHA equal |
| 8   | request method                             | rejects invalid method/path/body before inference (405)                                                                                                                                                                                                                                                                                                                                          | 32 passed (32); SHA equal |
| 9   | streamed byte cap                          | caps actual streamed bytes without Content-Length and includes discarded unknown fields                                                                                                                                                                                                                                                                                                          | 32 passed (32); SHA equal |
| 10  | incoming zod schema                        | rejects invalid method/path/body before inference (400)                                                                                                                                                                                                                                                                                                                                          | 32 passed (32); SHA equal |
| 11  | outgoing zod schema                        | rejects malformed or misaligned runtime output and never reflects thrown content                                                                                                                                                                                                                                                                                                                 | 32 passed (32); SHA equal |
| 12  | answer count alignment                     | rejects malformed or misaligned runtime output and never reflects thrown content                                                                                                                                                                                                                                                                                                                 | 32 passed (32); SHA equal |
| 13  | answer id/type alignment                   | rejects malformed or misaligned runtime output and never reflects thrown content                                                                                                                                                                                                                                                                                                                 | 32 passed (32); SHA equal |
| 14  | native SystemOne response                  | answers the captured contract with native answers and sibling muse unchanged                                                                                                                                                                                                                                                                                                                     | 32 passed (32); SHA equal |
| 15  | no-answer is not HTTP success              | creates distinct per-request claims before dispatch for concurrent clients and retries; rejects malformed or misaligned runtime output and never reflects thrown content                                                                                                                                                                                                                         | 32 passed (32); SHA equal |
| 16  | each request invokes independent admission | creates distinct per-request claims before dispatch for concurrent clients and retries; rejects malformed or misaligned runtime output and never reflects thrown content                                                                                                                                                                                                                         | 32 passed (32); SHA equal |
| 17  | shutdown abort before closing sockets      | aborts active inference and closes incomplete sockets on shutdown                                                                                                                                                                                                                                                                                                                                | 32 passed (32); SHA equal |
| 18  | shutdown raw sockets                       | aborts active inference and closes incomplete sockets on shutdown; aborts active inference and closes incomplete sockets on shutdown                                                                                                                                                                                                                                                             | 32 passed (32); SHA equal |
| 19  | startup cancellation                       | cancels startup before any credential is created                                                                                                                                                                                                                                                                                                                                                 | 33 passed (33); SHA equal |
| 20  | per-start token rotation                   | rotates credentials across restarts and deletes the old file and listener                                                                                                                                                                                                                                                                                                                        | 33 passed (33); SHA equal |
| 21  | private POSIX mode verification            | refuses POSIX permissions that remain broad after chmod                                                                                                                                                                                                                                                                                                                                          | 24 passed (24); SHA equal |
| 22  | POSIX owner verification                   | refuses POSIX foreign ownership                                                                                                                                                                                                                                                                                                                                                                  | 24 passed (24); SHA equal |
| 23  | Windows protected DACL                     | refuses unprotected DACL and removes startup artifacts; refuses a file ACL failure after a valid directory receipt without writing the token; refuses invalid actual Windows helper output ({"ownerSid":"S-1-5-21-100-200-300-1001","currentSid":"S-1-5-21-100-200-300-1001","protected":false,"rules":[{"sid":"S-1-5-21-100-200-300-1001","inherited":false,"allow":true,"fullControl":true}]}) | 24 passed (24); SHA equal |
| 24  | Windows owner SID                          | refuses foreign owner and removes startup artifacts                                                                                                                                                                                                                                                                                                                                              | 24 passed (24); SHA equal |
| 25  | Windows foreign grants                     | refuses broad explicit grant and removes startup artifacts                                                                                                                                                                                                                                                                                                                                       | 24 passed (24); SHA equal |
| 26  | Windows inherited grants                   | refuses inherited owner grant and removes startup artifacts                                                                                                                                                                                                                                                                                                                                      | 24 passed (24); SHA equal |
| 27  | Windows allow grant                        | refuses deny owner grant and removes startup artifacts                                                                                                                                                                                                                                                                                                                                           | 24 passed (24); SHA equal |
| 28  | Windows full-control grant                 | refuses insufficient owner grant and removes startup artifacts                                                                                                                                                                                                                                                                                                                                   | 24 passed (24); SHA equal |
| 29  | nonempty Windows DACL                      | refuses empty DACL and removes startup artifacts                                                                                                                                                                                                                                                                                                                                                 | 24 passed (24); SHA equal |
| 30  | Windows receipt schema                     | refuses empty DACL and removes startup artifacts; refuses nonboolean descriptor and removes startup artifacts                                                                                                                                                                                                                                                                                    | 24 passed (24); SHA equal |
| 31  | ACL before bearer write                    | uses an exclusive private file and verifies permissions before its single write; refuses a file ACL failure after a valid directory receipt without writing the token; refuses a hard-linked token path before its write                                                                                                                                                                         | 24 passed (24); SHA equal |
| 32  | exclusive token creation                   | never overwrites a preexisting token path                                                                                                                                                                                                                                                                                                                                                        | 24 passed (24); SHA equal |
| 33  | single token write                         | uses an exclusive private file and verifies permissions before its single write                                                                                                                                                                                                                                                                                                                  | 24 passed (24); SHA equal |
| 34  | symlink refusal                            | refuses a symlink token path before its write                                                                                                                                                                                                                                                                                                                                                    | 24 passed (24); SHA equal |
| 35  | hard-link refusal                          | refuses a hard-linked token path before its write                                                                                                                                                                                                                                                                                                                                                | 24 passed (24); SHA equal |
| 36  | synchronous exit cleanup                   | removes the private directory through synchronous exit cleanup                                                                                                                                                                                                                                                                                                                                   | 24 passed (24); SHA equal |
| 37  | private directory cleanup                  | cleans up when cancellation occurs during startup ACL waits; cleans up its token when a chosen port cannot listen                                                                                                                                                                                                                                                                                | 33 passed (33); SHA equal |
| 38  | cancellation after startup wait            | cleans up when cancellation occurs during startup ACL waits                                                                                                                                                                                                                                                                                                                                      | 33 passed (33); SHA equal |
| 39  | caller lifecycle abort                     | closes its listener and deletes its bearer when the caller lifecycle aborts                                                                                                                                                                                                                                                                                                                      | 35 passed (35); SHA equal |
| 40  | hard request deadline abort                | aborts an inference at the hard request deadline without trusting late output                                                                                                                                                                                                                                                                                                                    | 35 passed (35); SHA equal |
| 41  | process exit handler registration          | runs synchronous bearer cleanup on a fatal Node exit                                                                                                                                                                                                                                                                                                                                             | 4 passed (4); SHA equal   |
| 42  | SIGINT handler registration                | deletes its bearer and closes the listener on SIGINT                                                                                                                                                                                                                                                                                                                                             | 4 passed (4); SHA equal   |
| 43  | SIGTERM handler registration               | deletes its bearer and closes the listener on SIGTERM; never authenticates a crash token when the same port restarts                                                                                                                                                                                                                                                                             | 4 passed (4); SHA equal   |
| 44  | strict UTF-8 request decoding              | refuses malformed UTF-8 instead of charging for replacement characters                                                                                                                                                                                                                                                                                                                           | 36 passed (36); SHA equal |

Installed rig runtime: **Node v24.18.0, Linux, UID 1000**. The process
suite bundles the actual boundary with esbuild and runs it under that
installed Node with a fake source: SIGINT and SIGTERM exit 0 and delete
the file/close the port; a fatal exception exits 1 and runs synchronous
cleanup; SIGKILL leaves a private stale file, whose token fails against a
new process on the exact old port. Its four tests pass and three separate
registration mutations fire. No VS Code or packaged CLI receipt is implied.

## Final lane checks and integration request

Implementation commit `f8058ad3` passed enabled Husky scoped ESLint/Prettier
and staged gitleaks (no leaks). All first 43 source restoration hashes
still matched after those hooks. An isolated directory left by the excluded
interrupted cap control was removed without reading its bearer. No test
artifact or credential is staged; only the eight named lane files are owned.

The final review found a real malformed-input issue: Buffer's UTF-8 reader
substituted an invalid byte and called the engine (the new regression
observed HTTP 200). A fatal TextDecoder now refuses it at HTTP 400 before
admission. The regression passes, its forgiving-decoder mutation fails
and the final decoder source restores byte-exact in control 44. The final
three owning files pass **64/64**; the socket control reruns **36/36**.

All commands run directly on Kubuntu, one heavy gate at a time:

- `npm run typecheck`: all five projects pass again after the UTF-8 fix;
  the final unit project also passed before the implementation commit.
- Scoped `eslint --max-warnings=0`, changed-file `prettier --check` and
  `git diff --check`: pass. No cast or suppression was introduced.
- `node scripts/check-l10n.mjs`: 14 UI tables, 127 manifest strings,
  431 source files, **0 problems** after the final source changes.
- `npm run deadcode` (plain knip): pass; only the existing `vendor/**`
  configuration hint remains.
- `npm run cycles` (dpdm): no cycle over 403 entry-reachable files.
- `npx jscpd`: **0 clones**, 856 files. It first caught one six-line
  duplicate in the Windows command-failure fixtures; the same three cases
  now share a parameterized fixture. No assertion, case or ignore was removed.
- `npm run build`: pass again after the UTF-8 fix: production, all 18
  caps, split/model-text readers, host globals and third-party notices.
  The production activation metafile contains **no judge input**. These
  unwired boundary modules add no shipped bundle on this base; G/Z must
  repeat the build/package budgets after wiring them.

| Bundle           | Size / unchanged cap |
| ---------------- | -------------------- |
| extension        | 553.3 / 600 KiB      |
| Model API        | 426.4 / 475 KiB      |
| ACP              | 786.7 / 850 KiB      |
| webview JS       | 861.2 / 900 KiB      |
| English fallback | 105.9 / 125 KiB      |
| checkpoint store | 109.1 / 225 KiB      |

`npm run check:host-api` **exits 1**, a generated inventory mismatch. The
pre-existing paidHost/configuration rows from PLAN §7 remain; the new
boundary adds two buffer/crypto importers and one fs/fs-promises/http/path
importer. The exact current Node importer totals are buffer **29**, crypto
**35**, fs **25**, fs/promises **35**, http **3**, path **66**. VS Code
API totals are unchanged at 271 APIs and 18 importing files. Z owns this
generated document and must run `npm run check:host-api -- --write`, review
these rows and rerun. CS does not edit another lane's file or claim this
gate is green. No shared-file exception or gate weakening is made.

Full `npm run quality`, coverage/a11y, hosted matrix, installed Windows/macOS
ACL/Node/VS Code and real admitted-source/CLI/package receipts stay the
lead/Z's explicit integrated gates. This brief forbids the aggregate run,
merge, rebase and push; none was done. No live/paid/local inference occurred.

## FIXM98CS — RVM98CS repairs (2026-10-05, macmini)

Worktree `/Users/randy/lanes/FIXM98CS`, branch `m98/csfix`, base `d5c05578`.
Read the full rig/shared brief and RVM98CS report, repository rules and
PLAN D77/M98 phase 2. The rig override prohibits aggregate quality/full-suite
runs, merge/rebase/push and external/live/paid calls; all verification here
runs directly on macmini, with at most three owning files per Vitest run.
No dependency, wire shape, dispatcher, paid guard, cap, ignore or threshold
changes. No suppression or cast is added.

| Review finding                                          | Disposition                                                                                                                                     | Regression                                                                                                                                                                          | Red control                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| RVM98CS 3 / P1: macOS extended ACLs survive mode repair | Fixed: reject all extended ACLs on the directory/file before writing and reverify both after writing; failed/malformed inspection refuses.      | Real inherited and file `chmod +a` grants; real post-write file/directory grants; inspection failures and malformed receipts.                                                       | 45–50: ACL guard, extra entry, mode/marker, both post-write checks and the pre-write file check.                 |
| RVM98CS 1 / P2: startup bearer has no exit handler      | Fixed: token factory registers its synchronous exit cleanup before permission work or writing; successful/failure cleanup removes that handler. | Unit checks invoke the newly installed exit handler while sync/close is pending; installed Node fatal-exit cases delete the already-written file and its directory in both windows. | 52: remove early exit registration; both pending-operation unit cases and three installed fatal-exit cases fail. |
| RVM98CS 2 / P2: synchronous owner abort reenters close  | Fixed: publish the shutdown promise before synchronous abort callbacks; all reentries return that exact promise and share cleanup.              | `publishes one close promise before synchronous owner cancellation reentry`, with real HTTP inference and owner abort.                                                              | 53: move abort back ahead of promise publication; the named regression fails.                                    |

The new regressions were run against the old guards before repair: ACL
acceptance/translation/receipt cases failed (7 failures in the initial
30-test file); the startup cleanup cases and reentrant-close case failed
(3 failing tests, including the original ENOENT reentrant cleanup failure).
The completed 12 deliberate red controls are appended as **45–56** in
[m98-cs-drills.json](m98-cs-drills.json): every red exits 1 with named failures,
every source restore is byte-exact by SHA-256, and every whole owning-file
rerun exits 0. Controls 51 and 54–56 additionally prove runtime localization,
propagation of cleanup errors other than ENOENT, no async repeat after
synchronous removal, and exclusive 0600 creation (`wx` =
`O_WRONLY | O_CREAT | O_EXCL`). No test-name filter or skipped case is used.
The installed macOS ACL cases are registered only on Darwin, so another OS
cannot count them as its own receipt.

**macOS ACL receipt:** macOS **15.7.4 (24G517)**, Darwin, UID **502**, Node
**v24.21.0**. An empty synthetic probe received `everyone allow` read/search
and inheritable grants via `/bin/chmod +a`. `/bin/ls -ledn` showed
`drwx------+` and `-rw-------+` with an allow ACE for Everyone
(`ABCDEFAB-CDEF-ABCD-EFAB-CDEF0000000C`); those ACEs survived chmod to
0700/0600. The actual tests repeat inheritance, direct file and late
file/directory grants and see refusal plus artifact deletion. Ordinary
creation returns `{ platform: 'darwin', ownerOnly: true, mode: 384,
extendedAcl: false }`; actual directory/file mode and UID checks pass.
The bounded fixed `/bin/ls` command receives only a path and a filtered
environment, with `LC_ALL=C`; no bearer is passed to it. The parser accepts
one expected mode line, optional `@` attribute marker, no `+` marker and no
ACL lines. Conservatively, owner-only or deny-only extended ACLs also refuse.
The translated error reads the installed `judgeNoAnswer` template at failure
and includes the technical code `EJUDGE_TOKEN_ACL`; no shared text key changes.

**Linux ACL receipt:** the earlier Kubuntu/Node v24.18.0, UID 1000 receipt
above verifies 0700/0600, owner UID, exclusive creation and one link; this
repair does not claim a new installed Linux run. **Windows ACL receipt:**
synthetic owner/protected-DACL cases rerun here, but installed Windows ACL
verification remains outstanding. No macOS result certifies either OS.
The `SIGKILL` crash-token regression remains green: hard kill cannot run
cleanup and leaves a private stale artifact, whose token fails on restart.

The existing raw-socket shutdown test now captures macOS ECONNRESET and
asserts that exact code if a reset arrives, as well as socket closure,
inference cancellation and token deletion. This fixes the previously
unhandled platform error without relaxing the shutdown assertions.

**Final source SHA-256:**

- serve: `fe97944a090595cf9596e8bfd288c1a50a0c8c036debd9f0466925f805c7ad39`
- tokenFile: `0a775136de1b5772da4f05f8cfd7481e8a47b6fcf257e64739a34402d3433f10`

**Residuals and shared handoff:** no RVM98CS P1/P2/P3 is left unfixed.
`CS-OS-INTEGRATION` remains a named receipt gap in PLAN §9: G/Z must collect
installed Windows and integrated CLI/VS Code/source receipts, refresh the
generated host inventory, and run the aggregate quality/package gates before
shipping. The modules remain unwired on this base, so this repair adds no
supported command or source. Z owns shared README/CHANGELOG and text files.
Prepared Unreleased note for its serialized integration: “The local judge
boundary refuses macOS extended ACLs and cleans up startup credentials on
fatal exit; shutdown stays idempotent when cancellation callbacks reenter.”
All model attempt counts remain **0 live, 0 paid, 0 local**.

Repair-commit checks on macmini: the three owning files pass **82/82**
(37 socket, 39 token/ACL, 6 installed process cases); all five typecheck
projects, scoped ESLint, changed-file Prettier and whitespace checks pass.
Localization passes **14 tables, 127 manifest strings, 431 source files,
0 problems**. Host API again exits 1 for the unchanged inherited inventory
mismatch detailed above (271 VS Code APIs, 18 importers; Node totals and
paidHost rows are unchanged by this repair). PLAN §7 records the explicit
Z refresh deferral. Aggregate quality remains with the lead under the rig
brief; it is not claimed green here.

### Post-commit lane gates

Implementation commit **96454696** completed its enabled Husky lint-staged
ESLint/Prettier and staged gitleaks checks (no leaks). All 12 source
restoration hashes still match the hook-on implementation byte-for-byte.
The worktree was clean after that commit and the production build.

All remaining lane gates ran directly on macmini, one heavy command at a time:

- `npm run typecheck:unit`: pass again after the final cleanup-test additions;
  all five projects had already passed with the final source changes.

- `npm run deadcode`: pass (plain knip); only the existing `vendor/**`
  configuration hint remains.
- `npm run cycles`: pass, no cycle over 403 entry-reachable files.
- `npx jscpd`: pass, **0 clones**, 856 files; no ignore or threshold change.
- `npm run build`: pass, including all **18 unchanged bundle caps**, bundle
  splits/model-text readers, host globals and third-party notices (83 bundled
  packages). All 18 production metafiles confirm neither boundary module is
  shipped on this unwired base; G/Z must repeat checks after wiring.

| Bundle           | Size / unchanged cap |
| ---------------- | -------------------- |
| extension        | 553.3 / 600 KiB      |
| Model API        | 426.4 / 475 KiB      |
| ACP              | 786.7 / 850 KiB      |
| webview JS       | 861.2 / 900 KiB      |
| English fallback | 105.9 / 125 KiB      |
| checkpoint store | 109.1 / 225 KiB      |

Host inventory is the sole attempted lane gate that exits 1: the inherited,
shared generated-document mismatch described in PLAN §7. Full quality,
coverage, accessibility and installed package/source matrices remain the
lead's integrated checks under the rig/shared brief. No merge, rebase, push,
external request or real model call occurred.
