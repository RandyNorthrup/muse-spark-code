import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  NODE_AUTH_RANDOM_BYTES,
  NODE_SETUP_TTL_MS,
  NODE_SIGNIN_MAX_FAILURES,
  UI_TEXT,
} from '../../../shared/constants'
import type { NodeClock } from '../../../shared/node'
import {
  nodeAssertionSchema,
  nodeDomainSchema,
  nodeTokenSchema,
  type NodeAuthPort,
  type NodeAuthChallenge,
  type NodeStepUp,
} from '../../../shared/nodeAuth'
import { fill, formatDateTime } from '../../../shared/l10n/text'
import { NodeListenerAdmission, NodeListenerError } from '../listenerGuard'
import type { NodeStateStore } from '../state'
import { NodeTransactions } from '../transactions'
import { NodeChallenges } from './challenges'
import { SimpleNodePasskeys, type NodePasskeyVerifier } from './passkeys'
import { NodeMemorySessions, type NodeSessionLifecycle } from './sessions'

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
export interface NodeAuthOptions {
  state: Pick<NodeStateStore, 'read' | 'update' | 'append'>
  clock: NodeClock
  /** Derived from the committed protected TLS key; never supplied by a client. */
  challengeKey: Uint8Array
  rpId: string
  origin: string
  lifecycle: NodeSessionLifecycle
  /** Console/TUI only. This channel deliberately prints setup codes, never audit/log. */
  console: (line: string) => void
  verifier?: NodePasskeyVerifier
}

/** One owner; every durable enrollment/counter/failure change is serialized. */
export class NodePasskeyAuth {
  private readonly challenges: NodeChallenges
  private readonly transactions = new NodeTransactions()
  private readonly admission: NodeListenerAdmission
  private readonly verifier: NodePasskeyVerifier
  private setupDeadline = 0
  private epoch = 0
  readonly sessions: NodeMemorySessions

  constructor(private readonly options: NodeAuthOptions) {
    const rpId = nodeDomainSchema.parse(options.rpId)
    const origin = new URL(options.origin)
    if (
      origin.protocol !== 'https:' ||
      origin.origin !== options.origin ||
      origin.hostname !== rpId ||
      !options.state.read().config.browserNames.includes(rpId)
    )
      throw new Error(UI_TEXT.nodeErrors.forbidden)
    this.challenges = new NodeChallenges(options.clock, rpId, options.origin, options.challengeKey)
    this.sessions = new NodeMemorySessions(
      options.clock,
      options.state.read().ownerId,
      options.lifecycle,
    )
    this.admission = new NodeListenerAdmission(() => options.clock.monotonicMs())
    this.verifier = options.verifier ?? new SimpleNodePasskeys()
    const setup = options.state.read().setup
    if (setup !== null && options.clock.now() >= setup.issuedAt)
      this.setupDeadline =
        options.clock.monotonicMs() +
        Math.max(0, Math.min(NODE_SETUP_TTL_MS, setup.expiresAt - options.clock.now()))
    this.showLockout()
  }

  private showLockout(): void {
    if (this.options.state.read().passkeys.some((key) => key.disabled))
      this.options.console(UI_TEXT.nodeAuth.lockout)
  }

  private checkEpoch(epoch: number): void {
    if (epoch !== this.epoch) throw new Error(UI_TEXT.nodeErrors.cancelled)
  }

  private async assert(
    challengeId: string,
    raw: unknown,
    purpose: 'signin' | 'stepUp',
    sessionId?: string,
  ) {
    const pending = this.challenges.verify(challengeId, purpose)
    const credential = nodeAssertionSchema.parse(raw)
    const state = this.options.state.read()
    const key = state.passkeys.find((entry) => entry.id === credential.id && !entry.disabled)
    if (key === undefined) throw new Error(UI_TEXT.nodeErrors.unauthenticated)
    if (pending.challenge.purpose === 'stepUp') {
      if (pending.challenge.sessionId !== sessionId) throw new Error(UI_TEXT.nodeErrors.forbidden)
      this.sessions.sessionSignal(pending.challenge.sessionId).throwIfAborted()
    }
    const epoch = this.epoch
    const counter = await this.verifier.assert(pending.challenge, credential, key)
    this.checkEpoch(epoch)
    if (pending.deadline <= this.options.clock.monotonicMs())
      throw new Error(UI_TEXT.nodeErrors.expired)
    if (pending.challenge.purpose === 'stepUp')
      this.sessions.sessionSignal(pending.challenge.sessionId).throwIfAborted()
    this.challenges.consume(pending)
    const verifiedTime = {
      time: this.options.clock.now(),
      monotonicMs: this.options.clock.monotonicMs(),
    }
    const current = this.options.state.read()
    await this.options.state.update(current.generation, (value) => ({
      ...value,
      passkeys: value.passkeys.map((entry) => ({
        ...entry,
        failures: 0,
        counter: entry.id === key.id ? counter : entry.counter,
      })),
    }))
    return { challenge: pending.challenge, verifiedTime, deadline: pending.deadline }
  }

