// The ACP agent's non-backend dependencies for a test that drives it with a
// real client over a local backend: its folder as the default working folder,
// the real paid-use composition with nothing flagged and no remembered grant,
// the real maker surface, and questions declined.
import path from 'node:path'
import { AcpMakerSurface } from '../../../src/acp/maker'
import { AcpPaidUse } from '../../../src/acp/paid'
import type { AcpAgentDeps } from '../../../src/acp/agent'
import type { CoreLogger } from '../../../src/core/logging'
import { paidGrantFile } from '../../../src/runtime/paidGrants'

export function acpLocalAgentDeps(
  folder: string,
  log: CoreLogger,
): Pick<AcpAgentDeps, 'defaultCwd' | 'paid' | 'maker' | 'log' | 'questions'> {
  return {
    defaultCwd: folder,
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: paidGrantFile({
        file: path.join(folder, 'paid-grants.json'),
        log,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }),
      log,
    }),
    maker: new AcpMakerSurface({ log }),
    log,
    questions: 'decline',
  }
}
