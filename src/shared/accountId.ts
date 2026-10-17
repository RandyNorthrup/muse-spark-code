// The account id contract alone (INT0170): usage records name an account, and a
// bundle that validates them needs no M108 pool, trigger or event schemas.
import * as z from 'zod/mini'
import { ACCOUNT_ID_PATTERN } from './constants'

export const accountIdSchema = z.string().check(z.regex(ACCOUNT_ID_PATTERN))
