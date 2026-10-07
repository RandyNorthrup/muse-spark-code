# Contributing

Thank you for helping. This repository is run by its planning document:
`PLAN.md` holds the decisions, the open questions, the milestones and the
definition of done, and `AGENTS.md` holds the working rules every change
follows. Read both before a change of any size.

## Setting up

```sh
git clone https://github.com/RandyNorthrup/muse-spark-code.git
cd muse-spark-code
npm ci
npm run build:dev
```

Press F5 in VS Code to start an Extension Development Host with the
extension loaded; `npm run watch` rebuilds on save. The Muse Code CLI and a
Meta Model API key are optional: the unit tests run against fakes, and the
sign-in gate explains what is missing.

New UI surfaces ship in their own lazy chunks, loaded on first use, with
accessible loading, an honest failure and retry, and a measured budget of their
own (D6). Keep startup and the original deferred aggregate for first paint and
retain their existing caps; chat, composer and approvals remain eager.

## Before you open a pull request

Use this order for a candidate branch:

1. Integrate the planned milestones onto the current `main` in order. Resolve
   conflicts and stage the candidate with no unstaged changes. Record its
   `git write-tree` hash.
2. Run `npm ci` and `npm run quality` on that exact staged tree. Hosted CI
   is the platform gate: the merge queue runs every OS once on the commit
   that lands, so the maintainer's Mac mini, Kubuntu VM and Windows 11 VM
   serve targeted runs and reproductions only (the affected real
   filesystem, process and packaging paths, temporary-directory aliases and
   Windows short names), never a full suite before each push. Record the
   tree hash, OS and tool versions, commands and process exit codes of any
   such run.
3. Have an independent agent review the staged diff and acceptance evidence.
   Scan the staged changes for secrets too: local `security:secrets` scans
   committed history, so it cannot see the index before commit. Fix findings,
   restage, and repeat the full local gate, staged secret scan and affected
   platform checks. Commit only after the final tree passes; verify the
   commit's tree matches the tested `git write-tree` hash.
4. Push the reviewed commit to its feature branch and open one pull request.
   Its `pull_request` event starts the fast Ubuntu tier (the full tier until
   the merge queue is on; see below). Do not also dispatch `ci.yml` manually
   for the same commit; `workflow_dispatch` remains available for an explicit
   full branch check without a pull request.
5. Use `gh run watch RUN_ID --exit-status`, then
   `gh run view RUN_ID --json headSha,jobs`. Match `headSha` to the pushed
   commit and inspect all seven required conclusions. After the PR checks and
   review pass, choose **Merge when ready** (`gh pr merge N --merge`) to put
   the PR in GitHub's merge queue. The `merge_group` event runs the full tier
   once on the merge commit that will become `main`; the queue merges it only
   if all seven pass, and removes the PR otherwise. Fix failures and repeat
   from the exact-tree gate; later branch changes need fresh PR checks and a
   fresh queue entry. Do not merge `main` into a PR just to refresh it: the
   queue tests the combination itself.
6. Add the PR run and the queue run (IDs and SHAs), the required conclusions,
   independent review, and any unproved platform or live gate to the PR
   proof. A printed success line without the process exit status is not a
   gate result.

- Run `npm run quality` and make it green. It runs every local gate except
  the VS Code integration tests (`npm run test:integration`, run by
  `npm run quality:ci` and CI): formatting, ESLint (zero warnings),
  stylelint, the PowerShell lint, type checks, the localization and host-API
  checks, dead-code and cycle detection, duplication, unit tests with coverage thresholds, the
  production build with bundle budgets and the bundle split, `npm audit`,
  the accessibility gate, secret scanning and semgrep. CI's full tier runs
  the gates on Ubuntu, Windows and macOS, the complete accessibility gate on
  Ubuntu and integration tests on Ubuntu and Windows, and gitleaks and
  semgrep as jobs of their own; the PowerShell lint runs only where Windows
  PowerShell exists, so a green run on one platform is not quite the whole
  set.
