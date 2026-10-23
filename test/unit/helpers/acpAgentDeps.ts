// Minimal agent deps for a protocol drive: a scripted backend, no paid
// flags, declined questions. Shared so the drive suites cannot drift
// apart.
import path from 'node:path'
import type { AcpAgentDeps } from '../../../src/acp/agent'
import { AcpPaidUse } from '../../../src/acp/paid'
import type { CoreLogger } from '../../../src/core/logging'
import { paidGrantFile } from '../../../src/runtime/paidGrants'

export function agentDriveDeps(
  folder: string,
  log: CoreLogger,
  backend: AcpAgentDeps['backend'],
  extra?: Pick<AcpAgentDeps, 'subagentAdmission'>,
): AcpAgentDeps {
  return {
    backend,
    version: '0.19.0',
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: {
      id: 'login',
      name: 'Muse Code',
      description: 'Muse Code',
      args: [],
      command: 'muse login',
    },
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
    log,
    questions: 'decline',
    ...extra,
  }
}
