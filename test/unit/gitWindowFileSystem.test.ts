import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fingerprintUntracked, untrackedDiff } from '../../src/host/git/gitWindow'
import { ConversationGit } from '../../src/host/git/conversationGit'
import {
  captureGitOwner,
  isRepositoryRoot,
  openOwnedRepository,
} from '../../src/host/git/gitExtension'
import { systemPath } from '../../src/host/backend/memoryIo'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import {
  GIT_PROMPT_DIFF_MAX_CHARS,
  GIT_STATUS_UNTRACKED,
  UI_TEXT,
} from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'
import { fakeGitWindow, fakeRepository } from './helpers/fakeGit'

const fixture = { root: '' }
const noChange = () => undefined

beforeAll(async () => {
  fixture.root = await mkdtemp(path.join(tmpdir(), 'muse-m71-new-files-'))
})

afterAll(async () => {
  await removeFolder(fixture.root)
})

describe('untracked commit bytes on the file system (M71)', () => {
  it.skipIf(process.platform !== 'win32' || !/~\d/u.test(tmpdir()))(
    'accepts a genuine short-name workspace and the same API repository in long spelling',
    async () => {
      // mkdtemp may return long spelling even when its parent was short.
      // The runner's owned TMP alias is proven with GetShortPathNameW.
      const selectedAlias = tmpdir()
      const longRoot = await systemPath(selectedAlias)
      expect(realpathSync(selectedAlias)).not.toBe(longRoot)
      const repository = { ...fakeRepository(), rootUri: { fsPath: longRoot } }
      const opened = await openOwnedRepository(
        selectedAlias,
        process.platform,
        () => Promise.resolve(repository),
        captureGitOwner,
        noChange,
      )
      expect(opened.cwd).toBe(longRoot)
      expect(() => {
        opened.check()
      }).not.toThrow()
      expect(repository.calls).toEqual([{ method: 'status', args: [] }])
    },
  )

  it('accepts a linked repository root and refuses its ancestor for a selected subfolder', async () => {
    const target = path.join(fixture.root, 'repository')
    const alias = path.join(fixture.root, 'alias')
    await mkdir(path.join(target, 'subfolder'), { recursive: true })
    await symlink(target, alias, 'junction')
    const repository = { ...fakeRepository(), rootUri: { fsPath: target } }
    await expect(isRepositoryRoot(repository, alias, process.platform)).resolves.toBe(true)
    await expect(
      isRepositoryRoot(repository, path.join(alias, 'subfolder'), process.platform),
    ).resolves.toBe(false)
  })

  it('refuses committing a same-length new-file edit made during consent', async () => {
    const file = path.join(fixture.root, 'commit-new.ts')
    await writeFile(file, 'one')
    const repository = {
      ...fakeRepository({ untrackedChanges: [{ uri: { fsPath: file } }] }),
      rootUri: { fsPath: fixture.root },
    }
    const { window } = fakeGitWindow({ repository })
    const posted: HostToWebviewMessage[] = []
    const git = new ConversationGit(
      {
        ...window,
        workspaceRoot: fixture.root,
        platform: process.platform,
        untrackedFingerprint: fingerprintUntracked,
        captureGitOwner,
        confirmCommit: async () => {
          await writeFile(file, 'two')
          return true
        },
      },
      {
        sessionId: () => 'session',
        post: (message) => {
          posted.push(message)
        },
        notice: () => undefined,
        say: () => undefined,
      },
    )
    await git.handleAction('openCommit')
    await git.commit('Add file', true)
    expect(repository.calls.some((call) => call.method === 'commit')).toBe(false)
    expect(posted).toContainEqual({ type: 'gitDone', form: 'commit', ok: false })
    git.dispose()
  })

  it.each([
    ['in the untracked group', 'separate'],
    ['among the working tree changes', 'mixed'],
  ] as const)(
    'gives the commit prompt a new file’s contents %s, bounded and binary-safe',
    async (_label, view) => {
      const root = await mkdtemp(path.join(fixture.root, `prompt-${view}-`))
      const added = path.join(root, 'added.ts')
      const binary = path.join(root, 'image.bin')
      const large = path.join(root, 'large.txt')
      await writeFile(added, 'export const added = 1\n')
      await writeFile(binary, Buffer.from([1, 0, 2]))
      await writeFile(large, 'x'.repeat(GIT_PROMPT_DIFF_MAX_CHARS * 2))
      const changes = [added, binary, large].map((file) => ({
        uri: { fsPath: file },
        status: GIT_STATUS_UNTRACKED,
      }))
      const repository = {
        ...fakeRepository(
          view === 'separate' ? { untrackedChanges: changes } : { workingTreeChanges: changes },
        ),
        rootUri: { fsPath: root },
      }
      const { window } = fakeGitWindow({ repository })
      const git = new ConversationGit(
        {
          ...window,
          workspaceRoot: root,
          platform: process.platform,
          untrackedDiff,
          captureGitOwner,
        },
        { sessionId: () => 'session', post: () => undefined, notice: noChange, say: noChange },
      )
      const prompt = await git.promptFor('commitMessage')
      expect(prompt).toContain('+++ b/added.ts\n+export const added = 1\n')
      expect(prompt).toContain('+++ b/image.bin\nBinary file')
      expect(prompt).toContain('+++ b/large.txt\n+xxx')
      // At most one diff's worth is read, and the model is told the rest was left out.
      expect(prompt.length).toBeLessThan(GIT_PROMPT_DIFF_MAX_CHARS + 2000)
      expect(prompt).toContain('characters of the diff were left out')
      git.dispose()
    },
  )

  it('detects different bytes with the same file name and length', async () => {
    const file = path.join(fixture.root, 'new.ts')
    await writeFile(file, 'one')
    const before = await fingerprintUntracked([file], noChange)
    expect(before).toMatch(/^[\da-f]{64}$/u)
    await expect(fingerprintUntracked([file], noChange)).resolves.toBe(before)
    await writeFile(file, 'two')
    await expect(fingerprintUntracked([file], noChange)).resolves.not.toBe(before)
  })

  it('fingerprints a link itself and never the file it leads to', async () => {
    const first = path.join(fixture.root, 'first')
    const second = path.join(fixture.root, 'other')
    const link = path.join(fixture.root, 'link')
    await mkdir(first)
    await mkdir(second)
    await writeFile(path.join(first, 'private.txt'), 'one')
    // A directory junction needs no elevated privilege on Windows.
    await symlink(first, link, 'junction')
    const before = await fingerprintUntracked([link], noChange)
    await writeFile(path.join(first, 'private.txt'), 'two')
    await expect(fingerprintUntracked([link], noChange)).resolves.toBe(before)
    await rm(link, { force: true })
    await symlink(second, link, 'junction')
    await expect(fingerprintUntracked([link], noChange)).resolves.not.toBe(before)
  })

  it('propagates cancellation during the read and refuses non-file entries', async () => {
    const file = path.join(fixture.root, 'cancelled.txt')
    await writeFile(file, 'content')
    let checks = 0
    await expect(
      fingerprintUntracked([file], () => {
        checks += 1
        if (checks === 4) {
          throw new Error(UI_TEXT.gitOperationChanged)
        }
      }),
    ).rejects.toThrow(UI_TEXT.gitOperationChanged)
    await expect(fingerprintUntracked([file], noChange)).resolves.toMatch(/^[\da-f]{64}$/u)
    const folder = path.join(fixture.root, 'folder')
    await mkdir(folder)
    await expect(fingerprintUntracked([folder], noChange)).rejects.toThrow(UI_TEXT.gitUnavailable)
  })
})
