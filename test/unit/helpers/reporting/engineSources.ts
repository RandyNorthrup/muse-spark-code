import type {
  ReportSourceKind,
  ReportSourcePort,
  ReportSourcePorts,
  SourceReadContext,
  SourceSnapshot,
} from '../../../../src/core/reporting/sources/types'

/** All normalized ports, with one controllable wait shared by a generation. */
export function engineSources(snapshot: SourceSnapshot, wait: Promise<void>): ReportSourcePorts {
  function port<K extends ReportSourceKind>(kind: K): ReportSourcePort<K> {
    return {
      kind,
      id: kind,
      async read(context: SourceReadContext) {
        await wait
        const source = snapshot.sources[kind]
        const reason = context.reportText.reportSourceReasons.failed
        if (source.data === null)
          return {
            data: null,
            record: {
              id: kind,
              status: 'unavailable' as const,
              reason,
              observedAt: null,
              freshness: { state: 'unknown' as const, ageMs: null },
            },
          }
        return {
          data: source.data,
          record: { ...source.record, status: 'partial' as const, reason },
        }
      },
    }
  }
  return {
    plan: port('plan'),
    git: port('git'),
    package: port('package'),
    changelog: port('changelog'),
    certification: port('certification'),
    session: port('session'),
    questions: port('questions'),
    usage: port('usage'),
    agentUsage: port('agentUsage'),
    checkRuns: port('checkRuns'),
    github: port('github'),
    stores: port('stores'),
    fleet: port('fleet'),
    security: port('security'),
    accounts: port('accounts'),
    estimate: port('estimate'),
    playbook: port('playbook'),
    issues: port('issues'),
    schedules: port('schedules'),
    keybindings: port('keybindings'),
  }
}
