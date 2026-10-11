// M113 C-M113-4: the playbook and schedules inputs over real directories,
// through the real journal and store into generated reports.
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FilePlaybookJournal } from '../../src/core/orchestration/playbook/journal'
import { createScheduleStore } from '../../src/core/schedules/store'
import { playbookRecordSchema } from '../../src/shared/playbook'
import { createReportingServices } from '../../src/runtime/reporting/engine'
import {
  createPlaybookReportReader,
  createSchedulesReportReader,
} from '../../src/runtime/reporting/playbookSchedulesInputs'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { SCHEDULE_STORE_SUBFOLDER } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { scheduleV2Schema } from '../../src/shared/scheduleV2'
import { removeFolder, temporaryDir } from './helpers/temporaryFolders'
import { playbookModuleFixture, scheduleFixture } from './helpers/reporting/reportKindFixtures'
import { REPORT_FIXTURE_AS_OF } from './helpers/reporting/snapshot'

setUiText(EN, 'en')

const roots: string[] = []
afterEach(async () => {
  setUiText(EN, 'en')
  for (const root of roots.splice(0)) await removeFolder(root)
})
async function dir(prefix: string): Promise<string> {
  const root = await temporaryDir(prefix)
  roots.push(root)
  return root
}

const moduleLine = { kind: 'module', value: { module: playbookModuleFixture(), at: 1000 } }
const context = (kind: 'playbook' | 'schedules') => ({
  asOf: REPORT_FIXTURE_AS_OF,
  workspaceKey: 'fixture',
  options: {
    kind,
    scope: 'fixture',
    full: false,
    network: false,
    failOn: [],
    asOf: REPORT_FIXTURE_AS_OF,
  },
  signal: new AbortController().signal,
})

function schedule(key: string) {
  return scheduleV2Schema.parse(scheduleFixture(key))
}

describe('playbook and schedules inputs', () => {
  it('reads an empty journal and store on a fresh workspace', async () => {
    const data = await dir('muse-playbook-empty-')
    const workspace = await dir('muse-playbook-ws-')
    const playbook = await createPlaybookReportReader({
      agentDataFolder: data,
      workspaceRoot: workspace,
    }).read(context('playbook'))
    expect(playbook.records).toEqual([])
    expect(playbook.observedAt).toBe(REPORT_FIXTURE_AS_OF)
    const key = workspaceKey(path.resolve(workspace))
    const schedules = await createSchedulesReportReader({
      storeRoot: path.join(data, SCHEDULE_STORE_SUBFOLDER),
      workspaceKey: key,
    }).read(context('schedules'))
    expect(schedules.schedules).toEqual([])
    expect(schedules.fires).toEqual([])
  })

  it('reads journal lines written by the orchestrator file', async () => {
    const data = await dir('muse-playbook-lines-')
    const workspace = await dir('muse-playbook-ws-')
    const journal = new FilePlaybookJournal(data, workspace)
    const record = playbookRecordSchema.parse(moduleLine)
    journal.replace([record], [])
    const read = await createPlaybookReportReader({
      agentDataFolder: data,
      workspaceRoot: workspace,
    }).read(context('playbook'))
    expect(read.records).toEqual([structuredClone(record)])
  })

  it('fails lost history and malformed lines instead of an empty success', async () => {
    const data = await dir('muse-playbook-lost-')
    const workspace = await dir('muse-playbook-ws-')
    const journal = new FilePlaybookJournal(data, workspace)
    journal.replace([playbookRecordSchema.parse(moduleLine)], [])
    await rm(journal.file, { force: true })
    const reader = () =>
      createPlaybookReportReader({ agentDataFolder: data, workspaceRoot: workspace }).read(
        context('playbook'),
      )
    await expect(reader()).rejects.toMatchObject({ isLocalSourceError: true, code: 'failed' })
    await writeFile(journal.file, 'not json\n', 'utf8')
    await expect(reader()).rejects.toMatchObject({ isLocalSourceError: true, code: 'invalid' })
  })

  it('lists schedules created through the production store', async () => {
    const data = await dir('muse-schedules-store-')
    const workspace = await dir('muse-schedules-ws-')
    const key = workspaceKey(path.resolve(workspace))
    const storeRoot = path.join(data, SCHEDULE_STORE_SUBFOLDER)
    await createScheduleStore(createNodeScheduleFs(storeRoot)).create(schedule(key))
    const read = await createSchedulesReportReader({ storeRoot, workspaceKey: key }).read(
      context('schedules'),
    )
    expect(read.schedules).toHaveLength(1)
    expect(read.fires).toEqual([])
  })

  it('generates playbook and schedules reports end to end', async () => {
    const data = await dir('muse-reports-data-')
    const workspace = await dir('muse-reports-ws-')
    const journal = new FilePlaybookJournal(data, workspace)
    journal.replace([playbookRecordSchema.parse(moduleLine)], [])
    const key = workspaceKey(path.resolve(workspace))
    const storeRoot = path.join(data, SCHEDULE_STORE_SUBFOLDER)
    await createScheduleStore(createNodeScheduleFs(storeRoot)).create(schedule(key))
    const services = createReportingServices({
      workspaceRoot: workspace,
      storageRoot: path.join(data, 'reports'),
      l10n: { table: EN, locale: 'en' },
      generatorVersion: 'test',
      keepHistory: false,
      enabledAgents: [],
      playbook: createPlaybookReportReader({ agentDataFolder: data, workspaceRoot: workspace }),
      schedules: createSchedulesReportReader({ storeRoot, workspaceKey: key }),
    })
    for (const kind of ['playbook', 'schedules'] as const) {
      const result = await services.generate?.({
        kind,
        scope: 'fixture',
        full: false,
        network: false,
        failOn: [],
        asOf: REPORT_FIXTURE_AS_OF,
      })
      if (result?.status !== 'generated') throw new Error(`Expected a ${kind} report`)
      expect(result.document.sources.find((source) => source.id === kind)?.status).toBe('ok')
    }
    const playbook = await services.generate?.({
      kind: 'playbook',
      scope: 'fixture',
      full: false,
      network: false,
      failOn: [],
      asOf: REPORT_FIXTURE_AS_OF,
    })
    if (playbook?.status !== 'generated') throw new Error('Expected a playbook report')
    // Forwarded sections emit in stable id order, with the plan format last.
    expect(playbook.document.sections.map((section) => section.id)).toEqual([
      'playbook/decisions',
      'playbook/disabledRules',
      'playbook/drills',
      'playbook/refusals',
      'playbook/totals',
      'planFormat',
    ])
    expect(
      playbook.document.sources.find((source) => source.id === 'playbook')?.freshness.state,
    ).toBe('fresh')
  })
})
