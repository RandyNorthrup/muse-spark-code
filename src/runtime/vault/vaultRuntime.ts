import path from 'node:path'
import { UI_TEXT } from '../../shared/constants'
import type { VaultCommandPort } from './vaultCommand'
import type { ExecVaultPort } from './execVault'
import { uiLocale } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import type { AcpVault } from '../../acp/vault'

/** W binds this factory to B/C/P/U/X in the planned installed lazy vault bundle. */
export interface RuntimeVaultBinding {
  commands(): Promise<VaultCommandPort>
  exec: ExecVaultPort
}
export interface RuntimeVaultContext {
  readonly uiText: UiText
  readonly locale: string
  readonly dataDir: string
  readonly distDir: string
  readonly processId: number
  readonly acp: AcpVault
}
interface RuntimeVaultModule {
  createRuntimeVault(context: RuntimeVaultContext): Promise<RuntimeVaultBinding>
}

/** Lazy, typed integration seam. A missing bundle is an explicit failure, never an empty vault. */
export function runtimeVaultLoader(
  context: Omit<RuntimeVaultContext, 'uiText' | 'locale'>,
  load: (file: string) => unknown = require,
): () => Promise<RuntimeVaultBinding> {
  let loading: Promise<RuntimeVaultBinding> | undefined
  return async () => {
    loading ??= (async () => {
      try {
        // The installed lazy module's function signature is the W/H build contract; runtime checks reject missing exports (PLAN §8).
        const module = load(path.join(context.distDir, 'vault.js')) as Partial<RuntimeVaultModule>
        if (typeof module.createRuntimeVault !== 'function')
          throw new Error(UI_TEXT.vault.brokerBlocked)
        const binding = await module.createRuntimeVault({
          ...context,
          uiText: UI_TEXT,
          locale: uiLocale(),
        })
        if (typeof binding.commands !== 'function' || typeof binding.exec.open !== 'function')
          throw new Error(UI_TEXT.vault.brokerBlocked)
        return binding
      } catch {
        throw new Error(UI_TEXT.vault.brokerBlocked)
      }
    })()
    const pending = loading
    try {
      return await pending
    } catch (error: unknown) {
      if (loading === pending) loading = undefined
      throw error
    }
  }
}