- Add or change tests with the code. A new check must be seen to fail once
  on purpose; the certification records under `docs/certification/`
  show how that is written down.
- Build what Muse Code or the Model API sends from a captured frame, not a
  guess (AGENTS.md rule 13). A capture runs a few short turns in an empty
  folder on a contributor model, writes every notification to a file, and
  counts the model attempts in the CLI's trace log afterwards;
  `docs/certification/m43.md` shows one. Frames several test files use go
  in one helper, trimmed but otherwise as captured
  (`test/unit/helpers/m46Capture.ts`), and the fake CLI in `test/e2e`
  answers in the same shapes. The CLI's credential file is the same: its
  captured shapes, with placeholders for every secret, are in
  `test/unit/helpers/credentialShapes.ts`, and a test that needs a shape
  nobody captured says so in a comment.
- Update `CHANGELOG.md` (Keep a Changelog, under `Unreleased`), the README
  where behaviour changed, and `docs/PRIVACY.md` when anything new leaves
  the machine. A change users should try can add a bullet to the section's
  `### Highlights` list, which What's New shows after the update (at most 5
  per release; `docs/RELEASING.md` has the form and the `<!-- try: … -->`
  button).

- A visible change gets a harness scenario (`test/harness/index.html`, its
  name listed in `scripts/lib/harnessServer.mjs` beside the related one),
  rendered with `npm run harness:shots -- <names>` (`--theme=dark`, `light`,
  `hc-dark` or `hc-light`; `--lang=pseudo` for clipping) and checked with
  `node scripts/a11y.mjs <names>` in the four themes. The M87 scenarios:
  `context-meter`, `context-meter-warning`, `context-meter-full`,
  `palette-tips`, `slash-tips`, `stop-running`, `tool-io`,
  `tool-io-expanded`, `status-heartbeat`, `status-heartbeat-narrow`,
  `steps-summary`, `steps-summary-open`, `todo-collapsed`, `tasks-tab`,
  `tasks-tab-ended`, `tasks-tab-plain`, `message-time`, `queued-menu`,
  `queued-menu-edit`, `diff-tally`, `chat-menu`, `chat-menu-narrow`,
  `chat-tool-menu` and `chat-tool-menu-narrow`. A scenario named `-narrow`
  that needs a true 320 px viewport says so and is opened at that width by
  both scripts. Scenarios drive the real App through the fake host's
  messages; none mounts a component on its own.
- Motion respects `prefers-reduced-motion`: `test/unit/reducedMotion.test.ts`
  reads `src/webview/styles.css` and fails when any selector with an
  `animation` or `transition` is not set to none in the closing
  reduced-motion block. A new animation adds its selector there.
- Refresh the README's screenshots with `npm run readme:shots`, which
  renders each image in `scripts/readme-shots.json` from its harness
  scenario at its declared theme, size and language. `readme:shots --list`
  prints the mapping with any gap (a README image with no entry, or an
  entry the README never shows); `--only <name,...>` retakes some images
  and `--out <dir>` writes them elsewhere, so preview in `temp/` before
  overwriting the committed `media/readme/`.
- No new dependency without a reason in the pull request and a
  compatibility check; no suppressed lint rule or `any` without an inline
  reason and a row in PLAN.md §8.
- Keep secrets out: the pre-commit hook runs gitleaks, and nothing in the
  repository may contain a real credential.
- The pre-commit hook runs staged lint and format tasks serially to limit
  concurrent child processes on a developer's machine. It still runs every
  configured check.
- `main` is protected: changes land through a pull request with the CI
  checks green, it cannot be force-pushed or deleted, and release tags
  (`v*`) cannot be moved or deleted, except by a repository admin (both
  rulesets let the Admin role bypass them).

## CI tiers and required checks

