import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync, spawn, type SpawnOptions } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile, symlink, chmod } from 'node:fs/promises'
import type * as nodeFsPromises from 'node:fs/promises'
import { createServer, createConnection, type Socket } from 'node:net'
import type * as nodeNet from 'node:net'
import { once } from 'node:events'
import path from 'node:path'
import process from 'node:process'
import { vaultPrivateDirectory } from '../../../src/core/vault/broker/files'
import os from 'node:os'
import { build } from 'esbuild'
import {
  startVaultBrokerProcess,
  type VaultBrokerProcessOptions,
} from '../../../src/runtime/vault/brokerProcess'
import {
  vaultProcessIdentity,
  vaultSocketDescriptors,
  holdVaultStartupLock,
} from '../../../src/runtime/vault/posixNative'
import { VaultChannelServer } from '../../../src/core/vault/broker/channel'
import { UnixVaultPeerVerifier } from '../../../src/core/vault/broker/peer'
import { VaultBrokerClient } from '../../../src/core/vault/broker/client'
import { VAULT_BROKER_MAX_CONNECTIONS } from '../../../src/shared/constants'
import { VaultBrokerDiscovery } from '../../../src/core/vault/broker/discovery'
import { brokerFixture } from './brokerFixture'
import { fakeManagement } from '../helpers/vault/fakeManagement'
import { brokerRaceGates } from '../helpers/vault/brokerRaceGates'

