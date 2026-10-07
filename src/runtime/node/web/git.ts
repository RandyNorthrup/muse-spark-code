import {
  nodeMethods,
  type NodeMethodName,
  type NodeMethodParams,
  type NodeMethodResult,
} from '../../../shared/hostApi/nodeMethods'
import { nodeActionDigest } from '../listenerMethods'
import { UI_TEXT } from '../../../shared/constants'

type GitMethod = Extract<NodeMethodName, `node/git/${string}`>
type NetworkMethod = 'node/git/fetch' | 'node/git/pull' | 'node/git/push'

/** N's closed runner supplies structured inspection and publication, always
 * using its immutable service-owned gitdir. No shell, raw argv or key crosses
 * this seam. Credential dispatch still rechecks the tuple atomically through
 * NodeGitNetworkPort.use; this page-level check is additional admission only.
 * Binding: M110-U1-N-GIT-RESULTS. */
export interface NodeGitPagePort {
  inspect(workspaceId: string, signal: AbortSignal): Promise<unknown>
  run(method: GitMethod, params: unknown, signal: AbortSignal): Promise<unknown>
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
      throw new Error(UI_TEXT.nodeErrors.forbidden)
    const current = nodeMethods['node/git/status'].result.parse(
      await port.inspect(params.workspaceId, signal),
    )
    const remote = current.remotes.find((entry) => entry.name === params.remote)
    if (
      remote === undefined ||
      current.head !== params.expectedHead ||
      current.branch !== params.ref ||
      JSON.stringify(remote.destination) !== JSON.stringify(params.destination)
    )
      throw new Error(UI_TEXT.nodeErrors.conflict)
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
    if (current.head !== params.expectedHead) throw new Error(UI_TEXT.nodeErrors.conflict)
    signal.throwIfAborted()
    return nodeMethods[method].result.parse(await run(method, params, signal))
  }
  return {
    status,
    diff: async (input: NodeMethodParams<'node/git/diff'>, signal: AbortSignal) => {
      const params = nodeMethods['node/git/diff'].params.parse(input)
      return nodeMethods['node/git/diff'].result.parse(await run('node/git/diff', params, signal))
    },
    branches: async (input: NodeMethodParams<'node/git/branches'>, signal: AbortSignal) => {
      const params = nodeMethods['node/git/branches'].params.parse(input)
      return nodeMethods['node/git/branches'].result.parse(
        await run('node/git/branches', params, signal),
      )
    },
    stage: async (input: NodeMethodParams<'node/git/stage'>, signal: AbortSignal) => {
      const params = nodeMethods['node/git/stage'].params.parse(input)
      return nodeMethods['node/git/stage'].result.parse(await run('node/git/stage', params, signal))
    },
    commit: async (input: NodeMethodParams<'node/git/commit'>, signal: AbortSignal) =>
      await local('node/git/commit', input, signal),
    branch: async (input: NodeMethodParams<'node/git/branch'>, signal: AbortSignal) =>
      await local('node/git/branch', input, signal),
    fetch: async (input: NodeMethodParams<'node/git/fetch'>, signal: AbortSignal) =>
      await network('node/git/fetch', input, signal),
    pull: async (input: NodeMethodParams<'node/git/pull'>, signal: AbortSignal) =>
      await network('node/git/pull', input, signal),
    push: async (input: NodeMethodParams<'node/git/push'>, signal: AbortSignal) =>
      await network('node/git/push', input, signal),
  } satisfies Record<
    string,
    (input: never, signal: AbortSignal) => Promise<NodeMethodResult<GitMethod>>
  >
}
