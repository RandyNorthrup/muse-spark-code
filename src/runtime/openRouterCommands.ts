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
import {
  connectOpenRouterAccount,
  OPENROUTER_ORIGIN,
  openRouterDiscardedKeyNotice,
  pkce,
} from '../host/backend/providersEntry'
import type { createConfiguredProviderServices } from '../core/providers/configured'
import { ACP_AGENT_NAME, CREDENTIAL_RECORD_VERSION, UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { formatUsdAtPrecision } from '../shared/l10n/exactUsd'
import { Usd } from '../shared/usd'
import { unlessAborted } from '../core/timeouts'

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
  // Every discarded vendor-created key is reported: the exchange reports a
  // late key once (and then throws, so the failure path below stays silent
  // for it), while a recovered staging key and a newly minted one are
  // distinct keys and each gets its own notice.
  const notifyDiscard = () => {
    deps.printError(openRouterDiscardedKeyNotice())
  }
  let wasMinted = false
  const account = providerSecretAccount('openrouter')
  let previous: string | undefined
  let written: string | undefined
  try {
    signal.throwIfAborted()
    const target = await keyTargetFor(deps.readUserFile, 'openrouter')
    if (
      account === undefined ||
      !target.ok ||
      target.preset.id !== 'openrouter' ||
      target.origin !== OPENROUTER_ORIGIN
    )
      throw new Error(UI_TEXT.providerConnectFailed)
    // A crashed Connect leaves its staged record behind. The next start
    // finds it, reports the vendor-created key in one sentence, and cleans
    // the slot before any new write, so it is never silently overwritten.
    const staging = `${account}.connect`
    let staged: string | undefined
    try {
      staged = await deps.secrets.get(staging)
    } catch {
      throw new Error(UI_TEXT.providerConnectFailed)
    }
    if (staged !== undefined) {
      // A slot that cannot be cleaned stops the run before any new write;
      // the next Connect retries the recovery.
      try {
        await deps.secrets.delete(staging)
      } catch {
        throw new Error(UI_TEXT.providerConnectFailed)
      }
      notifyDiscard()
    }
    previous = await deps.secrets.get(account)
    signal.throwIfAborted()
    if (previous !== undefined) {
      const answer = await unlessAborted(deps.readSecret(UI_TEXT.providerConnectReplaceKey), signal)
      signal.throwIfAborted()
      if (answer?.trim().toLowerCase() !== 'yes') return 1
    }
    const connection = await connectOpenRouterAccount({
      pkce: { create: pkce.createPkcePair, newState: () => pkce.createPkcePair().state },
      exchange: {
        exchange: (request) =>
          api.openRouterExchange(request.code, request.verifier, request.signal),
      },
      signal,
      onDiscardedKey: notifyDiscard,
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
    wasMinted = true
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
      written = formatStoredProviderSecret(
        {
          v: CREDENTIAL_RECORD_VERSION,
          auth: 'apiKey',
          origin: OPENROUTER_ORIGIN,
        },
        connection.key,
      )
      // Verify the new record in a private OS-store slot before the atomic
      // replacement. The existing record remains intact throughout preparation.
      // Every credential write, and any rollback of one, runs inside the
      // provider lock: nothing here survives it, so no later rollback can
      // overwrite a rotation someone else made or resurrect a removal.
      try {
        await deps.secrets.store(staging, written)
        signal.throwIfAborted()
        if ((await deps.secrets.get(staging)) !== written)
          throw new Error(UI_TEXT.providerConnectFailed)
        signal.throwIfAborted()
        if ((await deps.secrets.get(account)) !== previous)
          throw new Error(UI_TEXT.providerEditConflict)
        signal.throwIfAborted()
        await deps.secrets.store(account, written)
        signal.throwIfAborted()
        if ((await deps.secrets.get(account)) !== written)
          throw new Error(UI_TEXT.providerEditConflict)
        signal.throwIfAborted()
        await deps.secrets.delete(staging)
        signal.throwIfAborted()
      } catch (error) {
        // Rollback inside the lock, never cancellable: a concurrent locked
        // writer is serialized by the lock, and a value that is no longer
        // ours (rotated or removed meanwhile) is left alone, never restored.
        // A refusing store cannot roll back either; the failure below stands
        // and the next Connect recovers the staging slot with its notice.
        try {
          if ((await deps.secrets.get(account)) === written) {
            if (previous === undefined) await deps.secrets.delete(account)
            else await deps.secrets.store(account, previous)
          }
        } catch {
          // The store refusal below already reports the failure.
        }
        try {
          await deps.secrets.delete(staging)
        } catch {
          // The next Connect recovers the slot with its notice.
        }
        throw error
      }
      signal.throwIfAborted()
      return 0
    }
    await (deps.withUserFileLock === undefined ? store() : deps.withUserFileLock(store))
    deps.print(fill(UI_TEXT.keyStoredNote, { origin: OPENROUTER_ORIGIN }))
    return 0
  } catch {
    // The lock is released here, so this path never touches the credential
    // store: a rollback now could overwrite an independent rotation or bring
    // back a removed key. The exchange notice and the failure are both
    // reported from memory, even when the store itself is refusing.
    if (wasMinted) notifyDiscard()
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
    const rows: readonly (readonly [string, number | string | undefined])[] = [
      [UI_TEXT.usageKeyTotal, usage.usedTotal],
      [UI_TEXT.usageToday, usage.usedToday],
      [UI_TEXT.usageWeekly, usage.usedThisWeek],
      [UI_TEXT.usageThisMonth, usage.usedThisMonth],
      [UI_TEXT.usageLimit, usage.limit],
      [UI_TEXT.usageRemaining, usage.remaining],
    ]
    for (const [label, amount] of rows) {
      if (amount !== undefined)
        deps.print(
          `${label}: ${formatUsdAtPrecision(Usd.from(amount), Math.max(2, Usd.from(amount).toString().split('.', 2)[1]?.length ?? 0))}`,
        )
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
