import {
  nodeMethods,
  type NodeMethodParams,
  type NodeMethodPort,
  type NodeMethodResult,
} from '../../../shared/hostApi/nodeMethods'
import { nodeStepUpSchema, type NodeStepUp } from '../../../shared/nodeAuth'
import { UI_TEXT, NODE_ZERO_DIGEST, NODE_DIGEST_RADIX } from '../../../shared/constants'

export type NetworkGitMethod = 'node/git/fetch' | 'node/git/pull' | 'node/git/push'
export interface NodePageAuthPort {
  /** A1 presents fresh user verification bound to this exact action digest. */
  verify(action: 'git.network', actionDigest: string, signal: AbortSignal): Promise<NodeStepUp>
}

/** Same canonical key order as N's nodeActionDigest; Web Crypto keeps Node
 * imports out of the shared browser surface. Never hashes localized labels. */
export async function networkGitDigest(
  method: NetworkGitMethod,
  params: NodeMethodParams<NetworkGitMethod>,
): Promise<string> {
  const parsed = nodeMethods[method].params.parse(params)
  const payload = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key !== 'stepUpId' && key !== 'actionDigest'),
  )
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify({ method, payload })),
  )
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(NODE_DIGEST_RADIX).padStart(2, '0'))
    .join('')
}

export async function runNetworkGit(
  port: NodeMethodPort,
  auth: NodePageAuthPort,
  method: NetworkGitMethod,
  workspaceId: string,
  status: NodeMethodResult<'node/git/status'>,
  remoteName: string,
  signal: AbortSignal,
): Promise<NodeMethodResult<NetworkGitMethod>> {
  const snapshot = nodeMethods['node/git/status'].result.parse(status)
  const remote = snapshot.remotes.find((entry) => entry.name === remoteName)
  if (remote === undefined || snapshot.branch === null || snapshot.head === null)
    throw new Error(UI_TEXT.nodeErrors.conflict)
  const pending = nodeMethods[method].params.parse({
    workspaceId,
    remote: remote.name,
    destination: remote.destination,
    ref: snapshot.branch,
    expectedHead: snapshot.head,
    stepUpId: 'pending',
    actionDigest: NODE_ZERO_DIGEST,
  })
  const actionDigest = await networkGitDigest(method, pending)
  const proof = nodeStepUpSchema.parse(await auth.verify('git.network', actionDigest, signal))
  if (proof.action !== 'git.network' || proof.actionDigest !== actionDigest)
    throw new Error(UI_TEXT.nodeErrors.forbidden)
  const current = await port.request('node/git/status', { workspaceId, cursor: null }, signal)
  const resolved = current.remotes.find((entry) => entry.name === remote.name)
  if (
    resolved === undefined ||
    current.head !== snapshot.head ||
    current.branch !== snapshot.branch ||
    JSON.stringify(resolved.destination) !== JSON.stringify(remote.destination)
  )
    throw new Error(UI_TEXT.nodeErrors.conflict)
  signal.throwIfAborted()
  return await port.request(method, { ...pending, stepUpId: proof.id, actionDigest }, signal)
}
