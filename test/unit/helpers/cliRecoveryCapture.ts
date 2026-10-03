// What Muse Code 1.4.2-R4684.1 sent in the owner's session of 2026-10-02/03
// (CLI recovery), as the extension logged it (window1 exthost "Muse Spark.log"
// lines 544-546, session 01a0fcee-f38b-71c1-b108-f8de2a2ac65b; no model call
// was made to capture it). The error kind of the refused `turn/start` was not
// logged: it is `internal` (-32603) here, as Muse Code answers its replay
// fault in the same "turn/start runtime submit failed: …" words.

/** The reason the running turn failed with at 10:02:30. */
export const EVENT_LOG_TURN_REASON =
  'event log failed: Origin read requires valid checkpoint-suffix or origin-preserved full-replay authority'

/** Every later `turn/start` of that session (10:02:53, 10:04:47). */
export const EVENT_LOG_SUBMIT_MESSAGE =
  'turn/start runtime submit failed: event log failed: event id 5e12efd9-c4d8-5c80-8a9f-9f46ecb5cf9b conflicts with an existing event'

const INTERNAL_ERROR = -32_603

/** A request handler that refuses as that session's `turn/start` did. */
export function eventLogFault(): never {
  throw Object.assign(new Error(EVENT_LOG_SUBMIT_MESSAGE), {
    code: INTERNAL_ERROR,
    kind: 'internal',
    data: { kind: 'internal', retryable: false },
  })
}
