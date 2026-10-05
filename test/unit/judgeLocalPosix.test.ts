import { createHash } from 'node:crypto'
import path from 'node:path'
import { Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { posixPeer, type PosixPeerInstallation } from '../../src/core/judge/local/posixPeer'

const rig = vi.hoisted(() => ({
  fault: '',
  tableReads: 0,
  root: '',
  address: '127.0.0.1',
  family: 'IPv4',
  execCalls: [] as object[],
}))
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn((file: string) => {
    if (file.endsWith('/tcp') || file.endsWith('/tcp6')) {
      rig.tableReads++
      const address = rig.family === 'IPv6' ? '00000000000000000000000001000000' : '0100007F'
      const remote = rig.fault === 'tuple' ? '0001' : 'C350'
      const inode = rig.fault === 'inode-change' && rig.tableReads > 1 ? '124' : '123'
      const uid = rig.fault === 'foreign' ? '1001' : '1000'
      return Promise.resolve(
        `header\n0: ${address}:BF68 ${address}:${remote} 01 0:0 0:0 0 ${uid} 0 ${inode}\n`,
      )
    }
    const start = rig.fault === 'start-time' ? '778' : '777'
    return file.endsWith('/stat')
      ? Promise.resolve(
          `4242 (ollama with spaces) ${['S', ...Array.from({ length: 18 }, () => '0'), start].join(' ')}`,
        )
      : Promise.resolve(Buffer.from('vetted runtime fixture'))
  }),
  readdir: vi.fn((file: string) => {
    if (file === '/proc')
      return Promise.resolve(rig.fault === 'multiple' ? ['4242', '4343'] : ['4242'])
    return rig.fault === 'hidden'
      ? Promise.reject(Object.assign(new Error('hidden'), { code: 'EACCES' }))
      : Promise.resolve(['7'])
  }),
  readlink: vi.fn((file: string) => {
    if (file.includes('/fd/'))
      return Promise.resolve(
        rig.fault === 'inode-change' && rig.tableReads > 1 ? 'socket:[124]' : 'socket:[123]',
      )
    return Promise.resolve(
      rig.fault === 'namespace' && file.includes('/4242/') ? 'ns:[2]' : 'ns:[1]',
    )
  }),
  realpath: vi.fn((file: string) =>
    Promise.resolve(rig.fault === 'redirect' ? '/redirected' : file),
  ),
  stat: vi.fn(() => Promise.resolve({ uid: 1000 })),
}))
vi.mock('node:child_process', () => {
  const execFile = vi.fn()
  Object.defineProperty(execFile, Symbol.for('nodejs.util.promisify.custom'), {
    value: (_file: string, _args: string[], options: object) => {
      rig.execCalls.push(options)
      const address = rig.family === 'IPv6' ? '[::1]' : '127.0.0.1'
      const remote = rig.fault === 'tuple' ? '1' : '50000'
      const uid = rig.fault === 'foreign' ? '1001' : '1000'
      const row = `p4242\0u${uid}\0f7\0n${address}:49000->${address}:${remote}\0TST=ESTABLISHED\0TQR=0\0\n`
      return Promise.resolve({ stdout: rig.fault === 'multiple' ? row + row : row, stderr: '' })
    },
  })
  return { execFile }
})

