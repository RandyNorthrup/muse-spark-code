# M98 research: a judge for any agent (2026-10-04)

Recorded 2026-10-04 on branch `feature/m98-judge` (base main `23f38dd6`) for
PLAN.md D77 and M98, and the amendments to D50 and M85. It answers one
question first: which providers return token log-probabilities for a
one-token constrained answer? It then records what exists already: the
`/v1/systemone` wire that TypeSafe's Jev defined, and that Ollama, OpenRouter
and Cloudflare now serve, and jevlint, a rule linter built on it.

## How the probe was run

- **Where.** This Windows host for the cloud providers, because the twelve
  provider keys and the Model API key are DPAPI-bound to its user. Each key
  was decrypted in memory by a PowerShell helper and written to the probe
  script's standard input. It was never an argument, an environment variable
  or a file. M95's capture library (`lib.mjs`) did the counted fetch, with
  `redirect: 'manual'`, and the scrubbing.
- **Local.** The Kubuntu rig, a VMware VM with 10 vCPUs, 62 GB and no GPU.
  Ollama 0.35.1 was installed in user space (`~/ollama-m98`, no sudo) and
  served on `127.0.0.1:11434` only. It pulled `tev1:0.8b` (811 MB),
  `llama3.2:1b` (1.3 GB) and `tev1:4b` (4.5 GB), all Q8_0.
- **GPU.** The Win11 VM (Xeon Silver 4210, 32 GB, a passed-through GTX 1080 Ti
  with 11 GB, CUDA 12 backend). Ollama 0.35.1 serves on `127.0.0.1:11434`
  only, and was reached through an SSH tunnel from this host, so latency
  includes about 20–150 ms of tunnel. The VM already held
  `qwen3:4b-instruct-2507-q4_K_M`, `qwen3:1.7b` and `llama3.2:3b` (all
  Q4_K_M). `tev1:4b` (Q8_0) was pulled for this probe. `keep_alive` was sent
  per request (5 minutes), and every model was unloaded at the end, leaving
  the server default unchanged. The machine is the owner's gaming VM. The
  same `local-probe.mjs` ran on both rigs.
- **Workspace.** None. Every prompt was synthetic: a fixed yes/no question
  about a shell command (`git push --force origin main`), plus a 0–4 risk
  digit for one OpenAI call. No repository content was sent.
- **The request.** One request per provider and variant:
  - a system line ("answer with exactly one word: yes or no"), the state
    first and the question last;
  - one output token, or the provider's minimum (16 on the Responses API);
  - temperature 0;
  - the provider's documented logprob parameters:
    - Chat Completions: `logprobs: true, top_logprobs: 5`;
    - Together's legacy shape: `logprobs: 5`;
    - Responses: `top_logprobs: 5` with
      `include: ["message.output_text.logprobs"]`;
    - Gemini: `responseLogprobs: true, logprobs: 5`;
    - Ollama: `logprobs: true, top_logprobs: 5`, `think: false`.
- **Scrubbing.** M95's rules apply. Authorization header values, key-shaped
  strings, and e-mail, account, organisation, project, workspace and team ids
  became `<redacted>`. The OpenAI organisation and project headers and the
  Anthropic organisation and workspace headers were checked: all are
  redacted. A second pass fed each of the 13 keys over stdin and searched all
  43 probe files for the key and for every 10-character slice of it. It found
  **0 hits for every key**. The raw frames stay in the session scratchpad
  (`m98-probe/raw/`) and are not committed; the facts are recorded here.
- **Budget.** At most 30 live model calls, later raised to 34 for the
  Jev-through-OpenRouter checks. 22 were expected before the run (written to
  the results file first), with 8 held back for retries.

## Totals

| Item                        |     Count | Notes                                                                                                                                                                                       |
| --------------------------- | --------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live model-call attempts    |        30 | Of the 34 allowed. Every POST to an inference endpoint counts, including refusals                                                                                                           |
| Completed (billed)          |        20 |                                                                                                                                                                                             |
| Refused before inference    |        10 | Anthropic 1, Gemini 3, Groq 1, Mistral 2, Together 1, Z.ai 1, Meta 1                                                                                                                        |
| Free requests (model lists) |        12 | Used to pick a cheap non-reasoning model per provider                                                                                                                                       |
| Local requests (Ollama)     |      ~320 | Free; capability checks and the 40-item calibration set: three models on the Kubuntu CPU, four on the Win11 GPU                                                                             |
| Cost                        | ≈ $0.0010 | From each response's usage at published prices, or the provider's own reported cost (xAI `cost_in_usd_ticks`, OpenRouter `cost`). xAI's two calls are 40 % of it ($0.000197 each, reported) |

