// Lane I's workspaces (PLAN.md D75, M96 acceptance 5): the base commit,
// shared clones with no remote, the `agents/<role>/<task-id>` branches and
// refs, scratch copies for read-only workers, the end-of-task commit and
// fetch, and cleanup. Real temporary repositories; no model calls.

import { lstat, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import type * as ChildProcess from 'node:child_process'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { cpSync } from 'node:fs'
import { workerEnvironment } from '../../src/core/team/refFence'
import {
  commitTaskBranch,
  isTeamWorkspaceError,
  publishTaskRef,
  removeTeamWorkspace,
  resolveBaseCommit,
  isSameTeamPath,
  scratchBreach,
  startTeamWorkspace,
  teamCloneFolder,
  teamCommitSubject,
  TeamWorkspaceError,
  teamProgramFreeGit,
  type TeamWorkspace,
} from '../../src/core/team/teamWorkspaces'
import {
  cleanupTeamRoots,
  fixtureBlobs,
  teamFixtureCommit,
  teamFixtureRepo,
  teamGitEnv,
  teamGitRunner,
  teamRealPath,
  teamShortRoot,
  teamWindowsPath,
} from './helpers/teamGit'

const runGit = teamGitRunner()
cleanupTeamRoots()
const TEXT = new TextDecoder()

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>()
  return { ...actual, execFile: vi.fn(actual.execFile) }
})

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

// Tests of creation below still call taskWorkspace. Other tests need only
// an independent, already-created copy; prepare each mode once, outside tests.
const templates: { own?: TaskWorkspace; readOnly?: TaskWorkspace } = {}
beforeAll(async () => {
  templates.own = await taskWorkspace('fixture')
})
beforeAll(async () => {
  templates.readOnly = await taskWorkspace('fixture', 'read-only', 'code-review')
})

async function copiedTaskWorkspace(
  taskId: string,
  mode: 'own-branch' | 'read-only' = 'own-branch',
  role = 'engineering',
  fixture?: WorkspaceFixture,
): Promise<TaskWorkspace> {
  const { root, head } = fixture ?? (await teamFixtureRepo(runGit))
  const template = mode === 'own-branch' ? templates.own! : templates.readOnly!
  expect(head).toBe(template.head)
  const folder = teamCloneFolder(
    path.join(root, '..', 'storage'),
    role,
    taskId,
    mode,
    process.platform,
  )
  await mkdir(path.dirname(folder), { recursive: true })
  cpSync(template.workspace.folder, folder, { recursive: true })
  await writeFile(
    path.join(folder, '.git', 'objects', 'info', 'alternates'),
    `${path.join(root, '.git', 'objects')}\n`,
  )
  if (mode === 'read-only') {
    return { root, head, workspace: { folder } }
  }
  const branch = `agents/${role}/${taskId}`
  const agentsRef = `refs/heads/${branch}`
  await runGit(['branch', '-m', branch], folder)
  await runGit(['update-ref', agentsRef, head, '0'.repeat(head.length)], root)
  return { root, head, workspace: { folder, branch, agentsRef } }
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
  it('honours gitignore, local info/exclude and core.excludesFile without changing the index', async () => {
    const { root } = await teamFixtureRepo(runGit)
    const global = path.join(root, '..', 'owned-global-excludes')
    await writeFile(global, 'global-only.txt\n')
    await runGit(['config', 'core.excludesFile', global], root)
    await writeFile(path.join(root, '.git', 'info', 'exclude'), 'local-only.txt\n')
    await writeFile(path.join(root, '.gitignore'), 'ignored.txt\n')
    for (const file of ['ignored.txt', 'local-only.txt', 'global-only.txt', 'source.ts']) {
      await writeFile(path.join(root, file), 'synthetic private fixture\n')
    }
    await writeFile(path.join(root, 'tracked.txt'), 'dirty\n')
    const index = await readFile(path.join(root, '.git', 'index'))
    const base = await resolveBaseCommit(runGit, root)
    const names = TEXT.decode(await runGit(['ls-tree', '-r', '--name-only', base], root)).split(
      '\n',
    )
    expect(names).toContain('source.ts')
    for (const file of ['ignored.txt', 'local-only.txt', 'global-only.txt']) {
      expect(names).not.toContain(file)
    }
    expect(await readFile(path.join(root, '.git', 'index'))).toEqual(index)
  })

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
    const objectPath = await readFile(alternates, 'utf8')
    expect(path.resolve(objectPath.trim())).toBe(path.join(root, '.git', 'objects'))
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
    const first = await copiedTaskWorkspace('t1')
    const second = await copiedTaskWorkspace('t2', 'own-branch', 'engineering', first)
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
    const { root, head, workspace } = await copiedTaskWorkspace('t1')
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
    const { head, workspace } = await copiedTaskWorkspace('t1')
    const result = await commitWorkerEdit(workspace.folder, 'engineering', 't1', 'entry-a')
    expect(result).toEqual({ committed: false, head })
  })
})

