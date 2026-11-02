# RLF-M104LC — M104 lane C, the companion MHP routes, on lane B

Base: int/recovery `0a5ebd7189` (CC-INT5: the team cluster and M104 lane
B). Lane D merged first (`bbe38899e`, `--no-ff`, clean). Sources:
RLM104's lane C at `4ecbbd9cc5` (`rec/rlm104`), ported area by area per
`docs/certification/cc-rlm104.md` area 4 and rebuilt on int's companion
server; never a parallel server. Environment: macmini (macOS), Node 24;
tests run directly in the worktree. No push, rebase, paid call, live
model call or credential-store suite. Chrome is installed on this rig
(`/Applications/Google Chrome.app`), so the real-Chromium proof ran here.

## What landed

The companion MHP routes on int's companion server (`34078c8c2`):
`/panel/message`, `/panel/surface`, `/panel/events`, `/host/message`,
`/host/events`, `/session`, over `src/runtime/companion/{server,
sessions,events,guard,page,launchUrl}.ts`, with the panel transport
(`src/runtime/panel/companionTransport.ts`) binding a real connection to
the routes. `panel --companion` (`038618fac`) boots the runtime panel,
prints one launch URL on loopback, and serves the portable panel to the
browser window that exchanges the one-use launch code for its own
Bearer [REDACTED] held only in page memory. The companion's guards hold on
every route: loopback-only bind (`EPANEL_BIND`), the window's Bearer [REDACTED]
(`EPANEL_BEARER`), exact Host/Origin/Fetch-Metadata (`EPANEL_ORIGIN`),
the `x-muse-panel` header (`EPANEL_HEADER`), and size bounds at MHP's own
values (`MHP_PANEL_TOO_LARGE`). The page server (`portablePage.ts`)
refuses manifest-schema escapes, linked manifests and linked modules
(`MHP_ASSET_PATH`), oversize graphs (`MHP_ASSET_TOO_LARGE`), unlisted
scripts (`MHP_ASSET_UNLISTED`) and surfaces the window cannot show.

Changed on the way in (int, not RLM104):

- The routes sit on int's companion server (sessions, events, guard and
  page as CC-INT5 left them), with the panel transport's handler and UI
  services beside the usage companion's; one guard path serves all routes.
- `panel --companion` shares lane B's panel entry, controller registry
  and stores; the window's side is shared test code
  (`test/unit/helpers/companionWindow.ts`), used by the routes suite and
  the packed suite alike.
