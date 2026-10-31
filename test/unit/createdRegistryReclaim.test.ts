// RLF-TEMPLEAK: temp trees whose creating process died (killed, crashed,
// power lost, editor closed without the shutdown path) were never
// reclaimed: removeEntry refused every `created` entry with no end time
// even when the owner was provably gone, and no later start could prove
// the exit at all, so each finished lane left 50–520 MB behind forever
// (found 2026-10-30 in the lanes' own sandboxes). A real child process
// creates each tree through the real registry and the product's native
// commands; the parent kills it or lets it finish, then a fresh registry
// (a second start) sweeps with the product's own process-owner proof.
// The keep period is driven through the registry's existing `now` seam.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CreatedRegistry } from '../../src/core/resources/createdRegistry'
import { createdPathCommands } from '../../src/core/resources/resourceGovernorEntry'
import { configureResources } from '../../src/core/resources/admission'
import { runtimeWindowsJob } from '../../src/runtime/resources/jobs'
import { RESOURCE_TEMP_KEEP_MS, RESOURCE_TEMP_MARKER } from '../../src/shared/constants'
import { buildLinuxHelper } from '../../scripts/build-linux-helper.mjs'
import { createdRegistryProof } from './helpers/resources/registryProof'

const scratch: {
  folder: string
  bundle: string
  storage: string
  nativeRoot: string
  disposeAdmission: (() => void) | undefined
} = { folder: '', bundle: '', storage: '', nativeRoot: '', disposeAdmission: undefined }
const children: ChildProcess[] = []

beforeAll(async () => {
  scratch.folder = await mkdtemp(path.join(path.resolve('temp'), 'created-registry-reclaim-'))
  scratch.bundle = path.join(scratch.folder, 'createdRegistryReclaim.cjs')
  await build({
    entryPoints: [path.resolve('test/unit/createdRegistryReclaimEntry.ts')],
    outfile: scratch.bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  // The product's own helper builds, so both processes run the confined
  // native protocol the product ships, never a copy of its flags.
  if (process.platform === 'linux') {
    scratch.nativeRoot = path.join(scratch.folder, 'native')
    buildLinuxHelper(path.join(scratch.nativeRoot, 'linux', process.arch))
    scratch.storage = path.join(scratch.folder, 'jobs')
  } else if (process.platform === 'win32') {
    scratch.storage = await mkdtemp(path.join(tmpdir(), 'created-reclaim-jobs-'))
    const windowsJob = runtimeWindowsJob(scratch.storage, path.resolve('.'))
    scratch.disposeAdmission = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      windowsJob,
    })
    if ((await windowsJob()) === undefined) throw new Error('the Windows job helpers did not build')
    scratch.nativeRoot = path.resolve('native')
  } else {
    scratch.storage = path.join(scratch.folder, 'jobs')
    scratch.nativeRoot = path.resolve('native')
  }
})

afterAll(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGKILL')
  scratch.disposeAdmission?.()
  scratch.disposeAdmission = undefined
  if (scratch.folder !== '') await rm(scratch.folder, { recursive: true, force: true })
  if (process.platform === 'win32' && scratch.storage !== '')
    await rm(scratch.storage, { recursive: true, force: true })
})

interface Created {
  readonly id: string
  readonly root: string
  readonly pid: number
}

interface ManifestEntry {
  readonly id: string
  readonly state: string
  readonly endedAtMs: number | null
  readonly failed: boolean
}

async function manifest(dir: string): Promise<ManifestEntry[]> {
  return JSON.parse(await readFile(path.join(dir, 'registry.json'), 'utf8')) as ManifestEntry[]
}

/** One creating child process: its printed tree identity and its handle. */
async function creator(
  dir: string,
  owner: string,
  action: 'hold' | 'exit' | 'finish',
): Promise<{ child: ChildProcess; tree: Created }> {
  const plan = JSON.stringify({
    manifest: path.join(dir, 'registry.json'),
    base: path.join(dir, 'trees'),
    storageDir: scratch.storage,
    packageRoot: path.resolve('.'),
    nativeRoot: scratch.nativeRoot,
    owner,
    action,
  })
  const child = spawn(
    process.execPath,
    [path.resolve('test/hosts/created-registry-reclaim-worker.mjs'), scratch.bundle, plan],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  children.push(child)
  const tree = await new Promise<Created>((resolve, reject) => {
    let text = ''
    child.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
      if (text.includes('\n')) resolve(JSON.parse(text.slice(0, text.indexOf('\n'))) as Created)
    })
    child.once('exit', (code) => {
      reject(new Error(`the creating process ended early (${String(code)})`))
    })
  })
  return { child, tree }
}

