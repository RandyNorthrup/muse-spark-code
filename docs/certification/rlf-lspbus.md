# RLF-LSPBUS (2026-10-30): the `runtimeLsp` stall, and vscode-jsonrpc 10

Base `int/recovery` `dfcb45936`. Rig `linuxlt`, worktree
`/home/randy/lanes/RLF-LSPBUS`, branch `rec/rlf-lspbus`. Commits (hooks on,
no push): `4dcbfb36e` (Part 1 fixes), `4e5b9a6e6` (Part 2 bump), plus this
record. RLF-UPDEPS item B3 / drill D2 is the origin.

## Verdict

The session bus was never the cause. The stall was two defects in a chain:

1. **Product:** `supervise`/`stop` refused at startup in the lane sandbox
   (private-root check) and printed only `[error] Run failed: Error` — a
   designed refusal with no sentence a person can act on.
2. **Harness:** `vscode-jsonrpc` leaves a pending `sendRequest` unsettled
   forever when its server dies (measured on 9.0.3 **and** 10.0.0). Each
   supervise case therefore burned its full 240 s test timeout with the
   worker idle and no child in `ps`; three cases plus the build is the
   8–14 minutes of silence RLF-UPDEPS recorded.

Everything that does not need the missing pieces already worked without a
bus: the plain language server (all six `lsp` cases) is green with a real
bus, a bogus bus address and no bus, on both jsonrpc versions.

## Evidence: the bus is not a cause

All runs on this laptop, 2026-10-30.

- **Credential store probe** (real `@napi-rs/keyring` `AsyncEntry`, Linux
  `secret-service`, a service/account that do not exist; no stored secret
  was read): no bus variables set → fast `DBus error: Using X11 for
dbus-daemon autolaunch was disabled at compile time`; `DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/bus`
  → fast `Failed to connect to socket /nonexistent/bus: No such file or
directory`; `unix:path=/run/user/1000/bus` → `null` in 27 ms.
- **Packed language server** (`node dist/acp.js lsp`, production build,
  vscode-jsonrpc client): bus unset → initialize 318 ms, inline
  `{items:[]}`, exit 0 in 333 ms. Bus bogus, `--tab --trust-workspace`
  → request answered in 769 ms, stderr `The credential store could not
be read, so Tab reads no key` + `Tab quiet (no-key)`, exit 0. The step
  that needs the bus fails fast; everything else keeps working.
  `muse lsp` without `--tab` never reaches the store
  (`src/runtime/lsp/lspTab.ts:218` reads it only for an eligible paid
  request; `src/runtime/main.ts:1161` maps the failure to "no key").
- **Suite `lsp` block:** 6/6 green in all three bus conditions on both
  jsonrpc versions (runs below).

## Evidence: what actually stalled

Reproduced in this lane's own sandbox before any fix: full-file run gave
no test output; the vitest fork worker sat in `ep_poll` at ~1 s CPU with
**no child process and no server fds** (`ps`, `/proc/<pid>/fd`), and
Node-inspector evaluation showed only vitest IPC handles — no requests,
no timers. Bisect: the six `lsp` cases each pass in 0.5–1.2 s; the three
`supervise and stop` cases never answer `initialize`.

Why the supervised server never answered here, measured directly against
the built `dist/supervise.js`:

- `runSupervise` throws `EPRIVATE_ROOT` ("The private media root is not
  owner-only") in ~0.5 s. `verifyPosixAncestors`
  (`src/runtime/privateDirectory.ts:130`) walks **every** ancestor to
  `/`; inside the lane's bwrap user namespace (`uid_map` maps only
  1000→0) `/` is owned by the overflow uid **65534**, which is neither 0
  nor the user. The same walk also meets `775` (group-writable)
  ancestors on this rig. An escalated (unsandboxed) run stays in the
  same namespace and refuses identically.
- Behind that, latent: the control-socket path under the data folder
  here is **197 bytes** against `SUPERVISE_SOCKET_PATH_MAX_BYTES = 103`
  (`src/runtime/supervise/supervisor.ts:74`), because the lane `TMPDIR`
  alone is 128 chars. `SuperviseEndpointError` would fire next.
- Both reached `main`'s generic handler: packed `dist/acp.js stop` and
  `supervise lsp` printed `[error] Run failed: Error`, exit 1, ~0.5 s.