// Test protocol/lifecycle over real kernel peers and flock; containment/admission have their own suites.
vi.mock('../../../src/core/resources/launcher', async () => {
  const { fixtureResourceCommand, fixtureResourceProcess } =
    await import('../helpers/resourceProcess')
  return {
    execResourceFile: fixtureResourceCommand,
    spawnResourceProcess: (
      profile: 'contained',
      file: string,
      args: readonly string[],
      options: SpawnOptions,
      extra: readonly number[] = [],
    ) => fixtureResourceProcess(profile, file, args, options, ['pipe', 'pipe', 'pipe', ...extra]),
  }
})
// Race-test gates: every other test keeps the real network and filesystem
// through these passthroughs; the error-window test enables the fake server
// and the chmod gate to hold the permission-fix window deterministically open.
vi.mock('node:net', async (importOriginal) => {
  const original = await importOriginal<typeof nodeNet>()
  const { brokerRaceGates } = await import('../helpers/vault/brokerRaceGates')
  // A real but never-bound server behind a proxy: the event surface stays
  // genuine while readiness, bound state and failures are test-driven, so no
  // kernel socket is needed (sandbox-proof). No method is overridden, so the
  // overload set needs no cast.
  function fakeServer() {
    const target = original.createServer()
    let isBound = false
    let listenCallback: (() => void) | undefined
    const entry = {
      server: new Proxy(target, {
        get(
          targetInner: nodeNet.Server,
          property: string | symbol,
          receiver: nodeNet.Server,
        ): unknown {
          if (property === 'listening') return isBound
          if (property === 'listen')
            return (path: string, listeningListener?: () => void) => {
              if (path.length === 0) throw new Error('test fake server needs a path')
              isBound = true
              if (listeningListener !== undefined) listenCallback = listeningListener
              return receiver
            }
          if (property === 'close')
            return (listeningListener?: () => void) => {
              isBound = false
              listeningListener?.()
              return receiver
            }
          const value: unknown = Reflect.get(targetInner, property, receiver)
          return typeof value === 'function' ? value.bind(targetInner) : value
        },
      }),
      notifyListening() {
        listenCallback?.()
      },
      emitTestError(error: Error) {
        const count = target.listenerCount('error')
        if (count > 0) target.emit('error', error)
        return count
      },
    }
    return entry
  }
  function createServer(
    ...args: Parameters<typeof original.createServer>
  ): ReturnType<typeof original.createServer> {
    if (!brokerRaceGates.fakeServer) return original.createServer(...args)
    const fake = fakeServer()
    brokerRaceGates.servers.push(fake)
    return fake.server
  }
  return { ...original, createServer }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof nodeFsPromises>()
  const { gatedChmod } = await import('../helpers/vault/brokerRaceGates')
  return {
    ...original,
    chmod: (...args: Parameters<typeof original.chmod>) =>
      gatedChmod(() => original.chmod(...args)),
  }
})
const heldLocks = new Set<Awaited<ReturnType<typeof holdVaultStartupLock>>>()
async function hold(file: string, helper: string = native.helper) {
  const held = await holdVaultStartupLock(helper, file)
  heldLocks.add(held)
  return held
}
const running = new Set<Awaited<ReturnType<typeof startVaultBrokerProcess>>>()
async function start(options: Parameters<typeof startVaultBrokerProcess>[0]) {
  const handle = await startVaultBrokerProcess(options)
  running.add(handle)
  return handle
}
afterEach(async () => {
  await Promise.all(
    [...heldLocks].map(async (held) => {
      await held.release()
      heldLocks.delete(held)
    }),
  )
  await Promise.all(
    [...running].map(async (handle) => {
      await handle.close()
      running.delete(handle)
    }),
  )
})
const native = { directory: '', helper: '', childEntry: '', suicide: '' }
beforeAll(async () => {
  if (process.platform === 'win32') return
  native.directory = await mkdtemp(path.join(os.tmpdir(), 'cm109-broker-'))
  native.helper = path.join(native.directory, 'peer')
  native.childEntry = path.join(native.directory, 'child.cjs')
  // A startup-lock guardian that reports readiness with one synchronous write
  // and then dies by signal, like a guardian killed after readiness but before
  // onLost subscribes (exitCode stays null, signalCode is set). Compiled C, so
  // it runs under the production empty environment with no interpreter lookup.
  native.suicide = path.join(native.directory, 'suicide')
  await writeFile(
    path.join(native.directory, 'suicide.c'),
    [
      '#include <stdio.h>',
      '#include <stdlib.h>',
      '#include <string.h>',
      '#include <time.h>',
      '#include <unistd.h>',
      '#include <signal.h>',
      'int main(int argc, char **argv) {',
      '  if (argc > 1 && strcmp(argv[1], "identity") == 0) {',
      '    int pid = argc > 2 ? atoi(argv[2]) : 0;',
      String.raw`    printf("{\"processId\":%d,\"userId\":\"%d\",\"startedAt\":%lld,\"executable\":\"suicide\"}\n",`,
      '      pid, (int)getuid(), (long long)time(0));',
      '    return 0;',
      '  }',
      String.raw`  static const char ready[] = "{\"v\":1,\"locked\":true}\n";`,
      '  if (write(STDOUT_FILENO, ready, sizeof(ready) - 1) < 0) return 1;',
      '  kill(getpid(), SIGKILL);',
      '  return 1;',
      '}',
      '',
    ].join('\n'),
  )
  execFileSync('/usr/bin/cc', [
    '-Os',
    '-Wall',
    '-Wextra',
    '-Werror',
    path.join(native.directory, 'suicide.c'),
    '-o',
    native.suicide,
  ])
  execFileSync('/usr/bin/cc', [
    '-Os',
    '-Wall',
    '-Wextra',
    '-Werror',
    'native/posix/vaultPeer.c',
    '-o',
    native.helper,
  ])
  await build({
    entryPoints: ['test/unit/helpers/vault/brokerProcessChild.ts'],
    outfile: native.childEntry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'fake-child-admission',
        setup: (builder) => {
          builder.onResolve({ filter: /resources\/launcher$/ }, () => ({
            path: path.resolve('test/unit/helpers/vault/brokerChildLauncher.ts'),
          }))
        },
      },
    ],
  })
})
afterAll(async () => {
  if (native.directory) await rm(native.directory, { recursive: true, force: true })
})

