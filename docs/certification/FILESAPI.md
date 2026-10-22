# FILESAPI lane certification (XAI-G11, OPENAI-G15, GAPANTH-G16)

Lane branch `feat/provider-files`, from main `898a26c5e3` (release 0.18.2).
No live request was sent by this lane. The scan records named in the brief
(`~/lanes/_ctx/gaps/<scan>.json`) were absent on this machine, so each gap
was verified against the code at the named files and against the provider
documentation read on 2026-10-13 (addresses below). Every request and reply
shape below is UNVERIFIED until a real request confirms it; the exact
requests the lead must send are in
[FILESAPI-capture-plan.json](FILESAPI-capture-plan.json) (14 requests).

## XAI-G11 — done

**Gap.** The product sent gif and webp images up to 10 MiB to xAI, which
documents jpg/jpeg and png up to 20 MiB; a gif or webp would be sent and
could be refused.

**Evidence the gap was real.** `src/shared/constants.ts` allowed
png/jpeg/gif/webp at 10 MiB for every provider, and
`nativeCapabilityEvidence` in `src/core/providers/modelMetadata.ts` stamped
that same policy onto every non-Anthropic preset.

**What was built.** The xAI image-understanding bounds live in the
capability record and in attach admission, both read from the selected
model's provider, never from a vendor name at the call site:

- `XAI_IMAGE_MEDIA_TYPES` (`image/png`, `image/jpeg`) and
  `XAI_MAX_IMAGE_BYTES` (20 MiB) in `src/shared/constants.ts`.
- `nativeCapabilityEvidence` records the xAI policy for the `xai` preset, so
  the request-time budget refuses gif/webp/oversize with a named reason
  instead of sending them (`src/core/providers/modelMetadata.ts`).
- `projectMediaCapabilities` derives the provider from the model reference
  and projects the xAI formats and size, so the attach flow refuses an
  undocumented format or an over-size image before anything is sent, with
  the existing person-facing reason (`src/host/media/mediaProviders.ts`).

**Documentation.** xAI image understanding, "Image input general limits":
"Maximum image size: `20MiB`", "Supported image file types: `jpg/jpeg` or
`png`." Address `https://docs.x.ai/docs/guides/image-understanding`
(effectively `https://docs.x.ai/developers/model-capabilities/images/understanding`),
read 2026-10-13. UNVERIFIED: capture requests X3 (gif/webp refusal text)
and X4 (a 10–20 MiB png accepted).

**Person's steps.** Select an xAI model (for example `xai/grok-4`). Attach a
gif: attaching is refused with the unsupported-format reason before any
request. Attach a 15 MiB png: it is admitted (previously refused at
10 MiB). Attach a 25 MiB png: refused with the size reason. The lead's
real-life run replays these three attachments against the capture answers.

## OPENAI-G15 — done (builder level; production off until captures)

**Gap.** A PDF or file could not be uploaded to OpenAI and referenced by
`file_id`: the Files route spoke only Meta's dialect (`purpose=user_data`
plus `expires_after`, Meta receipt shape) through the Meta client.

**Evidence the gap was real.** `FilesApi` in
`src/core/backends/modelapi/files.ts` built one multipart layout and parsed
one receipt; `InputFilePart` in `src/core/backends/modelapi/schemas.ts`
carried only `file_data`; nothing implemented the declared
`ResponsesMediaCodec`.

**What was built.**

- `ModelCapabilityRecord` carries a `files` capability: the upload `wire`
  (`meta-files`, `openai-files`, `anthropic-files`), the documented
  per-file `maxBytes`, and `retention` where documented
  (`src/core/providers/capabilityRecord.ts`; user-overridable, Meta default
  recorded). `presetFilesEvidence` seeds `openai`/`xai` with the OpenAI
  dialect and `anthropic` with the Anthropic dialect; anything else stays
  unknown and uploads nothing (`src/core/providers/modelMetadata.ts`,
  wired into both record paths in `src/core/providers/configured.ts`).
- `FilesApi` speaks the wire from its deps (`wireForFiles` selects it from
  the record): exact multipart bytes per dialect (`buildUploadPrefix`),
  per-dialect receipt parsing (`parseUploadReceipt`), retrieve/list/delete
  per dialect, and `file_` id routes accepted by the transport
  (`src/core/backends/modelapi/files.ts`,
  `src/core/backends/modelapi/transport.ts`).
