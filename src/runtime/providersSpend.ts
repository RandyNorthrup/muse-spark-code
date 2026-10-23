// `providers usage <id> [--days n] [--output json]` (M95, PROVSPEND): the
// provider's own figures for the period next to our own estimate and the
// difference. Display and reconciliation only: nothing here feeds a cap.
// This module stays out of the headless preflight bundle: only the usage
// dispatch loads it, so routine runs never carry the report parsers.
import {
  isUsdParseError,
  type ProviderSpendReport,
  type SpendEstimate,
  type SpendFetcher,
  type SpendHttpRequest,
} from '../core/providers/providerSpend'
import type { SpendFailure } from '../core/providers/providerSpendKeyUsage'
import {
  ACCOUNT_DAY_MS,
  CREDENTIAL_RECORD_VERSION,
  HTTP_STATUS,
  MODELS_DEV_CATALOGUE_DATE,
  PROVIDER_PROBE_TIMEOUT_MS,
  UI_TEXT,
} from '../shared/constants'
import { fill, uiLocale } from '../shared/l10n/text'
import { Usd } from '../shared/usd'
import {
  pinProviderFetch,
  resolveProvider,
  type ProviderPathRule,
  type ResolvedProvider,
} from './exec/providerExec'
import { resolveAttemptBillingRoute } from '../core/backends/modelapi/billingRoute'
import {
  parseStoredProviderSecret,
  providerAdminSecretAccount,
  providerSecretAccount,
} from './keyStore'
import {
  commandFile,
  failed,
  getPinnedJsonPage,
  isEndpointSafe,
  type ProvidersDeps,
} from './providersCommands'

const EXIT_OK = 0
const EXIT_FAILED = 1

/** The spend report's allowed paths on the pinned origin (PROVSPEND). */
export function spendAllowedPaths(presetId: string): readonly ProviderPathRule[] {
  switch (presetId) {
    case 'anthropic': {
      return [
        { kind: 'exact', path: '/v1/organizations/usage_report/messages' },
        { kind: 'exact', path: '/v1/organizations/cost_report' },
      ]
    }
    case 'openai': {
      return [
        { kind: 'exact', path: '/v1/organization/usage/completions' },
        { kind: 'exact', path: '/v1/organization/costs' },
      ]
    }
    case 'openrouter': {
      return [{ kind: 'exact', path: '/api/v1/key' }]
    }
    case 'deepseek': {
      return [{ kind: 'exact', path: '/user/balance' }]
    }
    default: {
      return []
    }
  }
}

function spendSilent(): void {
  // Spend reports never log: the transport needs a logger shape only.
}

function spendLog(): {
  readonly info: () => void
  readonly warn: () => void
  readonly error: () => void
  readonly trace: () => void
} {
  return { info: spendSilent, warn: spendSilent, error: spendSilent, trace: spendSilent }
}

/**
The spend fetcher over the product's pinned, proxy-aware path: the exact
report paths on the resolved origin, the rebinding check at every
dispatch, the request's own key through the transport's auth source (the
transport strips credential headers from caller input), a deadline per
request, nothing retried in a loop.
*/
async function spendFetcherFor(
  deps: ProvidersDeps,
  provider: ResolvedProvider,
): Promise<SpendFetcher> {
  const shared = await import('../host/backend/modelApiEntry')
  const auth = await import('../host/backend/configuredProvidersEntry')
  shared.setUiText(UI_TEXT, uiLocale())
  auth.setUiText(UI_TEXT, uiLocale())
  const pinned = pinProviderFetch(
    deps.fetch,
    provider,
    spendAllowedPaths(provider.preset.id),
    deps.resolveHost,
  )
  const sourceFor = (request: { readonly auth: SpendHttpRequest['auth'] }) =>
    new auth.ApiKeyAuthSource(
      () =>
        Promise.resolve({
          record: { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin: provider.origin },
          key: request.auth.key,
        }),
      request.auth.scheme,
    )
  const clientFor = (request: { readonly auth: SpendHttpRequest['auth'] }) => {
    const source = sourceFor(request)
    return new shared.RequestTransport({
      baseUrl: provider.origin,
      auth: source,
      verifyEndpoint: async (requestUrl) => {
        await source.headers(requestUrl)
      },
      fetch: pinned,
      now: Date.now,
      random: Math.random,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: spendLog(),
    })
  }
  // The request's own key travels through the transport's auth source:
  // the transport strips credential headers from caller input, so no
  // Authorization or provider key header from the caller ever leaves.
  // A transport failure (lost connection, refused dial, timeout) is not
  // a page: it resolves undefined, per the SpendFetcher contract, and
  // reads as unreachable. Anything else is not a transport failure.
  return async (request) => {
    try {
      return await getPinnedJsonPage(
        async () =>
          await clientFor(request).request(
            request.url.slice(provider.origin.length),
            {
              billingRoute: await resolveAttemptBillingRoute({
                feature: 'catalogue',
                isMetaDirect: false,
              }),
              method: 'GET',
              headers: { ...request.headers },
              accept: 'application/json',
              retries: 'rateLimitOnly',
            },
            AbortSignal.timeout(PROVIDER_PROBE_TIMEOUT_MS),
          ),
        (result) => shared.parseJsonResponse(result, (value) => value),
        (error: unknown) =>
          error instanceof shared.ModelApiError && error.status !== 0 ? error.status : undefined,
      )
    } catch (error: unknown) {
      if (!shared.isModelApiError(error)) throw error
      return
    }
  }
}

