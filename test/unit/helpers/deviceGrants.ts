// The grant harness the paired-device suites share: stable test ids, a
// parsed grant request, a parsed admission grant and a receiver action
// state over them. Suites differ only in the local action, the role
// tools and the grant's checks, revision and step-up flag, which the
// callers pass in.
import { DEVICE_LIMITS } from '../../../src/shared/constants'
import {
  deviceGrantRequestSchema,
  deviceGrantSchema,
  type DeviceGrant,
  type DeviceGrantRequest,
} from '../../../src/shared/devices'
import type {
  DeviceLocalAction,
  DeviceReceiverActionState,
} from '../../../src/core/devices/actionGrants'
import { deviceCaps } from './deviceFixtures'

export const GRANT_HARNESS_IDS = {
  pairId: 'a'.repeat(32),
  ownerId: 'b'.repeat(32),
  roleId: 'c'.repeat(32),
  repositoryId: 'd'.repeat(32),
  grantId: 'e'.repeat(32),
  requestId: 'f'.repeat(32),
} as const

export function harnessGrantRequest(): DeviceGrantRequest {
  return deviceGrantRequestSchema.parse({
    version: DEVICE_LIMITS.protocolVersion,
    pairId: GRANT_HARNESS_IDS.pairId,
    ownerId: GRANT_HARNESS_IDS.ownerId,
    roleId: GRANT_HARNESS_IDS.roleId,
    mode: 'manual',
    repositoryId: GRANT_HARNESS_IDS.repositoryId,
    lanes: true,
    checks: false,
    quota: deviceCaps,
  })
}

export function harnessAdmissionGrant(options: {
  requiresStepUp: boolean
  checks: boolean
  grantRevision?: number
}): DeviceGrant {
  const issuedAt = Date.now()
  return deviceGrantSchema.parse({
    version: DEVICE_LIMITS.protocolVersion,
    grantId: GRANT_HARNESS_IDS.grantId,
    ...(options.grantRevision !== undefined && { grantRevision: options.grantRevision }),
    pairId: GRANT_HARNESS_IDS.pairId,
    ownerId: GRANT_HARNESS_IDS.ownerId,
    roleId: GRANT_HARNESS_IDS.roleId,
    mode: 'manual',
    repositoryId: GRANT_HARNESS_IDS.repositoryId,
    lanes: true,
    checks: options.checks,
    issuedAt,
    expiresAt: issuedAt + DEVICE_LIMITS.grantValidityMs - 1,
    requiresStepUp: options.requiresStepUp,
    quota: deviceCaps,
  })
}

export function harnessReceiverState(
  local: DeviceLocalAction,
  tools: string[],
  grant: { requiresStepUp: boolean; checks: boolean; grantRevision?: number },
): DeviceReceiverActionState {
  return {
    grant: harnessAdmissionGrant(grant),
    revoked: false,
    repository: harnessGrantRequest(),
    role: { mode: 'manual', quota: deviceCaps, roleId: GRANT_HARNESS_IDS.roleId, tools },
    trusted: true,
    protectedPaths: [],
    approval: { mode: 'manual', quota: deviceCaps, allowed: true },
    used: { workers: 0, processes: 0, heavyChecks: 0, tokens: 0, spendUsd: 0, artifactBytes: 0 },
    action: local,
  }
}
