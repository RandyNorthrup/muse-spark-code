// M88, lane A: the prompt sequence runner. It drives the pure machine
// (`core/prompts/promptSequence`) through the controller's deferred send:
// one step per completed turn, the run over on any other end, on Stop, on
// a session switch, and with the panel. Every transition runs on one
// promise chain, so a settle, a stop and an in-flight send never
// interleave; after every await the run id is current or the outcome is
// dropped.
import { randomUUID } from 'node:crypto'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { SavedSequence, SequenceEndReason, SequenceRunView } from '../../shared/sequences'
import {
  sequenceSendRefused,
  sequenceSessionSwitched,
  sequenceStepSent,
  sequenceStop,
  sequenceTurnSettled,
  startSequenceRun,
  type SequenceRunEffect,
  type SequenceRunState,
} from '../../core/prompts/promptSequence'
import { validateSequenceInput } from '../../core/prompts/sequenceStore'
import type { DeferredSend, DeferredSendVerdict, TurnSettled } from '../conversation/deferredSend'
import { isTransientSendRefusal, safeSequenceFailure } from '../conversation/featurePorts'

export interface SequenceRunnerCallbacks {
  readonly deferred: DeferredSend
  readonly postState: (run: SequenceRunView | undefined) => void
  readonly notice: (level: 'info' | 'warning', text: string) => void
  /** The redacted kind of an unexpected runner failure, for the log. */
  readonly log: (failure: string) => void
}

function runViewOf(state: SequenceRunState): SequenceRunView {
  return {
    sequenceId: state.sequenceId,
    scope: state.scope,
    name: state.name,
    step: Math.min(state.index + 1, state.steps.length),
    total: state.steps.length,
  }
}

function endNotice(
  reason: SequenceEndReason,
  state: SequenceRunState,
): {
  readonly level: 'info' | 'warning'
  readonly text: string
} {
  const labels: Record<SequenceEndReason, string> = {
    stopped: UI_TEXT.sequenceReasonStopped,
    failed: UI_TEXT.sequenceReasonFailed,
    cancelled: UI_TEXT.sequenceReasonCancelled,
    switched: UI_TEXT.sequenceReasonSwitched,
  }
  const label = labels[reason]
  return {
    level: reason === 'stopped' ? 'info' : 'warning',
    text: fill(UI_TEXT.sequenceStopped, { step: state.index, reason: label }),
  }
}

export class SequenceRunner {
  private run: SequenceRunState | undefined
  private chain: Promise<void> = Promise.resolve()
  private releaseListener: (() => void) | undefined
  private isDisposed = false

  public constructor(private readonly callbacks: SequenceRunnerCallbacks) {}

  private enqueue(work: () => Promise<void>): void {
    const previous = this.chain
    this.chain = (async (): Promise<void> => {
      await previous
      try {
        await work()
      } catch (error: unknown) {
        // Never throws out of the chain: the run drops, the kind is
        // logged, the panel hears the fixed words, and the next link
        // still runs.
        this.run = undefined
        this.unsubscribe()
        this.callbacks.postState(undefined)
        this.callbacks.log(failureForLog(error))
        if (!this.isDisposed) {
          this.callbacks.notice('warning', safeSequenceFailure(error).message)
        }
      }
    })()
  }

  private async execute(state: SequenceRunState, effect: SequenceRunEffect): Promise<void> {
    switch (effect.kind) {
      case 'wait': {
        return
      }
      case 'sendStep': {
        await this.sendStep(state, effect.text)
        return
      }
      case 'end': {
        this.finish(state, effect.reason, effect.isSilent)
        return
      }
    }
  }

