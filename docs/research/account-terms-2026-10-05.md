# Several accounts per provider: what each vendor's terms say (2026-10-05)

Research for PLAN.md D88/M108: several accounts per provider, swapped at a
threshold or used in parallel. The owner (2026-10-05): "i also want to plan
out and impliment multi account and account use threshholds so we can have
multiple accounts from the same vendor that get swapped out at a cap or runs
them in parellel on different or maybe even the same machine if we have not
already". Later the same day: "to be clear the rotating would not be to
circumvent limits it will be to enhance and extend them".

## Method

- **Read-only.** No sign-in, account, credential or model call was used.
- **Two research passes** with plain web fetches and searches: one over Meta,
  OpenAI, Anthropic, Google and GitHub, and one over xAI, Groq, Mistral,
  OpenRouter, DeepSeek, Together, Fireworks, Hugging Face, Z.ai and Azure.
- **Browser checks.** Two pages refused the fetch tool (HTTP 403), so the lead
  read them signed out in a browser and closed the tab: xAI's Acceptable Use
  Policy and OpenAI's Terms of Use. Their quotes below are checked against
  the page.
- **Every other quote** came through a fetch tool's text extraction, except
  OpenAI's Services Agreement PDF, Fireworks' PDF and the Claude Code legal
  page, which were read as raw text. M108's lane 0 re-reads every page and
  checks each quote byte-for-byte before it goes into the policy record.
- **Dates.** Each source gives the date the page shows (or "no date shown"),
  and every one was checked on 2026-10-05.
- **What a quote proves.** These are the vendors' own words as found that day.
  They are not legal advice, and the record re-checks them before each
  release (PLAN.md D88.8).

## Three questions per vendor

1. **Several accounts.** May one person or organisation hold several accounts,
   organisations, projects or keys?
2. **Swapping at the user's own cap.** May the harness move to another account
   when a cap the user set (spend, tokens, requests) is reached? That is the
   user's own budget, and no vendor's terms restrict it. It still involves a
   second account where a vendor allows only one per person.
3. **Pooling against the vendor's limits.** May the harness swap, or run
   accounts in parallel, so that work continues past one account's rate
   limit, quota or plan window? Most vendors' terms speak to this directly,
   whatever the purpose.

**A finding that shapes the design: where limits attach.** Several vendors
attach limits to a team, organisation, project or account rather than a
key, so extra keys in the same scope add no capacity:

- Meta: "Limits apply per team, not per API key."
- OpenAI: "Rate limits are defined at the organization level and at the
  project level, not user level."
- Anthropic: "Limits are set at the organization level."
- Gemini: "Rate limits are applied per project, not per API key."
- Groq: "Rate limits apply at the organization level, not individual users."
- DeepSeek: "Concurrency limits are calculated at the account level,
  regardless of which API Key is used."
- OpenRouter: "Making additional accounts or API keys will not affect your
  rate limits, as we govern capacity globally."

## Summary

"Pooling" is question 3. "Record" is the value D88's policy record starts
from (D88.6):

- **on:** the harness pools without asking;
- **confirm:** the user confirms once, with the clause quoted, before the
  harness pools on that provider;
- **not offered:** the harness never holds this credential at all (D74).

