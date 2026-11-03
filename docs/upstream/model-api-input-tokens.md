# `POST /v1/responses/input_tokens` and media

Status: **needs live check**. Already filed. Do not open a second issue.
Do not comment until the request below has been run.

Target: <https://github.com/meta-models/meta-model-cookbook/issues/58>

Title on #58: Model API: `POST /v1/responses/input_tokens` does not count
images or video

Open, no comments, read 2026-11-02. Local draft:
`docs/research/m105-upstream-media-token-count.md`.

## Version and OS

Docs read 2026-11-02. The last measurement is the 2026-10-05 capture. This
pass sent no model request, so it names no new runtime.

The published examples use `muse-spark-1.3`. The capture used
`muse-spark-1.3-contributor` and `muse-spark-1.2-contributor`. Those are
different ids. A check of the unsuffixed id does not retire the capture.

## What the two sources say

2026-10-05, same short text, contributor models
(`docs/research/m105-upstream-media-token-count.md`, U1/U2/U3/U17):

- The count stayed near 170 tokens across video lengths, frame rates and
  image detail. A 600-second video counted 169. Forty-nine images plus a
  video counted 223.
- One real 10-second clip billed 2,751 input tokens on
  `muse-spark-1.3-contributor` and 1,671 on `muse-spark-1.2-contributor`.

Count reference, read 2026-11-02
(<https://dev.meta.ai/docs/api-reference/responses/count-input-tokens>):

> The count includes resolved `previous_response_id` history, current
> instructions and tools, media, and server-injected prompt scaffolding.

The page and the capture disagree. A doc sentence is not a new capture.

## Live check

Throwaway media only. Delete every upload afterwards and confirm it is gone.
No other model id.

1. `POST https://api.meta.ai/v1/responses/input_tokens` with
   `"model": "muse-spark-1.3-contributor"` and one short fixed sentence, no
   media. Record `input_tokens`.
2. Upload a 10-second mp4 (a test pattern, no private picture or speech)
   with a bounded expiry. Count the same sentence plus that file as
   `input_video`.
3. Repeat with a longer throwaway clip, then the 10-second clip at `fps: 1`,
   then several synthetic images.
4. One real turn on `muse-spark-1.3-contributor` and one on
   `muse-spark-1.2-contributor` with the 10-second clip. Record
   `usage.input_tokens`.
5. Delete the uploads.

## Comment on #58 after the check

If the count grows with the media and sits near the billed usage:

```text
Re-measured on 2026-11-02. POST /v1/responses/input_tokens with model
`muse-spark-1.3-contributor` now counts a throwaway video and images, and
the total is in line with usage.input_tokens on a real turn (same clip on
`muse-spark-1.3-contributor` and `muse-spark-1.2-contributor`). The
2026-10-05 capture, which stayed near 170 tokens for a 600-second video,
does not match this run. The count reference now says media is included.
Please confirm and close.
```

Fill in the actual numbers from the run before posting.

If the count stays near the text-only total:

```text
Re-measured on 2026-11-02. The count reference
(https://dev.meta.ai/docs/api-reference/responses/count-input-tokens)
says the count includes media. POST /v1/responses/input_tokens with model
`muse-spark-1.3-contributor` still returns a text-sized total for a
throwaway clip whose real turn bills a much larger usage.input_tokens
on `muse-spark-1.3-contributor` and `muse-spark-1.2-contributor`.
Please count that media, or return an explicit unsupported-media result
instead of a successful text-only total.
```

Fill in the actual numbers. Do not open a second issue.

## Ask

The ask already on #58: count image, video, audio and PDF tokens the way
inference does, or return an explicit unsupported result. It stands until
the live check says the count includes the media.

## Duplicate search

2026-11-02, public issues on `meta-models/meta-model-cookbook`:

- #58 is this report.
- #60 is QuickTime and `compact_threshold`. Different.
- #61 is uploads saved as account files. Different.
- #59 is `input_audio` dropped on a turn. Different.

## Template fields

Do not submit a new issue.

## Workaround

`src/core/media/mediaCost.ts` (header at lines 1–3) estimates from metadata
and billed usage, and does not trust this count route for media. Leave that
until a new capture shows the count includes the media. The doc sentence
alone does not clear it.
