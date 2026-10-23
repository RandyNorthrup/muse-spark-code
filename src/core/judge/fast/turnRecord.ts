// D107 (M125 lane U): one turn's fast-decision record, shared by both
// backends. The host observes each evaluation as it happens — whether
// the verdict's condition was raised (or the pin forced it) and whether
// the host acted — and takes the turn event at the turn end. A forced
// outcome still reads `pinned`: the panel must never show a forced
// outcome as a measured one. No `vscode` import.
import type {
  JudgeFastTurn,
  JudgeFastTurnDecision,
  JudgeFastTurnDecisionRecord,
  JudgeFastTurnReason,
} from '../../../shared/judgeFastTurn'
import type { TriageRoute } from './apply'
import type { DoneVerdict } from './reflex/done'
import type { LoopVerdict } from './reflex/loop'

interface DecisionTally {
  evaluated: number
  raised: boolean
  acted: boolean
  reason: JudgeFastTurnReason
  noWindow: number
}

const ORDER: readonly JudgeFastTurnDecision[] = [
  'triage.needFull',
  'context.include',
  'loop.stuck',
  'effort.lower',
  'skill.fit',
  'edit.misfit',
  'failure.unmentioned',
  'scope.outside',
  'claim.inconsistent',
  'done.unbacked',
]

/** The evaluation pin lane V's arms (and the red drill) set. */
export type FastDecisionPin = (decision: JudgeFastTurnDecision) => boolean | undefined

/**
One triaged result's turn reason: the pack, the forced pack, or why
the output rode whole. The natural verdict names it whenever it fired.
*/
export function triageTurnReason(
  route: TriageRoute,
  pin: boolean | undefined,
): JudgeFastTurnReason {
  if (route.action === 'pack') return 'pack'
  if (pin === true) return 'pinned'
  if (route.unasked === 'no-window') return 'no-window'
  return route.unasked === 'no-engine' ? 'no-engine' : 'whole'
}

/** One observed result's loop reason: the pattern, the forced note, or nothing. */
export function loopTurnReason(
  verdict: LoopVerdict,
  pin: boolean | undefined,
): JudgeFastTurnReason {
  if (verdict.stuck) return verdict.pattern
  return pin === true ? 'pinned' : 'absent'
}

/** One request's effort reason: the lowering, the broad request, or the floor. */
export function effortTurnReason(
  shouldLower: boolean,
  didAct: boolean,
  canLower: boolean,
): JudgeFastTurnReason {
  if (didAct) return shouldLower ? 'lowered' : 'pinned'
  if (!shouldLower) return 'broad'
  return canLower ? 'pinned' : 'lowest'
}

/** One compaction's keep reason: kept, the forced keep, or nothing found. */
export function keepTurnReason(isKept: boolean, isRequestEmpty: boolean): JudgeFastTurnReason {
  if (!isKept) return 'absent'
  return isRequestEmpty ? 'pinned' : 'kept'
}

/** One turn's done-claim reason: the queued note, the surface note, or no claim. */
export function doneTurnReason(
  verdict: DoneVerdict['decision'],
  pin: boolean | undefined,
): JudgeFastTurnReason {
  if (verdict === 'backed') return 'note'
  if (verdict === 'unbacked') return 'surface-note'
  return pin === true ? 'pinned' : 'no-claim'
}

export class FastTurnRecorder {
  private readonly tallies = new Map<JudgeFastTurnDecision, DecisionTally>()

  private observe(
    decision: JudgeFastTurnDecision,
    isRaised: boolean,
    didAct: boolean,
    reason: JudgeFastTurnReason,
    noWindow = 0,
  ): void {
    const tally = this.tallies.get(decision) ?? {
      evaluated: 0,
      raised: false,
      acted: false,
      reason,
      noWindow: 0,
    }
    tally.evaluated += 1
    tally.raised ||= isRaised
    tally.acted ||= didAct
    // The acted outcome names the turn; otherwise the latest verdict does.
    if (didAct || !tally.acted) tally.reason = reason
    tally.noWindow += noWindow
    this.tallies.set(decision, tally)
  }

  observeLoop(isRaised: boolean, didAct: boolean, reason: JudgeFastTurnReason): void {
    this.observe('loop.stuck', isRaised, didAct, reason)
  }

  observeTriage(isRaised: boolean, didAct: boolean, reason: JudgeFastTurnReason): void {
    this.observe('triage.needFull', isRaised, didAct, reason, reason === 'no-window' ? 1 : 0)
  }

  observeEffort(isRaised: boolean, didAct: boolean, reason: JudgeFastTurnReason): void {
    this.observe('effort.lower', isRaised, didAct, reason)
  }

  observeKeep(isRaised: boolean, didAct: boolean, reason: JudgeFastTurnReason): void {
    this.observe('context.include', isRaised, didAct, reason)
  }

  observeDone(isRaised: boolean, didAct: boolean, reason: JudgeFastTurnReason): void {
    this.observe('done.unbacked', isRaised, didAct, reason)
  }

  observeFailure(isRaised: boolean, didAct: boolean, reason: JudgeFastTurnReason): void {
    this.observe('failure.unmentioned', isRaised, didAct, reason)
  }

  /** True once any decision was evaluated this turn. */
  get evaluated(): boolean {
    return this.tallies.size > 0
  }

  /**
  The turn event, or undefined when no decision was evaluated. Entries
  ride in decision order; a zero triage no-window count stays absent.
  */
  event(
    turnId: string,
    backend: JudgeFastTurn['backend'],
    method: string,
  ): JudgeFastTurn | undefined {
    if (this.tallies.size === 0) return undefined
    const decisions: JudgeFastTurnDecisionRecord[] = []
    for (const decision of ORDER) {
      const tally = this.tallies.get(decision)
      if (tally === undefined) continue
      decisions.push({
        decision,
        evaluated: tally.evaluated,
        raised: tally.raised,
        acted: tally.acted,
        reason: tally.reason,
        ...(decision === 'triage.needFull' && tally.noWindow > 0 && { noWindow: tally.noWindow }),
      })
    }
    return {
      type: 'judgeFastTurn',
      turnId,
      backend,
      method,
      decisions,
      judgeCalls: 0,
      judgeTokens: 0,
    }
  }

  reset(): void {
    this.tallies.clear()
  }
}