/** The stored key for a spend report: the envelope, checked and bound. */
async function spendStoredKey(
  deps: ProvidersDeps,
  provider: ResolvedProvider,
  account: string | undefined,
): Promise<
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly missing: boolean; readonly reason: string }
> {
  if (account === undefined || provider.preset.auth !== 'apiKey') {
    return { ok: false, missing: true, reason: '' }
  }
  // The provider core loads with its bundle, never with this command:
  // the entry require runs here, on the report read.
  const { credentialRecord } = await import('../host/backend/providersEntry')
  const { isCredentialBound } = credentialRecord
  const stored = await deps.secrets.get(account)
  if (stored === undefined || stored === '') return { ok: false, missing: true, reason: '' }
  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return {
      ok: false,
      missing: false,
      reason: fill(UI_TEXT.providerSecretUnreadable, { provider: provider.entry.id }),
    }
  }
  const parsed = parseStoredProviderSecret(value)
  if (parsed === undefined) {
    return {
      ok: false,
      missing: false,
      reason: fill(UI_TEXT.providerSecretUnreadable, { provider: provider.entry.id }),
    }
  }
  if (!isCredentialBound(parsed.record, provider.origin)) {
    return {
      ok: false,
      missing: false,
      reason: fill(UI_TEXT.providerOriginMismatch, {
        provider: provider.entry.id,
        stored: parsed.record.origin,
        current: provider.origin,
      }),
    }
  }
  return { ok: true, key: parsed.key }
}

/**
Our own estimate for the provider's spend in a journal range (PROVSPEND):
the matched breakdown row's exact cost lines, with token counts when the
journal recorded them. Undefined when the journal recorded no spend: the
provider's figures are then shown alone, never against a zero.
*/
export function spendEstimateFromBreakdown(
  breakdown: readonly {
    readonly id: string
    readonly label: string
    readonly provider?: string | undefined
    readonly totals: {
      readonly tokens: { readonly input?: number | undefined; readonly output?: number | undefined }
      readonly costs: readonly { readonly usd?: string | undefined }[]
    }
  }[],
  candidates: readonly string[],
): SpendEstimate | undefined {
  const wanted = new Set(candidates.map((candidate) => candidate.toLowerCase()))
  const row = breakdown.find(
    (entry) =>
      (entry.provider !== undefined && wanted.has(entry.provider.toLowerCase())) ||
      wanted.has(entry.id.toLowerCase()) ||
      wanted.has(entry.label.toLowerCase()),
  )
  if (row === undefined) return undefined
  const amounts = row.totals.costs
    .map((cost) => cost.usd)
    .filter((usd): usd is string => usd !== undefined)
  if (amounts.length === 0) return undefined
  let total = Usd.from(0)
  try {
    for (const amount of amounts) total = total.add(Usd.from(amount))
  } catch (error: unknown) {
    // A journal cost that is not a decimal leaves no estimate; anything
    // else is not a malformed amount and stays loud.
    if (!isUsdParseError(error)) throw error
    return undefined
  }
  const { input, output } = row.totals.tokens
  return {
    usd: total.toString(),
    ...(input !== undefined &&
      output !== undefined && { inputTokens: input, outputTokens: output }),
  }
}

