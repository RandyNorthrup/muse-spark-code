# Draft: Document mov support and the Responses compaction contract

Status: local draft for lead dedupe and filing. No issue has been posted.
Evidence: coverage audit 2026-10-05 §6.1 U5 and §6.4 U11; PLAN D85.15.4.

## Body

The guide says video is MP4-only, but U5 accepted mov both through Files and
inline `data:video/quicktime`; WebM was refused. Separately, U11 established
that `compact_threshold` must be at least 1,000. A `store: false` request
with roughly 6.2k input tokens returned the expected answer without a
compaction item. That result is inconclusive about stateless server
compaction; clients need an explicit contract rather than inferring support.

## Reproduction

1. Generate throwaway mp4, mov and WebM clips. Send the captured U5 upload and
   inline forms, requesting expiry for every upload.
2. Observe mp4/mov acceptance and WebM refusal; delete all uploads and confirm
   absence.
3. Send U11's compaction request below the minimum threshold and observe the
   refusal. Repeat its valid request with `store: false` and inspect output
   items. Do not interpret an absent compaction item as proof of support.

The lead attaches scrubbed U5/U11 payloads and error/reply bodies. Any
additional `store: true` experiment requires a separate privacy ruling and
capture; this draft requests documentation, not an automatic new experiment.

## Expected

Document QuickTime/mov and its MIME type, or refuse it consistently. State the
minimum compaction threshold, whether `store: false` can return compaction
items, the conditions for that outcome, and the replay requirements.
