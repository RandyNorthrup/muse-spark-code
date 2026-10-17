# Draft: Responses input_tokens should count media

Status: local draft for lead dedupe and filing. No issue has been posted.
Evidence: coverage audit 2026-10-05 §6.2, U1/U2/U3/U17; PLAN D85.15.1.

## Body

`POST /responses/input_tokens` appears to count only the text in a prompt
containing media. Our contributor-model capture run returned about 170 tokens
across video lengths, fps values and image details, including a 600-second
video (169). A prompt with 49 images plus a video counted 223. The real
10-second clip turn billed 2,751 input tokens on Muse Spark 1.3 Contributor
and 1,671 on 1.2 Contributor. This makes media spend admission from the count
route unreliable. PDF counting should also have an explicit supported or
unsupported contract; the available summary does not establish a PDF result.

## Reproduction

1. In an empty workspace, generate a throwaway video with a test pattern and
   speech. Upload it with a bounded expiry.
2. Count the same text alone, with the video's `file_id`, with `fps: 1`, and
   with a longer throwaway clip. Repeat with synthetic images at each detail.
3. Compare the count results with reported usage from one authorized real turn.
4. Delete every upload and confirm it no longer lists.

The lead should attach scrubbed U1/U2/U3/U17 payloads and the exact billed
usage receipt, without credentials, account identifiers or private media.

## Expected

Count image, video, audio and PDF input tokens using the same processing as
inference. If exact counts cannot be supplied, return an explicit unsupported
media result or clearly documented conservative bound rather than a successful
text-only total. Document whether the per-turn 50-media bound is checked here.
