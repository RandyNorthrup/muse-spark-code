// M100 extends authenticated offers with this M108 field. A peer learns only
// per-provider headroom, never account ids, labels, groups or confirmations.
import * as z from 'zod/mini'
import { accountIdSchema } from './accounts'

export const accountHeadroomSchema = z.enum(['ample', 'some', 'none'])
export const deviceAccountHeadroomSchema = z.record(accountIdSchema, accountHeadroomSchema)
