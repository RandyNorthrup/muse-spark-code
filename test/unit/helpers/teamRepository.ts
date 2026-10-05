import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { processGitProcess } from '../../../src/host/git'
import { StagingCopy } from '../../../src/host/team/stagingCopy'

/** Every fixture, clone and journal stays inside this lane's worktree. */
export async function teamRepository() {
  const temporary = path.join(process.cwd(), '.m96cq')
  await mkdir(temporary, { recursive: true })
  const folder = await mkdtemp(path.join(temporary, 'repo-'))
  const root = path.join(folder, 'work')
  const storage = path.join(folder, 'storage')
  await mkdir(root)
  await mkdir(storage)
  const env = {
    PATH: process.env['PATH'],
    SystemRoot: process.env['SystemRoot'],
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
  }
  const processGit = processGitProcess()
  const git = async (args: readonly string[], cwd = root, input?: string): Promise<string> => {
    const output = await processGit(
      [
        '-c',
        'user.name=Team test',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'core.hooksPath=/dev/null',
        ...args,
      ],
      { cwd, env, timeoutMs: 120_000, ...(input !== undefined && { input }) },
    )
    return output.toString('utf8').trim()
  }
  await git(['init', '-b', 'main'])
  const write = async (name: string, bytes: string | Buffer, cwd = root) => {
    await mkdir(path.dirname(path.join(cwd, name)), { recursive: true })
    await writeFile(path.join(cwd, name), bytes)
  }
  await write('a.txt', 'base-a\n')
  await write('b.txt', 'base-b\n')
  await git(['add', '.'])
  await git(['commit', '-m', 'base'])
  const staging = new StagingCopy(processGit, env, path.join(storage, 'indices'))
  return {
    folder,
    root,
    storage,
    env,
    processGit,
    git,
    write,
    staging,
    permissionBlindExecutable: async () => {
      await write('run.sh', '#!/bin/sh\nexit 0\n')
      await git(['add', 'run.sh'])
      await git(['update-index', '--chmod=+x', 'run.sh'])
      await git(['commit', '-m', 'executable'])
      await git(['config', 'core.filemode', 'false'])
      await chmod(path.join(root, 'run.sh'), 0o644)
    },
    outsideLink: async (name: string) => {
      const canary = path.join(folder, 'canary')
      await write('a.txt', 'outside', canary)
      await symlink(
        canary,
        path.join(root, name),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      return canary
    },
    dispose: async () => {
      await rm(folder, { recursive: true, force: true })
    },
  }
}
