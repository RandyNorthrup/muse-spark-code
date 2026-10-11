// M108 K: local secret records, never a vendor wire shape. M95's transport
// must check this binding before sending a credential; M109 supplies the vault.
import * as z from 'zod/mini'
import { accountIdSchema } from '../../shared/accounts'
import { ACCOUNT_DEFAULT_ID, SECRET_KEYS } from '../../shared/constants'

export const accountBindingSchema = z.strictObject({
  provider: accountIdSchema,
  account: accountIdSchema,
  origin: z.url().check(
    z.refine((value) => {
      try {
        const url = new URL(value)
        return (
          (url.protocol === 'https:' || url.protocol === 'http:') &&
          url.origin === value &&
          url.username === '' &&
          url.password === ''
        )
      } catch {
        return false
      }
    }),
  ),
})
export type AccountBinding = z.infer<typeof accountBindingSchema>

export const credentialRecordSchema = z.strictObject({
  ...accountBindingSchema.shape,
  v: z.literal(1),
  auth: z.enum(['apiKey', 'oauth', 'subscription']),
  secret: z.string().check(z.minLength(1)),
})
export type AccountCredential = z.infer<typeof credentialRecordSchema>

/** Account-credential port; M109's concrete vault binding is integration-owned. */
export interface AccountCredentialVault {
  read(binding: AccountBinding): Promise<AccountCredential | undefined>
  /** Local cleanup/rebinding only. Retains the stored origin; never authorizes dispatch. */
  readForRemoval(binding: AccountBinding): Promise<AccountCredential | undefined>
  write(binding: AccountBinding, record: AccountCredential): Promise<void>
  remove(binding: AccountBinding): Promise<void>
}

export class AccountStoreError extends Error {
  public constructor(
    public readonly code:
      'invalidAccount' | 'notOffered' | 'unavailable' | 'invalidCredential' | 'originMismatch',
  ) {
    // Fixed codes only: store/revocation errors can contain the secret itself.
    super(code)
    this.name = 'AccountStoreError'
  }
}

/** Validate both identity and exact origin, including scheme and port. */
export function boundCredential(value: unknown, binding: AccountBinding): AccountCredential {
  const parsed = credentialRecordSchema.safeParse(value)
  if (!parsed.success) throw new AccountStoreError('invalidCredential')
  const record = parsed.data
  if (
    record.provider !== binding.provider ||
    record.account !== binding.account ||
    record.origin !== binding.origin
  ) {
    throw new AccountStoreError('originMismatch')
  }
  return record
}

/** Preserve every existing default entry; Meta keeps rule 8's original key. */
export function accountSecretKey(provider: string, account = ACCOUNT_DEFAULT_ID): string {
  accountIdSchema.parse(provider)
  accountIdSchema.parse(account)
  if (provider === 'meta' && account === ACCOUNT_DEFAULT_ID) return SECRET_KEYS.modelApiKey
  const legacy = `museSpark.provider.${provider}`
  return account === ACCOUNT_DEFAULT_ID ? legacy : `${legacy}.account.${account}`
}
