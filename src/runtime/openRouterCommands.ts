// Explicit terminal/ACP actions: browser approval, hidden pasted code and
// the existing origin-bound provider key record. No model request is made.
import type { SignInMethod } from '../acp/agent'
import type { ProvidersDeps } from './providersCommands'
import { keyTargetFor } from './providersCommands'
import {
  formatStoredProviderSecret,
  parseStoredProviderSecret,
  providerSecretAccount,
} from './keyStore'
import { connectOpenRouterAccount, OPENROUTER_ORIGIN, pkce } from '../host/backend/providersEntry'
import type { createConfiguredProviderServices } from '../core/providers/configured'
import { ACP_AGENT_NAME, CREDENTIAL_RECORD_VERSION, UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { formatUsd } from '../core/usage/insights'

type OpenRouterApi = Pick<
  ReturnType<typeof createConfiguredProviderServices>,
  'openRouterExchange' | 'openRouterUsage'
>

const connecting = new WeakSet<ProvidersDeps['secrets']>()

export async function runOpenRouterConnect(
  deps: ProvidersDeps,
  api: OpenRouterApi,
  callerSignal?: AbortSignal,
): Promise<number> {
  if (connecting.has(deps.secrets)) {
    deps.printError(UI_TEXT.providerConnectFailed)
    return 1
  }
  connecting.add(deps.secrets)
  const controller = new AbortController()
  const signal =
    callerSignal === undefined
      ? controller.signal
      : AbortSignal.any([callerSignal, controller.signal])
  const abort = () => {
    controller.abort()
    // This command owns terminal input; stop its handle and restore echo on
    // process interruption even if a hidden-input port has not settled yet.
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
    process.stdin.pause()
  }
  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)
  try {
    signal.throwIfAborted()
    const target = await keyTargetFor(deps.readUserFile, 'openrouter')
    const account = providerSecretAccount('openrouter')
    if (
      account === undefined ||
      !target.ok ||
      target.preset.id !== 'openrouter' ||
      target.origin !== OPENROUTER_ORIGIN
    )
      throw new Error(UI_TEXT.providerConnectFailed)
    const previous = await deps.secrets.get(account)
    const connection = await connectOpenRouterAccount({
      pkce: { create: pkce.createPkcePair, newState: () => pkce.createPkcePair().state },
      exchange: {
        exchange: (request) =>
          api.openRouterExchange(request.code, request.verifier, request.signal),
      },
      signal,
      // A terminal/remote editor displays the documented headless URL; the
      // user pastes only its single-use code through the non-echoing reader.
      isRemote: true,
      openBrowser: (url) => {
        deps.print(url)
        return Promise.resolve()
      },
      startServer: () => Promise.reject(new Error(UI_TEXT.providerConnectFailed)),
      promptForPastedCode: () => deps.readSecret(UI_TEXT.providerPasteCode),
    })
    if (connection === undefined) return 1
    const store = async () => {
      signal.throwIfAborted()
      const current = await keyTargetFor(deps.readUserFile, 'openrouter')
      if (
        !current.ok ||
        current.preset.id !== 'openrouter' ||
        current.origin !== OPENROUTER_ORIGIN ||
        (await deps.secrets.get(account)) !== previous
      )
        throw new Error(UI_TEXT.providerEditConflict)
      signal.throwIfAborted()
      const written = formatStoredProviderSecret(
        {
          v: CREDENTIAL_RECORD_VERSION,
          auth: 'apiKey',
          origin: OPENROUTER_ORIGIN,
        },
        connection.key,
      )
      try {
        await deps.secrets.store(account, written)
      } finally {
        if (signal.aborted && (await deps.secrets.get(account)) === written) {
          // A previous record may have been independently removed during
          // this write. Discard our cancelled grant; never revive that record.
          await deps.secrets.delete(account)
        }
      }
      signal.throwIfAborted()
      return 0
    }
    await (deps.withUserFileLock === undefined ? store() : deps.withUserFileLock(store))
    deps.print(fill(UI_TEXT.keyStoredNote, { origin: OPENROUTER_ORIGIN }))
    return 0
  } catch {
    deps.printError(UI_TEXT.providerConnectFailed)
    return 1
  } finally {
    connecting.delete(deps.secrets)
    process.off('SIGINT', abort)
    process.off('SIGTERM', abort)
  }
}

