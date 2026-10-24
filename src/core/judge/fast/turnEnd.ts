// D107 §6.4 and §7.3 (M125 lanes C, M and U): one session's fast-turn
// boundary, shared by both backends. A turn's start closes the turn
// before it and starts a fresh loop episode; a turn's end closes its own
// record, once. Closing runs the done and failure verdicts over the
// finished turn's reply and tool outputs, queues the next turn's notes and
// hints, and emits the turn event with every evaluated decision — nothing
// when none was, or when the fast judge is off. Neither backend keeps an
// exit code with what it drained, so the verdicts read the texts alone and
// miss more often without one — never a guess. No `vscode` import.
import type { JudgeFastTurn } from '../../../shared/judgeFastTurn'
import { JUDGE_FAST_METHOD_DETERMINISTIC } from '../../../shared/constants'
import { doneTailNote, failureTailHint } from './apply'
import { judgeDoneClaim } from './reflex/done'
import { findUnmentionedFailure } from './reflex/failures'
import type { LoopSignal } from './reflex/loop'
import { doneTurnReason, FastTurnRecorder, type FastDecisionPin } from './turnRecord'

/** One tool's output in the finished turn, as the backend drained it. */
export interface FinishedToolOutput {
  readonly tool: string
  readonly output: string
}

/** What a finished turn left for the verdicts. */
export interface FinishedTurnTexts {
  readonly reply: string | undefined
  readonly outputs: readonly FinishedToolOutput[]
}

/** The backend a boundary closes turns for. */
export interface FastTurnHost {
  readonly backend: JudgeFastTurn['backend']
  /** The evaluation pin lane V's arms (and the red drill) set, read at each verdict. */
  readonly pin: FastDecisionPin
  /** The fast judge's switch, read at each close. */
  readonly isOff: () => boolean
  /** The closed turn's reply and outputs: read once per close, before the switch. */
  readonly read: (turnId: string) => FinishedTurnTexts
  readonly emit: (event: JudgeFastTurn) => void
}

export class FastTurnBoundary {
  private lastTurn: string | undefined
  private closedTurn: string | undefined
  /** The current turn's decision record. */
  readonly recorder = new FastTurnRecorder()
  /** The notes and hints the next request carries. */
  readonly tail: string[] = []
  /** The current turn's loop episode: its signals so far. */
  readonly loop: LoopSignal[] = []
  /** Whether this episode's loop was already raised. */
  stuck = false

  constructor(private readonly host: FastTurnHost) {}

  /** The closed turn's verdicts and event; with the judge off, nothing. */
  private close(turnId: string, texts: FinishedTurnTexts): void {
    if (this.host.isOff()) {
      this.recorder.reset()
      return
    }
    if (texts.reply !== undefined && texts.outputs.length > 0) {
      this.judgeDone(texts.reply, texts.outputs)
      this.judgeFailure(texts.reply, texts.outputs)
    }
    const event = this.recorder.event(turnId, this.host.backend, JUDGE_FAST_METHOD_DETERMINISTIC)
    this.recorder.reset()
    if (event !== undefined) this.host.emit(event)
  }

  /** §6.4: the finished turn's done claim, with its record. A backed done queues its note. */
  private judgeDone(reply: string, outputs: readonly FinishedToolOutput[]): void {
    const done = judgeDoneClaim({
      replyText: reply,
      toolOutputs: outputs.map((output) => ({ exitCode: undefined, output: output.output })),
    })
    const pin = this.host.pin('done.unbacked')
    const isClaimed = done.decision !== 'miss'
    if (pin !== false && done.decision === 'backed') this.tail.push(doneTailNote())
    this.recorder.observeDone(
      isClaimed || pin === true,
      pin !== false && (isClaimed || pin === true),
      doneTurnReason(done.decision, pin),
    )
  }

  /** §7.3: the finished turn's unmentioned failure, with its record. */
  private judgeFailure(reply: string, outputs: readonly FinishedToolOutput[]): void {
    const pin = this.host.pin('failure.unmentioned')
    let isMentioned = false
    for (const output of outputs) {
      const failure = findUnmentionedFailure({
        toolOutput: output.output,
        exitCode: undefined,
        replyText: reply,
      })
      if (failure.decision === 'mentioned') isMentioned = true
      if (pin !== false && failure.decision === 'unmentioned') {
        this.tail.push(failureTailHint(output.tool))
        this.recorder.observeFailure(true, true, 'hint')
        return
      }
    }
    if (pin === true) {
      const first = outputs[0]
      if (first !== undefined) this.tail.push(failureTailHint(first.tool))
      this.recorder.observeFailure(true, true, 'pinned')
      return
    }
    this.recorder.observeFailure(false, false, isMentioned ? 'mentioned' : 'absent')
  }

  /** A turn starts: the turn before it closes, and its loop episode starts afresh. */
  start(turnId: string | undefined): void {
    if (turnId === this.lastTurn) return
    this.end(this.lastTurn)
    this.lastTurn = turnId
    this.newEpisode()
  }

  /** A fresh loop episode: no signals, not stuck. */
  newEpisode(): void {
    this.loop.length = 0
    this.stuck = false
  }

  /**
  A turn ends: its record closes, once. The turn end closes it first; the
  next turn's start is the backstop, and the closed mark keeps the two from
  doubling.
  */
  end(turnId: string | undefined): void {
    if (turnId === undefined || turnId === this.closedTurn) return
    this.closedTurn = turnId
    // The backend drains the turn whether or not the judge is on.
    this.close(turnId, this.host.read(turnId))
  }
}
