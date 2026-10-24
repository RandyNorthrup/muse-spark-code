// M110b W2: workspace git classifies remotes, gates verbs, and builds
// the brokered env — SSH pinned, HTTPS helpered, pushes granted
// exactly, merges never, submodules and config smuggling refused. The
// runner itself starts the real git through the governed launch.
import { execFileSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isGovernedCommandUnavailable } from '../../src/core/resources/launch'
import {
  GitFailedError,
  hasNoCredentialMaterial,
  brokeredGitEnv,
  classifyRemote,
  gateVerb,
  runWorkspaceGit,
  splitNetworkArgs,
} from '../../src/runtime/node/workspaces/git'
import { useRuntimeGovernor } from './helpers/resources/runtimeGovernor'

const PROVISIONS = {
  sshEnv: { SSH_AUTH_SOCK: '/run/broker/agent.sock' },
  helper: { path: '/run/broker/git-helper', env: { BROKER_TICKET: 'ticket-1' } },
  knownHostsPath: '/run/broker/known-hosts',
}

describe('workspace git', () => {
  it('classifies remotes: ssh, https, local — and refuses the rest', () => {
    expect(classifyRemote('git@github.com:org/repo.git', 'linux')).toBe('ssh')
    expect(classifyRemote('ssh://git@github.com/org/repo.git', 'linux')).toBe('ssh')
    expect(classifyRemote('https://github.com/org/repo.git', 'linux')).toBe('https')
    // eslint-disable-next-line unicorn/prefer-https -- the refused-URL fixture must stay plain http; the rule's --fix would silently turn it into the accepted https case (PLAN.md §8).
    expect(classifyRemote('http://github.com/org/repo.git', 'linux')).toBe('refused')
    expect(classifyRemote('file:///srv/repo.git', 'linux')).toBe('local')
    expect(classifyRemote('/srv/repo.git', 'linux')).toBe('local')
    expect(classifyRemote('ext::sh -c evil', 'linux')).toBe('refused')
    expect(classifyRemote('fd::0', 'linux')).toBe('refused')
    expect(classifyRemote('--upload-pack=evil', 'linux')).toBe('refused')
    expect(classifyRemote(String.raw`C:\work\repo`, 'win32')).toBe('local')
    expect(classifyRemote('C:/work/repo', 'win32')).toBe('local')
  })
  it('gates verbs: local work runs, push needs its exact grant, merge never', () => {
    expect(gateVerb(['status'], [])).toEqual({ ok: true })
    expect(gateVerb(['clone', 'https://h/r.git'], [])).toEqual({ ok: true })
    expect(gateVerb(['pull', '--ff-only'], [])).toEqual({ ok: true })
    expect(gateVerb(['merge', 'main'], [])).toEqual({ ok: false, reason: 'merge-family' })
    expect(gateVerb(['rebase', 'main'], [])).toEqual({ ok: false, reason: 'merge-family' })
    expect(gateVerb(['push', 'origin', 'main'], [])).toEqual({
      ok: false,
      reason: 'push-ungranted',
    })
    expect(gateVerb(['push', 'origin', 'main'], [{ remote: 'origin', ref: 'main' }])).toEqual({
      ok: true,
    })
    expect(
      gateVerb(['push', '--force', 'origin', 'main'], [{ remote: 'origin', ref: 'main' }]),
    ).toEqual({ ok: false, reason: 'push-ungranted' })
    expect(
      gateVerb(['push', 'origin', 'main', '--force'], [{ remote: 'origin', ref: 'main' }]),
    ).toEqual({ ok: false, reason: 'push-ungranted' })
    expect(gateVerb(['fetch', 'origin', 'main'], [])).toEqual({ ok: true })
    expect(gateVerb(['bisect', 'start'], [])).toEqual({ ok: false, reason: 'unknown-verb' })
  })
  it('refuses submodule, config and runner smuggling wherever placed', () => {
    expect(gateVerb(['clone', '--recurse-submodules', 'https://h/r.git'], [])).toEqual({
      ok: false,
      reason: 'submodule',
    })
    expect(gateVerb(['status', 'submodule'], [])).toEqual({ ok: false, reason: 'submodule' })
    expect(gateVerb(['fetch', 'origin', '-c', 'a=b'], [])).toEqual({
      ok: false,
      reason: 'unsafe-flag',
    })
    expect(gateVerb(['log', '-c', 'a=b'], [])).toEqual({ ok: false, reason: 'config-override' })
    expect(gateVerb(['clone', '-u', 'evil', 'https://h/r.git'], [])).toEqual({
      ok: false,
      reason: 'unsafe-flag',
    })
    expect(gateVerb(['clone', '-uevil', 'https://h/r.git'], [])).toEqual({
      ok: false,
      reason: 'unsafe-flag',
    })
    expect(gateVerb(['clone', '--separate-git-dir=/tmp/x', 'https://h/r.git'], [])).toEqual({
      ok: false,
      reason: 'unsafe-flag',
    })
    expect(gateVerb(['status', '-C', '/tmp/x'], [])).toEqual({ ok: false, reason: 'unsafe-flag' })
    expect(gateVerb(['clean', '-fdx'], [])).toEqual({ ok: false, reason: 'unsafe-flag' })
    expect(gateVerb(['clean', '-fd'], [])).toEqual({ ok: true })
    expect(gateVerb(['status', '-uall'], [])).toEqual({ ok: true })
  })
  it('splits network args: flags consumed, remote positional, refspecs untouched', () => {
    expect(splitNetworkArgs(['--depth', '1', 'https://h/r.git', 'dir'])).toEqual({
      ok: true,
      remote: 'https://h/r.git',
    })
    expect(splitNetworkArgs(['/snap/bundle', '+refs/heads/*:refs/heads/*'])).toEqual({
      ok: true,
      remote: '/snap/bundle',
    })
    expect(splitNetworkArgs([])).toEqual({ ok: true })
    expect(splitNetworkArgs(['--depth'])).toEqual({ ok: true })
  })
  it('brokers the env per kind: pinned SSH, helpered HTTPS, bare local', () => {
    const base = { PATH: '/usr/bin', GIT_SSH_COMMAND: 'evil', GH_TOKEN: 'secret' }
    const ssh = brokeredGitEnv(base, 'linux', 'ssh', PROVISIONS)
    expect(ssh.ok).toBe(true)
    if (!ssh.ok) throw new Error('ssh refused')
    expect(ssh.env['SSH_AUTH_SOCK']).toBe('/run/broker/agent.sock')
    expect(ssh.env['GIT_SSH_COMMAND']).toContain('UserKnownHostsFile=/run/broker/known-hosts')
    expect(ssh.env['GIT_SSH_COMMAND']).toContain('BatchMode=yes')
    expect(ssh.env['GH_TOKEN']).toBeUndefined()
    expect(ssh.env['GIT_PAGER']).toBe('cat')
    const https = brokeredGitEnv(base, 'linux', 'https', PROVISIONS)
    expect(https.ok).toBe(true)
    if (!https.ok) throw new Error('https refused')
    expect(https.env['GIT_CONFIG_VALUE_0']).toBe('/run/broker/git-helper')
    expect(https.env['BROKER_TICKET']).toBe('ticket-1')
    expect(brokeredGitEnv(base, 'linux', 'ssh', {})).toEqual({ ok: false, reason: 'unpinned-ssh' })
    expect(brokeredGitEnv(base, 'linux', 'https', {})).toEqual({
      ok: false,
      reason: 'unbrokered-https',
    })
    const local = brokeredGitEnv(base, 'linux', 'local', {})
    expect(local.ok).toBe(true)
    if (!local.ok) throw new Error('local refused')
    expect(local.env['GIT_SSH_COMMAND']).toBe('false')
  })
  it('refuses provisions carrying key material, never runs them', () => {
    expect(hasNoCredentialMaterial({ SSH_AUTH_SOCK: '/run/agent.sock' })).toBe(true)
    expect(hasNoCredentialMaterial({ X: '-----BEGIN OPENSSH PRIVATE KEY-----' })).toBe(false)
    expect(hasNoCredentialMaterial({ X: 'ghp_SHORT' })).toBe(false)
    expect(
      brokeredGitEnv({}, 'linux', 'ssh', {
        sshEnv: { SSH_AUTH_SOCK: 'ghp_SHORT' },
        knownHostsPath: '/run/known-hosts',
      }),
    ).toEqual({ ok: false, reason: 'credential-material' })
  })
})

