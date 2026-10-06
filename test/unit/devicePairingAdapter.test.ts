import { mkdtemp, readFile, writeFile, open, rename, realpath } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import type * as FileSystem from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevicePairing } from '../../src/host/devices/devicePairing'
import { DeviceStore, type DeviceStorageProtection } from '../../src/host/devices/deviceStore'
import { DeviceSecrets, type DeviceExecutionHost } from '../../src/host/devices/deviceSecrets'
import type { DeviceWebviewRequest } from '../../src/shared/modelsPanel'
import type { DeviceInvitation } from '../../src/shared/devices'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import {
  deviceGrant,
  deviceCheck,
  deviceTestNow,
  deviceTestExpiry,
  removeDeviceFixture,
} from './helpers/deviceFixtures'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>()
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) }
})
const localHost: DeviceExecutionHost = {
  ui: 'desktop',
  remoteName: undefined,
  execution: 'local',
  secretLocation: 'execution-host',
}
const fixture = { parent: '' }
const stores: DeviceStore[] = []
beforeEach(async () => {
  fixture.parent = await realpath(await mkdtemp(path.join(tmpdir(), 'm100-p-adapter-')))
})
afterEach(async () => {
  await removeDeviceFixture(stores, fixture.parent)
})
async function harness(id: string, host = localHost, protection?: DeviceStorageProtection) {
  const directory = path.join(fixture.parent, id)
  const store = await DeviceStore.create(directory, id.repeat(32), protection)
  stores.push(store)
  const values = new Map<string, string>()
  const secretStore = {
    get: vi.fn((key: string) => Promise.resolve(values.get(key))),
    store: vi.fn((key: string, value: string) => {
      values.set(key, value)
      return Promise.resolve()
    }),
    delete: vi.fn((key: string) => {
      values.delete(key)
      return Promise.resolve()
    }),
  }
  const secrets = new DeviceSecrets(secretStore, host)
  const disconnectPair = vi.fn<(pairId: string) => void>()
  const otherAction = vi.fn((request: DeviceWebviewRequest) =>
    Promise.resolve({
      viewId: request.viewId,
      requestId: request.requestId,
      failure: 'grant' as const,
    }),
  )
  let now = deviceTestNow
  const adapter = new DevicePairing({
    store,
    secrets,
    host,
    now: () => now,
    receiverIncarnationId: '1'.repeat(32),
    setup: () =>
      Promise.resolve({
        endpoint: { address: '127.0.0.1', port: 34_567 },
        certificateExpiresAt: deviceTestExpiry,
        listenerApplication: 'node',
        interfaceLabel: 'lo',
      }),
    disconnectPair,
    otherAction,
  })
  const act = (action: DeviceWebviewRequest['action']) =>
    adapter.handle({
      type: 'deviceRequest',
      viewId: '9'.repeat(32),
      requestId: 'f'.repeat(32),
      revision: 0,
      action,
    })
  return {
    adapter,
    act,
    store,
    secrets,
    secretStore,
    values,
    directory,
    disconnectPair,
    otherAction,
    advance: (time: number) => {
      now = time
    },
  }
}
async function invitation(host: Awaited<ReturnType<typeof harness>>): Promise<DeviceInvitation> {
  const setup = await host.act({ kind: 'pair' })
  expect(setup.failure).toBeUndefined()
  if (setup.invitation === undefined) throw new Error('No test invitation')
  return setup.invitation
}
async function pairHosts(
  a: Awaited<ReturnType<typeof harness>>,
  b: Awaited<ReturnType<typeof harness>>,
) {
  const local = await invitation(a)
  const peer = await invitation(b)
  const observed0 = await a.act({ kind: 'importInvitation', text: DevicePairing.publicText(peer) })
  expect(observed0.failure).toBeUndefined()
  expect(observed0.invitation).toEqual(peer)
  expect(observed0.viewId).toBe('9'.repeat(32))
  const observed1 = await b.act({ kind: 'importInvitation', text: DevicePairing.publicText(local) })
  expect(observed1.failure).toBeUndefined()
  const observed2 = await a.act({
    kind: 'confirmFingerprint',
    invitationId: peer.invitationId,
    fingerprint: peer.fingerprint,
  })
  const localConfirmation = observed2.confirmation
  const observed3 = await b.act({
    kind: 'confirmFingerprint',
    invitationId: local.invitationId,
    fingerprint: local.fingerprint,
  })
  const peerConfirmation = observed3.confirmation
  if (localConfirmation === undefined || peerConfirmation === undefined)
    throw new Error('No test confirmation')
  const observed4 = await a.act({ kind: 'importConfirmation', confirmation: peerConfirmation })
  expect(observed4.failure).toBeUndefined()
  const observed5 = await b.act({ kind: 'importConfirmation', confirmation: localConfirmation })
  expect(observed5.failure).toBeUndefined()
  return { local, peer, pairId: localConfirmation.pairId, localConfirmation, peerConfirmation }
}

async function offeredPair() {
  const a = await harness('a')
  const b = await harness('b')
  const paired = await pairHosts(a, b)
  const grant = deviceGrant(paired.pairId)
  await a.adapter.grant(grant)
  return { a, paired, grant }
}

