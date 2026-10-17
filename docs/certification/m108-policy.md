# M108 policy source checks — 2026-10-05

The bundled record is `src/core/providers/accountPolicy.ts`, version
`2026-10-05.1`. Read PLAN D88/M108 and the complete terms research first.
These decisions follow that plan; `on` is the owner's pooling decision after
research, not a vendor promise or permission to exceed an account's limit.
The record is bundled data; no terms fetch occurs at runtime.

## Quote checks

Every record excerpt was re-read from its primary source on 2026-10-05.
For 23 rows, the web reader's extracted source lines contained the exact
UTF-8 excerpt, without replacing punctuation or joining omitted passages.
The Fireworks redirect refused the web tool. A read-only direct download of
its public PDF succeeded; `pdftotext -layout` contains the exact excerpt
contiguously on line 165, with its 2026-07-10 date on line 1. No live or paid
model call or sign-in was used. Quotes below are identified by their hash
and linked source-code location rather than repeated.

| Provider/product                                                        | Pooling    | Page date       | Checked    | Quote SHA-256                                                      | Source                                                                                                       |
| ----------------------------------------------------------------------- | ---------- | --------------- | ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [meta/model-api](../../src/core/providers/accountPolicy.ts#L52)         | confirm    | 2026-10-02      | 2026-10-05 | `a380f8093855624d303cb85167c7c1bb9d8d5a27c74711e82cc3497e43b30659` | [Primary page](https://dev.meta.ai/legal/terms-of-service)                                                   |
| [meta/muse-code](../../src/core/providers/accountPolicy.ts#L68)         | confirm    | 2026-10-02      | 2026-10-05 | `57ed10501aa0f96ca0824ba092eca0396111592935a5428e866d99d5a71e5950` | [Primary page](https://dev.meta.ai/legal/terms-of-service)                                                   |
| [openai/api](../../src/core/providers/accountPolicy.ts#L84)             | confirm    | ONLINE v.010126 | 2026-10-05 | `001681a6ade0fbde37a225cb79c0d5635ad75475c3426bc1b5b4260565c0c47b` | [Primary page](https://cdn.openai.com/osa/openai-services-agreement.pdf)                                     |
| [openai/chatgpt-plan](../../src/core/providers/accountPolicy.ts#L100)   | confirm    | 2026-01-01      | 2026-10-05 | `001681a6ade0fbde37a225cb79c0d5635ad75475c3426bc1b5b4260565c0c47b` | [Primary page](https://openai.com/policies/row-terms-of-use/)                                                |
| [anthropic/api](../../src/core/providers/accountPolicy.ts#L116)         | on         | 2025-06-17      | 2026-10-05 | `dd4ddae4de28b3e602bfd5be522a3b255f084ede58b45c9cfb866c054b5f31ea` | [Primary page](https://www.anthropic.com/legal/commercial-terms)                                             |
| [anthropic/claude-plan](../../src/core/providers/accountPolicy.ts#L132) | notOffered | no date shown   | 2026-10-05 | `0a228e06cd12216f551681b72513ed063d3c9bf3ce6a563853270ddeb2575b4f` | [Primary page](https://code.claude.com/docs/en/legal-and-compliance)                                         |
| [google/gemini-api](../../src/core/providers/accountPolicy.ts#L149)     | confirm    | 2021-11-09      | 2026-10-05 | `8aa9e3ea31c56d06d9dad0d34d2882ce015f0551d49cd2741af8c3a60b344821` | [Primary page](https://developers.google.com/terms)                                                          |
| [google/vertex](../../src/core/providers/accountPolicy.ts#L166)         | confirm    | no date shown   | 2026-10-05 | `5cb8552622cdc82e1ff44227c6a6d5d8e53ef4f8d2956ea5bab83871a75e5f0d` | [Primary page](https://cloud.google.com/terms)                                                               |
| [google/consumer](../../src/core/providers/accountPolicy.ts#L182)       | notOffered | no date shown   | 2026-10-05 | `f3e54c7978075b4159f18552e4f9f4f732486ec3b7ba707e52708b807b8f0170` | [Primary page](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md)          |
| [github/copilot](../../src/core/providers/accountPolicy.ts#L198)        | confirm    | 2026-04-27      | 2026-10-05 | `b635593541432d5d7ae4158c42e4522ef8a55f46d0bfcdfd0ead536665934a2d` | [Primary page](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)                  |
| [github/free](../../src/core/providers/accountPolicy.ts#L214)           | confirm    | 2026-04-27      | 2026-10-05 | `18e6d5fe340b1a0270ca7b4c6ad68a25a04555ce776a45fe3f680e9ed544fca1` | [Primary page](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)                  |
| [xai/api](../../src/core/providers/accountPolicy.ts#L230)               | confirm    | 2026-08-14      | 2026-10-05 | `6868988f649d7612abb974e4e461746bd638517e4e3bc61fdea721ec88f55deb` | [Primary page](https://x.ai/legal/acceptable-use-policy)                                                     |
| [groq/api](../../src/core/providers/accountPolicy.ts#L246)              | confirm    | 2025-10-15      | 2026-10-05 | `29f981a78f3a32625a1d48443611b0c07f785f3e72dba8f72b56da39172686da` | [Primary page](https://console.groq.com/docs/legal/ai-policy)                                                |
| [mistral/api](../../src/core/providers/accountPolicy.ts#L263)           | on         | 2026-09-25      | 2026-10-05 | `fcce51e11e64da59b7f97a349b96480d8d77956d43ad0031f1774e0400c9e074` | [Primary page](https://legal.mistral.ai/terms/commercial-terms-of-service)                                   |
| [mistral/consumer-plan](../../src/core/providers/accountPolicy.ts#L280) | confirm    | 2026-09-25      | 2026-10-05 | `e6a5dd2a10856369669451ba1d9af50746c6342236cf93fea69842c7ca8b3e92` | [Primary page](https://legal.mistral.ai/terms/row-consumer-terms)                                            |
| [openrouter/api](../../src/core/providers/accountPolicy.ts#L297)        | confirm    | 2026-08-31      | 2026-10-05 | `0526cdbd2816548022903aeefe9615990b1cc32f50fed301b525aca5d8f89d82` | [Primary page](https://openrouter.ai/terms)                                                                  |
| [deepseek/api](../../src/core/providers/accountPolicy.ts#L314)          | on         | 2026-03-27      | 2026-10-05 | `9ccf48147c70c399a48182b4ed6c11be88ccc4d3a51b862144d95782e66523cf` | [Primary page](https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html)                           |
| [together/api](../../src/core/providers/accountPolicy.ts#L331)          | confirm    | 2026-05-19      | 2026-10-05 | `f017f62c5415598f5094cc7838e130dca296e475e679d7ebd4b65a96adda231b` | [Primary page](https://www.together.ai/terms-of-service)                                                     |
| [fireworks/api](../../src/core/providers/accountPolicy.ts#L348)         | confirm    | 2026-07-10      | 2026-10-05 | `d64fb439e936d9e833091746c914b004a481d80a255f77b4c7602c782195bdfb` | [Primary page](https://cdn.sanity.io/files/pv37i0yn/production/60909f1a2f0cae74deb6ba7fc0f6eda8ab3bac4b.pdf) |
| [huggingface/api](../../src/core/providers/accountPolicy.ts#L364)       | confirm    | 2025-04-10      | 2026-10-05 | `bb11f505a9efab8196b83542c4505e3eea1c52338ac1ba097094ce316c315c3a` | [Primary page](https://huggingface.co/content-policy)                                                        |
| [zai/api](../../src/core/providers/accountPolicy.ts#L381)               | on         | 2026-04-14      | 2026-10-05 | `85d63b95a2176c107a5fe37084c8623924d350232749dc3b6070e80c8f715a36` | [Primary page](https://docs.z.ai/legal-agreement/terms-of-use)                                               |
| [zai/coding-plan](../../src/core/providers/accountPolicy.ts#L397)       | notOffered | no date shown   | 2026-10-05 | `dcce8af2daac86046476644708010ae69453515c1d767cddc807cb17d1b2174d` | [Primary page](https://docs.z.ai/devpack/usage-policy)                                                       |
| [azure/same-tenant](../../src/core/providers/accountPolicy.ts#L413)     | on         | 2026-05-20      | 2026-10-05 | `dbb3ff7eb47553334952aa448ca68da554e2fac6fa786078a7001b7bd2901a70` | [Primary page](https://learn.microsoft.com/en-us/azure/api-management/backends)                              |
| [azure/cross-tenant](../../src/core/providers/accountPolicy.ts#L429)    | confirm    | no date shown   | 2026-10-05 | `6bf765796664c2bbab7942569542ee648655a1ea65a276c20a6f8819aa979e97` | [Primary page](https://www.microsoft.com/licensing/terms/product/ForOnlineServices/all)                      |

## xAI browser requirement remains open

The signed-out web reader returned the consumer Terms of Service, the
enterprise Terms of Service (the actual URL is
https://x.ai/legal/terms-of-service-enterprise), and the Acceptable Use
Policy. Its AUP excerpt matches byte-for-byte. The consumer page displays
2026-09-11, and the AUP displays 2026-08-14. The enterprise text was read
through the web reader; the plan's required browser check is **not passed**.

An isolated, temporary headless Chrome context with no user profile or
sign-in was attempted twice. The second attempt waited for page rendering
and confirmed a Cloudflare block: page title `Attention Required! |
Cloudflare`, text `Sorry, you have been blocked`. No user-agent change,
proxy, evasion or machine setting was used. The lead must read both xAI
terms pages signed out in a browser and compare this record before marking
M108's policy checklist complete. The record's xAI decision remains
`confirm`, exactly as D88 requires; the successful AUP byte-check is separate
from that unfinished browser certification.

## Findings and interpretations

- The current Z.ai Coding Plan page differs from the older quote in the
  research: the exact new excerpt refers to use only within supported tools.
  The record uses the freshly read excerpt, retaining D74's `notOffered`.
- The record does not guess limit attachment where the supplied research
  does not establish it: Mistral API, Together, Fireworks, Hugging Face and
  Z.ai API have `unclear` scopes. Their policy decisions are unchanged.
- Meta's team, OpenAI's organisation/project, Anthropic's organisation,
  Gemini's project, Groq's organisation and xAI's team limits were re-read
  from the linked rate-limit guides. OpenRouter's global limit remains in
  its limits guide. Azure's guide identifies a shared subscription quota
  pool, recorded alongside the tenant pooling boundary.
- The ChatGPT and Muse Code rows name the documented recovery path first.
  Native replay across accounts, shared-cache identity and a second CLI
  config home's behaviour remain Q-M108 live-capture questions. No wire
  schema is inferred from this legal research.
- Unknown provider/product lookup returns no row, never an implicit `on`.
- The age predicate rejects a row older than 90 days, an invalid clock or
  a future check date. Lane W must wire it into the release checklist;
  this lane supplies and tests it without modifying W's scripts.

## Lane tests

`accountPolicy.test.ts` checks all 24 product decisions independently,
one-person restrictions, editor-owned credentials, both subscription
recoveries, no permissive lookup fallback, and the exact 90-day boundary.
Policy decision/age red drills and hashes are in `m108-0.md`.
