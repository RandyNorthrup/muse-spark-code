// Tab's engine (lane C) and its spend gate over the cross-window ledger
// (lane L), M94, PLAN.md D73. Pure: no `vscode` import, so dist/tab.js
// builds VS Code's from it and dist/lsp.js the language server's (M104
// lane H): one engine, one ledger, one budget in every editor.

import { createTabEngine } from '../../core/tab/tabEngine'
import type { TabEngineServices, TabServicesDeps } from './tabContract'
import { createTabLedger } from './tabLedger'
import { createTabSpendGate } from './tabSpendGate'

/** What the engine and the spend gate are built from; the model resolution stays with the caller. */
export type TabServicesInput = Omit<TabServicesDeps, 'resolveByo' | 'recordMaxOutputTokens'>

function now(): number {
  return Date.now()
}

/** The engine over the key client, and the spend gate over this window's ledger file. */
export function createTabServices(deps: TabServicesInput): TabEngineServices {
  const ledger = createTabLedger({
    directory: deps.ledgerDirectory,
    windowId: deps.windowId,
    now,
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
    log: deps.log,
  })
  return {
    engine: createTabEngine({
      stream: deps.stream,
      onSent: deps.onSent,
      onUsage: deps.onUsage,
    }),
    spend: createTabSpendGate({
      ledger,
      budgetUsd: deps.budgetUsd,
      now,
      onTotalChanged: deps.onTotalChanged,
      ...(deps.onBudgetReached !== undefined && { onBudgetReached: deps.onBudgetReached }),
      log: deps.log,
    }),
  }
}
