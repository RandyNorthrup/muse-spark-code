// RVCM109JE P2-3: the broker socket lives in a bounded owner-only location
// outside the data folder. Real filesystem checks throughout; only the two
// kernel-bind cases need a Unix-socket bind and skip honestly where the
// sandbox forbids it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  rmdir,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { once } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { agentDataFolder } from '../../../src/runtime/dataFolder'
import {
  assertVaultSocketLength,
  expectedVaultSocketLocations,
  ensureVaultSocketDirectory,
  isPathWithin,
  resolveVaultSocket,
  vaultBrokerSocketIn,
  vaultSocketBaseCandidates,
  vaultSocketFallbackBase,
  vaultSocketPathLimit,
  verifyVaultSocketBase,
  verifyVaultSocketFile,
} from '../../../src/core/vault/broker/socketDirectory'
import { UI_TEXT } from '../../../src/shared/constants'

const root = { directory: '' }
const bind = { available: false }
beforeAll(async () => {
  root.directory = await mkdtemp(path.join(os.tmpdir(), 'vsock-'))
  // One honest probe: a kernel bind this sandbox forbids skips the two
  // bind cases below instead of failing them.
  const probe = path.join(root.directory, 'probe.sock')
  const server = createServer()
  bind.available = await new Promise<boolean>((resolve) => {
    server.once('error', () => {
      resolve(false)
    })
    server.listen(probe, () => {
      server.close(() => {
        resolve(true)
      })
    })
  })
})
afterAll(async () => {
  if (root.directory) await rm(root.directory, { recursive: true, force: true })
})
function skipWithoutBind(context: { skip(): void }): void {
  if (!bind.available) context.skip()
}
function input(): {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  tmpdir: string
  homeDir: string
} {
  // A fake home: the fallback must never touch the real one in tests.
  return { platform: process.platform, env: process.env, tmpdir: os.tmpdir(), homeDir: fakeHome() }
}
function fakeHome(): string {
  return path.join(root.directory, 'home')
}

