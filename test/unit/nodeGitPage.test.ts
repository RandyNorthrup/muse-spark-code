import { describe, expect, it, vi } from 'vitest'
import { createNodeGitMethods, type NodeGitPagePort } from '../../src/runtime/node/web/git'
import { nodeActionDigest } from '../../src/runtime/node/listenerMethods'
import {
  networkGitDigest,
  runNetworkGit,
  type NodePageAuthPort,
} from '../../src/webview/node/git/network'
import { validatedNodePort } from '../../src/webview/bridges/nodePort'
import { UI_TEXT } from '../../src/shared/constants'
import type {
  NodeMethodName,
  NodeMethodParams,
  NodeMethodResult,
} from '../../src/shared/hostApi/nodeMethods'

const destination = {
  host: 'git.example.invalid',
  port: 22,
  user: 'git',
  repository: 'owner/repo.git',
  hostKeyDigest: 'a'.repeat(64),
}
const status = {
  branch: 'refs/heads/main',
  head: 'b'.repeat(40),
  changes: [{ path: 'file.txt', kind: 'modified' }],
  nextCursor: null,
  remotes: [{ name: 'origin', destination }],
} satisfies NodeMethodResult<'node/git/status'>
function params(
  method: 'node/git/push' | 'node/git/pull' | 'node/git/fetch',
): NodeMethodParams<'node/git/push'> {
  const input = {
    workspaceId: 'repo',
    remote: 'origin',
    destination,
    ref: 'refs/heads/main',
    expectedHead: status.head,
    stepUpId: 'verified-proof',
    actionDigest: '0'.repeat(64),
  }
  return { ...input, actionDigest: nodeActionDigest(method, input) }
}
function runtime() {
  const inspect = vi.fn<NodeGitPagePort['inspect']>(() => Promise.resolve(status))
  const run = vi.fn<NodeGitPagePort['run']>((method) =>
    Promise.resolve(
      method === 'node/git/status' ? status : { head: 'c'.repeat(40), changed: true },
    ),
  )
  return { inspect, run, methods: createNodeGitMethods({ inspect, run }) }
}
const signal = () => new AbortController().signal
describe('M110-U1 Git page admission', () => {
  it.each(['fetch', 'pull', 'push'] as const)(
    'accepts an exact %s binding and preserves every destination field',
    async (action) => {
      const { methods, run } = runtime()
      const method = `node/git/${action}` as const
      await methods[action](params(method), signal())
      expect(run).toHaveBeenCalledWith(method, params(method), expect.any(AbortSignal))
    },
  )
  it.each(['host', 'port', 'user', 'repository', 'hostKeyDigest'] as const)(
    'H14 refuses changed destination %s before dispatch',
    async (field) => {
      const { methods, inspect, run } = runtime()
      inspect.mockResolvedValueOnce({
        ...status,
        remotes: [
          {
            name: 'origin',
            destination: {
              ...destination,
              [field]: {
                port: 2222,
                hostKeyDigest: 'd'.repeat(64),
                host: 'changed.invalid',
                user: 'changed',
                repository: 'changed',
              }[field],
            },
          },
        ],
      })
      await expect(methods.push(params('node/git/push'), signal())).rejects.toThrow()
      expect(run).not.toHaveBeenCalled()
    },
  )
  it.each([{ head: 'd'.repeat(40) }, { branch: 'refs/heads/other' }, { remotes: [] }])(
    'H14 refuses changed head, ref or remote registration',
    async (change) => {
      const { methods, inspect, run } = runtime()
      inspect.mockResolvedValueOnce({ ...status, ...change })
      await expect(methods.push(params('node/git/push'), signal())).rejects.toThrow()
      expect(run).not.toHaveBeenCalled()
    },
  )
  it('H14 refuses an altered action digest and H10 stale null-head local mutation', async () => {
    const { methods, run } = runtime()
    await expect(
      methods.push({ ...params('node/git/push'), actionDigest: 'e'.repeat(64) }, signal()),
    ).rejects.toThrow()
    await expect(
      methods.commit({ workspaceId: 'repo', expectedHead: null, message: 'initial' }, signal()),
    ).rejects.toThrow()
    await expect(
      methods.branch({ workspaceId: 'repo', expectedHead: null, name: 'new' }, signal()),
    ).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })
  it('local methods validate results, exact file paths and expected heads', async () => {
    const { methods, run } = runtime()
    expect(await methods.status({ workspaceId: 'repo', cursor: null }, signal())).toEqual(status)
    run.mockResolvedValueOnce({
      head: status.head,
      digest: 'a'.repeat(64),
      diff: 'diff',
      truncated: false,
    })
    const diff = await methods.diff({ workspaceId: 'repo', path: null, staged: false }, signal())
    expect(diff.diff).toBe('diff')
    run.mockResolvedValueOnce({
      branches: [{ name: 'refs/heads/main', current: true }],
      nextCursor: null,
    })
    const branches = await methods.branches({ workspaceId: 'repo', cursor: null }, signal())
    expect(branches.branches).toHaveLength(1)
    run.mockResolvedValueOnce({ done: true })
    await methods.stage({ workspaceId: 'repo', paths: ['file.txt'] }, signal())
    await methods.commit(
      { workspaceId: 'repo', expectedHead: status.head, message: 'fixture' },
      signal(),
    )
    await methods.branch({ workspaceId: 'repo', expectedHead: status.head, name: 'new' }, signal())
    await expect(
      methods.stage({ workspaceId: 'repo', paths: ['../escape'] }, signal()),
    ).rejects.toThrow()
  })
  it('H08 refuses already cancelled inspection and dispatch, including read-only methods', async () => {
    const { methods, inspect, run } = runtime()
    const controller = new AbortController()
    controller.abort()
    await expect(
      methods.stage({ workspaceId: 'repo', paths: ['file.txt'] }, controller.signal),
    ).rejects.toThrow()
    await expect(
      methods.diff({ workspaceId: 'repo', path: null, staged: false }, controller.signal),
    ).rejects.toThrow()
    await expect(
      methods.branches({ workspaceId: 'repo', cursor: null }, controller.signal),
    ).rejects.toThrow()
    await expect(
      methods.commit(
        { workspaceId: 'repo', expectedHead: status.head, message: 'fixture' },
        controller.signal,
      ),
    ).rejects.toThrow()
    await expect(methods.push(params('node/git/push'), controller.signal)).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
    expect(inspect).not.toHaveBeenCalled()
  })
  it('H08 refuses a local result delivered after cancellation', async () => {
    const { methods, run } = runtime()
    const controller = new AbortController()
    run.mockImplementationOnce(() => {
      controller.abort()
      return Promise.resolve({ done: true })
    })
    await expect(
      methods.stage({ workspaceId: 'repo', paths: ['file.txt'] }, controller.signal),
    ).rejects.toThrow()
  })
  it('H10 parses mutation receipts before returning local or network results', async () => {
    const { methods, run } = runtime()
    run.mockResolvedValue({ head: status.head, changed: true, extra: 'untrusted' })
    await expect(methods.push(params('node/git/push'), signal())).rejects.toThrow()
    await expect(
      methods.commit(
        { workspaceId: 'repo', expectedHead: status.head, message: 'fixture' },
        signal(),
      ),
    ).rejects.toThrow()
  })
})