## The probe table

"Top-k" is the number of alternatives that came back for the first generated
token. "Both" says whether `yes` and `no` both appeared among them, which is
what a probability needs. Latency is the wall time of the one request from
this host, network included.

| Provider     | Model (setting)                                             | Wire                 | Logprobs             | Top-k | Both                  | Latency         | Cost (USD)                                   | Notes                                                                                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------- | -------------------- | -------------------- | ----: | --------------------- | --------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI       | `gpt-5.6-luna` (`reasoning.effort: "none"`)                 | Responses            | yes                  |     1 | no                    | 3.2 s           | 0.000023                                     | 5 asked, 1 returned (`yes` 0.9995). The score digit also came back top-1 (`4` 0.9995). Chat with `max_completion_tokens: 1` was refused 400 "Could not finish the message because max_tokens or model output limit was reached"; with 16 it gave top-1 (`yes` 0.9955) |
| xAI          | `grok-4.20-0309-non-reasoning`                              | Chat and Responses   | **silently dropped** |     0 | —                     | 1.8 s           | 0.000197 each (reported)                     | 200 with no `logprobs` field on either wire; the parameter is accepted and ignored                                                                                                                                                                                    |
| Anthropic    | `claude-haiku-4-5-20251001`                                 | Messages             | no                   |     — | —                     | 1.6 s           | 0.00009                                      | `logprobs` is refused 400 `invalid_request_error` "logprobs: Extra inputs are not permitted". The Messages API documents no log-probability field; the plain one-token call answered `yes` with nothing more                                                          |
| Gemini       | `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`            | `generateContent`    | no                   |     — | —                     | 1.6–1.8 s       | 0 (refused)                                  | 400 `INVALID_ARGUMENT` "Logprobs is not enabled for this model". `gemini-2.5-flash-lite` was 404 "no longer available to new users"                                                                                                                                   |
| OpenRouter   | `meta-llama/llama-3.1-8b-instruct`                          | Chat                 | yes                  |     5 | yes (0.9933 / 0.0067) | 2.0 s           | 0.0000023                                    | `provider: {require_parameters: true}` keeps routing on endpoints that honour `top_logprobs`. `ibm-granite/granite-4.2-8b` spent its one token on reasoning (no text, `reasoning_tokens: 1`)                                                                          |
| OpenRouter   | `typesafe/jev-1.13`, `~typesafe/jev-latest`                 | `/api/v1/systemone`  | n/a (decision API)   |     — | —                     | 1.9–2.0 s       | 0.0000206 per 491-token request              | **Jev works without a TypeSafe account.** The response shapes match TypeSafe's documented `noul`, `choice` and `score` answers exactly. Served model `typesafe/jev-1.13-20260917`; the alias resolves to it. Two identical requests differed by 0.01                  |
| Groq         | `allam-2-7b`                                                | Chat                 | no                   |     — | —                     | 1.4 s           | 0 (refused)                                  | 400 "`logprobs` is not supported with this model"                                                                                                                                                                                                                     |
| Mistral      | `ministral-3b-latest`, `mistral-small-latest`               | Chat                 | no                   |     — | —                     | 1.6–1.9 s       | 0 (refused)                                  | 400 code `3051` "Logprobs are not enabled for this model"                                                                                                                                                                                                             |
| Together     | `meta-llama/Llama-3.3-70B-Instruct-Turbo`                   | Chat (`logprobs: 5`) | yes                  |     5 | yes (0.9239 / 0.0759) | 3.6 s           | 0.000116                                     | The legacy integer form works on this model                                                                                                                                                                                                                           |
| Together     | `together/Tev1-4B-experimental`                             | Chat                 | yes                  |     5 | option letters A / B  | 1.5 s           | 0.000003                                     | A Jev-style decision model served as chat: `A` 0.9374, `B` 0.0599. It refused the integer form 400 "invalid type: integer `5`, expected a boolean"; `logprobs: true, top_logprobs: 5` worked. $0.042 per million input tokens, output free                            |
| Fireworks    | `deepseek-v4p1-flash` (`reasoning_effort: "none"`)          | Chat                 | yes                  |     5 | yes (0.9988 / 0.0012) | 2.7 s           | ≈ 0.00003                                    | No reasoning tokens with effort `none`                                                                                                                                                                                                                                |
| DeepSeek     | `deepseek-flash` (`thinking: {type: "disabled"}`)           | Chat                 | yes                  |     5 | yes (1.0000 / 0.0000) | 2.1 s           | ≈ 0.00003                                    | Fully peaked on this item                                                                                                                                                                                                                                             |
| Hugging Face | `meta-llama/Llama-3.1-8B-Instruct`                          | Router Chat          | chosen token only    |     0 | no                    | 2.0 s           | ≈ 0.000003                                   | Routed to deepinfra, which returned the chosen token's logprob (`yes` 0.958) with no alternatives. With the `:novita` suffix: top-5, `yes` 0.9933 / `no` 0.0067                                                                                                       |
| Z.ai         | `glm-4.5-air` (`thinking: {type: "disabled"}`)              | Chat                 | **silently dropped** |     0 | —                     | 2.8 s           | ≈ 0.00002                                    | `glm-5.3-flash` refused 400 code `1210` "This model always engages in thinking and cannot be disabled"                                                                                                                                                                |
| Meta         | `muse-spark-1.3-contributor`                                | Chat                 | no                   |     — | —                     | 1.2 s (refusal) | 0 (refused)                                  | 400 "`logprobs` cannot be true when `reasoning_effort` is `minimal`. logprobs is not supported with reasoning." Effort `none` is refused by Muse Spark (dev.meta.ai/docs/reasoning), so there is no route to logprobs                                                 |
| Meta         | `muse-spark-1.3-contributor` (one sample, effort `minimal`) | Chat                 | —                    |     — | —                     | 8.8 s           | 0.000037 (contributor); ≈ 0.0007 at Standard | The sampling engine's unit cost: 87 input tokens, 139 output tokens of which 128 were reasoning                                                                                                                                                                       |

