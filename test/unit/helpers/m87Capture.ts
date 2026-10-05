// Frames Muse Code 1.4.2-R4684.1 sent in the M87 lane C live capture
// (2026-10-04, contributor model, the empty folder C:\muse-live-m87c,
// approval mode `denyUnmatched`; docs/certification/m87-c.md). Turn A
// started; B was queued behind it with `ifBusy: "queue"` and unqueued at
// once (the ack, and `turn/unqueued`, which arrived before the ack); B was
// unqueued again (refused `already_applied`); C was queued, launched when A
// ended, and was unqueued late (refused `run_active`). Then `session/read`.
// B never ran: 8 model attempts in all, none for B. The tests build on these
// shapes (AGENTS.md rule 13); cursors and source ranges are kept only where a
// frame is replayed whole.

const SESSION = '01a1052b-7d02-77b1-a8d0-be00fbfcc21e'
const TURN_A = '01a1052b-8b0b-7000-bc70-f6cf7b8cad2f'
const TURN_B = '01a1052b-8e6f-7000-87b1-226272e41a04'
const TURN_C = '01a1052b-965d-7000-819a-ea202e777ebc'

export const CAPTURED_UNQUEUE_SESSION = SESSION
export const CAPTURED_QUEUED_TURN = TURN_B
export const CAPTURED_LAUNCHED_TURN = TURN_C

/** `turn/start`'s ack for B, sent while A ran. */
export const QUEUED_ACK = {
  commandId: TURN_B,
  status: 'accepted',
  turnId: TURN_B,
  startedNewTurn: false,
  disposition: 'queued',
}

/** `turn/unqueue`'s ack for B: admission, and the race won. */
export const UNQUEUE_ACK = {
  commandId: '01a1052b-95b5-7000-a9bc-674959886bbb',
  status: 'accepted',
  turnId: TURN_B,
}

/** `turn/unqueued` for B, carrying the queueing `turn/start`'s commandId; it came before the ack. */
export const UNQUEUED_NOTIFICATION = {
  sessionId: SESSION,
  viewCursor: `v:${SESSION}:5`,
  sourceRange: {
    stream: { kind: 'session', id: SESSION },
    first: { id: '970da521-dc1c-4e7c-aa89-291b305562ef', sequence: 61 },
    last: { id: '970da521-dc1c-4e7c-aa89-291b305562ef', sequence: 61 },
  },
  turnId: TURN_B,
  commandId: TURN_B,
}

/** The JSON-RPC error of the second `turn/unqueue` for B: reclaimed already. */
export const UNQUEUE_ALREADY_APPLIED = {
  code: -32_030,
  message: 'turn/unqueue command 01a1052b-9641-7000-9296-21c9f8f76f66 rejected: already_applied',
  data: {
    kind: 'commandRejected',
    retryable: false,
    commandId: '01a1052b-9641-7000-9296-21c9f8f76f66',
    reason: 'already_applied',
  },
}

/** The JSON-RPC error of `turn/unqueue` for C after it launched. */
export const UNQUEUE_RUN_ACTIVE = {
  code: -32_030,
  message: 'turn/unqueue command 01a1052b-d718-7000-860a-baf303539b73 rejected: run_active',
  data: {
    kind: 'commandRejected',
    retryable: false,
    commandId: '01a1052b-d718-7000-860a-baf303539b73',
    reason: 'run_active',
  },
}

/** C's `userMessage` as `item/completed` carried it at C's launch, after `turn/started`. */
export const LAUNCHED_USER_ITEM = {
  itemId: 'cbbc7fc3-9b73-5c8e-97bf-94abf69ac8b5',
  kind: 'userMessage',
  turnId: TURN_C,
  revision: 1,
  status: 'completed',
  recordedAt: '2026-10-04T04:28:41.395958Z',
  text: 'Reply with the single word: done.',
  commandId: TURN_C,
}

/** C's reply as `item/completed` carried it (four fractional digits, as sent). */
export const LAUNCHED_REPLY_ITEM = {
  itemId: '9693f6f5-dd25-40e8-9d32-0ae7ed86b7d6',
  kind: 'agentMessage',
  turnId: TURN_C,
  revision: 2,
  status: 'completed',
  recordedAt: '2026-10-04T04:28:45.3155Z',
  text: 'done',
}

/** The user and reply items `session/read` served afterwards; B is not among them. */
export const UNQUEUE_HISTORY_ITEMS = [
  {
    itemId: 'fffa73a2-bb12-42c8-a3a0-7840824cfe1f',
    kind: 'userMessage',
    turnId: TURN_A,
    revision: 1,
    status: 'completed',
    recordedAt: '2026-10-04T04:28:22.709057Z',
    text: 'Count from one to thirty in words, one number per line, and nothing else.',
    commandId: TURN_A,
  },
  {
    itemId: 'f5a1acb5-58f3-44c3-b809-0aec22c409d7',
    kind: 'agentMessage',
    turnId: TURN_A,
    revision: 2,
    status: 'completed',
    recordedAt: '2026-10-04T04:28:27.922132Z',
    text: 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\ntwelve\nthirteen\nfourteen\nfifteen\nsixteen\nseventeen\neighteen\nnineteen\ntwenty\ntwenty-one\ntwenty-two\ntwenty-three\ntwenty-four\ntwenty-five\ntwenty-six\ntwenty-seven\ntwenty-eight\ntwenty-nine\nthirty',
  },
  LAUNCHED_USER_ITEM,
  LAUNCHED_REPLY_ITEM,
] as const