describe('publishTaskRef', () => {
  it('refuses a ref the extension did not write last, without overwriting it', async () => {
    const { root, head, workspace } = await copiedTaskWorkspace('t1')
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
  it('reports a held ref lock as Git failure rather than fictitious movement', async () => {
    const { root, head, workspace } = await copiedTaskWorkspace('locked')
    const ref = 'refs/heads/agents/engineering/locked'
    const lock = path.join(root, '.git', `${ref}.lock`)
    await writeFile(lock, 'synthetic lock\n')
    await expect(
      publishTaskRef(runGit, root, workspace.folder, 'agents/engineering/locked', ref, head),
    ).rejects.toMatchObject({ name: 'TeamGitError' })
    expect(await revOf(root, ref)).toBe(head)
  })

  it('refuses an intervening ref movement at the object import boundary', async () => {
    const { root, head, workspace } = await copiedTaskWorkspace('cas')
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
    const { workspace } = await copiedTaskWorkspace('ignored', 'read-only', 'code-review')
    await writeFile(path.join(workspace.folder, '.git', 'info', 'exclude'), 'ignored-canary\n')
    await writeFile(path.join(workspace.folder, 'ignored-canary'), 'write\n')
    expect(await scratchBreach(runGit, workspace.folder)).toContain('ignored-canary')
  })

  it('is clean on an untouched scratch copy', async () => {
    const { workspace } = await copiedTaskWorkspace('t1', 'read-only', 'code-review')
    await expect(scratchBreach(runGit, workspace.folder)).resolves.toEqual([])
  })

  it('lists a read-only worker’s write', async () => {
    const { workspace } = await copiedTaskWorkspace('t1', 'read-only', 'code-review')
    await writeWorkerFile(workspace.folder, 'shared.txt', 'one\nFIXED\nthree\n')
    await writeWorkerFile(workspace.folder, 'new-file.txt', 'created\n')
    await expect(scratchBreach(runGit, workspace.folder)).resolves.toEqual(
      expect.arrayContaining(['shared.txt', 'new-file.txt']),
    )
  })
})

describe('round 2: extension-owned Git isolation', () => {
  it('disables hooks, fsmonitor, filters and configured programs on every worker-copy command', async () => {
    const { workspace } = await copiedTaskWorkspace('programs')
    const folder = workspace.folder
    const canary = path.join(folder, 'program-fired')
    const program = `touch "${canary}"; cat`
    await writeFile(path.join(folder, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\n${program}\n`, {
      mode: 0o755,
    })
    await runGit(['config', 'core.fsmonitor', program], folder)
    await runGit(['config', 'filter.canary.clean', program], folder)
    await runGit(['config', 'filter.canary.process', program], folder)
    await runGit(['config', 'filter.canary.required', 'true'], folder)
    await writeFile(
      path.join(folder, '.gitattributes'),
      '*.txt filter=canary diff=canary merge=canary\n',
    )
    await writeFile(path.join(folder, 'shared.txt'), 'safe edit\n')
    const committed = await commitWorkerEdit(folder, 'engineering', 'programs', 'entry')
    expect(committed.committed).toBe(true)
    expect(await scratchBreach(runGit, folder)).toEqual([])
    await expect(readFile(canary)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('passes isolated environment and disables named diff/merge drivers at the shared seam', async () => {
    const calls: {
      readonly args: readonly string[]
      readonly env: NodeJS.ProcessEnv | undefined
    }[] = []
    const fakeGit: typeof runGit = (args, _cwd, _input, env) => {
      calls.push({ args, env })
      return Promise.resolve(
        new TextEncoder().encode(
          args.includes('config') ? 'diff.canary.command\0merge.canary.driver\0' : '',
        ),
      )
    }
    await teamProgramFreeGit(fakeGit)(['status'], process.cwd())
    expect(calls).toHaveLength(2)
    expect(calls[1]?.args).toEqual(
      expect.arrayContaining([
        'core.fsmonitor=false',
        'core.askPass=',
        'credential.helper=',
        'diff.canary.command=',
        'diff.canary.textconv=',
        'merge.canary.driver=false',
      ]),
    )
    expect(calls.every((call) => call.args.some((arg) => arg.startsWith('core.hooksPath=')))).toBe(
      true,
    )
    expect(calls[1]?.env?.['GIT_CONFIG_GLOBAL']).toBe(
      process.platform === 'win32' ? 'NUL' : '/dev/null',
    )
    expect(calls[1]?.env?.['GIT_TERMINAL_PROMPT']).toBe('0')
  })
})

describe('removeTeamWorkspace', () => {
  it('removes the copy and its branch at merge or discard', async () => {
    const { root, head, workspace } = await copiedTaskWorkspace('t1')
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
      await copiedTaskWorkspace('linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  })

  it('unlinks a replaced copy instead of following it', async () => {
    const { root, workspace } = await copiedTaskWorkspace('leaf-link')
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
    await expectLinkedStorageRefused(await copiedTaskWorkspace('junction'), 'junction')
  })

  it('keeps an unmerged task until this runs', async () => {
    const { root, head, workspace } = await copiedTaskWorkspace('t1')
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
    expect(failure).toMatchObject({ message: expect.stringContaining('muse-spark-refuses-ssh') })
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

describe('Windows storage paths', () => {
  it('bounds the 8.3 listing to its fixture parent, never the whole TEMP', async () => {
    if (process.platform !== 'win32') {
      return
    }
    const { root } = await teamFixtureRepo(runGit)
    await teamShortRoot(root)
    const call = vi.mocked(execFile).mock.calls.findLast((entry) => entry[0] === 'cmd.exe')
    expect(call?.[1]).toEqual(['/d', '/c', 'dir', '/x', '/ad', `${path.dirname(root)}*`])
  })
  it.each(['case', 'drive', 'namespace'])(
    'starts and removes a copy through a %s alias',
    async (form) => {
      if (process.platform !== 'win32') {
        return
      }
      const { root, head } = await teamFixtureRepo(runGit)
      const storage = path.join(root, '..', 'storage')
      const alias = teamWindowsPath(storage, form)
      const workspace = await startTeamWorkspace(runGit, alias, process.platform, {
        repositoryRoot: teamWindowsPath(root, form),
        role: 'engineering',
        taskId: 'alias',
        mode: 'own-branch',
        baseCommit: head,
      })
      expect(await revOf(workspace.folder, 'HEAD')).toBe(head)
      await removeTeamWorkspace(runGit, root, alias, workspace.folder, workspace.agentsRef)
      await expect(lstat(workspace.folder)).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it('refuses an 8.3 storage alias without deleting the copy', async () => {
    if (process.platform !== 'win32') {
      return
    }
    const { root, workspace } = await copiedTaskWorkspace('short-name')
    const shortRoot = await teamShortRoot(root)
    if (shortRoot === undefined) {
      return // The volume did not report an 8.3 name.
    }
    await expect(
      removeTeamWorkspace(
        runGit,
        root,
        path.join(shortRoot, '..', 'storage'),
        path.join(shortRoot, '..', 'storage', 'agents', path.basename(workspace.folder)),
      ),
    ).rejects.toMatchObject({ code: 'workspaceFailed' })
    expect(await revOf(workspace.folder, 'HEAD')).toMatch(/^[a-f0-9]+$/)
  })
})

describe('canonical team path spellings', () => {
  it.each([
    [String.raw`C:\tree\Docs`, String.raw`c:\TREE\docs`, true],
    [String.raw`C:\tree`, String.raw`\\?\C:\tree`, true],
    [String.raw`\\server\share\tree`, String.raw`\\?\UNC\SERVER\SHARE\TREE`, true],
    [String.raw`\\server\share\tree`, String.raw`\\server\share2\tree`, false],
    [String.raw`\\server\share\tree`, String.raw`\\elsewhere\share\tree`, false],
    [String.raw`C:\tree`, String.raw`C:\tree-other`, false],
    [String.raw`C:\tree`, String.raw`D:\tree`, false],
    [String.raw`C:\tree`, String.raw`\\.\C:\tree`, false],
    [String.raw`C:\long-name`, String.raw`C:\LONG-N~1`, false],
  ])('compares %s with %s as equal=%s', (left, right, equal) => {
    expect(isSameTeamPath(left, right, 'win32')).toBe(equal)
  })

  it('keeps POSIX path casing distinct', () => {
    expect(isSameTeamPath('/repo/Docs', '/repo/docs', 'linux')).toBe(false)
  })
})

describe('fixture batch and ownership', () => {
  it.each(['oid blob nope\n', 'oid blob 3\nabcx', 'no header newline'])(
    'refuses a malformed object batch %s',
    (output) => {
      expect(() => fixtureBlobs(Buffer.from(output))).toThrow('Invalid fixture object batch')
    },
  )

  it('imports a real parent and reads UTF-8 and NUL bytes from a captured Git batch', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const content = 'binary\0\nλ\n'
    const head = await teamFixtureCommit(runGit, root, base, { 'fixture.bin': content })
    expect(await revOf(root, `${head}^`)).toBe(base)
    const blob = await revOf(root, `${head}:fixture.bin`)
    const captured = await runGit(['cat-file', '--batch-all-objects', '--batch'], root)
    expect(fixtureBlobs(captured).get(blob)).toEqual(new Uint8Array(Buffer.from(content)))
  })

  it('keeps copied workspace bytes, refs and object sources independent', async () => {
    const { root, head, workspace } = await copiedTaskWorkspace('independent')
    const alternates = await readFile(
      path.join(workspace.folder, '.git', 'objects', 'info', 'alternates'),
      'utf8',
    )
    expect(path.resolve(alternates.trim())).toBe(path.join(root, '.git', 'objects'))
    expect(await revOf(root, 'agents/engineering/independent')).toBe(head)
    expect(await revOf(workspace.folder, 'HEAD')).toBe(head)
    await writeWorkerFile(workspace.folder, 'shared.txt', 'only this copy\n')
    expect(await readFile(path.join(templates.own!.workspace.folder, 'shared.txt'), 'utf8')).toBe(
      'one\ntwo\nthree\n',
    )
    expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe('one\ntwo\nthree\n')
  })
})
