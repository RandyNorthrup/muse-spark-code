// D214: the one report ordering. The shared comparator and the record flags
// below are the only ordering criteria: the policy's orderReport and every
// record/text presentation (CLI, ACP, the panel's rows) derive from them.
import { describe, expect, it } from 'vitest'
import { PLAYBOOK_INFORMATIONAL_NOTE_CODES } from '../../src/shared/constants'
import {
  comparePlaybookReportItems,
  defaultPlaybookSettings,
  playbookModuleSchema,
  playbookRecordReportFlags,
  playbookRecordSchema,
  type PlaybookRecord,
} from '../../src/shared/playbook'
import { createFileJournalPolicy } from '../../src/core/orchestration/playbook/policy'
import { createPlaybookSurface } from '../../src/runtime/playbook/surface'
import { orderedPlaybookRecords } from '../../src/runtime/playbook/text'
import { scratchFolders } from './helpers/playbook/scratchFolders'

const module = playbookModuleSchema.parse({
  id: 'store-17',
  key: 'src/core/schedules/store',
  files: ['src/core/schedules/store.ts'],
  source: 'lane',
})

function record(value: unknown): PlaybookRecord {
  return playbookRecordSchema.parse(value)
}

const infoNote = record({
  kind: 'note',
  value: { rule: 'onePassReview', code: 'checksPassed', at: 1, needsUser: false },
})
const refusalNote = record({
  kind: 'note',
  value: {
    rule: 'threeStrikes',
    code: 'redesignRequired',
    module: module.key,
    round: 3,
    classes: ['concurrency'],
    at: 2,
    needsUser: false,
  },
})
const ownerNote = record({
  kind: 'note',
  value: { rule: 'neverAround', code: 'classifierBlocked', at: 3, needsUser: true },
})
function design(outcome: 'pending' | 'impossible'): PlaybookRecord {
  return record({
    kind: 'design',
    value: {
      id: 'design-1',
      module,
      failureClass: 'Racy claim.',
      whyPatchesFailed: 'Two rounds failed.',
      structuralChange: 'Split the module.',
      planLocation: 'src/core/schedules/store.ts',
      redesignLane: 'lane-1',
      outcome,
      at: 4,
    },
  })
}
function round(hasFindings: boolean): PlaybookRecord {
  return record({
    kind: 'round',
    value: {
      module,
      implementerId: 'builder',
      reviewerId: 'reviewer',
      implementerSessionId: 'builder-session',
      reviewerSessionId: 'reviewer-session',
      round: 3,
      phase: 'fix',
      at: 5,
      findings: hasFindings
        ? [{ id: 'racy-claim', file: module.files[0] ?? '', severity: 'P1', class: 'concurrency' }]
        : [],
      answers: [],
    },
  })
}
const settingsRecord = record({
  kind: 'settings',
  value: defaultPlaybookSettings('panel'),
})

describe('D214 one report ordering', () => {
  it('pins the informational note codes the ordering shares', () => {
    expect([...PLAYBOOK_INFORMATIONAL_NOTE_CODES]).toEqual([
      'checksPassed',
      'reordered',
      'offloaded',
      'localCheck',
      'ciGate',
      'ownerFirst',
      'ruleDisabled',
      'briefRecorded',
    ])
  })

  it('sorts owner rows first, then failures, keeping ties stable', () => {
    const items = [
      { id: 'info', needsUser: false, failing: false },
      { id: 'failure', needsUser: false, failing: true },
      { id: 'owner', needsUser: true, failing: false },
      { id: 'owner-failing', needsUser: true, failing: true },
      { id: 'info-second', needsUser: false, failing: false },
    ]
    const sorted = items.toSorted(comparePlaybookReportItems)
    expect(sorted.map((item) => item.id)).toEqual([
      'owner-failing',
      'owner',
      'failure',
      'info',
      'info-second',
    ])
  })

  it('flags notes by needsUser first, then by refusal codes', () => {
    expect(playbookRecordReportFlags(ownerNote)).toEqual({ needsUser: true, failing: false })
    expect(playbookRecordReportFlags(refusalNote)).toEqual({ needsUser: false, failing: true })
    expect(playbookRecordReportFlags(infoNote)).toEqual({ needsUser: false, failing: false })
  })

  it('flags unresolved designs for the owner and closed ones as informational', () => {
    expect(playbookRecordReportFlags(design('pending'))).toEqual({
      needsUser: true,
      failing: false,
    })
    expect(playbookRecordReportFlags(design('impossible'))).toEqual({
      needsUser: false,
      failing: false,
    })
  })

  it('flags rounds with findings as failing and clean rounds as informational', () => {
    expect(playbookRecordReportFlags(round(true))).toEqual({ needsUser: false, failing: true })
    expect(playbookRecordReportFlags(round(false))).toEqual({ needsUser: false, failing: false })
  })

  it('flags every other record kind as informational', () => {
    expect(playbookRecordReportFlags(settingsRecord)).toEqual({
      needsUser: false,
      failing: false,
    })
  })

  it('orders records owner-first through the shared ordering, counters last', () => {
    // Deliberately progress-first input: the presentation must reorder it.
    const pending = design('pending')
    const input = [
      settingsRecord,
      infoNote,
      round(true),
      refusalNote,
      pending,
      ownerNote,
      design('impossible'),
      { kind: 'counter' as const },
    ]
    const ordered = orderedPlaybookRecords(input)
    expect(ordered.map((entry) => (entry.kind === 'counter' ? 'counter' : entry.kind))).toEqual([
      'design',
      'note',
      'round',
      'note',
      'settings',
      'note',
      'design',
      'counter',
    ])
    expect(ordered[0]).toBe(pending)
    expect(ordered[1]).toBe(ownerNote)
  })

  it('orders report items through the policy when loudFailures is on', async () => {
    const { workspaceFolder, agentDataFolder } = scratchFolders('m116w-report-order-')
    // Fail-closed read ports, each mirroring a real panel/governor port: the
    // ordering path grants no effect, so every effect refuses here.
    const policy = createFileJournalPolicy(
      { agentDataFolder, workspaceFolder, teamId: 'panel', laneId: 'surface' },
      {
        authorizeOverride: () => false,
        drillRequirements: { guards: () => [] },
        checkAdmission: { admit: () => false },
        hookAdmission: { admit: () => false },
      },
    )
    const items = [
      { id: 'info', needsUser: false, failing: false },
      { id: 'failure', needsUser: false, failing: true },
      { id: 'owner', needsUser: true, failing: false },
    ]
    // loudFailures ships on: owner rows first, then failures.
    const ordered = policy.orderReport(items)
    expect(ordered.items.map((item) => item.id)).toEqual(['owner', 'failure', 'info'])
    expect(ordered.note).toMatchObject({ rule: 'loudFailures', code: 'ownerFirst' })
    // The person's own surface turns the rule off; the same policy then
    // passes rows through untouched.
    const surface = createPlaybookSurface({
      agentDataFolder,
      workspaceFolder,
      teamId: 'panel',
      laneId: 'surface',
    })
    await surface.change({ rule: 'loudFailures', enabled: false, reason: 'Owner decision.' })
    const passed = policy.orderReport(items)
    expect(passed.items.map((item) => item.id)).toEqual(['info', 'failure', 'owner'])
    expect(passed.note).toMatchObject({ rule: 'loudFailures', code: 'ruleDisabled' })
  })
})