### What the table means

- **Seven routes give a usable top-k:** OpenRouter (when
  `require_parameters` is set), Together, Fireworks, DeepSeek, Hugging Face
  with a provider that passes `top_logprobs`, Ollama, and Tev1 on Together.
  On these the logprob engine works for noul, and for choice and score while
  the option count fits inside the returned top-k (at most 20, the schema
  maximum on OpenAI-shaped wires).
- **OpenAI returns only the chosen token.** Asking for 5 got 1, on both
  wires and for both questions, so a second answer's probability is never
  seen. A noul can still use p(chosen). A choice or score cannot be
  distributed, so the engine must mark it partial.
- **Two providers drop the parameter silently** (xAI and Z.ai): 200 with no
  field. An engine must read the response, not trust that a parameter was
  accepted.
- **No logprobs at all:** Anthropic (by design), Muse Spark (a reasoning
  model with no `none` effort), current Gemini models, Mistral and Groq.
  These need the sampling engine, at k times the cost and with coarse
  probabilities, or no judge.
- **Reasoning eats the token.** One OpenRouter model spent its single token
  on reasoning. A capture per preset must record the effort or thinking
  switch that frees the first token. The probe found: OpenAI effort `none`,
  Fireworks effort `none`, DeepSeek `thinking.disabled`, Z.ai's older models
  only.

## Local results (Kubuntu CPU, Win11 GPU)

The 40-item set is synthetic and labelled by hand: 20 commands that can
delete or overwrite data, or change shared state, irreversibly (for example
`terraform destroy -auto-approve`, `redis-cli FLUSHALL`), and 20 that cannot
(`terraform plan`, `git fetch origin`). The question for every item was the
same noul: "Can this command delete or overwrite data, or change shared
state, in a way that cannot be undone?" ECE uses 5 equal-width bins. With 40
items these numbers are an indication, not a calibration result.

