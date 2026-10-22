// M100 phase 2 (lane U): the public invite text the QR encodes, byte for
// byte. Lane D owns the real `encodeQrInviteText`; it is not on this base,
// so this fake stands in for its text contract: the canonical JSON of the
// public invitation. It takes the typed invitation, so no private-key field
// can reach it; the strict schema below refuses a planted secret.
import { deviceInvitationSchema, type DeviceInvitation } from '../../../../../shared/devices'

export function fakeQrInviteText(invitation: DeviceInvitation): string {
  return JSON.stringify(invitation)
}

export function parsePublicInviteText(text: string): DeviceInvitation | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
  const parsed = deviceInvitationSchema.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}
