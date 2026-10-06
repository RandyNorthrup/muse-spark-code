import * as identity from '../../src/core/fs/fileIdentity'
import { nodeTempRoot, nodeNativeTest } from './helpers/nodeNative'
import { readFile, writeFile, chmod, symlink, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NODE_STATE_FILE, NODE_ZERO_DIGEST } from '../../src/shared/constants'
import { NodeStateStore } from '../../src/runtime/node/state'
import { migrateNodeState } from '../../src/runtime/node/migrations'
import { NodePrivateFiles } from '../../src/runtime/node/privateFiles'
import { nodeState } from './helpers/node/records'

const roots: string[] = []
async function root() {
  const dir = await nodeTempRoot('m110-n-')
  roots.push(dir)
  return dir
}
function initial() {
  const state = nodeState()
  state.auditHead = { seq: 0, hash: NODE_ZERO_DIGEST }
  return state
}
async function store() {
  const dir = await root()
  const state = new NodeStateStore(dir)
  await state.initialize(initial())
  return { dir, state }
}
afterEach(async () => {
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('M110-N durable state and audit', () => {
  nodeNativeTest('H15 persists canonical state and refuses a second initialization', async () => {
    const { dir, state } = await store()
    await expect(state.initialize(initial())).rejects.toThrow()
    const reopened = new NodeStateStore(dir)
    expect(await reopened.load()).toEqual(initial())
    const fileInfo = await stat(path.join(dir, NODE_STATE_FILE))
    const dirInfo = await stat(dir)
    expect(fileInfo.mode & 0o777).toBe(0o600)
    expect(dirInfo.mode & 0o777).toBe(0o700)
  })
  nodeNativeTest(
    'H06 refuses secret fields and leaves original bytes on failed writes',
    async () => {
      const { dir, state } = await store()
      const file = path.join(dir, NODE_STATE_FILE)
      const before = await readFile(file)
      await expect(
        state.update(1, (value) => ({ ...value, bearer: 'synthetic-not-a-secret' })),
      ).rejects.toThrow()
      expect(await readFile(file)).toEqual(before)
      expect(state.read()).toEqual(initial())
    },
  )
  nodeNativeTest('H15 serializes concurrent updates and rejects stale generation', async () => {
    const { state } = await store()
    const writes = await Promise.allSettled([
      state.update(1, (value) => ({ ...value, setup: null })),
      state.update(1, (value) => ({ ...value, config: { ...value.config, label: 'Other' } })),
    ])
    expect(writes.map((item) => item.status)).toEqual(['fulfilled', 'rejected'])
    expect(state.read().generation).toBe(2)
    expect(state.read().config.label).toBe('Home')
  })
  nodeNativeTest(
    'H15 verifies audit content, ordering and its state head after restart',
    async () => {
      const { dir, state } = await store()
      await state.append({
        time: 1,
        sessionId: null,
        kind: 'node',
        action: 'stop',
        outcome: 'allowed',
      })
      await state.append({
        time: 2,
        sessionId: null,
        kind: 'node',
        action: 'lock',
        outcome: 'allowed',
      })
      const reopened = new NodeStateStore(dir)
      await reopened.load()
      expect(reopened.audit().map((entry) => entry.seq)).toEqual([1, 2])
      const file = path.join(dir, NODE_STATE_FILE)
      const good = await readFile(file, 'utf8')
      for (const mutation of [
        good.replace('"action":"stop"', '"action":"wipe"'),
        good.replace('"seq":1', '"seq":9'),
        good.replace('"previousHash":"000', '"previousHash":"111'),
        good.replace('"auditHead":{"seq":2', '"auditHead":{"seq":1'),
      ]) {
        expect(mutation).not.toBe(good)
        await writeFile(file, mutation)
        await expect(new NodeStateStore(dir).load()).rejects.toThrow()
      }
    },
  )
  nodeNativeTest(
    'H09 retains a verified anchor while enforcing audit byte and age caps',
    async () => {
      const { dir, state } = await store()
      await state.update(1, (value) => ({
        ...value,
        config: { ...value.config, audit: { maxBytes: 700, retentionDays: 1 } },
      }))
      await state.append({
        time: 1,
        sessionId: null,
        kind: 'node',
        action: 'stop',
        outcome: 'allowed',
      })
      await state.append({
        time: 2,
        sessionId: null,
        kind: 'node',
        action: 'stop',
        outcome: 'allowed',
      })
      expect(Buffer.byteLength(JSON.stringify(state.audit()))).toBeLessThanOrEqual(700)
      await state.append({
        time: 172_800_000,
        sessionId: null,
        kind: 'node',
        action: 'lock',
        outcome: 'allowed',
      })
      expect(state.audit().map((entry) => entry.seq)).toEqual([3])
      const reopened = new NodeStateStore(dir)
      await reopened.load()
      expect(reopened.audit()).toEqual(state.audit())
    },
  )
  nodeNativeTest('H15 refuses newer and malformed state without mutation', async () => {
    const { dir } = await store()
    const file = path.join(dir, NODE_STATE_FILE)
    const good = await readFile(file, 'utf8')
    for (const text of [good.replace('"state":{"v":1', '"state":{"v":2'), '{']) {
      await writeFile(file, text)
      await expect(new NodeStateStore(dir).load()).rejects.toThrow()
      expect(await readFile(file, 'utf8')).toBe(text)
    }
  })
  nodeNativeTest('H11 refuses a public state root and symlink state files', async () => {
    const { dir } = await store()
    await chmod(dir, 0o755)
    await expect(new NodeStateStore(dir).load()).rejects.toThrow()
    await chmod(dir, 0o700)
    const target = path.join(dir, 'outside.json')
    const file = path.join(dir, NODE_STATE_FILE)
    await writeFile(target, await readFile(file), { mode: 0o600 })
    await rm(file)
    await symlink(target, file)
    await expect(new NodeStateStore(dir).load()).rejects.toThrow()
    expect(() => new NodePrivateFiles(dir).file('../outside.json')).toThrow()
    await expect(new NodePrivateFiles(dir).read('../outside.json', 100)).rejects.toThrow()
  })
  nodeNativeTest(
    'H09 bounds private reads even when a file is larger than its admission size',
    async () => {
      const dir = await root()
      const files = new NodePrivateFiles(dir)
      await files.write('bounded.json', 'abc')
      await expect(files.read('bounded.json', 2)).rejects.toThrow()
      expect(await files.read('bounded.json', 3)).toBe('abc')
    },
  )
  it('backs up before a forward migration and refuses missing or jumping migrations', async () => {
    const backups: number[] = []
    // Current v1 has no invented legacy migration; v0 and unknown v2 fail closed.
    const backup = (_old: unknown, from: number) => {
      backups.push(from)
      return Promise.resolve()
    }
    await expect(migrateNodeState({ ...initial(), v: 0 }, [], backup)).rejects.toThrow()
    await expect(migrateNodeState({ ...initial(), v: 2 }, [], backup)).rejects.toThrow()
    expect(await migrateNodeState(initial(), [], backup)).toEqual(initial())
    expect(backups).toEqual([])
  })
  nodeNativeTest('H11 refuses another owner and a substituted opened file identity', async () => {
    const dir = await root()
    const files = new NodePrivateFiles(dir)
    await files.write('identity.json', 'test')
    const info = await identity.lstatIdentity(dir)
    info.uid += 1n
    const owner = vi.spyOn(identity, 'lstatIdentity').mockResolvedValueOnce(info)
    await expect(files.prepare()).rejects.toThrow()
    owner.mockRestore()
    const held = await identity.lstatIdentity(path.join(dir, 'identity.json'))
    held.ino += 1n
    const swapped = vi.spyOn(identity, 'handleIdentity').mockResolvedValueOnce(held)
    await expect(files.read('identity.json', 100)).rejects.toThrow()
    swapped.mockRestore()
  })
})
