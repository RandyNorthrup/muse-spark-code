import { vi } from 'vitest'
import type {
  AgentSession,
  QuestionDeferralPort,
  TurnSubmission,
} from '../../../../src/core/agent/agentBackend'
import { FakeAgentSession } from '../fakeAgent'

function settledDeferral(): Promise<void> {
  return Promise.resolve()
}

/** The existing full fake session, with M112's required injected capability and scripted submissions. */
export class ScriptedQuestionSession extends FakeAgentSession implements QuestionDeferralPort {
  public readonly deferQuestions = vi.fn<QuestionDeferralPort['deferQuestions']>(settledDeferral)

  /** Error includes a refused steer or an uncertain failure, without hidden fallback logic. */
  public queueSteer(result: TurnSubmission | Error): void {
    this.steer.mockImplementationOnce(() =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
    )
  }

  public queueTurn(result: TurnSubmission | Error): void {
    this.sendTurn.mockImplementationOnce(() =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
    )
  }

  /** Hold settlement to exercise an answer/timeout race in lane Q. */
  public holdDeferral(settlement: ReturnType<AgentSession['cancelQuestions']>): void {
    this.deferQuestions.mockReturnValueOnce(settlement)
  }
}
