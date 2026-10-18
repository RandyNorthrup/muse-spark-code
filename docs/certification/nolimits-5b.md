# Lane NOLIMITS5B: no default request limit in the GitHub Action

## Outcome

The GitHub Action (`action/`) carries its own `DEFAULT_MAX_REQUESTS = 30`, a
limit the person did not set. With no `max-requests` input the Action will set
no request limit, like the CLI after PR #239 (`fix/nolimits-5`).

## Sites (read 2026-10-17, before the change)

| #   | Site                                                                                                                     | What the person sees now                                             | What they will see                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | `action/lib/tools.mjs:27,302-308` (`DEFAULT_MAX_REQUESTS = 30` as the `boundedInteger` fallback)                         | No `max-requests` input means a 30-request cap the person never set. | Empty/unset `max-requests` means no request limit (`null`); a set value is still bounded 1-500. |
| 2   | `action/action.yml:31-34` (`max-requests` input, `default: '30'`)                                                        | Docs promise 30 by default.                                          | `default: ''`: empty sets no request limit.                                                     |
| 3   | `action/lib/run-exec.mjs:104-105` (`execArguments` always passes `--max-requests`)                                       | The cap is always forwarded to `exec`.                               | `--max-requests` is forwarded only when the person set one.                                     |
| 4   | `action/lib/result.mjs` (`isBackendAccountingValid` demands non-null `limits.maxRequests` for a completed Model API run) | A completed run always carries a cap, so the check holds.            | A completed run may carry a null cap (mirrors NOLIMITS5's `execProtocol.ts` change).            |
| 5   | `test/unit/helpers/actionModules.d.ts:88` (`maxRequests: number`)                                                        | Types the parsed input as always set.                                | `number \| null`.                                                                               |
| 6   | `docs/ci.md` Action inputs table (`max-requests                                                                          | 30`)                                                                 | Documents the person-not-set default.                                                           | Empty (no limit); a set value follows the CLI bounds. |
| 7   | `README.md` "Headless and CI (M80)" section                                                                              | No statement about the request-limit default.                        | Notes that no `max-requests` input means no request limit.                                      |

Not touched: the CLI `--max-requests` row (`docs/ci.md:51`) and `EXEC_DEFAULT_MAX_REQUESTS`
belong to lane NOLIMITS5 (`fix/nolimits-5`); the apply sub-action has no
`max-requests` input.

## Old receipts (history, not a reason to keep a limit)

The M80 LA live receipt (2026-10-05, `test/action/la-check.mjs`) ran without a
`max-requests` input, i.e. under the old default of 30. It covered a completed
contributor-model review within the $0.25 budget cap; the request cap never
bound the run (`la-check` asserts budget, cost, requests and patch shape, never
the cap). That receipt proves the run path, not the default.

## Change log

- (pending) implementation + focused test + docs + CHANGELOG.