function holdSecret(host: Awaited<ReturnType<typeof harness>>) {
  const entered = Promise.withResolvers<boolean>()
  const keyRead = Promise.withResolvers<boolean>()
  host.secretStore.get.mockImplementationOnce(async (key) => {
    entered.resolve(true)
    await keyRead.promise
    return host.values.get(key)
  })
  return {
    entered: entered.promise,
    release: () => {
      keyRead.resolve(true)
    },
  }
}

async function expectBlockedBeforeSecret(
  host: Awaited<ReturnType<typeof harness>>,
  pairId: string,
  peerPin: string,
) {
  host.secretStore.get.mockClear()
  await expect(host.adapter.material(pairId, peerPin)).rejects.toThrow('grant')
  expect(host.secretStore.get).not.toHaveBeenCalled()
}

describe('explicit local pairing adapter and SecretStorage', () => {
  it('does no work at construction; pairs without activating offers, opening sockets or granting execution', async () => {
    const a = await harness('a')
    const b = await harness('b')
    expect(a.secretStore.get).not.toHaveBeenCalled()
    expect(a.disconnectPair).not.toHaveBeenCalled()
    expect(a.otherAction).not.toHaveBeenCalled()
    const paired = await pairHosts(a, b)
    const state = await a.store.read()
    expect(state.pairs[0]?.pairId).toBe(paired.pairId)
    expect(state.pairs[0]?.paused).toBe(true)
    expect(state.pairs[0]?.grants).toEqual([])
    expect(state.usedInvitationIds).toEqual([paired.local.invitationId, paired.peer.invitationId])
    await expectBlockedBeforeSecret(a, paired.pairId, paired.peer.fingerprint)
    const observed6 = await a.adapter.material(paired.pairId, paired.peer.fingerprint, false)
    expect(observed6.key.type).toBe('private')
    expect(await readFile(path.join(a.directory, 'pairs.json'), 'utf8')).not.toContain(
      'PRIVATE KEY',
    )
    const observed7 = await invitation(a)
    expect(observed7.invitationId).not.toBe(paired.local.invitationId)
    const observed8 = await a.act({
      kind: 'importInvitation',
      text: DevicePairing.publicText(paired.peer),
    })
    expect(observed8.failure).toBe('unpaired')
  })
  it('requires an imported invitation, exact comparison and both locally persisted confirmations', async () => {
    const a = await harness('a')
    const b = await harness('b')
    const local = await invitation(a)
    const peer = await invitation(b)
    const observed9 = await a.act({
      kind: 'confirmFingerprint',
      invitationId: peer.invitationId,
      fingerprint: peer.fingerprint,
    })
    expect(observed9.failure).toBe('unpaired')
    await a.act({ kind: 'importInvitation', text: DevicePairing.publicText(peer) })
    await b.act({ kind: 'importInvitation', text: DevicePairing.publicText(local) })
    const observed10 = await b.act({
      kind: 'confirmFingerprint',
      invitationId: local.invitationId,
      fingerprint: local.fingerprint,
    })
    const remote = observed10.confirmation!
    const observed11 = await a.act({ kind: 'importConfirmation', confirmation: remote })
    expect(observed11.failure).toBe('unpaired')
    const observed12 = await a.act({
      kind: 'confirmFingerprint',
      invitationId: peer.invitationId,
      fingerprint: local.fingerprint,
    })
    expect(observed12.failure).toBe('invalid-frame')
    await a.act({
      kind: 'confirmFingerprint',
      invitationId: peer.invitationId,
      fingerprint: peer.fingerprint,
    })
    const observed13 = await a.act({
      kind: 'importConfirmation',
      confirmation: { ...remote, peerFingerprint: peer.fingerprint },
    })
    expect(observed13.failure).toBe('invalid-frame')
    const observed14 = await a.store.read()
    expect(observed14.pairs).toEqual([])
    const observed15 = await a.act({ kind: 'importConfirmation', confirmation: remote })
    expect(observed15.failure).toBeUndefined()
  })
  it('resumes saved setup, refuses peer replacement, and consumes expired setup before generating a new key', async () => {
    const a = await harness('a')
    const b = await harness('b')
    const c = await harness('c')
    const local = await invitation(a)
    const peer = await invitation(b)
    const replacement = await invitation(c)
    const observed16 = await invitation(a)
    expect(observed16.invitationId).toBe(local.invitationId)
    await a.act({ kind: 'importInvitation', text: DevicePairing.publicText(peer) })
    const observed17 = await a.act({
      kind: 'importInvitation',
      text: DevicePairing.publicText(replacement),
    })
    expect(observed17.failure).toBe('unpaired')
    a.advance(deviceTestNow + DEVICE_LIMITS.invitationValidityMs)
    const fresh = await invitation(a)
    expect(fresh.invitationId).not.toBe(local.invitationId)
    const observed18 = await a.store.read()
    expect(observed18.usedInvitationIds).toEqual([local.invitationId, peer.invitationId])
    expect(a.values.size).toBe(1)
  })
  it('requires the current pin, current local offer and grant revision for every request', async () => {
    const { a, paired, grant } = await offeredPair()
    expect(await a.adapter.authorize(paired.peer.fingerprint, deviceCheck(grant))).toEqual(
      grant.offer.caps,
    )
    await expect(a.adapter.authorize(paired.local.fingerprint, deviceCheck(grant))).rejects.toThrow(
      'unpaired',
    )
    const narrowed = structuredClone(grant)
    narrowed.offer.grantRevision = 2
    narrowed.offer.caps.workers = 1
    await a.adapter.grant(narrowed)
    await expect(a.adapter.authorize(paired.peer.fingerprint, deviceCheck(grant))).rejects.toThrow(
      'grant',
    )
    const request = deviceCheck(narrowed)
    request.caps = { ...request.caps, workers: 1 }
    const observed19 = await a.adapter.authorize(paired.peer.fingerprint, request)
    expect(observed19.workers).toBe(1)
    const observed20 = await a.act({ kind: 'pauseOffers', pairId: paired.pairId })
    expect(observed20.failure).toBeUndefined()
    await expect(a.adapter.authorize(paired.peer.fingerprint, request)).rejects.toThrow('grant')
    expect(a.disconnectPair).toHaveBeenCalledWith(paired.pairId)
  })
  it('unlinks only this key/pair and leaves unrelated pairs, execution evidence and liabilities intact through re-pair', async () => {
    const a = await harness('a')
    const b = await harness('b')
    const c = await harness('c')
    const first = await pairHosts(a, b)
    const second = await pairHosts(a, c)
    await a.adapter.grant(deviceGrant(first.pairId))
    await a.adapter.grant(deviceGrant(second.pairId))
    const journal = path.join(fixture.parent, 'execution-owner.json')
    const original = JSON.stringify({
      pairId: first.pairId,
      state: 'uncertain',
      occupied: 1,
      retainedLiabilityUsd: 1,
    })
    await writeFile(journal, original)
    const observed21 = await a.act({ kind: 'unlink', pairId: first.pairId })
    expect(observed21.failure).toBeUndefined()
    expect(a.values.size).toBe(1)
    expect(a.disconnectPair).toHaveBeenCalledWith(first.pairId)
    await expect(
      a.adapter.authorize(first.peer.fingerprint, deviceCheck(deviceGrant(first.pairId))),
    ).rejects.toThrow('revoked')
    const observed22 = await a.adapter.material(second.pairId, second.peer.fingerprint)
    expect(observed22.key.type).toBe('private')
    const peerNew = await harness('d')
    const fresh = await pairHosts(a, peerNew)
    expect(fresh.pairId).not.toBe(first.pairId)
    expect(await readFile(journal, 'utf8')).toBe(original)
    const observed23 = await a.store.read()
    expect(observed23.revokedPairIds).toContain(first.pairId)
  })
  it('rechecks revocation after an asynchronous key read, including existing authenticated connections', async () => {
    const a = await harness('a')
    const b = await harness('b')
    const paired = await pairHosts(a, b)
    await a.adapter.grant(deviceGrant(paired.pairId))
    const material = await a.adapter.material(paired.pairId, paired.peer.fingerprint)
    let release: (() => void) | undefined
    const { promise: entered, resolve: signal } = Promise.withResolvers<boolean>()
    a.secretStore.get.mockImplementationOnce(
      (key) =>
        new Promise<string | undefined>((resolve) => {
          release = () => {
            resolve(a.values.get(key))
          }
          signal(true)
        }),
    )
    const pending = a.adapter.material(paired.pairId, paired.peer.fingerprint)
    const refusal = expect(pending).rejects.toThrow()
    await entered
    await a.adapter.unlink(paired.pairId)
    release?.()
    await refusal
    expect(material.row.pairId).toBe(paired.pairId)
    await expect(a.adapter.material(paired.pairId, paired.peer.fingerprint)).rejects.toThrow(
      'revoked',
    )
  })
  it.each(['missing', 'corrupt', 'read-error'])(
    'fails closed on %s platform secrets and never echoes store error details',
    async (kind) => {
      const a = await harness('a')
      const b = await harness('b')
      const paired = await pairHosts(a, b)
      switch (kind) {
        case 'missing': {
          a.values.clear()
          break
        }
        case 'corrupt': {
          for (const key of a.values.keys()) a.values.set(key, 'invalid-test-key')
          break
        }
        case 'read-error': {
          {
            a.secretStore.get.mockRejectedValue(new Error('private-path-account-sentinel'))
            // No default
          }
          break
        }
      }
      const result = await a.act({
        kind: 'setAddress',
        pairId: paired.pairId,
        endpoint: { address: '127.0.0.1', port: 34_568 },
      })
      expect(result.failure).toBe('storage')
      expect(JSON.stringify(result)).not.toContain('sentinel')
      const observed24 = await a.store.read()
      expect(observed24.pairs).toHaveLength(1)
      await expect(
        a.adapter.material(paired.pairId, paired.peer.fingerprint, false),
      ).rejects.toThrow('storage')
    },
  )
  it('refuses secret write failures and does not save an invitation or private key to metadata', async () => {
    const a = await harness('a')
    a.secretStore.store.mockRejectedValue(new Error('private-secret-store-sentinel'))
    const result = await a.act({ kind: 'pair' })
    expect(result.failure).toBe('storage')
    expect(result.invitation).toBeUndefined()
    const observed25 = await a.store.read()
    expect(observed25.pending).toEqual([])
    expect(a.values.size).toBe(0)
  })
  it('refuses publication after failed directory durability and preserves explicit recovery state', async () => {
    const syncDirectory = vi.fn(async (directory: string) => {
      const handle = await open(directory, 'r')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    })
    const protection = {
      assertPrivate: (_file: string, _isDirectory: boolean) => Promise.resolve(),
      syncDirectory,
    }
    const a = await harness('a', localHost, protection)
    syncDirectory.mockRejectedValueOnce(new Error('private-durability-sentinel'))
    const result = await a.act({ kind: 'pair' })
    expect(result.failure).toBe('storage')
    expect(result.invitation).toBeUndefined()
    expect(a.values.size).toBe(0)
    await expect(a.store.read()).rejects.toThrow('storage')
    expect(await readFile(path.join(a.directory, 'pairs.json'), 'utf8')).not.toContain(
      'PRIVATE KEY',
    )
  })
  it.each([
    { ...localHost, ui: 'web' as const },
    { ...localHost, remoteName: 'ssh-remote' },
    { ...localHost, execution: 'headless' as const },
    { ...localHost, execution: 'remote' as const },
    { ...localHost, secretLocation: 'client' as const },
    { ...localHost, secretLocation: 'unknown' as const },
  ])('refuses unqualified execution/key location without reading secrets', async (host) => {
    const a = await harness('a', host)
    const observed26 = await a.act({ kind: 'pair' })
    expect(observed26.failure).toBe('unsupported-host')
    expect(a.secretStore.get).not.toHaveBeenCalled()
    expect(a.secretStore.store).not.toHaveBeenCalled()
    const observed27 = await a.store.read()
    expect(observed27.pending).toEqual([])
  })
  it('validates both bridge directions and calls real injected ports for other lanes', async () => {
    const a = await harness('a')
    await expect(
      a.adapter.handle({
        type: 'deviceRequest',
        viewId: '9'.repeat(32),
        revision: 0,
        requestId: 'f'.repeat(32),
        action: { kind: 'pair', token: 'forbidden' },
      }),
    ).rejects.toThrow('invalid-frame')
    const observed28 = await a.act({ kind: 'setDiscovery', enabled: true })
    expect(observed28.failure).toBe('grant')
    expect(a.otherAction).toHaveBeenCalledOnce()
    a.otherAction.mockResolvedValueOnce({
      viewId: '9'.repeat(32),
      requestId: 'broken',
      failure: 'grant',
    })
    expect(await a.act({ kind: 'setDiscovery', enabled: true })).toMatchObject({
      failure: 'invalid-frame',
    })
  })
  it('refuses replayed confirmation and corrupted stored pair transcripts after restart', async () => {
    const a = await harness('a')
    const b = await harness('b')
    const paired = await pairHosts(a, b)
    const result = await a.act({
      kind: 'importConfirmation',
      confirmation: paired.peerConfirmation,
    })
    expect(result.failure).toBe('unpaired')
    const state = await a.store.read()
    state.pairs[0]!.pair.peerConfirmation = {
      ...paired.peerConfirmation,
      transcriptDigest: '0'.repeat(64),
    }
    await writeFile(path.join(a.directory, 'pairs.json'), JSON.stringify(state))
    await expect(a.store.read()).rejects.toThrow('storage')
  })
  it('requires deletion to succeed and preserves a durable revocation if the key store refuses it', async () => {
    const a = await harness('a')
    const b = await harness('b')
    const paired = await pairHosts(a, b)
    a.secretStore.delete.mockRejectedValueOnce(new Error('private-delete-sentinel'))
    const result = await a.act({ kind: 'unlink', pairId: paired.pairId })
    expect(result.failure).toBe('storage')
    const observed29 = await a.store.read()
    expect(observed29.revokedPairIds).toContain(paired.pairId)
    const observed30 = await a.store.read()
    expect(observed30.pairs).toEqual([])
    await expect(a.adapter.material(paired.pairId, paired.peer.fingerprint, false)).rejects.toThrow(
      'revoked',
    )
    expect(await a.act({ kind: 'unlink', pairId: paired.pairId })).not.toHaveProperty('failure')
    expect(a.values.size).toBe(0)
  })
})

