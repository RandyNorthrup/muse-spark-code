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
