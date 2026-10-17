import { mkdir, readFile, symlink } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertTeamCheckout } from '../../src/core/team/teamWorkspaces'
import { canonicalPath } from '../../src/host/canonicalPath'
import { TeamCleanup, type TeamCopy } from '../../src/host/team/teamCleanup'
import { teamRepository } from './helpers/teamRepository'

const copy = (target: string, overrides: Partial<TeamCopy> = {}): TeamCopy => ({
  path: target,
  windowInstanceId: 'window-one',
  taskId: 'task-one',
  outcome: 'merged',
  quarantined: false,
  ...overrides,
})
function dependencies() {
  return {
    mayRemove: vi.fn((item: TeamCopy) => Promise.resolve(item.windowInstanceId === 'window-one')),
    hasFreshHint: vi.fn().mockResolvedValue(true),
    confirmQuarantine: vi.fn().mockResolvedValue(true),
    removeRef: vi.fn((_name: string, _oid: string) => Promise.resolve()),
  }
}

describe('team copy hygiene', () => {
  let repo: Awaited<ReturnType<typeof teamRepository>>
  beforeEach(async () => {
    repo = await teamRepository()
  })
  afterEach(async () => {
    await repo.dispose()
  })
  it('unlinks links/junctions and removes deep copies without touching the outside canary', async () => {
    const canary = path.join(repo.folder, 'canary')
    await repo.write('keep.txt', 'keep', canary)
    const target = path.join(repo.storage, 'copy')
    await mkdir(target)
    await symlink(
      canary,
      path.join(target, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const deep = Array.from({ length: 12 }, (_value, index) => `long-folder-${String(index)}`).join(
      '/',
    )
    await repo.write(`${deep}/a.txt`, 'payload', target)
    const cleanup = new TeamCleanup(repo.storage, dependencies())
    expect(await cleanup.diskUse(target)).toBeLessThan(1000)
    expect(await cleanup.sweep([copy(target)], [])).toEqual([target])
    expect(await readFile(path.join(canary, 'keep.txt'), 'utf8')).toBe('keep')
    await expect(readFile(path.join(target, deep, 'a.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('sweeps terminal and owned orphan copies/refs, preserves unmerged and foreign-owned work', async () => {
    const deps = dependencies()
    const cleanup = new TeamCleanup(repo.storage, deps)
    const rows = ['merged', 'discarded', 'review', 'orphan', 'other-window'].map((name) =>
      copy(path.join(repo.storage, name), {
        outcome: name,
        ...(name === 'orphan' && { taskId: null }),
        ...(name === 'other-window' && { windowInstanceId: 'other', outcome: 'merged' }),
      }),
    )
    for (const row of rows) await repo.write('a', 'saved work', row.path)
    const refs = rows.map((owner) => ({
      name: `refs/heads/agents/engineering/${owner.outcome ?? ''}`,
      oid: 'old-oid',
      outcome: owner.outcome ?? '',
      owner,
    }))
    refs.push({ ...refs[0]!, name: 'refs/heads/main' })
    expect(await cleanup.sweep(rows, refs)).toEqual([
      ...rows.slice(0, 2).map((row) => row.path),
      rows[3]!.path,
    ])
    expect(deps.removeRef.mock.calls.map(([name]) => name)).toEqual(
      refs.slice(0, 2).map((ref) => ref.name),
    )
    for (const row of [rows[2]!, rows[4]!])
      expect(await readFile(path.join(row.path, 'a'), 'utf8')).toBe('saved work')
  })

  it('keeps quarantine until explicit Clean up, warning even when the old owner may be live', async () => {
    const deps = dependencies()
    const cleanup = new TeamCleanup(repo.storage, deps)
    const row = copy(path.join(repo.storage, 'quarantine'), {
      quarantined: true,
      outcome: 'interrupted',
    })
    await repo.write('a', 'late writer', row.path)
    expect(await cleanup.sweep([row], [])).toEqual([])
    expect(deps.confirmQuarantine).not.toHaveBeenCalled()
    expect(await cleanup.sweep([row], [], true)).toEqual([row.path])
    expect(deps.confirmQuarantine).toHaveBeenCalledWith(row, true)
  })

  it('refuses removal outside storage, storage itself and paths through an ancestor link', async () => {
    const cleanup = new TeamCleanup(repo.storage, dependencies())
    await expect(cleanup.sweep([copy(repo.root)], [])).rejects.toThrow()
    await expect(cleanup.sweep([copy(repo.storage)], [])).rejects.toThrow()
    await symlink(
      repo.root,
      path.join(repo.storage, 'redirect'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(
      cleanup.sweep([copy(path.join(repo.storage, 'redirect', 'a.txt'))], []),
    ).rejects.toThrow()
    expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe('base-a\n')
  })

  it('guards worker starts and command directories against the canonical user checkout', async () => {
    const deps = { canonicalPath, platform: process.platform }
    for (const mode of ['own-branch', 'read-only'] as const) {
      await expect(assertTeamCheckout(repo.root, repo.root, mode, deps)).rejects.toThrow()
      await expect(
        assertTeamCheckout(repo.root, path.join(repo.root, 'src'), mode, deps),
      ).rejects.toThrow()
    }
    await symlink(
      repo.root,
      path.join(repo.storage, 'alias'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(
      assertTeamCheckout(repo.root, path.join(repo.storage, 'alias'), 'own-branch', deps),
    ).rejects.toThrow()
    await expect(
      assertTeamCheckout(repo.root, repo.root, 'in-place', deps),
    ).resolves.toBeUndefined()
    await expect(
      assertTeamCheckout(repo.root, repo.storage, 'own-branch', deps),
    ).resolves.toBeUndefined()
  })
})
