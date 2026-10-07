// Activation imports this shim only. W supplies the lazy dist/vault.js factory;
// no service, schema, broker, native entry or status item loads before first use.
import { type Disposable } from 'vscode'

export const VAULT_COMMANDS = { open: 'museSpark.vault', lock: 'museSpark.lockVault' } as const
export const VAULT_LOCK_KEYBINDING = {
  command: VAULT_COMMANDS.lock,
  key: 'ctrl+alt+shift+l',
  mac: 'cmd+alt+shift+l',
} as const
export interface VaultWindowControls {
  open(): Promise<void>
  lock(): Promise<void>
  dispose(): void
}
/** Both commands remain available even before the vault has an item. */
export function registerVaultCommands(
  register: (id: string, action: () => Promise<void>) => Disposable,
  load: () => VaultWindowControls,
): Disposable {
  let controls: VaultWindowControls | undefined
  const current = () => {
    controls ??= load()
    return controls
  }
  const commands = [
    register(VAULT_COMMANDS.open, async () => {
      await current().open()
    }),
    register(VAULT_COMMANDS.lock, async () => {
      await current().lock()
    }),
  ]
  return {
    dispose: () => {
      for (const command of commands) command.dispose()
      controls?.dispose()
    },
  }
}
