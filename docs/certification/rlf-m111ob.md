# RLF-M111OB: M111 lane OB Observability (shared)

Base: int/recovery `0a5ebd7189`. D91.22 (PLAN.md §2, research §11),
threat rows D64/D65 (`docs/certification/m111-threat-model.md`), lane 0
contracts (`src/shared/desktopContracts.ts`), M114 tokens.

## Scope (the plan's row)

OpenTelemetry wiring for Rust, Electron and the runtime; the local OTLP
receiver, ring store and rollups; the Diagnostics page (app and node web
UI); opt-in export over TLS; local crash capture and its scrub; the
desktop's readiness components; M93's bundle with the desktop's files.

Export stays opt-in and off by default; nothing leaves the machine unless
the person turns it on (D91.22). The local receiver binds loopback only.

## Status

- [x] Core `src/core/o11y/**`: signals, ring store, rollups, crash records, export gate, readiness, Electron wiring
- [x] Strings in English + 14 tables, constants (`O11Y_*`), §8 rows
- [x] Runtime `src/runtime/o11y/**`: OTLP receiver, diagnostics method, crash hook, TLS exporter
- [x] `src/runtime/node/health.ts`: desktop readiness components (with N's owner)
- [x] Diagnostics page `src/webview/diagnostics/**` + node web UI page (app mount waits for WB)
- [x] M93 bundle desktop facts (with M93's owner)
- [x] `desktop/crates/otel/**` Rust wiring
- [x] Reference/host-api records
- [x] Red/green drills, gates, CHANGELOG, PLAN status

## What is done

Core policy (commit `part 1`, below): OTLP/HTTP JSON ingest for metrics,
logs and traces with the fixed component vocabulary and the redactor's
scrub (`signals.ts`); the ring policy — day files, retention prune, log
compaction, 10 s quantization, minute rollups, trace sampling with every
error kept (`ringStore.ts`); structured crash records, the no-upload
crashReporter options and raw-core refusal (`crash.ts`); the opt-in
https-only export gate with spec retry/backoff and payload rebuilders
(`export.ts`); desktop readiness evaluation (`readiness.ts`); Electron
main/renderer OTel options (`electron.ts`). `O11Y_*` constants,
`nodeDiagnostics` strings in all 15 tables, `nodeLabels`/`nodeHelp`
entries, §8 rows for the two TS-lib disables. Suites:
`test/unit/o11y/*.test.ts` (26 tests), typecheck, eslint, prettier,
`check-l10n` all green.

## What is next

Lane OB is done. Still with other lanes: each desktop component's own
probes and wiring (CP, SH1, SH2, SY, WB), serving the receiver and the
desktop `/readyz` block (lane N), and a CI job that builds the Rust
crate.

## Part 2 (runtime)

File-backed ring store over `NodePrivateFiles` (new `append`/`list`/
`remove`, with N's owner), the loopback-only OTLP receiver,
`node/diagnostics/read`, desktop readiness in `nodeHealth`, the Node
crash hook and the opt-in TLS exporter. Suites: `store`, `receiver`,
`health`, `diagnostics`, `crashHook` (real dying children), `exporter`
(real TLS against an openssl-minted collector, retry/refused/gave-up/
unverified paths). Typecheck, eslint, prettier green; neighbours
(`nodeLifecycle`, `nodeOps`, `nodeKeyStore`) green.

## Decisions and dependencies

- OTLP/HTTP JSON per the published spec (opentelemetry-proto, Stable):
  POST `/v1/logs|metrics|traces` with `resourceLogs|resourceMetrics|
resourceSpans`; Resource → Scope → records. Retryable: 429/502/503/504
  only; exponential backoff with jitter; honor Retry-After; bounded by the
  exporter timeout, then fail (spec: protocol/exporter.md, Stable).
- Rust (shell/compositor/surfacess) and Electron (app) components do not
  exist yet (lanes CP/SH1/SH2/SY/WB). OB builds their portable contracts
  (record shapes, receiver endpoints, crash-record scrub, crashReporter
  options with upload off) against lane 0; the per-component wiring lands
  with those lanes.
- Diagnostics strings live under `nodeDiagnostics` (+ `nodeLabels`
  /`nodeHelp` entries) so the node web UI's inline-English filter carries
  them (`test/harness/build-node.mjs`).

## Part 3 (2026-10-31): Diagnostics page component

- `src/webview/diagnostics/DiagnosticsPage.tsx`: health/export/metrics/
  logs/traces/crashes from one `NodeDiagnostics` snapshot, against the real
  `nodeDiagnosticsSchema` contract (health rows, metrics with component/
  name/unit/buckets, logs with OTel severity numbers, traces with spanId/
  parentSpanId, crashes with kind/code).
- Metric charts reuse the shared `ChartFrame` (title/summary/series/
  points/format/text contract, StepLines geometry pattern): min/average/
  max step-lines over a 0-100 viewBox, segments broken across missing
  minutes (never a joined gap), data table with exact values.
- `ChartFrame` gained an optional `text` prop (render-time read, installed
  table shown); shared chart CSS moved verbatim to
  `src/webview/charts/chart.css` (rule-multiset verified, 0-clone gate).
- Severity numbers map to band words per the OTel spec (1-24 in bands of
  four, `O11Y_SEVERITY_BAND`); out-of-band numbers show raw.
- Trace waterfall: nested lists, two-line rows (label + positioned bar),
  error spans marked, cycle-safe (`seen` set, roots-or-all fallback).
- 11 new `nodeDiagnostics` keys in EN + 14 tables (`traceError`,
  `traceSpans`, `unreadable`, five severity words, three stat words);
  `untranslated.json` allows the identical technical words only.
- Suite: `test/unit/o11y/diagnosticsPage.test.tsx` (9 tests, real schema
  parse + Testing Library): sections, health words, export/dropped,
  chart lines + gap break, severity bands, waterfall expand, cycle,
  crash wordings. Typecheck (webview), eslint, prettier, check-l10n green.
- Next: node web UI wiring (lazy chunk, nav, fetch container), ui:look
  scene, M93 bundle files, Rust crate attempt, drills, full gates.

## Part 4 (2026-10-31): node web UI wiring and the local look

- `DiagnosticsLoader` (`src/webview/node/diagnostics/`): the Dashboard
  fetch pattern against `node/diagnostics/read` (mount + RefreshButton,
  failures to the workspace alert); renders the shared page.
- `main.tsx`: `diagnostics` page state, nav button (after Audit),
  `diagnostics` request kind + `runDiagnostics`, lazy chunk behind the
  chunk boundary with the `nodeDiagnostics.chunkFailed`/`retry` words.
  The terminal-only `TerminalChunkBoundary`/`TerminalChunk` became the
  shared `NodeChunkBoundary`/`NodeLazyChunk` (same terminal strings and
  behaviour; a second boundary would trip the 0-clone gate).
- Suite: `test/unit/o11y/nodeDiagnosticsUi.test.tsx` (real workspace
  shell + scripted port): lazy load renders the snapshot, refresh
  re-reads, refusal reaches the alert. Neighbours green
  (`nodeTerminalUi`, `UsageCharts`, 38 tests).
- Budgets: diagnostics lazy chunk 19.7 KiB inside the editor bucket
  (327.0/600 KiB); workspace 329.5/375, terminal 343.9/400. No new
  budget, none raised.
- Look: `node-diagnostics` scene in `test/harness/node.html` (fixture
  snapshot, nav driver; help/whatsnew shifted to buttons 7/8), added to
  the a11y gate. Real-Chrome screenshots light + dark in
  `temp/ui-look/node-diagnostics.{light,dark}.png`. The look caught two
  real bugs, both fixed: chart strokes invisible (`--ms-foreground`
  undefined in the node bundle; now scoped aliases with system-colour
  fallbacks in `diagnostics.css`, node-idiomatic `--vscode-*` elsewhere)
  and a doubled Diagnostics heading (loader h2 removed).
- a11y gate: `node-diagnostics` and `-narrow`, 4 themes each,
  0 violations.
- Next: M93 bundle files, Rust crate attempt, reference/host-api
  records, drills, CHANGELOG, full gates.

## Part 5 (2026-10-31): M93 desktop facts, receiver fixes, Rust crate

- `src/core/o11y/reportFacts.ts`: `desktopReportFacts(deps)` builds
  M93's `desktop` facts block from the desktop host's reads (Electron
  and Chrome versions, readiness + unready components, crash total and
  kinds, export switch). Fixed vocabularies, versions and counts only;
  never an endpoint, path or record text.
- `src/core/support/problemReport.ts` (with M93's owner): optional
  `desktop` block in the facts schema (versions validated by the
  existing version check under dotted field names, kinds and
  components as enums over the o11y vocabularies), `desktop` in the
  unknownable facts, and a `desktop:` draft line
  (`electron …, chrome …; ready…; crashes: …; otlp export: …`),
  presence-gated so other hosts render no line. Suite:
  `test/unit/o11y/reportFacts.test.ts` (8 tests over the real
  builder); neighbours (`problemReportDetails`, `acpProblemReport`)
  green.
- Receiver spec fixes found through the Rust client: a span
  `status.code` now takes the string form too (OTLP's JSON mapping
  sends enums as names; prost-based senders send numbers), an empty
  metric `unit` reads absent, and empty link ids (`parentSpanId`,
  log `traceId`/`spanId`) read absent — exporters send `""` for
  unset fields. Each with a unit case.
- `desktop/crates/otel` (`muse-spark-otel`, MIT): `init` validates a
  loopback-only HTTP endpoint and the component name, builds
  tracer/meter/logger providers around OTLP/HTTP JSON exporters
  with async-Tokio batching, installs tracer+meter globals, and
  returns a guard with `shutdown` and the `tracing` bridge layers;
  `install_panic_hook` chains the panic hook to append one
  shape-only crash record to the ring's day file (payload never
  read). Crate pins opentelemetry 0.33.1 family +
  tracing-opentelemetry 0.34.0 with Cargo.lock committed.
  Proof: 8 unit + 1 wiring (real hyper capture server, all three
  signals as OTLP JSON) + 1 doctest, clippy all+pedantic denied,
  `cargo fmt --check`. No CI builds Rust yet (no workflow runs
  cargo); local runs are the proof until the release lane wires it.
- Recorded exchange: `test/unit/o11y/fixtures/otlp-rust-2026-10-31/`
  (bodies exactly as the exporters sent them, with capture date and
  command) ingested for real by `test/unit/o11y/rustExchange.test.ts`
  (spans + error flags, counter value, log severity, log→span link).
- Next: reference/host-api records, CHANGELOG, PLAN status, red/green
  drills, full gates, LANE DONE.

## Part 6 (2026-11-02): records, drills, gates

- `docs/ide-compatibility/host-api.md` regenerated (`check:host-api`
  `--write`): the receiver/exporter Node built-in counts and the two new
  stylesheets' theme variables. `check:reference` passes unchanged: no
  new command, setting or catalogued feature.
- CHANGELOG `[Unreleased]` entry (the node web UI's Diagnostics page,
  in the person's words); PLAN.md M111 status `lane OB built` with the
  reviewed `STATUS_PHRASES` entry; ROADMAP.md regenerated (M111 moves
  from Planned to Being built).

## Part 7 (2026-11-02): the gates the lane had never run

The resume run found three gates red that earlier parts never ran; all
three are fixed in code, none weakened:

- `check:catches`: two new GENERIC sites in `src/runtime/o11y/store.ts`
  (skip-and-count reads). Restructured to the file's own NARROW idiom
  (`isReadError` brand guard, rethrow past it), behaviour unchanged,
  plus the smallest maintained test the behaviour lacked (an unreadable
  day file is skipped, counted, and left by prune).
- `duplication`: 17 clones, every one touching a lane file. Fixed by
  sharing: `scrubFramePath` in new `src/shared/framePath.ts` (M93's
  journal keeps its package-membership check first, outcome identical);
  the diagnostics method binds `guardNodeMethod` directly; the
  step-line charts plot through the new shared `SeriesLines` renderer
  (each chart keeps its own segment rule and y mapping as data);
  `listenLoopback` in `test/unit/helpers/nodeNative.ts`; one-record
  and one-attempt locals in the exchange and exporter suites; shared
  `test/unit/helpers/o11y.ts` fixtures (state root, ready probes,
  seeded signals, span). `ChartFrame`/`StepLines` render
  byte-identical DOM; the a11y scene re-run proves the page. 0 clones.
- `deadcode` (knip): the crash hook file was production-dead (its test
  reaches it only through an esbuild entry string), two lane constants
  unused, one alias duplicated. The hook is now wired for real:
  `installNodeCrashHook` appends the store's crashes day file (0600 at
  creation) and the node CLI installs it at startup; a child-process
  test proves the record lands where the store reads it. `O11Y_STORE_DIR`
  and the `O11Y_DIAGNOSTICS_WINDOW_MS` alias are removed (the window is
  `MILLISECONDS_PER_DAY` at the one use).
- `vitest related` over every changed source file: 1126 files green, 32
  red. One was lane-caused and is fixed (`nodeMethods` 32→33 for the new
  method, the sanctioned one-line reason; the access loop covers the new
  method). One was rig load (`reportJoinAccounts` times out in the
  1197-file run, green alone on the lane tree). The other 30 fail
  identically on the untouched base (measured file by file in a base
  worktree, since removed): the MHP lock drift, the workspace UI and
  files-page failures, and the sandbox/timeout failures far from this
  lane. No lane suite fails anywhere.

## Drills (red/green)

Each drill: break on purpose, non-zero exit, restore byte-identical
(`git diff` clean on the file), green. 2026-11-02, linuxlt.

1. Export off-by-default: `src/core/o11y/export.ts` returned `ok` for
   an unset endpoint. `npx vitest run test/unit/o11y/exporter.test.ts`
   → exit 1, 1 failed (`stays off without an https endpoint`) / 3
   passed. Restored → exit 0, 4 passed.
2. Receiver loopback bind: `src/runtime/o11y/receiver.ts`
   `isLoopback` forced true. `test/unit/o11y/receiver.test.ts` →
   exit 1, 1 failed (`binds loopback and refuses anything else`) / 1
   passed. Restored → exit 0, 2 passed.
3. Severity bands: `O11Y_SEVERITY_BAND` 4 → 5 in
   `src/shared/constants.ts`. `test/unit/o11y/diagnosticsPage.test.tsx`
   → exit 1, 1 failed (`shows severity bands as words and unknown
numbers raw`) / 8 passed. Restored → exit 0, 9 passed.
4. Rust endpoint validation: `endpoint_ok` in
   `desktop/crates/otel/src/lib.rs` forced true. `cargo test
--locked` (lane-local `CARGO_HOME`/`CARGO_TARGET_DIR` under the
   worktree's `temp/`; the shared `~/.cargo` registry is read-only
   in the lane sandbox) → exit 101, 2 failed
   (`refuses_endpoints_off_the_box`, `init_names_its_refusals`) / 6
   passed. Restored → exit 0, 8 + 1 + 1 passed.
5. a11y scene fire: the trace toggle button's label replaced with
   `null` in `DiagnosticsPage.tsx`. `TMPDIR=$PWD/temp node
scripts/a11y.mjs node-diagnostics` → exit 1, `button-name`
   violated on 4 elements (4 themes). Restored → exit 0, 0
   violations.

## Gates

Final tree, 2026-11-02, linuxlt. Exit codes:

- prettier (touched files): 0
- eslint --max-warnings 0 (touched files): 0
- typecheck (all projects): 0
- check-l10n: 0 (0 problems)
- check:reference: 0
- check:host-api: 0
- check:plan: 0 (0 drift)
- check:roadmap: 0
- check:catches: 0 (matches baseline)
- duplication: 0 (0 clones)
- cycles: 0
- deadcode: 0 (only pre-existing hints)
- build: (runs next)
- security:sast, security:audit: (run next)
- a11y node-diagnostics scene: (re-run next)
- vitest related (changed sources): 1126 files green; 32 red, all
  classified above (1 fixed, 1 load, 30 pre-existing on base)
