# QuickTime video and the Responses compaction parameters

Status: **needs live check**. Already filed. Do not open a second issue.
Do not comment until the request below has been run.

Target: <https://github.com/meta-models/meta-model-cookbook/issues/60>

Title on #60: Model API docs: QuickTime (.mov) video is accepted but
undocumented; `compact_threshold` minimum and `store: false` compaction are
unspecified

Open, no comments, read 2026-11-02. Local draft:
`docs/research/m105-upstream-mov-compaction.md`.

## Version and OS

Docs read 2026-11-02. The last measurement is the 2026-10-05 capture (U5,
U11). This pass sent no model request.

## What the sources say

2026-10-05:

- U5: a throwaway `.mov` (`video/quicktime`) was accepted both as an upload
  and inline. WebM was refused. The guide listed mp4 only.
- U11: `compact_threshold` below 1,000 was refused. A `store: false` request
  with about 6,200 input tokens returned an answer and no compaction item.
  That run does not prove whether stateless compaction is supported.

Video-and-audio page, read 2026-11-02
(<https://dev.meta.ai/docs/video-understanding>): the supported-formats
table lists `video/mp4`, `audio/mpeg` and `audio/wav`. It does not list
`video/quicktime` or WebM.

A search of the public docs the same day did not find `compact_threshold`.
The Responses page
(<https://dev.meta.ai/docs/protocols/responses>) describes trimming history
in the client, and `store: false` for encrypted reasoning replay. That is a
different contract from a server compaction item. The Segment Anything
pages accept MOV for segmentation. That is not Muse Spark video
understanding, and it does not close the QuickTime half of #60.

## Live check

Throwaway clips only. Delete every upload afterwards.

1. Upload a short `.mov` (`video/quicktime`) and a short `.webm`, each with
   a bounded expiry. Send each to `POST https://api.meta.ai/v1/responses`
   with `"model": "muse-spark-1.3-contributor"` as `input_video`, and send
   the `.mov` once inline as a data URL. Record which are accepted.
2. Re-read the compaction parameters in the current Responses reference. If
   `compact_threshold`'s minimum and the `store: false` behaviour are now
   stated, the documentation half of that item is done and only the call
   remains.
3. Send one request with `compact_threshold` below 1,000 and record the
   error. Send one with `store: false` and a prompt large enough to compact,
   and record whether a compaction item is present. An absent item is not
   proof of support; write down what the response actually contains.
4. Delete the uploads.

`store: true` is a separate retention choice. This check does not ask for it.

## Comment on #60 after the check

Post one comment with the measured accept/refuse results and whatever the
compaction call returned. Two endings:

- `.mov` still accepted while the formats table lists only `video/mp4`: ask
  them to document `video/quicktime` or to refuse it. WebM stays refused if
  the new call still refuses it.
- The docs now state the `compact_threshold` minimum and the `store: false`
  result, and the call matches that text: say the 2026-10-05 gap is closed
  for that half and ask them to confirm.

Do not open a second issue. Do not cite the Segment Anything MOV note as
the video-understanding contract.

## Ask

The ask already on #60: document QuickTime or refuse it, and state the
`compact_threshold` minimum and whether `store: false` can return a
compaction item.

## Duplicate search

2026-11-02, public issues on `meta-models/meta-model-cookbook`:

- #60 is this report.
- #58 is the token-count route. Different.
- #59 is standalone `input_audio`. Different.
- #29 is HTTP 500 for video on `muse-spark-1.3` at max reasoning. Different.

## Template fields

Do not submit a new issue.

## Workaround

`src/core/media/metaMediaCapabilities.ts` line 28 lists `video/quicktime`
from the 2026-10-05 capture. Leave it until a new capture shows `.mov`
refused. Nothing in this tree sends `compact_threshold`; there is no local
compaction workaround to remove.
