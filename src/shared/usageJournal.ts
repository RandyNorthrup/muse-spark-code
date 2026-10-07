// M102 extends its record schemas with these fields once its journal lands.
// Absence denotes a pre-M108 record; the reader resolves it to `default`.
import * as z from 'zod/mini'
import { accountIdSchema } from './accounts'

export const usageAccountFields = { account: z.optional(accountIdSchema) }
