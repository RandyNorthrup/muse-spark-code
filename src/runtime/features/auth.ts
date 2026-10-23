import { AuthService, type AuthPort, type AuthServiceDeps } from '../../host/auth/authService'
import type { ConversationFeaturePorts } from '../../host/compose/conversationDeps'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { unlessAborted } from '../../core/timeouts'
import { runtimeFeatureLifetime } from './lifetime'

export interface RuntimeAuthDeps extends Omit<AuthServiceDeps, 'promptForApiKey'> {
  /** Launch only the trusted auth set command; stdin belongs to the user's terminal. */
  readonly runKeySignIn: (signal: AbortSignal, beforeRun: () => void) => Promise<boolean>
  readonly assertCurrent: () => void
  readonly cancelNative: () => void
  readonly drainNative: () => Promise<void>
  readonly ensureHost: ConversationFeaturePorts['ensureHost']
  readonly accountFacts: ConversationFeaturePorts['accountFacts']
  /** Boolean native fact only; never a credential value crossing the editor bridge. */
  readonly isKeyStored: () => boolean
}

/** The same auth state machine, with terminal-only key entry and profile-owned native work. */
export function createRuntimeAuth(deps: RuntimeAuthDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  const lifetime = runtimeFeatureLifetime(deps.assertCurrent, deps.cancelNative)
  const current = async <T>(work: () => Promise<T>): Promise<T> => {
    lifetime.check()
    const result = await work()
    lifetime.check()
    return result
  }
  const service = new AuthService({
    ...deps,
    backend: {
      ...deps.backend,
      cliSignIn: (isAction) => current(() => deps.backend.cliSignIn(isAction)),
      restartBackend: (isEnding) => current(() => deps.backend.restartBackend(isEnding)),
      logOutCli: () => current(deps.backend.logOutCli),
    },
    promptForApiKey: () => Promise.reject(new Error(UI_TEXT.signInCancelled)),
    runInTerminal: (cli, args) =>
      current(async () => {
        await deps.runInTerminal(cli, args)
      }),
    runInstallerInTerminal: () =>
      current(async () => {
        await deps.runInstallerInTerminal()
      }),
    runDeviceSignIn: (signal, onCode) =>
      current(() =>
        deps.runDeviceSignIn(AbortSignal.any([signal, lifetime.signal]), (url, code) => {
          lifetime.check()
          onCode(url, code)
        }),
      ),
    sleep: async (ms) => {
      await unlessAborted(deps.sleep(ms), lifetime.signal)
      lifetime.check()
    },
    broadcast: (message) => {
      try {
        lifetime.check()
      } catch {
        return
      }
      deps.broadcast(message)
    },
  })
  let keyFlow: AbortController | undefined
  let keyGeneration = 0
  let isSigningOut = false
  let signingIn: Promise<Awaited<ReturnType<AuthPort['signIn']>>> | undefined
  const cancelSignIn = () => {
    keyFlow?.abort()
    service.cancelSignIn()
  }
  const signIn: AuthPort['signIn'] = (method) =>
    lifetime.track(async () => {
      if (isSigningOut) throw new Error(UI_TEXT.signInCancelled)
      if (method !== 'apiKey') return await service.signIn(method)
      if (signingIn !== undefined) return await signingIn
      const flow = new AbortController()
      keyFlow = flow
      keyGeneration += 1
      const epoch = service.admissionGeneration
      const check = () => {
        lifetime.check()
        flow.signal.throwIfAborted()
        if (epoch !== service.admissionGeneration) throw new Error(UI_TEXT.signInCancelled)
      }
      const operation = (async () => {
        // Retire old turns while they still see the old OS-store key.
        await deps.backend.restartBackend(true)
        check()
        const isAccepted = await deps.runKeySignIn(
          AbortSignal.any([flow.signal, lifetime.signal]),
          check,
        )
        check()
        return isAccepted ? await service.checkAgain() : service.current
      })()
      signingIn = operation
      try {
        return await operation
      } finally {
        if (keyFlow === flow) {
          keyFlow = undefined
          keyGeneration += 1
        }
        if (signingIn === operation) signingIn = undefined
      }
    })
  const auth: AuthPort = {
    get current() {
      return service.current
    },
    get backend() {
      return keyFlow === undefined && !isSigningOut ? service.backend : undefined
    },
    get admissionGeneration() {
      return service.admissionGeneration + keyGeneration
    },
    toMessage: () => service.toMessage(),
    signIn,
    installMuseCode: () => lifetime.track(() => service.installMuseCode()),
    cancelSignIn,
    signOut: () =>
      lifetime.track(async () => {
        isSigningOut = true
        keyGeneration += 1
        cancelSignIn()
        try {
          // A cancelled terminal may still be draining; clear the store only after it has exited.
          if (signingIn !== undefined) await Promise.allSettled([signingIn])
          return await service.signOut()
        } finally {
          isSigningOut = false
          keyGeneration += 1
        }
      }),
    refresh: (isAction) => lifetime.track(() => service.refresh(isAction)),
    checkAgain: () => lifetime.track(() => service.checkAgain()),
    markAuthRequired: (reason) => {
      lifetime.check()
      return service.markAuthRequired(reason)
    },
    markBackendError: (detail) => {
      lifetime.check()
      return service.markBackendError(detail)
    },
  }
  let closing: Promise<void> | undefined
  return {
    features: {
      auth,
      ensureHost: () =>
        lifetime.track(async () => {
          if (auth.backend === undefined) throw new Error(UI_TEXT.signInCancelled)
          return await deps.ensureHost()
        }),
      accountFacts: (backend: Parameters<RuntimeAuthDeps['accountFacts']>[0]) =>
        lifetime.track(() => deps.accountFacts(backend)),
    },
    isKeyStored: () => {
      lifetime.check()
      return deps.isKeyStored()
    },
    dispose: () => {
      cancelSignIn()
      closing ??= (async () => {
        const stop = service.stopSignIn()
        try {
          await lifetime.dispose()
          await stop
        } finally {
          await deps.drainNative()
        }
      })()
      return closing
    },
  }
}
