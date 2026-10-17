import { randomUUID } from 'node:crypto'
import {
  admitJudgeCall,
  rebindJudgeClaim,
  verifyJudgeDispatch,
  type JudgeAdmissionBinding,
  type JudgeDailyLedger,
} from '../../core/judge/admission'
import type {
  ModelApiJudgeConnection,
  ModelApiJudgeTransport,
} from '../../core/judge/same/modelApiSource'
import type { ResponseAttemptGuard } from '../../core/backends/modelapi/client'
import { type JudgeUsageRows } from './judgeUsage'

/** Reservations precede send; the client's synchronous guard follows its key wait. */
export function admittedModelApiJudge(deps: {
  readonly connection: ModelApiJudgeConnection
  readonly ledger: JudgeDailyLedger
  readonly binding: () => JudgeAdmissionBinding
  readonly rows: JudgeUsageRows
  readonly turnId: string
  readonly signal: AbortSignal
  readonly contextLimit: number
}): ModelApiJudgeTransport {
  return {
    send: async (body, timeout) => {
      const signal = AbortSignal.any([timeout, deps.signal])
      signal.throwIfAborted()
      const inputTokens = Buffer.byteLength(JSON.stringify(body))
      if (inputTokens + body.max_output_tokens > deps.contextLimit)
        throw new Error('Judge request exceeds the loaded context limit')
      const admitted = await admitJudgeCall({
        binding: deps.binding(),
        currentBinding: deps.binding,
        billing: { kind: 'metered', ledger: deps.ledger },
        estimatedInputTokens: inputTokens,
        maxOutputTokens: body.max_output_tokens,
      })
      if (!admitted.admitted) throw new Error(`Judge admission refused: ${admitted.refusal}`)
      const { claim } = admitted
      const itemId = randomUUID()
      const dispatch = { hasSent: false }
      try {
        const verified = await verifyJudgeDispatch(claim, deps.binding, deps.ledger)
        if (!verified.proceed) throw new Error(`Judge dispatch refused: ${verified.reason}`)
        const check = () => {
          signal.throwIfAborted()
          if (dispatch.hasSent || !rebindJudgeClaim(claim, deps.binding()).rebound)
            throw new Error('Judge dispatch binding expired')
          claim.check()
        }
        const guard: ResponseAttemptGuard = Object.assign(
          (keyDigest: string | undefined) => {
            if (keyDigest !== deps.connection.keyDigest) throw new Error('Judge account changed')
            check()
          },
          {
            onRequestStarted: () => {
              check()
              dispatch.hasSent = true
              deps.rows.started(itemId, deps.turnId, body.model)
            },
          },
        )
        check()
        const response = await deps.connection.transport.send(body, signal, guard)
        deps.rows.finished(itemId, response.usage)
        const settledCostUsd =
          response.usage === undefined ? undefined : await claim.settleKnown(response.usage)
        return { ...response, reservedCostUsd: claim.reservedUsd, settledCostUsd }
      } catch (error: unknown) {
        if (dispatch.hasSent) deps.rows.failed(itemId)
        else await claim.refundNonSend()
        throw error
      }
    },
  }
}
