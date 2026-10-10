# M108 lane X — Developer options and local profiles (kubuntu, 2026-10-06)

Base `76c1231e8` (lane 0 + K + T + P with review fixes), branch `m108/x`.
Read PLAN.md D88 and M108 in full, the lane-X placement amendment, the owner
rulings (2026-10-04 enhancements on by default; 2026-10-06 one account per
provider per device by default, developer options for testing, clearly
labelled, off by default), common.md, AGENTS.md and the gotcha register.
No live or paid calls; no network; no new dependency.

## What lane X owns

New `src/shared/developerOptions.ts` (machine-state, snapshot, request,
reply and audit zod schemas), `src/core/developer/` (the single
machine owner `developerOptions.ts`, the isolated-profile supervisor
`localProfiles.ts`, the host-neutral surface controller `surfaces.ts`),
`src/runtime/developer/` (the strict terminal parser `developerCommand.ts`,
the owner-only state/audit/profile-folder store `localFiles.ts`),
`src/webview/developer/` (the lazy page and badge `DeveloperOptionsPage.tsx`
plus `developerOptions.css`), six unit test files plus
`test/unit/helpers/developer.ts`, and this record. Shared regions:
`constants.ts` (named `DEVELOPER_*` constants, command/setting ids),
`en.ts` plus all 14 `l10n/ui.*.json` with real translations, PLAN.md
(the §8 escape-hatch row) and the minimal `[Unreleased]` note.
The visible setting, palette command, version-click binding, `/help` rows
and badges are host-neutral ports and metadata; W/H/U/D own the entry
points, package manifest and build wiring, which X never edits.

Acceptance mapping (every item has a failing-first test):

- Off by default; unlock paths converge (`developerOptions.test.ts`:
  starts locked, palette/terminal unlock, seven-click window, separate
  explicit confirmation for the visible setting).
- Confirmation cannot be bypassed: page payloads carry no authority
  (`developerContracts.test.ts` refuses page-owned authority, credentials
  and paths; `developerSurfaces.test.ts` refuses direct page unlock and
  spoofed confirmations).
- Expiry/Reset fence pending I/O (`developerOptions.test.ts`: late-enable
  invalidation, stale-write publication, pending-check fencing, late-launch
  ledger, denied-Reset semantics, failed-stop persistence).
- Distinct resources and local-device admission per profile
  (`localDeveloperProfiles.test.ts`: own credential slot, folder, process
  and device id; stale-authority refusal at every boundary; failed-stop
  retry; recorded-only cleanup).
- No key crosses UI/audit/process boundaries (`developerContracts.test.ts`
  credential-bearing rejects; `developerLocalFiles.test.ts` symlink, link
  and parent-junction refusal; audit holds fixed action words and opaque
  profile ids only).
- Machine binding, no expiry extension, expiry retains state while stopping
  processes, Reset deletes only recorded profiles and never ordinary
  accounts (the owner touches only its own ledger; account add/remove stays
  with K).
- All 14 languages (`node scripts/check-l10n.mjs`: 0 problems).
- Lazy UI under its own 25 KiB cap on the shared runtime
  (`developerOptionsPage.test.tsx`: 5,241 source bytes; no `react-dom`,
  no direct EN-table import; React and the installed table come from the
  caller). W owns the chunk wiring and enforces the cap at build time.
- `/help` rows, badge and status text from installed localization
  (`developerSurfaces.test.ts`, page tests).

## Red drills

Each drill broke one guard, ran the named test file with the repository
default timeout (`-t` filtered to the named regression, at most three
workers), saw it fail, and restored the file byte-exact (SHA-256 checked
against `/tmp/m108x-baseline.sha`; all seven implementation files report
OK after every drill).

| Drill | Break                                                                                  | Named failing test                                                                             | Result                                                   |
| ----- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| D0    | drop the locked check before the `multiple` confirmation                               | `starts locked and refuses multiple accounts and profiles before unlock`                       | 1 failed / 17 skipped                                    |
| D1    | `versionClick` always returns instead of unlocking at 7 clicks                         | `requires seven version clicks on the same surface within the complete time window`            | 1 failed / 17 skipped                                    |
| D2    | `assertCurrent` ignores a stale fence                                                  | `fences a pending account check before it can create a profile`                                | 1 failed / 17 skipped (1,011 ms, inside the 5 s default) |
| D3    | `developerProfileSchema` non-strict, so `secret`/`stateFolder` strip instead of reject | `rejects invalid or credential-bearing machine state` cases 11–12                              | 2 failed                                                 |
| D4    | remove the remote-surface authority refusal                                            | `lets a companion display state but refuses every authority-changing request`                  | 1 failed / 16 skipped                                    |
| D5    | accept terminal words past the command arity                                           | `has strict terminal commands without a credential or authority argument`                      | 1 failed / 16 skipped                                    |
| D6    | `remove` recurses instead of unlinking a profile link                                  | `unlinks a profile symlink or junction without touching its target`                            | 1 failed / 7 skipped                                     |
| D7    | constant shared credential slot for every profile                                      | `gives each account its own credential slot, folder, process and local device`                 | 1 failed / 7 skipped                                     |
| D8    | `import 'react-dom'` in the lazy page                                                  | `keeps the lazy UI under its own budget on the shared runtime`                                 | 1 failed / 4 skipped                                     |
| D9    | `now <= expiresAt` instead of `<`                                                      | `expires at the exact boundary, withdraws admission immediately and retains profile ownership` | 1 failed / 17 skipped                                    |
| D10   | Reset deletes without asking                                                           | `denied Reset still stops profiles but never deletes resources`                                | 1 failed / 17 skipped                                    |
| D11   | publish state before the audit append, with no rotation pre-check                      | `keeps existing state off when the audit cannot be appended`                                   | 1 failed / 7 skipped                                     |