  private attempt<T>(
    source: string,
    isProof: boolean,
    credentialId: string,
    work: () => Promise<T>,
    action: 'signin' | 'enroll' = 'signin',
  ): Promise<T> {
    // Stateless issuance has no verifier work and reserves no auth admission row.
    const release = isProof ? this.admission.enter(source, true) : undefined
    return this.transactions.enqueue(async () => {
      let isFailed = true
      try {
        const result = await work()
        isFailed = false
        return result
      } catch (error: unknown) {
        if (error instanceof NodeListenerError && error.code === 'rateLimited') {
          // Admission refusal is not a bad proof and must not disable the owner.
          isFailed = false
          throw error
        }
        const state = this.options.state.read()
        if (isProof && state.passkeys.some((key) => !key.disabled)) {
          await this.options.state.update(state.generation, (value) => ({
            ...value,
            passkeys: value.passkeys.map((key) => {
              const failures = Math.min(NODE_SIGNIN_MAX_FAILURES, key.failures + 1)
              return {
                ...key,
                failures,
                disabled: key.disabled || failures >= NODE_SIGNIN_MAX_FAILURES,
              }
            }),
          }))
          const isLocked = this.options.state.read().passkeys.every((key) => key.disabled)
          if (isLocked) {
            this.endAll()
            this.showLockout()
            await this.audit('lockout', credentialId, 'denied')
          }
        }
        await this.audit(action, credentialId, 'denied')
        throw new NodeListenerError('unauthenticated')
      } finally {
        release?.(isFailed, isProof)
      }
    })
  }

  private async audit(
    action: 'signin' | 'enroll' | 'signout' | 'lockout',
    credentialId: string,
    outcome: 'allowed' | 'denied' | 'verified',
    sessionId: string | null = null,
  ): Promise<void> {
    await this.options.state.append({
      kind: 'signin',
      action,
      credentialIdHash: digest(credentialId),
      sessionId,
      time: this.options.clock.now(),
      outcome,
    })
  }

  private async authenticate(action: 'signin' | 'enroll', credentialId: string) {
    const result = this.sessions.create()
    try {
      // "Allowed" records issued access. The earlier "verified" write is the
      // persistence barrier; freshness is checked after it and before issuance.
      await this.audit(action, credentialId, 'allowed', result.session.id)
      return result
    } catch (error: unknown) {
      this.sessions.end(result.session.id)
      throw error
    }
  }

  private async auditStepUp(
    challenge: Extract<NodeAuthChallenge, { purpose: 'stepUp' }>,
    outcome: 'verified' | 'allowed' | 'denied',
  ): Promise<void> {
    await this.options.state.append({
      kind: 'stepUp',
      actionDigest: challenge.actionDigest,
      sessionId: challenge.sessionId,
      time: this.options.clock.now(),
      outcome,
    })
  }

