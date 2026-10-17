# Local model servers (Ollama, LM Studio, vLLM, llama.cpp, custom OpenAI-compatible): features and limits — research and product comparison

Research date 2026-10-17. Official sources only (§1): each server's own
documentation. Product: `main` at `3d30a73214` (read only). Owner's rule
(2026-10-17, binding): "the limits we set on our agents hardcoded are **ONLY**
the limit set from the providers" and "**ALL** every model available through
every provider all hooks all features all limits etc".

Classes: **(a)** matches the server; **(b)** differs (both values given);
**(c)** missing from the product; **(d)** hard-coded in the product but not a
server limit.

**Models.** A local server runs whatever the user installs; there is no
provider model catalogue to count. The limit that matters per model is the
context the server allocates (and the model's trained maximum), which each
server reports through its own API. Rows below therefore compare how each
server states context and endpoints with how the product reads them.

All five presets have `wireCapture: false` (`presets.ts:704,728,752,777,802`),
so none is listed in the panel (rule 13); the rows describe what the presets
would do.

## 1. Sources

| Key        | URL                                                                                               | Read       |
| ---------- | ------------------------------------------------------------------------------------------------- | ---------- |
| OLLAMA-API | https://docs.ollama.com/api                                                                       | 2026-10-17 |
| OLLAMA-CTX | https://docs.ollama.com/context-length                                                            | 2026-10-17 |
| LMS        | https://lmstudio.ai/docs/app/api/endpoints/rest                                                   | 2026-10-17 |
| VLLM       | https://docs.vllm.ai/en/latest/serving/online_serving/                                            | 2026-10-17 |
| LLAMACPP   | https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md (the project's own docs) | 2026-10-17 |

## 2. Summary

- **Counts** (class tags on the 14 classified rows of §3; a row may carry
  two): **(a) 7, (b) 3, (c) 1, (d) 4**. Itemised changes (§4): 3 (b), 2 (c), 3 (d).
- **Most important mismatches.**
  1. **Ollama context choices are the product's own**: the panel offers only
     32,768 / 65,536 / 131,072 (`constants.ts:7166-7168`,
     `webview/models/ModelsSection.tsx:252`). Ollama's own default depends on
     VRAM — "under 24 GiB gets 4k tokens, 24-48 GiB gets 32k, and 48 GiB or
     more gets 256k"; `OLLAMA_CONTEXT_LENGTH` changes it; cloud models run at
     their maximum (OLLAMA-CTX).
  2. **llama.cpp's list has no `n_ctx`**: `/v1/models` carries
     `data[].meta.n_ctx_train`; the runtime context is in `GET /props`
     (`default_generation_settings.n_ctx`) and per slot in `GET /slots`
     (LLAMACPP). The preset reads `n_ctx` from the list (`presets.ts:769`).
     Its default port is **9931** (LLAMACPP); the preset assumes 8080
     (`presets.ts:763`).
  3. **LM Studio's current REST API is `/api/v1/*`** (`/api/v1/chat`,
     `/api/v1/models`, load/unload/download); v0 is "recommended" against;
     context length can be set per request only on `/api/v1/chat` (LMS). The
     preset reads `max_context_length` from the OpenAI-compatible
     `/v1/models` (`presets.ts:721`), a field LMS does not document there.
  4. **Ollama native stream bounds** (1 MiB frame, 256 KiB tool arguments,
     2 MiB item, 128 items, 16 MiB stream, `constants.ts:7320-7324`) are the
     product's own.

## 3. Features and limits per server

| Server / item                   | Server value                                                                                                                                                                                                                          | Source     | Product today (file:line)                                                                                                                | Class                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Ollama endpoints                | native `http://localhost:11434/api` (`/api/chat`, `/api/tags`, `/api/show`); OpenAI-compatible `/v1`; Anthropic-compatible                                                                                                            | OLLAMA-API | native wire (`presets.ts:695`, `codecs/ollama.ts`), loopback 11,434 (`presets.ts:696`), list `/api/tags` (`presets.ts:702`)              | (a)                              |
| Ollama default context          | VRAM-based: < 24 GiB → 4k; 24-48 GiB → 32k; ≥ 48 GiB → 256k; `OLLAMA_CONTEXT_LENGTH`; `ollama ps` shows the allocated context                                                                                                         | OLLAMA-CTX | `num_ctx` sent from the user's pick of 32,768 / 65,536 / 131,072 or the record's context (`configured.ts:681`; `constants.ts:7166-7168`) | (d) the three fixed choices      |
| Ollama model maximum            | not stated on the page read ("Cloud models are set to their maximum context length by default")                                                                                                                                       | OLLAMA-CTX | `/api/show` `model_info.*.context_length` read (`codecs/ollama.ts`)                                                                      | not documented on the pages read |
| Ollama stream bounds            | none documented                                                                                                                                                                                                                       | —          | 1 MiB / 256 KiB / 2 MiB / 128 / 16 MiB (`constants.ts:7320-7324`)                                                                        | (d)                              |
| Ollama tool choice              | not documented on the pages read                                                                                                                                                                                                      | —          | `toolChoice: 'omit'` (`presets.ts:219`)                                                                                                  | not documented                   |
| LM Studio endpoints             | native `/api/v1/chat`, `/api/v1/models`, `/api/v1/models/load`, `/unload`, `/download`, `/download/status`; OpenAI-compatible `/v1/responses`, `/v1/chat/completions`, completions, embeddings, list models; Anthropic `/v1/messages` | LMS        | Chat at `/v1/chat/completions`, loopback 1234 (`presets.ts:714-715`)                                                                     | (a)                              |
| LM Studio context               | settable per request only on `/api/v1/chat`                                                                                                                                                                                           | LMS        | reads `max_context_length` from `/v1/models` (`presets.ts:721`), not documented there                                                    | (b)                              |
| LM Studio default port          | not stated on the page read                                                                                                                                                                                                           | LMS        | 1234 (`presets.ts:715`)                                                                                                                  | not documented                   |
| LM Studio key                   | —                                                                                                                                                                                                                                     | —          | optional key (`presets.ts:717`)                                                                                                          | (a)                              |
| vLLM endpoints                  | `/v1/completions`, `/v1/chat/completions`, `/v1/responses`, `/v1/embeddings`, audio transcriptions and translations                                                                                                                   | VLLM       | Chat, loopback 8000 (`presets.ts:738-739`)                                                                                               | (a)                              |
| vLLM context                    | `max_model_len` not described on the index page read                                                                                                                                                                                  | VLLM       | reads `max_model_len` from `/v1/models` (`presets.ts:745`)                                                                               | not documented on the page read  |
| vLLM unsupported params         | Completions ignore `suffix`; Chat ignores `user`                                                                                                                                                                                      | VLLM       | neither sent                                                                                                                             | (a)                              |
| llama.cpp context               | `-c/--ctx-size` default 0 = from the model; `-np/--parallel` slots (auto); per-slot limit `--kv-unified-per-slot`; `/props` `default_generation_settings.n_ctx`; `/slots[].n_ctx`; `/v1/models` `data[].meta.n_ctx_train`             | LLAMACPP   | reads top-level `n_ctx` from `/v1/models` (`presets.ts:769`)                                                                             | (b)                              |
| llama.cpp endpoints / port      | `/v1/completions`, `/v1/chat/completions`, `/v1/models`, `/v1/embeddings`, `/v1/rerank`, `/health`; default `127.0.0.1:9931`                                                                                                          | LLAMACPP   | Chat, loopback **8080** (`presets.ts:762-763`)                                                                                           | (a) endpoints; (b) port          |
| Custom OpenAI-compatible server | the user's server                                                                                                                                                                                                                     | —          | any of the five formats with compat overrides; window required from the user (`presets.ts:780-803`; `providersFile.ts:54-86`)            | (a)                              |
| Panel listing                   | —                                                                                                                                                                                                                                     | —          | all five `wireCapture: false` → hidden (`presets.ts:704,728,752,777,802`)                                                                | (c) until captures exist         |
| Smallest context suggested      | —                                                                                                                                                                                                                                     | —          | 32,000 (`constants.ts:7165`)                                                                                                             | (d)                              |
| Shared limits on local paths    | none documented                                                                                                                                                                                                                       | —          | Meta's retry table, 300 s idle (`constants.ts:2326`), Chat stream bounds (`configured.ts:571-576`)                                       | (d)                              |

## 4. Itemised (b), (c) and (d)

| #    | Class | Item                                                          | Product (file:line)      | Exact change                                                                                                                      |
| ---- | ----- | ------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| LSB1 | (b)   | llama.cpp context field and port                              | `presets.ts:762-769`     | read `/props` `default_generation_settings.n_ctx` (and `/slots`), with `meta.n_ctx_train` as the model maximum; default port 9931 |
| LSB2 | (b)   | LM Studio `max_context_length` from `/v1/models`              | `presets.ts:721`         | read the native `/api/v1/models` after a capture; set context per request on `/api/v1/chat`                                       |
| LSB3 | (b)   | Ollama context choices vs VRAM-based defaults                 | `constants.ts:7166-7168` | offer up to the model's own `context_length` from `/api/show`, default to the server's allocation (`ollama ps`)                   |
| LSC1 | (c)   | Captures for the five presets                                 | `presets.ts:704-802`     | record one turn each (rule 14) and list them                                                                                      |
| LSC2 | (c)   | Ollama cloud and Anthropic-compatible endpoints               | —                        | owner decision                                                                                                                    |
| LSD1 | (d)   | Ollama stream bounds                                          | `constants.ts:7320-7324` | derive from the allocated context                                                                                                 |
| LSD2 | (d)   | 32,000-token minimum suggestion                               | `constants.ts:7165`      | user threshold                                                                                                                    |
| LSD3 | (d)   | 300 s idle on local servers (a cold model load can be longer) | `constants.ts:2326`      | user setting                                                                                                                      |

Not documented / not verified: Ollama `/api/chat` and `/api/show` field
lists (the API index page read did not include them), vLLM's
`max_model_len` in `/v1/models`, LM Studio's default port, and tool-choice
support per server.
