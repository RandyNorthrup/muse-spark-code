import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import {
  NODE_AUTH_ALGORITHMS,
  NODE_AUTH_USER_HANDLE,
  NODE_CHALLENGE_TTL_MS,
  NODE_AUTH_TERMINAL_STREAM,
  UI_TEXT,
} from '../../../shared/constants'
import {
  nodeMethods,
  nodeMethodErrorSchema,
  type NodeMethodName,
  type NodeMethodParams,
  type NodeMethodResult,
} from '../../../shared/hostApi/nodeMethods'
import {
  nodeAssertionSchema,
  nodeAuthChallengeSchema,
  nodeAuthenticationSchema,
  nodeRegistrationSchema,
  nodeDomainSchema,
  type NodeStepUp,
} from '../../../shared/nodeAuth'
import { nodeTerminalClientFrameSchema } from '../../../shared/node'

export class NodeBrowserAuthError extends Error {
  constructor(readonly code: keyof typeof UI_TEXT.nodeErrors) {
    super(UI_TEXT.nodeErrors[code])
  }
}

/** Page memory only; a new instance/reload starts signed out. */
export class NodeBrowserAuth {
  #bearer: string | undefined
  private readonly sockets = new WeakSet<object>()
  constructor(
    private readonly origin: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    nodeDomainSchema.parse(new URL(origin).hostname)
    if (new URL(origin).origin !== origin || !origin.startsWith('https://'))
      throw new Error(UI_TEXT.nodeErrors.forbidden)
  }

  private check(challenge: unknown) {
    const parsed = nodeAuthChallengeSchema.parse(challenge)
    if (
      parsed.origin !== this.origin ||
      parsed.rpId !== new URL(this.origin).hostname ||
      !window.isSecureContext
    )
      throw new Error(UI_TEXT.nodeAuth.trustRequired)
    return parsed
  }

  async request<M extends NodeMethodName>(
    method: M,
    params: NodeMethodParams<M>,
    signal?: AbortSignal,
  ): Promise<NodeMethodResult<M>> {
    const entry = nodeMethods[method]
    if (entry.access !== 'public' && this.#bearer === undefined)
      throw new Error(UI_TEXT.nodeErrors.unauthenticated)
    const response = await this.fetcher(`${this.origin}/${method}`, {
      method: 'POST',
      mode: 'same-origin',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...(this.#bearer !== undefined && { Authorization: `Bearer ${this.#bearer}` }),
      },
      body: JSON.stringify(entry.params.parse(params)),
      ...(signal !== undefined && { signal }),
    })
    const raw: unknown = await response.json()
    if (!response.ok) {
      const { code } = nodeMethodErrorSchema.parse(raw)
      if (['unauthenticated', 'expired', 'locked'].includes(code)) this.clear()
      throw new NodeBrowserAuthError(code)
    }
    // zod validates the selected catalog member; TS loses the generic correlation.
    return entry.result.parse(raw) as NodeMethodResult<M>
  }

  async enroll(setupCode: string): Promise<void> {
    const challenge = this.check(
      await this.request('node/auth/begin', { purpose: 'enroll', setupCode }),
    )
    if (challenge.purpose !== 'enroll') throw new Error(UI_TEXT.nodeErrors.invalidRequest)
    const credential = await startRegistration({
      optionsJSON: {
        challenge: challenge.challenge,
        rp: { id: challenge.rpId, name: UI_TEXT.nodeLabels.title },
        user: {
          id: NODE_AUTH_USER_HANDLE,
          name: UI_TEXT.nodeLabels.enroll,
          displayName: UI_TEXT.nodeLabels.enroll,
        },
        pubKeyCredParams: NODE_AUTH_ALGORITHMS.map((alg) => ({ type: 'public-key', alg })),
        timeout: NODE_CHALLENGE_TTL_MS,
        attestation: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      },
    })
    // L0's authored wire deliberately carries only fields consumed by the verifier.
    const proof = nodeRegistrationSchema.parse({
      ...credential,
      response: {
        clientDataJSON: credential.response.clientDataJSON,
        attestationObject: credential.response.attestationObject,
        ...(credential.response.transports !== undefined && {
          transports: credential.response.transports,
        }),
      },
    })
    const result = nodeAuthenticationSchema.parse(
      await this.request('node/auth/enroll', { challengeId: challenge.id, credential: proof }),
    )
    this.#bearer = result.bearer
  }

  async signIn(): Promise<void> {
    const challenge = this.check(await this.request('node/auth/begin', { purpose: 'signin' }))
    if (challenge.purpose !== 'signin') throw new Error(UI_TEXT.nodeErrors.invalidRequest)
    const credential = nodeAssertionSchema.parse(
      await startAuthentication({
        optionsJSON: {
          challenge: challenge.challenge,
          rpId: challenge.rpId,
          timeout: NODE_CHALLENGE_TTL_MS,
          userVerification: 'required',
        },
      }),
    )
    this.#bearer = nodeAuthenticationSchema.parse(
      await this.request('node/auth/signin', { challengeId: challenge.id, credential }),
    ).bearer
  }

  async stepUp(action: NodeStepUp['action'], actionDigest: string): Promise<NodeStepUp> {
    const challenge = this.check(
      await this.request('node/auth/stepUp/begin', { action, actionDigest }),
    )
    if (
      challenge.purpose !== 'stepUp' ||
      challenge.action !== action ||
      challenge.actionDigest !== actionDigest
    )
      throw new Error(UI_TEXT.nodeErrors.forbidden)
    const credential = nodeAssertionSchema.parse(
      await startAuthentication({
        optionsJSON: {
          challenge: challenge.challenge,
          rpId: challenge.rpId,
          timeout: NODE_CHALLENGE_TTL_MS,
          userVerification: 'required',
        },
      }),
    )
    return await this.request('node/auth/stepUp/complete', {
      challengeId: challenge.id,
      credential,
    })
  }

  async signOut(): Promise<void> {
    try {
      await this.request('node/auth/end', {})
    } finally {
      this.clear()
    }
  }
  authenticateSocket(
    socket: Pick<WebSocket, 'url' | 'readyState' | 'send'>,
    terminalId: string,
  ): void {
    if (this.#bearer === undefined) throw new Error(UI_TEXT.nodeErrors.unauthenticated)
    const target = new URL(socket.url)
    if (
      target.origin !== this.origin.replace('https:', 'wss:') ||
      target.pathname !== NODE_AUTH_TERMINAL_STREAM ||
      target.search !== '' ||
      target.hash !== '' ||
      socket.readyState !== WebSocket.OPEN ||
      this.sockets.has(socket)
    )
      throw new Error(UI_TEXT.nodeErrors.forbidden)
    socket.send(
      JSON.stringify(
        nodeTerminalClientFrameSchema.parse({ type: 'auth', bearer: this.#bearer, terminalId }),
      ),
    )
    this.sockets.add(socket)
  }
  clear(): void {
    this.#bearer = undefined
  }
}
