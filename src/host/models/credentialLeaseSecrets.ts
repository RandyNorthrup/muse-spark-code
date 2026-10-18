// The panel's secrets inside the one credential lease (M95 D74): every
// provider-credential write or removal the panel performs (wizard save,
// removal finish, Connect) runs through this store, so holding the same
// lease the terminal Connect transaction holds excludes it. Reads stay
// direct: a reader never fails on a live writer's lease. A held lease
// refuses with the retry sentence instead of the lock path. The panel's
// bundle carries this factory (loaded on its first action); the lease
// itself loads on the first guarded write. Kept beside the panel, without
// any editor import, so the unit tests exercise the real guard.
import { UI_TEXT } from '../../shared/constants'
import type { SecretStore } from '../auth/credentialStore'

export function credentialLeaseSecrets(secrets: SecretStore, lockDir?: string): SecretStore {
  let dir: string | undefined = lockDir
  const guarded = async (run: () => PromiseLike<void>): Promise<void> => {
    // The lease's bundle loads on the first guarded write; the module
    // cache makes later writes free.
    const lease = await import('../../core/credentialLeaseEntry')
    dir ??= lease.credentialLeaseDir()
    try {
      await lease.withCredentialLock(dir, () => Promise.resolve(run()))
    } catch (error: unknown) {
      if (error instanceof lease.CredentialLockBusyError)
        throw new Error(UI_TEXT.providerConnectBusy, { cause: error })
      throw error
    }
  }
  return {
    get: (key) => secrets.get(key),
    store: (key, value) => guarded(() => secrets.store(key, value)),
    delete: (key) => guarded(() => secrets.delete(key)),
  }
}