function browser() {
  const request = vi.fn<
    (method: NodeMethodName, params: unknown, signal: AbortSignal) => Promise<unknown>
  >((method) =>
    Promise.resolve(method === 'node/git/status' ? status : { head: status.head, changed: false }),
  )
  const port = validatedNodePort({ request })
  const verify = vi.fn<NodePageAuthPort['verify']>((action, actionDigest) =>
    Promise.resolve({
      id: 'proof',
      sessionId: 'session',
      action,
      actionDigest,
      verifiedAt: 1,
      expiresAt: 2,
    }),
  )
  return { request, port, auth: { verify } }
}

describe('M110-U1 fresh Git verification', () => {
  it('H14 uses the exact same canonical digest as N and sends only the verified tuple', async () => {
    const { port, request, auth } = browser()
    const input = params('node/git/push')
    expect(await networkGitDigest('node/git/push', input)).toBe(input.actionDigest)
    await runNetworkGit(port, auth, 'node/git/push', 'repo', status, 'origin', signal())
    expect(auth.verify).toHaveBeenCalledWith(
      'git.network',
      input.actionDigest,
      expect.any(AbortSignal),
    )
    expect(request.mock.calls[1]?.[1]).toEqual({ ...input, stepUpId: 'proof' })
  })
  it('H14 refuses a head or destination changed while the person verifies', async () => {
    const { port, request, auth } = browser()
    request.mockResolvedValueOnce({ ...status, head: 'f'.repeat(40) })
    await expect(
      runNetworkGit(port, auth, 'node/git/push', 'repo', status, 'origin', signal()),
    ).rejects.toThrow()
    expect(request).toHaveBeenCalledOnce()
    request.mockResolvedValueOnce({
      ...status,
      remotes: [{ name: 'origin', destination: { ...destination, host: 'attacker.invalid' } }],
    })
    await expect(
      runNetworkGit(port, auth, 'node/git/push', 'repo', status, 'origin', signal()),
    ).rejects.toThrow()
    expect(request.mock.calls.every(([method]) => method === 'node/git/status')).toBe(true)
  })
  it('H08 refuses wrong-purpose/altered proof and cancelled verification without dispatch', async () => {
    const { port, request, auth } = browser()
    auth.verify.mockResolvedValueOnce({
      id: 'proof',
      sessionId: 'session',
      action: 'git.network',
      actionDigest: 'f'.repeat(64),
      verifiedAt: 1,
      expiresAt: 2,
    })
    await expect(
      runNetworkGit(port, auth, 'node/git/push', 'repo', status, 'origin', signal()),
    ).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
    auth.verify.mockResolvedValueOnce({
      id: 'proof',
      sessionId: 'session',
      action: 'terminal.open',
      actionDigest: params('node/git/push').actionDigest,
      verifiedAt: 1,
      expiresAt: 2,
    })
    await expect(
      runNetworkGit(port, auth, 'node/git/push', 'repo', status, 'origin', signal()),
    ).rejects.toThrow(UI_TEXT.nodeErrors.forbidden)
    expect(request).not.toHaveBeenCalled()
    auth.verify.mockRejectedValueOnce(new Error('cancelled'))
    await expect(
      runNetworkGit(port, auth, 'node/git/push', 'repo', status, 'origin', signal()),
    ).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
  it('refuses detached, unborn or unknown remote without asking for verification', async () => {
    const { port, auth } = browser()
    for (const snapshot of [
      { ...status, branch: null },
      { ...status, head: null },
    ])
      await expect(
        runNetworkGit(port, auth, 'node/git/push', 'repo', snapshot, 'origin', signal()),
      ).rejects.toThrow(UI_TEXT.nodeErrors.conflict)
    await expect(
      runNetworkGit(port, auth, 'node/git/push', 'repo', status, 'wrong', signal()),
    ).rejects.toThrow(UI_TEXT.nodeErrors.conflict)
    expect(auth.verify).not.toHaveBeenCalled()
  })
})