  private async sendStep(state: SequenceRunState, text: string): Promise<void> {
    let outcome: { readonly verdict: DeferredSendVerdict; readonly turnId?: string }
    try {
      outcome = await this.callbacks.deferred.sendAsUser(text, {
        sessionId: state.sessionId,
        runId: state.runId,
      })
    } catch (error: unknown) {
      // A transient race waits out; anything else reaches the chain's guard.
      if (!isTransientSendRefusal(error)) {
        throw error
      }
      outcome = { verdict: 'busy' }
    }
    // Stopped or switched while the send flew: its outcome is dropped.
    if (this.run?.runId !== state.runId || this.isDisposed) {
      return
    }
    if (outcome.verdict === 'ok') {
      this.run = sequenceStepSent(state)
      this.post()
      return
    }
    // Refused: re-read the conversation first — a turn that started in
    // the gap ends the wait, and the send's own refusal already spoke.
    const recheck = this.callbacks.deferred.canSendNow(state.sessionId, state.runId)
    const next = sequenceSendRefused(state, recheck)
    this.run = next.state
    await this.execute(next.state, next.effect)
  }

  private finish(
    state: SequenceRunState,
    reason: SequenceEndReason | 'done',
    isSilent: boolean,
  ): void {
    this.run = undefined
    this.unsubscribe()
    this.callbacks.postState(undefined)
    if (isSilent || this.isDisposed) {
      return
    }
    if (reason === 'done') {
      this.callbacks.notice('info', fill(UI_TEXT.sequenceDone, { name: state.name }))
      return
    }
    const said = endNotice(reason, state)
    this.callbacks.notice(said.level, said.text)
  }

  private post(): void {
    if (this.run !== undefined && !this.isDisposed) {
      this.callbacks.postState(runViewOf(this.run))
    }
  }

  private subscribe(): void {
    this.releaseListener ??= this.callbacks.deferred.onTurnSettled((settled) => {
      this.onTurnSettled(settled)
    })
  }

  private unsubscribe(): void {
    this.releaseListener?.()
    this.releaseListener = undefined
  }

  /** The run id while one is going; the deferred send reads it. */
  public get activeRunId(): string | undefined {
    return this.run?.runId
  }

  // Start a run of the sequence in the session. A second run refuses
  // with the fixed words, as does a sequence blanks got into by hand;
  // the first step goes on the chain.
  public start(sequence: SavedSequence, sessionId: string): void {
    if (this.isDisposed) {
      return
    }
    if (this.run !== undefined) {
      throw new Error(UI_TEXT.sequenceAlreadyRunning)
    }
    validateSequenceInput(sequence)
    const { state, effect } = startSequenceRun({
      runId: randomUUID(),
      sequenceId: sequence.id,
      scope: sequence.scope,
      name: sequence.name,
      steps: sequence.steps,
      sessionId,
    })
    this.run = state
    this.subscribe()
    this.post()
    this.enqueue(async () => {
      await this.execute(state, effect)
    })
  }

  /** A turn's end under the run, in chain order. */
  public onTurnSettled(settled: TurnSettled): void {
    this.enqueue(async () => {
      const current = this.run
      if (current === undefined || this.isDisposed) {
        return
      }
      const isIdle = this.callbacks.deferred.canSendNow(current.sessionId, current.runId) === 'ok'
      const next = sequenceTurnSettled(current, settled.turnId, settled.terminal, isIdle)
      this.run = next.state
      await this.execute(next.state, next.effect)
    })
  }

  /** Stop ends the run after the steps sent; a step's turn keeps running. */
  public stop(): void {
    this.enqueue(async () => {
      const current = this.run
      if (current === undefined || this.isDisposed) {
        return
      }
      const next = sequenceStop(current)
      this.run = next.state
      await this.execute(next.state, next.effect)
    })
  }

  /** The conversation changed under the run: it ends, saying so. */
  public endOnSessionSwitch(): void {
    if (this.isDisposed) {
      return
    }
    this.enqueue(async () => {
      const current = this.run
      if (current === undefined || this.isDisposed) {
        return
      }
      const next = sequenceSessionSwitched(current)
      this.run = next.state
      await this.execute(next.state, next.effect)
    })
  }

  /** The panel is going: the run ends silently and lets go of the listener. */
  public dispose(): void {
    this.isDisposed = true
    this.run = undefined
    this.releaseListener?.()
    this.releaseListener = undefined
  }
}