it('refuses a failed file flush before metadata replacement and removes only the newly created secret', async () => {
  const a = await harness('a')
  const actual = await vi.importActual<typeof FileSystem>('node:fs/promises')
  const original = await readFile(path.join(a.directory, 'pairs.json'), 'utf8')
  vi.mocked(open).mockImplementation(async (file, flags, mode) => {
    const handle = await actual.open(file, flags, mode)
    if (typeof file === 'string' && file.endsWith('.stage'))
      vi.spyOn(handle, 'sync').mockRejectedValue(new Error('file-sync-sentinel'))
    return handle
  })
  try {
    expect(await a.act({ kind: 'pair' })).toMatchObject({ failure: 'storage' })
    expect(a.values.size).toBe(0)
    expect(await readFile(path.join(a.directory, 'pairs.json'), 'utf8')).toBe(original)
    await a.store.close()
    await expect(DeviceStore.open(a.directory)).rejects.toThrow('storage')
  } finally {
    vi.mocked(open).mockImplementation(actual.open)
  }
})
it('refuses a failed atomic replacement without publishing setup or deleting unrelated keys', async () => {
  const a = await harness('a')
  vi.mocked(rename).mockRejectedValueOnce(new Error('rename-sentinel'))
  expect(await a.act({ kind: 'pair' })).toMatchObject({ failure: 'storage' })
  expect(a.values.size).toBe(0)
  await expect(a.store.read()).rejects.toThrow('storage')
})
it('never overwrites or deletes an existing platform key on a secret-name collision', async () => {
  const a = await harness('a')
  const local = await invitation(a)
  const stored = a.values.keys().next().value!
  const beforeCount = a.values.size
  const beforeDelete = a.secretStore.delete.mock.calls.length
  await expect(a.secrets.save(local, 'corrupt', deviceTestNow)).rejects.toThrow('storage')
  const material = await a.secrets.key(local, deviceTestNow)
  const pem = material.export({ type: 'pkcs8', format: 'pem' }).toString()
  await expect(a.secrets.save(local, pem, deviceTestNow)).rejects.toThrow('storage')
  expect(a.values.has(stored)).toBe(true)
  expect(a.values.size).toBe(beforeCount)
  expect(a.secretStore.delete.mock.calls.length).toBe(beforeDelete)
})
it('returns a strict error for a valid but mismatched reply id from a neighboring lane', async () => {
  const a = await harness('a')
  a.otherAction.mockResolvedValueOnce({
    viewId: '9'.repeat(32),
    requestId: 'e'.repeat(32),
    failure: 'grant',
  })
  expect(await a.act({ kind: 'setDiscovery', enabled: true })).toMatchObject({
    failure: 'invalid-frame',
    requestId: 'f'.repeat(32),
  })
})

