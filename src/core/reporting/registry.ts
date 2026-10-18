import type { ReportKind, ReportLabelKey } from '../../shared/reportSchema'
import type { ReportSourceKind } from './sources/types'

interface ReportKindRegistration {
  readonly sources: readonly ReportSourceKind[]
  readonly sections: readonly ReportLabelKey[]
  readonly collector: string
}

/** Shared kind inventory: collectors and engine certification enumerate the same entries. */
export const REPORT_KIND_REGISTRY = {
  project: {
    sources: ['plan', 'git', 'changelog', 'certification', 'github', 'stores', 'usage'],
    sections: [
      'releases',
      'milestones',
      'lanes',
      'pullRequests',
      'ci',
      'usage',
      'risks',
      'nextSteps',
    ],
    collector: 'repository',
  },
  milestone: {
    sources: ['plan', 'git', 'certification', 'github'],
    sections: [
      'status',
      'dependencies',
      'lanes',
      'certification',
      'gates',
      'residuals',
      'questions',
    ],
    collector: 'plan',
  },
  release: {
    sources: ['plan', 'git', 'changelog', 'github', 'stores'],
    sections: ['releases', 'channels', 'ci'],
    collector: 'repository',
  },
  usage: {
    sources: ['usage', 'agentUsage'],
    sections: ['totals', 'breakdown', 'limits'],
    collector: 'usage',
  },
  session: {
    sources: ['session', 'questions', 'checkRuns'],
    sections: [
      'model',
      'turns',
      'totals',
      'tools',
      'files',
      'approvals',
      'questions',
      'checks',
      'paidUses',
    ],
    collector: 'session',
  },
  changes: {
    sources: ['git', 'changelog', 'github'],
    sections: ['commits', 'files', 'changelog', 'pullRequests'],
    collector: 'repository',
  },
  quality: {
    sources: ['package', 'checkRuns', 'github', 'certification'],
    sections: ['gates', 'checks', 'ci', 'certification'],
    collector: 'quality',
  },
  fleet: {
    sources: ['fleet'],
    sections: ['agents', 'workers', 'devices', 'nodes'],
    collector: 'index',
  },
  security: {
    sources: ['security'],
    sections: ['vault', 'breakdown', 'grants', 'usage', 'denials', 'locks', 'developerAudit'],
    collector: 'security',
  },
  accounts: {
    sources: ['accounts'],
    sections: ['accounts', 'limits', 'usage', 'swaps', 'refusals', 'confirmations'],
    collector: 'accounts',
  },
  estimate: {
    sources: ['estimate'],
    sections: ['totals', 'criticalPath', 'limitingResource', 'setups', 'inputs', 'calibration'],
    collector: 'index',
  },
  playbook: {
    sources: ['playbook'],
    sections: ['totals', 'decisions', 'hookVerification', 'disabledRules', 'refusals'],
    collector: 'index',
  },
  issues: { sources: ['issues'], sections: ['issues', 'limits'], collector: 'index' },
  schedules: {
    sources: ['schedules'],
    sections: ['timeline', 'schedules', 'fires', 'refusals', 'cost'],
    collector: 'index',
  },
  keybindings: {
    sources: ['keybindings'],
    sections: ['keybindings', 'conflicts'],
    collector: 'keybindings',
  },
} as const satisfies Record<ReportKind, ReportKindRegistration>
