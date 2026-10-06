import type { UnattendedRun } from './unattended'

/** A waiter/effect is valid only in the generation and turn that created it. */
export interface SessionToken {
  readonly generation: number
  readonly turnId: string | undefined
}

export type SessionEffect =
  | { readonly type: 'mode'; readonly token: SessionToken; readonly mode: string }
  | { readonly type: 'restore'; readonly token: SessionToken; readonly mode: string }

interface FireClaim {
  readonly run: UnattendedRun
  readonly previousMode: string
  turnId: string | undefined
  phase: 'admitting' | 'active' | 'failed'
  readonly observedTurns: Set<string>
  startDispatched: boolean
  hasStopEvidence: boolean
}

/** Synchronous owner; wire operations execute its tagged effects outside it. */
export class SessionOwner {
  private generation = 0
  private fire: FireClaim | undefined
  private mode: string | undefined
  private modePending: SessionEffect | undefined
  private isQuarantined = false
  private restoring = false
  private sequence = 0
  private readonly liveTurns = new Map<string, number>()
  private readonly terminalTurns = new Set<string>()
  private readonly starts = new Set<SessionToken>()

  public constructor(mode?: string) {
    this.mode = mode
  }

  private release(): SessionEffect {
    const mode = this.fire?.previousMode
    if (mode === undefined) throw new Error('Missing owned mode')
    this.fire = undefined
    this.generation += 1
    this.restoring = true
    const effect: SessionEffect = { type: 'restore', token: this.token(), mode }
    this.modePending = effect
    return effect
  }

  public get currentTurnId(): string | undefined {
    let current: string | undefined
    for (const turnId of this.liveTurns.keys()) current = turnId
    return current
  }

  public token(): SessionToken {
    return { generation: this.generation, turnId: this.fire?.turnId ?? this.currentTurnId }
  }

  public matches(token: SessionToken): boolean {
    const current = this.token()
    return token.generation === current.generation && token.turnId === current.turnId
  }

  public run(turnId?: string): UnattendedRun | undefined {
    return turnId === undefined ||
      turnId === this.fire?.turnId ||
      this.fire?.observedTurns.has(turnId) === true
      ? this.fire?.run
      : undefined
  }

  public isFailed(run: UnattendedRun): boolean {
    return this.fire?.run === run && this.fire.phase === 'failed'
  }

  public claim(
    token: SessionToken,
    run: UnattendedRun,
    expectedTurnId?: string,
  ): SessionToken | undefined {
    if (
      !this.matches(token) ||
      this.restoring ||
      this.modePending ||
      this.mode === undefined ||
      !run.isActive() ||
      this.fire !== undefined ||
      (expectedTurnId === undefined
        ? this.liveTurns.size > 0 || this.starts.size > 0
        : this.currentTurnId !== expectedTurnId || this.starts.size > 0)
    )
      return undefined
    this.generation += 1
    this.fire = {
      run,
      previousMode: this.mode,
      turnId: expectedTurnId,
      phase: 'admitting',
      observedTurns: new Set(),
      startDispatched: false,
      hasStopEvidence: false,
    }
    return this.token()
  }

  public modeEffect(
    token: SessionToken,
    mode: string,
    run?: UnattendedRun,
  ): SessionEffect | undefined {
    if (
      !this.matches(token) ||
      this.restoring ||
      this.modePending ||
      (this.fire !== undefined && (this.fire.run !== run || this.fire.phase === 'failed'))
    )
      return undefined
    const effect: SessionEffect = { type: 'mode', token, mode }
    this.modePending = effect
    return effect
  }

  public modeApplied(effect: SessionEffect, didSucceed: boolean): boolean {
    if (this.modePending !== effect) return false
    this.modePending = undefined
    if (effect.type === 'restore') this.restoring = false
    if (!this.matches(effect.token)) return false
    this.mode = didSucceed ? effect.mode : undefined
    this.isQuarantined = !didSucceed
    return didSucceed
  }

  public observeMode(mode: string): void {
    // Session-wide notifications have no generation. Only an idle external
    // change can be adopted; owned commands use their tagged acknowledgement.
    if (this.fire === undefined && !this.modePending && !this.restoring) this.mode = mode
  }

  public start(token: SessionToken, run?: UnattendedRun): boolean {
    if (
      !this.matches(token) ||
      this.restoring ||
      this.modePending ||
      this.isQuarantined ||
      (this.fire !== undefined && (this.fire.run !== run || this.fire.phase !== 'admitting')) ||
      (run !== undefined && (this.liveTurns.size > 0 || this.starts.size > 0 || !run.isActive()))
    )
      return false
    if (this.fire !== undefined && this.fire.run === run) {
      this.fire.startDispatched = true
      this.fire.hasStopEvidence = false
    }
    this.starts.add(token)
    return true
  }