export async function runOpenRouterUsage(
  deps: ProvidersDeps,
  api: OpenRouterApi,
  id: string,
): Promise<number> {
  try {
    const target = await keyTargetFor(deps.readUserFile, id)
    const account = providerSecretAccount(id)
    if (
      account === undefined ||
      !target.ok ||
      target.preset.id !== 'openrouter' ||
      target.origin !== OPENROUTER_ORIGIN
    )
      throw new Error(UI_TEXT.providerUsageFailed)
    const stored = await deps.secrets.get(account)
    const value: unknown = stored === undefined ? undefined : JSON.parse(stored)
    const parsed = parseStoredProviderSecret(value)
    if (parsed?.record.origin !== OPENROUTER_ORIGIN) throw new Error(UI_TEXT.providerUsageFailed)
    const usage = await api.openRouterUsage(
      { id, preset: 'openrouter', address: OPENROUTER_ORIGIN, auth: 'apiKey', models: [] },
      parsed.key,
    )
    if ((await deps.secrets.get(account)) !== stored) throw new Error(UI_TEXT.providerUsageFailed)
    const rows: readonly (readonly [string, number | undefined])[] = [
      [UI_TEXT.usageKeyTotal, usage.usedTotal],
      [UI_TEXT.usageToday, usage.usedToday],
      [UI_TEXT.usageWeekly, usage.usedThisWeek],
      [UI_TEXT.usageThisMonth, usage.usedThisMonth],
      [UI_TEXT.usageLimit, usage.limit],
      [UI_TEXT.usageRemaining, usage.remaining],
    ]
    for (const [label, amount] of rows) {
      if (amount !== undefined) deps.print(`${label}: ${formatUsd(amount)}`)
      else if (label === UI_TEXT.usageLimit && usage.unlimited)
        deps.print(`${label}: ${UI_TEXT.usageUnlimited}`)
    }
    return 0
  } catch {
    deps.printError(UI_TEXT.providerUsageFailed)
    return 1
  }
}

/** ACP clients run these commands in their private terminal auth UI. */
export function openRouterAuthenticationMethods(
  deps: Pick<ProvidersDeps, 'readUserFile' | 'secrets'>,
): SignInMethod[] {
  return [
    {
      id: 'openrouter-connect',
      name: fill(UI_TEXT.providerConnect, { provider: 'OpenRouter' }),
      args: ['providers', 'connect', 'openrouter'],
    },
    {
      id: 'openrouter-key',
      name: fill(UI_TEXT.providerKeyPrompt, { provider: 'OpenRouter' }),
      args: ['auth', 'set', '--provider', 'openrouter'],
    },
    {
      id: 'openrouter-usage',
      name: UI_TEXT.usageKeyUsage,
      args: ['providers', 'usage', 'openrouter'],
    },
  ].map((method) => ({
    ...method,
    description: UI_TEXT.providerOpenRouterServices,
    command: `${ACP_AGENT_NAME} ${method.args.join(' ')}`,
    verify: async () => {
      try {
        const target = await keyTargetFor(deps.readUserFile, 'openrouter')
        const stored = await deps.secrets.get(providerSecretAccount('openrouter') ?? '')
        const value: unknown = stored === undefined ? undefined : JSON.parse(stored)
        return target.ok &&
          target.preset.id === 'openrouter' &&
          target.origin === OPENROUTER_ORIGIN &&
          parseStoredProviderSecret(value)?.record.origin === OPENROUTER_ORIGIN
          ? undefined
          : UI_TEXT.providerKeyNotStored
      } catch {
        return UI_TEXT.providerKeyNotStored
      }
    },
  }))
}