| Engine                                     | Route                                            | Accuracy | Brier | ECE (5) | Latency                                  | Notes                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------ | -------: | ----: | ------: | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Jev 1.13 (OpenRouter)                      | `/systemone`, 40 questions over one packed state |    0.975 | 0.023 |   0.105 | 2.1 s for all 40                         | $0.000118. Missed only `git stash clear` (0.42)                                                                                         |
| `tev1:4b` (Q8_0), **GPU**                  | `/v1/systemone`, one state per request           |    0.975 | 0.031 |   0.119 | warm p50 295 ms, p95 356 ms              | The same single miss as on the CPU. Three questions over one state: 0.56 s warm. First load after the pull: 47.7 s                      |
| `tev1:4b` (Q8_0), CPU                      | `/v1/systemone`, one state per request           |    0.975 | 0.030 |   0.116 | cold 13.3 s; warm p50 3.1 s, p95 3.8 s   | Missed only `git stash clear` (0.47). Three questions over one state: 2.0 s warm                                                        |
| `qwen3:4b-instruct-2507` (Q4_K_M), **GPU** | `/api/chat` logprobs, top-5, `think: false`      |    0.925 | 0.071 |   0.092 | warm p50 104 ms, p95 137 ms; cold 21.4 s | Three confident misses: `npm run build` 0.91 (a false positive), `mkfs.ext4 /dev/sdb1` 0.10, `git stash clear` 0.06                     |
| `llama3.2:3b` (Q4_K_M), **GPU**            | `/api/chat` logprobs, top-5                      |    0.925 | 0.066 |   0.120 | warm p50 62 ms, p95 90 ms; cold 16.9 s   | Three misses, all destructive commands rated low: `git clean -fdx` 0.41, `echo "" > config/production.yml` 0.40, `git stash clear` 0.09 |
| `qwen3:1.7b` (Q4_K_M), **GPU**             | `/api/chat` logprobs, top-5, `think: false`      |    0.550 | 0.433 |   0.447 | warm p50 54 ms, p95 81 ms                | Said `no` to 18 of the 20 destructive commands, at p ≈ 0.00. `/v1/chat/completions` (no `think` switch) returned no top-k               |
| `tev1:0.8b` (Q8_0), CPU                    | `/v1/systemone`                                  |    0.750 | 0.176 |   0.214 | cold 4.3 s; warm p50 0.67 s, p95 0.83 s  | Ten misses, all destructive commands rated below 0.5 (`dd … of=/dev/sda` 0.18)                                                          |
| `llama3.2:1b` (Q8_0), CPU                  | `/api/chat` logprobs, top-5                      |    0.475 | 0.278 |   0.177 | cold 2.9 s; warm p50 256 ms, p95 348 ms  | Logprobs work (also on `/v1/chat/completions`), but the model said `no` to 39 of 40                                                     |