D11 finding: defeating only one layer is not enough. Writing an empty
audit row still fails at the journal open, and swapping the order still
fails at the rotation pre-check (`regularFile(auditPath)` on a directory).
The test fails only when both layers are removed, so the audit-first
ordering and the rotation pre-check are independent guards for the same
property (a failed audit append never enables developer access).

## Gate receipts (kubuntu, this worktree, default timeouts)

- `npx vitest run` on the six owning files, at most three files/workers:
  23 + 18 + 17 + 8 + 8 + 5 = **79 passed** (final full-file runs after all
  drills and restoration).
- `tsc -p tsconfig.json`, `src/webview/tsconfig.json`,
  `test/unit/tsconfig.json`: clean.
- `eslint --max-warnings=0` on all 13 lane source/test files plus
  `constants.ts`/`en.ts`: clean (75 pre-existing style errors in the
  inherited files were fixed without behaviour change; one logged
  `eslint-disable` for `unicorn/prefer-promise-with-resolvers`, PLAN.md
  §8 row, because Node 20 on the extension host lacks
  `Promise.withResolvers` — the M62 pattern every other lane uses).
- `prettier --check` on all touched files: clean.
- `node scripts/check-l10n.mjs`: 14 tables, 164 manifest strings,
  613 source files; **0 problems**.
- `npx knip`: exit 0 (only the two pre-existing configuration hints).
- `npm run build`: exit 0; no cap raised (extension 440.3 KiB against its
  600 KiB cap; the `developer` strings stay in the core English table,
  matching no lazy region, so no region regresses to empty).
- `npm run check:host-api`: 1 problem, all from lane-X additions
  (`node:crypto` for the atomic state write; `node:fs`/`node:fs/promises`/
  `node:path` counts; `developerOptions.css` in the theme-variable
  sources). The generated record is W-owned, so X does not regenerate it:
  handoff `X-W-HOST-API-RECORD` below.

## Integration handoffs (named, no fake implementation in production)

- `X-W-HOST-API-RECORD`: regenerate the host API record at integration
  (sources above); no VS Code API or Node built-in beyond those.
- `X-W-BUILD`: wire `src/webview/developer/DeveloperOptionsPage.tsx` as
  its own lazy chunk with its own 25 KiB budget; never raise a cap.
  Source measures 5,241 bytes and imports only `react`, installed
  `UI_TEXT`, the shared schemas and `fill`/`formatDateTime`.
- `X-W/U/H-BINDINGS`: the visible setting
  (`museSpark.allowSeveralAccountsOnThisPc`), the palette command
  (`museSpark.developerOptions`), the seven-click version binding,
  `developerHelpRows` for `/help` and settings text, `developerBadge` on
  every surface, terminal `developer …` via `runDeveloperCommand`, and the
  machine-setting restore-from-snapshot rule. No `featureCatalog.ts` exists
  on this base; the three help rows (command id, `developer`, setting id
  with title and description) are listed here for W to catalogue.
- `X-M109/K-CREDENTIALS`: `LocalProfilePorts.credentials.prepare/remove`
  must bind the profile slot to the real OS/VS Code credential store; no
  credential is read, copied or passed to the child in lane X code.
- `X-P/M-ADMISSION`: `LocalProfilePorts.pool.register` admits each local
  device through the account pool; `checkAccount` must refuse unsupported
  products and unbound/absent accounts (K for entry, P/M for vendor
  eligibility). Vendor policy, paid consent, budgets, replay and Muse
  Code's capture requirement are unchanged and untested here by design.

## Residuals

None in lane scope. The §7 host-api record regeneration and the W/H/U/D
bindings above are integration work, not lane defects. Installed nothing;
no credential read, stored or printed; no paid or live model call.