async function kill(child: ChildProcess): Promise<void> {
  child.kill('SIGKILL')
  await once(child, 'exit')
}

/** A second start over the same registry, its clock set by the test. */
async function secondStart(dir: string, now: () => number): Promise<CreatedRegistry> {
  const windowsJob =
    process.platform === 'win32' ? runtimeWindowsJob(scratch.storage, path.resolve('.')) : undefined
  const commands = createdPathCommands(scratch.nativeRoot, windowsJob)
  return await CreatedRegistry.open(
    path.join(dir, 'registry.json'),
    now,
    createdRegistryProof((args) => commands(args)),
    path.join(dir, 'trees'),
  )
}

describe('created registry reclaim (RLF-TEMPLEAK)', () => {
  it('a killed creator’s tree is ended by the next start, kept for diagnosis, then removed', async () => {
    const dir = await mkdtemp(path.join(scratch.folder, 'killed-'))
    const { child, tree } = await creator(dir, 'killed-owner', 'hold')
    await kill(child)
    const before = await manifest(dir)
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ state: 'created', endedAtMs: null })
    let nowMs = Date.now()
    const second = await secondStart(dir, () => nowMs)
    const first = await second.clean()
    // The sweep ends it as failed (nobody reported success) and the keep
    // period runs from that proof, so the tree survives this round.
    expect(first.removed).toBe(0)
    expect(existsSync(tree.root)).toBe(true)
    const ended = await manifest(dir)
    expect(ended).toHaveLength(1)
    expect(ended[0]?.failed).toBe(true)
    expect(ended[0]?.endedAtMs).toBe(nowMs)
    nowMs += RESOURCE_TEMP_KEEP_MS + 1
    const later = await second.clean()
    expect(later.removed).toBe(1)
    expect(existsSync(tree.root)).toBe(false)
    expect(await manifest(dir)).toEqual([])
    // Real child processes and native helper spawns: genuinely long.
  }, 30_000)

  it('a tree whose creator is still alive is never touched', async () => {
    const dir = await mkdtemp(path.join(scratch.folder, 'live-'))
    const { child, tree } = await creator(dir, 'live-owner', 'hold')
    try {
      const nowMs = Date.now() + RESOURCE_TEMP_KEEP_MS * 2
      const second = await secondStart(dir, () => nowMs)
      const swept = await second.clean()
      expect(swept.removed).toBe(0)
      expect(existsSync(tree.root)).toBe(true)
      const entries = await manifest(dir)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ state: 'created', endedAtMs: null })
    } finally {
      await kill(child)
    }
    // Real child processes and native helper spawns: genuinely long.
  }, 30_000)

  it('a failed tree its creator finished is reclaimed by the next start after the keep period', async () => {
    const dir = await mkdtemp(path.join(scratch.folder, 'finished-'))
    const { child, tree } = await creator(dir, 'finished-owner', 'finish')
    await once(child, 'exit')
    const before = await manifest(dir)
    expect(before).toHaveLength(1)
    expect(before[0]?.failed).toBe(true)
    expect(before[0]?.endedAtMs).not.toBeNull()
    let nowMs = Date.now()
    const second = await secondStart(dir, () => nowMs)
    const kept = await second.clean()
    expect(kept.removed).toBe(0)
    expect(existsSync(tree.root)).toBe(true)
    nowMs += RESOURCE_TEMP_KEEP_MS + 1
    const swept = await second.clean()
    expect(swept.removed).toBe(1)
    expect(existsSync(tree.root)).toBe(false)
    expect(await manifest(dir)).toEqual([])
    // Real child processes and native helper spawns: genuinely long.
  }, 30_000)

  it('a tree with a wrong marker is reported and never removed', async () => {
    const dir = await mkdtemp(path.join(scratch.folder, 'marker-'))
    const { child, tree } = await creator(dir, 'marker-owner', 'exit')
    await once(child, 'exit')
    await writeFile(
      path.join(tree.root, RESOURCE_TEMP_MARKER),
      JSON.stringify({ id: tree.id, token: '0'.repeat(32) }),
    )
    let nowMs = Date.now()
    const second = await secondStart(dir, () => nowMs)
    await second.clean()
    nowMs += RESOURCE_TEMP_KEEP_MS + 1
    const swept = await second.clean()
    expect(swept.removed).toBe(0)
    expect(swept.refused).toContain(tree.id)
    expect(existsSync(tree.root)).toBe(true)
    expect(await manifest(dir)).toHaveLength(1)
    // Real child processes and native helper spawns: genuinely long.
  }, 30_000)
})