beforeEach(() => {
  rig.fault = ''
  rig.tableReads = 0
  rig.execCalls = []
  rig.root = path.resolve('temp/posix-model-fixture')
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function fixture(platform: 'linux' | 'darwin', family = 'IPv4') {
  rig.family = family
  const socket = new Socket()
  Object.defineProperties(socket, {
    remoteAddress: { value: family === 'IPv6' ? '::1' : '127.0.0.1' },
    localAddress: { value: family === 'IPv6' ? '::1' : '127.0.0.1' },
    remoteFamily: { value: family },
    remotePort: { value: 49_000 },
    localPort: { value: 50_000 },
  })
  vi.stubGlobal('process', { ...process, platform, getuid: () => 1000 })
  const installed: PosixPeerInstallation = {
    platform,
    executable: '/runtime/ollama',
    uid: 1000,
    modelDirectory: rig.root,
    executableDigest: createHash('sha256').update('vetted runtime fixture').digest('hex'),
  }
  let count = 0
  const lease = {
    identity: vi.fn(() =>
      Promise.resolve({
        pid: 4242,
        uid: 1000,
        creationTime: rig.fault === 'pid-reuse' && count++ ? '778' : '777',
        executable: '/runtime/ollama',
      }),
    ),
    isAlive: vi.fn(() => Promise.resolve(rig.fault !== 'dead')),
    close: vi.fn(() => Promise.resolve()),
  }
  const deps = {
    acquireProcess: vi.fn(() => Promise.resolve(lease)),
    verifyLocalVolume: vi.fn(() =>
      rig.fault === 'volume'
        ? Promise.reject(new Error('unverified-model-volume'))
        : Promise.resolve(),
    ),
  }
  return { socket, installed, lease, deps }
}

describe.each(['linux', 'darwin'] as const)(
  'M98 J2 %s design guard (fake native evidence)',
  (platform) => {
    it.each(['IPv4', 'IPv6'])(
      'requires the full %s tuple and a held lifetime lease',
      async (family) => {
        const f = fixture(platform, family)
        const result = await posixPeer(f.socket, f.installed, f.deps, new AbortController().signal)
        expect(JSON.parse(result)).toMatchObject({
          pid: 4242,
          creationTime: '777',
          uid: 1000,
          executableDigest: f.installed.executableDigest,
        })
        expect(f.lease.identity).toHaveBeenCalledTimes(2)
        expect(f.lease.isAlive).toHaveBeenCalledTimes(1)
        expect(f.lease.close).toHaveBeenCalledTimes(1)
        if (platform === 'darwin')
          for (const call of rig.execCalls) expect(call).toHaveProperty('env', {})
      },
    )
    it.each([
      'tuple',
      'foreign',
      'multiple',
      'redirect',
      'volume',
      'pid-reuse',
      'dead',
      'fingerprint',
    ])('refuses %s ambiguity', async (fault) => {
      const f = fixture(platform)
      rig.fault = fault
      if (fault === 'fingerprint') Object.assign(f.installed, { executableDigest: 'wrong' })
      await expect(
        posixPeer(f.socket, f.installed, f.deps, new AbortController().signal),
      ).rejects.toThrow('unverified')
      if (f.deps.acquireProcess.mock.calls.length > 0)
        expect(f.lease.close).toHaveBeenCalledTimes(1)
      expect(f.socket.bytesWritten).toBe(0)
    })
  },
)
describe('M98 J2 Linux namespace and ownership evidence', () => {
  it.each(['namespace', 'hidden', 'inode-change', 'start-time'])(
    'refuses %s without trusting visibility',
    async (fault) => {
      const f = fixture('linux')
      rig.fault = fault
      await expect(
        posixPeer(f.socket, f.installed, f.deps, new AbortController().signal),
      ).rejects.toThrow('unverified')
      expect(f.socket.bytesWritten).toBe(0)
    },
  )
  it('refuses an unsupported platform and an absent native lease', async () => {
    const f = fixture('linux')
    vi.stubGlobal('process', { ...process, platform: 'win32', getuid: () => 1000 })
    await expect(
      posixPeer(f.socket, f.installed, f.deps, new AbortController().signal),
    ).rejects.toThrow('unverified-platform')
    vi.stubGlobal('process', { ...process, platform: 'linux', getuid: () => 1000 })
    f.deps.acquireProcess.mockRejectedValue(new Error('unverified-native-lifetime'))
    await expect(
      posixPeer(f.socket, f.installed, f.deps, new AbortController().signal),
    ).rejects.toThrow('unverified-native-lifetime')
  })
})
