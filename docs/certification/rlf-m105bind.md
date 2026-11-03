# RLF-M105BIND — Media production binding (2026-11-02)

Lane commit: `a77e20a96` (code), records in the following commit.
Base: `72d8d5003` (rv/int9). No live or paid call was made.

## What was unbound

- Video and soundtrack hearing lived only in two string-keyed tables
  (`metaMediaCapabilities`, `audioCaps`), not on the selected model's
  evidence-bearing capability record (M95), whose modalities had no
  video row at all. The session replay gated and priced a prepared
  item through that table alone.
- `prepareAudioMessage` ran whenever its port was bound, even with no
  media service to consume the prepared video part: transcription
  could spend on a turn that then refused the part.
- Headless `exec` had no Muse Voice: its run ledger admitted no
  transcription spend (PLAN §7, M105-V open item), the pinned
  transport refused the `/asr/transcribe` route by shape, and the
  reservation seam in exec fell back to the daily file ledger.

## Connections (file:line at the lane commit)

- Record schema: `src/core/providers/capabilityRecord.ts:136` — a
  `video` modality (`mimes`, `maxBytes`, `maxDurationSeconds`, `fps`,
  `hearsSoundtrack`) beside image/pdf/audio; unknown stays unknown.
- Capture evidence: `src/core/providers/capabilityRecord.ts:391`
  `metaCapabilityRecord` — contributor 1.2/1.3 take mp4/mov, 600 s,
  fps 1–2; 1.2 hears the soundtrack, 1.3 does not (U4); standalone
  audio is `no` (U7). Source kind `capture`, ref
  `docs/certification/m105-captures.md`.
- Projection: `src/core/media/recordMediaCapabilities.ts:26`
  `mediaCapabilitiesFromRecord` — the gate's view of one selected
  record (support, formats, bounds, hearing, Files).
- Captured table: `src/core/media/metaMediaCapabilities.ts` is now
  that projection of `metaCapabilityRecord` for the two captured
  models, unknown elsewhere (unchanged rows).
- Sound router: `src/core/voice/transcribeBatchHttp.ts` `audioCaps`
  reads the same projection.
- Prepare: `src/core/media/replayMedia.ts:229` — while the host
  supplies `recordFor` (`replayMedia.ts:53`), its projection governs
  gating and pricing; the session supplies its current resolution at
  `src/core/backends/modelapi/ModelApiHost.ts:3523` through
  `src/core/media/productionMedia.ts:200`.
- Consumer guard: `src/core/backends/modelapi/ModelApiHost.ts:17260`
  — no audio preparation while `this.media` is absent.
- Consent (D48, headless form): `src/runtime/exec/execArgs.ts` —
  `exec --muse-voice` joins `ExecPaidFeature`, requires
  `acceptEdits` (existing translated `execPaidNeedsEdits`), is
  Model-API-only by name in the refusal, and
  `isHeadlessPaidUseAllowed` admits a voice use only with the flag,
  acceptEdits and budget remaining; a refused use emits a `paid_use`
  `refused` event (`src/runtime/exec/runExec.ts`, headlessPaid).
- Run ledger: `src/runtime/exec/runLedger.ts:412`
  `admitTranscription` (exact bounded cost), `:541`
  `settleTranscription` (returned priced from the receipt's cost,
  breach past the reserve; refunded zero; unknown at the full
  reservation), `:431` `hasActiveTranscription`; totals carry
  transcription counters and `transcribedSeconds`.
- Reservation binding: `src/runtime/exec/runExec.ts:1241`
  `reserveTranscription` over the run ledger, emitting `attempt`
  (`endpoint: 'transcribe'`) and `paid_use` (`feature: 'voice'`)
  admitted/settled events; `src/runtime/backends.ts:796` routes every
  exec exact reservation there and refuses in words
  (`paidDailyLedgerUnavailable`) where the run has no ledger-bound
  transport (provider and plan runs) instead of spending on the
  daily file.
- Transport: `src/runtime/exec/execFetch.ts:184` — the captured
  `POST /v1/asr/transcribe?sessionId=<uuid>` with multipart body
  forwards only with the flag on and a reservation held; otherwise
  it refuses with the request shape and a `paid_use refused` event.
- Account: unchanged and exercised by the same seams — uploads bind
  the ledger's key digest (`UploadLedger.currentAccountId`), the
  transcription POST binds the session account at dispatch
  (`productionAudioEntry` → `requestTranscription(..., accountId,
dispatch)`), now reached in exec only under the run's account.
- Protocol: `src/runtime/exec/execProtocol.ts` — `transcribe`
  attempt endpoint, `voice` paid-use feature, transcription paid
  totals (strict schema + refine); `docs/schemas/exec-*-v2` and the
  Action mirror (`action/lib/result.mjs`) updated to match.
- Refusals in words: missing capability — the gate's model sentence
  (`media.videoUnknown`/`videoUnsupported`/`audioUnknown`); missing
  converter — the discovery reason (`productionAudio.assertConvertible`,
  unchanged); missing recorder — the recording drivers' refusals
  (RLF-RECORDING, unchanged).

## Tests (real code only)

`test/unit/m105bind.test.ts`, 15 tests through the real resolver,
projection, gate, replay, ledger, argument parser and transport
(the transport's upstream is a real `Response` through the real
pinned fetch, the established pattern of `execFetch.test.ts`).

Red/green drills on 2026-11-02, each against
`npx vitest run test/unit/m105bind.test.ts --maxWorkers=3` with the
repository's own timeouts:

1. Record precedence: `recordFor` read replaced with `undefined` in
   `replayMedia.ts` → 1 failed / 14 passed ("refuses in words when
   the selected record says no"); restored → 15 passed.
2. Reservation gate: `hasActiveTranscription` forced `true` in
   `runLedger.ts` → 2 failed / 13 passed (the unreserved POST and
   its refusal event); restored → green.
3. Headless admission: the voice branch's flag and acceptEdits
   checks removed in `execArgs.ts` → 1 failed / 14 passed
   ("admits a voice use only with its flag…"); restored → 15
   passed.

Suites run: m105bind (15), runLedger (50), execArgs (67),
execFetch (3), capabilityRecord (45), modalityGate (14),
transcribeBatchHttp (1; its real-ffmpeg case self-skips on this rig:
no converter installed), execHumanReason (2) — all green.

## Not claimed

- Owner-device receipts: one real recording per OS through the
  packed product (with the permission recovery run). Owner steps,
  listed here and in PLAN M105, not claimed by this lane.
- The packed-product real-life run and any live transcription:
  not run; no paid call in this lane.
- Attach-chip UI for the sound choices (Use 1.2, Send without
  sound): still the router's default (PLAN §7, unchanged).
- Provider and plan (subscription) exec runs refuse the
  transcription reservation in words by design: the subscription
  never pays for a paid extra, and a configured provider's
  transcription wire is uncaptured.
