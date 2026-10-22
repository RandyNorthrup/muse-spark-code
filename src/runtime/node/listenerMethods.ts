import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import {
  nodeMethods,
  type NodeMethodName,
  type NodeMethodPort,
} from '../../shared/hostApi/nodeMethods'
import { nodeStepUpSchema, type NodeSession, type NodeStepUp } from '../../shared/nodeAuth'
import { NODE_STEP_UP_TTL_MS } from '../../shared/constants'
import { NodeListenerError, type NodeListenerVerifier } from './listenerGuard'

/** Construct a shared port scoped to the verified session, never to an editor. */
export type NodeListenerMethodFactory = (
  session: NodeSession | null,
  source: string,
) => NodeMethodPort

const proofFields = z.strictObject({ stepUpId: z.string(), actionDigest: z.string() })
const actions: Partial<Record<NodeMethodName, NodeStepUp['action']>> = {
  'node/terminal/open': 'terminal.open',
  'node/git/fetch': 'git.network',
  'node/git/pull': 'git.network',
  'node/git/push': 'git.network',
  'node/wipe': 'node.wipe',
  'node/maker/action': 'maker.action',
}

/** Catalog parsing fixes key order; exclude only proof metadata from the exact payload. */
export function nodeActionDigest(method: NodeMethodName, params: unknown): string {
  const parsed = nodeMethods[method].params.parse(params)
  const payload = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key !== 'stepUpId' && key !== 'actionDigest'),
  )
  return createHash('sha256').update(JSON.stringify({ method, payload })).digest('hex')
}

export async function dispatchNodeMethod(
  method: NodeMethodName,
  raw: unknown,
  session: NodeSession | null,
  ports: {
    methods: NodeListenerMethodFactory
    verifier: NodeListenerVerifier | undefined
    now: () => number
    source: string
  },
  signal: AbortSignal,
): Promise<unknown> {
  if (ports.verifier === undefined) throw new NodeListenerError('unavailable')
  const entry = nodeMethods[method]
  if (session === null && entry.access !== 'public') throw new NodeListenerError('unauthenticated')
  const parsed = entry.params.safeParse(raw)
  if (!parsed.success) throw new NodeListenerError('invalidRequest')
  if (entry.access === 'stepUp') {
    const action = actions[method]
    if (session === null || action === undefined) throw new NodeListenerError('forbidden')
    const fields = proofFields.parse(
      Object.fromEntries(
        Object.entries(parsed.data).filter(([key]) => key === 'stepUpId' || key === 'actionDigest'),
      ),
    )
    const actionDigest = nodeActionDigest(method, parsed.data)
    if (fields.actionDigest !== actionDigest) throw new NodeListenerError('forbidden')
    const proof = nodeStepUpSchema.parse(
      await ports.verifier.consumeStepUp(
        { sessionId: session.id, id: fields.stepUpId, action, actionDigest },
        signal,
      ),
    )
    const now = ports.now()
    if (
      proof.id !== fields.stepUpId ||
      proof.sessionId !== session.id ||
      proof.action !== action ||
      proof.actionDigest !== actionDigest ||
      proof.verifiedAt > now ||
      proof.expiresAt <= now ||
      now - proof.verifiedAt >= NODE_STEP_UP_TTL_MS
    )
      throw new NodeListenerError('forbidden')
  }
  signal.throwIfAborted()
  return entry.result.parse(
    await ports.methods(session, ports.source).request(method, parsed.data, signal),
  )
}

export function nodeRoute(url: string | undefined): NodeMethodName {
  const method = url?.slice(1)
  if (url?.startsWith('/') !== true) throw new NodeListenerError('notFound')
  if (method !== undefined && isNodeMethod(method)) return method
  throw new NodeListenerError('notFound')
}

function isNodeMethod(value: string): value is NodeMethodName {
  return Object.hasOwn(nodeMethods, value)
}
