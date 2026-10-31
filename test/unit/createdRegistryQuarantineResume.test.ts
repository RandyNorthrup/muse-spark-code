// RVTEMPLEAK: a sweep that dies after the quarantine rename and before
// rmdir must finish that same tree on the next start, and must never
// treat a different directory parked at the quarantine name as success.
// A creator the sweep cannot prove (no machine, boot, namespace and
// exact birth) is left in place. Real directories through the product's
// native protocol; the keep period moves through the registry's `now`.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { CreatedCreator } from '../../src/core/resources/createdRegistry'
import { CreatedRegistry } from '../../src/core/resources/createdRegistry'
import {
  exactCurrentProcessOwner,
  exactProcessBirth,
  processStartTime,
} from '../../src/core/locks/processOwner'
import { RESOURCE_TEMP_KEEP_MS } from '../../src/shared/constants'
import { nativeCreated, useCreatedNative } from './helpers/createdNative'
import { createdRegistryProof } from './helpers/resources/registryProof'
import { removeFolder } from './helpers/temporaryFolders'

useCreatedNative()

const roots: string[] = []

afterAll(async () => {
  for (const root of roots.splice(0)) await removeFolder(root)
})

interface Tree {
  readonly id: string
  readonly root: string
  readonly file: string
  readonly base: string
  readonly dir: string
}

function proofFor(dir: string) {
  return createdRegistryProof(nativeCreated, () => dir)
}

async function makeTree(label: string): Promise<Tree> {
  const dir = await mkdtemp(path.resolve('temp', `quarantine-resume-${label}-`))
  roots.push(dir)
  const file = path.join(dir, 'registry.json')
  const base = path.join(dir, 'trees')
  const registry = await CreatedRegistry.open(file, Date.now, proofFor(dir), base)
  const tree = await registry.createTemp('quarantine-owner')
  await writeFile(path.join(tree.root, 'payload.txt'), 'work in progress\n', { mode: 0o600 })
  return { id: tree.id, root: tree.root, file, base, dir }
}

/** A process that has exited, with the exact evidence the sweep requires. */
async function exitedCreator(dataDir: string): Promise<CreatedCreator> {
  const child: ChildProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], {
    stdio: 'ignore',
  })
  if (child.pid === undefined) throw new Error('the holder has no id')
  const exit = once(child, 'exit')
  try {
    const [me, birth, started] = await Promise.all([
      exactCurrentProcessOwner(dataDir),
      exactProcessBirth(child.pid),
      processStartTime(child.pid),
    ])
    if (
      birth === undefined ||
      started === undefined ||
      me?.machineId === undefined ||
      me.bootId === undefined ||
      me.pidNamespace === undefined
    )
      throw new Error('exact process evidence is unavailable')
    return {
      host: me.host,
      pid: child.pid,
      processStart: started,
      bootId: me.bootId,
      machineId: me.machineId,
      pidNamespace: me.pidNamespace,
      exactBirth: birth,
    }
  } finally {
    child.kill('SIGKILL')
    await exit
  }
}

async function writeCreator(file: string, creator: CreatedCreator): Promise<void> {
  const entries = JSON.parse(await readFile(file, 'utf8')) as { creator?: CreatedCreator }[]
  const entry = entries[0]
  if (entry?.creator === undefined) throw new Error('the tree recorded no creator')
  entry.creator = creator
  await writeFile(file, JSON.stringify(entries), { mode: 0o600 })
}

async function sweep(
  dir: string,
  file: string,
  base: string,
): Promise<{ removed: number; refused?: readonly string[] }> {
  let nowMs = Date.now()
  const second = await CreatedRegistry.open(file, () => nowMs, proofFor(dir), base)
  const kept = await second.clean()
  expect(kept.removed).toBe(0)
  nowMs += RESOURCE_TEMP_KEEP_MS + 1
  return await second.clean()
}

describe('created registry quarantine resume (RVTEMPLEAK)', () => {
  it('finishes a tree the previous sweep quarantined and then died', async () => {
    const tree = await makeTree('parked')
    const trash = path.join(tree.base, `.muse-trash-${tree.id}`)
    const payload = path.join(trash, 'payload.txt')
    await rename(tree.root, trash)
    await writeCreator(tree.file, await exitedCreator(tree.dir))
    const swept = await sweep(tree.dir, tree.file, tree.base)
    expect(swept.removed).toBe(1)
    expect(existsSync(payload)).toBe(false)
    expect(existsSync(trash)).toBe(false)
    expect(JSON.parse(await readFile(tree.file, 'utf8'))).toEqual([])
    // Real native helper spawns: genuinely long.
  }, 30_000)

  it('leaves a different directory at the quarantine name and keeps the entry', async () => {
    const tree = await makeTree('foreign')
    const trash = path.join(tree.base, `.muse-trash-${tree.id}`)
    const sentinel = path.join(trash, 'sentinel.txt')
    await rename(tree.root, path.join(tree.dir, 'held-aside'))
    await mkdir(trash, { mode: 0o700 })
    await writeFile(sentinel, 'not the product tree\n', { mode: 0o600 })
    await writeCreator(tree.file, await exitedCreator(tree.dir))
    const swept = await sweep(tree.dir, tree.file, tree.base)
    expect(swept.removed).toBe(0)
    expect(swept.refused).toContain(tree.id)
    expect(existsSync(sentinel)).toBe(true)
    const entries = JSON.parse(await readFile(tree.file, 'utf8')) as unknown[]
    expect(entries).toHaveLength(1)
    // Real native helper spawns: genuinely long.
  }, 30_000)

  it('does not remove a different directory standing at the tree name', async () => {
    const tree = await makeTree('replaced')
    const sentinel = path.join(tree.root, 'sentinel.txt')
    await rename(tree.root, path.join(tree.dir, 'held-aside'))
    await mkdir(tree.root, { mode: 0o700 })
    await writeFile(sentinel, 'replacement\n', { mode: 0o600 })
    await writeCreator(tree.file, await exitedCreator(tree.dir))
    const swept = await sweep(tree.dir, tree.file, tree.base)
    expect(swept.removed).toBe(0)
    expect(swept.refused).toContain(tree.id)
    expect(existsSync(sentinel)).toBe(true)
    // Real native helper spawns: genuinely long.
  }, 30_000)

  it('does not follow a symlink standing at the tree name', async () => {
    const tree = await makeTree('symlink')
    const held = path.join(tree.dir, 'held-aside')
    await rename(tree.root, held)
    await symlink(held, tree.root)
    await writeCreator(tree.file, await exitedCreator(tree.dir))
    const swept = await sweep(tree.dir, tree.file, tree.base)
    expect(swept.removed).toBe(0)
    expect(swept.refused).toContain(tree.id)
    expect(existsSync(path.join(held, 'payload.txt'))).toBe(true)
    // Real native helper spawns: genuinely long.
  }, 30_000)

  it('does not reclaim a dead creator that has no exact process evidence', async () => {
    const tree = await makeTree('unproven')
    const dead = await exitedCreator(tree.dir)
    await writeCreator(tree.file, {
      host: dead.host,
      pid: dead.pid,
      processStart: dead.processStart,
    })
    const swept = await sweep(tree.dir, tree.file, tree.base)
    expect(swept.removed).toBe(0)
    expect(existsSync(tree.root)).toBe(true)
    const entries = JSON.parse(await readFile(tree.file, 'utf8')) as { endedAtMs: number | null }[]
    expect(entries).toHaveLength(1)
    expect(entries[0]?.endedAtMs).toBeNull()
    // Real native helper spawns: genuinely long.
  }, 30_000)
})