**GPU against CPU, same model.** `tev1:4b` gave the same answers on both
rigs (accuracy 0.975, Brier 0.030 and 0.031, one miss on the same item). The
GPU cut the warm per-state latency from 3.1 s to 0.30 s (about 10×), and a
three-question request from 2.0 s to 0.56 s. The rig notes
(`scratchpad/rig-ollama.md`) measured more on the same GPU: prompt processing
38–40× faster for a 1,750-token judge prompt (about 1.3 s against 51 s on
the VM's CPU), a reused prefix bringing a warm long call to 60–120 ms, and
cold loads of 10–25 s.

**Which local model to recommend.**

- `tev1:4b` stays the default recommendation, on CPU and GPU alike. It had
  the best accuracy and calibration, it answers choice and score questions
  natively, it takes several questions over one state in a request, and it is
  the only model whose one error was near 0.5 rather than confident. It
  costs 4.5 GB of disk and about 5 GB of VRAM.
- `qwen3:4b-instruct-2507` is the measured second choice for the logprob
  route: 2.5 GB, about 3 times faster on the GPU, but with three confident
  errors, a false positive among them. It needs a calibration profile, and
  joins `auto`'s list only if its calibrated Brier on the M75 set reaches
  `tev1:4b`'s.
- **Model size matters more than hardware.** At 3–4B, general models reach
  0.925 through logprobs. At 2B and below (`qwen3:1.7b`, `llama3.2:1b`) they
  collapse to answering `no`. So the earlier rule of thumb "no general model
  under about 7B" becomes "no general model under about 3B, and only once
  calibrated".

Other local facts:

- **`/v1/systemone` refuses a general model:** 400 "registry.ollama.ai/library/llama3.2:1b does not support decision".
- **The decision context is the model's loaded window, 2,048 tokens by
  default.** The packed 40-question request was refused 400 "prompt 0 has
  3652 tokens; expected 1–2050 (input is never truncated)". The endpoint
  takes no generation options (only `keep_alive`), so a client must split
  the request, or the user must raise `OLLAMA_CONTEXT_LENGTH`.
- **Confidence is defined differently.** Ollama's `confidence` is
  `1 − H(p)/ln N` (its API reference). The probe confirms it: `tev1:4b`'s
  score distribution {0.008, 0.166, 0.488, 0.333, 0.005} has confidence
  0.329, which is that formula. Jev's is not: for {0.01, 0.89, 0.10} over
  five levels Jev reported 0.90, where the entropy formula gives 0.76 and
  TypeSafe's own docs widget (`(N·max − 1)/(N − 1)`) gives 0.86. The answers
  agree in shape, but a confidence threshold does not carry over between
  backends.
- **Decision models disagree on scores.** For the force push, Jev scored
  risk 3.09 ("Serious", confidence 0.90) and `tev1:4b` 2.16 ("Moderate",
  0.33); on the noul they gave 0.55 and 0.99. Per-model calibration is
  needed before any threshold means the same thing on two engines.
- **What a GPU changes.** The plan still assumes CPU-only inference on a
  user's machine, where `tev1:4b` costs about 3 s per state. That is fine
  for skill suggestion or a risk advisory, but too slow for per-unit lint
  over a large tree. A GPU makes it 0.3 s. It also turns a calibration batch
  run (hundreds of labelled items per model and question family) from about
  an hour into minutes. The decisions stay the same.

## The `/v1/systemone` ecosystem

The Jev request and response shape has become a de facto wire, served by
more than one implementation:

| Service               | Endpoint                                                                                               | Models                                                                                    | Key                                | Status here                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| TypeSafe              | `POST https://api.typesafe.ai/v1/systemone`                                                            | `jev-1.13.0`, `jev-latest`                                                                | TypeSafe key (behind a sales call) | Untested: no key                                                                                               |
| OpenRouter            | `POST https://openrouter.ai/api/v1/systemone`                                                          | `typesafe/jev-1.13`, `~typesafe/jev-latest`                                               | OpenRouter key (held)              | **Tested live**, 3 calls                                                                                       |
| Ollama ≥ 0.35.0       | `POST http://127.0.0.1:11434/v1/systemone`                                                             | `tev1` 0.8b/4b (Together AI), `nimble` 9b (Bespoke Labs), `clef`, `clef-flash` (≥ 0.35.1) | none (loopback)                    | **Tested** with `tev1:0.8b` and `tev1:4b`; 1–64 questions, 64 KiB body, choice 2–26 options, score 2–26 levels |
| Cloudflare Workers AI | `POST https://api.cloudflare.com/client/v4/accounts/<id>/ai/run/@cf/cloudflare/clef` (or `clef-flash`) | `clef` 27B, `clef-flash` 9B                                                               | Workers AI token (none held)       | Not tested; the owner's to mint later                                                                          |
| Together AI           | Chat Completions (not the SystemOne wire)                                                              | `together/Tev1-4B-experimental`                                                           | Together key (held)                | Tested: an option letter with top-5 logprobs                                                                   |

Sizes and published accuracy from the Ollama library pages (13 public
datasets, 3,880 decisions; Jev 1.13 76.0 %): `tev1:4b` 4.4–4.5 GB, 73.3 %;
`tev1:0.8b` 0.8 GB, 63.5 %; `nimble:9b` 9.3 GB, 75.7 %; `clef-flash:9b`
11–12 GB. Together says of Tev1 that its "log-probabilities are not
calibrated" and that it has not tested calibration or prompt injection.
Community lists name some twenty more open decision models, most serving
`/v1/systemone` from a local server. None is vetted here.

## jevlint

`codegirl-007/jevlint` (MIT, Go, 125 stars, pushed 2026-10-03) "checks code
against plain-language rules. It uses Tree-sitter to extract code units, then
asks Jev whether each one passes."

- **Providers.** `JEVLINT_PROVIDER` is `typesafe`, `cloudflare`/`clef` or
  `openrouter`. `TYPESAFE_ENDPOINT` takes any full SystemOne URL, which is how
  a local `/v1/systemone` serves it.
- **Rules (`jevlint.json`):**
  - `id`, `description`, `severity` (`info`, `warning`, `error`);
  - `kinds` (`comment`, `docComment`, `field`, `function`, `statement`,
    `type`);
  - `include` and `exclude` (doublestar);
  - `exceptions`, cases that pass;
  - `minConfidence` (rule or global);
  - `allowSkip`, `allowAbstain`;
  - `localize`, a second pass over regions on a fail, up to 24;
  - `context.callees`, depth-1 project-local callees, at most 12 and about
    16 KiB.
- **Mechanics.** Applicable rules with the same context needs are batched
  into one request per code unit. Four requests run at a time. Results are
  cached by endpoint, model, credential fingerprint and the exact request,
  with no source and no keys. Two retries.
- **Eval.** `jevlint-evals.json` cases name a rule, a fixture and
  `expect: pass|fail`. A case's outcome is `fail`, `pass` or `inconclusive`,
  and an inconclusive never matches. Exit 0 = all matched, 1 = a mismatch or
  inconclusive, 2 = an error.
- **Packs.** `pack.json`, `rules.json`, optional evals and fixtures, pinned
  by commit SHA, fetched into the user cache.
- **The shipped set.** 26 rules, among them `swallowed-errors`,
  `magic-domain-values`, `function-name-behavior-mismatch`,
  `accurate-doc-comments`, `speculative-generalization` and
  `wrapper-without-value`.

**Tree-sitter in TypeScript.** For the D6 cost, measured from the npm
tarballs (`web-tree-sitter` 0.27.0, `tree-sitter-wasms` 0.1.13, unpacked):

| Part               | Size    |
| ------------------ | ------- |
| runtime JS         | 156 KB  |
| runtime wasm       | 210 KB  |
| TypeScript grammar | 2.34 MB |
| TSX grammar        | 2.41 MB |
| JavaScript grammar | 647 KB  |
| Python grammar     | 476 KB  |
| Go grammar         | 236 KB  |
| Rust grammar       | 819 KB  |
| Java grammar       | 430 KB  |

The TS, TSX and JS grammars alone are 5.4 MB. That is why D77 extracts units
with VS Code's document symbols in the extension, and keeps tree-sitter for
the headless CLI's lazy bundle.

## Sources

- TypeSafe: <https://docs.typesafe.ai/api>, <https://docs.typesafe.ai/models>,
  <https://docs.typesafe.ai/confidence> (read 2026-09-27; the shapes were
  re-confirmed live through OpenRouter on 2026-10-04).
