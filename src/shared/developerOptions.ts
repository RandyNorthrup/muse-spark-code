// Local contracts, never vendor wire shapes. The host owns machine identity,
// dates, resource paths and confirmations; pages cannot supply any of them.
import * as z from 'zod/mini'
import { accountIdSchema } from './accounts'
import { DEVELOPER_MAX_PROFILES, DEVELOPER_UNLOCK_MS } from './constants'

export const developerProfileSchema = z.strictObject({
  id: accountIdSchema,
  provider: accountIdSchema,
  account: accountIdSchema,
})
export type DeveloperProfile = z.infer<typeof developerProfileSchema>
const profiles = z.array(developerProfileSchema).check(
  z.maxLength(DEVELOPER_MAX_PROFILES),
  z.refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length),
  z.refine(
    (rows) =>
      new Set(rows.map((row) => JSON.stringify([row.provider, row.account]))).size === rows.length,
  ),
)
const timestamp = z.int().check(z.nonnegative())
export const developerStateSchema = z
  .strictObject({
    v: z.literal(1),
    machineId: z.string().check(z.minLength(1), z.maxLength(100), z.regex(/^[a-zA-Z0-9_-]+$/)),
    unlockedAt: z.nullable(timestamp),
    expiresAt: z.nullable(timestamp),
    isMultipleAccountsOn: z.boolean(),
    profiles,
  })
  .check(
    z.refine((state) =>
      state.unlockedAt === null
        ? state.expiresAt === null && !state.isMultipleAccountsOn
        : state.expiresAt !== null &&
          state.expiresAt > state.unlockedAt &&
          state.expiresAt - state.unlockedAt <= DEVELOPER_UNLOCK_MS,
    ),
  )
export type DeveloperState = z.infer<typeof developerStateSchema>

export const developerSnapshotSchema = z
  .strictObject({
    type: z.literal('developer/state'),
    isUnlocked: z.boolean(),
    isMultipleAccountsOn: z.boolean(),
    expiresAt: z.nullable(timestamp),
    profiles,
  })
  .check(z.refine((state) => !state.isMultipleAccountsOn || state.isUnlocked))
export type DeveloperSnapshot = z.infer<typeof developerSnapshotSchema>

export const developerRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('developer/read') }),
  z.strictObject({ type: z.literal('developer/versionClick') }),
  z.strictObject({ type: z.literal('developer/unlock') }),
  z.strictObject({ type: z.literal('developer/setMultiple'), enabled: z.boolean() }),
  z.strictObject({
    type: z.literal('developer/addProfile'),
    provider: accountIdSchema,
    account: accountIdSchema,
  }),
  z.strictObject({ type: z.literal('developer/removeProfile'), id: accountIdSchema }),
  z.strictObject({ type: z.literal('developer/reset') }),
])
export type DeveloperRequest = z.infer<typeof developerRequestSchema>
export const developerReplySchema = z.union([
  developerSnapshotSchema,
  z.strictObject({
    type: z.literal('developer/error'),
    code: z.enum(['locked', 'unavailable', 'invalidRequest', 'differentMachine']),
  }),
])
export type DeveloperReply = z.infer<typeof developerReplySchema>
export const developerAuditSchema = z.strictObject({
  v: z.literal(1),
  time: timestamp,
  action: z.enum(['unlock', 'enable', 'disable', 'expire', 'reset', 'create', 'remove', 'migrate']),
  source: z.enum(['version', 'palette', 'terminal', 'page', 'setting', 'lifecycle']),
  profile: z.optional(accountIdSchema),
})
export type DeveloperAudit = z.infer<typeof developerAuditSchema>