`ci.yml` calls `build.yml` with `fast: true` only for a `pull_request` while
the repository variable `CI_MERGE_QUEUE` is `on`. That tier runs formatting,
ESLint/stylelint, all five compiler projects, localization, host API, knip,
cycles, duplication, the production build and its size/split/host-global/
notices checks, audit, and every unit/process-e2e test on Ubuntu (no
coverage). Gitleaks and semgrep also run. Expected wall time is at most about
12 minutes, pending hosted measurement.

Everything else selects the full tier: `merge_group`, manual dispatch, the
release workflow's fallback build, and every PR while `CI_MERGE_QUEUE` is not
`on`. Static gates run on all three OSes. Each OS runs four Vitest shards
(Windows files stay serial within a shard), uploads blob reports, checks that
all four arrived, then merges them and enforces the unchanged coverage
thresholds once per OS. The 448-page a11y harness runs once on Ubuntu against
the production webview from the static gate; its pages, themes and scenarios
do not depend on the OS. Linux/Windows VS Code integration, the macOS helper
and the universal VSIX/ACP package checks remain. Expected wall time is
roughly 10–15 minutes, pending hosted proof. In a merge group, gitleaks runs
its pinned CLI (checksum-checked) over every commit the group reaches, since
the gitleaks action refuses the `merge_group` event.

The seven required names stay: `build / quality (ubuntu-latest)`,
`build / quality (windows-latest)`, `build / quality (macos-latest)`,
`build / gitleaks`, `build / semgrep`, `build / dictation helper (macos)` and
`build / package (.vsix)`. The quality/helper/package names come from one
aggregate job that fails unless every job of the selected tier succeeded
(failed, cancelled and unexpectedly skipped all fail). On a fast PR run they
mean the fast tier passed; in the queue, the full tier. Artifact names and
contents stay unchanged. Hosts and Action check are not required by the main
ruleset and keep their existing triggers.

Maintainer rollout, in this order: land the workflows (their PR runs the full
tier); add the merge-queue rule to the main ruleset (merge commits, one PR
per group, all entries green, a 30-minute check timeout) with the seven names
kept and `strict_required_status_checks_policy` set to `false`; then
`gh variable set CI_MERGE_QUEUE --body on` to switch PRs to the fast tier.
Deleting the variable switches them back. Never set it without the queue
rule: a fast-only PR would then merge without the full gate. GitHub's
documentation offers merge queues only in organization-owned repositories,
and this one belongs to a user account: until the owner decides otherwise,
PRs keep the full tier. Settings and evidence:
[`docs/certification/ciflow.md`](docs/certification/ciflow.md).

## Style

Prettier and ESLint decide formatting and style; the hooks apply them on
commit. Comments explain why, not what. Timeouts, limits and other magic
values are named constants in `src/shared/constants.ts`.

## Questions and the attention dock (M112)

Agent questions are a separate kind of attention prompt: approvals stay first
and block, while a question defers into the open set after its host-owned
deadline. MCP elicitation retains its own expiry and has no late-answer path.
Never send a question answer through an approval handler or let it grant a
rule, change mode or settle a paid-use permission prompt.

Use the portable contracts in `src/shared/questions.ts` and the shared core
registry (`src/core/questions/**`, lane Q). ACP's
`src/acp/questionDeferral.ts` owns the form clock and cooperative withdrawal;
its injected registry port has no production substitute. A native UI never
owns the clock. Open questions and queued idle answers belong in owner-only,
validated per-session storage, deleted with that session. Log ids or fixed
diagnostics only; report counts, never question text, drafts or answers.

