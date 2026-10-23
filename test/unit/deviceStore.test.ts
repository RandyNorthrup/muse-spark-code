import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  confirmDeviceFingerprint,
  createDeviceInvitation,
  validateDevicePair,
} from '../../src/core/devices/pairing'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { DeviceStore, type DeviceStoreState } from '../../src/host/devices/deviceStore'
import { deviceGrant, useDeviceStorageRoot } from './helpers/deviceFixtures'

const NOW = Date.now()
const ENDPOINT = { address: '127.0.0.1', port: 8443 }
const EXPIRES_AT = NOW + 24 * 3600 * 1000

function hexId(value: number): string {
  return value.toString(16).padStart(32, '0')
}

function pairRow(deviceId: string, index: number): DeviceStoreState['pairs'][number] {
  const peerId = hexId(index + 1001)
  const local = createDeviceInvitation(ENDPOINT, deviceId, NOW, EXPIRES_AT)
  const peer = createDeviceInvitation(ENDPOINT, peerId, NOW, EXPIRES_AT)
  const pair = {
    local: local.invitation,
    peer: peer.invitation,
    localConfirmation: confirmDeviceFingerprint(
      local.invitation,
      peer.invitation,
      local.privateKeyPem,
      peer.invitation.fingerprint,
      NOW,
    ),
    peerConfirmation: confirmDeviceFingerprint(
      peer.invitation,
      local.invitation,
      peer.privateKeyPem,
      local.invitation.fingerprint,
      NOW,
    ),
  }
  const pairId = validateDevicePair(pair, NOW, true)
  return {
    pairId,
    pair,
    endpoint: ENDPOINT,
    completedAt: NOW,
    paused: false,
    grants: [deviceGrant(pairId, deviceId)],
  }
}

function distinctGrants(pairId: string, deviceId: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const grant = deviceGrant(pairId, deviceId)
    return {
      ...grant,
      offer: {
        ...grant.offer,
        grantId: hexId(20_000 + index),
        repositoryId: hexId(30_000 + index),
      },
    }
  })
}

describe('M100 device pair store', () => {
  const { fixture, stores } = useDeviceStorageRoot('m100-store-')

  it('creates, reads back and reopens an empty store', async () => {
    const directory = path.join(fixture.parent, 'pairing')
    const deviceId = hexId(7)
    const created = await DeviceStore.create(directory, deviceId, fixture.storage)
    stores.push(created)
    const state = await created.read()
    expect(state.version).toBe(DEVICE_LIMITS.protocolVersion)
    expect(state.deviceId).toBe(deviceId)
    expect(state.discoveryEnabled).toBe(false)
    expect(state.pairs).toEqual([])
    expect(state.pending).toEqual([])
    await created.close()
    const reopened = await DeviceStore.open(directory, fixture.storage)
    stores.push(reopened)
    expect(await reopened.read()).toEqual(state)
  })

  it('persists pairs across update and reopen', async () => {
    const directory = path.join(fixture.parent, 'pairing')
    const store = await DeviceStore.create(directory, hexId(1), fixture.storage)
    stores.push(store)
    const row = pairRow(hexId(1), 0)
    await store.update((current) => ({
      ...current,
      pairs: [row],
      usedInvitationIds: [row.pair.local.invitationId, row.pair.peer.invitationId],
    }))
    const stored = await store.read()
    const pairs = stored.pairs
    expect(pairs).toEqual([row])
    await store.close()
    const reopened = await DeviceStore.open(directory, fixture.storage)
    stores.push(reopened)
    const rereadState = await reopened.read()
    const reread = rereadState.pairs
    expect(reread).toEqual([row])
  })

  it('admits pairs, grants and labels past every removed bound', async () => {
    const directory = path.join(fixture.parent, 'pairing')
    const store = await DeviceStore.create(directory, hexId(1), fixture.storage)
    stores.push(store)
    const pairs = Array.from({ length: 20 }, (_, index) => pairRow(hexId(1), index))
    const many = pairs[0]
    if (many === undefined) throw new Error('missing pair fixture')
    many.grants.push(...distinctGrants(many.pairId, hexId(1), 39))
    await store.update((current) => ({
      ...current,
      pairs,
      usedInvitationIds: pairs.flatMap((row) => [
        row.pair.local.invitationId,
        row.pair.peer.invitationId,
      ]),
    }))
    const state = await store.read()
    expect(state.pairs).toHaveLength(20)
    expect(state.pairs[0]?.grants).toHaveLength(40)
    const fresh = createDeviceInvitation(ENDPOINT, hexId(1), NOW, EXPIRES_AT)
    await store.update((current) => ({
      ...current,
      pending: [
        {
          listenerApplication: 'x'.repeat(100),
          interfaceLabel: 'y'.repeat(100),
          local: fresh.invitation,
        },
      ],
    }))
    const pendingState = await store.read()
    const pending = pendingState.pending
    expect(pending).toHaveLength(1)
  })

  it('keeps revocation memory without bound', async () => {
    const directory = path.join(fixture.parent, 'pairing')
    const store = await DeviceStore.create(directory, hexId(1), fixture.storage)
    stores.push(store)
    const used = Array.from({ length: 70_000 }, (_, index) => hexId(index + 50_000))
    await store.update((current) => ({ ...current, usedInvitationIds: used }))
    const usedState = await store.read()
    const usedIds = usedState.usedInvitationIds
    expect(usedIds).toHaveLength(70_000)
  })

  it('refuses damaged state, existing directories and double opens with storage', async () => {
    const directory = path.join(fixture.parent, 'pairing')
    const store = await DeviceStore.create(directory, hexId(1), fixture.storage)
    stores.push(store)
    await expect(DeviceStore.create(directory, hexId(2), fixture.storage)).rejects.toThrow(
      'storage',
    )
    await expect(DeviceStore.open(directory, fixture.storage)).rejects.toThrow('storage')
    await store.close()
    await writeFile(path.join(directory, 'pairs.json'), '{damaged')
    await expect(DeviceStore.open(directory, fixture.storage)).rejects.toThrow('storage')
    await writeFile(
      path.join(directory, 'pairs.json'),
      JSON.stringify({
        version: DEVICE_LIMITS.protocolVersion,
        deviceId: hexId(1),
        discoveryEnabled: false,
        pending: [],
        pairs: [],
        usedInvitationIds: [],
        revokedPairIds: [],
        revokedKeys: [],
      }),
    )
    await writeFile(path.join(directory, 'pairs.json.stage'), '{}')
    await expect(DeviceStore.open(directory, fixture.storage)).rejects.toThrow('storage')
  })

  it('releases the lock on close', async () => {
    const directory = path.join(fixture.parent, 'pairing')
    const store = await DeviceStore.create(directory, hexId(1), fixture.storage)
    stores.push(store)
    await store.close()
    const reopened = await DeviceStore.open(directory, fixture.storage)
    stores.push(reopened)
    const reread = await reopened.read()
    expect(reread.deviceId).toBe(hexId(1))
  })
})