| Vendor and product                    | Several accounts                                  | Swapping at the user's cap                             | Pooling against vendor limits                                  | Record      |
| ------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- | ----------- |
| Meta Model API                        | several keys; accounts not addressed              | yes                                                    | prohibited (§10.1(xii))                                        | confirm     |
| Meta Muse Code subscription           | not addressed                                     | yes                                                    | prohibited (§3.2)                                              | confirm     |
| OpenAI API                            | organisations and projects, with conditions       | yes                                                    | prohibited (Services Agreement §3.3(h), (i))                   | confirm     |
| ChatGPT plan (Sign in with ChatGPT)   | several saved accounts, per OpenAI's own app docs | yes                                                    | conflicts with the Terms of Use; the docs say pause and choose | confirm     |
| Anthropic API                         | not addressed                                     | yes                                                    | no clause found                                                | on          |
| Claude Pro and Max                    | —                                                 | —                                                      | third-party use barred                                         | not offered |
| Google Gemini API and Vertex          | projects, with conditions                         | yes                                                    | prohibited (Cloud Terms §3.3; APIs Terms)                      | confirm     |
| Google AI Pro and Gemini CLI sign-in  | —                                                 | —                                                      | third-party use barred                                         | not offered |
| GitHub Copilot                        | one free account per person; paid not limited     | yes                                                    | prohibited (token-sharing clause)                              | confirm     |
| xAI API                               | several teams                                     | yes                                                    | prohibited (AUP)                                               | confirm     |
| Groq                                  | allowed, with conditions                          | yes                                                    | prohibited, by name (AUP)                                      | confirm     |
| Mistral API (business)                | separate workspaces for affiliates                | yes                                                    | no clause found                                                | on          |
| Mistral consumer plans                | one per person                                    | only with the confirmation (it needs a second account) | prohibited, by name                                            | confirm     |
| OpenRouter                            | one account per user (several keys in it)         | yes, between keys of one account                       | prohibited, and limits are global                              | confirm     |
| DeepSeek                              | bulk or malicious registration only is banned     | yes                                                    | no clause found                                                | on          |
| Together AI                           | not addressed                                     | yes                                                    | restricted ("directly or indirectly")                          | confirm     |
| Fireworks AI                          | not addressed                                     | yes                                                    | restricted (clause (k))                                        | confirm     |
| Hugging Face                          | several organisations                             | yes                                                    | restricted (Content Policy)                                    | confirm     |
| Z.ai API                              | not addressed                                     | yes                                                    | no clause on limits found                                      | on          |
| Z.ai GLM Coding Plan                  | —                                                 | —                                                      | only in officially supported tools                             | not offered |
| Azure OpenAI and Foundry (own tenant) | yes                                               | yes                                                    | documented (failover between one's own backends on 429)        | on          |
| Azure across tenants                  | yes                                               | yes                                                    | "may not work around" technical limits                         | confirm     |

## Per vendor

### Meta (Model API, Muse Code)

- **Meta Model API Terms of Service**, https://dev.meta.ai/legal/terms-of-service,
  last updated October 2, 2026.
  - §10.1(xii): you will not "circumvent, violate, hack, disable, or evade
    rate limits, usage quotas, content filters, access controls, or other
    technical safeguards or restrictions applied to the Services".
  - §3.2, the subscription key: it "is for use only with the coding harness
    under your Coding Harness Subscription … and may not be used to access
    the Services outside the coding harness or to circumvent your
    subscription's usage limits or billing."
  - "You may not share, sell, or transfer your Meta Model API key with any
    third party without our prior written permission."
- **Meta Model API Acceptable Use Policy**,
  https://dev.meta.ai/legal/acceptable-use-policy, no date shown.
  - It prohibits using "accounts, identities, access, or use methods to evade
    enforcement actions, suspensions, controls, or other restrictions
    previously imposed by Meta".
  - It prohibits acting "to intentionally circumvent, bypass, disable, or
    remove usage restrictions or other safety or security measures or
    controls".
- **Muse Code Subscriptions**, https://dev.meta.ai/docs/muse-code/subscriptions,
  no date shown.
  - "It works only through the Muse Code CLI while signed in with your Meta
    Model API account."
  - "Usage through any additional API keys you create is billed
    pay-as-you-go."
  - "If you reach your plan's usage limit, you can upgrade to the next plan,
    or wait until your limit refreshes."
- **Pricing and rate limits**, https://dev.meta.ai/docs/pricing-rate-limits,
  no date shown: "Limits apply per team, not per API key."
- **What follows.**
  - Several keys are fine, and swapping at the user's own cap is fine.
  - Pooling accounts against Meta's limits meets §10.1(xii), and against a
    subscription's limits §3.2: **confirm**.
  - Continuing on the user's own pay-as-you-go key when a plan limit is hit
    is a billing path Meta documents. It is also a paid use (rule 12), so it
    asks D48's question.

### OpenAI (API, ChatGPT plan)

- **OpenAI Services Agreement**, https://cdn.openai.com/osa/openai-services-agreement.pdf
  (the policies page refused the fetch tool), footer "ONLINE v.010126", no
  other date shown.
  - §1.4b: an affiliate buying separately gets "a separate workspace and
    organizational ID".
  - §3.3(h): no use to "circumvent any rate limits or restrictions".
  - §3.3(i): no use to "violate or circumvent Usage Limits or otherwise
    configure the Services to avoid Usage Limits."
  - §3.1: "Customer will not share Account access credentials or individual
    login credentials between multiple users. Customer may not resell or
    lease access to its Account or any End User Account."
- **Rate limits guide**, https://developers.openai.com/api/docs/guides/rate-limits,
  no date shown: "Rate limits are defined at the organization level and at
  the project level, not user level."
- **Terms of Use** (individuals: ChatGPT and other consumer services),
  https://openai.com/policies/row-terms-of-use/, effective January 1, 2026.
  Checked in a browser.
  - "You may not share your account credentials or make your account
    available to anyone else and are responsible for all activities that
    occur under your account."
  - "Interfere with or disrupt our Services, including circumvent any rate
    limits or restrictions or bypass any protective measures or safety
    mitigations we put on our Services."
- **Sign in with ChatGPT, "Accounts and sessions"**,
  https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions,
  no date shown.
  - "Your app needs to manage multiple account registrations so users can
    choose an existing ChatGPT account or add another."
  - "Usage in one app contributes to the same five-hour usage total, and no
    app receives a separate allowance."
- **Sign in with ChatGPT, "Errors and recovery"**,
  https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery,
  no date shown.
  - On a usage-limit error: "Pause new requests that use the user's ChatGPT
    plan and link to ChatGPT settings → Usage."
  - "offer a clear choice: enable ChatGPT plan usage or configure another
    supported billing path, such as the user's own API key."
- **Codex CI/CD auth**, https://learn.chatgpt.com/docs/auth/ci-cd-auth, no
  date shown: "Use one `auth.json` per runner or per serialized workflow
  stream. Do not share the same file across concurrent jobs or multiple
  machines."
- **What follows.**
  - API: organisations and projects are first-class; pooling them against
    limits meets §3.3(h) and (i): **confirm**.
  - ChatGPT plan: OpenAI's own app guidance supports several saved accounts.
    At a plan limit, its documented recovery comes first (pause, link to
    Usage, offer credits or the user's own API key). Swapping to another
    ChatGPT account meets the Terms of Use's "circumvent any rate limits":
    **confirm**.
  - One ChatGPT account's tokens are never used by two machines or two
    concurrent streams at once.

### Anthropic (API, Claude plans)

- **Commercial Terms**, https://www.anthropic.com/legal/commercial-terms,
  effective June 17, 2025: customers may not "resell the Services except as
  expressly approved by Anthropic". No clause found on several accounts or
  on rate limits.
- **Usage Policy**, https://www.anthropic.com/legal/aup, effective September
  15, 2025. It prohibits:
  - "Circumvent a ban through the use of a different account";
  - "Coordinate malicious activity across multiple accounts to avoid
    detection or circumvent product guardrails";
  - "Utilize automation in account creation".
- **Rate limits**, https://platform.claude.com/docs/en/api/rate-limits, no
  date shown.
  - "Limits are set at the organization level."
  - You may "set your own spend limit below your tier's cap".
- **Claude Code legal and compliance**,
  https://code.claude.com/docs/en/legal-and-compliance, no date shown:
  "Anthropic does not permit third-party developers to offer Claude.ai login
  into their own applications, or to route requests through Free, Pro, or Max
  plan credentials on behalf of their users."
- **What follows.**
  - API: no clause restricts several organisations or pooling them: **on**,
    re-checked with the record.
  - Claude plans: never held by the harness (D74): **not offered**.

### Google (Gemini API, Vertex, consumer)

- **Google Cloud Terms**, https://cloud.google.com/terms, no date shown
  (applies to Vertex AI). §3.3: no use "in a manner intended to avoid
  incurring Fees (including creating multiple Customer Applications,
  Accounts, or Projects to simulate or act as a single Customer Application,
  Account, or Project (respectively)) or to circumvent Service-specific usage
  limits or quotas".
- **Google APIs Terms**, https://developers.google.com/terms, last modified
  November 9, 2021: "You agree to, and will not attempt to circumvent, such
  limitations documented with each API."
- **Gemini API rate limits**, https://ai.google.dev/gemini-api/docs/rate-limits,
  last updated 2026-09-02: "Rate limits are applied per project, not per API
  key."
- **Gemini CLI terms and privacy**,
  https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md,
  no date shown: "Directly accessing the services powering Gemini CLI …
  using third-party software, tools, or services … is a violation of
  applicable terms and policies."
- **What follows.**
  - API and Vertex: several projects are allowed, but not to act as one or to
    get past quotas: **confirm**.
  - Consumer sign-ins are never held (D74): **not offered**.

### GitHub Copilot

- **GitHub Terms of Service**,
  https://docs.github.com/en/site-policy/github-terms/github-terms-of-service,
  effective April 27, 2026.
  - "One person or legal entity may maintain no more than one free Account
    (if you choose to control a machine account as well, that's fine, but it
    can only be used for running a machine)."
  - "You may not share API tokens to exceed GitHub's rate limitations."
- **Acceptable Use Policies**,
  https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies,
  no date shown. It prohibits "using our servers for any form of excessive
  automated bulk activity".
- **What follows.**
  - Copilot reaches this product only through VS Code's own `vscode.lm`
    sign-in (D74), so the harness holds one Copilot account, whichever VS
    Code chose.
  - Pooling against limits: **confirm**, should a second route ever exist.

### xAI

- **Acceptable Use Policy**, https://x.ai/legal/acceptable-use-policy,
  effective August 14, 2026. Checked in a browser. It lists "Disrupting,
  interfering with, or unauthorized access to the Service or its safety
  systems, including circumventing any rate limits or restrictions or
  protective measures and safety mitigations".
- **Rate limits**, https://docs.x.ai/developers/rate-limits, no date shown.
  - "Every xAI API team has per-model rate limits".
  - For more, "Request an increase."
- The enterprise and consumer Terms of Service pages refused the fetch tool
  and were not read; lane 0 reads them.
- **What follows.** Pooling against limits meets the AUP: **confirm**.

### Groq

- **Acceptable Use & Responsible AI Policy**,
  https://console.groq.com/docs/legal/ai-policy, effective October 15, 2025.
  Customer agrees not to use the services "beyond published parameters, rate
  limits, or use limitations, including by registering multiple accounts or
  orchestrating usage between multiple organizations".
- **Services Agreement**,
  https://console.groq.com/docs/legal/services-agreement, last modified June
  22, 2026: "Groq has no obligation to provide multiple accounts to
  Customer."
- **What follows.** The policy names exactly what pooling does:
  **confirm**, with this clause quoted.

### Mistral AI

- **Commercial Terms of Service**,
  https://legal.mistral.ai/terms/commercial-terms-of-service, effective
  September 25, 2026.
  - "If a Customer Affiliate wishes to access Mistral AI Products on a
    separate workspace (apart from the Customer Account), such Customer
    Affiliate must separately accept these Terms or enter into a separate
    Order Form with Mistral AI."
  - Nothing found on rate limits.
- **Consumer terms outside the EEA**,
  https://legal.mistral.ai/terms/row-consumer-terms, effective September 25,
  2026: "The creation or use of multiple Mistral AI accounts by a single
  individual is strictly prohibited, including to bypass rate limits or any
  other restrictions."
- **What follows.**
  - API: **on**, re-checked with the record.
  - Consumer plan keys: a second account at all, and so any swap, needs the
    confirmation: **confirm**.

### OpenRouter

- **Terms of Service**, https://openrouter.ai/terms, last updated August 31,
  2026: you agree not to "create a false identity, misrepresent your
  identity, or create multiple accounts as a single user, for purposes of
  bypassing or circumventing use limits on the Site or Service or for any
  other reason".
- **Limits**, https://openrouter.ai/docs/api/reference/limits, no date
  shown: "Making additional accounts or API keys will not affect your rate
  limits, as we govern capacity globally."
- **What follows.**
  - Several keys in one account are fine, and per-key credit limits are user
    caps.
  - A second account needs the confirmation: **confirm**. It adds no
    capacity in any case.

### DeepSeek

- **Terms of Use**, https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html,
  last updated March 27, 2026: "Do not maliciously register accounts,
  including but not limited to frequent or bulk registration."
- **Rate limit**, https://api-docs.deepseek.com/quick_start/rate_limit, no
  date shown: "Concurrency limits are calculated at the account level,
  regardless of which API Key is used."
- **What follows.** No clause restricts pooling: **on**, re-checked with the
  record.

### Together AI

- **Terms of Service**, https://www.together.ai/terms-of-service, last updated
  May 19, 2026: you will not "directly or indirectly: … (e) make calls
  through the API that exceed limits on the number and frequency of such
  calls".
- **What follows.** **Confirm.**

### Fireworks AI

- **Terms of Service** (PDF linked from fireworks.ai/terms-of-service), last
  updated July 10, 2026: the user will not "(k) bypass any measures we may
  use to prevent or restrict access to the Service (including, without
  limitation, features … that enforce limitations on use of the Service or
  any portion thereof)".
- **What follows.** **Confirm.**

### Hugging Face

- **Terms of Service**, https://huggingface.co/terms-of-service, effective
  September 15, 2022: "A User can be part of multiple organizations."
- **Content Policy**, https://huggingface.co/content-policy, April 10, 2025.
  It prohibits "Abuse or interference with Hugging Face services, including:
  … Using tools like Cloudflare Tunnel, TOR, proxies, VNC, Chrome Remote
  Server, etc., to bypass restrictions."
- **What follows.** **Confirm.**

### Z.ai

- **Terms of Use**, https://docs.z.ai/legal-agreement/terms-of-use, last
  updated April 14, 2026. No clause on limits was found for the API.
- **Coding Plan Usage Policy**, https://docs.z.ai/devpack/usage-policy, no
  date shown: "You shall not use the GLM Coding Plan quota for
  general-purpose API access or any scenarios outside such tools … unless you
  have entered into a separate written agreement with Z.ai."
- **What follows.**
  - API: **on**, re-checked with the record.
  - The Coding Plan is never held (D74): **not offered**.

### Microsoft Azure OpenAI and Foundry

- **Quotas and limits**,
  https://learn.microsoft.com/en-us/azure/ai-foundry/openai/quotas-limits,
  dated 2026-08-20: "all resources and regions in a subscription share the
  same quota pool."
- **API Management backends**,
  https://learn.microsoft.com/en-us/azure/api-management/backends, dated
  2026-05-20: "With Azure OpenAI backends, implement circuit breaker rules
  to handle the `429` responses and accept the `Retry-After` duration."
- **Product Terms for Online Services**,
  https://www.microsoft.com/licensing/terms/product/ForOnlineServices/all,
  no date in the fetched text: "Customer must comply with, and may not work
  around, any technical limitations in an Online Service that only allow
  Customer to use it in certain ways."
- **What follows.**
  - Failing over between one's own deployments in one tenant is documented
    practice: **on**.
  - Across tenants: **confirm**.

## How D88 uses this

The owner's ruling frames the feature as adding capacity from accounts the
user legitimately holds. D88 turns automatic swapping and parallel use on by
default and encodes each vendor's terms as found here:

- **Without asking** where nothing restricts it, and always for a cap the user
  set (unless the vendor allows only one account per person).
- **After one confirmation that quotes the clause** where a vendor restricts
  several accounts or pooling against its limits.

Several vendors (Meta, OpenAI, Google, GitHub, xAI, Groq, OpenRouter) prohibit
using several accounts to get past their limits, whatever the purpose.
The confirmation therefore says plainly that the vendor's terms prohibit it
and that the vendor may act against the accounts; the decision is the
user's. The harness never creates accounts, never hides which account a
request comes from, and never misrepresents identity to a vendor.