it('bounds corrupt secret data before accepting a parsable oversized PEM', async () => {
  const a = await harness('a')
  const local = await invitation(a)
  const material = await a.secrets.key(local, deviceTestNow)
  const pem = material.export({ type: 'pkcs8', format: 'pem' }).toString()
  for (const key of a.values.keys())
    a.values.set(key, '\n'.repeat(DEVICE_LIMITS.certificateBase64Chars) + pem)
  await expect(a.secrets.key(local, deviceTestNow)).rejects.toThrow('storage')
})

it('blocks an existing authenticated pair immediately while durable unlink is pending', async () => {
  const a = await harness('a')
  const b = await harness('b')
  const paired = await pairHosts(a, b)
  await a.adapter.grant(deviceGrant(paired.pairId))
  const original = a.store.update.bind(a.store)
  const pendingWrite = Promise.withResolvers<boolean>()
  const blockSignal = Promise.withResolvers<boolean>()
  a.disconnectPair.mockImplementation(() => {
    blockSignal.resolve(true)
  })
  const update = vi.spyOn(a.store, 'update').mockImplementationOnce(async (change) => {
    await pendingWrite.promise
    await original(change)
  })
  const unlink = a.adapter.unlink(paired.pairId)
  await blockSignal.promise
  try {
    await expect(a.adapter.material(paired.pairId, paired.peer.fingerprint)).rejects.toThrow(
      'revoked',
    )
  } finally {
    pendingWrite.resolve(true)
    await unlink
    update.mockRestore()
  }
})
it('rechecks pause after an asynchronous key read before permitting any frame', async () => {
  const a = await harness('a')
  const b = await harness('b')
  const paired = await pairHosts(a, b)
  await a.adapter.grant(deviceGrant(paired.pairId))
  const entered = Promise.withResolvers<boolean>()
  const keyRead = Promise.withResolvers<string | undefined>()
  const saved = a.values.values().next().value
  a.secretStore.get.mockImplementationOnce(() => {
    entered.resolve(true)
    return keyRead.promise
  })
  const material = a.adapter.material(paired.pairId, paired.peer.fingerprint)
  const refused = expect(material).rejects.toThrow('grant')
  await entered.promise
  await a.act({ kind: 'pauseOffers', pairId: paired.pairId })
  keyRead.resolve(saved)
  await refused
})
it.each(['offered', 'paused'] as const)(
  'a later Pause refuses a pending grant secret read for an already %s pair',
  async (initial) => {
    const { a, paired, grant } = await offeredPair()
    if (initial === 'paused')
      expect(await a.act({ kind: 'pauseOffers', pairId: paired.pairId })).not.toHaveProperty(
        'failure',
      )
    const revised = structuredClone(grant)
    revised.offer.grantRevision = 2
    const keyRead = holdSecret(a)
    const granting = Promise.allSettled([a.adapter.grant(revised)])
    await keyRead.entered
    const pausing = a.act({ kind: 'pauseOffers', pairId: paired.pairId })
    keyRead.release()
    const [result] = await granting
    expect(await pausing).not.toHaveProperty('failure')
    const state = await a.store.read()
    let canAuthorize = true
    try {
      await a.adapter.authorize(paired.peer.fingerprint, deviceCheck(revised))
    } catch {
      canAuthorize = false
    }
    expect({ stillPaused: state.pairs[0]?.paused, canAuthorize }).toEqual({
      stillPaused: true,
      canAuthorize: false,
    })
    expect(result).toMatchObject({ status: 'rejected', reason: new Error('grant') })
    expect(state.pairs[0]?.grants).toEqual([grant])
  },
)

