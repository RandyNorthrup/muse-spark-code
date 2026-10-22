// Read-only views of the runtime usage ledgers for ACP clients.
import { acpBudget, type AcpAccounting } from '../acp/accounting'
import type { UsageRecording } from '../core/usage/recording'
import type { RuntimeBackend } from './backends'

export function createAcpAccounting(options: {
  recording: UsageRecording
  isEnabled: () => boolean
  runtime: Pick<RuntimeBackend, 'readUsageBudgets'>
  dataFolder: string
  now: () => number
  sleep: (ms: number) => Promise<void>
}): AcpAccounting {
  return {
    async readRecords(sessionId) {
      if (!options.isEnabled()) throw new Error('Usage history unavailable')
      // The journal carries no turn linkage: the snapshot covers the
      // session's retained records.
      const today = await options.recording.today()
      return today.filter((record) => record.session === sessionId)
    },
    async readBudgets(sessionId) {
      // The same pair VS Code sees: the shared daily paid budget first
      // (absent when the person set no daily limit), then the live
      // session budgets. The ledger reads never start a backend.
      const budgets = []
      const snapshots = await options.runtime.readUsageBudgets()
      for (const { budget, exact } of snapshots) {
        if (exact === undefined) throw new Error('Exact usage budget unavailable')
        if (budget.kind === 'paidDaily') {
          budgets.push(
            acpBudget(
              'daily',
              exact.capUsd,
              exact.spentUsd,
              exact.uncertainUsd,
              exact.hasUnknownCost,
            ),
          )
        } else if (budget.kind === 'conversation' && budget.id === sessionId) {
          budgets.push(
            acpBudget(
              'session',
              exact.capUsd,
              exact.spentUsd,
              exact.uncertainUsd,
              exact.hasUnknownCost,
            ),
          )
        }
      }
      return budgets
    },
  }
}
