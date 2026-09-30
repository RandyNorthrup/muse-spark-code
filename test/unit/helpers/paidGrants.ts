// The agent's "Allow always in this workspace" store (M58, PLAN.md D48, D62)
// in memory, for tests that are not about its file.

import type { PaidGrantStore } from '../../../src/acp/paid'
import type { PaidFeature } from '../../../src/shared/constants'

export function memoryPaidGrants(): PaidGrantStore & {
  readonly byFolder: Map<string, ReadonlySet<PaidFeature>>
} {
  const byFolder = new Map<string, ReadonlySet<PaidFeature>>()
  return {
    byFolder,
    read: (workspaceRoot) => byFolder.get(workspaceRoot) ?? new Set(),
    add: (workspaceRoot, features) => {
      byFolder.set(workspaceRoot, new Set([...(byFolder.get(workspaceRoot) ?? []), ...features]))
      return Promise.resolve()
    },
    forget: (features) => {
      for (const [folder, grants] of byFolder) {
        byFolder.set(folder, new Set([...grants].filter((feature) => !features.includes(feature))))
      }
      return Promise.resolve()
    },
  }
}
