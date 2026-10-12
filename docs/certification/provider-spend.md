# Certification: provider-reported spend (PROVUSAGE, 2026-10-12, kubuntu)

Lane branch `feat/provider-spend` from `87d9ab91c`. No model call and no
network request by the lane: every wire body in tests is a fake built from
the documented shapes in the lane brief. Everything not checked against a
real account is marked UNVERIFIED below and in code, for a live capture by
the lead.

## Provider table

| Provider                                                              | What its API offers (documentation researched 2026-10-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | What we built                                                                                                                                                                                                                      | Status                                                                                                | Live capture must check                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic                                                             | Usage and Cost Admin API: `GET /v1/organizations/usage_report/messages` (query `starting_at`, `ending_at`, `bucket_width` 1m\|1h\|1d, `group_by[]`, filters; token counts uncached/cached/cache-creation/output; `has_more`, `next_page` → `page=`) and `GET /v1/organizations/cost_report` (USD decimal strings in cents, daily buckets, `group_by[]` workspace_id/description); headers `anthropic-version: 2023-06-01`, `x-api-key: <ADMIN key sk-ant-admin01-…>`; data within ~5 min, polling once a minute supported; unavailable for individual accounts; Priority Tier cost not in the cost endpoint; `GET /v1/models` has no price field | `admin-report`: both requests with daily buckets, paginated to 20 pages each, cents strings to exact dollars, Priority Tier named in the difference sentence                                                                       | UNVERIFIED                                                                                            | Exact field names of usage buckets and cost lines; the 403 body for an individual account (we match `/individual account/i`); the `page=` cursor name; whether `has_more` without `next_page` ends the list |
| OpenAI                                                                | `GET /v1/organization/usage/completions` (token/request counts, bucketed) and `GET /v1/organization/costs` (`results[].amount.value` + `currency: "usd"`, `line_item`, `project_id`, `bucket_width: "1d"` only); `Authorization: Bearer <ADMIN key>`; page cursor pagination; no per-token price endpoint                                                                                                                                                                                                                                                                                                                                        | `admin-report`: both requests, `value`+`currency` to exact dollars (non-USD is unreadable), cursor pagination to the same bound                                                                                                    | UNVERIFIED                                                                                            | Exact bucket/line field names; the cursor parameter name; cost `value` as string vs number (both accepted)                                                                                                  |
| OpenRouter                                                            | `GET /api/v1/key`: the key's limit, remaining and usage for all time, day, week, month; every response carries `usage.cost`; `GET /api/v1/generation?id=` returns it later (product already had this: `presets.ts` keyTest, `providerPorts.ts`)                                                                                                                                                                                                                                                                                                                                                                                                  | `key-usage`: the existing read is the first user of the shared shape (`openRouterSpendReport`); the terminal parses the key body from the D74-captured field names (`limit`, `limit_remaining`, `usage{,_daily,_weekly,_monthly}`) | VERIFIED (shapes from the D74 capture, `docs/certification/m95-captures.md`) except the month mapping | Whether the month reads `usage` or `usage_monthly` (we take `usage_monthly`)                                                                                                                                |
| DeepSeek                                                              | `GET /user/balance` → `is_available`, `balance_infos[]` (`currency` CNY\|USD, `total_balance`, `granted_balance`, `topped_up_balance` strings); no usage history, no price endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `balance`: availability plus per-currency balances as exact decimal strings; shown with no comparison                                                                                                                              | UNVERIFIED                                                                                            | Exact field names and the balance path on the API origin                                                                                                                                                    |
| xAI                                                                   | Per-request cost in the response (`cost_in_usd_ticks`, already read in `codecs/responses.ts`); no billing endpoint documented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `none`: nothing new                                                                                                                                                                                                                | VERIFIED (nothing to build)                                                                           | —                                                                                                                                                                                                           |
| Google Gemini, Groq, Mistral, Together, Fireworks, Hugging Face, Z.ai | No account spend endpoint found in API documentation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `none`: `providers usage` prints "This provider offers no spend report."                                                                                                                                                           | VERIFIED (nothing to build)                                                                           | Re-check only if a provider documents a new endpoint                                                                                                                                                        |

Notes the lane must not build on: Anthropic's `spend-limit-reads-2026-09-26`
beta header (UNVERIFIED what it reads); any per-token price endpoint (none
exists — our estimate's prices come from the vendored models.dev catalogue
dated 2026-10-05, pinned by test against
`vendor/models-dev/VENDOR.json`).

## Key-separation proof

- Admin keys live under `museSpark.providerAdmin.<id>` (shared constant
  `PROVIDER_ADMIN_SECRET_PREFIX`), inference keys under
  `museSpark.provider.<id>`; both sides of the bridge compute the same
  names (test: `providerSpendSecrets` naming cases).
- `fetchAdminSpendReport` with an inference key and
  `fetchKeyUsage/BalanceSpendReport` with an admin key return
  `wrong-key-kind` before any request (tested; the fetch is not called).
- The terminal reads the admin account for `admin-report` and the
  inference account otherwise; a header-capture test through the real
  `RequestTransport` + pin proves only the stored admin key travels, and
  only to the report paths, while a stored inference key never appears.
- `configuredProvidersEntry.ts` and `exec/providerExec.ts` (the
  model-request transports) never name the admin account (static test);
  no budget module imports `providerSpend` (static test); the report type
  carries no threshold/cap/budget field.
- Removing the provider deletes both secrets (editor Undo-window test and
  terminal test).
- A transport subtlety found by the tests: `RequestTransport` strips
  credential headers from caller input, so report requests carry the key
  in an explicit `auth` field that the fetcher hands to `ApiKeyAuthSource`
  — never in a loggable header.

## Bounds, floors and errors

- Pagination: at most 20 pages per report leg (`SPEND_PAGE_BOUND`),
  tested with endless fake pages; a daily-bucket period keeps real
  reports to a handful of pages.
- Polling: at most one fetch a minute per account (`SpendThrottle`,
  `SPEND_POLL_FLOOR_MS`), unit-tested with an injected clock. No
  long-lived surface polls yet: each terminal invocation performs
  exactly one fetch sequence (no polling loop, no retry loop), so the
  per-invocation rate is bounded by the user, and the editor forwards
  the recorded key-usage report without fetching. Wiring the throttle
  into the editor's on-demand fetch (the cache home) is a follow-up
  below — it is not wired into the terminal, where a process-local
  gate would be theater.
- Deadline: `PROVIDER_PROBE_TIMEOUT_MS` per request through the pinned
  transport; nothing retried in a loop.
- Errors are fixed sentences: `refused` (401/403 and anything
  unrecognised), `plan-unavailable` (403 whose body names individual
  accounts — UNVERIFIED signal), `unreadable` (strict-schema failure,
  never a zero), `unreachable` (transport throw). No body or key material
  reaches the output.

## Transport tests (no loopback needed)

The brief expected loopback-dependent transport tests for the lead, but
the spend fetcher is covered without loopback: the terminal tests drive
the real `RequestTransport` + `pinProviderFetch` + rebinding check with a
scripted `fetch`, asserting URLs, the `x-api-key`/bearer auth source, the
exact-path pin and failure mappings. What remains for the lead is only
the live-account capture in the table above, with a real admin key
(Anthropic/OpenAI) and inference keys (OpenRouter/DeepSeek):

- `providers usage anthropic --days 9` and `--output json`
- `providers usage openai --days 30`
- `providers usage openrouter`, `providers usage deepseek`
- `auth set --provider anthropic --admin` (stdin), then `auth status` /
  `auth clear --provider anthropic --admin`

## Red drills (all seen to fail, then restored byte-exact)

- `spendKeyKindFor` forced to `inference`: key-routing test fails.
- Editor removal without the admin delete: admin-key removal test fails.
- Terminal reading the inference account for admin reports: 4 command
  tests fail (including the header-capture proof).

## Follow-ups (not in this lane)

- ACP live fetch: the ACP `/usage` summary already renders recorded
  provider limit snapshots (OpenRouter figures) through the usage text;
  a live admin-report fetch inside the ACP agent needs secrets+fetch in
  the agent's deps and is not wired here.
- Editor on-demand admin fetch: the `SpendThrottle` + `onSpend` seam
  exists; the Models panel has no spend section yet, so the editor shows
  OpenRouter figures (via the journal, as before) and the terminal/JSON
  carry the admin reports.
- Usage-page `AccountUsageReport` rows carry no spend field yet: the
  report has no production filler on this base, and an unfilled render
  branch would be dead code.