  public startAcknowledged(token: SessionToken, turnId: string, didStart: boolean): void {
    const wasPending = this.starts.delete(token)
    if (!wasPending || token.generation !== this.generation) return
    // A queued turn's terminal cannot discard evidence for another turn.
    if (!didStart || this.terminalTurns.has(turnId)) {
      return
    }

    this.liveTurns.set(turnId, ++this.sequence)
    if (this.fire !== undefined) this.fire.hasStopEvidence = false
  }

  public startFailed(token: SessionToken): void {
    this.starts.delete(token)
  }

  public canSteer(token: SessionToken, expectedTurnId: string, run?: UnattendedRun): boolean {
    return (
      this.matches(token) &&
      (this.fire === undefined || this.currentTurnId === expectedTurnId) &&
      !this.restoring &&
      !this.modePending &&
      (this.fire === undefined ||
        (this.fire.run === run && this.fire.phase !== 'failed' && run.isActive()))
    )
  }

  public canCancel(token: SessionToken, run: UnattendedRun): boolean {
    if (!this.matches(token) || this.fire?.run !== run) return false
    const current = this.currentTurnId
    return this.fire.turnId === undefined
      ? this.fire.startDispatched && (current === undefined || this.fire.observedTurns.has(current))
      : current === this.fire.turnId
  }

  public observedStart(turnId: string): void {
    if (!this.terminalTurns.has(turnId)) this.liveTurns.set(turnId, ++this.sequence)
    if (this.fire !== undefined) this.fire.hasStopEvidence = false
    this.observeFireTurn(turnId)
  }

  public observeFireTurn(turnId: string): void {
    if (!(
      this.fire?.phase === 'admitting' &&
      (this.fire.startDispatched || this.fire.turnId === turnId)
    )) {
      return
    }

    this.fire.observedTurns.add(turnId)
    if (!this.terminalTurns.has(turnId)) this.liveTurns.set(turnId, ++this.sequence)
  }

  public admitted(token: SessionToken, turnId: string): SessionEffect | undefined {
    // An event can supply live evidence before the ack, but cannot retag the claim.
    if (
      token.generation !== this.generation ||
      this.fire?.phase !== 'admitting' ||
      this.fire.turnId !== token.turnId
    )
      return undefined
    this.fire.turnId = turnId
    this.fire.phase = 'active'
    return this.terminalTurns.has(turnId) || this.fire.hasStopEvidence ? this.release() : undefined
  }

  public admissionFailed(token: SessionToken): SessionEffect | undefined {
    if (
      token.generation !== this.generation ||
      this.fire?.phase !== 'admitting' ||
      this.fire.turnId !== token.turnId
    )
      return
    this.starts.delete(token)
    this.fire.turnId ??= [...this.fire.observedTurns].at(-1)
    this.fire.phase = 'failed'
    return this.fire.hasStopEvidence ||
      (!this.fire.startDispatched && this.fire.turnId === undefined) ||
      (this.fire.turnId !== undefined && this.terminalTurns.has(this.fire.turnId))
      ? this.release()
      : undefined
  }

  /** Unambiguous session-wide stop evidence also settles an unknown dispatched turn. */
  public stopped(): SessionEffect | undefined {
    const observedAt = ++this.sequence
    for (const [turnId, startedAt] of this.liveTurns) {
      if (startedAt < observedAt) this.liveTurns.delete(turnId)
    }
    // Outstanding commands can start after this observation. Only their own
    // acknowledgement/failure resolves them; idle never supplies that proof.
    if (this.fire === undefined) return undefined
    this.fire.hasStopEvidence = true
    return this.fire.phase === 'failed' ? this.release() : undefined
  }

  /** A local steer removed before adoption never reached the provider. */
  public withdraw(run: UnattendedRun): SessionEffect | undefined {
    return this.fire?.run === run && this.fire.phase === 'admitting' && !this.fire.startDispatched
      ? this.release()
      : undefined
  }

  public terminal(turnId: string): SessionEffect | undefined {
    this.terminalTurns.add(turnId)
    this.liveTurns.delete(turnId)
    return this.fire?.turnId === turnId && this.fire.phase !== 'admitting'
      ? this.release()
      : undefined
  }
}