Why the harness then hung instead of failing: a scratch probe driving
`vscode-jsonrpc/node` against a child that prints to stderr and exits 3
showed `sendRequest('initialize')` still pending after 10 s — on 9.0.3
and, re-measured after the bump, on 10.0.0 (`STILL-PENDING-AFTER-10S`).

The sandbox sets `DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/lane-has-no-session-bus`
(see the bwrap command line in `ps`) — the correlation RLF-UPDEPS
reported; the same sandbox also supplies the user namespace and the
long `TMPDIR` that actually cause the refusal.

## Fixes

- **Product (`4dcbfb36e`):** `src/runtime/supervise/superviseEntry.ts`
  catches the two named refusals (`PrivateRootRefused`,
  `SuperviseEndpointError`) narrowly in `runSupervise` and `runStop`,
  prints a sentence naming the problem and the remedy
  (`supervision.recordsFolderNotPrivate`,
  `supervision.endpointPathTooLong`, in English plus all 14 tables;
  `node scripts/check-l10n.mjs` 0 problems) and returns
  `CLI_EXIT.failure`. Everything else still throws to its own report.
  The refusal itself is unchanged (records carry each run's stop token;
  privacy is the design, D84 lane H).
  Packed proof after the fix: `dist/acp.js stop` prints
  "Supervision keeps its records in a folder only you can write to, …"
  and exits 1; `supervise lsp` logs the same on stderr and exits 1 in
  534 ms.
- **Harness (`4dcbfb36e`):** `test/unit/runtimeLsp.test.ts` races every
  request against the child's exit (`answer()`), failing at once with
  `the language server exited (1) before answering: <stderr>`. Every
  assertion is unchanged; no timeout was raised.
- **Regression test:** `test/unit/superviseRefusal.test.ts` (2 POSIX
  tests, real entry functions, real 0777 ancestor, the agent's own
  `stderrLogger`) pins the sentence + failure exit for both commands.
  The endpoint-too-long sentence is not reachable end-to-end inside a
  lane sandbox (the private-root refusal fires first); it rides the
  same one-line mapping and is named here as unproven in-lane.

## Drills (red → green, observed)

- **D1 product:** with `superviseEntry.ts` reverted to base,
  `test/unit/superviseRefusal.test.ts` fails both tests (exit 1,
  uncaught `PrivateRootRefused` from `privateDirectory.ts:207`).
  Fix restored (patch re-applied): 2 passed (35 ms of tests).
- **D2 harness:** with `runtimeLsp.test.ts` reverted to base, the
  supervise case produced **no test result after the build plus >60 s**
  (log: RUN banner only; worker 1 s CPU) and was killed by the operator.
  With the fix, the same case fails in **665 ms** with the child's
  stderr quoted, sentence included.
- **D3 dead server:** the scratch probe above — pending ≥10 s on 9.0.3
  and on 10.0.0; the reason the harness needs its own race on either.

## Part 2: vscode-jsonrpc 9.0.3 → 10.0.0 (`4e5b9a6e6`)

