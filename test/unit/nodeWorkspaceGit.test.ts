// M110b W2: workspace git classifies remotes, gates verbs, and builds
// the brokered env — SSH pinned, HTTPS helpered, pushes granted
// exactly, merges never, submodules and config smuggling refused.
import { describe, expect, it } from 'vitest'
import {
  hasNoCredentialMaterial,
  brokeredGitEnv,
  classifyRemote,
  gateVerb,
  splitNetworkArgs,
} from '../../src/runtime/node/workspaces/git'

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
