import * as z from 'zod/mini'

// The slot's authenticated identity, shared by every platform slot (C
// supplies it; P binds the wrap/unwrap to it). One schema, so macOS and
// Windows cannot drift on what an identity is.

const slotId = z.string().check(z.regex(/^[a-f0-9]{32}$/u))

export const slotIdentitySchema = z.strictObject({
  slotId,
  vaultId: slotId,
  tier: z.enum(['osStore', 'hardware', 'presence']),
})
export type SlotIdentity = z.infer<typeof slotIdentitySchema>
