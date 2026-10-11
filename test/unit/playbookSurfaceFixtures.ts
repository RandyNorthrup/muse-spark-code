// Fake-only U fixtures, also mounted by the browser harness.
import {
  defaultPlaybookSettings,
  playbookModuleSchema,
  type PlaybookRecord,
  type PlaybookWhyNote,
} from '../../src/shared/playbook'
import {
  changedPlaybookSettings,
  type PlaybookSurfacePort,
  type PlaybookSnapshot,
} from '../../src/runtime/playbook/command'

export const surfaceModule = playbookModuleSchema.parse({
  id: 'store-17',
  key: 'src/core/schedules/store',
  files: ['src/core/schedules/store.ts'],
  source: 'lane',
})

/** Deliberately progress-first input: every presentation must reorder it. */
export function surfacePriorityNotes(): PlaybookWhyNote[] {
  return [
    { rule: 'onePassReview', code: 'checksPassed', at: 0, needsUser: false },
    {
      rule: 'threeStrikes',
      code: 'redesignRequired',
      module: surfaceModule.key,
      round: 3,
      classes: ['concurrency'],
      at: 1,
      needsUser: false,
    },
    { rule: 'neverAround', code: 'classifierBlocked', at: 2, needsUser: true },
  ]
}
export function surfaceUnboundAcceptance(): PlaybookRecord {
  return {
    kind: 'residual',
    value: {
      milestoneId: 'M116',
      name: 'legacy-follow-up',
      status: 'accepted',
      actor: 'owner',
      reason: 'Legacy decision',
      at: 100,
    },
  }
}

export function surfaceRound(
  round = 3,
  findingClass?: 'concurrency',
): Extract<PlaybookRecord, { kind: 'round' }> {
  return {
    kind: 'round',
    value: {
      module: surfaceModule,
      implementerId: 'builder',
      reviewerId: 'reviewer',
      implementerSessionId: 'builder-session',
      reviewerSessionId: 'reviewer-session',
      class: findingClass,
      round,
      phase: 'fix',
      at: 1_791_289_800_000,
      findings: [
        {
          id: 'racy-claim',
          file: surfaceModule.files[0] ?? '',
          severity: 'P1',
          class: 'concurrency',
        },
      ],
      answers: [],
    },
  }
}
export function surfaceSnapshot(): PlaybookSnapshot {
  return {
    settings: defaultPlaybookSettings('workspace-panel'),
    records: [
      surfaceRound(3),
      surfaceRound(3, 'concurrency'),
      {
        kind: 'note',
        value: {
          rule: 'threeStrikes',
          code: 'redesignRequired',
          module: surfaceModule.key,
          round: 3,
          classes: ['concurrency'],
          at: 1_791_289_800_000,
          needsUser: false,
        },
      },
      {
        kind: 'design',
        value: {
          id: 'D96-store',
          module: surfaceModule,
          class: 'concurrency',
          failureClass: 'multi-step claims',
          whyPatchesFailed: 'the interleaving remains',
          structuralChange: 'an atomic claim',
          planLocation: 'PLAN.md D96',
          redesignLane: 'redesign-store',
          outcome: 'caught',
          at: 1_791_289_800_000,
        },
      },
      {
        kind: 'note',
        value: {
          rule: 'neverAround',
          code: 'classifierBlocked',
          at: 1_791_289_800_001,
          needsUser: true,
        },
      },
    ],
  }
}
export function surfacePort(
  initial = surfaceSnapshot(),
): PlaybookSurfacePort & { snapshot(): PlaybookSnapshot } {
  let snapshot = structuredClone(initial)
  return {
    snapshot: () => structuredClone(snapshot),
    read: () => Promise.resolve(structuredClone(snapshot)),
    change: (change) => {
      const settings = changedPlaybookSettings(
        snapshot.settings,
        change,
        'owner',
        1_791_289_800_002,
      )
      snapshot = { settings, records: [...snapshot.records, { kind: 'settings', value: settings }] }
      return Promise.resolve(structuredClone(snapshot))
    },
  }
}
