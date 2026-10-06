# M106 capture handoff — lane 0 (2026-10-05)

This rig made **zero live or paid calls**. The owner's key and raw capture
records are on the lead's host; neither was available in this checkout.
No synthetic frame is labelled as a live capture.

The evidence available here is
[`meta-coverage-2026-10-05.md` §6](../research/meta-coverage-2026-10-05.md).
It reports 9 `POST /responses` attempts, including U9's invalid-schema 400
before inference, and 36 calls that inferred nothing. Those are the source
run's totals, not per-capture counts. The source describes throwaway media;
the actual workspace identifier and per-capture attempt counts must accompany
the raw records before fixture certification can be completed.

| Capture      | Evidence in the research record                                                                                                              | Fixture handoff needed from the lead                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| U8           | `max_tool_calls: 1` returned exactly one `web_search_call`                                                                                   | Exact scrubbed request and response, including returned search items and usage       |
| U9           | Two argument deltas followed by `.done`; strict schema refusal includes "'additionalProperties' is required to be supplied and to be false." | Exact SSE frames and the complete 400 body, not a reconstruction from this quotation |
| U10          | Strict `text.format` `json_schema` worked with a function tool at minimal effort                                                             | Exact request, schema and answer frames                                              |
| U12          | Four request/token limit and remaining headers; limits 150 requests and 3,000,000 tokens per minute; no reset header                         | Exact streamed and non-streamed header records, including remaining values           |
| U13          | `commentary` was observed; most messages omitted `phase`; `final_answer` was not returned                                                    | Exact message frames with and without phase                                          |
| U11          | No compaction item for `store: false` and a 6.2k-token input                                                                                 | Inconclusive; no compaction parser or production arm is introduced                   |
| `/v1/status` | Not yet captured                                                                                                                             | Lead-only GET capture: status, body and safe headers; no inference required          |

The request contracts add optional `max_tool_calls` and
`text.format: { type: 'json_schema', name, schema, strict }` for the features
confirmed by U8 and U10. They do not introduce a parser for an uncaptured
service response. They omit both fields on the existing text path. The
literal `strict: false` tool declaration remains lane T's property.

Other providers' hosted bounds, strict-tool and rate-header claims need
their own captures before capability rows turn them on. This lane does not
claim that Meta's observed limits apply to another key or provider. The
startup pacing constant is a provisional conservative allowance, not a
captured account limit; lane R replaces it with the latest captured headers.

The lead should place scrubbed U8–U13 frames in `test/fixtures/m106/` with a
manifest naming their original record, workspace and counted attempts, then
add parsing tests from those exact frames. No fixture directory with fake
wire data has been created merely to satisfy that checklist.