it('queues a grant behind an earlier UI mutation instead of starting a second secret read', async () => {
  const { a, paired, grant } = await offeredPair()
  a.secretStore.get.mockClear()
  const keyRead = holdSecret(a)
  const changing = a.act({
    kind: 'setAddress',
    pairId: paired.pairId,
    endpoint: { address: '127.0.0.1', port: 34_568 },
  })
  await keyRead.entered
  const revised = structuredClone(grant)
  revised.offer.grantRevision = 2
  const granting = expect(a.adapter.grant(revised)).resolves.toBeUndefined()
  try {
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(a.secretStore.get).toHaveBeenCalledOnce()
  } finally {
    keyRead.release()
    await Promise.allSettled([changing, granting])
  }
  expect(await changing).not.toHaveProperty('failure')
  await granting
  expect(await a.adapter.authorize(paired.peer.fingerprint, deviceCheck(revised))).toEqual(
    revised.offer.caps,
  )
})

it.each(['pause', 'revision'] as const)(
  'refuses a grant when durable %s state changes during its secret read',
  async (kind) => {
    const { a, grant } = await offeredPair()
    const revised = structuredClone(grant)
    revised.offer.grantRevision = 3
    const keyRead = holdSecret(a)
    const granting = Promise.allSettled([a.adapter.grant(revised)])
    await keyRead.entered
    await a.store.update((state) => {
      const row = state.pairs[0]!
      if (kind === 'pause') row.paused = true
      else row.grants[0]!.offer.grantRevision = 2
      return state
    })
    const before = await readFile(path.join(a.directory, 'pairs.json'))
    keyRead.release()
    const [result] = await granting
    expect(result).toMatchObject({ status: 'rejected', reason: new Error('grant') })
    expect(await readFile(path.join(a.directory, 'pairs.json'))).toEqual(before)
    expect(await a.store.read()).toMatchObject({ deviceId: 'a'.repeat(32) })
  },
)

