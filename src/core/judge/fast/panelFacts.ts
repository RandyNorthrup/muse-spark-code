// D107 (M125 lane U): the window's fast-decision rolls. Both backends
// emit one `judgeFastTurn` event per turn; this keeps the newest record
// per decision and the window totals the panel and the usage dialog
// show. Unwired or unevaluated decisions carry no entry: the surface
// shows unknown, never zero. No `vscode` import.
import type {
  JudgeFastTurn,
  JudgeFastTurnDecision,
  JudgeFastTurnDecisionRecord,
} from '../../../shared/judgeFastTurn'
import type { JudgePanelFastFacts } from '../../../shared/judgePanelSchema'

export class FastPanelFacts {
  private readonly latest = new Map<JudgeFastTurnDecision, JudgeFastTurnDecisionRecord>()
  private readonly evaluated = new Map<JudgeFastTurnDecision, number>()
  private readonly applied = new Map<JudgeFastTurnDecision, number>()
  private readonly unwindowed = new Map<JudgeFastTurnDecision, number>()
  private turns = 0
  private appliedTurns = 0
  private raised = 0
  private acted = 0
  private judgeCalls = 0
  private judgeTokens = 0
  private method = ''

  /** True once any turn record arrived. */
  get observed(): boolean {
    return this.turns > 0
  }

  observe(event: JudgeFastTurn): void {
    this.turns += 1
    this.method = event.method
    let didTurnAct = false
    for (const record of event.decisions) {
      this.latest.set(record.decision, record)
      this.evaluated.set(
        record.decision,
        (this.evaluated.get(record.decision) ?? 0) + record.evaluated,
      )
      if (record.acted) {
        didTurnAct = true
        this.acted += 1
        this.applied.set(record.decision, (this.applied.get(record.decision) ?? 0) + 1)
      }
      if (record.raised) this.raised += 1
      if (record.noWindow !== undefined && record.noWindow > 0) {
        this.unwindowed.set(
          record.decision,
          (this.unwindowed.get(record.decision) ?? 0) + record.noWindow,
        )
      }
    }
    if (didTurnAct) this.appliedTurns += 1
    this.judgeCalls += event.judgeCalls
    this.judgeTokens += event.judgeTokens
  }

  /**
  The window's fast facts, or undefined before the first turn record.
  Lane V's paired medians ride alongside when a measurement exists;
  without them the snapshot's savings read unknown.
  */
  facts(
    measuredMsPerTurn?: JudgePanelFastFacts['measuredMsPerTurn'],
  ): JudgePanelFastFacts | undefined {
    if (this.turns === 0) return undefined
    const decisions: JudgePanelFastFacts['decisions'] = Array.from(
      this.latest.values(),
      (record) => ({
        decision: record.decision,
        raised: record.raised,
        acted: record.acted,
        reason: record.reason,
        evaluated: this.evaluated.get(record.decision) ?? 0,
        appliedTurns: this.applied.get(record.decision) ?? 0,
        ...((this.unwindowed.get(record.decision) ?? 0) > 0 && {
          noWindow: this.unwindowed.get(record.decision) ?? 0,
        }),
      }),
    )
    return {
      decisions,
      totals: {
        turns: this.turns,
        appliedTurns: this.appliedTurns,
        raised: this.raised,
        acted: this.acted,
        judgeCalls: this.judgeCalls,
        judgeTokens: this.judgeTokens,
      },
      method: this.method,
      ...(measuredMsPerTurn !== undefined && { measuredMsPerTurn }),
    }
  }
}
