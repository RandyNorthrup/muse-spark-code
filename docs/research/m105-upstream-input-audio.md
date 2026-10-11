# Draft: input_audio is accepted but silently ignored on Muse Spark 1.2 Contributor

Status: local draft for lead dedupe and filing. No issue has been posted.
Evidence: coverage audit 2026-10-05 §6.3, U7; PLAN D85.15.3.

## Body

The count endpoint accepts `input_audio` with inline wav/mp3 and an uploaded
wav, but a Muse Spark 1.2 Contributor turn said it received no audio. A
successful request that discards its audio leaves clients unable to tell
whether transcription or another explicit route is required.

## Reproduction

1. Generate a short wav with an unambiguous spoken line, plus an mp3 version.
2. Send the captured U7 inline forms to the count route; upload the wav with
   bounded expiry and send its captured reference form too.
3. On an owner-authorized 1.2 Contributor turn, ask for a verbatim transcript.
   The captured answer said no audio had been received.
4. Delete every upload and confirm absence.

The lead supplies exact scrubbed U7 payloads and replies. The audit summary
alone does not establish each individual inference variant or a 1.3 result;
those should be described only to the extent the raw receipts show them.

## Expected

Process standalone audio on supported models, or reject it with a clear
unsupported-modality error. Align count and inference behavior and document
supported models, formats, sizes and the batch transcription alternative.