- References are first-class parts: `input_file` with `file_id` and
  `input_image` with `file_id` (`schemas.ts`, durable in
  `sessionStore.ts`, so history keeps ids, never bytes). The Responses
  media codec is implemented: an upload encodes as its file id, never
  bytes; inline mismatches throw; omissions name the cause
  (`codecs/responses.ts`). The budget weighs a reference at zero bytes and
  still counts referenced images against a documented per-request bound
  (`mediaBudget.ts`). Gemini/chat/Ollama/Copilot refuse or mark a
  reference they cannot send; nothing is sent blind or dropped silently.
- A file without provider expiry is now a valid durable reference
  (`src/shared/media.ts`); the ownership ledger still deletes the
  provider's copy when the last session releases it and on explicit delete,
  so no upload stays behind (`src/core/media/uploadLedger.ts`,
  `removeSession` in `src/host/backend/fileSessionStore.ts`).

**Documentation.** OpenAI file inputs guide: "Uploaded file ID
(`file_id`)" is accepted by the Responses API for the listed file types;
Chat Completions takes PDF only. Address
`https://developers.openai.com/api/docs/guides/file-inputs` (redirected
from `https://platform.openai.com/docs/guides/pdf-files`), read
2026-10-13. xAI chat with files: `{"type": "input_file", "file_id":
"file-abc123"}` on `POST https://api.x.ai/v1/responses`; uploads via `POST
https://api.x.ai/v1/files` with `purpose=assistants`. Address
`https://docs.x.ai/developers/model-capabilities/files/chat-with-files`,
read 2026-10-13. UNVERIFIED: capture requests O1–O4 and X1/X2/X5
(purpose values, receipt and list/delete shapes, retention).

**Production state.** Uploads stay off everywhere: the host still projects
`files: 'unknown'`, so every request sends today's inline bytes and every
refusal path is exercised only by tests. Enabling per-provider uploads
waits for the capture answers.

**Person's steps (after the lead enables a wire post-capture).** On an
OpenAI model, attach a PDF once: one `POST /v1/files` upload, then every
later request of the conversation carries `{"type":"input_file","file_id"}`
with no bytes. Deleting the conversation deletes the provider's copy
(Account & usage no longer lists it); the file can also be deleted
explicitly while the conversation lives.

## GAPANTH-G16 — done (builder level; production off until captures)

**Gap.** Images and PDFs always travelled as base64 in every request; the
Files API (upload once, send `file_id`) was not used, so a long
conversation re-sent every attached image on every request.

**Evidence the gap was real.** `codecs/anthropic.ts` built only `base64`
image/document sources; the scan's named files confirmed it.

**What was built.** The Anthropic codec stages file sources beside base64
ones: an image reference becomes `{type:'image',source:{type:'file',
file_id}}`, a document reference becomes `{type:'document',
source:{type:'file', file_id}}`, and a model without image input still gets
the image-omitted placeholder (`src/core/backends/modelapi/codecs/anthropic.ts`).
Uploads speak the Anthropic dialect (`file` plus `expires_in_seconds`,
`file_` ids, RFC 3339 receipts) through the same record-selected client as
above.

**Documentation.** Anthropic Files API guide (status `ga`): upload with
`POST https://api.anthropic.com/v1/files` (`-F "file=@..."`, no beta
header), answer `{id, type:'file', filename, mime_type, size_bytes,
created_at, downloadable, expires_at}`, reference as
`{type:'document',source:{type:'file',file_id}}` or `{type:'image',
source:{type:'file',file_id}}`, delete with `DELETE
/v1/files/{file_id}`, 500 MB per file, `expires_in_seconds` 3600–7776000,
uploaded files are workspace-scoped. Address
`https://platform.claude.com/docs/en/build-with-claude/files`, read
2026-10-13. UNVERIFIED: capture requests A1–A4.

**Person's steps (after the lead enables the wire post-capture).** On an
Anthropic model, attach an image and a PDF, then chat for several turns:
the upload happens once per file and later requests carry only the two
`file_id` sources (visible in the wire capture); deleting the conversation
deletes both provider copies.

## What was deliberately not done

- Chat Completions PDF `file_id` parts: the wire takes them, but the exact
  member shape was not verified today, so the chat codec still refuses file
  parts loudly. Settle with a capture, then map them.
- Enabling uploads in production (`files: 'yes'` projection, codec
  construction): waits for the capture answers by the owner's rule.
- New UI strings: none. The one new model-facing sentence
  (`mediaSourceUnavailable`) is `MODEL_TEXT` and stays English by rule.
