import { describe, it, expect, vi } from 'vitest'
import { Socket, connect } from 'node:net'
import { mkdtemp, lstat, rm } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
vi.mock('node:net', async (load) => {
  const actual = await load<Record<string, unknown>>()
  return {
    ...actual,
    connect: vi.fn(() => {
      throw new Error('test refuses all upstream dials')
    }),
  }
})
import {
  createSshEndpoint,
  sshProcessEnvironment,
  unixSshListener,
  type SshListenerPort,
} from '../../../src/core/vault/ssh/endpoint'
import {
  frontUserSshAgent,
  connectUserSshAgent,
  type SshAgentConnection,
} from '../../../src/core/vault/ssh/externalAgent'
import { type VaultProcessIdentity } from '../../../src/core/vault/broker/peer'
import { SSH, sshString, uint32 } from '../../../src/core/vault/ssh/wire'
import { signSshData } from '../../../src/core/vault/ssh/keys'
import { sshFixture } from './sshFixture'

function peer(): VaultProcessIdentity {
  return { processId: 100, userId: 'test-owner', startedAt: 1, executable: '/trusted/ssh' }
}
function listenerFixture(kind: SshListenerPort['kind'] = 'unix') {
  let accept: ((socket: Socket) => void) | undefined
  const close = vi.fn(() => Promise.resolve())
  const listener: SshListenerPort = {
    kind,
    listen: vi.fn<SshListenerPort['listen']>((_address, receive) => {
      accept = receive
      return Promise.resolve({ close })
    }),
  }
  return {
    listener,
    close,
    accept: (socket: Socket) => {
      if (!accept) throw new Error('listener not created')
      accept(socket)
    },
  }
}
describe('SSH requester endpoints and external agents', () => {
  it('uses an owner-only Unix socket and refuses to replace an existing address', async () => {
    if (process.platform === 'win32') {
      await expect(
        createSshEndpoint({
          platform: 'win32',
          runDirectory: '/run',
          listener: unixSshListener,
          peers: { verify: () => Promise.resolve(peer()) },
          access: () => Promise.reject(new Error('unreachable')),
          knownHosts: { read: () => Promise.resolve('') },
          terminate: () => Promise.resolve(true),
        }),
      ).rejects.toThrow()
      return
    }
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm109-s-')),
      address = path.join(directory, 'a.sock')
    try {
      const listener = await unixSshListener.listen(address, (socket) => {
        socket.destroy()
      })
      try {
        const stat = await lstat(address)
        expect(stat.mode & fsConstants.S_IRWXU).toBe(fsConstants.S_IRUSR | fsConstants.S_IWUSR)
        expect(stat.mode & (fsConstants.S_IRWXG | fsConstants.S_IRWXO)).toBe(0)
        await expect(unixSshListener.listen(address, () => undefined)).rejects.toThrow()
      } finally {
        await listener.close()
      }
      const directoryStat = await lstat(directory)
      expect(directoryStat.isDirectory()).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('destroys sockets and cancels peer lookups when listener setup fails after accepting', async () => {
    const socket = new Socket(),
      verified = Promise.withResolvers<VaultProcessIdentity>(),
      access = vi.fn(() => Promise.reject(new Error('must not acquire')))
    await expect(
      createSshEndpoint({
        platform: 'darwin',
        runDirectory: '/run',
        listener: {
          kind: 'unix',
          listen: (_address, accept) => {
            accept(socket)
            return Promise.reject(new Error('listener failed'))
          },
        },
        peers: { verify: () => verified.promise },
        access,
        knownHosts: { read: () => Promise.resolve('') },
        terminate: () => Promise.resolve(true),
      }),
    ).rejects.toThrow()
    verified.resolve(peer())
    await Promise.resolve()
    expect(socket.destroyed).toBe(true)
    expect(access).not.toHaveBeenCalled()
  })
  it('makes isolated Unix sockets and private Windows pipes and pins Windows OpenSSH for git', async () => {
    const f = sshFixture(),
      listeners = listenerFixture()
    const deps = {
      platform: 'darwin' as const,
      runDirectory: '/private/run',
      listener: listeners.listener,
      peers: { verify: () => Promise.resolve(peer()) },
      access: () => Promise.resolve(f.access),
      knownHosts: { read: () => Promise.resolve('') },
      terminate: () => Promise.resolve(true),
    }
    const first = await createSshEndpoint(deps),
      second = await createSshEndpoint(deps),
      windows = await createSshEndpoint({
        ...deps,
        platform: 'win32',
        listener: listenerFixture('windowsOwnerOnly').listener,
      })
    try {
      expect(first.address).not.toBe(second.address)
      expect(first.address.replaceAll('\\', '/')).toMatch(/\/s-[\w-]+\.sock$/u)
      expect(
        sshProcessEnvironment(windows.address, {
          platform: 'win32',
          gitSshSupportsPipe: false,
          windowsOpenSshPath: String.raw`C:\Windows\System32\OpenSSH\ssh.exe`,
        }),
      ).toEqual({
        SSH_AUTH_SOCK: windows.address,
        GIT_SSH_COMMAND: "'C:/Windows/System32/OpenSSH/ssh.exe'",
      })
      expect(
        sshProcessEnvironment(windows.address, { platform: 'win32', gitSshSupportsPipe: true }),
      ).toEqual({ SSH_AUTH_SOCK: windows.address })
      expect(
        sshProcessEnvironment(first.address, { platform: 'darwin', gitSshSupportsPipe: false }),
      ).toEqual({ SSH_AUTH_SOCK: first.address })
      expect(() =>
        sshProcessEnvironment(windows.address, { platform: 'win32', gitSshSupportsPipe: false }),
      ).toThrow()
      expect(() =>
        sshProcessEnvironment(String.raw`\\.\pipe\openssh-ssh-agent`, {
          platform: 'win32',
          gitSshSupportsPipe: true,
        }),
      ).toThrow()
      expect(() =>
        sshProcessEnvironment(windows.address, {
          platform: 'win32',
          gitSshSupportsPipe: false,
          windowsOpenSshPath: 'C:/tool"/OpenSSH/ssh.exe',
        }),
      ).toThrow()
      await expect(createSshEndpoint({ ...deps, platform: 'win32' })).rejects.toThrow()
    } finally {
      await first.close()
      await second.close()
      await windows.close()
      f.dispose()
    }
  })
  it('refuses a foreign peer and a process launched for another requester before reading agent messages', async () => {
    for (const failAt of ['peer', 'requester']) {
      const f = sshFixture(),
        listeners = listenerFixture(),
        socket = new Socket()
      const endpoint = await createSshEndpoint({
        platform: 'darwin',
        runDirectory: '/run',
        listener: listeners.listener,
        peers: {
          verify: () =>
            failAt === 'peer' ? Promise.reject(new Error('foreign uid')) : Promise.resolve(peer()),
        },
        access: vi.fn(() => Promise.reject(new Error('foreign requester'))),
        knownHosts: { read: () => Promise.resolve('') },
        terminate: () => Promise.resolve(true),
      })
      try {
        listeners.accept(socket)
        await vi.waitFor(() => {
          expect(socket.destroyed).toBe(true)
        })
        expect(f.access.identities).not.toHaveBeenCalled()
      } finally {
        await endpoint.close()
        f.dispose()
      }
    }
  })
  it('connection close during peer lookup refuses the late access and endpoint close owns every socket', async () => {
    const f = sshFixture(),
      listeners = listenerFixture(),
      socket = new Socket(),
      verified = Promise.withResolvers<VaultProcessIdentity>()
    const access = vi.fn(() => Promise.resolve(f.access))
    const endpoint = await createSshEndpoint({
      platform: 'darwin',
      runDirectory: '/run',
      listener: listeners.listener,
      peers: { verify: () => verified.promise },
      access,
      knownHosts: { read: () => Promise.resolve('') },
      terminate: () => Promise.resolve(true),
    })
    try {
      listeners.accept(socket)
      socket.destroy()
      socket.emit('close')
      verified.resolve(peer())
      await Promise.resolve()
      expect(access).not.toHaveBeenCalled()
      await endpoint.close()
      expect(listeners.close).toHaveBeenCalledOnce()
    } finally {
      await endpoint.close()
      f.dispose()
    }
  })
  it('endpoint close during requester lookup never installs a late signing session', async () => {
    const f = sshFixture(),
      listeners = listenerFixture('windowsOwnerOnly'),
      socket = new Socket(),
      ready = Promise.withResolvers<typeof f.access>(),
      entered = Promise.withResolvers<undefined>()
    const endpoint = await createSshEndpoint({
      platform: 'win32',
      runDirectory: '/run',
      listener: listeners.listener,
      peers: { verify: () => Promise.resolve(peer()) },
      access: () => {
        entered.resolve(undefined)
        return ready.promise
      },
      knownHosts: { read: () => Promise.resolve('') },
      terminate: () => Promise.resolve(true),
    })
    try {
      listeners.accept(socket)
      await entered.promise
      await endpoint.close()
      ready.resolve(f.access)
      await Promise.resolve()
      expect(socket.destroyed).toBe(true)
      expect(f.access.identities).not.toHaveBeenCalled()
    } finally {
      await endpoint.close()
      f.dispose()
    }
  })
  it('fronts only reviewed identities, replays verified binds upstream and validates/erases replies', async () => {
    const f = sshFixture(),
      closed = vi.fn(),
      frames: Buffer[] = [],
      responses: Buffer[] = []
    const connection: SshAgentConnection = {
      close: closed,
      request: (frame) => {
        frames.push(Buffer.from(frame))
        const type = frame[4]
        let response: Buffer
        if (type === SSH.identities)
          response = Buffer.concat([
            Buffer.from([SSH.identitiesAnswer]),
            uint32(1),
            sshString(f.blob),
            sshString('untrusted upstream comment'),
          ])
        else if (type === SSH.extension) response = Buffer.from([SSH.success])
        else
          response = Buffer.concat([
            Buffer.from([SSH.signAnswer]),
            sshString(signSshData(f.key.privateKey, f.blob, Buffer.from('data'), 0)),
          ])

        responses.push(response)
        return Promise.resolve(response)
      },
    }
    const front = frontUserSshAgent({
      open: () => Promise.resolve(connection),
      metadata: () => Promise.resolve(f.identity.item),
    })
    try {
      const identities = await front.identities(new AbortController().signal)
      expect(identities[0]).toMatchObject({
        source: 'external',
        item: { label: f.identity.item.label },
      })
      const signature = await front.sign(
        f.blob,
        Buffer.from('data'),
        0,
        new AbortController().signal,
        [f.bind()],
      )
      expect(signature.every((byte) => byte === 0)).toBe(false)
      signature.fill(0)
      expect(frames.map((frame) => frame[4])).toEqual([SSH.identities, SSH.extension, SSH.sign])
      expect(responses.every((response) => response.every((byte) => byte === 0))).toBe(true)
      expect(closed).toHaveBeenCalledTimes(2)
      const unreviewed = frontUserSshAgent({
        open: () => Promise.resolve(connection),
        metadata: () => Promise.resolve(null),
      })
      expect(await unreviewed.identities(new AbortController().signal)).toEqual([])
    } finally {
      f.dispose()
    }
  })
  it('refuses malformed identity replies, failed upstream binding and invalid upstream signatures', async () => {
    const f = sshFixture()
    try {
      for (const response of [
        Buffer.from([SSH.failure]),
        Buffer.concat([Buffer.from([SSH.identitiesAnswer]), uint32(0), Buffer.from([1])]),
      ]) {
        const close = vi.fn(),
          front = frontUserSshAgent({
            open: () =>
              Promise.resolve({ close, request: () => Promise.resolve(Buffer.from(response)) }),
            metadata: () => Promise.resolve(f.identity.item),
          })
        await expect(front.identities(new AbortController().signal)).rejects.toThrow()
        expect(close).toHaveBeenCalledOnce()
      }
      for (const bindings of [[], [f.bind()]]) {
        const front = frontUserSshAgent({
          open: () =>
            Promise.resolve({
              close: vi.fn(),
              request: () =>
                Promise.resolve(
                  Buffer.concat([Buffer.from([SSH.signAnswer]), sshString(Buffer.alloc(64))]),
                ),
            }),
          metadata: () => Promise.resolve(f.identity.item),
        })
        await expect(
          front.sign(f.blob, Buffer.from('data'), 0, new AbortController().signal, bindings),
        ).rejects.toThrow()
      }
      await expect(
        connectUserSshAgent(
          String.raw`\\.\pipe\openssh-ssh-agent`,
          () => Promise.resolve(),
          new AbortController().signal,
        ),
      ).rejects.toThrow()
      expect(connect).not.toHaveBeenCalled()
    } finally {
      f.dispose()
    }
  })
  it('validates every returned external public key against its metadata', async () => {
    const f = sshFixture(),
      front = frontUserSshAgent({
        open: () =>
          Promise.resolve({
            close: vi.fn(),
            request: () =>
              Promise.resolve(
                Buffer.concat([
                  Buffer.from([SSH.identitiesAnswer]),
                  uint32(1),
                  sshString(f.blob),
                  sshString('comment'),
                ]),
              ),
          }),
        metadata: () =>
          Promise.resolve({
            ...f.identity.item,
            fingerprint: 'SHA256:' + Buffer.alloc(32).toString('base64').replace(/=+$/u, ''),
          }),
      })
    try {
      await expect(front.identities(new AbortController().signal)).rejects.toThrow()
    } finally {
      f.dispose()
    }
  })
  it('refuses a failed upstream bind even when that agent would return a valid signature', async () => {
    const f = sshFixture(),
      failed = Buffer.from([SSH.failure]),
      close = vi.fn()
    const front = frontUserSshAgent({
      open: () =>
        Promise.resolve({
          close,
          request: (frame) =>
            Promise.resolve(
              frame[4] === SSH.extension
                ? failed
                : Buffer.concat([
                    Buffer.from([SSH.signAnswer]),
                    sshString(signSshData(f.key.privateKey, f.blob, Buffer.from('data'), 0)),
                  ]),
            ),
        }),
      metadata: () => Promise.resolve(f.identity.item),
    })
    try {
      await expect(
        front.sign(f.blob, Buffer.from('data'), 0, new AbortController().signal, [f.bind()]),
      ).rejects.toThrow()
      expect(failed.every((byte) => byte === 0)).toBe(true)
      expect(close).toHaveBeenCalledOnce()
    } finally {
      f.dispose()
    }
  })
})