Dev dependency, exact pin; only consumer `test/unit/runtimeLsp.test.ts`
(five imports from `vscode-jsonrpc/node`). No `peerDependencies`;
`engines.node >=14.17.0` (9.0.3: `>=14.0.0`; repo floor 22). The
[10.0.0 release](https://github.com/microsoft/vscode-languageserver-node/releases/tag/release/jsonrpc/10.0.0)
carries no notes body (API `body: null`, checked 2026-10-30); the
monorepo changes RLF-UPDEPS identified (connection close/`onClose`,
`RAL().crypto.randomUUID()`) touch nothing the suite imports, and
`typecheck:unit` passes. Lockfile diff is the one package (version,
resolved, integrity, engine line). No D3 table row names this test-only
pin; this record is its reason.

Full-file suite results (repo timeouts, `--maxWorkers=3`; durations
include the shared production build):

| Run                              | Result              | Duration |
| -------------------------------- | ------------------- | -------- |
| 9.0.3, bus unset, `lsp` block    | 6 passed            | 65 s     |
| 9.0.3, supervise case 1          | failed-fast 665 ms  | 92 s     |
| 10.0.0, bus unset                | 6 passed, 3 failed* | 168 s    |
| 10.0.0, bus `/nonexistent/...`   | 6 passed, 3 failed* | 147 s    |
| 10.0.0, bus real (`/run/...`)    | 6 passed, 3 failed* | 155 s    |
| 10.0.0, escalated, `TMPDIR=/tmp` | 6 passed, 3 failed* | 198 s    |

\* The same three supervise cases, each failing in 0.7–2.0 s with the
private-root sentence — the sandbox refusal above, identical on 9.0.3,
proven unrelated to the bus and to the jsonrpc version.

**Landing caveat, explicit:** a 9/9 green full-file run was **not**
obtained in this lane and cannot be obtained from any lane sandbox on
this rig (user-namespace overflow-uid ancestors; see above). The bump
is committed with the bus-relevant surface measured green on both
versions; **the lead's merge must be gated on hosted CI showing
`runtimeLsp` 9/9** on this branch. If CI is red there, the bump is a
one-line revert (`4e5b9a6e6`).

## Findings left for the lead (not fixed here)

1. `verifyPosixAncestors` refuses inside **any** rootless user
   namespace (overflow-uid ancestors), which includes rootless
   containers — a named product home (Muse Node). Accepting
   non-writable overflow-owned ancestors is a security-posture call
   for PLAN, not a lane change. Supervise, stop and every
   `openPrivateRoot` consumer inherit this.
2. The supervisor's control socket lives under the data folder, so a
   deep home/`XDG_DATA_HOME` (path + `/supervised/<16>.s` over 103
   bytes) cannot supervise at all. Now it says so; a shorter endpoint
   home (e.g. a private folder under `XDG_RUNTIME_DIR` where the
   platform has one, as `namedLock.ts` already does with `/tmp`) is a
   design option for the lead.
3. `muse.stop` inside the language server still shows the editor one
   failure **word** (`failureOf(error).word`,
   `src/runtime/lsp/server.ts:307`), not the sentence, when the same
   refusal hits there.

## Gates (final tree, exit codes)

- prettier --check (touched files): 0. eslint --max-warnings 0
  (touched files): 0. `npm run typecheck` (all projects): 0.
- `node scripts/check-l10n.mjs`: 0 (0 problems). `check:reference`: 0.
  `check:host-api`: 0. `check:plan`: 0. `check:roadmap`: 0.
- `check:catches`: 0 — after reshaping: the first form (a
  `refusalOf(error)` helper) classified GENERIC (168→170, exit 1);
  the named `instanceof` checks now stand in each handler (NARROW)
  and the baseline is untouched.
- `npm run duplication`: 0 (0 clones). `npm run cycles`: 0.
  `npm run deadcode`: 0.
- `npm run build`: 0. First run failed: `dist/uiText.js` 128,017
  bytes vs the 125 KiB budget — the two new English sentences.
  Shortened by ~60 chars total (same meaning; translations already
  said it that way) and the build is green with the budget unraised.
- `npm run security:audit`: 0 (7 advisories, 0 exceptions).
  SAST (`SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`): 1 —
  the same 6 blocking findings in the same 5 files RLF-UPDEPS
  measured on the base (`os/build.py`, `os/pi/compose.py`,
  `scripts/build-packs.mjs`, `src/core/backends/modelapi/mcp/headers.ts`,
  `src/runtime/node/keyStore.ts`); this lane's diff over those paths
  is empty.
- Packages: universal `npm run package` / `package:acp` cannot
  complete on one OS by design (other platforms' native helpers).
  Targeted: `node scripts/package-vsix.mjs --target linux-x64`: 0
  (VSIX 4,275,819 bytes, budget 4,915,200; needed the pinned
  `zopfli==0.4.3` from `.github/vsix-compress/requirements.txt` in a
  project `.venv`, removed after). `node scripts/package-acp.mjs
--target linux-x64`: 0.
- Suites: `superviseRefusal` 2/2; `vitest related
src/runtime/supervise/superviseEntry.ts` 2/2 (exit 0);
  `runtimeLsp` table above. `privateDirectory.test.ts` has 3 POSIX
  failures in-lane ("makes a real 0700 root…") in code and tests this
  lane did not touch — the same measured user-namespace cause as
  Finding 1; they are part of what hosted CI must show green.
- Packed final check on the shipped build: `dist/acp.js lsp` with a
  bogus bus and `--tab` initializes in 397 ms, answers, exits 0
  (store read fails fast into `Tab quiet (no-key)`).

Sandbox note: `strace -p` in-lane is `Operation not permitted`
(ptrace); diagnosis used `ps`, `/proc` and the Node inspector
instead. No workaround was built; none was needed. Temporary probe
folders this lane created under the lane `TMPDIR` were removed.