/**
`providers usage <id> [--days n] [--output json]` (PROVSPEND): the
provider's own figures for the period, next to our own estimate and the
difference. Display and reconciliation only: nothing here feeds a cap.
*/
export async function providersUsage(
  deps: ProvidersDeps,
  options: { readonly provider: string; readonly days: number; readonly json: boolean },
): Promise<number> {
  // The provider core loads with its bundle, never with this command:
  // the entry require runs here, on the report read.
  const { presets, providerSpend, providerSpendKeyUsage } =
    await import('../host/backend/providersEntry')
  const { presetById } = presets
  const {
    fetchAdminSpendReport,
    fetchBalanceSpendReport,
    fetchKeyUsageSpendReport,
    openRouterSpendRequest,
    parseOpenRouterKeyBody,
    spendFailureText,
    spendHttpFailure,
    spendKeyKindFor,
    spendReportLines,
  } = providerSpend
  const { isSpendFailure } = providerSpendKeyUsage
  const file = await commandFile(deps)
  if (file === undefined) return EXIT_FAILED
  const resolved = await resolveProvider(file, options.provider, presetById, deps.resolveHost)
  if (!resolved.ok) {
    if (resolved.error === 'unknown-provider' || resolved.error === 'unknown-preset') {
      return failed(deps, fill(UI_TEXT.providerUnknown, { provider: options.provider }))
    }
    return failed(
      deps,
      resolved.error === 'no-request-path'
        ? fill(UI_TEXT.providerNoRequestPath, { provider: options.provider })
        : fill(UI_TEXT.providerEndpointRefused, { reason: resolved.error }),
    )
  }
  const { provider } = resolved
  const capability = provider.preset.spend
  if (capability === 'none') {
    deps.print(UI_TEXT.accounts.spendUnsupported)
    return EXIT_FAILED
  }
  const keyKind = spendKeyKindFor(capability)
  const accountFor = keyKind === 'admin' ? providerAdminSecretAccount : providerSecretAccount
  const stored = await spendStoredKey(deps, provider, accountFor(provider.entry.id))
  if (!stored.ok) {
    if (stored.missing) {
      deps.print(
        fill(keyKind === 'admin' ? UI_TEXT.accounts.spendAdminMissing : UI_TEXT.providerKeyAbsent, {
          provider: provider.entry.id,
        }),
      )
    } else {
      deps.printError(stored.reason)
    }
    return EXIT_FAILED
  }
  if (!(await isEndpointSafe(deps, provider))) return EXIT_FAILED
  const now = (deps.now ?? Date.now)()
  const start = now - options.days * ACCOUNT_DAY_MS
  const startingAt = new Date(start).toISOString()
  const endingAt = new Date(now).toISOString()
  const asOf = new Date(now).toISOString()
  const fetch = await spendFetcherFor(deps, provider)
  let report: ProviderSpendReport | SpendFailure
  if (
    capability === 'admin-report' &&
    (provider.preset.id === 'anthropic' || provider.preset.id === 'openai')
  ) {
    report = await fetchAdminSpendReport({
      fetch,
      provider: provider.preset.id,
      origin: provider.origin,
      key: stored.key,
      keyKind,
      startingAt,
      endingAt,
      asOf,
    })
  } else if (capability === 'balance') {
    report = await fetchBalanceSpendReport({
      fetch,
      origin: provider.origin,
      key: stored.key,
      keyKind,
      asOf,
    })
  } else if (capability === 'key-usage') {
    const answer = await fetch(openRouterSpendRequest({ origin: provider.origin, key: stored.key }))
    if (answer === undefined) {
      return failed(deps, spendFailureText({ kind: 'unreachable' }, provider.preset.label))
    }
    if (answer.status !== HTTP_STATUS.ok) {
      return failed(
        deps,
        spendFailureText(spendHttpFailure(answer.status, answer.body), provider.preset.label),
      )
    }
    const snapshot = parseOpenRouterKeyBody(answer.body)
    if (isSpendFailure(snapshot)) {
      return failed(deps, spendFailureText(snapshot, provider.preset.label))
    }
    report = await fetchKeyUsageSpendReport({
      read: () => Promise.resolve(snapshot),
      key: stored.key,
      keyKind,
      asOf,
    })
  } else {
    deps.print(UI_TEXT.accounts.spendUnsupported)
    return EXIT_FAILED
  }
  if (isSpendFailure(report)) {
    return failed(deps, spendFailureText(report, provider.preset.label))
  }
  let estimate: SpendEstimate | undefined
  try {
    estimate = await deps.readSpendEstimate?.(provider.entry.id, start, now)
  } catch {
    estimate = undefined
  }
  if (options.json) {
    deps.print(
      JSON.stringify({
        provider: provider.entry.id,
        days: options.days,
        asOf,
        report,
        estimate: estimate ?? null,
      }),
    )
    return EXIT_OK
  }
  const lines = spendReportLines(report, estimate, {
    providerLabel: provider.preset.label,
    catalogueDate: MODELS_DEV_CATALOGUE_DATE,
  })
  for (const line of lines) {
    deps.print(line)
  }
  return EXIT_OK
}