Certify deadline/answer races, Stop and close, replayed deadlines, no-form
immediate deferral, late steering and durable queue acknowledgement with the
injected clock and fake client. Break each guard, observe its named test fail,
restore byte-exact and record the drill. Headless execution declines at once
with no clock; scheduled/unattended prompts defer at once, even when the
interactive setting is 0. See [M112's contracts](docs/certification/m112-contracts.md)
and [lane A's record](docs/certification/m112-a.md) for integration ownership.

## Text the user reads

The panel follows VS Code's display language (PLAN.md D33), so text is
never a literal in the code:

- **Panel and host text** goes in the English table,
  `src/shared/l10n/en.ts`, and is read as `UI_TEXT.key` where it is shown,
  never when a module loads.
  - A sentence around a value is one template, `{duration}` in `Thought for {duration}`, filled with `fill`.
  - A count is `forms({ one: '{count} agent', other: '{count} agents' })`,
    read with `plural`.
  - Numbers, percentages, money, durations and dates go through the `Intl`
    helpers in `src/shared/l10n/text.ts`.
- **Manifest text** (commands, settings, the walkthrough) is a `%key%` in
  `package.json` with its English in `package.nls.json`.
- **Text the model reads** is `MODEL_TEXT` in constants.ts and stays
  English; a feature only a lazily loaded bundle reads keeps a block of its
  own beside it (`REVIEW_MODEL_TEXT`, `MODEL_API_MODEL_TEXT`,
  `CODE_INTEL_MODEL_TEXT`, `WEB_FETCH_MODEL_TEXT`…), so the activation bundle
  does not carry it: one object is carried whole, and `npm run build` fails a
  `MODEL_TEXT` key that no file of `dist/extension.js` reads, a block found in
  a shipped bundle that is not among its declared readers, and a new block
  that `scripts/check-bundle-split.mjs` does not guard. No checked Node bundle carries the English table itself: each
  loads the shared `dist/uiText.js`, and `npm run build` fails if one
  duplicates `en.ts` or stops loading it. Each lazily loaded bundle keeps its
  own language state, so one that reads `UI_TEXT` must install the caller's
  table in its factory.

`npm run check:l10n` checks all of this. It fails a key missing from a
translation, a changed `{slot}`, a wrong set of plural forms, and a
`UI_TEXT` read at module load. `npm run harness:shots -- --lang=pseudo`
renders the panel in a pseudo-locale where any English left outside the
table stands out.

**Adding or changing a key.** Add it to all fourteen tables in `l10n/`,
because the gate fails a language that lacks it. A plural entry needs the
forms that language uses: Russian, Polish and Czech need `few` and `many`;
French, Spanish, Italian and Brazilian Portuguese need `many`; Chinese,
Japanese and Korean need `other` only. Every form keeps `{count}`, the
English `one` included ("Ran {count} time", not "Ran once"): Russian's `one`
also covers 21, 31 and 101, so a form without the number would be wrong
there, and the gate compares each form's slots with the English.

**Correcting a translation.** The translations are machine-made. Edit the
line in `l10n/ui.<language>.json` or `package.nls.<language>.json`, keeping
its `{slots}` and code spans. Run `npm run check:l10n` and
`npm run harness:shots -- --lang=<language>` to see the result.

- **A value that reads the same as English** (a name, or a word the language
  borrows) goes in `l10n/untranslated.json` under that language.

## Paid features

Anything that bills the user beyond tokens follows AGENTS.md rule 12 and
PLAN.md D34: its own machine-scoped setting, off by default, with the price
in its description; the gate in `src/core/paid/paidFeatures.ts` before any
call; the paid-use popup (`PaidUseConsent.allows`, M58) before each use; a
row marked paid; a count in `PaidUsage`. A paid feature offered on
the Muse Code backend goes through the extension itself (the `ide` server's
tools, `src/host/ide/imageTools.ts`), never through `muse serve`, and
asks before each purchase in the same popup, whatever Muse Code's
permission mode.
The tests never spend:
the Model API, the Images endpoint and the Muse Voice WebSocket are all
fakes (`test/unit/helpers/fakeModelApi.ts` and `fakeVoiceServer.ts`, a
small RFC 6455 server over Node's own `http`). A live check bills the
owner's key: say what it will cost first and ask.

## MCP servers on the Model API backend

The MCP client (`src/core/backends/modelapi/mcp/`, PLAN.md D42) is tested
against two fakes, never a real server: `test/unit/helpers/fakeMcpServer.mjs`,
a stdio server the tests start as a child process through the extension's
own spawner (its behaviour is chosen by `FAKE_MCP_*` variables in the
entry's `env`), and `fakeMcpHttpServer.ts`, a streamable-HTTP server on
loopback. A new MCP behaviour gets a case in one of them first.
On Windows the real-process tests also compile the job helpers' C#
(`native/windows/MuseSparkJob.cs`, `MuseSparkMcpLauncher.cs` and the
shared `MuseSparkMcpJob.cs`) in an isolated temporary folder.
`fakeMcpBinary.mjs` checks raw stdio bytes, `fakeMcpOrphan.mjs` checks a
finite detached child, and `fakeMcpLauncherParent.mjs` checks cleanup when
the extension-side Node process exits, and `fakeMcpPrebindParent.mjs` checks death before the job
helper binds that process. The withheld-GO test's marker must never start.
The test-owned fixture PIDs must be gone after the suite.

## Hooks from other agents (M91)

A hook imported in another agent's format runs only through lane P's
adapters (`src/core/backends/modelapi/hookFormats/`, PLAN.md D70), never as a
native hook:

- Each vendor's contract is a table under `hookFormats/contracts/`, and
  every row cites its saved source.
- `hookFormatsContracts.test.ts` proves the engine's invariants over every
  row; a new row is covered there the moment it exists. Above all, no row
  produces an allow.
- The dispatcher's side lives in `hooks.ts` (the import record's checks,
  `ForeignHookAdapter`) and `foreignHooksEntry.ts` (the source's rules
  around the run: patterns, triggers, directory, shell, timeouts, loop
  limits). It is tested in `foreignHooks.test.ts` and, in a running
  session, in `modelApiForeignHooks.test.ts`.
- The adapters ship in `dist/foreignHooks.js`. `check-bundle-split.mjs`
  fails if `dist/modelApi.js` starts carrying them.
- `modelApiGoldenRequests.test.ts` must stay byte-identical: with hooks
  off, no change may move a request's bytes.

## Reporting bugs and proposing features

Use the issue templates. For a bug, run **Muse Spark: Diagnostics** from
the Command Palette and paste the report (it contains no credentials; a
proxy appears as set or not, never its address).

## Networks

The extension has no proxy client of its own: VS Code routes an
extension's `fetch` and WebSocket through its proxy and certificate
settings (PLAN.md D43). Code that makes a request uses the globals as they
stand when it runs, never a copy taken at activation. Tests never need a
proxy or a certificate: they use the failure shapes Node 24 was seen to
throw (`docs/certification/m56.md`).

Web fetch (PLAN.md M69) is the one exception to `fetch`: it must connect to
the address it checked, which VS Code's patched `fetch` cannot do, so it
uses Node's `https` (`src/host/web/pinnedRequest.ts`), which VS Code patches
for its proxy and certificates too. Keep every destination check in
`src/core/web/` and test it over the fake resolver and transport in
`test/unit/webFetch.test.ts`; unit tests never reach the internet. What
only VS Code can show (the proxy asked for the pinned address) is in
`test/integration/webFetch.test.ts`, against a loopback proxy.

## Licence

By contributing you agree that your contribution is licensed under the MIT
licence of this repository.

## M80 implementation lanes and fake-only verification

M80 v4 plus F1/F2 rulings assigns A contracts, B engine, C Action and D packaging/
docs/process/hosts. Implementing lanes run owned focused files serially on rigs;
the lead runs unchanged `npm run quality` on the exact integrated tree before
proposing merge, then build.yml, hosts.yml and action-check.yml OS matrices.
No lane's focused pass certifies integrated behavior or the release.

Focused D command: `npx vitest run test/e2e/execStdio.e2e.test.ts` (on a rig).
Its package guards and the built-process rows E1–E7 always run. With an
installed package, set `MUSE_ACP_PACKAGE_DIR` to its absolute root. Host checks:
`sh test/hosts/exec.sh <installed-package-root>`; add `--store` only in isolated,
unlocked OS store. Host refuses existing credential and unavailable store before
fake auth mutation, and traps cleanup. Windows standalone POSIX signals remain
explicit skips, not green acceptance.

After production package, `node scripts/package-acp-test.mjs` builds C's
`test/action/exec-test-launcher.ts` into private fake-only variant. It preserves
production stage/tarball bytes and emits `dist/muse-spark-code-acp-test-<version>.tgz`.
Installed identity stays muse-spark-code-acp for the ordinary candidate path;
manifest bin points to test launcher and private=true prevents npm publication.
Separate name/digest; never release it. Test fetch/keyring loaders live only in
test code, never production flags. C's focused action tests and action-check.yml
exercise W-review/text/image, low-budget, trusted gate and exact bare-repo apply.
Locally, `npx vitest run test/e2e/execTestLauncher.e2e.test.ts` (on a rig) packs
the real launcher in its own tree and rehearses all four W scenarios through
the real run-exec entry, judged by `test/action/w-check.mjs` as the workflow
does.

Every new guard needs green → deliberate wrong behavior → intended failure →
byte-exact SHA-256 restoration → restored green. Record mutated/restored hashes,
command/rig/OS/exit/diagnostic in docs/certification/m80.md, including survivors
and deferrals. No bypasses, narrowed discovery, threshold changes or fake logs.
L/LA/LR are distinct live receipts, not implied by fakes; this lane never runs
them. Guide commands and operational recipes stay pending until observed.

The D shell-harness tests require Bash and core utilities. Windows uses an
installed Git Bash next to Git or on the absolute PATH. A rig with MinGit may
stage trusted offline MSYS tools under `node_modules/.bin/msys/usr/bin` with a
portable root `tmp/`; this is test tooling only, never an npm/product dependency
or global install. Windows Node tar checks use native System32 bsdtar so drive
letters are not interpreted as GNU tar remote hosts. A shell startup failure or
failure to reach the fixture is a failed check, never a proved refusal.

## Tab completion checks (M94)

`test/unit/tab*.test.ts` covers the core, privacy boundaries, spend ledger,
consent, startup status and localized menus against fakes. The integration
suite `test/integration/tab.test.ts` loads the dev build's real `dist/tab.js`
against a loopback fake Model API, then exercises full and word accepts in
VS Code at the manifest floor and stable. It uses no credential.

The opt-in probe is `test/e2e/tab.live.e2e.test.ts`. Only the lead runs it with
explicit paid-call authorization: first announce the expected 30 requests,
count HTTP attempts and usage frames separately, and record the actual cost
and workspace in `docs/certification/m94.md`. Lane W's validation makes no
live model calls. The final live check and the real Tab hook drills wait
for M91/lane K. Every new guard or gate must have an observed failing drill
and a byte-exact restoration recorded before certification.

The Windows release-shell fixtures use Git Bash's installed path when it
exists, otherwise Bash from PATH. A missing Bash remains a test failure.

Every new command, setting or feature updates `src/shared/featureCatalog.ts`
in the same PR (and the shared CLI table for runtime commands). Run
`npm run reference:generate`, then `npm run check:reference`; the gate rejects
missing descriptions, invalid relationships and stale generated references.

## Resource delivery checks

M107 keeps policy in `dist/resourceGovernor.js`, shared process admission in
`dist/resourceAdmission.js`, and controls/history in independent browser
entries. Reuse the injected ports when their owning milestone is absent;
record its binding rather than supplying a fake production implementation.
The browser entries share the caller's React and installed-language runtime.

Run the affected complete test files with the repository's ordinary timeout
and at most three files/workers per rig invocation. New size, split, settings
and package guards need a deliberate red run and byte-exact restoration in
the [W record](<docs/certification/m107-w-wiring,-docs-and-gates-(last).md>).
The lead still runs full quality on the final candidate. Neither integration
handoffs nor a scoped lane receipt reduce the release gates.
