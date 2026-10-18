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
import { isCredentialLockBusy, recoverOpenRouterJournalReport } from './providerAuth'
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
  const account = providerSecretAccount('openrouter')
  // The whole attempt is ONE transaction inside the one credential lease:
  // recovery, the previous-key read, the durable intent, the exchange, the
  // journaled commit and any rollback. No caller reads the old key outside
  // it and writes inside it, and no second writer replaces or removes the
  // key while this one runs. What is known (the vendor-created-key notice)
  // is composed from the record already read before any cleanup that may
  // refuse.
  const transact = async (): Promise<number> => {
    signal.throwIfAborted()
    // The lease's bundle loads on a Connect, never with the command's own bundle.
    const { formatCredentialJournal } = await import('../core/credentialLeaseEntry')
    const target = await keyTargetFor(deps.readUserFile, 'openrouter')
    if (
      account === undefined ||
      !target.ok ||
      target.preset.id !== 'openrouter' ||
      target.origin !== OPENROUTER_ORIGIN
    ) {
      deps.printError(UI_TEXT.providerConnectFailed)
      return 1
    }
    const staging = `${account}.connect`
    const report = await recoverOpenRouterJournalReport(deps.secrets)
    for (const notice of report.notices) deps.printError(notice)
    // A refused recovery cleanup keeps the journal for the next start; this
    // run stops before any new write, with the notice already shown.
    if (report.failed) {
      deps.printError(UI_TEXT.providerConnectFailed)
      return 1
    }
    if (report.committed) {
      // The primary already holds the staged record: a previous attempt
      // committed, then crashed before cleaning up. Say nothing about
      // removing a key: this is the key in use.
      deps.print(UI_TEXT.providerConnectRecoveredStored)
    }
    let previous: string | undefined
    try {
      previous = await deps.secrets.get(account)
    } catch {
      deps.printError(UI_TEXT.providerConnectFailed)
      return 1
    }
    signal.throwIfAborted()
    if (previous !== undefined) {
      const answer = await unlessAborted(deps.readSecret(UI_TEXT.providerConnectReplaceKey), signal)
      signal.throwIfAborted()
      if (answer?.trim().toLowerCase() !== 'yes') return 1
    }
    // The durable intent, without any secret, before the code exchange: a
    // crash from here on is found without connecting again.
    try {
      await deps.secrets.store(
        staging,
        formatCredentialJournal({ v: 1, phase: 'started', previous: previous ?? null, next: null }),
      )
    } catch {
      deps.printError(UI_TEXT.providerConnectFailed)
      return 1
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
    // Pre-exchange cancellation only (dismissed or empty pasted code;
    // exchange failures throw): the exchange never ran, so no key could
    // have been created. Remove the staging intent, or the next start
    // would recover it as a discarded created key. Ambiguous failures
    // below keep the journal, so the next start reports what may exist.
    if (connection === undefined) {
      try {
        await deps.secrets.delete(staging)
      } catch {
        deps.printError(UI_TEXT.providerConnectFailed)
      }
      return 1
    }
    const written = formatStoredProviderSecret(
      {
        v: CREDENTIAL_RECORD_VERSION,
        auth: 'apiKey',
        origin: OPENROUTER_ORIGIN,
      },
      connection.key,
    )
    // Composed from the record just read, before the cleanup that may throw.
    const mintedNotice = openRouterDiscardedKeyNotice()
    const stagedJournal = formatCredentialJournal({
      v: 1,
      phase: 'staged',
      previous: previous ?? null,
      next: written,
    })
    let didAttemptPrimary = false
    try {
      signal.throwIfAborted()
      // The journal holds previous and next BEFORE the primary is touched.
      await deps.secrets.store(staging, stagedJournal)
      signal.throwIfAborted()
      if ((await deps.secrets.get(staging)) !== stagedJournal)
        throw new Error(UI_TEXT.providerConnectFailed)
      signal.throwIfAborted()
      if ((await deps.secrets.get(account)) !== previous)
        throw new Error(UI_TEXT.providerEditConflict)
      signal.throwIfAborted()
      didAttemptPrimary = true
      await deps.secrets.store(account, written)
      signal.throwIfAborted()
      if ((await deps.secrets.get(account)) !== written)
        throw new Error(UI_TEXT.providerEditConflict)
      signal.throwIfAborted()
      try {
        await deps.secrets.delete(staging)
      } catch {
        // The primary write above was verified: the key IS stored, so this
        // run still succeeds. The kept journal holds the previous record;
        // the next start recovers it as committed.
      }
      signal.throwIfAborted()
    } catch {
      // The primary was never attempted: the minted key was not kept here.
      // Say so from the notice composed before any cleanup, and keep the
      // journal for the next start.
      if (!didAttemptPrimary) {
        deps.printError(mintedNotice)
        deps.printError(UI_TEXT.providerConnectFailed)
        return 1
      }
      // Rollback inside the lease, never cancellable: a locked writer is
      // serialized by the lease, and a primary that is no longer ours
      // (rotated or removed meanwhile) is left alone, never restored. A
      // rollback the store refuses KEEPS the journal: the only copy of the
      // previous record is never deleted, and the sentence says the new key
      // is what is really stored.
      try {
        if ((await deps.secrets.get(account)) === written) {
          if (previous === undefined) await deps.secrets.delete(account)
          else await deps.secrets.store(account, previous)
        }
      } catch {
        deps.printError(UI_TEXT.providerConnectStoredNewKey)
        return 1
      }
      try {
        await deps.secrets.delete(staging)
      } catch {
        // The next start recovers the slot: primary equals previous, so it
        // reports the created key as not kept. That is true: it was rolled
        // back here.
      }
      deps.printError(mintedNotice)
      deps.printError(UI_TEXT.providerConnectFailed)
      return 1
    }
    deps.print(fill(UI_TEXT.keyStoredNote, { origin: OPENROUTER_ORIGIN }))
    return 0
  }
  const runLocked = async (): Promise<number> => {
    try {
      return await transact()
    } catch (error: unknown) {
      // The transaction returns its own failures; aborts, user-file reads
      // and anything else escaping it fail here, with the lease-busy case
      // saying to retry.
      if (isCredentialLockBusy(error)) deps.printError(UI_TEXT.providerConnectBusy)
      else deps.printError(UI_TEXT.providerConnectFailed)
      return 1
    }
  }
  try {
    if (deps.withUserFileLock === undefined) return await runLocked()
    try {
      return await deps.withUserFileLock(runLocked)
    } catch (error: unknown) {
      if (!isCredentialLockBusy(error)) throw error
      deps.printError(UI_TEXT.providerConnectBusy)
      return 1
    }
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
  const read = async (): Promise<number> => {
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
  if (deps.withUserFileLock === undefined) return await read()
  // A crashed Connect is found without connecting again: usage runs the
  // same recovery inside the same lease. A reader never fails on a live
  // writer's lease: without the lock it reads the primary and leaves
  // another attempt's journal alone.
  try {
    return await deps.withUserFileLock(async () => {
      const report = await recoverOpenRouterJournalReport(deps.secrets)
      for (const notice of report.notices) deps.printError(notice)
      if (report.failed) return 1
      if (report.committed) deps.print(UI_TEXT.providerConnectRecoveredStored)
      return await read()
    })
  } catch (error: unknown) {
    if (!isCredentialLockBusy(error)) throw error
    return await read()
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
