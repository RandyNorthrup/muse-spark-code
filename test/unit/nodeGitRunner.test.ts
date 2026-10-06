import { execFile } from 'node:child_process'
import {
  cp,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NodePrivateFiles } from '../../src/runtime/node/privateFiles'
import { createNodeGitSnapshot } from '../../src/runtime/node/gitSnapshot'
import { NodeClosedGitRunner, type NodeGitRunnerOptions } from '../../src/runtime/node/gitRunner'

const runFile = promisify(execFile)
const directories: string[] = []
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'm110-git-'))
  directories.push(root)
  const workspaces = path.join(root, 'workspaces')
  const repo = path.join(workspaces, 'repo')
  const state = path.join(root, 'state')
  await mkdir(repo, { recursive: true })
  await mkdir(state, { mode: 0o700 })
  await runFile('git', ['init', '--initial-branch=main', repo])
  await writeFile(path.join(repo, 'example.txt'), 'test content\n')
  const execPathOutput = await runFile('git', ['--exec-path'])
  const execPath = execPathOutput.stdout.trim()
  const files = new NodePrivateFiles(state)
  const use = vi.fn(() => Promise.reject(new Error('test network not authorized')))
  const publish = vi.fn(() => Promise.resolve())
  const options: NodeGitRunnerOptions = {
    files,
    workspaceRoot: workspaces,
    workspacePath: () => Promise.resolve('repo'),
    git: '/usr/bin/git',
    execPath,
    network: { use },
    commitIdentity: () =>
      Promise.resolve({ name: 'Test Node', email: 'test-node@example.invalid' }),
    publish,
  }
  return {
    root,
    repo,
    workspaces,
    state,
    files,
    use,
    publish,
    options,
    runner: new NodeClosedGitRunner(options),
  }
}
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('M110-N closed Git runner (native Linux receipt)', () => {
  it('H14 ignores repository programs, inherited GIT settings and credential sockets on reads', async () => {
    const { repo, root, runner, options } = await setup()
    if (process.platform !== 'linux') {
      await expect(
        runner.run(
          'node/git/status',
          { workspaceId: 'repo', cursor: null },
          new AbortController().signal,
        ),
      ).rejects.toThrow()
      return
    }
    const marker = path.join(root, 'canary-ran')
    const program = path.join(root, 'canary.sh')
    await writeFile(program, `#!/bin/sh\nprintf invoked > '${marker}'\n`)
    await chmod(program, 0o700)
    await writeFile(
      path.join(repo, '.git', 'config'),
      `[core]\nrepositoryformatversion=0\nbare=false\nfsmonitor=${program}\nsshCommand=${program}\nhooksPath=${root}\n[credential]\nhelper=${program}\n[filter "canary"]\nclean=${program}\nsmudge=${program}\nprocess=${program}\n[diff "canary"]\ncommand=${program}\ntextconv=${program}\n[merge "canary"]\ndriver=${program}\n[include]\npath=${program}\n[url "ssh://attacker.invalid/"]\ninsteadOf=ssh://approved.invalid/\n[remote "origin"]\nuploadpack=${program}\nreceivepack=${program}\n[protocol "ext"]\nallow=always\n`,
    )
    await writeFile(path.join(repo, '.gitattributes'), '* filter=canary diff=canary merge=canary\n')
    const original = process.env['GIT_CONFIG_COUNT']
    const sock = process.env['SSH_AUTH_SOCK']
    process.env['GIT_CONFIG_COUNT'] = '1'
    process.env['GIT_CONFIG_KEY_0'] = 'core.fsmonitor'
    process.env['GIT_CONFIG_VALUE_0'] = program
    process.env['SSH_AUTH_SOCK'] = '/synthetic-deploy-canary'
    try {
      const output = await runner.run(
        'node/git/status',
        { workspaceId: 'repo', cursor: null },
        new AbortController().signal,
      )
      expect(output).toContain('example.txt')
      // Test-only U1 publisher: copy the already private data into this fixture.
      options.publish = async (snapshot) => {
        for (const name of ['index', 'HEAD', 'objects', 'refs'])
          await cp(path.join(snapshot.gitDir, name), path.join(repo, '.git', name), {
            recursive: true,
          })
      }
      const signal = new AbortController().signal
      await runner.run('node/git/branches', { workspaceId: 'repo', cursor: null }, signal)
      await runner.run('node/git/diff', { workspaceId: 'repo', path: null, staged: false }, signal)
      await runner.run('node/git/stage', { workspaceId: 'repo', paths: ['example.txt'] }, signal)
      await runner.run('node/git/diff', { workspaceId: 'repo', path: null, staged: true }, signal)
      await runner.run(
        'node/git/commit',
        { workspaceId: 'repo', expectedHead: null, message: 'fixture' },
        signal,
      )
      await runner.run(
        'node/git/branch',
        { workspaceId: 'repo', expectedHead: null, name: 'fixture-branch' },
        signal,
      )
      await expect(readFile(marker)).rejects.toThrow()
    } finally {
      if (original === undefined) delete process.env['GIT_CONFIG_COUNT']
      else process.env['GIT_CONFIG_COUNT'] = original
      if (sock === undefined) delete process.env['SSH_AUTH_SOCK']
      else process.env['SSH_AUTH_SOCK'] = sock
      delete process.env['GIT_CONFIG_KEY_0']
      delete process.env['GIT_CONFIG_VALUE_0']
    }
  })
  it('H14 local mutations publish their private snapshot through the U1 port without credential use', async () => {
    const { runner, publish, use } = await setup()
    if (process.platform !== 'linux') {
      await expect(
        runner.run(
          'node/git/stage',
          { workspaceId: 'repo', paths: ['example.txt'] },
          new AbortController().signal,
        ),
      ).rejects.toThrow()
      return
    }
    await runner.run(
      'node/git/stage',
      { workspaceId: 'repo', paths: ['example.txt'] },
      new AbortController().signal,
    )
    expect(publish).toHaveBeenCalledOnce()
    expect(use).not.toHaveBeenCalled()
  })
  it('H10 refuses object alternates, symlinks and service state inside a workspace', async () => {
    const { files, workspaces, repo } = await setup()
    if (process.platform !== 'linux') {
      await expect(
        createNodeGitSnapshot(files, workspaces, 'repo', new AbortController().signal),
      ).rejects.toThrow()
      return
    }
    await writeFile(
      path.join(repo, '.git', 'objects', 'info', 'alternates'),
      '/synthetic-outside-store',
    )
    await expect(
      createNodeGitSnapshot(files, workspaces, 'repo', new AbortController().signal),
    ).rejects.toThrow()
    await rm(path.join(repo, '.git', 'objects', 'info', 'alternates'))
    await symlink(path.join(repo, 'example.txt'), path.join(repo, '.git', 'objects', 'escape'))
    await expect(
      createNodeGitSnapshot(files, workspaces, 'repo', new AbortController().signal),
    ).rejects.toThrow()
    await rm(path.join(repo, '.git', 'objects', 'escape'))
    const unsafe = new NodePrivateFiles(path.join(repo, 'state'))
    await expect(
      createNodeGitSnapshot(unsafe, workspaces, 'repo', new AbortController().signal),
    ).rejects.toThrow()
  })
  it('H09 refuses oversized import before allocating or copying it', async () => {
    const { files, workspaces, repo } = await setup()
    const file = path.join(repo, '.git', 'objects', 'too-large')
    await writeFile(file, '')
    await truncate(file, 33 * 1024 * 1024)
    await expect(
      createNodeGitSnapshot(files, workspaces, 'repo', new AbortController().signal),
    ).rejects.toThrow()
  })
  it('H14 refuses a changed resolved destination before any credentialed child', async () => {
    const { options, runner, repo, root } = await setup()
    if (process.platform !== 'linux') {
      await expect(
        createNodeGitSnapshot(
          options.files,
          options.workspaceRoot,
          'repo',
          new AbortController().signal,
        ),
      ).rejects.toThrow()
      return
    }
    await runFile('git', ['-C', repo, 'add', '--', 'example.txt'])
    await runFile('git', [
      '-C',
      repo,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'fixture',
    ])
    const marker = path.join(root, 'network-canary')
    const wrapper = path.join(root, 'ssh-wrapper')
    await writeFile(wrapper, `#!/bin/sh\nprintf invoked > '${marker}'\nexit 1\n`, { mode: 0o700 })
    const headOutput = await runFile('git', ['-C', repo, 'rev-parse', 'HEAD'])
    const head = headOutput.stdout.trim()
    const destination = {
      host: 'git.example.invalid',
      port: 22,
      user: 'git',
      repository: 'owner/repo.git',
      hostKeyDigest: 'a'.repeat(64),
    }
    options.network.use = async (params, _signal, run) =>
      await run({
        socket: '/synthetic-agent',
        wrapper,
        destination: { ...params.destination, host: 'changed.example.invalid' },
      })
    await expect(
      runner.run(
        'node/git/push',
        {
          workspaceId: 'repo',
          remote: 'origin',
          ref: 'refs/heads/main',
          expectedHead: head,
          destination,
          stepUpId: 'proof',
          actionDigest: 'b'.repeat(64),
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow()
    await expect(readFile(marker)).rejects.toThrow()
    options.network.use = async (params, _signal, run) =>
      await run({ socket: '/synthetic-agent', wrapper, destination: params.destination })
    await expect(
      runner.run(
        'node/git/push',
        {
          workspaceId: 'repo',
          remote: 'origin',
          ref: 'refs/heads/main',
          expectedHead: 'c'.repeat(40),
          destination,
          stepUpId: 'proof',
          actionDigest: 'b'.repeat(64),
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow()
    await expect(readFile(marker)).rejects.toThrow()
  })
})