describe('bounded owner-only broker socket location', () => {
  it('names the leaf from a short hash of the data folder', () => {
    const first = vaultBrokerSocketIn(root.directory || os.tmpdir(), '/data/one')
    const same = vaultBrokerSocketIn(root.directory || os.tmpdir(), '/data/one')
    const other = vaultBrokerSocketIn(root.directory || os.tmpdir(), '/data/two')
    expect(first).toEqual(same)
    expect(first.directory).not.toBe(other.directory)
    expect(path.basename(first.directory)).toMatch(/^muse-spark-vault-[0-9a-f]{12}$/u)
    expect(path.basename(first.socket)).toBe('broker.sock')
    expect(path.dirname(first.socket)).toBe(first.directory)
  })
  it('prefers the per-user runtime directory on Linux and falls back alike everywhere', () => {
    expect(
      vaultSocketBaseCandidates({
        platform: 'linux',
        env: { XDG_RUNTIME_DIR: '/run/user/7' },
        tmpdir: '/tmp',
        homeDir: '/home/test',
      }),
    ).toEqual(['/run/user/7', '/tmp'])
    expect(
      vaultSocketBaseCandidates({
        platform: 'linux',
        env: {},
        tmpdir: '/tmp',
        homeDir: '/home/test',
      }),
    ).toEqual(['/tmp'])
    expect(
      vaultSocketBaseCandidates({
        platform: 'linux',
        env: { XDG_RUNTIME_DIR: 'relative' },
        tmpdir: '/tmp',
        homeDir: '/home/test',
      }),
    ).toEqual(['/tmp'])
    expect(
      vaultSocketBaseCandidates({
        platform: 'darwin',
        env: { XDG_RUNTIME_DIR: '/run/user/7' },
        tmpdir: '/tmp',
        homeDir: '/home/test',
      }),
    ).toEqual(['/tmp'])
    expect(vaultSocketFallbackBase('/home/test')).toBe(
      path.join('/home/test', '.muse-spark-code', 'run'),
    )
    expect(vaultSocketFallbackBase('relative')).toBeNull()
  })
  // Owner-only POSIX modes and uid checks do not exist on Windows (the
  // product speaks named pipes there and never verifies socket files).
  it.skipIf(process.platform === 'win32')(
    'resolves the runtime directory when it verifies and falls back when it does not',
    async () => {
      const runtime = path.join(root.directory, 'run')
      await mkdir(runtime, { mode: 0o700 })
      const resolved = await resolveVaultSocket('/data/one', {
        platform: 'linux',
        env: { XDG_RUNTIME_DIR: runtime },
        tmpdir: os.tmpdir(),
        homeDir: fakeHome(),
      })
      expect(path.dirname(resolved.socket)).toContain(runtime)
      // A hostile runtime directory (a symlink) falls back to the next candidate.
      const link = path.join(root.directory, 'run-link')
      await symlink(runtime, link)
      const fallback = await resolveVaultSocket('/data/one', {
        platform: 'linux',
        env: { XDG_RUNTIME_DIR: link },
        tmpdir: runtime,
        homeDir: fakeHome(),
      })
      expect(path.dirname(fallback.socket)).toContain(runtime)
      expect(fallback.socket).not.toContain('run-link')
    },
  )
  it.skipIf(process.platform === 'win32')(
    'creates the home fallback when no shared base verifies, and skips an over-long shared base',
    async () => {
      // Headless Linux: no runtime directory, unusable temporary root (a
      // file). The fallback home stays short so the bounded leaf still binds.
      const home = '/tmp'
      const dataDir = '/data/fallback-test'
      const notADirectory = path.join(root.directory, 'not-a-directory')
      await writeFile(notADirectory, '', { mode: 0o600 })
      const leaves = new Set<string>()
      try {
        const created = await resolveVaultSocket(dataDir, {
          platform: 'linux',
          env: {},
          tmpdir: notADirectory,
          homeDir: home,
        })
        leaves.add(created.directory)
        expect(created.directory).toContain(path.join(home, '.muse-spark-code', 'run'))
        expect(Buffer.byteLength(created.socket, 'utf8')).toBeLessThanOrEqual(107)
        // A fitting fallback wins over an over-long shared base.
        const deep = path.join(root.directory, 'f'.repeat(80), 'g'.repeat(80))
        await mkdir(deep, { recursive: true, mode: 0o700 })
        const skipped = await resolveVaultSocket(dataDir, {
          platform: 'darwin',
          env: {},
          tmpdir: deep,
          homeDir: home,
        })
        leaves.add(skipped.directory)
        expect(skipped.directory).toContain(path.join(home, '.muse-spark-code', 'run'))
      } finally {
        // Only our own hash-named leaves; never a real home directory. Empty
        // fallback parents are taken back when nothing else uses them.
        for (const leaf of leaves) await rm(leaf, { recursive: true, force: true })
        for (const parent of [
          path.join(home, '.muse-spark-code', 'run'),
          path.join(home, '.muse-spark-code'),
        ])
          try {
            await rmdir(parent)
          } catch {
            /* Another broker's leaves still live here. */
          }
      }
    },
  )
  it('refuses a symlink, a file and a permissive base without creating anything', async () => {
    const target = path.join(root.directory, 'base')
    await mkdir(target, { mode: 0o700 })
    const link = path.join(root.directory, 'base-link')
    await symlink(target, link)
    await expect(verifyVaultSocketBase(link)).rejects.toThrow(UI_TEXT.vault.noAccess)
    const file = path.join(root.directory, 'base-file')
    await writeFile(file, '', { mode: 0o600 })
    await expect(verifyVaultSocketBase(file)).rejects.toThrow(UI_TEXT.vault.noAccess)
    const open = path.join(root.directory, 'base-open')
    await mkdir(open, { mode: 0o755 })
    await expect(verifyVaultSocketBase(open)).rejects.toThrow(UI_TEXT.vault.noAccess)
    await expect(
      resolveVaultSocket('/data/one', {
        platform: 'darwin',
        env: {},
        tmpdir: link,
        homeDir: 'relative',
      }),
    ).rejects.toThrow(UI_TEXT.vault.brokerBlocked)
  })
  it.skipIf(process.platform === 'win32')(
    'creates the leaf owner-only and re-verifies it on every pass',
    async () => {
      const leaf = path.join(root.directory, 'leaf-parent', 'muse-spark-vault-0123456789ab')
      await ensureVaultSocketDirectory(leaf)
      const sample = await lstat(leaf)
      expect(sample.isDirectory()).toBe(true)
      expect(sample.isSymbolicLink()).toBe(false)
      expect(sample.mode & 0o777).toBe(0o700)
      await expect(verifyVaultSocketBase(leaf)).resolves.toBeUndefined()
      await chmod(leaf, 0o755)
      await expect(verifyVaultSocketBase(leaf)).rejects.toThrow(UI_TEXT.vault.noAccess)
    },
  )
  it('measures the byte length before bind and refuses in a sentence when too long', () => {
    expect(vaultSocketPathLimit('darwin')).toBe(103)
    expect(vaultSocketPathLimit('linux')).toBe(107)
    const fitting = `/${'s'.repeat(90)}/broker.sock`
    expect(() => {
      assertVaultSocketLength(fitting, 'darwin')
    }).not.toThrow()
    expect(() => {
      assertVaultSocketLength(`${fitting}x`, 'darwin')
    }).toThrow(UI_TEXT.vault.brokerBlocked)
  })
  it('refuses with the broker sentence when even the bounded location is too long', async () => {
    // A base this deep leaves no bounded leaf bindable on Darwin.
    const deep = path.join(root.directory, 'd'.repeat(80), 'e'.repeat(80))
    await mkdir(deep, { recursive: true, mode: 0o700 })
    await expect(
      resolveVaultSocket('/data/one', {
        platform: 'darwin',
        env: {},
        tmpdir: deep,
        homeDir: 'relative',
      }),
    ).rejects.toThrow(UI_TEXT.vault.brokerBlocked)
  })
  // Darwin socket limits against macOS homes never apply on Windows.
  it.skipIf(process.platform === 'win32')(
    'keeps the real default macOS data folder and a 60-character home bindable-short',
    async () => {
      const longHome = `/Users/${'u'.repeat(53)}`
      expect(longHome).toHaveLength(60)
      for (const homeDir of ['/Users/alex', longHome, os.homedir()]) {
        const dataDir = path.join(
          agentDataFolder({ platform: 'darwin', env: {}, homeDir }),
          'vault',
        )
        const location = await resolveVaultSocket(dataDir, {
          platform: 'darwin',
          env: {},
          tmpdir: os.tmpdir(),
          homeDir: fakeHome(),
        })
        expect(Buffer.byteLength(location.socket, 'utf8')).toBeLessThanOrEqual(103)
        expect(location.socket).not.toContain(dataDir)
      }
    },
  )
  it('compares resolved identity across the /var versus /private/var alias', async () => {
    const temporary = os.tmpdir()
    const resolved = await realpath(temporary)
    const file = path.join(temporary, 'broker.sock')
    const resolvedFile = path.join(resolved, 'broker.sock')
    expect(await isPathWithin(file, resolved)).toBe(true)
    expect(await isPathWithin(resolvedFile, temporary)).toBe(true)
    expect(await isPathWithin(file, temporary)).toBe(true)
    expect(await isPathWithin(path.join(os.homedir(), 'elsewhere.sock'), temporary)).toBe(false)
    expect(await isPathWithin(file, path.join(root.directory, 'missing'))).toBe(false)
  })
  it('expects every candidate location for one data folder', () => {
    const locations = expectedVaultSocketLocations('/data/one', {
      platform: process.platform,
      env: process.env,
      tmpdir: os.tmpdir(),
      homeDir: fakeHome(),
    })
    expect(locations.length).toBeGreaterThan(0)
    for (const location of locations)
      expect(path.basename(location.directory)).toMatch(/^muse-spark-vault-[0-9a-f]{12}$/u)
    expect(locations.map((location) => location.directory)).toContain(
      vaultBrokerSocketIn(vaultSocketFallbackBase(fakeHome()) ?? '', '/data/one').directory,
    )
  })
  it('accepts an owned kernel socket and refuses a symlink, a file or an absent owner', async () => {
    const missing = path.join(root.directory, 'missing.sock')
    await expect(verifyVaultSocketFile(missing)).resolves.toBeUndefined()
    const file = path.join(root.directory, 'plain')
    await writeFile(file, '', { mode: 0o600 })
    await expect(verifyVaultSocketFile(file)).rejects.toThrow(UI_TEXT.vault.noAccess)
    const target = path.join(root.directory, 'target.sock')
    await writeFile(target, '', { mode: 0o600 })
    const link = path.join(root.directory, 'link.sock')
    await symlink(target, link)
    await expect(verifyVaultSocketFile(link)).rejects.toThrow(UI_TEXT.vault.noAccess)
  })
  it('verifies a bound owned socket before a client would speak', async (context) => {
    skipWithoutBind(context)
    const location = await resolveVaultSocket(path.join(root.directory, 'vault'), input())
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(location.socket, () => {
        resolve()
      })
    })
    try {
      await expect(verifyVaultSocketFile(location.socket)).resolves.toBeUndefined()
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    }
  })
  it('binds and connects at the bounded location for the real default data folder', async (context) => {
    skipWithoutBind(context)
    const dataDir = path.join(
      agentDataFolder({ platform: process.platform, env: process.env, homeDir: os.homedir() }),
      'vault',
    )
    const location = await resolveVaultSocket(dataDir, input())
    const server = createServer((stream) => {
      stream.end()
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(location.socket, () => {
        resolve()
      })
    })
    try {
      const client = createConnection(location.socket)
      await once(client, 'connect')
      client.destroy()
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    }
  })
})
