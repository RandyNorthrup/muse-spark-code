// A second Meta key uses rule 8's existing password flow. No key enters a
// postMessage request or a child process; the injected prompt is host-owned.
import type { AccountStore } from '../../core/providers/accounts'
import { AccountStoreError } from '../../core/providers/credentialRecord'
import { MODEL_API_BASE_URL } from '../../shared/constants'
import { isValidModelApiKey } from './credentialStore'

export async function promptForMetaAccountKey(
  accounts: AccountStore,
  account: string,
  promptForApiKey: () => Promise<string | undefined>,
): Promise<'stored' | 'cancelled'> {
  const candidate = await promptForApiKey()
  if (candidate === undefined) return 'cancelled'
  const secret = candidate.trim()
  if (!isValidModelApiKey(secret)) throw new AccountStoreError('invalidCredential')
  await accounts.setCredential('meta', account, {
    v: 1,
    provider: 'meta',
    account,
    origin: new URL(MODEL_API_BASE_URL).origin,
    auth: 'apiKey',
    secret,
  })
  return 'stored'
}
