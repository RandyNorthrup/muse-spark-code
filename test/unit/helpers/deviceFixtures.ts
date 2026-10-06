import { rm } from 'node:fs/promises'
import type { DeviceStore } from '../../../src/host/devices/deviceStore'
import { DEVICE_LIMITS } from '../../../src/shared/constants'
import type { DeviceGrant } from '../../../src/core/devices/grants'
import type { DeviceDispatch } from '../../../src/shared/devices'

export const deviceCaps = {
  workers: 2,
  processes: 2,
  heavyChecks: 1,
  tokens: 100,
  spendUsd: 1,
  artifactBytes: 100,
}
export function deviceGrant(pairId: string, deviceId = 'a'.repeat(32)): DeviceGrant {
  return {
    pairId,
    offer: {
      deviceId,
      receiverIncarnationId: '1'.repeat(32),
      poolId: '2'.repeat(32),
      repositoryId: '3'.repeat(32),
      grantId: '4'.repeat(32),
      grantRevision: 1,
      platform: 'linux',
      toolchainDigest: '5'.repeat(64),
      lanes: true,
      checks: true,
      caps: deviceCaps,
      entries: [
        {
          entryId: '6'.repeat(32),
          roleId: '7'.repeat(32),
          model: { providerId: 'meta', modelId: 'muse-spark-1.3' },
          capabilities: {
            vision: false,
            tools: true,
            structuredOutput: false,
            hostedSearch: false,
            reasoningEffort: false,
          },
          readiness: 'ready',
          payer: 'apiKey',
          caps: deviceCaps,
        },
      ],
      checkIds: ['8'.repeat(32)],
    },
    snapshot: { baseCommit: '9'.repeat(40), tree: 'a'.repeat(40), manifestDigest: 'b'.repeat(64) },
    modes: ['manual'],
  }
}
export function deviceCheck(grant: DeviceGrant): DeviceDispatch {
  return {
    kind: 'check',
    identity: {
      pairId: grant.pairId,
      receiverIncarnationId: grant.offer.receiverIncarnationId,
      boardId: 'c'.repeat(32),
      taskId: 'd'.repeat(32),
      attemptId: 'e'.repeat(32),
    },
    payloadDigest: 'f'.repeat(64),
    repositoryId: grant.offer.repositoryId,
    grantId: grant.offer.grantId,
    grantRevision: grant.offer.grantRevision,
    snapshot: grant.snapshot,
    caps: deviceCaps,
    mode: 'manual',
    checkId: grant.offer.checkIds[0]!,
    toolchainDigest: grant.offer.toolchainDigest,
  }
}
export function deviceLane(grant: DeviceGrant): DeviceDispatch {
  const entry = grant.offer.entries[0]!
  const check = deviceCheck(grant)
  return {
    kind: 'lane',
    identity: check.identity,
    payloadDigest: check.payloadDigest,
    repositoryId: check.repositoryId,
    grantId: check.grantId,
    grantRevision: check.grantRevision,
    snapshot: check.snapshot,
    caps: check.caps,
    mode: check.mode,
    route: {
      pairId: grant.pairId,
      deviceId: grant.offer.deviceId,
      receiverIncarnationId: grant.offer.receiverIncarnationId,
      poolId: grant.offer.poolId,
      entryId: entry.entryId,
      model: entry.model,
    },
    roleId: entry.roleId,
    isolation: 'own-branch',
    brief: 'Bounded fake-only task',
    plannedWrites: [],
  }
}
export const deviceTestNow = Date.UTC(2026, 9, 6)
export const deviceTestExpiry = deviceTestNow + DEVICE_LIMITS.invitationValidityMs * 100

export async function removeDeviceFixture(stores: DeviceStore[], parent: string): Promise<void> {
  for (const store of stores.splice(0)) {
    try {
      await store.close()
    } catch {
      continue
    }
  }
  await rm(parent, { recursive: true, force: true })
}