async function fixture(id: string, idleMs = 100) {
  const runDirectory = path.join(native.directory, id)
  const f = await brokerFixture()
  f.deps.identity.verifyHost = () => Promise.resolve(true)
  const peers = new UnixVaultPeerVerifier(
    native.helper,
    async (pid) => {
      const identity = await vaultProcessIdentity(native.helper, pid)
      if (!identity) throw new Error('gone')
      return identity
    },
    vaultSocketDescriptors,
  )
  const management = fakeManagement(await f.broker.status())
  const locked = vi.fn(async () => {
    await f.broker.lock()
  })
  const disposed = vi.fn(async () => {
    await f.broker.dispose()
  })
  const options = {
    runDirectory,
    userSession: 'test-session',
    helper: native.helper,
    idleMs,
    lock: locked,
    dispose: disposed,
    channel: (
      location: Parameters<Parameters<typeof startVaultBrokerProcess>[0]['channel']>[0],
      listener: Parameters<Parameters<typeof startVaultBrokerProcess>[0]['channel']>[1],
    ) =>
      new VaultChannelServer({
        broker: f.broker,
        manage: management.port,
        peers,
        listener,
        bootToken: location.bootToken,
        brokerId: location.lock.brokerId,
        identify: (identity, hostId) =>
          Promise.resolve({
            peer: { ...f.peer, hostId, processId: identity.processId, userId: identity.userId },
            requester: null,
            firstParty: true,
            manage: true,
          }),
        ceiling: () => 'ask',
        taint: () => Promise.resolve({ tainted: false, reasons: [] }),
        lifetime: () => ({ close: () => undefined, terminate: () => Promise.resolve(true) }),
        perform: () => Promise.reject(new Error('fake execution unavailable')),
        scrub: (text) => Promise.resolve(text),
      }),
  }
  return { f, options, peers, locked, disposed }
}

