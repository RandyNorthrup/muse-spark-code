// D214: schema-valid journal records and a journal writer for the report
// ordering tests. Every record parses before it is used, so only shapes the
// journal itself accepts reach the orderer.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { FilePlaybookJournal } from '../../../../src/core/orchestration/playbook/journal'
import {
  playbookModuleSchema,
  playbookRecordSchema,
  type PlaybookRecord,
} from '../../../../src/shared/playbook'

export const orderModule = playbookModuleSchema.parse({
  id: 'store-17',
  key: 'src/core/schedules/store',
  files: ['src/core/schedules/store.ts'],
  source: 'lane',
})

export function orderVerification(result: 'pass' | 'fail', commit = 'abc123'): PlaybookRecord {
  return playbookRecordSchema.parse({
    kind: 'verification',
    value: {
      workId: 'work-1',
      moduleId: orderModule.id,
      commit,
      hookDigest: 'digest-1',
      scope: 'commit',
      result,
      at: 6,
    },
  })
}

export function orderModuleRecord(): PlaybookRecord {
  return playbookRecordSchema.parse({
    kind: 'module',
    value: { module: orderModule, at: 3 },
  })
}

export function orderRoundWithResiduals(
  answers: readonly { name: string; whySafe: string; followUp: string }[],
  at = 8,
): PlaybookRecord {
  return playbookRecordSchema.parse({
    kind: 'round',
    value: {
      module: orderModule,
      implementerId: 'builder',
      reviewerId: 'reviewer',
      implementerSessionId: 'builder-session',
      reviewerSessionId: 'reviewer-session',
      round: 3,
      phase: 'fix',
      at,
      findings: [],
      answers: answers.map((answer, index) => ({
        findingId: `finding-${String(index)}`,
        status: 'residual',
        name: answer.name,
        whySafe: answer.whySafe,
        followUp: answer.followUp,
      })),
    },
  })
}

export function orderResidualAcceptance(input: {
  milestoneId: string
  name: string
  actor?: 'lead' | 'owner'
  reason?: string
  at?: number
  evidence?: { whySafe: string; followUp: string; moduleId: string }
}): PlaybookRecord {
  return playbookRecordSchema.parse({
    kind: 'residual',
    value: {
      milestoneId: input.milestoneId,
      name: input.name,
      status: 'accepted',
      actor: input.actor ?? 'owner',
      reason: input.reason ?? 'Accepted.',
      at: input.at ?? 9,
      ...(input.evidence !== undefined && { evidence: input.evidence }),
    },
  })
}

export function orderDesign(outcome: 'pending' | 'impossible', id = 'design-1'): PlaybookRecord {
  return playbookRecordSchema.parse({
    kind: 'design',
    value: {
      id,
      module: orderModule,
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

export function writeOrderJournal(
  folders: { readonly agentDataFolder: string; readonly workspaceFolder: string },
  records: readonly PlaybookRecord[],
): void {
  const file = new FilePlaybookJournal(folders.agentDataFolder, folders.workspaceFolder).file
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${records.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
}
