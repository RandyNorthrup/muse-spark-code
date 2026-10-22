// Identity rotation with overlap (M110d lane X2, D90.9): while a rotation
// is open, both the old and the new pin are accepted, so a device that has
// not heard yet keeps working. There is no timer of ours: the person
// completes the rotation when every device holds the new pin, and only
// then does the old pin stop working.
import * as z from 'zod/mini'

export const rotationSchema = z.union([
  z.strictObject({ state: z.literal('current'), pin: z.string().check(z.minLength(1)) }),
  z.strictObject({
    state: z.literal('rotating'),
    oldPin: z.string().check(z.minLength(1)),
    newPin: z.string().check(z.minLength(1)),
  }),
])
export type IdentityRotation = z.infer<typeof rotationSchema>

export function beginRotation(currentPin: string, newPin: string): IdentityRotation {
  if (currentPin.length === 0 || newPin.length === 0)
    throw new Error('rotation needs the current pin and the new pin')
  if (currentPin === newPin) throw new Error('rotation needs a different pin')
  return rotationSchema.parse({ state: 'rotating', oldPin: currentPin, newPin })
}

export function completeRotation(rotation: IdentityRotation): IdentityRotation {
  const parsed = rotationSchema.parse(rotation)
  if (parsed.state !== 'rotating') throw new Error('no rotation is open')
  return { state: 'current', pin: parsed.newPin }
}

export function isPinAccepted(rotation: IdentityRotation, pin: string): boolean {
  const parsed = rotationSchema.parse(rotation)
  return parsed.state === 'current'
    ? parsed.pin === pin
    : parsed.oldPin === pin || parsed.newPin === pin
}
