# `feedback/submit` receipt shape

Status: **fixed upstream**. Do not file. The 1.4.14 schema documents the
receipt the draft asked for. Removing the local refusal still needs a
capture of an attached session record. This pass did not take one.

Local draft: `docs/research/m106-s1-upstream.md`, request 2.

## Version and OS

- Muse Code 1.4.14 (1.4.14-R7309.1), schema generated 2026-11-02.
- macOS 15.7.4 (24G517). `uname -mprs` prints `Darwin 24.6.0 x86_64 i386`.
- Offline `muse schema generate-ts`. No model request and no
  `feedback/submit` call.

## What the draft asked

The 1.4.4 capture certified a note-only receipt (`outcome: uploaded`). No
frame certified `withFiles` / `attachSessionRecord`. The draft asked for the
outcome values, the identifiers a client may show, and what the attached
record implies.

## What 1.4.14 documents

Stable schema, `feedback/submit`:

- Params include `withFiles` (required) and `attachSessionRecord`. The
  schema says the attachment is honored only for classification `bug` or
  `badResult` when `sessionId` is present, and that other combinations are
  `invalidParams`.
- `outcome` is an open enum: `uploaded`, `recorded`,
  `acceptedWithoutReceipt`, `trackingFailed`, `trackingUncertain`, `dark`,
  `disabled`, `noCredential`, `authRejected`, `rateLimited`, `failed`.
- The result requires `bundlePath`, `outcome`, `sessionRecordAttached` and
  `sessionRecordTruncated`. Optional fields include `uploadId`, `taskId`,
  `cause`, `retryAfterMs`, `localTracingNote` and `sessionNote`.

That is the documentation the draft asked for. A client can read it from
`muse schema generate-ts` on 1.4.14.

## Ask

Nothing to file.

## Duplicate search

No new issue. The draft was a documentation request against the schema, and
the schema now has the fields.

## Template fields

Do not submit an issue.

## Workaround

`src/core/backends/musecode/feedback.ts` lines 73–75 throw
`feedbackRecordUnsupported` when `sessionRecordAttached` is true, including
when `outcome` is `uploaded`. Other known outcomes already have their own
sentences and are still refused by this reader (lines 76–79). Leave the
refusal until a capture shows an attached-record receipt. The schema is not
that capture.
