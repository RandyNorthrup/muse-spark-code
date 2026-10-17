// M113 C-M113-4: the playbook and schedules inputs over real directories,
// through the real journal and store into generated reports.
import { rm, writeFile, readFile } from 'node:fs/promises'
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
import { SCHEDULE_STORE_SUBFOLDER, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { installGerman } from './helpers/germanTable'
import { FakeLogOutputChannel } from './helpers/fakes'
import { reportOptions } from './helpers/reporting/snapshot'
import { sectionById, fireFixture } from './helpers/reporting/reportKindFixtures'
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
  reportText: EN,
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
  it('keeps overlapping German and English generations in their request language', async () => {
    await installGerman(new FakeLogOutputChannel())
    const german = { ...UI_TEXT }
    const workspace = await dir('muse-language-ws-')
    const data = await dir('muse-language-data-')
    const job = scheduleV2Schema.parse(
      scheduleFixture('fixture-workspace', {
        trigger: { kind: 'event', source: 'github', event: 'pullRequestOpened', conditions: [] },
        target: { kind: 'worker', workerId: 'worker-1' },
        delivery: 'steer',
        creator: { kind: 'agent', agentId: 'agent-1', sessionId: 's1', orchestratorId: 'o1' },
      }),
    )
    const suspended = Promise.withResolvers<{
      schedules: readonly unknown[]
      fires: readonly unknown[]
      observedAt: string
    }>()
    const entered = Promise.withResolvers<undefined>()
    const germanServices = createReportingServices({
      workspaceRoot: workspace,
      storageRoot: data,
      // The engine must snapshot even a caller's mutable process-table alias.
      l10n: { table: UI_TEXT, locale: 'de' },
      generatorVersion: 'test',
      keepHistory: false,
      enabledAgents: [],
      schedules: {
        read: () => {
          entered.resolve(undefined)
          return suspended.promise
        },
      },
    })
    const options = reportOptions('schedules')
    const pendingGerman = germanServices.generate!(options)
    await entered.promise
    const englishServices = createReportingServices({
      workspaceRoot: workspace,
      storageRoot: data,
      l10n: { table: EN, locale: 'en' },
      generatorVersion: 'test',
      keepHistory: false,
      enabledAgents: [],
      schedules: {
        read: () =>
          Promise.resolve({
            schedules: [job],
            fires: [fireFixture({ outcome: 'ran' })],
            observedAt: options.asOf,
          }),
      },
    })
    const english = await englishServices.generate!(options)
    suspended.resolve({
      schedules: [job],
      fires: [fireFixture({ outcome: 'ran' })],
      observedAt: options.asOf,
    })
    const deutsch = await pendingGerman
    for (const [result, table] of [
      [english, EN],
      [deutsch, german],
    ] as const) {
      if (result.status !== 'generated') throw new Error('Expected generated report')
      const cells = sectionById(result.document.sections, 'schedules/schedules').rows[0]!.cells
      expect(cells['target']?.value).toBe(`${table.scheduleV2.targets.worker}: worker-1`)
      expect(cells['delivery']?.value).toBe(table.scheduleV2.delivery.steer)
      expect(cells['creator']?.value).toBe(`${table.scheduleV2.labels.creator}: agent-1`)
      expect(cells['trigger']?.value).toBe(
        `${table.scheduleV2.triggers.event}: github:pullRequestOpened`,
      )
      expect(cells['grant']?.value).toBe(
        table.reportScheduleCells.scheduleGrant
          .replace('{rules}', '0')
          .replace('{destinations}', '0')
          .replace('{cap}', '0'),
      )
      expect(
        sectionById(result.document.sections, 'schedules/fires').rows[0]!.cells['outcome']?.value,
      ).toBe(table.scheduleSettlement.outcomes.ran)
      expect(result.document.sources.find((source) => source.id === 'playbook')?.reason).toBe(
        table.reportSourceReasons.disabled,
      )
    }
  })

  it('keeps the lane budget and translated-string sentences aligned with the shipped guards', async () => {
    const plan = await readFile(new URL('../../PLAN.md', import.meta.url), 'utf8')
    const gate = await readFile(
      new URL('../../scripts/check-bundle-size.mjs', import.meta.url),
      'utf8',
    )
    const budget = /path: 'dist\/playbookSchedulesInputs\.js', budgetKiB: (\d+)/.exec(gate)?.[1]
    if (budget === undefined) throw new Error('Expected a reader bundle budget')
    const lane = plan
      .split('**C-M113-4 playbook and schedules kinds', 2)[1]
      ?.split('\nLanes P, S, R and V', 1)[0]
    expect(lane).toContain(`${budget} KiB budget`)
    expect(lane).not.toContain('no new string')
    expect(lane).toContain('`ended` label')
  })

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
