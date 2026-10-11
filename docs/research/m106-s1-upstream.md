# Draft upstream requests — M106 S1 native readers (C-M106-3)

These are local drafts, not posted issues. The lane brief prohibits network
calls here; the lead must check for duplicates before filing. No URL is
named because no existing issue number was verified for these frames.

## Request 1: `session/delete` and its terminal frame

Muse Code 1.4.4 answers `session/delete` with `methodNotFound` (captured
`test/fixtures/m106/msp-1.4.4-host-feedback.json`, id 6) and sends no
`session/deleteCompleted` frame, so the extension refuses deletion before
dispatch (`sessionDeleteUnsupported`) and History stays archive-only. Please
ship a typed `session/delete` admission plus a terminal
`session/deleteCompleted` notification carrying the session id, the command
id, a terminal outcome (`completed` with its physical-change evidence, or
`failed` with `reason` and `physicalChange`), usable by SDK clients and
gated by a capability. A refused deletion must arrive typed before any
erasure rather than as silence.

## Request 2: attachment-enabled `feedback/submit` outcomes

The 1.4.4 capture certifies the note-only receipt (`outcome: uploaded`,
id 5). No frame certifies a receipt with a session record attached, so the
native reader refuses one with `feedbackRecordUnsupported` instead of
reporting an uncertified disclosure. Please document the receipt shape for
`withFiles` / `attachSessionRecord` submissions: which outcome values are
possible, which identifiers (upload id, bundle path) a client may show, and
what privacy guarantees hold for the attached record. Until then editors
cannot honestly display an attachment-enabled outcome.

## Request 3 (noted, owned elsewhere): durable history notifications

`session/listChanged` was not observed and durable-session history
notifications still require capture (C-M106-1 manifest). No refusal was
added for them here; recording the gap so the capture lane can close it.
