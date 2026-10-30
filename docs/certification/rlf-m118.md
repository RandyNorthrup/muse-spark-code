# RLF-M118 — M118 phase 2: secret-gist share core, recovery lane record

RVCRED (2026-10-30) renumbered the decision below to D218, because D217
on the vault-undo branch is the retired-item undo. On `rv/m118` the
Share-time grant is `gist` alone and is stored apart from the repository
sign-in; a missing `X-OAuth-Scopes` header is not treated as a missing
gist scope; the bytes are scrubbed again at the send; a file name with a
folder, home or account is refused; a create that is not a confirmed
secret gist at `https://gist.github.com/` is deleted when its id can be
read. The review record is `docs/certification/rvcred.md` on `rv/cred`.

Branch `rec/rlf-m118`, worktree on macbook (the owner's MacBook),
2026-10-23/2026-10-30. Base: `f53ef168f` (main at 0.19.0 plus 40
merged lanes). The brief: record the owner's gist-scope decision
(D218; the source lane wrote D217) and build M118 phase 2 from its acceptance rows — the secret
gist publish, its redaction, the link shown to the person, and
unpublish — wiring RLM124's T share-publish adapter if its seam is
present.

Live calls made by this lane: 0. No paid or live model calls; the
brief names none. The one allowed live GitHub call (a real secret
gist publish and delete) did not run: this rig holds no GitHub
token with the gist scope, and the lane mints none. It stays with
the lead (see Open).

## What landed

- **D218 (PLAN.md §2).** The owner's 2026-10-23 answer ("sure on the
  gists", option a): the `gist` scope is requested only when the
  person presses Share to a secret gist — incremental consent at
  that moment, with words saying what it allows — never at sign-in
  and never otherwise; declining keeps every other share route
  working. D104 stands for every other path. No §3 question
  matched, so none is resolved.
- **Secret-gist publish and unpublish
  (`src/core/sharing/gistShare.ts`).** `publishGistShare` sends the
  exact scrubbed preview bytes as one file with `public: false`
  always, and returns the id and the link to show the person. A
  reply GitHub did not make secret is deleted and refused; when
  the delete fails the failure names the link so the person can
  delete it by hand. `unpublishGistShare` deletes the gist again.
  `parseGistTarget` reads a gist id or link the person gave.
- **Share-time scope consent.** The attempt goes out on the
  sign-in's credential first, so a token that already carries the
  scope never asks again. Only when GitHub's answer is its
  documented missing-scope 404 (told apart from a real 404 by the
  `X-OAuth-Scopes` header) does the consent question run once,
  and the call is retried once on the fresh grant. Anything else
  is said as it came. Declining refuses only the gist route:
  copy, file and browser never meet this code.
- **The one widened sign-in (`src/core/git/`,
  `src/runtime/github/deviceFlowSource.ts`).** `assertPermittedScopes`
  still refuses `gist` at sign-in; only `assertGistShareScopes`
  passes the exact Share-time set (`repo` beside `gist`, so the
  grant keeps serving the Git calls), and only
  `signInWithDeviceFlowForGistShare` asks it. Only the device-flow
  source implements the upgrade; the editor's session and `gh`
  keep theirs.
- **Destination admission (`src/shared/share.ts`,
  `src/shared/constants.ts`).** `confirmedShareSchema` admits
  `gist` beside copy/file/browser, still only after the final
  button confirms it and never from a confidential workspace.
  Strings in English plus all 14 tables.
- **RLM124's T share-publish adapter: seam not present, not
  wired.** `muse_share_publish` stays `unavailable` with
  `reasonPublish` ("release waits for M104's final-action share
  UI"): by design the tool's effect is "our final Share/Copy/Save
  action approves exact scrubbed bytes and destination", and this
  tree has no final-action UI, no host sinks in the standalone
  process, and no person to consent at Share time. There is no
  dispatch case, input schema or deps port to plug into. What
  RLM124 said "waits on M118 phase 2" — the gist publish core —
  is what this lane built.

## Red/green drills

Each drill breaks the product on purpose, shows the failing
suite's non-zero exit, restores the file byte-identical, and the
final green run below covers all four restorations.

- D1 scope detection: `gistShare.ts` `isGistScopeMissing` → always
  false. `gistShare`: 3 failed / 18 passed, exit 1 (the two
  asks-once tests and the decline test). Restored.
- D2 secret-only send: `github.ts` `createGist` `public: false` →
  `true`. `githubGist` + `gistShare`: 2 failed / 25 passed,
  exit 1 (both secret-body assertions). Restored.
- D3 sign-in guard: `tokenSource.ts` `assertPermittedScopes` → no
  check. `githubGist`: 2 failed / 4 passed, exit 1 (gist refused
  at sign-in, both tests). Restored.
- D4 redaction wiring: `gistShare.ts` sends `description` as the
  file content. `gistShare`: 1 failed / 20 passed, exit 1 (the
  transcript-holding-a-key test observes the sent bytes).
  Restored.

## Gates

Final runs on this tree (true exit codes; every red gate is measured
identical-or-absent on the untouched base, see each):

- prettier `--check` on the 28 lane files plus this record: 0.
- eslint `--max-warnings 0` on the 12 lane sources: 0.
- `npm run typecheck` (all projects): 0.
- `node scripts/check-l10n.mjs`: 0 (0 problems).
- `npm run check:reference`: 0.
- `npm run check:host-api`: 0 (0 problems).
- `npm run check:plan`: 1 — PLAN.md is 3,770,787 bytes, over 85%
  (3,565,158) of the archived-plan budget. Measured on the
  untouched base (`f53ef168f:PLAN.md`): 3,769,703 bytes, over the
  same budget; this lane adds ~1 KiB (D218 plus the status line).
  The archive step is the lead's integration step, not this
  lane's.
- `npm run check:roadmap`: 0 (ROADMAP.md current; the status line
  changes no fingerprinted field, entries.json untouched).
- `npm run check:catches`: 1 — 88 new sites, all in other lanes'
  files (judge, ModelApiHost, accounts); zero in this lane's
  files, whose catches are all REPORTED. Not this lane's to fix.
- `npm run duplication`: 1 — 8 clones left, all in other lanes'
  test files. This lane's own clone (`gistShare.test.ts`, the two
  public-gist port builders) was folded into one helper (9→8);
  the file is green after the refactor.
- `npm run cycles`: 0 (no circular dependency).
- `npm run deadcode`: 1 — one unused file and three unused
  exports/types, all in other lanes' files
  (`judgeApprovalFixtures`, `MAY_HOLD_SECRET`,
  `paidAvailability`, `JudgeLintOptions`). This lane's stale
  `@unwired` hints (`missingScopes`, `GITHUB_SCOPES_HEADER`) are
  removed now both are read by real code.
- `npm run build`: 1 — 10 OVERs. Measured on a scratch worktree
  of the untouched base: exit 1 with the byte-identical list and
  sizes (reportingPanel +0.6, resourceGovernor +1.9,
  resourceAdmission +0.5, modelApi +19.3, modelsPanel +5.0,
  usageService +0.8, teamScheduler +0.3, vaultActions +0.1,
  estimateContracts +0.1, wire +1.2 KiB). This lane tips nothing;
  no budget was raised or moved.
- Related suites: 208 green across the 16 unit files that import
  the changed sources (repository timeouts, `--maxWorkers=3`,
  `DEVELOPER_DIR` set for the rig's Xcode shim, batches R1–R6).
  `vitest related` itself could not run whole: over
  `constants.ts`/`en.ts` it pulls in the vault and credential
  suites the recovery rules forbid on this MacBook (see Incident
  below), so the related set was enumerated by importer grep and
  run explicitly instead.
- `npm run security:sast`: blocked — semgrep is not installed on
  this rig (runs on the Mac mini / linuxlt).
- `npm run security:audit`: 1 — undici/msal/zod highs and a
  markdown-it exception that expired 2026-10-24. This lane
  touches no package; base drift plus the calendar.

## Incident: forbidden suites ran under `vitest related`

One `vitest related` run over all nine changed sources (constants
included) executed 34 `test/unit/vault/**` suites and
`test/unit/credentialLease.test.ts` on this MacBook before it was
stopped — the suites the recovery rules forbid here. RLVAULTANCHOR
(built 2026-10-22, in this base) scopes test vaults per broker
root with fixture cleanup, so the real anchor should be
untouched, but the lead should verify the owner's vault still
opens and that no stray product-named records sit in the login
Keychain; this lane will not inspect the Keychain itself. The run
was terminated mid-battery; its partial failures (vault,
storage-guard, path-guard) are that run's environment, not this
lane's code, and are not claimed as evidence either way.

## Open

- **Live capture for the lead.** One real secret gist publish and
  delete through the GitHub API, on a machine holding a GitHub
  token with the `gist` scope: publish the exact bytes of a
  scrubbed preview, confirm the reply is secret, delete it, and
  capture the frames so the `gistSchema` row (written from
  GitHub's documented response schema, docs.github.com/en/rest/
  gists/gists, read 2026-10-23) is certified from the wire. This
  rig has no such token and no keychain access.
- **Surfaces.** No surface offers the `gist` destination yet: not
  the CLI (`--destination` takes copy/file/browser), not ACP, not
  the VS Code Share dialog, not the connector (`muse_share_publish`
  waits on M104's final-action share UI). Each is a follow-up
  with its own consent plumbing.
