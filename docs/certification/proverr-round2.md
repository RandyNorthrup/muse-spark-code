# Provider refusals round 2 — red table (2026-10-12/13)

Recorded by the lead on 2026-10-12, 6:27–6:28 PM PT (no model ran; account ids
in the xAI and OpenRouter answers replaced with zeros by the lead). Fixtures:
`test/fixtures/provider-refusals/<provider>/bad-key.json|unknown-model.json`,
byte-identical copies of
`~/lanes/_captures/refusals-2026-10-12/<provider>/{models-list-made-up-key,key-check-made-up-key,unknown-model}.json`.

"Round-1 kind" is what the product's own path gives on round-1 code
(`fix/provider-refusals`): the configured path parses with `openAiEnvelope`;
the Anthropic codec with `anthropicEnvelope`; the Gemini codec with
`geminiEnvelope`. Measured with a scratch probe through the real modules
(`parseRefusalError` + `classifyRefusalKind`/`refusalOf`), deleted after the
run. "True kind" is the fact from the table in the lane brief.

| Fixture                          | Status | Round-1 kind (product path)                                   | True kind      |
| -------------------------------- | ------ | ------------------------------------------------------------- | -------------- |
| openai/bad-key                   | 401    | authentication                                                | authentication |
| openai/unknown-model             | 404    | notFound                                                      | notFound       |
| groq/bad-key                     | 401    | authentication                                                | authentication |
| groq/unknown-model               | 404    | notFound                                                      | notFound       |
| deepseek/bad-key                 | 401    | authentication                                                | authentication |
| deepseek/unknown-model           | 400    | **invalidRequest**                                            | notFound       |
| anthropic/bad-key                | 401    | authentication                                                | authentication |
| anthropic/unknown-model          | 404    | notFound                                                      | notFound       |
| fireworks/bad-key                | 401    | authentication                                                | authentication |
| fireworks/unknown-model          | 404    | notFound                                                      | notFound       |
| together/bad-key                 | 401    | **unrecognised** (typeless envelope kept)                     | authentication |
| together/unknown-model           | 404    | notFound                                                      | notFound       |
| openrouter/bad-key               | 401    | **unrecognised** (typeless envelope kept)                     | authentication |
| openrouter/unknown-model         | 400    | **unrecognised** (typeless envelope kept)                     | notFound       |
| xai/bad-key                      | 400    | **unrecognised** (flat `error`-string envelope unread)        | authentication |
| xai/unknown-model                | 404    | **unrecognised** (flat `error`-string envelope unread)        | notFound       |
| gemini/bad-key (configured path) | 400    | **unrecognised** (Google envelope unread by `openAiEnvelope`) | authentication |
| gemini/bad-key (gemini codec)    | 400    | **invalidRequest** (`INVALID_ARGUMENT` matches no kind)       | authentication |
| gemini/unknown-model             | 404    | notFound                                                      | notFound       |
| mistral/bad-key                  | 401    | **unrecognised** (`detail` envelope unread)                   | authentication |
| mistral/unknown-model            | 400    | **unrecognised** (top-level `message` envelope unread)        | notFound       |
| zai/bad-key                      | 401    | **unrecognised** (typeless envelope kept)                     | authentication |
| zai/unknown-model                | 400    | notFound (only via the cross-status `unknown model` phrase)   | notFound       |
| huggingface/bad-key              | 200    | n/a (the model list answers 200 to any key)                   | n/a            |
| huggingface/unknown-model        | 400    | notFound (`model_not_found`)                                  | notFound       |

Bold cells are the red: 12 of the 23 error answers misclassify on round-1
code. Three classes, matching the review findings:

1. Typeless envelopes kept as `unrecognised` (finding 1): Together, OpenRouter
   (both), Z.ai bad-key — 401s the person reads as "unrecognised" instead of
   "your key was refused".
2. Real envelope shapes no parser reads (finding 2): xAI flat (both), Mistral
   `detail` + top-level `message`, Gemini on the configured path.
3. Status/type/code ignored in favour of phrases, or phrases missing where the
   provider gives nothing else (finding 3): Gemini bad-key (`API key not
valid`, reason `API_KEY_INVALID`) → `invalidRequest`; DeepSeek/Mistral/
   OpenRouter unknown-model 400s → `invalidRequest`; Z.ai unknown-model right
   only by accident of the `unknown model` phrase.
