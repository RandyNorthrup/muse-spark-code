# Provider key shapes: no key is refused for its looks (lane PROVKEYS)

## RED (2026-10-12, packed 0.18.1 product on the kubuntu rig)

Built with `npm run build`, then ran the production bundles directly
(`node dist/acp.js`, the same files `scripts/package-acp.mjs` ships;
the tar step itself needs the macOS-only `native/darwin/muse-dictate`
binary, which does not exist on a Linux rig) under a fresh empty `HOME`.

Each row: `printf '%s' 'RED-MADEUP-KEY-0001-NO-PREFIX' | providers add
--preset <id> --model redmodel --key-stdin`. The made-up key matches no
frozen prefix on purpose (it contains no `sk-`, `xai-`, `AIza`,
`sk-or-`, `gsk_`, `fw_`, `hf_` or hex-dot shape). Exit code 1 everywhere.

| Preset      | Person is told (before fix)                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| openai      | That key is not shaped like OpenAI keys (Key beginning with sk-… (platform.openai.com)).                                |
| xai         | That key is not shaped like xAI keys (Key beginning with xai-… (console.x.ai)).                                         |
| anthropic   | That key is not shaped like Anthropic keys (Key beginning with sk-ant-… (console.anthropic.com)).                       |
| gemini      | That key is not shaped like Google Gemini keys (Key beginning with AIza… (AI Studio)).                                  |
| openrouter  | That key is not shaped like OpenRouter keys (Key beginning with sk-or-… (openrouter.ai) or Connect OpenRouter account). |
| groq        | That key is not shaped like Groq keys (Key beginning with gsk_… (console.groq.com)).                                    |
| deepseek    | That key is not shaped like DeepSeek keys (Key beginning with sk-… (platform.deepseek.com)).                            |
| fireworks   | That key is not shaped like Fireworks keys (Key beginning with fw_… (fireworks.ai)).                                    |
| huggingface | That key is not shaped like Hugging Face keys (Key beginning with hf_… (huggingface.co)).                               |
| zai         | That key is not shaped like Z.ai keys (The key from Z.ai).                                                              |
| mistral     | Test failed: HTTP 401 (shape `any`: the key goes to the provider, which refuses it)                                     |
| together    | Test failed: HTTP 401 (shape `any`: the key goes to the provider, which refuses it)                                     |

The Gemini row is the released defect: a working key beginning `AQ.`
is refused before anything is sent, so the route cannot be set up at all.

## GREEN (to be filled after the fix)

(TBD: same commands; every made-up key is accepted for sending, and
with the entry pointed at a closed port the person hears the connection
refusal, not a shape complaint.)
