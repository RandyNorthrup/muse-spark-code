import type { CreateResponseBody } from '../../backends/modelapi/schemas'
import type { CachedPrefix } from '../../backends/modelapi/promptCache'
import type { ResponseAttemptGuard } from '../../backends/modelapi/client'
import type { TokenUsage } from '../../../shared/agentEvents'

/** The main session's last actual keyed request; reading it never rebuilds it. */
export interface ModelApiJudgeSource {
  readMainBody(): CreateResponseBody
  keyPrefix(prefix: CachedPrefix): string
  prefixTokens(): number | undefined
}

export interface ModelApiSideResponse {
  readonly text: string
  readonly inputTokens?: number | undefined
  readonly outputTokens?: number | undefined
  /** Only a complete provider receipt is suitable for U's usage rows. */
  readonly usage?: TokenUsage | undefined
  readonly reservedCostUsd?: number | undefined
  readonly settledCostUsd?: number | undefined
}

export interface ModelApiJudgeTransport {
  send(
    body: CreateResponseBody,
    signal: AbortSignal,
    guard?: ResponseAttemptGuard,
  ): Promise<ModelApiSideResponse>
}

export interface ModelApiJudgeConnection {
  readonly source: ModelApiJudgeSource
  readonly transport: ModelApiJudgeTransport
  readonly keyDigest: string
}
