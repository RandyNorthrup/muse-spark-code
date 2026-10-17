// The agent's "Allow always in this workspace" store (M58, PLAN.md D48, D62)
// in memory, for tests that are not about its file.

import type { PaidGrantStore } from '../../../src/acp/paid'
import {
  latestPaidGrant,
  paidAuthorityKey,
  type PaidGrant,
} from '../../../src/core/paid/paidAuthority'
import type { PaidFeature } from '../../../src/shared/constants'

export function memoryPaidGrants(): PaidGrantStore & {
  readonly byFolder: Map<string, ReadonlySet<PaidFeature>>
} {
  const byFolder = new Map<string, ReadonlySet<PaidFeature>>()
  const quotes = new Map<string, PaidGrant>()
  let generation = 0
  let order = 0
  return {
    byFolder,
    quoteGeneration: () => String(generation),
    nextQuoteOrder: () => ++order,
    readQuote: (folder, quote) =>
      quotes.get(JSON.stringify([folder, generation, paidAuthorityKey(quote)])),
    writeQuote: (folder, grant) => {
      const key = JSON.stringify([folder, generation, paidAuthorityKey(grant.quote)])
      const previous = quotes.get(key)
      const latest = latestPaidGrant([...(previous === undefined ? [] : [previous]), grant])
      if (latest !== undefined && grant.generation === String(generation)) quotes.set(key, latest)
      return Promise.resolve()
    },
    read: (workspaceRoot) => {
      const held = new Set(byFolder.get(workspaceRoot))
      const prefix = JSON.stringify([workspaceRoot, generation]).slice(0, -1) + ','
      for (const key of quotes.keys()) {
        if (key.startsWith(prefix)) held.add('webSearch')
      }
      return held
    },
    add: (workspaceRoot, features) => {
      byFolder.set(workspaceRoot, new Set([...(byFolder.get(workspaceRoot) ?? []), ...features]))
      return Promise.resolve()
    },
    forget: (features) => {
      if (features.includes('webSearch')) generation += 1
      for (const [folder, grants] of byFolder) {
        byFolder.set(folder, new Set([...grants].filter((feature) => !features.includes(feature))))
      }
      return Promise.resolve()
    },
  }
}
