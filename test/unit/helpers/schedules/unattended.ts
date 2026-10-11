import { vi } from 'vitest'
import { UnattendedRun, type ScheduleRunDeps } from '../../../../src/core/schedules/unattended'
import { ScheduleGrants } from '../../../../src/core/schedules/grant'
import { fakeRunContext } from './fixtures'

export function unattendedRun(overrides: Partial<ScheduleRunDeps> = {}) {
  const context = fakeRunContext()
  const audit = vi.fn<ScheduleRunDeps['audit']>().mockResolvedValue(undefined)
  const row = vi.fn<ScheduleRunDeps['row']>()
  const deferQuestions = vi.fn<ScheduleRunDeps['deferQuestions']>().mockResolvedValue(undefined)
  const deps: ScheduleRunDeps = {
    context,
    modelText: {
      unattendedNote: 'Scheduled; nobody is watching.',
      approvalRefused: 'Outside grant.',
      physicalRefused: 'Physical refused.',
      protectedRefused: 'Protected refused.',
      requiresAskingRefused: 'Person required.',
      paidRefused: 'Paid refused.',
      questionsDeferred: 'Deferred for later.',
    },
    workspaceRoot: '/workspace',
    platform: 'linux',
    io: { realPath: (path) => Promise.resolve(path) },
    matcher: new ScheduleGrants('bash'),
    now: () => 0,
    readGrant: () => Promise.resolve(overrides.context?.grant ?? context.grant),
    isActive: () => true,
    audit,
    row,
    deferQuestions,
    safety: () => undefined,
    ...overrides,
  }
  return { run: new UnattendedRun(deps), audit, row, deferQuestions }
}