describe.skipIf(process.platform === 'win32')('POSIX vault broker lifecycle', () => {
  it('starts in owner-only files and locks before empty idle exit', async () => {
    const f = await fixture('idle')
    const handle = await start(f.options)
    const rootSample = await stat(path.dirname(handle.location.lock.socket))
    expect(rootSample.mode & 0o777).toBe(0o700)
    const socketSample = await stat(handle.location.lock.socket)
    expect(socketSample.mode & 0o777).toBe(0o600)
    await handle.closed
    expect(f.locked).toHaveBeenCalledOnce()
    expect(f.disposed).toHaveBeenCalledOnce()
    expect(f.locked.mock.invocationCallOrder[0]).toBeLessThan(
      f.disposed.mock.invocationCallOrder[0] ?? 0,
    )
    await expect(stat(handle.location.lock.socket)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('keeps two authenticated clients alive and exits after the last closes', async () => {
    const f = await fixture('two')
    const handle = await start(f.options)
    const a = await VaultBrokerClient.open(
      handle.location,
      f.f.peer.hostId,
      'c'.repeat(32),
      f.peers,
    )
    const b = await VaultBrokerClient.open(
      handle.location,
      f.f.peer.hostId,
      'c'.repeat(32),
      f.peers,
    )
    try {
      a.close()
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(f.locked).not.toHaveBeenCalled()
      const response = await b.send({ kind: 'status' })
      expect(response.kind).toBe('status')
      b.close()
      await handle.closed
      expect(f.disposed).toHaveBeenCalledOnce()
    } finally {
      a.close()
      b.close()
      await handle.close()
    }
  })
  it('refuses a concurrent broker without disturbing a live client', async () => {
    const f = await fixture('singleton', 1000)
    const handle = await start(f.options)
    const client = await VaultBrokerClient.open(
      handle.location,
      f.f.peer.hostId,
      'c'.repeat(32),
      f.peers,
    )
    const other = await fixture('singleton', 1000)
    try {
      await expect(start(other.options)).rejects.toThrow()
      const response = await client.send({ kind: 'status' })
      expect(response.kind).toBe('status')
    } finally {
      client.close()
      await handle.close()
      await other.f.broker.dispose()
    }
  })
  it('bounds open transport connections before accepting another frame', async () => {
    const f = await fixture('bounded', 1000)
    const accepted = vi.fn()
    let shutdown: (() => Promise<void>) | undefined
    const handle = await start({
      ...f.options,
      channel: (_location, listener) => ({
        listen: async (file) => {
          shutdown = await listener.listen(file, accepted)
        },
        close: async () => {
          await shutdown?.()
        },
      }),
    })
    const clients: Socket[] = []
    try {
      for (let count = 0; count < VAULT_BROKER_MAX_CONNECTIONS; count++) {
        const client = createConnection(handle.location.lock.socket)
        clients.push(client)
        await once(client, 'connect')
      }
      const excess = createConnection(handle.location.lock.socket)
      clients.push(excess)
      await once(excess, 'close')
      expect(accepted).toHaveBeenCalledTimes(VAULT_BROKER_MAX_CONNECTIONS)
    } finally {
      for (const client of clients) client.destroy()
      await handle.close()
    }
  })
  it('recovers a stale socket left before discovery was published', async () => {
    const f = await fixture('stale', 1000)
    const discovery = new VaultBrokerDiscovery(f.options.runDirectory, f.options.userSession)
    await vaultPrivateDirectory(discovery.directory)
    const socket = path.join(discovery.directory, 'broker.sock')
    const server = createServer()
    server.listen(socket)
    await once(server, 'listening')
    await chmod(socket, 0o600)
    // Rename the bound socket so Node close does not unlink the deliberately stale name.
    const { rename } = await import('node:fs/promises')
    await rename(socket, `${socket}.held`)
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve()
      }),
    )
    await rename(`${socket}.held`, socket)
    const handle = await start(f.options)
    await handle.close()
  })
  it('refuses a symlink and a permissive startup lock before any channel starts', async () => {
    const f = await fixture('hostile')
    const discovery = new VaultBrokerDiscovery(f.options.runDirectory, f.options.userSession)
    await vaultPrivateDirectory(discovery.directory)
    const file = path.join(discovery.directory, 'startup.lock'),
      target = path.join(native.directory, 'target')
    await writeFile(target, '', { mode: 0o600 })
    try {
      await symlink(target, file)
      await expect(start(f.options)).rejects.toThrow()
      await rm(file)
      await writeFile(file, '', { mode: 0o644 })
      await expect(start(f.options)).rejects.toThrow()
    } finally {
      await f.f.broker.dispose()
    }
  })
  it('retains a lock failure while disposing and releasing discovery and the kernel lock', async () => {
    const f = await fixture('failed-close', 1000)
    const handle = await startVaultBrokerProcess({
      ...f.options,
      lock: () => Promise.reject(new Error('generated lock failure')),
    })
    await expect(handle.close()).rejects.toThrow('generated lock failure')
    // A caller may observe close() first and subscribe to closed on a later turn.
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    await expect(handle.closed).rejects.toThrow('generated lock failure')
    expect(f.disposed).toHaveBeenCalledOnce()
    await expect(
      stat(path.join(path.dirname(handle.location.lock.socket), 'broker.lock')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(handle.location.lock.socket)).rejects.toMatchObject({ code: 'ENOENT' })
    const next = await hold(path.join(path.dirname(handle.location.lock.socket), 'startup.lock'))
    await next.release()
  })
  it('releases its native kernel lock on private-input EOF', async () => {
    const file = path.join(native.directory, 'kernel.lock')
    const held = await hold(file)
    await expect(hold(file)).rejects.toThrow()
    await held.release()
    const next = await hold(file)
    await next.release()
    expect(await vaultProcessIdentity(native.helper, process.pid)).toMatchObject({
      processId: process.pid,
      userId: String(process.getuid?.()),
    })
    expect(await vaultProcessIdentity(native.helper, 2_147_483_647)).toBeNull()
  })
  it('restarts after SIGKILL without trusting stale discovery or leaking its guardian', async () => {
    const f = await fixture('crash', 1000)
    const child = spawn(
      process.execPath,
      [native.childEntry, f.options.runDirectory, native.helper],
      {
        env: { PATH: process.env['PATH'] },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    const ready = await new Promise<string>((resolve, reject) => {
      child.stdout.once('data', (bytes: Buffer) => {
        resolve(bytes.toString('utf8'))
      })
      child.stderr.once('data', (bytes: Buffer) => {
        reject(new Error(bytes.toString('utf8')))
      })
      child.once('exit', () => {
        reject(new Error('fake child exited before readiness'))
      })
      child.once('error', reject)
    })
    expect(ready).toBe('ready\n')
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    const handle = await start(f.options)
    try {
      const client = await VaultBrokerClient.open(
        handle.location,
        f.f.peer.hostId,
        'c'.repeat(32),
        f.peers,
      )
      const response = await client.send({ kind: 'status' })
      expect(response.kind).toBe('status')
      client.close()
    } finally {
      await handle.close()
    }
  })
  it('notifies lock loss when the guardian died by signal before subscribing', async () => {
    const file = path.join(native.directory, 'signal.lock')
    const held = await hold(file, native.suicide)
    heldLocks.delete(held)
    try {
      // Let the reaper run so the death is fully in the past: exitCode is null
      // and only signalCode records the kill, exactly the missed state.
      await new Promise((resolve) => setTimeout(resolve, 300))
      let notified = 0
      held.onLost(() => {
        notified += 1
      })
      // The replay is synchronous; one more turn covers a not-yet-reaped exit.
      await new Promise((resolve) => setImmediate(resolve))
      expect(notified).toBe(1)
    } finally {
      await held.release()
    }
  })
  it('shuts down when the server fails during the socket permission fix', async () => {
    const f = await fixture('error-during-chmod', 1000)
    // A channel double that never binds: the fake server reports readiness
    // and failures without a kernel socket, so this test is sandbox-proof.
    brokerRaceGates.fakeServer = true
    brokerRaceGates.chmodGated = true
    try {
      const started = start({
        ...f.options,
        channel: (_location, listener) => ({
          listen: async (file) => {
            await listener.listen(file, () => undefined)
          },
          close: () => Promise.resolve(),
        }),
      })
      await vi.waitFor(() => {
        expect(brokerRaceGates.servers.length).toBe(1)
      })
      const server = brokerRaceGates.servers[0]
      if (!server) throw new Error('expected a fake broker server')
      server.notifyListening()
      await vi.waitFor(() => {
        expect(brokerRaceGates.chmodEntered).toBe(true)
      })
      // The chmod await is now in flight: a server failure here must still
      // reach the shutdown handler subscribed before that await.
      expect(server.emitTestError(new Error('test server failed during chmod'))).toBeGreaterThan(0)
      await vi.waitFor(() => {
        expect(f.locked).toHaveBeenCalled()
      })
      brokerRaceGates.releaseChmod()
      await expect(started).rejects.toThrow()
      // The shutdown owned the raw server even though the channel never
      // learned it (RVCM1091B2 P2): without that, the server stays bound
      // here and the broker process never exits.
      expect(server.server.listening).toBe(false)
      await expectMissingSocket(f.options)
    } finally {
      // Always let the permission fix settle: with a broken guard the startup
      // below would otherwise stay pending on the gate and strand its kernel
      // lock past teardown.
      brokerRaceGates.releaseChmod()
      await f.f.broker.dispose()
      brokerRaceGates.reset()
    }
  })
  it('refuses startup when the guardian died by signal before lock-loss subscribes', async () => {
    const f = await fixture('guardian-signal', 1000)
    // A channel double that never binds: reaching it proves startup wrongly
    // survived the dead guardian (this also keeps the test sandbox-proof,
    // since real socket listen is unavailable under some sandboxes).
    const reachedChannel = vi.fn(() => ({
      listen: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }))
    try {
      await expect(
        start({ ...f.options, helper: native.suicide, channel: reachedChannel }),
      ).rejects.toThrow()
      expect(reachedChannel).not.toHaveBeenCalled()
      await expectMissingSocket(f.options)
    } finally {
      await f.f.broker.dispose()
    }
  })
})

async function expectMissingSocket(options: VaultBrokerProcessOptions) {
  const discovery = new VaultBrokerDiscovery(options.runDirectory, options.userSession)
  await expect(stat(path.join(discovery.directory, 'broker.sock'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
}
