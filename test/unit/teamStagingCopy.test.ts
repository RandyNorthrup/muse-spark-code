import { chmod, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkIdentity, formatStagedTables, StagingCopy } from '../../src/host/team/stagingCopy'
import { UI_TEXT } from '../../src/shared/constants'
import { teamRepository } from './helpers/teamRepository'

describe('team staging copies', () => {
  let repo: Awaited<ReturnType<typeof teamRepository>>
  beforeEach(async () => {
    repo = await teamRepository()
  })
  afterEach(async () => {
    await repo.dispose()
  })

  it('preserves Git executable modes on a permission-blind checkout and staging clone', async () => {
    await repo.permissionBlindExecutable()
    expect(await repo.git(['diff', '--stat'])).toBe('')
    const snapshot = await repo.staging.snapshot(repo.root)
    expect(snapshot.blobs.get('run.sh')?.mode).toBe('100755')
    const copy = path.join(repo.storage, 'executable-copy')
    await repo.staging.clone(repo.root, snapshot, copy)
    expect(await repo.git(['ls-files', '--stage', 'run.sh'], copy)).toMatch(/^100755 /u)
  })

  it('uses staged mode changes ahead of the HEAD mode on a permission-blind checkout', async () => {
    await repo.git(['config', 'core.filemode', 'false'])
    await repo.git(['update-index', '--chmod=+x', 'a.txt'])
    const snapshot = await repo.staging.snapshot(repo.root)
    expect(snapshot.blobs.get('a.txt')?.mode).toBe('100755')
    expect(await repo.git(['ls-tree', 'HEAD', 'a.txt'])).toMatch(/^100644 /u)
  })

  it('cross-checks POSIX filesystem mode after Git mode capture', async () => {
    await repo.git(['config', 'core.filemode', 'true'])
    const staging = new StagingCopy(
      async (args, options) => {
        const output = await repo.processGit(args, options)
        if (args.includes('diff-files')) await chmod(path.join(repo.root, 'a.txt'), 0o755)
        return output
      },
      repo.env,
      path.join(repo.storage, 'mode-race'),
    )
    if (process.platform === 'win32') {
      const snapshot = await staging.snapshot(repo.root)
      expect(snapshot.blobs.get('a.txt')?.mode).toBe('100644')
    } else await expect(staging.snapshot(repo.root)).rejects.toThrow(UI_TEXT.checkpointFailed)
  })

  it('snapshots all visible files through a temporary index, preserving the real index and raw blobs', async () => {
    await repo.write('a.txt', 'staged\n')
    await repo.git(['add', 'a.txt'])
    await repo.write('a.txt', 'unstaged\r\n')
    await repo.write('untracked.txt', 'dependency\r\n')
    await rm(path.join(repo.root, 'b.txt'))
    await repo.write('.gitattributes', '* filter=unsafe text eol=lf\n')
    await repo.git(['config', 'filter.unsafe.clean', 'touch filter-ran'])
    const index = await readFile(path.join(repo.root, '.git', 'index'))
    const head = await repo.staging.head(repo.root)
    const snapshot = await repo.staging.snapshot(repo.root)
    expect(snapshot.head).toBe(head)
    expect(snapshot.blobs.has('b.txt')).toBe(false)
    expect(await repo.staging.readBlob(repo.root, snapshot.blobs.get('a.txt')!.oid)).toEqual(
      Buffer.from('unstaged\r\n'),
    )
    expect(
      await repo.staging.readBlob(repo.root, snapshot.blobs.get('untracked.txt')!.oid),
    ).toEqual(Buffer.from('dependency\r\n'))
    expect(await readFile(path.join(repo.root, '.git', 'index'))).toEqual(index)
    expect(await readdir(path.join(repo.storage, 'indices'))).toEqual([])
    const copy = path.join(repo.storage, 'staging')
    await repo.staging.clone(repo.root, snapshot, copy)
    expect(await readFile(path.join(copy, 'a.txt'))).toEqual(Buffer.from('unstaged\r\n'))
    expect(await repo.git(['remote'], copy)).toBe('')
    expect(await readdir(repo.root)).not.toContain('filter-ran')
    await repo.write('untracked.txt', 'changed dependency\n')
    const changed = await repo.staging.snapshot(repo.root)
    expect(changed.tree).not.toBe(snapshot.tree)
  })

  it('refuses escaped tracked parents and submodule directories, cleaning its private index', async () => {
    await repo.write('redirect/a.txt', 'tracked\n')
    await repo.git(['add', 'redirect/a.txt'])
    await rm(path.join(repo.root, 'redirect'), { recursive: true })
    const canary = await repo.outsideLink('redirect')
    await expect(repo.staging.snapshot(repo.root)).rejects.toThrow(UI_TEXT.checkpointFailed)
    expect(await readFile(path.join(canary, 'a.txt'), 'utf8')).toBe('outside')
    await rm(path.join(repo.root, 'redirect'))
    await repo.git(['update-index', '--force-remove', 'redirect/a.txt'])
    const head = await repo.staging.head(repo.root)
    await repo.git(['update-index', '--add', '--cacheinfo', `160000,${head},submodule`])
    await mkdir(path.join(repo.root, 'submodule'))
    await expect(repo.staging.snapshot(repo.root)).rejects.toThrow(UI_TEXT.checkpointFailed)
    expect(await readdir(path.join(repo.storage, 'indices'))).toEqual([])
  })

  it('refuses a HEAD change during capture and still removes its private index', async () => {
    const previous = await repo.staging.snapshot(repo.root)
    const staging = new StagingCopy(
      async (args, options) => {
        const output = await repo.processGit(args, options)
        if (args.includes('write-tree')) await repo.git(['update-ref', 'HEAD', previous.commit])
        return output
      },
      repo.env,
      path.join(repo.storage, 'changing-head'),
    )
    await expect(staging.snapshot(repo.root)).rejects.toThrow()
    expect(await readdir(path.join(repo.storage, 'changing-head'))).toEqual([])
  })

  it('binds resolved commands, platform, setup and cache key into the check identity', () => {
    const identity = {
      commands: [{ name: 'test', command: 'npm test', timeoutSeconds: 60 }],
      platform: 'linux',
      setupCommand: 'npm ci',
      cacheKey: 'one',
    }
    const hash = checkIdentity(identity)
    expect(checkIdentity({ ...identity })).toBe(hash)
    expect(
      checkIdentity({
        ...identity,
        commands: [{ ...identity.commands[0]!, command: 'npm run changed' }],
      }),
    ).not.toBe(hash)
    for (const field of ['platform', 'setupCommand', 'cacheKey'] as const)
      expect(checkIdentity({ ...identity, [field]: 'changed' })).not.toBe(hash)
  })

  it('imports a staging result into a landing ref without changing the working tree or index', async () => {
    const snapshot = await repo.staging.snapshot(repo.root)
    const copy = path.join(repo.storage, 'result')
    await repo.staging.clone(repo.root, snapshot, copy)
    await repo.write('a.txt', 'branch bytes\n', copy)
    const final = await repo.staging.snapshot(copy)
    const index = await readFile(path.join(repo.root, '.git', 'index'))
    const branch = await repo.staging.landingBranch(repo.root, final, 'deferred', copy)
    expect(await repo.git(['show', `${branch}:a.txt`])).toBe('branch bytes')
    expect(await readFile(path.join(repo.root, 'a.txt'), 'utf8')).toBe('base-a\n')
    expect(await readFile(path.join(repo.root, '.git', 'index'))).toEqual(index)
    await expect(repo.staging.landingBranch(repo.root, final, '../main', copy)).rejects.toThrow()
  })

  it('passes only the child allowlist and private index, never inherited Git configuration', async () => {
    const calls: NodeJS.ProcessEnv[] = []
    const staging = new StagingCopy(
      (args, options) => {
        calls.push(options.env)
        return repo.processGit(args, options)
      },
      {
        ...repo.env,
        GIT_INDEX_FILE: 'wrong.index',
        GIT_DIR: 'wrong.git',
        UNLISTED_ENV: 'sentinel',
      },
      path.join(repo.storage, 'private-index'),
    )
    await staging.snapshot(repo.root)
    expect(
      calls.every(
        (env) =>
          env['GIT_DIR'] === undefined &&
          env['UNLISTED_ENV'] === undefined &&
          env['GIT_INDEX_FILE'] !== 'wrong.index',
      ),
    ).toBe(true)
  })

  it('uses real git merge-file for both clean text and conflict markers', async () => {
    const base = Buffer.from('first\nmiddle\nlast\n')
    const clean = await repo.staging.mergeText(
      base,
      Buffer.from('ours\nmiddle\nlast\n'),
      Buffer.from('first\nmiddle\ntheirs\n'),
    )
    expect(clean).toEqual({ bytes: Buffer.from('ours\nmiddle\ntheirs\n'), conflicts: false })
    const conflict = await repo.staging.mergeText(
      base,
      Buffer.from('ours\nmiddle\nlast\n'),
      Buffer.from('theirs\nmiddle\nlast\n'),
    )
    expect(conflict.conflicts).toBe(true)
    expect(conflict.bytes.toString('utf8')).toContain('<<<<<<< ours')
  })

  it('validates both intents after formatting and captures the formatter output', async () => {
    const table = path.join(repo.root, 'table.json')
    await repo.write('table.json', '{"ours":1,"theirs":2}')
    const verifyIntents = vi.fn((_file: string, bytes: Buffer) => {
      expect(bytes.toString('utf8')).toBe('{ "ours": 1, "theirs": 2 }\n')
      return Promise.resolve()
    })
    await formatStagedTables([table], {
      formatAfterEdit: () => repo.write('table.json', '{ "ours": 1, "theirs": 2 }\n'),
      verifyIntents,
    })
    expect(verifyIntents).toHaveBeenCalledOnce()
    const snapshot = await repo.staging.snapshot(repo.root)
    expect(await repo.staging.readBlob(repo.root, snapshot.blobs.get('table.json')!.oid)).toEqual(
      await readFile(table),
    )
    await expect(
      formatStagedTables([table], {
        formatAfterEdit: () => repo.write('table.json', '{"ours":1}'),
        verifyIntents,
      }),
    ).rejects.toThrow()
  })
})
