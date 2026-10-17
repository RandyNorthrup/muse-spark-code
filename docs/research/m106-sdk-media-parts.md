# Draft upstream comment — MSP video and audio input

Target: [meta-models/muse-code-sdk#48](https://github.com/meta-models/muse-code-sdk/issues/48)
(the existing file-input request).
This is a local draft, not a posted comment. The lead must check for a
duplicate before filing; the lane brief prohibits network calls here.

## Title

Expose video and audio input parts in MSP alongside file input

## Body

The published `@muse-code/sdk` 1.4.2 declarations describe turn input parts
for text, images and skills. A third-party editor cannot represent an
attached video or audio file through that input contract. Please include
video and audio when adding file input to MSP, with documented format,
size and lifecycle limits and a typed refusal for unsupported input.

Meta's CLI documentation describes media handling through its own file
reader; the SDK should let an editor express the same attachment without
inventing an unsupported wire part or prompting the agent to read a path
instead. This matters for editor integrations outside VS Code as well.

## Reproduction

1. Inspect the published 1.4.2 SDK's `TurnInputPartType` declarations.
2. Attempt to describe a user-selected MP4 attachment as a typed turn input
   part. The declared text/image/skill choices have no video/file part.
3. Compare that surface with the CLI's documented `read_file` media support.

This repro is a type-surface gap; no private file, credential or live model
call is needed. A live `@clip.mp4` MSP drill remains pending in the research
record (U16), so no invented refusal frame is cited.

## Expected

A documented, typed file/video/audio input part, with the same validation
and supported formats as the CLI's media path, usable by SDK clients and
discoverable through capability metadata. Existing input parts should
remain compatible. A rejected attachment should produce a typed error
before inference rather than silently treating it as text.

Evidence: `docs/research/meta-coverage-2026-10-05.md` §§1b and 5;
PLAN.md D86.7. Reconcile this draft with the lead's SDK capture before posting.

## M106 S verification (2026-10-06)

The lane installed the exact published 1.4.2 tarball in an isolated scratch
directory and checked `dist/src/msp.d.ts`: `TurnInputPartType` still names
only `text`, `image` and `skill`. No new input part or refusal frame is
invented. The SDK is now pinned at 1.4.2 in the lane's manifest and lock.
The local echo handshake and empty catalogue required zero model attempts;
they provide no media-support evidence. The lead still owns the dedupe
search and posting; this draft has not been submitted.
