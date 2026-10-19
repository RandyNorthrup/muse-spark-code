// RVMEDIAV3 3: conversion folders a crash left in the private media root are
// reclaimed when the next process opens it, never one a live window in
// another process still uses. Native on every OS: the production startup
// binding (`privateRootFor`) against real roots, and real second processes
// running the same lease code (bundled by esbuild) as the other windows. The
// Linux rules also run here against a fake /proc, on every OS.
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { privateRootFor } from '../../src/host/backend/productionAudioEntry'
import { identityOf, lstatIdentity } from '../../src/core/fs/fileIdentity'
import {
  createPrivateDirectory,
  openPrivateRoot,
  type PrivateRoot,
} from '../../src/runtime/privateDirectory'
import type { LeasedRoot, LeaseOptions, LinuxProcess } from '../../src/runtime/privateRootLease'
import { secureOwnerOnly } from '../../src/runtime/tokenFile'
import { removeFolder } from './helpers/temporaryFolders'

const PREFIX = 'muse-media-'
const COPY = 'synthetic verified copy'
/** /proc/<pid>/stat's start tick, counted after the command's closing parenthesis. */
const START_FIELD = 19
const token = (fill: string) => fill.repeat(32)

const areas: string[] = []
const leases: Partial<LeasedRoot>[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGKILL')
  // A held lease would keep Windows from removing its folder.
  for (const root of leases.splice(0)) await root.lease?.close()
  for (const folder of areas.splice(0)) await removeFolder(folder)
})

/** A private scratch area: on Windows owner-only, as a real host's storage is. */
async function area(): Promise<string> {
  const made = await fs.mkdtemp(path.join(tmpdir(), 'muse-lease-test-'))
  areas.push(made)
  if (process.platform === 'win32') await secureOwnerOnly(made, 'directory')
  return made
}

/** Keeps a root's lease for this test, closed after it. */
function held<T extends Partial<LeasedRoot>>(root: T): T {
  leases.push(root)
  return root
}

/** A conversion folder of `owner`'s with a verified copy inside, as a crash leaves it. */
async function crashLeft(root: string, owner: string): Promise<string> {
  const folder = path.join(root, `${PREFIX}${owner}-${token('c')}`)
  await fs.mkdir(folder)
  await fs.writeFile(path.join(folder, 'input.mp3'), COPY)
  return folder
}

async function isPresent(file: string): Promise<boolean> {
  try {
    await fs.lstat(file)
    return true
  } catch {
    return false
  }
}

/** /proc's identity of a live PID on this Linux host, as the lease's line names it. */
async function linuxLine(pid: number): Promise<string> {
  const stat = await fs.readFile(`/proc/${String(pid)}/stat`, 'utf8')
  const start = stat
    .slice(stat.lastIndexOf(')') + 2)
    .split(' ', START_FIELD + 1)
    .at(START_FIELD)
  const machine = await fs.readFile('/etc/machine-id', 'utf8')
  const boot = await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')
  const namespace = await fs.readlink('/proc/self/ns/pid')
  return `${machine.trim()} ${boot.trim()} ${namespace} ${String(pid)} ${String(start)}`
}

/**
The lease of an owner that is gone: on Windows and macOS a lease nobody
holds open; on Linux one naming a process that has exited.
*/
async function goneLease(root: string, owner: string): Promise<string> {
  const file = path.join(root, `${PREFIX}${owner}.lease`)
  if (process.platform !== 'linux') {
    await fs.writeFile(file, '')
    return file
  }
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
  if (child.pid === undefined) throw new Error('the child must start')
  const line = await linuxLine(child.pid)
  await crash(child)
  await fs.writeFile(file, line)
  return file
}

/** Ends a process as a crash does: no cleanup runs. */
async function crash(child: ChildProcess): Promise<void> {
  const ended = once(child, 'exit')
  child.kill('SIGKILL')
  await ended
}

describe('the production startup binding reclaims crash-left copies (RVMEDIAV3 3)', () => {
  it('removes a gone owner’s folder and lease when the root opens, and nothing else', async () => {
    const directory = path.join(await area(), 'media')
    // The root a crashed process verified, holding its folder and lease.
    await openPrivateRoot(directory)
    const gone = token('d')
    const folder = await crashLeft(directory, gone)
    const lease = await goneLease(directory, gone)
    // Entries the reclaim never judges: an unmarked folder and a stray file.
    const unmarked = path.join(directory, `${PREFIX}${token('e')}`)
    await fs.mkdir(unmarked)
    await fs.writeFile(path.join(directory, 'notes.txt'), COPY)
    const root = held(await privateRootFor(directory)())
    expect({ folder: await isPresent(folder), lease: await isPresent(lease) }).toEqual({
      folder: false,
      lease: false,
    })
    expect(await isPresent(unmarked)).toBe(true)
    expect(await fs.readFile(path.join(directory, 'notes.txt'), 'utf8')).toBe(COPY)
    // This process's own lease, and the folders it makes carry its token.
    expect(await isPresent(path.join(directory, `${PREFIX}${root.owner}.lease`))).toBe(true)
    const own = await createPrivateDirectory(root)
    expect(path.basename(own)).toMatch(new RegExp(`^${PREFIX}${root.owner}-[0-9a-f]{32}$`, 'u'))
  })
})

