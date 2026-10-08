import { vi } from 'vitest'
import { DEVICE_LIMITS } from '../../../src/shared/constants'
import {
  DeviceActionGrants,
  type DeviceLocalAction,
  type DeviceReceiverActionState,
} from '../../../src/core/devices/actionGrants'
import { type DeviceGrantRequest, deviceGrantRequestSchema } from '../../../src/shared/devices'
import { deviceCaps } from './deviceFixtures'

export function actionGrantFixture() {
  const request: DeviceGrantRequest = deviceGrantRequestSchema.parse({
    version: DEVICE_LIMITS.protocolVersion,
    pairId: 'b'.repeat(DEVICE_LIMITS.idChars),
    ownerId: 'c'.repeat(DEVICE_LIMITS.idChars),
    roleId: '7'.repeat(DEVICE_LIMITS.idChars),
    repositoryId: '3'.repeat(DEVICE_LIMITS.idChars),
    mode: 'manual',
    lanes: true,
    checks: false,
    quota: { ...deviceCaps },
  })
  let now: number = DEVICE_LIMITS.stepUpValidityMs
  const action: DeviceLocalAction = {
    operation: 'write',
    tool: 'edit',
    paths: ['src/main.ts'],
    payload: new TextEncoder().encode('exact fake action'),
  }
  const state = {
    grant: {
      ...request,
      grantId: '4'.repeat(DEVICE_LIMITS.idChars),
      grantRevision: 1,
      issuedAt: now - 1,
      expiresAt: now + DEVICE_LIMITS.grantValidityMs - 1,
      requiresStepUp: false,
    },
    revoked: false,
    repository: { ...request, quota: { ...deviceCaps } },
    role: { roleId: request.roleId, mode: request.mode, quota: { ...deviceCaps }, tools: ['edit'] },
    trusted: true,
    protectedPaths: ['.git', '.env'],
    approval: { mode: request.mode, quota: { ...deviceCaps }, allowed: true },
    used: { workers: 0, processes: 0, heavyChecks: 0, tokens: 0, spendUsd: 0, artifactBytes: 0 },
    action,
  }
  const presence = { confirm: vi.fn(() => Promise.resolve(true)) }
  const senderCeiling = vi.fn(() => ({ mode: request.mode, quota: { ...deviceCaps } }))
  const current = vi.fn((): DeviceReceiverActionState => state)
  const grants = new DeviceActionGrants({ senderCeiling, current, presence, now: () => now })
  return {
    request,
    state,
    grants,
    current,
    senderCeiling,
    presence,
    setNow: (value: number) => {
      now = value
    },
  }
}
