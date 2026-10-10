# Draft: Muse Spark 1.3 does not hear a video's soundtrack; 1.2 does

Status: local draft for lead dedupe and filing. No issue has been posted.
Evidence: coverage audit 2026-10-05 §6.3, U4; PLAN D85.15.2.

## Body

With the same throwaway 10-second mp4 containing a visible test pattern and
spoken line, Muse Spark 1.3 Contributor recognized the video but said no
speech was audible. Muse Spark 1.2 Contributor transcribed the line exactly.
The video-understanding guidance should distinguish visual and soundtrack
support by model, and the Responses API should make unsupported audio
observable instead of silently dropping part of a multimodal input.

## Reproduction

1. Generate an mp4 with a test pattern and an unambiguous spoken line.
2. Upload it with a bounded expiry and ask each contributor model to transcribe
   its soundtrack using the same captured U4 request.
3. Compare the answers: 1.3 did not hear speech; 1.2 transcribed it.
4. Delete the upload and confirm it no longer lists.

The lead attaches scrubbed U4 requests, replies, media-generation recipe and
usage, without private content or account identifiers. This lane does not
repeat the calls or claim results for Standard or Muse Spark 1.1.

## Expected

Either 1.3 hears a supported video's soundtrack, or the documentation and
model capabilities explicitly say it does not. Provide a machine-readable
warning or refusal for ignored audio, and document a reliable supported path.
