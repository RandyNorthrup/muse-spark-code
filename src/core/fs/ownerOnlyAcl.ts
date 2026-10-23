// One owner-only Windows DACL rule for every adapter that reads a security
// descriptor: the IDE token file (PowerShell receipt) and Devices storage
// (native helper receipt) map their readings onto this shape.

export interface OwnerOnlyAclRule {
  readonly sid: string
  readonly inherited: boolean
  readonly allow: boolean
  readonly fullControl: boolean
}
export interface OwnerOnlyAclReading {
  readonly ownerSid: string
  readonly currentSid: string
  /** The DACL refuses inheritance from the parent. */
  readonly protected: boolean
  readonly rules: readonly OwnerOnlyAclRule[]
}

/** Owned by the current user, protected, and every rule grants only that user. */
export function isOwnerOnlyAcl(reading: OwnerOnlyAclReading): boolean {
  return (
    reading.protected &&
    reading.ownerSid === reading.currentSid &&
    reading.rules.length > 0 &&
    reading.rules.every(
      (rule) =>
        rule.sid === reading.currentSid && !rule.inherited && rule.allow && rule.fullControl,
    )
  )
}
