// RVMEDIAV3 3: conversion folders a crash left in the private media root are
// reclaimed when the next process opens it, never one a live window in
// another process still uses. Native on every OS: the production startup
// binding (`privateRootFor`) against real roots, and real second processes
// running the same lease code (bundled by esbuild) as the other windows. The
// Linux lease rules run on Linux only, against the real /proc entries of
// real children.
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { privateRootFor } from '../../src/host/backend/productionAudioEntry'
import { identityOf, lstatIdentity } from '../../src/core/fs/fileIdentity'
import {
  createPrivateDirectory,
  openPrivateRoot,
  type PrivateRoot,
} from '../../src/runtime/privateDirectory'
import type { LeasedRoot, LeaseOptions } from '../../src/runtime/privateRootLease'
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
 * The lease of an owner that is gone: on Windows and macOS a lease nobody
 * holds open; on Linux one naming a process that has exited.
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
  await reaped(child)
  await fs.writeFile(file, line)
  return file
}

/** Ends a process as a crash does: no cleanup runs. */
async function crash(child: ChildProcess): Promise<void> {
  const ended = once(child, 'exit')
  child.kill('SIGKILL')
  await ended
}

/** A crash the kernel has finished reaping: its /proc entry is gone. */
async function reaped(child: ChildProcess): Promise<void> {
  const closed = once(child, 'close')
  await crash(child)
  await closed
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

/** A restart in a new process: opens and leases the root through the same code, then exits. */
const RESTART_WINDOW = `
const m = require(process.argv[1])
;(async () => {
  await m.leasePrivateRoot(await m.openPrivateRoot(process.argv[2]))
})().then(
  () => process.exit(0),
  () => process.exit(2),
)`

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

  /** The next process to open the root: a restart, through the same lease code. */
  async function restartRoot(directory: string): Promise<void> {
    const child = spawn(process.execPath, ['-e', RESTART_WINDOW, bundle.file, directory], {
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    children.push(child)
    const [code] = (await once(child, 'close')) as [number | null]
    if (code !== 0) throw new Error(`the restarted window exited with ${String(code)}`)
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
    await restartRoot(directory)
    expect({ live: await isPresent(live.folder), mine: await isPresent(mine) }).toEqual({
      live: false,
      mine: true,
    })
  })
})

async function testRoot(owner = token('a')): Promise<PrivateRoot> {
  const directory = path.join(await area(), 'media')
  await fs.mkdir(directory)
  return { path: directory, identity: identityOf(await lstatIdentity(directory)), owner }
}

/** A root holding one other owner's folder, whose lease reads `text`. */
async function goneOwnerRoot(text: string): Promise<{ root: PrivateRoot; folder: string }> {
  const root = await testRoot()
  const folder = await crashLeft(root.path, token('b'))
  await fs.writeFile(path.join(root.path, `${PREFIX}${token('b')}.lease`), text)
  return { root, folder }
}

/** The lease itself, loaded when used: this file's other cases need only the startup binding. */
async function lease(root: PrivateRoot, options: LeaseOptions): Promise<LeasedRoot> {
  const { leasePrivateRoot } = await import('../../src/runtime/privateRootLease')
  return held(await leasePrivateRoot(root, options))
}

/** A sleeper the lease can read in the real /proc, reaped by `afterEach`. */
function sleeper(): { child: ChildProcess; pid: number } {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  if (child.pid === undefined) throw new Error('the child must start')
  children.push(child)
  return { child, pid: child.pid }
}

/** This machine, this boot and this namespace, as a lease line names them. */
function scopeOf(line: string): [string, string, string] {
  const [machine, boot, namespace] = line.split(' ', 3)
  if (machine === undefined || boot === undefined || namespace === undefined)
    throw new Error('a lease line names machine, boot and namespace')
  return [machine, boot, namespace]
}

/** The start tick a lease line names: the text past its last space. */
function startOf(line: string): string {
  return line.slice(line.lastIndexOf(' ') + 1)
}

describe.runIf(process.platform === 'linux')('the lease rules on Linux, on the real /proc', () => {
  it('reclaims only owners proven gone and writes its own identity', async () => {
    const root = await testRoot()
    const { pid: firstPid } = sleeper()
    // Start ticks count 10 ms: sibling spawns can share one, so separate the
    // pair by enough wall time that their ticks must differ.
    await new Promise((resolve) => setTimeout(resolve, 100))
    const { pid: secondPid } = sleeper()
    const gone = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    if (gone.pid === undefined) throw new Error('the child must start')
    const goneLine = await linuxLine(gone.pid)
    await reaped(gone)
    // A reused PID under this parent: a live PID paired with another live
    // process's start tick. Both numbers are real /proc readings; only the
    // pairing simulates what a rebooted PID looks like.
    const firstLine = await linuxLine(firstPid)
    const secondLine = await linuxLine(secondPid)
    // The test's premise: two live processes with different start ticks.
    expect(startOf(firstLine)).not.toBe(startOf(secondLine))
    const [machine, boot, namespace] = scopeOf(secondLine)
    const owners = {
      exited: goneLine,
      reused: `${machine} ${boot} ${namespace} ${String(firstPid)} ${startOf(secondLine)}`,
      live: secondLine,
      garbled: `${firstLine} trailing`,
    }
    const folders: Record<string, string> = {}
    for (const [index, [name, value]] of Object.entries(owners).entries()) {
      const owner = token(String(index))
      folders[name] = await crashLeft(root.path, owner)
      await fs.writeFile(path.join(root.path, `${PREFIX}${owner}.lease`), value)
    }
    const { leasePrivateRoot } = await import('../../src/runtime/privateRootLease')
    held(await leasePrivateRoot(root))
    const kept = Object.fromEntries(
      await Promise.all(
        Object.entries(folders).map(async ([name, folder]) => [name, await isPresent(folder)]),
      ),
    )
    expect(kept).toEqual({ exited: false, reused: false, live: true, garbled: true })
    expect(await fs.readFile(path.join(root.path, `${PREFIX}${root.owner}.lease`), 'utf8')).toBe(
      await linuxLine(process.pid),
    )
  })
})

describe('the lease rules where no process table names the owner', () => {
  // Where the flag is not a lock (it is O_EXLOCK only on macOS), this
  // process's own lease reads as free: then no probe proves anything.
  it.skipIf(process.platform === 'darwin')(
    'turns its sweep off where the lock does not hold against its own lease',
    async () => {
      const { root, folder } = await goneOwnerRoot('')
      // The gone owner's folder stays, and the unlocked lease is dropped:
      // the root's folders carry a token no lease names (RVMEDIAV4 1).
      const leased = await lease(root, { platform: 'darwin' })
      expect(leased.lease).toBeUndefined()
      expect(await isPresent(folder)).toBe(true)
      expect(leased.owner).not.toBe(root.owner)
      expect(await fs.readdir(root.path)).toHaveLength(2)
    },
  )

  it('takes no lease and removes nothing on a platform with neither a lock nor /proc', async () => {
    const { root, folder } = await goneOwnerRoot('')
    const leased = await lease(root, { platform: 'aix' })
    expect(leased.lease).toBeUndefined()
    expect(await isPresent(folder)).toBe(true)
    expect(await fs.readdir(root.path)).toHaveLength(2)
  })
})
