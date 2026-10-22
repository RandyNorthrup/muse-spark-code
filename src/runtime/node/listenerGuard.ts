import type { IncomingMessage } from 'node:http'
import {
  NODE_LISTENER_MAX_REQUESTS,
  NODE_PROOF_MAX_ATTEMPTS,
  NODE_PROOF_WINDOW_MS,
  NODE_LISTENER_MAX_SOURCES,
  NODE_LISTENER_SOURCE_CONNECTIONS,
  NODE_SIGNIN_BACKOFF_MS,
  NODE_SIGNIN_BACKOFF_MAX_MS,
  NODE_SIGNIN_MAX_FAILURES,
  UI_TEXT,
} from '../../shared/constants'
import type { NodeConfig } from '../../shared/node'
import {
  nodeSessionSchema,
  nodeTokenSchema,
  type NodeSession,
  type NodeStepUp,
} from '../../shared/nodeAuth'

/** A1 binding: real memory-session lookup and atomic UV-proof consumption. */
export interface NodeListenerVerifier {
  verifyBearer(bearer: string, signal: AbortSignal): Promise<NodeSession>
  /** Aborts on lock, sign-out, idle/absolute expiry and revocation. */
  sessionSignal(sessionId: string): AbortSignal
  /** Check monotonic freshness, UV and exact binding; consume once before returning. */
  consumeStepUp(
    binding: {
      sessionId: string
      id: string
      action: NodeStepUp['action']
      actionDigest: string
    },
    signal: AbortSignal,
  ): Promise<NodeStepUp>
}

export type NodeListenerErrorCode =
  | 'invalidRequest'
  | 'unauthenticated'
  | 'forbidden'
  | 'notFound'
  | 'tooLarge'
  | 'rateLimited'
  | 'unavailable'
export class NodeListenerError extends Error {
  constructor(readonly code: NodeListenerErrorCode) {
    super(UI_TEXT.nodeErrors[code])
  }
}

/** Raw counts catch duplicated headers even when Node merges their values. */
export function nodeHeader(request: IncomingMessage, name: string): string | undefined {
  let value: string | undefined
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() !== name) continue
    if (value !== undefined) throw new NodeListenerError('forbidden')
    value = request.rawHeaders[index + 1]
  }
  return value
}

export function guardNodeRequest(
  request: IncomingMessage,
  config: NodeConfig,
  isWebsocket: boolean,
): void {
  const host = nodeHeader(request, 'host')
  const port = config.listener?.port
  const allowed = config.browserNames.map((name) => new URL(`https://${name}:${String(port)}`).host)
  if (
    host === undefined ||
    !allowed.includes(host) ||
    nodeHeader(request, 'origin') !== `https://${host}` ||
    nodeHeader(request, 'sec-fetch-site') !== 'same-origin' ||
    !(isWebsocket ? ['websocket'] : ['cors', 'same-origin']).includes(
      nodeHeader(request, 'sec-fetch-mode') ?? '',
    ) ||
    nodeHeader(request, 'sec-fetch-dest') !== (isWebsocket ? 'websocket' : 'empty') ||
    nodeHeader(request, 'cookie') !== undefined
  ) {
    throw new NodeListenerError('forbidden')
  }
}

export async function nodeAuthenticate(
  verifier: NodeListenerVerifier | undefined,
  bearer: string | undefined,
  ownerId: string,
  signal: AbortSignal,
): Promise<NodeSession> {
  if (verifier === undefined) throw new NodeListenerError('unavailable')
  if (bearer === undefined || !nodeTokenSchema.safeParse(bearer).success)
    throw new NodeListenerError('unauthenticated')
  try {
    const session = nodeSessionSchema.parse(await verifier.verifyBearer(bearer, signal))
    signal.throwIfAborted()
    if (session.ownerId !== ownerId) throw new NodeListenerError('unauthenticated')
    return session
  } catch {
    // No verifier/account text or bearer leaves this boundary.
    throw new NodeListenerError('unauthenticated')
  }
}

interface AdmissionState {
  failures: number
  retryAt: number
  lastAt: number
  busy: number
  attempts: number
  windowAt: number
}
function initialAdmission(): AdmissionState {
  return { failures: 0, retryAt: 0, lastAt: 0, busy: 0, attempts: 0, windowAt: 0 }
}

/** Transport bounds precede parsing/verifier work. A1 owns durable H09/H20 lockout. */
export class NodeListenerAdmission {
  private readonly sources = new Map<string, AdmissionState>()
  private active = 0
  constructor(private readonly monotonicMs: () => number) {}

  enter(
    source: string,
    isSignin: boolean,
  ): (hasFailed: boolean, hasAuthenticated?: boolean) => void {
    const now = this.monotonicMs()
    for (const [key, state] of this.sources) {
      if (state.busy === 0 && now - state.lastAt > NODE_SIGNIN_BACKOFF_MAX_MS)
        this.sources.delete(key)
    }
    let state = this.sources.get(source)
    if (state === undefined) {
      if (this.sources.size >= NODE_LISTENER_MAX_SOURCES) throw new NodeListenerError('rateLimited')
      state = initialAdmission()
      this.sources.set(source, state)
    }
    if (now - state.windowAt >= NODE_PROOF_WINDOW_MS) {
      state.attempts = 0
      state.windowAt = now
    }
    if (
      this.active >= NODE_LISTENER_MAX_REQUESTS ||
      state.busy >= NODE_LISTENER_SOURCE_CONNECTIONS ||
      (isSignin && (state.retryAt > now || state.attempts >= NODE_PROOF_MAX_ATTEMPTS))
    ) {
      throw new NodeListenerError('rateLimited')
    }
    state.busy += 1
    state.lastAt = now
    if (isSignin) state.attempts += 1
    this.active += 1
    return (hasFailed, hasAuthenticated = true) => {
      this.active -= 1
      state.busy -= 1
      state.lastAt = this.monotonicMs()
      if (!isSignin) return
      // Issuing a challenge does not clear failed-proof backoff.
      if (!hasFailed && !hasAuthenticated) return
      state.failures = hasFailed ? Math.min(state.failures + 1, NODE_SIGNIN_MAX_FAILURES) : 0
      state.retryAt = hasFailed
        ? state.lastAt +
          Math.min(NODE_SIGNIN_BACKOFF_MS * 2 ** (state.failures - 1), NODE_SIGNIN_BACKOFF_MAX_MS)
        : 0
    }
  }
}
