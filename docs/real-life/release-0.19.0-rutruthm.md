# Real use: release 0.19.0 truth group (lane RUTRUTHM, macmini)

Version 0.19.0, group branch `realuse/0190-truth-m`: release/0.19.0 with the
eight group pull requests merged (#223, #233, #217, #161, #180, #235, #238,
#242). Base SHA `b7537ba6f`; fix commit SHA recorded at the end of this file.
Platform: macOS arm64 (Macmini), node v24.21.0, production `dist/` from
`npm run build` (exit 0). Only the packed product was driven, in an empty
scratch workspace under `temp/rutruthm/` with scratch HOME/XDG dirs; the
Muse Code backend has no sign-in in this sandbox, so every backend turn
stops at the environment gate and no model call was made (0 calls, $0.00
against 40 / $2.00).

## Packaging

- `npm ci`: exit 0. `npm run build`: exit 0 (budgets hold).
- `npm run package` (VSIX): FAILS here —
  `Error: Required Linux created-path helper excluded from VSIX: x64`.
  Needs `native/linux/{x64,arm64}/muse-created`, built only on Linux.
- `npm run package:acp`: FAILS here — first the Darwin helper, then the
  Linux helpers. `sh native/darwin/build.sh` succeeds here (swift present),
  which moved the failure to `Required Linux created-path helper is
missing: native/linux/x64/muse-created`. Same pre-existing CI-handoff
  prerequisites as PR #180's record, not group defects: the group touches
  neither packager. Real use below drives the production-packed `dist/`
  bundles (`node dist/acp.js`).

## Behaviour 1 — refused `providers add`/`providers test` name the codes (FAIL, fixed)

`providers add --preset ollama --as dead2 --address http://127.0.0.1:54321
--private-ok --model dead-1` (a closed port) and `providers test` on the
matching entry said, exit 1:

> Test failed: The provider could not be reached.

The 0.19.0 entry (lane PROVERRORS) promises the network codes and whether
the request arrived is unknown, and its record drilled byte-identically
this case on 2026-10-17 with the new sentence — so the merged group
regressed it. Cause, measured: the spend lane's endpoint pin
(`pinProviderFetch`, hunk from `e16c2de17`, merged into the group with PR
#217) converts ECONNREFUSED into `UserRefusalError(providerProbeUnreachable,
'not_sent')` before the transport's `sendFailure` reader can render the
codes, and `probeProvider` fell through to the fixed `'unreachable'`
reason. The PROVERRORS drill ran on a parallel line without that hunk.

Fix (`src/runtime/providersCommands.ts`): `probeProvider` recognises the
pin's refused-connection refusal (that message, with a cause that carries
connection codes) and renders it through the configured path's one reader
(`providerFailureReader.sendFailure`), the same sentence the turn path
reads. A refusal with no codes (Fetch-blocked port 9, "bad port") keeps the
fixed sentence, as the PROVERRORS record documents. Spend classification is
untouched: the refusal object keeps `'not_sent'`, and a refused `add`
writes nothing (config dir stays empty). New maintained test
`test/unit/providersProbeRefused.test.ts` drives the real resolver, pin
and transport against a really refused loopback port (bound, then closed);
it failed before the fix (`expected 'unreachable' to contain
'ECONNREFUSED'`) and passes after in 58 ms on the repo's own timeout. The
cold lazy-bundle transform (~4–13 s on this shared rig) is paid at
collection by two static warm imports, per the rig's timeout rule.
CHANGELOG line added under [0.19.0] Fixed.

After rebuild, for real, exit 1:

> Test failed: Could not reach dead2: the connection failed (fetch failed:
> ECONNREFUSED), so whether the request arrived is unknown; check the
> network and the provider address.

and the blocked-port case still says "Test failed: The provider could not
be reached." PASS (both), matching the record's drilled words.

## Behaviour 2 — no spending check without a limit you set (PASS)

`exec --output json "say ok"` on the Muse Code backend with no budget set
anywhere: no budget stop, no reservation. The JSON result is still written
(exit 3, `auth_required` — the sandbox has no CLI sign-in):
`usage.requests:null`, `paid.settledUsd:"0"`, `uncertainUsd:"0"`,
`limits.budgetUsd:null`, stderr `requests 0; settled $0.000000; uncertain
$0.000000`, and the data dir gains no ledger files. Nothing reserved,
locked or written before a send. `exec --backend modelApi` without
`--max-budget-usd` says "Model API requires --max-budget-usd." — the run
cap is the person's own explicit limit, none by default. PASS.

## Behaviour 3 — invalid numeric flags name their flag (PASS)

- `exec --max-output-tokens banana` → `Invalid number or limit for
--max-output-tokens.` exit 2.
- `exec --max-output-tokens 999999999999` → `--max-output-tokens exceeds
the output cap of 32768 tokens.` exit 2 (refused at parsing, never above
  the policy cap).
- `exec --timeout banana` / `exec --max-requests 0` → the same `Invalid
number or limit for --<flag>.` shape, exit 2. Never the USD budget's
  decimal places. PASS.

## Behaviour 4 — broken providers files say so (PASS)

- Garbage CLI user file: `providers list` → `Test failed: /…/providers.json`
  exit 1 (the {detail} slot filled); schema-invalid file →
  `Test failed: Invalid input` exit 1 (the reason, not the literal
  `{detail}`). `exec --backend modelApi --max-budget-usd 1 --provider bogus
--output json` → exit 2 with the same reason on stderr and no JSON on
  stdout — the established shape for provider-resolution failures (same as
  unknown-provider), not the refused-after-send class. PASS.
- Garbage data-dir file: `providers accounts list --provider meta` → `The
providers file is invalid, so its entries were refused and the file was
left unchanged.` exit 1. Directory as the data-dir file →
  `Accounts are unavailable (EISDIR: illegal operation on a directory,
read).` exit 1 — the terminal names the retained cause, as the #235
  entry promises. Fresh dir: `[{"id":"default",…}]` exit 0. PASS.

## Behaviour 5 — ACP legal scanner and playbook sentences (PASS)

- `legal` in the scratch workspace: full scan with its own finding (no
  LICENSE), exit 2 — no scanner blame. With `dist/legalScan.js` set aside:
  `The legal scan failed: legalScan.js could not be loaded`, exit 2, and
  only the load failure says it (bundle restored immediately after; `git
status` clean). PASS (#238).
- `playbook status`: settings table, exit 0. `playbook settings offload
off "…"` persists, exit 0. Journal directory read-only,
  `playbook settings offload on` (on takes no reason — my first attempt
  with a reason correctly failed parsing with the usage line): `The
playbook command could not be completed.` exit 1 — never "unavailable".
  Journal intact afterwards. PASS (#238).
- A live ACP session (`initialize` → `session/new`) is NOT reachable in
  this sandbox: `session/new` answers -32000 "Authentication required: Muse
  Code is not signed in" (no CLI sign-in, no key; credentials are never
  touched from a rig). So `/agents`, `/agents retry`, registry-denial and
  the panel Agent-map retry sentence (#242, editor-only: needs VS Code)
  could not be driven here; they are covered by code, the lanes' drills and
  the committed suites (`panelRetryTruth`, `accountErrorTruth`,
  `providerRefusals`, `playbookSurface` — all green below). Recorded as
  gated, not passed.

## Behaviour 6 — help surfaces (PASS)

- `estimate --help` lists `--by <date>: Deadline` and
  `--format <format>: Export`-style route words (deadline and export
  formats from the route's own reference). `help reference` opens the full
  terminal reference. Bare `--help` prints the compact agent help with the
  machine flags. PASS.

## Behaviour 7 — turn-path refusal and unpriced models (gated)

A provider refusal before answering at the turn level (invalid key) and the
`unpriced` status need a reachable provider or a listed model: the custom
loopback entry's models are not offered on the Model API backend
(`Model … is not available on this backend. Available models: .`), and
this sandbox has no key, browser or sign-in. Not reachable headless here;
the PROVERRORS record hit the same wall. The probe-level equivalents above
(book nothing, JSON still written on refusal) pass.

## Not user behaviour in this group

- #233 (claims-truth): docs only — README/CHANGELOG/roadmap wording. Read,
  no behaviour to drive.
- #223 (no-standins): test-only, plus the ResourceRegistry wait re-arm
  (a busy-exclusive-resource race needing two contending windows) — not
  triggerable headlessly here; its suite path is unchanged by this lane.
- #161 (catch-money) editor surfaces (sign-out holds, stale notices,
  OAuth-stop racing): need the editor; the invalid-usage-history repair
  warning needs a settings shape not reachable without a backend turn.
  Covered by the committed suites, all green below.
- The panel focus/restart-model behaviours in the Highlights: need VS Code.

## Gates (final tree)

- `npm run typecheck` (all projects): exit 0.
- eslint changed files `--max-warnings=0`: exit 0 (three errors found and
  fixed: `unicorn/prefer-ternary` in the new helper, two
  `no-confusing-void-expression` in the test).
- prettier changed files: exit 0. `node scripts/check-l10n.mjs`: 0
  problems (no new keys). `npm run check:reference`: current.
- `npm run check:plan`: 0 drift. `npm run check:host-api`: 0 problems.
- `npm run deadcode`: exit 0. `npm run cycles`: no circular dependency.
- `npm run duplication`: 0 clones.
- `npm run check:catches`: exit 1 — SWALLOW 48→51, GENERIC 186→202,
  CLEANUP 56→57. Not mine: my diff adds zero `catch` sites (verified with
  `git diff -U0`), so it cannot move these counts; the drift rides in with
  the group's merges. Left for the lead — regenerating the baseline would
  bless unclassified handlers.
- `npm run build`: exit 0, budgets hold.
- `security:sast`: NOT RUN — semgrep crashes in this sandbox
  (`ca-certs: empty trust anchors`, exit 2), same as the TRUTHACP lane
  recorded. Lead to run outside.
- `npm run security:audit`: exit 0 (2 advisories, both in exceptions).
- `npx vitest related --run src/runtime/providersCommands.ts`
  (repo timeout): 1 file, 1 passed.
- New `test/unit/providersProbeRefused.test.ts`: 1 passed (58 ms; seen
  failing before the fix).
- `providerRefusals` + `playbookSurface` + `accountErrorTruth`: 60 passed.
- `accountsCommand` + `accounts` + `panelRetryTruth`: 51 passed.
- `providersFlow` + `providersFileStore`: passed (in the 64 passed with
  the next line's file).
- `chatGptLocalFailures`: 18 passed, 2 timed out at 5000 ms (the two
  unreadable-providers-file cases) — measured identical on the untouched
  base: a clean worktree at HEAD with linked `node_modules` gives the same
  18 passed / same 2 timed-out, so this is pre-existing and environmental
  to this rig (cold session-client setup past 5 s), not this lane's
  regression. The two cases assert refusal sentences, not timeouts.

## Commits

- `9346a4b2a` fix(providers): refused probe names its connection codes
  again (+ test + CHANGELOG line). Hooks on; secret scan clean.
- [record commit to fill in]

## Model calls

0 calls, $0.00 against 40 / $2.00. Nothing reached a model: every refusal
was local (closed ports, unreadable files, no sign-in), and `exec`'s JSON
record confirms `requests:null`, settled and uncertain `$0.000000`.
