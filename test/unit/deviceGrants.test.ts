import { describe, expect, it } from 'vitest'
import { assertDeviceGrant } from '../../src/core/devices/grants'
import { deviceGrant, deviceCheck, deviceLane, deviceCaps } from './helpers/deviceFixtures'

describe('receiver-local device grants', () => {
  it('allows only the approved exact check/snapshot or ready canonical role/model entry', () => {
    const grant = deviceGrant('0'.repeat(32))
    expect(assertDeviceGrant(grant, deviceCheck(grant))).toEqual(deviceCaps)
    expect(assertDeviceGrant(grant, deviceLane(grant))).toEqual(deviceCaps)
    const reordered = {
      ...deviceCheck(grant),
      caps: {
        artifactBytes: 100,
        spendUsd: 1,
        tokens: 100,
        heavyChecks: 1,
        processes: 2,
        workers: 2,
      },
    }
    expect(assertDeviceGrant(grant, reordered)).toEqual(deviceCaps)
  })
  it.each([
    'pairId',
    'receiverIncarnationId',
    'repositoryId',
    'grantId',
    'grantRevision',
    'mode',
    'baseCommit',
    'tree',
    'manifestDigest',
    'dirtyPreviewDigest',
    'checkId',
    'toolchainDigest',
  ])('refuses a changed %s on an already authenticated connection', (field) => {
    const grant = deviceGrant('0'.repeat(32))
    const request = deviceCheck(grant)
    switch (field) {
      case 'pairId': {
        request.identity.pairId = '1'.repeat(32)
        break
      }
      case 'receiverIncarnationId': {
        request.identity.receiverIncarnationId = '2'.repeat(32)
        break
      }
      case 'repositoryId': {
        request.repositoryId = '2'.repeat(32)
        break
      }
      case 'grantId': {
        request.grantId = '2'.repeat(32)
        break
      }
      case 'grantRevision': {
        request.grantRevision = 2
        break
      }
      case 'mode': {
        request.mode = 'auto'
        break
      }
      case 'baseCommit': {
        request.snapshot = { ...request.snapshot, baseCommit: '2'.repeat(40) }
        break
      }
      case 'tree': {
        request.snapshot = { ...request.snapshot, tree: '2'.repeat(40) }
        break
      }
      case 'manifestDigest': {
        request.snapshot = { ...request.snapshot, manifestDigest: '2'.repeat(64) }
        break
      }
      case 'dirtyPreviewDigest': {
        request.snapshot = { ...request.snapshot, dirtyPreviewDigest: '2'.repeat(64) }
        break
      }
      case 'checkId': {
        if (request.kind === 'check') request.checkId = '2'.repeat(32)
        break
      }
      case 'toolchainDigest': {
        if (request.kind === 'check') request.toolchainDigest = '2'.repeat(64)
        break
      }
    }
    expect(() => assertDeviceGrant(grant, request)).toThrow('grant')
  })
  it.each(['device', 'pool', 'entry', 'role', 'provider', 'model', 'readiness', 'lanes', 'checks'])(
    'refuses a changed or missing %s authority',
    (field) => {
      const grant = deviceGrant('0'.repeat(32))
      const request = deviceLane(grant)
      if (request.kind !== 'lane') throw new Error('Missing lane fixture')
      switch (field) {
        case 'device': {
          request.route.deviceId = '2'.repeat(32)
          break
        }
        case 'pool': {
          request.route.poolId = '3'.repeat(32)
          break
        }
        case 'entry': {
          request.route.entryId = '4'.repeat(32)
          break
        }
        case 'role': {
          request.roleId = '5'.repeat(32)
          break
        }
        case 'provider': {
          request.route.model = { ...request.route.model, providerId: 'other' }
          break
        }
        case 'model': {
          request.route.model = { ...request.route.model, modelId: 'other' }
          break
        }
        case 'readiness': {
          grant.offer.entries[0]!.readiness = 'unknown'
          break
        }
        case 'lanes': {
          grant.offer.lanes = false
          grant.offer.entries = []
          break
        }
        case 'checks': {
          grant.offer.checks = false
          grant.offer.checkIds = []
          expect(() => assertDeviceGrant(grant, deviceCheck(deviceGrant(grant.pairId)))).toThrow(
            'grant',
          )
          return
        }
      }
      expect(() => assertDeviceGrant(grant, request)).toThrow('grant')
    },
  )
  it.each(['workers', 'processes', 'heavyChecks', 'tokens', 'spendUsd', 'artifactBytes'] as const)(
    'never exceeds the receiver %s cap',
    (key) => {
      const grant = deviceGrant('0'.repeat(32))
      const request = deviceCheck(grant)
      request.caps = { ...request.caps, [key]: request.caps[key] + 1 }
      expect(() => assertDeviceGrant(grant, request)).toThrow('capacity')
      const lane = deviceLane(grant)
      grant.offer.entries[0]!.caps = { ...deviceCaps, [key]: 0 }
      expect(() => assertDeviceGrant(grant, lane)).toThrow('capacity')
    },
  )
  it('rejects missing grants and unrecognized provider/command/permission payload fields', () => {
    const grant = deviceGrant('0'.repeat(32))
    expect(() => assertDeviceGrant(undefined, deviceCheck(grant))).toThrow('grant')
    expect(() =>
      assertDeviceGrant({ ...grant, command: 'must never run' }, deviceCheck(grant)),
    ).toThrow('grant')
    const forged = { ...deviceCheck(grant), paidApproval: true }
    expect(() => assertDeviceGrant(grant, forged)).toThrow('grant')
  })
})