it.each(['new frame', 'pending secret read'] as const)(
  'keeps a later Pause blocking a %s when an older grant finishes persistence',
  async (kind) => {
    const { a, paired, grant } = await offeredPair()
    let keyRead: ReturnType<typeof holdSecret> | undefined
    let material: ReturnType<DevicePairing['material']> | undefined
    if (kind === 'pending secret read') {
      keyRead = holdSecret(a)
      material = a.adapter.material(paired.pairId, paired.peer.fingerprint)
      await keyRead.entered
    }
    const refused = material === undefined ? undefined : expect(material).rejects.toThrow('grant')
    const persist = a.store.update.bind(a.store)
    const grantPersisted = Promise.withResolvers<boolean>()
    const releaseGrant = Promise.withResolvers<boolean>()
    const pauseEntered = Promise.withResolvers<boolean>()
    const releasePause = Promise.withResolvers<boolean>()
    const update = vi
      .spyOn(a.store, 'update')
      .mockImplementationOnce(async (change) => {
        await persist(change)
        grantPersisted.resolve(true)
        await releaseGrant.promise
      })
      .mockImplementationOnce(async (change) => {
        pauseEntered.resolve(true)
        await releasePause.promise
        await persist(change)
      })
    const revised = structuredClone(grant)
    revised.offer.grantRevision = 2
    const granting = expect(a.adapter.grant(revised)).resolves.toBeUndefined()
    await grantPersisted.promise
    const pausing = a.act({ kind: 'pauseOffers', pairId: paired.pairId })
    releaseGrant.resolve(true)
    await granting
    await pauseEntered.promise
    try {
      keyRead?.release()
      if (refused === undefined) {
        await expectBlockedBeforeSecret(a, paired.pairId, paired.peer.fingerprint)
      } else await refused
    } finally {
      keyRead?.release()
      releasePause.resolve(true)
      await Promise.allSettled([pausing, refused])
      update.mockRestore()
    }
    expect(await pausing).not.toHaveProperty('failure')
  },
)