/** Another window: opens and leases the root, makes a folder with a copy, then holds. */
const OTHER_WINDOW = String.raw`
const m = require(process.argv[1])
;(async () => {
  const root = await m.leasePrivateRoot(await m.openPrivateRoot(process.argv[2]))
  const folder = await m.createPrivateDirectory(root)
  require('node:fs').writeFileSync(require('node:path').join(folder, 'input.mp3'), 'copy')
  globalThis.heldRoot = root
  process.stdout.write(folder + '\n')
  setInterval(() => {}, 1000)
})().catch(() => process.exit(2))`

describe('other windows in other processes, through the same lease code', () => {
  const bundle = { file: '' }
  beforeAll(async () => {
    const folder = await fs.mkdtemp(path.join(tmpdir(), 'muse-lease-bundle-'))
    bundle.file = path.join(folder, 'lease.cjs')
    await build({
      stdin: {
        contents: [
          "export { createPrivateDirectory, openPrivateRoot } from './src/runtime/privateDirectory'",
          "export { leasePrivateRoot } from './src/runtime/privateRootLease'",
        ].join('\n'),
        resolveDir: path.resolve('.'),
        loader: 'ts',
      },
      outfile: bundle.file,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    })
  })
  afterAll(async () => {
    if (bundle.file !== '') await removeFolder(path.dirname(bundle.file))
  })

  async function otherWindow(directory: string): Promise<{ child: ChildProcess; folder: string }> {
    const child = spawn(process.execPath, ['-e', OTHER_WINDOW, bundle.file, directory], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    children.push(child)
    const folder = await new Promise<string>((resolve, reject) => {
      let text = ''
      child.stdout.on('data', (chunk: Buffer) => {
        text += chunk.toString('utf8')
        if (text.includes('\n')) resolve(text.slice(0, text.indexOf('\n')))
      })
      child.once('exit', (code) => {
        reject(new Error(`the other window ended early (${String(code)})`))
      })
    })
    return { child, folder }
  }

  it('keeps a live window’s copy, and reclaims it once that window crashed', async () => {
    const directory = path.join(await area(), 'media')
    await openPrivateRoot(directory)
    const [live, crashed] = await Promise.all([otherWindow(directory), otherWindow(directory)])
    await crash(crashed.child)
    const root = held(await privateRootFor(directory)())
    expect({
      live: await isPresent(live.folder),
      crashed: await isPresent(crashed.folder),
    }).toEqual({ live: true, crashed: false })
    const mine = await createPrivateDirectory(root)
    await crash(live.child)
    // The next process to open the root: a restart, through the same binding.
    vi.resetModules()
    const restarted = await import('../../src/host/backend/productionAudioEntry')
    held(await restarted.privateRootFor(directory)())
    expect({ live: await isPresent(live.folder), mine: await isPresent(mine) }).toEqual({
      live: false,
      mine: true,
    })
  })
})

async function fakeRoot(): Promise<PrivateRoot> {
  const directory = path.join(await area(), 'media')
  await fs.mkdir(directory)
  return {
    path: directory,
    identity: identityOf(await lstatIdentity(directory)),
    owner: token('a'),
  }
}

/** A fake root holding one other owner's folder, whose lease reads `text`. */
async function goneOwnerRoot(text: string): Promise<{ fake: PrivateRoot; folder: string }> {
  const fake = await fakeRoot()
  const folder = await crashLeft(fake.path, token('b'))
  await fs.writeFile(path.join(fake.path, `${PREFIX}${token('b')}.lease`), text)
  return { fake, folder }
}

/** The lease itself, loaded when used: this file's other cases need only the startup binding. */
async function lease(root: PrivateRoot, options: LeaseOptions): Promise<LeasedRoot> {
  const { leasePrivateRoot } = await import('../../src/runtime/privateRootLease')
  return held(await leasePrivateRoot(root, options))
}

// The fake /proc: this machine, this boot, this namespace, and the PIDs alive in it.
const MACHINE = 'f'.repeat(32)
const BOOT = '11111111-2222-3333-4444-555555555555'
const NAMESPACE = 'pid:[4026531836]'

/** A /proc/<pid>/stat line whose command holds a space and a parenthesis. */
function stat(pid: string, start: string): string {
  const fields = ['S', ...Array.from({ length: START_FIELD - 1 }, () => '0'), start, '0']
  return `${pid} (we (ird) node) ${fields.join(' ')}\n`
}

function fakeLinux(alive: Record<string, string>, failing?: string): LinuxProcess {
  return {
    read: async (file) => {
      if (file === failing) throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      if (file === '/etc/machine-id') return `${MACHINE}\n`
      if (file === '/proc/sys/kernel/random/boot_id') return `${BOOT}\n`
      const pid = /^\/proc\/(\d+)\/stat$/u.exec(file)?.[1]
      if (pid === undefined) return await fs.readFile(file, 'utf8')
      const start = alive[pid]
      if (start === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return stat(pid, start)
    },
    link: (file) =>
      file === failing ? Promise.reject(new Error('EACCES')) : Promise.resolve(NAMESPACE),
  }
}

function line(pid: string, start: string, scope = [MACHINE, BOOT, NAMESPACE]): string {
  return `${scope.join(' ')} ${pid} ${start}`
}

describe('the lease rules on a fake root', () => {
  it('on Linux, reclaims only owners proven gone and writes its own identity', async () => {
    const self = String(process.pid)
    const fake = await fakeRoot()
    const owners = {
      exited: line('40', '100'),
      reused: line('41', '400'),
      earlierBoot: line('41', '500', [MACHINE, '99999999-2222-3333-4444-555555555555', NAMESPACE]),
      live: line('42', '900'),
      otherMachine: line('40', '100', ['e'.repeat(32), BOOT, NAMESPACE]),
      otherNamespace: line('40', '100', [MACHINE, BOOT, 'pid:[4026532000]']),
      garbled: `${line('40', '100')} trailing`,
    }
    const folders: Record<string, string> = {}
    for (const [index, [name, value]] of Object.entries(owners).entries()) {
      const owner = token(String(index))
      folders[name] = await crashLeft(fake.path, owner)
      await fs.writeFile(path.join(fake.path, `${PREFIX}${owner}.lease`), value)
    }
    await lease(fake, {
      platform: 'linux',
      linux: fakeLinux({ [self]: '700', '41': '500', '42': '900' }),
    })
    const kept = Object.fromEntries(
      await Promise.all(
        Object.entries(folders).map(async ([name, folder]) => [name, await isPresent(folder)]),
      ),
    )
    expect(kept).toEqual({
      exited: false,
      reused: false,
      earlierBoot: false,
      live: true,
      otherMachine: true,
      otherNamespace: true,
      garbled: true,
    })
    expect(await fs.readFile(path.join(fake.path, `${PREFIX}${fake.owner}.lease`), 'utf8')).toBe(
      line(self, '700'),
    )
  })

  it.each(['/etc/machine-id', '/proc/sys/kernel/random/boot_id', '/proc/self/ns/pid'])(
    'on Linux, takes no lease and removes nothing when %s cannot be read',
    async (failing) => {
      const { fake, folder } = await goneOwnerRoot(line('40', '100'))
      await lease(fake, {
        platform: 'linux',
        linux: fakeLinux({ [String(process.pid)]: '700' }, failing),
      })
      expect(await isPresent(folder)).toBe(true)
      expect(await isPresent(path.join(fake.path, `${PREFIX}${fake.owner}.lease`))).toBe(false)
    },
  )

  // Where the flag is not a lock (it is O_EXLOCK only on macOS), this
  // process's own lease reads as free: then no probe proves anything.
  it.skipIf(process.platform === 'darwin')(
    'turns its sweep off where the lock does not hold against its own lease',
    async () => {
      const { fake, folder } = await goneOwnerRoot('')
      // The gone owner's folder stays, and the unlocked lease is dropped:
      // the root's folders carry a token no lease names (RVMEDIAV4 1).
      const leased = await lease(fake, { platform: 'darwin' })
      expect(leased.lease).toBeUndefined()
      expect(await isPresent(folder)).toBe(true)
      expect(leased.owner).not.toBe(fake.owner)
      expect(await fs.readdir(fake.path)).toHaveLength(2)
    },
  )

  it('takes no lease and removes nothing on a platform with neither a lock nor /proc', async () => {
    const { fake, folder } = await goneOwnerRoot('')
    const leased = await lease(fake, { platform: 'aix' })
    expect(leased.lease).toBeUndefined()
    expect(await isPresent(folder)).toBe(true)
    expect(await fs.readdir(fake.path)).toHaveLength(2)
  })
})
