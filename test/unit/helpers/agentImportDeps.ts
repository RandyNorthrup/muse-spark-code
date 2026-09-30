// What the import from other agents (M83) needs of a window, for tests that
// build the CLI features without running an import: the window is live, the
// lease runs its work at once and the bundle is the real entry.

import { importFromAgents } from '../../../src/host/agentImportEntry'
import type { CliFeatureDeps } from '../../../src/host/cliFeatures'

export function inertAgentImport(root?: string): CliFeatureDeps['agentImport'] {
  return {
    isActive: () => true,
    currentRoot: () => root,
    editProject: async (work) => await work(() => undefined),
    beforeProjectWrite: () => Promise.resolve(),
    bundle: () => ({ importFromAgents }),
  }
}