it('allows a fresh explicit grant after a completed Pause to resume this pair', async () => {
  const { a, paired, grant } = await offeredPair()
  expect(await a.act({ kind: 'pauseOffers', pairId: paired.pairId })).not.toHaveProperty('failure')
  const revised = structuredClone(grant)
  revised.offer.grantRevision = 2
  await a.adapter.grant(revised)
  expect(await a.adapter.authorize(paired.peer.fingerprint, deviceCheck(revised))).toEqual(
    revised.offer.caps,
  )
})
it('disconnects and blocks a requested pair even when damaged metadata prevents key cleanup', async () => {
  const a = await harness('a')
  const b = await harness('b')
  const paired = await pairHosts(a, b)
  await writeFile(path.join(a.directory, 'pairs.json'), '{')
  expect(await a.act({ kind: 'unlink', pairId: paired.pairId })).toMatchObject({
    failure: 'storage',
  })
  expect(a.disconnectPair).toHaveBeenCalledWith(paired.pairId)
  await expect(a.adapter.material(paired.pairId, paired.peer.fingerprint, false)).rejects.toThrow(
    'storage',
  )
})
it('refuses a grant assigned to another executing device and a non-increasing grant revision', async () => {
  const { a, grant } = await offeredPair()
  await expect(a.adapter.grant(grant)).rejects.toThrow('grant')
  const c = await harness('c')
  const d = await harness('d')
  const other = await pairHosts(c, d)
  const scopeChanged = vi.fn()
  const persist = c.store.update.bind(c.store)
  vi.spyOn(c.store, 'update').mockImplementation(async (change) => {
    await persist((state) => {
      const next = change(state)
      scopeChanged()
      return next
    })
  })
  await expect(c.adapter.grant(deviceGrant(other.pairId, 'a'.repeat(32)))).rejects.toThrow('grant')
  expect(scopeChanged).not.toHaveBeenCalled()
})

it('updates a manual routing hint without changing the pin, signed transcript or execution evidence', async () => {
  const a = await harness('a')
  const b = await harness('b')
  const paired = await pairHosts(a, b)
  const endpoint = { address: 'fd12::2', port: 34_568 }
  expect(await a.act({ kind: 'setAddress', pairId: paired.pairId, endpoint })).not.toHaveProperty(
    'failure',
  )
  const material = await a.adapter.material(paired.pairId, paired.peer.fingerprint, false)
  expect(material.row.endpoint).toEqual(endpoint)
  expect(material.row.pair.peer.endpoint).toEqual(paired.peer.endpoint)
  expect(material.row.pair.peer.fingerprint).toBe(paired.peer.fingerprint)
  expect(material.row.paused).toBe(true)
  expect(a.values.size).toBe(1)
  expect(a.disconnectPair).toHaveBeenCalledWith(paired.pairId)
  expect(await a.store.read()).toMatchObject({
    usedInvitationIds: [paired.local.invitationId, paired.peer.invitationId],
  })
})

it('does not reactivate another receiver incarnation’s durable offers after reopening', async () => {
  const a = await harness('a')
  const b = await harness('b')
  const paired = await pairHosts(a, b)
  const old = deviceGrant(paired.pairId)
  await a.adapter.grant(old)
  await a.store.close()
  const reopened = await DeviceStore.open(a.directory)
  stores.push(reopened)
  const next = new DevicePairing({
    store: reopened,
    secrets: a.secrets,
    host: localHost,
    now: () => deviceTestNow,
    receiverIncarnationId: '2'.repeat(32),
    setup: () => Promise.reject(new Error('Unexpected setup')),
    disconnectPair: a.disconnectPair,
    otherAction: a.otherAction,
  })
  a.secretStore.get.mockClear()
  await expect(next.material(paired.pairId, paired.peer.fingerprint)).rejects.toThrow('grant')
  expect(a.secretStore.get).not.toHaveBeenCalled()
  const current = structuredClone(old)
  current.offer.receiverIncarnationId = '2'.repeat(32)
  current.offer.repositoryId = '0'.repeat(32)
  current.offer.grantId = '9'.repeat(32)
  await next.grant(current)
  const observed = await next.material(paired.pairId, paired.peer.fingerprint)
  expect(observed.row.grants).toEqual([current])
  expect(await next.authorize(paired.peer.fingerprint, deviceCheck(current))).toEqual(
    current.offer.caps,
  )
  a.secretStore.get.mockClear()
  await expect(next.authorize(paired.peer.fingerprint, deviceCheck(old))).rejects.toThrow('grant')
  expect(a.secretStore.get).not.toHaveBeenCalled()
  const staleOwner = structuredClone(old)
  staleOwner.offer.grantRevision = 2
  await expect(next.grant(staleOwner)).rejects.toThrow('grant')
  const state = await readFile(path.join(a.directory, 'pairs.json'), 'utf8')
  expect(state).toContain(paired.pairId)
})

