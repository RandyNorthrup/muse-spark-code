// Only M108's accounts field. M95 owns the providers-file envelope and I/O.
import * as z from 'zod/mini'
import { accountSchema } from '../../shared/accounts'
import { ACCOUNT_MAX_PER_PROVIDER } from '../../shared/constants'

export const providersAccountsSchema = z.array(accountSchema).check(
  z.maxLength(ACCOUNT_MAX_PER_PROVIDER),
  z.refine((accounts) => new Set(accounts.map((account) => account.id)).size === accounts.length),
)
