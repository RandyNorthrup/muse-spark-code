import { afterEach, afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, stat, chmod, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { connect, Socket, createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { VaultChannelServer, type VaultChannelDeps } from '../../../src/core/vault/broker/channel'
import { VaultBrokerClient } from '../../../src/core/vault/broker/client'
import {
  UnixVaultPeerVerifier,
  WindowsVaultPeerVerifier,
  type VaultProcessIdentity,
} from '../../../src/core/vault/broker/peer'
import { VaultBrokerDiscovery } from '../../../src/core/vault/broker/discovery'
import { VaultLockEpoch } from '../../../src/core/vault/broker/epoch'
import { VaultBrokerProcess } from '../../../src/host/vault/brokerProcess'
import { HostVaultBrokerClient } from '../../../src/host/vault/brokerClient'
import { RuntimeVaultBrokerClient } from '../../../src/runtime/vault/brokerClient'
import { brokerFixture, socketDescriptors } from './brokerFixture'
import { vaultPrivateReadSchema } from '../../../src/shared/vaultProtocol'
import { type VaultBroker } from '../../../src/core/vault/broker/broker'
import { use } from '../helpers/vault/fixtures'
import { VAULT_LIMITS, UI_TEXT } from '../../../src/shared/constants'

const directories: string[] = [],
  servers: VaultChannelServer[] = [],
  brokers: VaultBroker[] = []
const releases: (() => Promise<void>)[] = []
const native = { helper: '' }
beforeAll(async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm109-b-peer-'))
  directories.push(directory)
  native.helper = path.join(directory, 'peer')
  execFileSync(
    '/usr/bin/cc',
    [
      '-Wall',
      '-Wextra',
      '-Werror',
      path.resolve('src/core/vault/broker/peer.c'),
      '-o',
      native.helper,
    ],
    { env: {} },
  )
})
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const broker of brokers.splice(0)) await broker.dispose()
  for (const release of releases.splice(0)) await release()
  // The compiled helper is shared by these tests; remove only test run directories here.
  while (directories.length > 1) await rm(directories.pop()!, { recursive: true, force: true })
})
afterAll(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
const processIdentity: VaultProcessIdentity = {
  processId: process.pid,
  userId: String(globalThis.process.getuid?.()),
  startedAt: 100,
  executable: process.execPath,
}
const identify = (pid: number) => Promise.resolve({ ...processIdentity, processId: pid })
async function channelSetup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm109-b-channel-'))
  directories.push(directory)
  const fixture = await brokerFixture()
  brokers.push(fixture.broker)
  const socket = path.join(directory, 'broker.sock')
  const discovery = new VaultBrokerDiscovery(directory, 'test-session')
  const nativeClaim = await discovery.claim(processIdentity, socket)
  let hasReleased = false
  const claimed = {
    ...nativeClaim,
    release: async () => {
      if (hasReleased) return
      hasReleased = true
      await nativeClaim.release()
    },
  }
  releases.push(claimed.release)
  const peers = new UnixVaultPeerVerifier(native.helper, identify, socketDescriptors)
  fixture.deps.identity.verifyHost = (peer) =>
    Promise.resolve(peer.processId === process.pid && peer.userId === processIdentity.userId)
  const deps: VaultChannelDeps = {
    broker: fixture.broker,
    peers,
    bootToken: claimed.location.bootToken,
    brokerId: claimed.location.lock.brokerId,
    identify: (identity, hostId, _session) =>
      Promise.resolve({
        peer: { ...fixture.peer, processId: identity.processId, userId: identity.userId, hostId },
        requester: null,
        firstParty: true,
        manage: true,
      }),
    taint: () => Promise.resolve({ tainted: false, reasons: [] }),
    ceiling: () => 'ask',
    perform: vi.fn(() => Promise.resolve()),
    lifetime: () => ({ close: vi.fn(), terminate: () => Promise.resolve(true) }),
    scrub: (text) => Promise.resolve(text),
    audit: () => fixture.deps.audit.read(),
  }
  const server = new VaultChannelServer(deps)
  servers.push(server)
  await server.listen(socket)
  return { ...fixture, brokerDeps: fixture.deps, discovery, claimed, peers, deps, socket, server }
}
function workerConnection(fixture: Awaited<ReturnType<typeof channelSetup>>) {
  fixture.deps.identify = (identity, hostId) =>
    Promise.resolve({
      peer: { hostId, processId: identity.processId, userId: identity.userId, ui: false },
      requester: fixture.identity,
      firstParty: false,
      manage: false,
    })
}
async function openClient(fixture: Awaited<ReturnType<typeof channelSetup>>) {
  return await VaultBrokerClient.open(
    fixture.claimed.location,
    fixture.peer.hostId,
    'c'.repeat(32),
    fixture.peers,
  )
}
async function auditRecord(fixture: Awaited<ReturnType<typeof channelSetup>>) {
  await fixture.broker.request(fixture.identity, fixture.stored.metadata.handle, use(), {
    tainted: false,
    reasons: [],
  })
  const audited = await fixture.deps.audit()
  const record = audited[0]
  if (!record) throw new Error('expected audit record')
  return record
}
function helloFrame(fixture: Awaited<ReturnType<typeof channelSetup>>) {
  return {
    v: 1,
    sequence: 0,
    request: {
      kind: 'hello',
      bootToken: fixture.claimed.location.bootToken,
      hostId: fixture.peer.hostId,
      hostSession: 'c'.repeat(32),
    },
  }
}
async function raw(path: string) {
  const socket = connect(path)
  await once(socket, 'connect')
  return socket
}
async function frame(socket: Socket, input: unknown): Promise<unknown> {
  const received = Promise.withResolvers<Buffer>()
  const data = (bytes: Buffer) => {
    received.resolve(bytes)
  }
  const closed = () => {
    received.reject(new Error('test channel closed before reply'))
  }
  socket.once('data', data)
  socket.once('close', closed)
  try {
    socket.write(`${JSON.stringify(input)}\n`)
    const bytes = await received.promise
    return JSON.parse(bytes.toString('utf8'))
  } finally {
    socket.removeListener('data', data)
    socket.removeListener('close', closed)
  }
}
async function closedOrReply(socket: Socket): Promise<'closed' | 'reply'> {
  const result = Promise.withResolvers<'closed' | 'reply'>()
  const closed = () => {
      result.resolve('closed')
    },
    reply = () => {
      result.resolve('reply')
    }
  socket.once('close', closed)
  socket.once('data', reply)
  try {
    return await result.promise
  } finally {
    socket.removeListener('close', closed)
    socket.removeListener('data', reply)
  }
}
describe('native authenticated broker channel', () => {
  it('P2-7 closing a private connection cancels presence and erases its pending material', async () => {
    const fixture = await channelSetup(),
      open = fixture.brokerDeps.repository.open
    let held: Uint8Array = new Uint8Array()
    fixture.brokerDeps.repository.open = async (key) => {
      const store = await open(key),
        read = store.read.bind(store)
      store.read = async (id) => {
        const item = await read(id)
        if (item.material.kind === 'apiKey') held = item.material.value
        return item
      }
      return store
    }
    await fixture.broker.lock()
    await fixture.broker.unlock()
    const entry = await fixture.firstParty(true),
      waiting = Promise.withResolvers<boolean>()
    fixture.brokerDeps.unlock.presence = vi.fn(() => waiting.promise)
    const read = vi.spyOn(fixture.broker, 'firstPartyRead'),
      client = await openClient(fixture)
    const pending = client.firstPartyRead(entry.request),
      observed = expect(pending).rejects.toThrow()
    try {
      await vi.waitFor(() => {
        expect(fixture.brokerDeps.unlock.presence).toHaveBeenCalledOnce()
      })
      expect(held.some((byte) => byte !== 0)).toBe(true)
      client.close()
      await observed
      await vi.waitFor(() => {
        expect(held.every((byte) => byte === 0)).toBe(true)
      })
      const result = read.mock.results[0]
      if (result?.type !== 'return') throw new Error('expected private read promise')
      let hasSettled = false
      void (async () => {
        try {
          await result.value
        } catch {
          hasSettled = true
        }
      })()
      await vi.waitFor(() => {
        expect(hasSettled).toBe(true)
      })
      await expect(result.value).rejects.toThrow()
    } finally {
      client.close()
      waiting.resolve(true)
    }
  })

  it('audit pages stay under the frame limit and resume at the last generation', async () => {
    const fixture = await channelSetup()
    const record = await auditRecord(fixture)
    const count =
      Math.floor(VAULT_LIMITS.frameBytes / Buffer.byteLength(JSON.stringify(record))) + 1
    const records = Array.from({ length: count }, (_, index) => ({
      ...record,
      generation: index + 1,
    }))
    fixture.deps.audit = () => Promise.resolve(records)
    const client = await openClient(fixture)
    const first = await client.send({
      kind: 'audit',
      afterGeneration: 0,
      item: null,
      requesterId: null,
    })
    if (first.kind !== 'audit') throw new Error('expected audit page')
    expect(first.records.length).toBeGreaterThan(0)
    expect(first.records.length).toBeLessThan(count)
    const last = first.records.at(-1)
    if (!last) throw new Error('expected page end')
    const second = await client.send({
      kind: 'audit',
      afterGeneration: last.generation,
      item: null,
      requesterId: null,
    })
    if (second.kind !== 'audit') throw new Error('expected next page')
    expect(second.records[0]?.generation).toBe(last.generation + 1)
    expect(first.records.length + second.records.length).toBe(count)
    client.close()
    await fixture.claimed.release()
  })
  it('audit item and requester filters return only matching records', async () => {
    const fixture = await channelSetup(),
      record = await auditRecord(fixture)
    fixture.deps.audit = () =>
      Promise.resolve([
        {
          ...record,
          generation: 1,
          handle: 'secret://other',
          requester: { ...record.requester, id: 'f'.repeat(32) },
        },
        { ...record, generation: 2 },
      ])
    const client = await openClient(fixture)
    for (const filters of [
      { item: record.handle, requesterId: null },
      { item: null, requesterId: record.requester.id },
    ]) {
      const page = await client.send({ kind: 'audit', afterGeneration: 0, ...filters })
      if (page.kind !== 'audit') throw new Error('expected filtered page')
      expect(page.records).toHaveLength(1)
      expect(page.records[0]?.generation).toBe(2)
    }
    client.close()
    await fixture.claimed.release()
  })
  it('getpeereid and LOCAL_PEERPID authenticate both endpoints; versioned hello checks boot and broker identity', async () => {
    const fixture = await channelSetup()
    const resolved4865_0 = await stat(fixture.socket)
    expect(resolved4865_0.mode & 0o777).toBe(0o600)
    const client = await openClient(fixture)
    expect(await client.send({ kind: 'status' })).toMatchObject({
      kind: 'status',
      status: { state: 'unlocked' },
    })
    const runtime = new RuntimeVaultBrokerClient(() => Promise.resolve(client))
    const entry = await fixture.firstParty(false, randomBytes(1024 * 1024))
    const read = await runtime.read(entry.request)
    expect(read.equals(entry.bytes)).toBe(true)
    read.fill(0)
    await fixture.claimed.release()
  })
  it.each(['version', 'token', 'identity', 'noHello', 'sequence', 'unknown'])(
    'refuses %s before dispatch',
    async (attack) => {
      const fixture = await channelSetup(),
        socket = await raw(fixture.socket)
      const closed = closedOrReply(socket)
      let hello: unknown = {
        v: 1,
        sequence: 0,
        request: {
          kind: 'hello',
          bootToken: fixture.claimed.location.bootToken,
          hostId: fixture.peer.hostId,
          hostSession: 'c'.repeat(32),
        },
      }
      switch (attack) {
        case 'version': {
          hello = { ...helloFrame(fixture), v: 2 }
          break
        }
        case 'token': {
          hello = {
            v: 1,
            sequence: 0,
            request: {
              kind: 'hello',
              bootToken: '0'.repeat(32),
              hostId: fixture.peer.hostId,
              hostSession: 'c'.repeat(32),
            },
          }
          break
        }
        case 'identity': {
          fixture.deps.identify = () =>
            Promise.resolve({
              peer: { ...fixture.peer, processId: process.pid + 1 },
              requester: null,
              firstParty: true,
              manage: true,
            })
          break
        }
        case 'noHello': {
          hello = { v: 1, sequence: 0, request: { kind: 'status' } }
          break
        }
        case 'sequence': {
          hello = {
            v: 1,
            sequence: 1,
            request: {
              kind: 'hello',
              bootToken: fixture.claimed.location.bootToken,
              hostId: fixture.peer.hostId,
              hostSession: 'c'.repeat(32),
            },
          }
          break
        }
        case 'unknown': {
          {
            hello = {
              ...helloFrame(fixture),
              request: { ...helloFrame(fixture).request, value: 'untrusted' },
            }
            // No default
          }
          break
        }
      }
      socket.write(`${JSON.stringify(hello)}\n`)
      expect(await closed).toBe('closed')
      expect(fixture.deps.perform).not.toHaveBeenCalled()
      await fixture.claimed.release()
    },
  )
  it('worker sockets cannot claim management, private reads, answers or another requester', async () => {
    const fixture = await channelSetup()
    fixture.deps.identify = (identity, hostId) =>
      Promise.resolve({
        peer: { hostId, userId: identity.userId, processId: identity.processId, ui: false },
        requester: fixture.identity,
        firstParty: false,
        manage: false,
      })
    const client = await openClient(fixture)
    expect(await client.send({ kind: 'lock' })).toEqual({ kind: 'denied', reason: 'peer' })
    expect(await client.send({ kind: 'scrub', text: 'generated test output' })).toEqual({
      kind: 'denied',
      reason: 'peer',
    })
    expect(await client.send({ kind: 'unlock', slotId: 'f'.repeat(32) })).toEqual({
      kind: 'denied',
      reason: 'peer',
    })
    expect(await client.send({ kind: 'revoke', grantId: 'f'.repeat(32) })).toEqual({
      kind: 'denied',
      reason: 'peer',
    })
    expect(
      await client.send({ kind: 'audit', afterGeneration: 0, item: null, requesterId: null }),
    ).toEqual({ kind: 'denied', reason: 'peer' })
    expect(await client.send({ kind: 'endRequester', requesterId: 'f'.repeat(32) })).toEqual({
      kind: 'denied',
      reason: 'peer',
    })
    expect(
      await client.send({
        kind: 'answer',
        answer: { requestId: 'f'.repeat(32), digest: '0'.repeat(64), decision: 'allowOnce' },
      }),
    ).toEqual({ kind: 'denied', reason: 'peer' })
    await expect(
      client.firstPartyRead(
        vaultPrivateReadSchema.parse({
          v: 1,
          kind: 'firstPartyRead',
          itemId: fixture.stored.metadata.id,
          origin: 'https://example.test',
          client: 'model',
        }),
      ),
    ).rejects.toThrow()
    client.close()
    await fixture.claimed.release()
  })
  it.each(['lock', 'end'] as const)(
    '%s closes requester sockets even before their first approved use',
    async (kind) => {
      const fixture = await channelSetup()
      workerConnection(fixture)
      const client = await openClient(fixture)
      const stopped = client.send({ kind: 'status' })
      await stopped
      if (kind === 'lock') await fixture.broker.lock()
      else await fixture.broker.endRequester(fixture.identity.id)
      await expect(client.send({ kind: 'status' })).rejects.toThrow()
      client.close()
      await fixture.claimed.release()
    },
  )
  it('duplicate hello and repeated sequence close the connection', async () => {
    const fixture = await channelSetup(),
      socket = await raw(fixture.socket)
    const hello = helloFrame(fixture)
    expect(await frame(socket, hello)).toMatchObject({ response: { kind: 'hello' } })
    const closed = closedOrReply(socket)
    socket.write(`${JSON.stringify({ ...hello, sequence: 1 })}\n`)
    expect(await closed).toBe('closed')
    await fixture.claimed.release()
  })
  it('a repeated sequence after hello closes even for a valid status request', async () => {
    const fixture = await channelSetup(),
      socket = await raw(fixture.socket)
    await frame(socket, helloFrame(fixture))
    const stopped = closedOrReply(socket)
    socket.write(`${JSON.stringify({ v: 1, sequence: 0, request: { kind: 'status' } })}\n`)
    expect(await stopped).toBe('closed')
    await fixture.claimed.release()
  })
  it('a conversation connection in the trusted host process cannot read first-party material', async () => {
    const fixture = await channelSetup(),
      entry = await fixture.firstParty()
    workerConnection(fixture)
    const identifyWorker = fixture.deps.identify
    fixture.deps.identify = async (facts, host, session) => {
      const identity = await identifyWorker(facts, host, session)
      return { ...identity, peer: { ...identity.peer, ui: true } }
    }
    const client = await openClient(fixture)
    expect(await client.send(entry.request)).toEqual({ kind: 'denied', reason: 'peer' })
    client.close()
    await fixture.claimed.release()
  })
  it('an oversized frame closes without dispatch or private diagnostics', async () => {
    const fixture = await channelSetup(),
      socket = await raw(fixture.socket)
    const hello = {
      v: 1,
      sequence: 0,
      request: {
        kind: 'hello',
        bootToken: fixture.claimed.location.bootToken,
        hostId: fixture.peer.hostId,
        hostSession: 'c'.repeat(32),
      },
    }
    await frame(socket, hello)
    fixture.deps.scrub = vi.fn(fixture.deps.scrub)
    const closed = closedOrReply(socket)
    socket.on('error', () => undefined)
    socket.write(
      `${JSON.stringify({ v: 1, sequence: 1, request: { kind: 'scrub', text: 'x'.repeat(VAULT_LIMITS.frameBytes) } })}\n`,
    )
    expect(await closed).toBe('closed')
    expect(fixture.deps.perform).not.toHaveBeenCalled()
    expect(fixture.deps.scrub).not.toHaveBeenCalled()
    await fixture.claimed.release()
  })
  it.each(['pid', 'user', 'start', 'image'] as const)(
    'Unix native identity rejects a bad %s from the process port',
    async (kind) => {
      const fixture = await channelSetup()
      const facts = { ...processIdentity }
      switch (kind) {
        case 'pid': {
          facts.processId += 1
          break
        }
        case 'user': {
          facts.userId = 'foreign-user'
          break
        }
        case 'start': {
          facts.startedAt = -1
          break
        }
        case 'image': {
          facts.executable = ''
          break
        }
      }
      const peers = new UnixVaultPeerVerifier(
        native.helper,
        () => Promise.resolve(facts),
        socketDescriptors,
      )
      await expect(
        VaultBrokerClient.open(
          fixture.claimed.location,
          fixture.peer.hostId,
          'c'.repeat(32),
          peers,
        ),
      ).rejects.toThrow()
      await fixture.claimed.release()
    },
  )
  it.each(['pid', 'start', 'brokerId', 'token'] as const)(
    'the client refuses a discovery %s mismatch',
    async (kind) => {
      const fixture = await channelSetup()
      const location = structuredClone(fixture.claimed.location)
      switch (kind) {
        case 'pid': {
          location.lock.processId += 1
          break
        }
        case 'start': {
          location.lock.startedAt += 1
          break
        }
        case 'brokerId': {
          location.lock.brokerId = '0'.repeat(32)
          break
        }
        case 'token': {
          location.bootToken = '0'.repeat(32)
          break
        }
      }
      await expect(
        VaultBrokerClient.open(location, fixture.peer.hostId, 'c'.repeat(32), fixture.peers),
      ).rejects.toThrow()
      await fixture.claimed.release()
    },
  )
  it('discovery pins process start and owner-only files; only one claimant wins', async () => {
    const fixture = await channelSetup()
    expect(await fixture.discovery.discover(identify)).toEqual(fixture.claimed.location)
    await expect(fixture.discovery.claim(processIdentity, fixture.socket)).rejects.toThrow()
    await expect(
      fixture.discovery.discover((pid) =>
        Promise.resolve({ ...processIdentity, processId: pid, startedAt: 101 }),
      ),
    ).rejects.toThrow()
    await chmod(path.join(fixture.discovery.directory, 'boot-token'), 0o644)
    await expect(fixture.discovery.discover(identify)).rejects.toThrow()
    await fixture.claimed.release()
  })
  it('shared epoch persists monotonically and is observed by another broker instance', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm109-b-epoch-'))
    directories.push(directory)
    const first = new VaultLockEpoch(directory),
      second = new VaultLockEpoch(directory)
    expect(await first.current()).toBe(0)
    const observed = Promise.withResolvers<number>()
    const unsubscribe = second.subscribe((value) => {
      if (value > 0) observed.resolve(value)
    })
    expect(await first.bump()).toBe(1)
    expect(await second.current()).toBe(1)
    expect(await observed.promise).toBe(1)
    expect(await second.bump()).toBe(2)
    unsubscribe()
  })
  it('an occupied epoch writer and counter overflow fail closed', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm109-b-epoch-fail-'))
    directories.push(directory)
    const epoch = new VaultLockEpoch(directory)
    const writer = path.join(directory, 'lock-epoch.writer')
    await writeFile(writer, '', { mode: 0o600 })
    await expect(epoch.bump()).rejects.toThrow()
    await rm(writer)
    await writeFile(
      path.join(directory, 'lock-epoch.v1'),
      JSON.stringify({ v: 1, epoch: Number.MAX_SAFE_INTEGER }),
      { mode: 0o600 },
    )
    await expect(epoch.bump()).rejects.toThrow()
  })
  it('blocked launch has a concrete first-party-only fallback', async () => {
    const fixture = await brokerFixture({ firstPartyOnly: true })
    brokers.push(fixture.broker)
    const client = new HostVaultBrokerClient(
      () => Promise.reject(new Error('test launch denied')),
      () => Promise.resolve({ broker: fixture.broker, peer: fixture.peer }),
    )
    const entry = await fixture.firstParty()
    const read = await client.read(entry.request)
    expect(read.equals(entry.bytes)).toBe(true)
    read.fill(0)
    const runtime = new RuntimeVaultBrokerClient(
      () => Promise.reject(new Error('test launch denied')),
      () => Promise.resolve({ broker: fixture.broker, peer: fixture.peer }),
    )
    const runtimeRead = await runtime.read(entry.request)
    expect(runtimeRead.equals(entry.bytes)).toBe(true)
    runtimeRead.fill(0)
    await expect(client.read({ ...entry.request, origin: 'https://other.test' })).rejects.toThrow()
    fixture.deps.firstPartyOnly = false
    await expect(client.read(entry.request)).rejects.toThrow()
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm109-b-process-'))
    directories.push(directory)
    const process = new VaultBrokerProcess(new VaultBrokerDiscovery(directory, 'session'), {
      identity: identify,
      launch: () => Promise.reject(new Error('test launch denied')),
    })
    await expect(process.get()).rejects.toThrow('test launch denied')
  })
  it('a child reporting ready without its authenticated discovery record is stopped', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm109-b-start-fail-'))
    directories.push(directory)
    const stop = vi.fn(() => Promise.resolve())
    const process = new VaultBrokerProcess(new VaultBrokerDiscovery(directory, 'session'), {
      identity: identify,
      launch: () => Promise.resolve({ ready: Promise.resolve(), stop }),
    })
    await expect(process.get()).rejects.toThrow()
    expect(stop).toHaveBeenCalledOnce()
  })
  it('trusted session taint cannot be cleared by a clean request frame', async () => {
    const fixture = await channelSetup()
    await fixture.change({ policy: { ...fixture.stored.metadata.policy, mode: 'alwaysAllow' } })
    fixture.standing()
    workerConnection(fixture)
    fixture.deps.taint = () =>
      Promise.resolve({ tainted: true, reasons: [{ source: 'web', label: 'Generated test page' }] })
    const client = await openClient(fixture)
    const answer = await client.send({
      kind: 'requestUse',
      proposal: {
        handle: fixture.stored.metadata.handle,
        use: use(),
        taint: { tainted: false, reasons: [] },
      },
    })
    expect(answer).toMatchObject({ kind: 'approval', request: { taint: { tainted: true } } })
    client.close()
    await fixture.claimed.release()
  })
  it('the secured named-pipe listener seam authenticates before dispatch and owns shutdown', async () => {
    const fixture = await channelSetup()
    await fixture.server.close()
    const listener = createServer()
    const stopped = vi.fn()
    fixture.deps.listener = {
      listen: async (socketPath, accepted) => {
        listener.on('connection', accepted)
        await new Promise<undefined>((resolve, reject) => {
          listener.once('error', reject)
          listener.listen(socketPath, () => {
            resolve(undefined)
          })
        })
        return async () => {
          stopped()
          await new Promise<undefined>((resolve, reject) =>
            listener.close((error) => {
              if (error) reject(error)
              else resolve(undefined)
            }),
          )
        }
      },
    }
    fixture.deps.peers = new WindowsVaultPeerVerifier(
      {
        inspect: () =>
          Promise.resolve({
            ...processIdentity,
            userId: 'S-1-5-test-owner',
            remote: false,
            ownerOnlyDacl: true,
          }),
      },
      'S-1-5-test-owner',
    )
    const server = new VaultChannelServer(fixture.deps)
    servers.push(server)
    await server.listen(fixture.socket)
    const client = await openClient(fixture)
    expect(await client.send({ kind: 'status' })).toMatchObject({ kind: 'status' })
    client.close()
    await server.close()
    expect(stopped).toHaveBeenCalledOnce()
    await fixture.claimed.release()
  })
  it('a listening or closed channel cannot be started again', async () => {
    const fixture = await channelSetup()
    await expect(fixture.server.listen(fixture.socket)).rejects.toThrow(UI_TEXT.vault.noAccess)
    await fixture.server.close()
    await expect(fixture.server.listen(fixture.socket)).rejects.toThrow(UI_TEXT.vault.noAccess)
    await fixture.claimed.release()
  })
})
describe('Windows named-pipe peer seam', () => {
  it.each(['sid', 'remote', 'dacl', 'pid', 'start', 'image'])(
    'refuses %s and never accepts a token instead of OS identity',
    async (attack) => {
      const facts = {
        ...processIdentity,
        userId: 'S-1-5-test-owner',
        remote: false,
        ownerOnlyDacl: true,
      }
      switch (attack) {
        case 'sid': {
          facts.userId = 'S-1-5-other'
          break
        }
        case 'remote': {
          facts.remote = true
          break
        }
        case 'dacl': {
          facts.ownerOnlyDacl = false
          break
        }
        case 'pid': {
          facts.processId = 0
          break
        }
        case 'start': {
          facts.startedAt = NaN
          break
        }
        case 'image': {
          {
            facts.executable = ''
            // No default
          }
          break
        }
      }
      const verifier = new WindowsVaultPeerVerifier(
        { inspect: () => Promise.resolve(facts) },
        'S-1-5-test-owner',
      )
      await expect(verifier.verify(new Socket())).rejects.toThrow()
    },
  )
})
