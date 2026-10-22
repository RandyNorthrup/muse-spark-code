import {
  nodeMethods,
  type NodeMethodName,
  type NodeMethodParams,
  type NodeMethodResult,
} from '../../../shared/hostApi/nodeMethods'
import { nodeActionDigest } from '../listenerMethods'
import { guardNodeMethod, NodeListenerError } from '../listenerGuard'
import { nodeNetworkBranchRef } from '../../../shared/node'

type GitMethod = Extract<NodeMethodName, `node/git/${string}`>
type NetworkMethod = 'node/git/fetch' | 'node/git/pull' | 'node/git/push'

/** N's closed runner supplies structured inspection and publication, always
using its immutable service-owned gitdir. No shell, raw argv or key crosses
this seam. Credential dispatch still rechecks the tuple atomically through
NodeGitNetworkPort.use; this page-level check is additional admission only.
Binding: M110-U1-N-GIT-RESULTS. */
export interface NodeGitPagePort {
  inspect(workspaceId: string, signal: AbortSignal): Promise<unknown>
  run(method: GitMethod, params: unknown, signal: AbortSignal): Promise<unknown>
  /** Files an unexpected method failure with the serve log. The report
  carries the raw error for the record; implementations print a fixed
  sentence, never its text (paths and prompts stay out of the log). */
  report(error: unknown): void
}

export function createNodeGitMethods(port: NodeGitPagePort) {
  const run = async (method: GitMethod, params: unknown, signal: AbortSignal) => {
    signal.throwIfAborted()
    const result = await port.run(method, params, signal)
    signal.throwIfAborted()
    return result
  }
  const status = async (input: NodeMethodParams<'node/git/status'>, signal: AbortSignal) => {
    const params = nodeMethods['node/git/status'].params.parse(input)
    signal.throwIfAborted()
    // N performs pagination in its structured inspection adapter.
    return nodeMethods['node/git/status'].result.parse(await run('node/git/status', params, signal))
  }
  const network = async (
    method: NetworkMethod,
    input: NodeMethodParams<NetworkMethod>,
    signal: AbortSignal,
  ) => {
    const params = nodeMethods[method].params.parse(input)
    signal.throwIfAborted()
    if (nodeActionDigest(method, params) !== params.actionDigest)
      throw new NodeListenerError('forbidden')
    const current = nodeMethods['node/git/status'].result.parse(
      await port.inspect(params.workspaceId, signal),
    )
    const remote = current.remotes.find((entry) => entry.name === params.remote)
    if (
      remote === undefined ||
      current.head !== params.expectedHead ||
      current.branch === null ||
      nodeNetworkBranchRef(current.branch) !== params.ref ||
      JSON.stringify(remote.destination) !== JSON.stringify(params.destination)
    )
      throw new NodeListenerError('conflict')
    signal.throwIfAborted()
    return nodeMethods[method].result.parse(await run(method, params, signal))
  }
  const local = async (
    method: 'node/git/commit' | 'node/git/branch',
    input: NodeMethodParams<'node/git/commit'> | NodeMethodParams<'node/git/branch'>,
    signal: AbortSignal,
  ) => {
    const params = nodeMethods[method].params.parse(input)
    signal.throwIfAborted()
    const current = nodeMethods['node/git/status'].result.parse(
      await port.inspect(params.workspaceId, signal),
    )
    if (current.head !== params.expectedHead) throw new NodeListenerError('conflict')
    signal.throwIfAborted()
    return nodeMethods[method].result.parse(await run(method, params, signal))
  }
  // Every handler crosses the typed boundary: no raw TypeError or Error
  // from the port or a result parse escapes (RVM110U2 P2 #2).
  // Unexpected failures are reported to the serve log before the typed
  // `unavailable` refusal reaches the person.
  const guard = <I, O>(work: (input: I, signal: AbortSignal) => Promise<O>) =>
    guardNodeMethod(work, (error) => {
      port.report(error)
    })
  return {
    status: guard(status),
    diff: guard(async (input: NodeMethodParams<'node/git/diff'>, signal: AbortSignal) => {
      const params = nodeMethods['node/git/diff'].params.parse(input)
      return nodeMethods['node/git/diff'].result.parse(await run('node/git/diff', params, signal))
    }),
    branches: guard(async (input: NodeMethodParams<'node/git/branches'>, signal: AbortSignal) => {
      const params = nodeMethods['node/git/branches'].params.parse(input)
      return nodeMethods['node/git/branches'].result.parse(
        await run('node/git/branches', params, signal),
      )
    }),
    stage: guard(async (input: NodeMethodParams<'node/git/stage'>, signal: AbortSignal) => {
      const params = nodeMethods['node/git/stage'].params.parse(input)
      return nodeMethods['node/git/stage'].result.parse(await run('node/git/stage', params, signal))
    }),
    commit: guard(
      async (input: NodeMethodParams<'node/git/commit'>, signal: AbortSignal) =>
        await local('node/git/commit', input, signal),
    ),
    branch: guard(
      async (input: NodeMethodParams<'node/git/branch'>, signal: AbortSignal) =>
        await local('node/git/branch', input, signal),
    ),
    fetch: guard(
      async (input: NodeMethodParams<'node/git/fetch'>, signal: AbortSignal) =>
        await network('node/git/fetch', input, signal),
    ),
    pull: guard(
      async (input: NodeMethodParams<'node/git/pull'>, signal: AbortSignal) =>
        await network('node/git/pull', input, signal),
    ),
    push: guard(
      async (input: NodeMethodParams<'node/git/push'>, signal: AbortSignal) =>
        await network('node/git/push', input, signal),
    ),
  } satisfies Record<
    string,
    (input: never, signal: AbortSignal) => Promise<NodeMethodResult<GitMethod>>
  >
}