it.each(['stale-pause', 'unknown-pause', 'duplicate-grant', 'stale-grant'] as const)(
  'keeps unrelated A–C authorizable after an A–B %s policy refusal',
  async (kind) => {
    const a = await harness('a')
    const first = await pairHosts(a, await harness('b'))
    const second = await pairHosts(a, await harness('c'))
    const original = deviceGrant(first.pairId)
    const unrelated = deviceGrant(second.pairId)
    await a.adapter.grant(original)
    await a.adapter.grant(unrelated)
    let reason: string | undefined
    let expectedReason = 'grant'
    if (kind === 'stale-pause') {
      expect(await a.act({ kind: 'unlink', pairId: first.pairId })).not.toHaveProperty('failure')
      const result = await a.act({ kind: 'pauseOffers', pairId: first.pairId })
      reason = result.failure
      expectedReason = 'revoked'
    } else if (kind === 'unknown-pause') {
      const result = await a.act({ kind: 'pauseOffers', pairId: '0'.repeat(32) })
      reason = result.failure
      expectedReason = 'unpaired'
    } else {
      if (kind === 'stale-grant') {
        const next = structuredClone(original)
        next.offer.grantRevision = 2
        await a.adapter.grant(next)
      }
      const result = await Promise.allSettled([a.adapter.grant(original)])
      expect(result[0]).toMatchObject({ status: 'rejected' })
      if (result[0].status === 'rejected') {
        const error: unknown = result[0].reason
        reason = error instanceof Error ? error.message : undefined
      }
    }
    let canAuthorize = true
    try {
      await a.adapter.authorize(second.peer.fingerprint, deviceCheck(unrelated))
    } catch {
      canAuthorize = false
    }
    expect({ reason, canAuthorize }).toEqual({
      reason: expectedReason,
      canAuthorize: true,
    })
  },
)

it('serializes an in-progress native identity read with replacement so ordinary updates do not poison storage', async () => {
  const entered = Promise.withResolvers<boolean>()
  const release = Promise.withResolvers<boolean>()
  let shouldHold = false
  let metadataReads = 0
  const protection = {
    async assertPrivate(file: string, _isDirectory: boolean) {
      if (file.endsWith('pairs.json')) metadataReads += 1
      if (!shouldHold || !file.endsWith('pairs.json')) return
      shouldHold = false
      entered.resolve(true)
      await release.promise
    },
    async syncDirectory(directory: string) {
      const handle = await open(directory, 'r')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    },
  }
  const a = await harness('a', localHost, protection)
  metadataReads = 0
  shouldHold = true
  const reading = a.store.read()
  const readingResult = expect(reading).resolves.toMatchObject({ usedInvitationIds: [] })
  await entered.promise
  const writing = a.store.update((state) => {
    state.usedInvitationIds.push('0'.repeat(32))
    return state
  })
  try {
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(metadataReads).toBe(1)
  } finally {
    release.resolve(true)
    await Promise.allSettled([readingResult, writing])
  }
  await readingResult
  await writing
  expect(await a.store.read()).toMatchObject({ usedInvitationIds: ['0'.repeat(32)] })
})

it('exports only strict public invitation fields even when the caller carries extra data', async () => {
  const a = await harness('a')
  const publicInvitation = await invitation(a)
  expect(DevicePairing.publicText(publicInvitation)).toBe(JSON.stringify(publicInvitation))
  expect(() =>
    DevicePairing.publicText({ ...publicInvitation, privateKey: 'forbidden-test-field' }),
  ).toThrow('invalid-frame')
  expect(() => DevicePairing.publicText(undefined)).toThrow('invalid-frame')
})

it('replaces a grant revision by both its id and repository instead of retaining ambiguous rows', async () => {
  const { a, paired, grant } = await offeredPair()
  const revised = structuredClone(grant)
  revised.offer.grantRevision = 2
  revised.offer.repositoryId = '0'.repeat(32)
  await a.adapter.grant(revised)
  const material = await a.adapter.material(paired.pairId, paired.peer.fingerprint)
  expect(material.row.grants).toEqual([revised])
  expect(await a.adapter.authorize(paired.peer.fingerprint, deviceCheck(revised))).toEqual(
    revised.offer.caps,
  )
  await expect(a.adapter.authorize(paired.peer.fingerprint, deviceCheck(grant))).rejects.toThrow(
    'grant',
  )
})
it.each(['owner', 'pair', 'grant', 'repository'])(
  'refuses persisted grant %s corruption even with valid bilateral pair proofs',
  async (kind) => {
    const { a, grant } = await offeredPair()
    const state = await a.store.read()
    const grants = state.pairs[0]!.grants
    const copied = structuredClone(grant)
    switch (kind) {
      case 'owner': {
        grants[0]!.offer.deviceId = '0'.repeat(32)
        break
      }
      case 'pair': {
        grants[0]!.pairId = '0'.repeat(32)
        break
      }
      case 'grant': {
        copied.offer.repositoryId = '0'.repeat(32)
        grants.push(copied)
        break
      }
      case 'repository': {
        copied.offer.grantId = '0'.repeat(32)
        grants.push(copied)
        break
      }
    }
    await writeFile(path.join(a.directory, 'pairs.json'), JSON.stringify(state))
    await expect(a.store.read()).rejects.toThrow('storage')
  },
)

it('binds neighboring action replies to the initiating view as well as request', async () => {
  const a = await harness('a')
  a.otherAction.mockResolvedValueOnce({
    viewId: '8'.repeat(32),
    requestId: 'f'.repeat(32),
    failure: 'grant',
  })
  expect(await a.act({ kind: 'setDiscovery', enabled: true })).toMatchObject({
    viewId: '9'.repeat(32),
    requestId: 'f'.repeat(32),
    failure: 'invalid-frame',
  })
})
