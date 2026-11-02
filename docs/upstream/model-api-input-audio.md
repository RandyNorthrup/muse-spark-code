# `input_audio` on `muse-spark-1.2-contributor`

Status: **needs live check**. Already filed. Do not open a second issue.
Do not comment until the request below has been run.

Target: <https://github.com/meta-models/meta-model-cookbook/issues/59>

Title on #59: Model API: `input_audio` is accepted but dropped on
muse-spark-1.2-contributor, with no error

Open, no comments, read 2026-11-02. Local draft:
`docs/research/m105-upstream-input-audio.md`.

## Version and OS

Docs read 2026-11-02. The last measurement is the 2026-10-05 capture (U7).
This pass sent no model request.

The video-and-audio page now shows `input_audio` examples on
`muse-spark-1.2`
(<https://dev.meta.ai/docs/video-understanding>, read 2026-11-02). The
capture used `muse-spark-1.2-contributor`. A check of the unsuffixed id
does not retire the capture.

## What the two sources say

2026-10-05, U7: inline wav, inline mp3, and an uploaded wav `file_id` were
accepted. A `muse-spark-1.2-contributor` turn asked for a verbatim
transcript and answered that no audio had been received. HTTP success, audio
dropped, no error.

The same page, read 2026-11-02, shows `input_audio` (`audio/wav` and
`audio/mpeg`, inline or `file_id`) on `muse-spark-1.2` as the transcription
path, and says audio understanding on Muse Spark 1.3 is degraded. It does
not say a successful response may ignore the audio.

## Live check

Throwaway audio only. A short wav with one unique spoken line, plus an mp3
of the same line. Delete every upload afterwards.

1. `POST https://api.meta.ai/v1/responses` with
   `"model": "muse-spark-1.2-contributor"`, the wav inline as `input_audio`,
   and the text "Transcribe this audio. Return only the transcript."
2. The same call with the mp3.
3. Upload the wav with a bounded expiry and repeat with its `file_id`.
4. Record the HTTP status and whether the transcript contains the spoken
   line.
5. Delete the upload.

## Comment on #59 after the check

If the model returns the spoken line:

```text
Re-measured on 2026-11-02. A throwaway wav and mp3 sent as input_audio to
POST /v1/responses with model `muse-spark-1.2-contributor` (inline and as
an uploaded file_id) are transcribed. The 2026-10-05 capture, where the
same model said no audio was received, does not match this run. The
video-and-audio page now shows this as the supported path on
`muse-spark-1.2`. Please confirm and close.
```

If the turn still returns 200 and misses the line:

```text
Re-measured on 2026-11-02. POST /v1/responses with model
`muse-spark-1.2-contributor` still accepts input_audio (inline wav, inline
mp3, and an uploaded wav file_id) and answers without the spoken line and
without an error. The video-and-audio page
(https://dev.meta.ai/docs/video-understanding) now shows this request on
`muse-spark-1.2` as a transcription. Please transcribe the audio, or reject
it with an unsupported-modality error. A 200 that drops the part is the bug.
```

Do not open a second issue. #58 is the count route. This comment stays on
#59.

## Ask

Process standalone audio on the model the docs name, or reject it with a
typed error. The ask already on #59 stands until the live check says the
audio is transcribed.

## Duplicate search

2026-11-02, public issues on `meta-models/meta-model-cookbook`:

- #59 is this report.
- A soundtrack search hits #59 because the body mentions audio. The
  soundtrack of a video is a separate draft
  (`model-api-video-soundtrack.md`) and is not this issue.
- #29 (video, `muse-spark-1.3` at max reasoning, HTTP 500) is a different
  failure.

## Template fields

Do not submit a new issue.

## Workaround

`src/core/media/responsesMediaCodec.ts` lines 117–122 refuse to emit
`input_audio`. `src/core/media/metaMediaCapabilities.ts` lines 62–66 set
audio support to `no`. Leave both until a new capture shows
`muse-spark-1.2-contributor` transcribes the audio. The doc example alone
does not clear them.
