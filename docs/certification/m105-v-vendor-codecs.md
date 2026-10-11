# M105 lane V (C-M105-4): vendor codec media refusals

Lane: C-M105-4, worktree `/home/randy/lanes/CM1054`, branch `c/m105-4`,
base `68e6e7206` (the finished port of the accepted media work onto 0.17.1).
Scope kept to the lane's named files: `src/core/backends/modelapi/codecs/chat.ts`,
`src/core/backends/modelapi/codecs/gemini.ts`, plus the lane's own test and
docs. No shared hunks with sibling lane PORTM105R2 (attach path): this lane
touches no media-core, attach, ledger, schema or preset file.

## What this lane builds, and why only this

D85.1's vendor rows (Gemini Files/inline data, OpenAI `input_audio`,
vLLM/SGLang `video_url`) have no captured wire: the repository holds Meta
captures only (`docs/research/m105-captures/`, rounds U1-U7/U13/U14/U17/U18),
and AGENTS.md rules 13-14 forbid writing a row, parser or schema from a
guess. No live or paid call was made in this lane. The positive carry shapes
therefore stay unbound, and the gate keeps refusing them before dispatch
(`unknown` support refuses with "not known to take video/audio", D85.1).

What the lane completes instead is the codec stage of the same rule: a held
`input_video` part that reached a Chat Completions or Gemini request used to
ride as the image-omitted placeholder (`[image omitted: this model takes no
images]`), which names the wrong kind and hides the missing binding. Both
codecs now refuse with the model's own translated reason
(`UI_TEXT.media.videoUnknown`, present in all 14 tables, read at call time
through the installed table). No silent drop remains on these two codecs:
every `input_video` input either encodes (Meta's Responses path, captured and
unchanged) or throws a named refusal. Audio needs no codec change: the
canonical schema carries no audio part, so none can arrive; Meta audio stays
refused at the gate and routed to transcription (U7, D85.5, unchanged).

`responses.ts` is intentionally untouched: its video path is Meta's captured
`file_id` shape, and production never sends it a non-Meta video (the gate
refuses first; the ledger and capabilities are Meta-bound). An OpenAI
`input_audio` shape there would need a canonical audio part plus an OpenAI
capture; both are lead-side items below.

## Evidence

- `test/unit/vendorMediaCodecs.test.ts` (9 tests, repository timeout):
  - held video refused on openrouter-like and vllm-like chat quirks, golden
    `"qwen2-vl is not known to take video."` / `"some-model is not known to
take video."`;
  - held video refused on Gemini with vision true/false/absent, golden
    `"gemini-2.5-flash is not known to take video."`;
  - refusal read from the installed table (synthetic German template through
    `setUiText`, restored to English in `finally`);
  - image/text wire around the refusal byte-identical (no placeholder, no
    `video_url`, no `input_video` emitted);
  - composition through production stages on one sniffed clip: the real
    sniffer (`videoFixture` + `sniffMediaBytes`), the real gate
    (`modalityGate` over `metaMediaCapabilities`), and both real codec
    encodes agree on "not known to take video", while the captured Meta
    control (`muse-spark-1.3-contributor`) still admits the same clip.
- Owning suites green: `geminiCodec.test.ts` 67 passed,
  `modelapiChatCodec.test.ts` 92 passed (repository timeout, linuxlt).
- No new localization keys (`videoUnknown` in all 14 tables); no new
  command/setting/feature (no `featureCatalog.ts` change); no new
  dependency; bundle impact is two `fill` imports into modules already
  carrying `l10n/text`.

## Red drills (guard broken, failure seen, file restored byte-exact)

- Drill 1, `codecs/chat.ts`: `input_video` restored to the placeholder
  return; the 4 chat-side tests failed; file restored to SHA-256
  `39629a62bfd68699040d264c246b38de309ae470abb2938c2df53ac298537912`.
- Drill 2, `codecs/gemini.ts`: `input_video` restored to the placeholder
  push; 5 tests failed; file restored to SHA-256
  `8aab8f610ce41d54d9ea9259576717f4762ad8d0a20fd6b857a6a32f3cafb363`.
- Post-drill run: `vendorMediaCodecs.test.ts` 9 passed.

## Lead capture requests (needed before the positive shapes can land)

Each needs an owner-authorized live turn on a contributor/test key, counted
and recorded as in §6 of the research record, with uploads deleted and
confirmed gone. Do not implement from documentation alone.

1. Gemini: `generateContent` with an inline `inlineData` video part (mp4,
   small) and with a `fileData` part after a Files API upload; the exact
   accepted mime set, byte limits, and whether audio rides `inlineData`.
2. OpenAI Responses: `input_audio` (inline base64 + format, and file id
   after an OpenAI Files upload) on a model whose docs claim audio input;
   billed usage for each.
3. OpenAI Chat Completions: `input_audio` (`{data, format}`) on a
   voice-capable model; whether a non-voice model refuses and with what
   error shape (zod schema before use).
4. vLLM/SGLang serving a vision-language model (e.g. Qwen-VL): chat
   `video_url` shape (`{url}` data vs http), accepted mime set and limits.
5. Explicit refusal shapes for each of the above where the model takes no
   video/audio (HTTP status + error body), so the codec throws the wire's
   reason rather than a local one.

Until these land, PLAN.md M105 acceptance 4 ("provider × modality table")
and the "Delivery b" checklist row stay open, correctly: the table's
non-Meta cells read "off: no capture", and the codecs now say the same in
the user's language at the point of refusal.
