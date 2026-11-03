# Muse Spark 1.3 and a video's soundtrack

Status: **needs live check**. Not filed. File only if the check below still
fails. It is not #59 and it is not #29.

Target, if the check fails: a new bug on
<https://github.com/meta-models/meta-model-cookbook/issues/new>

Suggested title: Model API: `muse-spark-1.3-contributor` describes a video
and does not transcribe its soundtrack, with no error

Local draft: `docs/research/m105-upstream-video-soundtrack.md`.

## Version and OS

Docs read 2026-11-02. The last measurement is the 2026-10-05 capture (U4).
This pass sent no model request.

The published examples use `muse-spark-1.3` and `muse-spark-1.2`. The
capture used `muse-spark-1.3-contributor` and `muse-spark-1.2-contributor`.
The live check has to use the contributor ids.

## What the two sources say

2026-10-05, one 10-second mp4 with a test pattern and one spoken line:

- `muse-spark-1.3-contributor` described the picture and said no speech was
  audible.
- `muse-spark-1.2-contributor` transcribed the line.

Video-and-audio page, read 2026-11-02
(<https://dev.meta.ai/docs/video-understanding>):

- "Muse Spark reads a video's embedded audio too, not just its frames — a
  single upload can return both a visual description and a transcript of any
  speech in one call."
- A callout on the same page: "Audio understanding in Muse Spark 1.3 is
  currently not fully supported, and response quality for requests including
  audio content may be degraded. These examples use Muse Spark 1.2 instead."
- The audio section says a video part carries its embedded audio.

The page says both that one upload returns a transcript and that 1.3 audio
is degraded. It does not say the soundtrack is dropped with no error. The
2026-10-05 capture is the last behaviour measurement, and the page has
changed since then, so the behaviour has to be checked again before filing.

## Live check

One throwaway 10-second mp4: a test pattern and one unique spoken sentence.
Upload it with a bounded expiry. Ask each model, in the same words, for a
verbatim transcript of the soundtrack. Delete the upload afterwards.

1. `POST https://api.meta.ai/v1/responses` with
   `"model": "muse-spark-1.3-contributor"` and the file as `input_video`.
2. The same call with `"model": "muse-spark-1.2-contributor"`.
3. Record both answers and whether either contains the spoken sentence.

## If 1.3 now transcribes the line

Do not file. The 2026-10-05 gap is stale. A new capture is still required
before `hearsSoundtrack` can change; this doc read is not that capture.

## If 1.3 still misses the line

File on `meta-models/meta-model-cookbook`. Body:

```text
A throwaway 10-second mp4 (test pattern plus one spoken sentence), uploaded
with a bounded expiry and sent as input_video:

- `muse-spark-1.3-contributor` describes the picture and does not return
  the sentence, and the response is success with no error.
- `muse-spark-1.2-contributor` returns the sentence.

https://dev.meta.ai/docs/video-understanding says a video part carries its
embedded audio and that one upload can return a transcript, and the same
page says Muse Spark 1.3 audio understanding is degraded and points audio
examples at `muse-spark-1.2`.

Please transcribe the soundtrack on `muse-spark-1.3-contributor`, or refuse
or warn in a machine-readable way and stop saying one upload returns a
transcript on 1.3. A successful answer that drops the audio is the bug.
```

Fill in the actual answers, with the media and any account id removed.

## Ask

Either 1.3 contributor hears the soundtrack, or the docs and the API say it
does not and a dropped soundtrack is an error the client can read.

## Duplicate search

2026-11-02, public issues on `meta-models/meta-model-cookbook`, open and
closed:

- No issue is this soundtrack report.
- #59 is standalone `input_audio` on `muse-spark-1.2-contributor`. A
  soundtrack search hits it because the body mentions audio. It is not this
  bug. Comment there only for the `input_audio` check in
  `model-api-input-audio.md`.
- #29 is HTTP 500 for video on `muse-spark-1.3` at max reasoning, while
  xhigh succeeds. A success that ignores speech is not that failure.
- #60 is QuickTime and compaction parameters. Different.

## Template fields

Use the cookbook bug form if the check still fails.

- What happened, and what did you expect instead? See the body above.
- Model: `muse-spark-1.3-contributor` and `muse-spark-1.2-contributor`.

## Workaround

`src/core/media/metaMediaCapabilities.ts` line 32 sets `hearsSoundtrack` to
`yes` only for `muse-spark-1.2-contributor`. `src/core/media/modalityGate.ts`
line 108 warns otherwise. Leave both until a new capture shows 1.3
contributor transcribes the line. The doc page alone does not clear them.
