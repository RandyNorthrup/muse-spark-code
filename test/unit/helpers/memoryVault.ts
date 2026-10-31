import type {
  AccountBinding,
  AccountCredential,
  AccountCredentialVault,
} from '../../../src/core/providers/accountCredentialRecord'

function vaultKey(binding: AccountBinding): string {
  return `${binding.provider} ${binding.account}`
}

/** A real in-memory credential vault: it stores, it does not script. */
export function memoryVault(): AccountCredentialVault & { size(): number } {
  const kept = new Map<string, AccountCredential>()
  return {
    read: (binding) => Promise.resolve(kept.get(vaultKey(binding))),
    readForRemoval: (binding) => Promise.resolve(kept.get(vaultKey(binding))),
    write: (binding, value) => {
      kept.set(vaultKey(binding), value)
      return Promise.resolve()
    },
    remove: (binding) => {
      kept.delete(vaultKey(binding))
      return Promise.resolve()
    },
    size: () => kept.size,
  }
}
