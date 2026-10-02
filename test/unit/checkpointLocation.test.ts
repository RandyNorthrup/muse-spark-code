import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkpointLocation } from '../../src/host/checkpoints/checkpointLocation'
import { legacyCheckpointTurns } from '../../src/host/checkpoints/legacyCheckpoints'
import { processGitProcess } from '../../src/host/git'
import {
  captured,
  restoreOutcome,
  harness,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  shadowRefs,
  storedRecords,
  turn,
  write,
} from './helpers/checkpointHarness'

afterEach(removeCheckpointFolders)

/** Namespace fixtures precede the lazy store's first presence/Git operation. */
async function workspaceFolders() {
  const h = await harness()
  await mkdir(h.storage, { recursive: true })
  return h
}

describe('checkpoint canonical-root storage (M72)', () => {
  it(
    'shares real records and native barriers across two workspace storage identities',
    async () => {
      const h = await workspaceFolders()
      const global = path.join(h.storage, 'global')
      const oneIdentity = path.join(h.storage, 'workspace-one')
      const twoIdentity = path.join(h.storage, 'workspace-two')
      await Promise.all([mkdir(oneIdentity), mkdir(twoIdentity)])
      const one = await checkpointLocation(h.root, global, process.platform)
      const two = await checkpointLocation(h.root, global, process.platform)
      expect(oneIdentity).not.toBe(twoIdentity)
      expect(one).toEqual(two)
      if (one === undefined || two === undefined) {
        throw new Error('expected canonical namespace')
      }
      const first = h.reopenAt(one.storageDir, one.canonicalRoot)
      const second = h.reopenAt(two.storageDir, two.canonicalRoot)
      await write(h.root, 'a.txt', 'a0\n')
      await first.record('s1', 't1', await captured(first))
      await write(h.root, 'a.txt', 'a1\n')
      await first.endTurn('s1', 't1')
      expect(await second.turns('s1')).toEqual(['t1'])
      await second.markNativeBackend()
      expect(await restoreOutcome(first, 't1')).toEqual({ ok: false, reason: 'nativeUnsafe' })
      expect(await read(h.root, 'a.txt')).toBe('a1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'resolves a physical directory alias to the same namespace',
    async () => {
      const h = await workspaceFolders()
      const alias = path.join(h.storage, 'workspace-alias')
      await symlink(h.root, alias, process.platform === 'win32' ? 'junction' : 'dir')
      const global = path.join(h.storage, 'global')
      expect(await checkpointLocation(alias, global, process.platform)).toEqual(
        await checkpointLocation(h.root, global, process.platform),
      )
      if (process.platform === 'win32') {
        expect(await checkpointLocation(h.root.toUpperCase(), global, 'win32')).toEqual(
          await checkpointLocation(h.root, global, 'win32'),
        )
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it('refuses missing or non-directory roots without inventing a safe namespace', async () => {
    const h = await workspaceFolders()
    const file = path.join(h.storage, 'not-directory')
    await writeFile(file, '')
    await expect(checkpointLocation(file, h.storage, process.platform)).rejects.toThrow()
    await expect(
      checkpointLocation(path.join(h.storage, randomUUID()), h.storage, process.platform),
    ).rejects.toThrow()
    expect(await checkpointLocation(undefined, h.storage, process.platform)).toBeUndefined()
  })

  it(
    'reads legacy refs and records.json without changing refs, bytes, fences or history',
    async () => {
      const h = await workspaceFolders()
      await turn(h, 't1', () => write(h.root, 'a.txt', 'old capture\n'))
      const legacyFile = path.join(h.storage, 'records.json')
      const legacyText = JSON.stringify({
        version: 1,
        checkpoints: [{ sessionId: 's1', turnId: 'legacy-file-turn' }],
        restores: [],
      })
      await writeFile(legacyFile, legacyText)
      const refs = shadowRefs(h.storage)
      const records = storedRecords(h.storage)
      const windows = await readdir(path.join(h.storage, 'windows'))
      const presence = await Promise.all(
        windows.map((name) => readFile(path.join(h.storage, 'windows', name), 'utf8')),
      )
      expect(
        await legacyCheckpointTurns(
          {
            storageDir: h.storage,
            workspaceRoot: h.root,
            platform: process.platform,
            git: processGitProcess(),
            env: process.env,
            signal: new AbortController().signal,
          },
          's1',
        ),
      ).toEqual(['legacy-file-turn', 't1'])
      expect(shadowRefs(h.storage)).toEqual(refs)
      expect(storedRecords(h.storage)).toEqual(records)
      expect(await readFile(legacyFile, 'utf8')).toBe(legacyText)
      expect(
        await Promise.all(
          windows.map((name) => readFile(path.join(h.storage, 'windows', name), 'utf8')),
        ),
      ).toEqual(presence)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