// A real program a repository could carry: it runs, prints, and is no git.
const PLANTABLE =
  process.platform === 'win32'
    ? path.join(process.env['SystemRoot'] ?? '', 'System32', 'whoami.exe')
    : '/bin/echo'

/** This process's environment with `first` ahead of every PATH entry, in its own spelling. */
function pathFirst(first: string): NodeJS.ProcessEnv {
  const key = Object.keys(process.env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH'
  return { ...process.env, [key]: `${first}${path.delimiter}${process.env[key] ?? ''}` }
}

/** What a run settled to: its result, or the error it rejected with. */
async function settled<T>(running: Promise<T>): Promise<T | Error> {
  try {
    return await running
  } catch (error: unknown) {
    if (error instanceof Error) return error
    throw error
  }
}

describe('workspace git through the governed launch', () => {
  // The runner's git is a governed start: admitted by the governor the
  // node command's process configures, on every platform it runs on.
  useRuntimeGovernor('ws-git-jobs-', true)
  const scratch = { root: '', repo: '', head: '' }
  const run = (
    gitPath: string,
    argv: readonly string[],
    extra: { baseEnv?: NodeJS.ProcessEnv; okCodes?: readonly number[] } = {},
  ) =>
    runWorkspaceGit(gitPath, argv, {
      cwd: scratch.repo,
      platform: process.platform,
      baseEnv: extra.baseEnv ?? process.env,
      remote: scratch.repo,
      provisions: {},
      ...(extra.okCodes !== undefined && { okCodes: extra.okCodes }),
    })

  beforeAll(async () => {
    scratch.root = await realpath(await mkdtemp(path.join(tmpdir(), 'ws-git-governed-')))
    scratch.repo = path.join(scratch.root, 'repo')
    await mkdir(scratch.repo)
    const git = (...argv: string[]) =>
      execFileSync('git', argv, { cwd: scratch.repo, encoding: 'utf8' })
    git('init', '-q', '.')
    await writeFile(path.join(scratch.repo, 'tracked.txt'), 'v1\n')
    git('add', 'tracked.txt')
    git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'seed')
    scratch.head = git('rev-parse', 'HEAD').trim()
  })
  afterAll(async () => {
    await rm(scratch.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('runs the real git and keeps its exit codes as results', async () => {
    const head = await run('git', ['rev-parse', 'HEAD'])
    expect(head.stdout.trim()).toBe(scratch.head)
    await writeFile(path.join(scratch.repo, 'tracked.txt'), 'v2\n')
    try {
      // `diff --quiet` answers 1 for differences: an exit the caller accepts.
      const diff = await run('git', ['diff', '--quiet'], { okCodes: [0, 1] })
      expect(diff.exitCode).toBe(1)
    } finally {
      await writeFile(path.join(scratch.repo, 'tracked.txt'), 'v1\n')
    }
    const failed = await settled(run('git', ['rev-parse', '--verify', 'refs/heads/none']))
    expect(failed).toBeInstanceOf(GitFailedError)
    expect(failed).toMatchObject({ exitCode: 128 })
  })

  it('never runs a program the repository plants as git', async () => {
    const planted = path.join(scratch.repo, process.platform === 'win32' ? 'git.exe' : 'git')
    await copyFile(PLANTABLE, planted)
    await chmod(planted, 0o755)
    try {
      // Named by its path inside the workspace: refused before anything
      // starts. Run, the plant would answer an exit (a GitFailedError).
      const refused = await settled(run(planted, ['rev-parse', 'HEAD']))
      if (!(refused instanceof Error)) throw new Error('the planted program was run')
      expect(refused).not.toBeInstanceOf(GitFailedError)
      expect(isGovernedCommandUnavailable(refused.cause)).toBe(true)
      // A bare git with the workspace first on PATH (and as the working
      // folder) resolves past the plant to the real git.
      const bare = await run('git', ['rev-parse', 'HEAD'], { baseEnv: pathFirst(scratch.repo) })
      expect(bare.stdout.trim()).toBe(scratch.head)
    } finally {
      await rm(planted, { force: true })
    }
  })
})
