// Lane I's workspaces (PLAN.md D75, M96 acceptance 5): the base commit,
// shared clones with no remote, the `agents/<role>/<task-id>` branches and
// refs, scratch copies for read-only workers, the end-of-task commit and
// fetch, and cleanup. Real temporary repositories; no model calls.

import { lstat, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { workerEnvironment } from '../../src/core/team/refFence'
import {
  commitTaskBranch,
  isTeamWorkspaceError,
  publishTaskRef,
  removeTeamWorkspace,
  resolveBaseCommit,
  scratchBreach,
  startTeamWorkspace,
  teamCloneFolder,
  teamCommitSubject,
  TeamWorkspaceError,
  type TeamWorkspace,
} from '../../src/core/team/teamWorkspaces'
import {
  cleanupTeamRoots,
  teamFixtureRepo,
  teamGitEnv,
  teamGitRunner,
  teamRealPath,
} from './helpers/teamGit'

const runGit = teamGitRunner()
cleanupTeamRoots()
const TEXT = new TextDecoder()

async function revOf(repo: string, rev: string): Promise<string> {
  return TEXT.decode(await runGit(['rev-parse', rev], repo)).trim()
}

async function writeWorkerFile(folder: string, name: string, content: string): Promise<void> {
  await writeFile(path.join(folder, name), content)
}

interface WorkspaceFixture {
  readonly root: string
  readonly head: string
}

interface TaskWorkspace {
  readonly root: string
  readonly head: string
  readonly workspace: TeamWorkspace
}

/** A task workspace in a fresh fixture repository. */
async function taskWorkspace(
  taskId: string,
  mode: 'own-branch' | 'read-only' = 'own-branch',
  role = 'engineering',
  fixture?: WorkspaceFixture,
): Promise<TaskWorkspace> {
  const { root, head } = fixture ?? (await teamFixtureRepo(runGit))
  const workspace = await startTeamWorkspace(
    runGit,
    path.join(root, '..', 'storage'),
    process.platform,
    { repositoryRoot: root, role, taskId, mode, baseCommit: head },
  )
  return { root, head, workspace }
}

/** Commit a worker's edit on its task branch. */
async function commitWorkerEdit(
  folder: string,
  role: string,
  taskId: string,
  entryId: string,
): Promise<{ readonly committed: boolean; readonly head: string }> {
  return await commitTaskBranch(runGit, folder, {
    branch: `agents/${role}/${taskId}`,
    role,
    taskId,
    entryId,
  })
}

async function expectLinkedStorageRefused(
  fixture: TaskWorkspace,
  linkType: 'dir' | 'junction',
): Promise<void> {
  const { root, workspace } = fixture
  const storage = path.join(root, '..', 'storage')
  const outside = path.join(root, '..', 'outside')
  await mkdir(path.join(outside, path.basename(workspace.folder)), { recursive: true })
  const sentinel = path.join(outside, path.basename(workspace.folder), 'sentinel')
  await writeFile(sentinel, 'safe')
  await rename(path.join(storage, 'agents'), path.join(storage, 'original-agents'))
  await symlink(outside, path.join(storage, 'agents'), linkType)
  await expect(removeTeamWorkspace(runGit, root, storage, workspace.folder)).rejects.toMatchObject({
    code: 'workspaceFailed',
  })
  expect(await readFile(sentinel, 'utf8')).toBe('safe')
}

describe('resolveBaseCommit', () => {
  it('is HEAD on a clean tree', async () => {
    const { root, head } = await teamFixtureRepo(runGit)
    await expect(resolveBaseCommit(runGit, root)).resolves.toBe(head)
  })

  it('captures uncommitted work with HEAD as parent, without touching the branch', async () => {
    const { root, head } = await teamFixtureRepo(runGit)
    await writeFile(path.join(root, 'shared.txt'), 'one\nWORK\nthree\n')
    const base = await resolveBaseCommit(runGit, root)
    expect(base).not.toBe(head)
    expect(await revOf(root, `${base}^`)).toBe(head)
    // The user's branch and tree are untouched.
    expect(await revOf(root, 'main')).toBe(head)
    expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe('one\nWORK\nthree\n')
    // The worker sees the uncommitted work through the base.
    expect(TEXT.decode(await runGit(['show', `${base}:shared.txt`], root))).toBe(
      'one\nWORK\nthree\n',
    )
  })
})

describe('repair regressions: base snapshot', () => {
  it('captures untracked source and staged edits without altering the user index or refs', async () => {
    const { root, head } = await teamFixtureRepo(runGit)
    await writeFile(path.join(root, 'tracked.txt'), 'staged\n')
    await runGit(['add', 'tracked.txt'], root)
    await writeFile(path.join(root, 'tracked.txt'), 'unstaged\n')
    await writeFile(path.join(root, 'new-source.ts'), 'export const value = 1\n')
    const index = await readFile(path.join(root, '.git', 'index'))
    const base = await resolveBaseCommit(runGit, root)
    expect(TEXT.decode(await runGit(['show', `${base}:new-source.ts`], root))).toContain(
      'export const value',
    )
    expect(TEXT.decode(await runGit(['show', `${base}:tracked.txt`], root))).toBe('unstaged\n')
    expect(await readFile(path.join(root, '.git', 'index'))).toEqual(index)
    expect(await revOf(root, `${base}^`)).toBe(head)
    expect(await revOf(root, 'main')).toBe(head)
  })
})

describe('startTeamWorkspace', () => {
  it('starts an own-branch clone with no remote, on the task branch from the base', async () => {
    const { root, head, workspace } = await taskWorkspace('t1')
    expect(workspace.branch).toBe('agents/engineering/t1')
    expect(workspace.agentsRef).toBe('refs/heads/agents/engineering/t1')
    expect(await revOf(workspace.folder, 'HEAD')).toBe(head)
    expect(TEXT.decode(await runGit(['remote'], workspace.folder)).trim()).toBe('')
    // The extension's own ref is in the user's repository at the base.
    expect(await revOf(root, 'refs/heads/agents/engineering/t1')).toBe(head)
    // The user's branch is untouched.
    expect(await revOf(root, 'main')).toBe(head)
  })

  it('shares objects with the user repository', async () => {
    const { root, workspace } = await taskWorkspace('t1')
    const alternates = path.join(workspace.folder, '.git', 'objects', 'info', 'alternates')
    const objectText = await readFile(alternates, 'utf8')
    const objectPaths = objectText
      .trim()
      .split(/\r?\n/)
      .map((entry) => path.normalize(entry))
    expect(objectPaths).toContain(path.join(root, '.git', 'objects'))
  })

  it('starts a read-only scratch copy with no agents/ ref', async () => {
    const { root, head, workspace } = await taskWorkspace('t2', 'read-only', 'code-review')
    expect(workspace.branch).toBeUndefined()
    expect(workspace.agentsRef).toBeUndefined()
    expect(await revOf(workspace.folder, 'HEAD')).toBe(head)
    await expect(revOf(root, 'refs/heads/agents/code-review/t2')).rejects.toThrow()
  })

  it('refuses a bad task id before making anything', async () => {
    const { root, head } = await teamFixtureRepo(runGit)
    await expect(
      startTeamWorkspace(runGit, path.join(root, '..', 'storage'), process.platform, {
        repositoryRoot: root,
        role: 'engineering',
        taskId: '../evil',
        mode: 'own-branch',
        baseCommit: head,
      }),
    ).rejects.toThrow(/Refused team branch/)
  })
})

describe('two writers', () => {
  it('never touch each other’s trees; both branches land from the same base', async () => {
    const first = await taskWorkspace('t1')
    const second = await taskWorkspace('t2', 'own-branch', 'engineering', first)
    const { root, head } = first
    expect(first.workspace.folder).not.toBe(second.workspace.folder)
    await writeWorkerFile(first.workspace.folder, 'shared.txt', 'one\nFIRST\nthree\n')
    await writeWorkerFile(second.workspace.folder, 'shared.txt', 'one\nSECOND\nthree\n')
    expect(await readFile(path.join(first.workspace.folder, 'shared.txt'), 'utf8')).toBe(
      'one\nFIRST\nthree\n',
    )
    expect(await readFile(path.join(second.workspace.folder, 'shared.txt'), 'utf8')).toBe(
      'one\nSECOND\nthree\n',
    )
    const one = await commitWorkerEdit(first.workspace.folder, 'engineering', 't1', 'entry-a')
    const two = await commitWorkerEdit(second.workspace.folder, 'engineering', 't2', 'entry-b')
    expect(one.committed).toBe(true)
    expect(two.committed).toBe(true)
    await publishTaskRef(
      runGit,
      root,
      first.workspace.folder,
      'agents/engineering/t1',
      'refs/heads/agents/engineering/t1',
      head,
    )
    await publishTaskRef(
      runGit,
      root,
      second.workspace.folder,
      'agents/engineering/t2',
      'refs/heads/agents/engineering/t2',
      head,
    )
    expect(await revOf(root, 'refs/heads/agents/engineering/t1')).toBe(one.head)
    // The user's branch still has no commit.
    expect(await revOf(root, 'main')).toBe(head)
  })
})

describe('commitTaskBranch', () => {
  it('names the role, the entry and the task', () => {
    expect(teamCommitSubject('engineering', 't1', 'entry-a')).toBe('team(engineering/t1): entry-a')
    expect(teamCommitSubject('engineering', 't1', 'a\nb')).toBe('team(engineering/t1): a b')
  })

  it('commits the working copy without committing the user branch', async () => {
    const { root, head, workspace } = await taskWorkspace('t1')
    await writeWorkerFile(workspace.folder, 'shared.txt', 'one\nCHANGED\nthree\n')
    const { committed, head: taskHead } = await commitWorkerEdit(
      workspace.folder,
      'engineering',
      't1',
      'entry-a',
    )
    expect(committed).toBe(true)
    expect(
      TEXT.decode(await runGit(['log', '-1', '--format=%s', taskHead], workspace.folder)).trim(),
    ).toBe('team(engineering/t1): entry-a')
    expect(await revOf(root, 'main')).toBe(head)
  })

  it('skips the commit when nothing changed', async () => {
    const { head, workspace } = await taskWorkspace('t1')
    const result = await commitWorkerEdit(workspace.folder, 'engineering', 't1', 'entry-a')
    expect(result).toEqual({ committed: false, head })
  })
})

describe('publishTaskRef', () => {
  it('refuses a ref the extension did not write last, without overwriting it', async () => {
    const { root, head, workspace } = await taskWorkspace('t1')
    await writeWorkerFile(workspace.folder, 'shared.txt', 'one\nCHANGED\nthree\n')
    const { head: taskHead } = await commitWorkerEdit(
      workspace.folder,
      'engineering',
      't1',
      'entry-a',
    )
    // A worker's script pushes into the user's repository by its path: the
    // ref now holds the task head, which the extension never wrote there,
    // and the reflog shows receive-pack wrote it.
    await runGit(
      ['push', root, 'agents/engineering/t1:refs/heads/agents/engineering/t1'],
      workspace.folder,
    )
    const subjects = TEXT.decode(
      await runGit(['log', '-g', '--format=%gs', 'refs/heads/agents/engineering/t1'], root),
    )
    expect(subjects.split('\n')).toContain('push')
    let failure: unknown
    try {
      await publishTaskRef(
        runGit,
        root,
        workspace.folder,
        'agents/engineering/t1',
        'refs/heads/agents/engineering/t1',
        head,
      )
      expect.unreachable()
    } catch (error: unknown) {
      failure = error
    }
    expect(isTeamWorkspaceError(failure)).toBe(true)
    expect(failure).toMatchObject({ name: 'TeamWorkspaceError', code: 'refMoved' })
    // The breach did not win: no fetch overwrote it.
    expect(await revOf(root, 'refs/heads/agents/engineering/t1')).toBe(taskHead)
  })
})

describe('repair regressions: publication CAS', () => {
  it('refuses an intervening ref movement at the object import boundary', async () => {
    const { root, head, workspace } = await taskWorkspace('cas')
    await writeWorkerFile(workspace.folder, 'shared.txt', 'changed\n')
    const { head: taskHead } = await commitWorkerEdit(
      workspace.folder,
      'engineering',
      'cas',
      'entry',
    )
    const ref = 'refs/heads/agents/engineering/cas'
    const racingGit: typeof runGit = async (args, cwd, input) => {
      const result = await runGit(args, cwd, input)
      if (args[0] === 'fetch') {
        await runGit(['update-ref', ref, taskHead, head], root)
      }
      return result
    }
    await expect(
      publishTaskRef(racingGit, root, workspace.folder, 'agents/engineering/cas', ref, head),
    ).rejects.toMatchObject({ code: 'refMoved' })
    expect(await revOf(root, ref)).toBe(taskHead)
  })
})

describe('scratchBreach', () => {
  it('detects ignored writes in a read-only scratch copy', async () => {
    const { workspace } = await taskWorkspace('ignored', 'read-only', 'code-review')
    await writeFile(path.join(workspace.folder, '.git', 'info', 'exclude'), 'ignored-canary\n')
    await writeFile(path.join(workspace.folder, 'ignored-canary'), 'write\n')
    expect(await scratchBreach(runGit, workspace.folder)).toContain('ignored-canary')
  })

  it('is clean on an untouched scratch copy', async () => {
    const { workspace } = await taskWorkspace('t1', 'read-only', 'code-review')
    await expect(scratchBreach(runGit, workspace.folder)).resolves.toEqual([])
  })

  it('lists a read-only worker’s write', async () => {
    const { workspace } = await taskWorkspace('t1', 'read-only', 'code-review')
    await writeWorkerFile(workspace.folder, 'shared.txt', 'one\nFIXED\nthree\n')
    await writeWorkerFile(workspace.folder, 'new-file.txt', 'created\n')
    await expect(scratchBreach(runGit, workspace.folder)).resolves.toEqual(
      expect.arrayContaining(['shared.txt', 'new-file.txt']),
    )
  })
})

describe('removeTeamWorkspace', () => {
  it('removes the copy and its branch at merge or discard', async () => {
    const { root, head, workspace } = await taskWorkspace('t1')
    await removeTeamWorkspace(
      runGit,
      root,
      path.join(root, '..', 'storage'),
      workspace.folder,
      workspace.agentsRef,
    )
    await expect(teamRealPath(workspace.folder)).rejects.toThrow()
    await expect(revOf(root, 'refs/heads/agents/engineering/t1')).rejects.toThrow()
    expect(await revOf(root, 'main')).toBe(head)
  })

  it('refuses a replaced storage ancestor without deleting the outside sentinel', async () => {
    await expectLinkedStorageRefused(
      await taskWorkspace('linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  })

  it('unlinks a replaced copy instead of following it', async () => {
    const { root, workspace } = await taskWorkspace('leaf-link')
    const storage = path.join(root, '..', 'storage')
    const outside = path.join(root, '..', 'outside')
    await mkdir(outside)
    await writeFile(path.join(outside, 'sentinel'), 'safe')
    await rename(workspace.folder, `${workspace.folder}-original`)
    await symlink(outside, workspace.folder, process.platform === 'win32' ? 'junction' : 'dir')
    await removeTeamWorkspace(runGit, root, storage, workspace.folder)
    await expect(lstat(workspace.folder)).rejects.toThrow()
    expect(await readFile(path.join(outside, 'sentinel'), 'utf8')).toBe('safe')
  })

  it('refuses a Windows junction storage ancestor', async () => {
    if (process.platform !== 'win32') {
      return
    }
    await expectLinkedStorageRefused(await taskWorkspace('junction'), 'junction')
  })

  it('refuses a noncanonical Windows case spelling without deleting the task', async () => {
    if (process.platform !== 'win32') {
      return
    }
    const { root, head, workspace } = await taskWorkspace('case')
    const storage = path.join(root, '..', 'storage')
    const alias = storage.toUpperCase()
    expect(alias).not.toBe(storage)
    expect(await teamRealPath(alias)).toBe(storage)
    await expect(
      removeTeamWorkspace(runGit, root, alias, workspace.folder, workspace.agentsRef),
    ).rejects.toMatchObject({ name: 'TeamWorkspaceError', code: 'workspaceFailed' })
    expect(await revOf(workspace.folder, 'HEAD')).toBe(head)
    expect(await teamRealPath(workspace.folder)).toBe(workspace.folder)
  })

  it('keeps an unmerged task until this runs', async () => {
    const { root, head, workspace } = await taskWorkspace('t1')
    // Still there: nothing removed it.
    expect(await revOf(root, 'refs/heads/agents/engineering/t1')).toBe(head)
    await teamRealPath(workspace.folder)
  })
})

describe('credential-free workers', () => {
  it('Git cannot recover a synthetic helper from config parameters or passthrough', async () => {
    const { root } = await teamFixtureRepo(runGit)
    const workerGit = teamGitRunner(
      workerEnvironment(
        {
          ...teamGitEnv,
          GIT_CONFIG_PARAMETERS: "'credential.helper=!printf canary'",
          SSH_AUTH_SOCK: '/synthetic/socket',
        },
        process.platform,
        ['GIT_CONFIG_PARAMETERS', 'SSH_AUTH_SOCK'],
      ),
    )
    expect(
      TEXT.decode(await workerGit(['config', '--get-all', 'credential.helper'], root)).trim(),
    ).toBe('')
  })

  it('a worker’s remote reach fails on our refusing ssh, not on the network', async () => {
    const { root } = await teamFixtureRepo(runGit)
    const workerGit = teamGitRunner(workerEnvironment(teamGitEnv, process.platform))
    // No server is contacted: the refusing ssh command fails first.
    let failure: unknown
    try {
      await workerGit(['ls-remote', 'ssh://git@localhost:2222/no-such-repo.git'], root)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toMatchObject({ name: 'TeamGitError' })
    expect(failure).toMatchObject({
      message: expect.stringContaining('Could not read from remote repository'),
    })
  })
})

describe('teamCloneFolder', () => {
  it('refuses past the platform limit', () => {
    const long = `/${'s'.repeat(300)}`
    expect(() => teamCloneFolder(long, 'engineering', 't1', 'own-branch', 'win32')).toThrow(
      TeamWorkspaceError,
    )
  })

  it('uses short folder names', () => {
    expect(teamCloneFolder('/storage', 'engineering', 't1', 'own-branch', process.platform)).toBe(
      process.platform === 'win32'
        ? String.raw`\storage\agents\engineering-t1`
        : '/storage/agents/engineering-t1',
    )
  })
})
