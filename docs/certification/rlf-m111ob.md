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
- [ ] Diagnostics page `src/webview/diagnostics/**` + node web UI page (app mount waits for WB)
- [ ] M93 bundle desktop files (with M93's owner)
- [ ] `desktop/crates/otel/**` Rust wiring
- [ ] Reference/host-api records
- [ ] Red/green drills, gates, CHANGELOG, PLAN status

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

The Diagnostics page (`src/webview/diagnostics/**` + the node web UI
page), then M93's bundle desktop files, then the Rust crate.

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

## Drills (red/green)

None yet.

## Gates

None yet.