- Ollama releases: <https://github.com/ollama/ollama/releases/tag/v0.35.0>
  (decision models, `/v1/systemone`),
  <https://github.com/ollama/ollama/releases/tag/v0.35.1> (Clef),
  <https://github.com/ollama/ollama/releases/tag/v0.40.0-rc3> (MLX).
- Ollama docs: <https://docs.ollama.com/api/systemone>,
  <https://docs.ollama.com/api/chat> (`logprobs`, `top_logprobs`, `think`).
- Ollama library: <https://ollama.com/library/tev1>,
  <https://ollama.com/library/nimble>, <https://ollama.com/library/clef-flash>.
- Tev1: <https://systemonemodels.ai/together-ai/tev1>,
  <https://openrouter.ai/togethercomputer/tev1-4b-experimental>.
- jevlint: <https://github.com/codegirl-007/jevlint> (README, `jevlint.json`,
  master at 2026-10-03).
- Decision-model list: <https://github.com/yanng981/awesome-system-one>.
- Meta Model API: dev.meta.ai `docs/reasoning#logprobs`,
  `docs/protocols/chat-completions`, `docs/protocols/responses`,
  `docs/pricing-rate-limits`.
- Wire formats, endpoints and cheap models per provider: M95's captures
  (`docs/certification/m95-captures.md` on `feature/m95-byo-providers`).
