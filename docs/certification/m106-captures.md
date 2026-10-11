# M106 capture receipt — lane 0 (Kubuntu, 2026-10-05)

This rig made **zero live or paid calls** and read no credential. Fixtures
come from the supplied scrubbed `meta-coverage/captures/` records, not from
new requests. The source run is `2026-10-06T00-30-19-038Z`, beginning
2026-10-05 at 17:30 Pacific time (2026-10-06 UTC). The checked-in
[manifest](../../test/fixtures/m106/manifest.json) records source SHA-256,
date, model, sequence and attempt counts; fixture provenance preserves each
source timestamp. No repository workspace is recorded in the standalone
HTTPS probe. None is invented.

The source run made **9 POST /responses attempts**, including one immediate
strict-schema 400 before inference, and **36 non-inference calls**. The
fixtures cover five distinct inference attempts (sequences 34–37 and 40),
including that refusal. U12 and U13 reuse those records and must not be
added to the count again. The status file records two further non-inference
GETs, with and without authentication; it has no run identifier or timestamp,
so its provenance uses the supplied capture date and explicit nulls. U14's
three model-list GETs already belong to the original run's non-inference total.

Only required request/response fields are copied. Public test prompts and
exact selected wire items are retained; encrypted reasoning, unrelated
defaults, account identifiers, media bytes and scrubbed ledger-text excerpts
are omitted. No key or Authorization header is included. No byte-exact full
wire response is claimed for these documented field projections.

| Fixture                      | Source sequences / attempts                   | Evidence and consumer                                                                                                                                         |
| ---------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `u8-hosted-bound.json`       | 34 / 1 inference attempt                      | Exact `max_tool_calls: 1`, one returned `web_search_call`, action and usage; H's bound/settlement tests                                                       |
| `u9-strict-stream.json`      | 35 / 1 inference attempt                      | Strict function schema, safe headers, five complete captured SSE frames and the original stream summary; T's strict schema and L1's available stream evidence |
| `u9-strict-refusal.json`     | 36 / 1 refused inference attempt              | Complete 400 error including `code: null`, message, type and parameter; T's refusal parser                                                                    |
| `u10-structured-output.json` | 37 / 1 inference attempt                      | Exact strict `text.format` schema with a strict function tool at minimal effort, answer message and usage; O1                                                 |
| `u11-compaction.json`        | 38–40 / 1 inference, 2 non-inference attempts | Threshold refusal, input-count result and no returned compaction item with `store: false`; evaluated evidence only                                            |
| `u12-rate-headers.json`      | 34, 35, 37, 39, 40 / reused records           | Streamed, ordinary and count-endpoint header values; 150 requests and 3,000,000 tokens, distinct remaining counts, no reset header; R                         |
| `u13-phases.json`            | 34, 37, 40 / reused records                   | Exact messages with `commentary` and absent phase; no `final_answer` observed; L1                                                                             |
| `status.json`                | status file / 2 non-inference attempts        | Both GETs return 200, `is_alive`, `service_status`, `service_message`, `updated_at`, empty `model_statuses`; R                                                |
| `u14-models.json`            | manifest sequences / 3 non-inference attempts | Equal model IDs for no client, Muse Code and VS Code; no capability inferred from list membership                                                             |

## U9 source limitation

The supplied `results.jsonl` record's `stream.sse_head` stops inside sequence
9, **before** the argument-delta and argument-done frames. Its
`function_call_arguments_delta_events: 2`, event sequence and final
`{"city":"Oslo","unit":"celsius"}` arguments are observed stream-summary
metadata. They cannot establish the individual delta payloads, item IDs or
split points. The fixture explicitly sets `rawArgumentFramesAvailable: false`
and does not turn those summaries into fabricated MSP/Responses frames.
Complete supported frames before the truncation are parsed with the existing
stream schema. L1's exact delta-frame fixture certification still needs the
full scrubbed SSE source; lane 0 requested its location while completing the
rest. No live recapture is authorized here.

## Contracts and validation

The existing optional `CreateResponseBody.max_tool_calls` and
`JsonSchemaTextFormat` match U8/U10. Off requests still omit both fields;
lane T owns the existing function tool's `strict: false` declaration.
`modelApiStatusSchema` validates each consumed top-level status field. Since
only an empty `model_statuses` was captured, entries remain unknown data;
a consumer must validate additional fields from a later capture before use.
Empty `service_message` and `updated_at` are valid observed values.

[The upstream contract record](../research/m106-upstream-contracts.md)
names the exact M95/C1 commits, types and files, provides the applicable
`hosted.maxToolCalls: Known<true>` patch, and specifies the six-section
summary without moving C1's host snapshots into model authority. No other
provider or uncaptured model gains support from this Meta evidence.

`modelApiCaptures.test.ts` validates the selected live frames and the status
boundary. The certification in [m106-0.md](m106-0.md) records the owning
tests, intentional failing drills, byte-exact restores and scoped gates.