  /** Bind to the transport's actual remote address, never a client-supplied source field. */
  forSource(source: string, sessionId?: string): NodeAuthPort {
    return {
      begin: async (purpose, setupCode) =>
        await this.attempt(
          source,
          false,
          '',
          () => {
            const state = this.options.state.read()
            if (purpose === 'enroll') {
              const codeHash = digest(nodeTokenSchema.parse(setupCode))
              if (
                state.setup === null ||
                state.passkeys.length > 0 ||
                this.setupDeadline <= this.options.clock.monotonicMs() ||
                !timingSafeEqual(
                  Buffer.from(codeHash, 'hex'),
                  Buffer.from(state.setup.codeHash, 'hex'),
                )
              )
                throw new Error(UI_TEXT.nodeErrors.unauthenticated)
              return Promise.resolve(this.challenges.issue('enroll', codeHash))
            }
            if (state.passkeys.every((key) => key.disabled))
              throw new Error(UI_TEXT.nodeErrors.locked)
            return Promise.resolve(this.challenges.issue('signin'))
          },
          purpose,
        ),
      beginStepUp: (requestedSession, action, actionDigest) => {
        if (requestedSession !== sessionId) throw new Error(UI_TEXT.nodeErrors.forbidden)
        this.sessions.sessionSignal(requestedSession).throwIfAborted()
        return Promise.resolve(this.challenges.stepUp(requestedSession, action, actionDigest))
      },
      enroll: async (challengeId, credential) =>
        await this.attempt(
          source,
          true,
          credential.id,
          async () => {
            const epoch = this.epoch
            const pending = this.challenges.verify(challengeId, 'enroll')
            const state = this.options.state.read()
            if (
              state.setup === null ||
              state.passkeys.length > 0 ||
              state.setup.codeHash !== pending.setupHash ||
              this.setupDeadline <= this.options.clock.monotonicMs()
            )
              throw new Error(UI_TEXT.nodeErrors.expired)
            const key = await this.verifier.enroll(pending.challenge, credential, state.ownerId)
            this.checkEpoch(epoch)
            if (
              pending.deadline <= this.options.clock.monotonicMs() ||
              this.setupDeadline <= this.options.clock.monotonicMs()
            )
              throw new Error(UI_TEXT.nodeErrors.expired)
            this.challenges.consume(pending)
            const current = this.options.state.read()
            await this.options.state.update(current.generation, (value) => ({
              ...value,
              setup: null,
              passkeys: [key],
            }))
            this.setupDeadline = 0
            await this.audit('enroll', credential.id, 'verified')
            if (pending.deadline <= this.options.clock.monotonicMs())
              throw new Error(UI_TEXT.nodeErrors.expired)
            this.checkEpoch(epoch)
            return await this.authenticate('enroll', credential.id)
          },
          'enroll',
        ),
      signIn: async (challengeId, credential) =>
        await this.attempt(source, true, credential.id, async () => {
          const epoch = this.epoch
          const verified = await this.assert(challengeId, credential, 'signin')
          await this.audit('signin', credential.id, 'verified')
          if (verified.deadline <= this.options.clock.monotonicMs())
            throw new Error(UI_TEXT.nodeErrors.expired)
          this.checkEpoch(epoch)
          return await this.authenticate('signin', credential.id)
        }),
      stepUp: async (challengeId, credential) =>
        await this.attempt(source, true, credential.id, async () => {
          const epoch = this.epoch
          const { challenge, verifiedTime } = await this.assert(
            challengeId,
            credential,
            'stepUp',
            sessionId,
          )
          if (challenge.purpose !== 'stepUp') throw new Error(UI_TEXT.nodeErrors.forbidden)
          this.checkEpoch(epoch)
          this.sessions.sessionSignal(challenge.sessionId).throwIfAborted()
          let proof: NodeStepUp | undefined
          try {
            await this.auditStepUp(challenge, 'verified')
            this.checkEpoch(epoch)
            proof = this.sessions.issueProof(
              challenge.sessionId,
              challenge.action,
              challenge.actionDigest,
              verifiedTime,
            )
            await this.auditStepUp(challenge, 'allowed')
            return proof
          } catch (error: unknown) {
            if (proof !== undefined) {
              // Consume burns even an expired proof; preserve the audit error.
              try {
                await this.sessions.consumeStepUp(proof, new AbortController().signal)
              } catch {
                /* Expired or revoked access has already failed closed. */
              }
            }
            await this.auditStepUp(challenge, 'denied')
            throw error
          }
        }),
      end: async (requestedSession) => {
        if (requestedSession !== sessionId) throw new Error(UI_TEXT.nodeErrors.forbidden)
        this.sessions.end(requestedSession)
        await this.audit('signout', '', 'allowed', requestedSession)
      },
    }
  }

  /** Local owner console control only; intentionally absent from the network method catalog. */
  consoleSetup(): Promise<void> {
    return this.transactions.enqueue(async () => {
      const state = this.options.state.read()
      if (state.passkeys.some((key) => !key.disabled)) throw new Error(UI_TEXT.nodeErrors.forbidden)
      this.endAll()
      const code = randomBytes(NODE_AUTH_RANDOM_BYTES).toString('base64url')
      const now = this.options.clock.now()
      const deadline = this.options.clock.monotonicMs() + NODE_SETUP_TTL_MS
      await this.options.state.update(state.generation, (value) => ({
        ...value,
        passkeys: [],
        setup: { codeHash: digest(code), issuedAt: now, expiresAt: now + NODE_SETUP_TTL_MS },
      }))
      this.setupDeadline = deadline
      if (deadline <= this.options.clock.monotonicMs()) throw new Error(UI_TEXT.nodeErrors.expired)
      this.options.console(`${UI_TEXT.nodeLabels.setupCode}: ${code}`)
      this.options.console(
        fill(UI_TEXT.nodeMessages.setupExpires, { time: formatDateTime(now + NODE_SETUP_TTL_MS) }),
      )
    })
  }

  /** Synchronously invalidate before N waits for its turn/tool cleanup. */
  endAll(): void {
    this.epoch += 1
    this.challenges.clear()
    this.sessions.endAll()
  }
}