- The portable page reads its style nonce from the root's
  `data-theme-nonce` (the usage page's pattern); without it the strict
  `style-src` policy refuses the bridge-owned declarations. A companion
  page without one throws `Missing companion theme nonce`, reported
  through the bridge-failure UI like every mount failure. The launch and
  session pages also carry an empty favicon link so no credentialed
  request leaves the page for `/favicon.ico`.
- One new string (`companionPanelTitle`), the `--companion` CLI reference
  text, and two reworded panel texts, in English and all 14 tables.
- RLM104's hand-written-transport browser timing is not ported: the
  browser proof boots the packed agent and real Chromium over the real
  routes (below). RLM104's two-window independence is the panel's
  single-live-window rule instead: opening another window retires the
  first (`retires the live window when the session opens another`).

## Proof: the portable page in real Chromium over the routes

`test/unit/panelCompanionBrowser.test.mjs` (2/2): the packed agent boots
in an isolated home, real Chrome loads the launch URL, exchanges the
code, installs the session page (`launch === 'ready'`, `#muse-panel`
present, no launch error), and boots chat over `/panel/*`: the session's
own `Untitled` title, the `Not signed in` backend state and the settled
sign-in gate all reach the DOM. The isolated run has no backend (no
Muse Code, no key), so the settled unsigned state is itself the proof
each round-trip works; the page has no other data source. No provider,
key or network is touched. (The suite first expected the signed-in
composer; the page honestly showed the sign-in gate instead, and the
suite was corrected to the real state — the debugging is in the lane's
working notes, not the tree.)

## Suites (final tree, repository timeouts)

- `panelCompanionRoutes` (real server, transport, connection): 15/15 —
  handshake, tasks surface, ui question and answer, window retirement,
  backpressure past MHP's queue bound, cancelled-call drops, Bearer [REDACTED]
  Origin, panel header, unknown surface (message and lifecycle),
  over-cap body, malformed envelope, non-loopback bind.
- `runtimePanelCompanion` (packed agent, real session): 8/8 — loopback
  launch URL, the exchange, the streamed session state (`init`,
  `authState`, `paidState`, `surfaceState`, `composerState`, `gitState`),
  token/origin/surface refusals, the replayed launch code, SIGTERM exit 0.
- `portablePageSecurity` (page boundaries): 31/31 — hostile text and
  identifiers as inert data, nonce-before-script, manifest-schema
  escapes, linked manifests, linked modules, oversize graphs, unlisted
  scripts, surface kinds, entry boots.
- `panelCompanionBrowser` (real Chromium): 2/2 (above).
- `companionGuard` (guard units, pre-existing): 26/26.
- `estimatorPricePackaging` (below): 1/1.
- Related suites over every changed source file (`npx vitest related …`,
  repository timeouts): exit 1 — 1189 files (35 failed, 1117 passed, 37
  skipped), 28053 tests (80 failed, 27685 passed, 288 skipped). No lane
  file fails. Of the 35: 1 was branch-caused and is fixed
  (`estimatorPricePackaging`, below); 2 pass alone (load:
  `nativeGitPullRequestReads`, `schedulePauseAfterFailures`); 7 fail
  byte-identically on an extracted untouched base (`crashMarker`,
  `providerSpend`, `connectorStorageGuard` ×3, `teamCrossBranchAdvisories`,
  `estimatorHistorySources`, `playbookContainedJob` ×2,
  `resourceCreatedSweep` ×4 — base); 2 match CC-INT5 §5's classified rows
  and were not re-measured (`execTeamSweep` row 2, `createdRegistryRace`
  row 5); 1 is proven rig-state
  (`acpServeHandshake`: `muse` sits at `/Users/randy/.local/bin/muse`,
  which the test's PATH scrub keeps, so exactly one of its two cases
  fails on any PATH — shown both ways); the rest carry environmental
  signatures in areas the branch never touches (`ps` EPERM (`macRss`,
  `treeSyncNoDeadline`, `treesLifecycleNative`; this rig denies `ps`),
  unbuilt native helper ENOENT (`nodeCertificate`, `nodeToolHost`,
  `resourceHandoffDeadline`), no OS credential store
  (`providerHeadersStore`; CC-INT5 excludes it), sandbox refusals
  (`judgeLocalDarwin` ×2, `playbookWindow`, `teamPlaybook*`,
  `vault/**` — CC-INT5 excludes vault and `runtimeLsp`), missing
  docker/zopfli (`nodeWorkspaceDevcontainer`, `vsixCompression`), APFS
  case-insensitivity (`playbookGovernor`, CC-INT5 §5 row 2), and 5 s
  timeouts (`resourceStatusCpu`, `playbookSchedulesInputs`,
  `scheduleFireFailures` — CC-INT5 §5 row 3). The branch's shared
  changes are additive (constants, English keys, generated reference)
  plus one same-value rename (`USAGE_PAGE_OPEN_TIMEOUT_MS` →
  `COMPANION_PAGE_OPEN_TIMEOUT_MS`, readers updated, typecheck green),
  so none of these paths can read a changed value.

## Fixed on the way: the packaging resolver

Lane D's merge broke `estimatorPricePackaging` on this branch: its
`strings()` resolver derives every production `outfile` from
`scripts/build.mjs`, and lane D's loader uses a template
(`` `${PORTABLE_OUTDIR}/loader.js` ``), which resolved to no path —
`Unresolved production output`, file red. The template is statically
known (`PORTABLE_OUTDIR` is a const string), so the fix extends the
resolver to join template heads, substitutions and tails, resolving
each substitution the same way; anything genuinely dynamic still
resolves to no path and fails loud at the existing call site. The gate
is stronger, not weaker: it now covers the portable loader bundle.
Green on the branch (1/1); green on the untouched base (old test, old
build); red drill below.

## Drills (break, non-zero exit, restore, green)

Each break was restored exactly (`git status` clean of it) and the suite
re-run green; the two packed drills were rebuilt before and after.

| Guard / suite                                  | Break                                                                             | Red                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| foreign Origin, `panelCompanionRoutes`         | `guard.ts` privileged-Origin arm returns true                                     | `refuses a post from another origin` fails, exit 1                          |
| secret compare, `companionGuard`               | `isSameSecret` true on length match                                               | `compares secrets including length` fails, exit 1                           |
| body cap, `panelCompanionRoutes`               | `readJson` bound doubled                                                          | `refuses a body larger than MHP's envelope` fails, exit 1                   |
| loopback bind, `panelCompanionRoutes`          | `EPANEL_BIND` inverted (rejects loopback; no `0.0.0.0` socket is ever opened)     | all 15 fail in `beforeEach`, exit 1                                         |
| linked manifest, `portablePageSecurity`        | `portablePage.ts` manifest `realpath` check neutered                              | `refuses a manifest reached through a link` fails, exit 1                   |
| linked module, `portablePageSecurity`          | per-file `realpath` check neutered                                                | `refuses a module reached through a link` fails, exit 1                     |
| replay, `runtimePanelCompanion` (rebuilt)      | `exchange` keeps the code                                                         | `refuses the launch code a second time` fails, exit 1                       |
| theme nonce, `panelCompanionBrowser` (rebuilt) | session page drops `data-theme-nonce`                                             | `boots chat over the MHP routes` fails (launch/install still green), exit 1 |
| packaging resolver, `estimatorPricePackaging`  | one outfile made dynamic (`${PORTABLE_OUTDIR + process.env.BUILD_TAG}/loader.js`) | `Unresolved production output: …`, exit 1; restored, green                  |

Drill notes: breaking the missing-Origin arm alone stays green because
the present-but-foreign arm above it refuses first (that arm is
`companionGuard`'s `missing privileged Origin` case); neutering the
per-file `realpath` check first stayed green because the outside-graph
test asserts the manifest schema's earlier refusal — which exposed the
missing linked-module test, added and drilled in this lane.

## Gates (final tree; exit codes)

- prettier `--check` on all touched files: 0.
- eslint `--max-warnings 0` on all touched files: 0.
- `npm run typecheck`: 0 (after fixing the lane's spawn stdio type:
  `ChildProcessByStdio<null, Readable, Readable>`, not
  `ChildProcessWithoutNullStreams`).
- `node scripts/check-l10n.mjs`: 0 (0 problems).
- `npm run check:reference`: 0.
- `npm run check:host-api`: 0 after `-- --write` (4 count rows:
  `node:crypto` 326→327, `node:fs/promises` 213→214, `node:path`
  361→363, `node:url` 19→20; every new import is this lane's).
- `npm run check:plan`: 0. `npm run check:roadmap`: 0.
  `npm run check:catches`: 0 (counts match the baseline; the lane's
  baseline delta is committed).
- `npm run duplication`: 0 (0 clones). `npm run cycles`: 0.
  `npm run deadcode`: 0.
- `npm run build`: **1, the base's own failure, byte-identical.**
  `dist/teamHost.js` 140.2 of 130 KiB (+10.2), `dist/teamRunners.js`
  78.4 of 75 (+3.4), `dist/teamScheduler.js` 76.5 of 75 (+1.5) — the
  same three rows at the same sizes CC-INT5 records for int/recovery
  `0a5ebd7189` (cc-int5.md §8 item 1); this lane touches no team file
  and raised no budget. All 263 other rows hold, including every lane C
  bundle (`runtimePanelCompanion.js` 115.9 of 134, portable startup
  826.3 of 950, portable total JS 1405.9 of 1625). The rest of the
  chain, run by hand as CC-INT5 did: `check-bundle-split`,
  `gen-lazy-registry --check`, `check-host-globals`,
  `third-party-notices`, `check-legal-build-records`: all 0
  (`check-tokens`: 0 problems, inside the build run).

## M104 acceptance for lane C

Item 4 (Companion security), each refused and drilled: a wrong `Host`
(`companionGuard` foreign-Host case, same guard path); a foreign
`Origin` (routes + packed suites); a missing Bearer [REDACTED] a missing
custom header (routes suite); a replayed launch code (packed suite); a
non-loopback bind (`EPANEL_BIND`); an over-cap body (routes suite). No
CORS header in any response and the nonce CSP on every page
(`companionGuard` header cases). Rule 8: no key crosses the wire — the
launch code rides the URL fragment (never sent), the Bearer [REDACTED] in
page memory only; the grep-level proof is M104's own drill, not this
lane's. FIXM104C's remainder: two runtimes share nothing (codes and
bearers live in process memory only); rejected launches show the
localized `#launch-error` recovery guidance (rendered, `role="alert"`).

## Not done here (by the brief's own boundaries)

- No CHANGELOG entry and no README/docs page: nothing a person sees
  changes yet — no editor host or release carries `panel --companion`
  (lanes B and D recorded the same for their parts).
- Browser startup timing (`PORTABLE_STARTUP` performance mark): lane D's
  static-closure accounting stands; the carrier now exists to time
  against.
- Checkpoints, usage history and handoff stay lane B's remainder
  (cc-m104b.md); the panel's other surfaces stay lane B's.

## Commits

| Commit      | Area                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------- |
| `bbe38899e` | merge of `lanes/rlf-m104d` (`--no-ff`, clean)                                                 |
| `34078c8c2` | the MHP panel and host routes on the companion server                                         |
| `038618fac` | `panel --companion` serves the panel to a browser window                                      |
| `635b013ee` | the routes over a real server; the ui queue drops cancelled calls                             |
| `e3af2cccb` | the packed suite over the routes, sharing the window's side                                   |
| `4f9d196eb` | the page server's boundaries, ported from RLM104                                              |
| `900799beb` | the portable page in real Chromium; the theme nonce; the favicon link                         |
| `03416837f` | replay and non-loopback-bind refusals                                                         |
| `7ae4d98ec` | the linked-module refusal                                                                     |
| `87458fe7d` | the gate-found fixes (spawn stdio type, packaging resolver); the host-API record; PLAN status |
