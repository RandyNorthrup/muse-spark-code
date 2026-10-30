# RLF-MACCRED: the macOS Muse credential file reads as recognised (RLF-HARVEST B4/H9)

Base `lanes/rlf-harvest` 0eaf17293 (contains `int/recovery` tip
dfd8865a9). Lane branch `rec/rlf-maccred`. Machine: the Mac mini
(`Macmini.ivettnet`, darwin arm64). Date: 2026-10-30.

## The defect (H9)

All 96 macOS lanes log `credential file unrecognized`; all 75
Linux/Windows lanes log `inline`. On macOS the sign-in state therefore
falls back to asking the Muse Code CLI on every start, instead of
reading the file's structure. `credentialFileVerdict`
(`src/core/backends/musecode/credentialFile.ts`) refused the macOS
v1-inline shape as never captured (the review of PR #49).

This lane found why every macOS lane hit it: this Mac mini's own
`~/.config/muse/auth.json` (1083 bytes) is a version-1 file whose
`meta` entry holds the credential inline (`access_token`,
`obtained_via`, `mechanism`, `api_key`, `api_base_url`,
`subs_active`, `user_full_name`, `user_email`, `user_avatar_url` —
key names read 2026-10-30, never a value). That is exactly the shape
the parser placed everywhere but darwin. `subs_active` (boolean) is
new against the September granted capture.

## Captures (2026-10-30, Muse Code 1.4.11-R6667.1, darwin)

Method (as `docs/certification/sign-in-detection.md`): one fresh
`mkdtemp` home per shape under the lane's gitignored `temp/`,
holding `HOME`, `USERPROFILE` and every `XDG_*_HOME`;
`META_API_KEY`, `TBH_CREDENTIAL_BACKEND` and `MUSE_AUTH_PATH`
removed; every proxy variable at the dead `127.0.0.1:9`. The pinned
binary was driven directly (`muse-bin-1.4.11-R6667.1 serve`) over
`@muse-code/sdk` 1.4.11: `initialize` with `experimentalApi`, one
`account/read`, close. No session started, no sign-in or sign-out
made, 0 model attempts by construction (only `initialize` and
`account/read` were ever sent). `museHome` verified inside the
throwaway home for every case; the machine's real `auth.json` only
`stat`ed (1083 bytes, mtime unchanged before and after every run);
every home deleted and checked gone. `account/read` answers were
recorded as state word + `credentialRequired` + key names only (the
`label`/`avatarUrl` keys noted, their values never kept).

`muse auth set` itself was NOT run on macOS: it may store into the
login Keychain, which this lane must never modify (a dummy write
could clobber the rig's real item). The v1-inline case uses the
auth-set shape as captured on Windows/Linux. Only 1.4.11 is
installed on this rig; 1.4.7 (the lanes' Linux/macOS pin) was not
available here, so the captures name 1.4.11. F94's macOS 1.4.10
synthetic-shape probes corroborate the two inline rows.

| Shape given to `serve`                                                     | `serve`                                                | `account/read`                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| no file (control)                                                          | starts                                                 | `loggedOut`, `credentialRequired: true`    |
| v1 logout shell (control)                                                  | starts, file untouched                                 | `loggedOut`, `credentialRequired: true`    |
| v1 `meta` with `api_key` alone (the `auth set` shape)                      | starts, file untouched                                 | `apiKey`, `credentialRequired: true`       |
| v1 browser shape (this Mac's key layout incl. `subs_active`, dummy values) | starts, file untouched                                 | `accountLogin`, `credentialRequired: true` |
| empty v2 `{"schema_version":2,"providers":{}}`                             | starts (no exit 3, no Keychain prompt), file untouched | `loggedOut`, `credentialRequired: true`    |

`stderr` stayed empty except the browser-shape case (startup
model-catalog fetch failed against the dead proxy; automated
reviewer unavailable — both name no path or account).

Fixtures (synthetic structures, placeholder values):
`test/fixtures/maccred/v1-auth-set.json`,
`test/fixtures/maccred/v1-browser-login.macos.json`,
`test/fixtures/maccred/v2-empty.json`, with capture date, CLI
build, command, isolation and the results table in
`test/fixtures/maccred/provenance.json`.

## What changed

- `src/core/backends/musecode/credentialFile.ts` — the captured
  inline entry (no `storage` lane, string `api_key`) now reads
  `inline` on darwin too, exactly what the captures prove. An
  empty v2 file on macOS stays `unrecognized`: serve starts with
  it and answers `loggedOut` here, but whether a Keychain item
  could sign such a file in is uncaptured (this lane could not
  read Keychain presence — the `security` probe is blocked in the
  lane sandbox — and must never modify it), so the CLI is still
  asked. Comments cite the captures.
- `src/host/auth/cliAccount.ts` — comments only: the file now
  settles a captured inline credential as signed in on every OS.
  No logic change was needed (`FILE_SIGN_IN` maps `inline` to
  `signedIn` platform-independently), so on macOS a v1-inline
  file no longer starts a CLI probe at all — the faster start.
- `test/unit/helpers/credentialShapes.ts` — removed
  `capturedInlineVerdict`/`SHIPPED_PLATFORMS`: their only
  consumer was the test rewritten here, and the e2e they served
  is deleted.
- `test/unit/credentialFile.test.ts` — the captured shapes read
  `inline` on win32/linux/darwin; a new per-OS table over the
  three fixtures pins `inline`/`inline`/`inline` for the two v1
  shapes and `unsupportedHere`/`unsupportedHere`/`unrecognized`
  for empty v2; the narrowed shapes (non-string key, token
  without key) stay `unrecognized` on all three OSes, pinning
  that the darwin change is exactly the captured shape.
- `CHANGELOG.md` — one `[Unreleased]` Fixed entry in the
  person's words.
- No `PLAN.md` change: no open milestone owns the CLI
  credential-file read (M23 is archived; F94 and RLF-HARVEST set
  the precedent of record + changelog for this scope).

A person reaches it by starting the app on macOS with the Muse
Code CLI signed in: the sign-in reads straight from the file,
and the start log names `inline` instead of `unrecognized`.

## Drills (repository timeouts throughout, `--testTimeout` never used)

- Red first: the rewritten `credentialFile.test.ts` against the
  unchanged verdict → 5 failed (the darwin `inline` assertions),
  26 passed.
- Green: after the one-line verdict change → 31 passed, exit 0.
- Break-on-purpose: the `!isMacOs &&` guard restored with a
  `DRILL-BROKEN` marker → exit 1, exactly the same 5 tests fail;
  restored byte-identical (`diff` clean), green again, 31 passed.
- Start proof through the real code path: `readCredentialFile`
  (bundled from `src` with esbuild, no edits) over this Mac's
  own file on darwin → `verdict=inline`, i.e. the start line
  `muse serve credentials: the CLI's own (credential file
inline, META_API_KEY in the environment absent); the
extension's stored key is not passed`. Structure only; no
  value printed, logged or stored at any step.

## Gates on the final tree (macmini, direct)

Exit 0: prettier `--check` and `eslint --max-warnings 0` on every
touched file, `npm run typecheck`, `node scripts/check-l10n.mjs`
(0 problems), `npm run check:reference`, `npm run check:host-api`
(0 problems), `npm run check:plan` (241 milestones, 0 drift),
`npm run check:roadmap` (241 entries, current),
`npm run check:catches` (counts match baseline),
`npm run duplication` (0 clones), `npm run cycles` (none),
`npm run deadcode` (exit 0; 4 unused-tag hints in files this
lane never touched), `npm run build` (all budgets hold),
`npm run security:audit`, `credentialFile.test.ts` 31 passed.

`vitest related` over both changed sources: credentialFile 107
files / 1002 tests passed, cliAccount 104 files / 945 tests
passed; the single failing file in both runs is
`test/unit/providerHeadersStore.test.ts` (3 tests), which fails
identically on the untouched base (worktree at 0eaf17293, same
command): `A default keychain could not be found` — the headless
lane sandbox has no default keychain. Measured pre-existing,
not this lane's.

SAST (macmini form
`SSL_CERT_FILE=/etc/ssl/cert.pem SEMGREP_ENABLE_VERSION_CHECK=0
npm run security:sast`): exit 1, the same six untouched-file
findings RLF-HARVEST named on int (none in a file this lane
touched); the lead owns them.

Not run: integration and a11y suites (no UI surface changed),
vault suites (nothing here touches the vault).
