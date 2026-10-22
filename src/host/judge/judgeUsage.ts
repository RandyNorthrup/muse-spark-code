// M98-U: each actual source call has its own row, apart from conversation tokens.
import type { PaidUsage } from '../../core/paid/paidFeatures'
import type { AgentEvent, ItemSnapshot } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import type { UsdAmount } from '../../shared/usd'

export interface JudgeUsageDeps {
  readonly billing: 'modelApi' | 'subscription'
  readonly usage: Pick<PaidUsage, 'add' | 'addJudgeUsage' | 'addJudgeReceipt'>
  readonly emit: (event: AgentEvent) => void
}

/** Called by the admitted transport, only when a call is actually dispatched. */
export class JudgeUsageRows {
  private readonly pending = new Map<string, { item: ItemSnapshot; modelId: string }>()
  public constructor(private readonly deps: JudgeUsageDeps) {}

  public started(
    itemId: string,
    turnId: string,
    modelId: string,
    source: 'same' | 'separate' = 'same',
  ): void {
    if (this.pending.has(itemId)) throw new Error('Judge call already started')
    const item: ItemSnapshot = {
      itemId,
      turnId,
      kind: 'toolCall',
      status: 'inProgress',
      tool: 'judge',
      visibleOutput: `${source === 'same' ? UI_TEXT.judgeStatusSame : UI_TEXT.judgeSourceSeparate}: ${modelId}`,
      ...(this.deps.billing === 'modelApi' && { paid: 'judge' }),
    }
    this.pending.set(itemId, { item, modelId })
    if (this.deps.billing === 'modelApi') this.deps.usage.add('judge', 1)
    this.deps.emit({ type: 'itemStarted', item })
  }

  /** Receipts settle even for a late advisory; the already charged call is still usage. */
  public finished(itemId: string, usage: ItemSnapshot['usage'], settledCostUsd?: UsdAmount): void {
    const pending = this.pending.get(itemId)
    if (pending === undefined) return
    const { item } = pending
    // A separate source settles at its own rates; the conversation model's
    // card prices only its own receipts.
    if (settledCostUsd !== undefined && this.deps.billing === 'modelApi')
      this.deps.usage.addJudgeReceipt(
        { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 },
        settledCostUsd,
      )
    else if (usage !== undefined && this.deps.billing === 'modelApi')
      this.deps.usage.addJudgeUsage(pending.modelId, usage)
    this.pending.delete(itemId)
    this.deps.emit({
      type: 'itemCompleted',
      item: { ...item, status: 'completed', ...(usage !== undefined && { usage }) },
    })
  }

  public failed(itemId: string): void {
    const pending = this.pending.get(itemId)
    if (pending === undefined) return
    const { item } = pending
    this.pending.delete(itemId)
    this.deps.emit({
      type: 'itemCompleted',
      item: { ...item, status: 'failed', visibleOutput: UI_TEXT.toolFailed },
    })
  }
}
