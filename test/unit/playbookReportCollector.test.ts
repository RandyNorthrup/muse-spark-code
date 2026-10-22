// D214: the M113 collector's playbook ordering. Built rows flag from their
// closed statuses, the orderer replays the journal the report read, and the
// playbook, milestone and fleet kinds go through collectPlaybookReport.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { PlaybookWhyNote } from '../../src/shared/playbook'
import type { ReportSection } from '../../src/shared/reportSchema'
import { createReportCollector } from '../../src/core/reporting/collect'
import {
  label,
  playbookRowReportFlags,
  row,
  section,
  text,
} from '../../src/core/reporting/collect/common'
import {
  isPlaybookReportKind,
  wrapPlaybookSections,
} from '../../src/core/reporting/collect/playbookOrder'
import {
  FilePlaybookJournal,
  PlaybookHistoryLostError,
} from '../../src/core/orchestration/playbook/journal'
import { createPlaybookSurface } from '../../src/runtime/playbook/surface'
import { createReportingServices } from '../../src/runtime/reporting/engine'
import {
  createPlaybookReportOrder,
  createPlaybookReportReader,
} from '../../src/runtime/reporting/playbookSchedulesInputs'
import { EN } from '../../src/shared/l10n/en'
import {
  availableSource,
  buildSourceSnapshot,
  changeSelections,
  fixtureFinalize,
  fullSnapshot,
  reportOptions,
} from './helpers/reporting/kindFixtures'
import { scratchFolders } from './helpers/playbook/scratchFolders'
import {
  orderDesign,
  orderModuleRecord,
  orderVerification,
  writeOrderJournal,
} from './helpers/playbook/journalRecords'

function orderer() {
  const { workspaceFolder, agentDataFolder } = scratchFolders('m116w-report-collect-')
  return {
    folders: { workspaceFolder, agentDataFolder },
    order: createPlaybookReportOrder({ agentDataFolder, workspaceRoot: workspaceFolder }),
  }
}

function flagged(cells: Parameters<typeof row>[2]) {
  return playbookRowReportFlags(row('k', ['x'], cells, ['playbook']))
}

function drillsSection(): ReportSection {
  return section(
    'playbook/drills',
    'hookVerification',
    [
      { key: 'name', label: 'name' },
      { key: 'result', label: 'outcome' },
    ],
    [
      row('drill', ['aaa'], { name: text('aaa'), result: text('pass') }, ['playbook']),
      row('drill', ['zzz'], { name: text('zzz'), result: text('fail') }, ['playbook']),
      row('drill', ['mmm'], { name: text('mmm'), result: text('pass') }, ['playbook']),
    ],
    { full: true },
  )
}

describe('D214 collector playbook ordering', () => {
  it('flags rows from label cells, failing on failed only', () => {
    expect(flagged({ status: label('failed') })).toEqual({ needsUser: false, failing: true })
    expect(flagged({ status: label('open') })).toEqual({ needsUser: true, failing: false })
    expect(flagged({ status: label('blocked') })).toEqual({ needsUser: true, failing: false })
    expect(flagged({ status: label('needsYou') })).toEqual({ needsUser: true, failing: false })
    for (const value of ['ok', 'complete', 'unknown', 'unavailable', 'partial'] as const)
      expect(flagged({ status: label(value) })).toEqual({ needsUser: false, failing: false })
  })

  it('reads the playbook kind text statuses in their own columns only', () => {
    expect(flagged({ result: text('fail') })).toEqual({ needsUser: false, failing: true })
    expect(flagged({ result: text('pass') })).toEqual({ needsUser: false, failing: false })
    expect(flagged({ outcome: text('pending') })).toEqual({ needsUser: true, failing: false })
    expect(flagged({ outcome: text('remains') })).toEqual({ needsUser: true, failing: false })
    expect(flagged({ outcome: text('impossible') })).toEqual({ needsUser: false, failing: false })
    // The same words outside a status column flag nothing.
    expect(flagged({ name: text('fail') })).toEqual({ needsUser: false, failing: false })
    expect(flagged({ name: text('pending') })).toEqual({ needsUser: false, failing: false })
  })

  it('orders a fresh journal by default and passes through once loudFailures is off', async () => {
    const { folders, order } = orderer()
    expect(order.getRecord()).toEqual([])
    const items = [
      { id: 'info', needsUser: false, failing: false },
      { id: 'failure', needsUser: false, failing: true },
    ]
    expect(order.orderReport(items).items.map((item) => item.id)).toEqual(['failure', 'info'])
    expect(order.orderReport(items).note).toMatchObject({
      rule: 'loudFailures',
      code: 'ownerFirst',
    })
    const surface = createPlaybookSurface({ ...folders, teamId: 'panel', laneId: 'surface' })
    await surface.change({ rule: 'loudFailures', enabled: false, reason: 'Owner decision.' })
    const passed = order.orderReport(items)
    expect(passed.items.map((item) => item.id)).toEqual(['info', 'failure'])
    expect(passed.note).toMatchObject({ rule: 'loudFailures', code: 'ruleDisabled' })
    const stored = order.getRecord()
    expect(stored.map((entry) => entry.kind)).toEqual(['settings', 'note'])
    const settings = stored[0]
    if (settings?.kind !== 'settings') throw new Error('The journal must hold the switch-off')
    expect(settings.value.rules.loudFailures).toMatchObject({ enabled: false })
  })

  it('refuses a corrupt journal with fixed words and a lost one as lost', async () => {
    const corrupt = orderer()
    const file = new FilePlaybookJournal(
      corrupt.folders.agentDataFolder,
      corrupt.folders.workspaceFolder,
    ).file
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, 'not jsonl\n')
    expect(() => corrupt.order.orderReport([])).toThrow(new Error(UI_TEXT.playbookUnavailable))
    expect(() => corrupt.order.getRecord()).toThrow(new Error(UI_TEXT.playbookUnavailable))
    // A marker without its lines is lost history, never an empty success.
    const lost = orderer()
    const lostFile = new FilePlaybookJournal(
      lost.folders.agentDataFolder,
      lost.folders.workspaceFolder,
    ).file
    const surface = createPlaybookSurface({ ...lost.folders, teamId: 'panel', laneId: 'surface' })
    await surface.change({ rule: 'offload', enabled: false, reason: 'Owner decision.' })
    rmSync(lostFile)
    expect(() => lost.order.orderReport([])).toThrow(PlaybookHistoryLostError)
  })

  it('orders sections owner-first through the seam, prefixing keys by bucket', () => {
    const { order } = orderer()
    const notes: PlaybookWhyNote[] = []
    const sections = wrapPlaybookSections(order, 'playbook', [drillsSection()], (note) => {
      notes.push(note)
    })
    const rows = sections[0]?.rows ?? []
    expect(rows.map((cell) => cell.cells['name'])).toEqual([
      { type: 'text', value: 'zzz' },
      { type: 'text', value: 'aaa' },
      { type: 'text', value: 'mmm' },
    ])
    // The bucket prefix makes the canonical key sort the severity order.
    expect(rows.map((entry) => entry.key.slice(0, 2))).toEqual(['1/', '2/', '2/'])
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ rule: 'loudFailures', code: 'ownerFirst' })
  })

  it('leaves sections untouched without an orderer and refuses duplicate keys', () => {
    const input = [drillsSection()]
    const untouched = wrapPlaybookSections(undefined, 'playbook', input, () => {
      throw new Error('showNote must not run unbound')
    })
    expect(untouched).toHaveLength(1)
    expect(untouched[0]).toBe(input[0])
    const { order } = orderer()
    const duplicate = drillsSection()
    const first = duplicate.rows[0]
    if (first === undefined) throw new Error('The drills fixture must hold a row')
    const rows = [...duplicate.rows, first]
    const seen: PlaybookWhyNote[] = []
    expect(() =>
      wrapPlaybookSections(order, 'playbook', [{ ...duplicate, rows }], (note) => {
        seen.push(note)
      }),
    ).toThrow(new Error(UI_TEXT.playbookUnavailable))
    expect(seen).toHaveLength(0)
  })

  it('gates the seam to the playbook, milestone and fleet kinds', () => {
    expect(isPlaybookReportKind('playbook')).toBe(true)
    expect(isPlaybookReportKind('milestone')).toBe(true)
    expect(isPlaybookReportKind('fleet')).toBe(true)
    expect(isPlaybookReportKind('project')).toBe(false)
    expect(isPlaybookReportKind('session')).toBe(false)
    expect(isPlaybookReportKind('estimate')).toBe(false)
  })

  it('collects the playbook kind failures-first with one note for the report', () => {
    const { order } = orderer()
    const notes: PlaybookWhyNote[] = []
    const collector = createReportCollector({
      finalize: fixtureFinalize,
      nextStepLimit: 3,
      selections: changeSelections(),
      playbookOrder: order,
      playbookNote: (note) => {
        notes.push(note)
      },
    })
    const snapshot = fullSnapshot()
    snapshot.sources.playbook = availableSource('playbook', [
      drillsSection(),
      section(
        'playbook/refusals',
        'refusals',
        ['name'],
        [row('refusal', ['r1'], { name: text('r1') }, ['playbook'])],
        { full: true },
      ),
    ])
    const document = collector(snapshot, reportOptions('playbook'))
    const drills = document.sections.find((entry) => entry.id === 'playbook/drills')
    expect(drills?.rows.map((entry) => entry.cells['name'])).toEqual([
      { type: 'text', value: 'zzz' },
      { type: 'text', value: 'aaa' },
      { type: 'text', value: 'mmm' },
    ])
    // Two sections plus Needs-you order through one policy: one note.
    expect(notes).toHaveLength(1)
    expect(document.needsYou.rows.length).toBeGreaterThan(0)
  })

  it('collects the milestone kind with open checklist items first', () => {
    const { order } = orderer()
    const collector = createReportCollector({
      finalize: fixtureFinalize,
      nextStepLimit: 3,
      selections: changeSelections(),
      playbookOrder: order,
    })
    const document = collector(fullSnapshot(), reportOptions('milestone', { scope: 'M12' }))
    const checklist = document.sections.find((entry) => entry.id === 'checklist')
    expect(checklist?.rows.map((entry) => entry.cells['name'])).toEqual([
      { type: 'text', value: 'A certified renderer' },
      { type: 'text', value: 'A captured fixture' },
    ])
    // The bucket prefixes prove the seam ran, not key order by luck.
    expect(checklist?.rows.map((entry) => entry.key.slice(0, 2))).toEqual(['0/', '2/'])
  })

  it('collects the fleet kind unbound with empty sections and one note', () => {
    const { order } = orderer()
    const seen: PlaybookWhyNote[] = []
    const collector = createReportCollector({
      finalize: fixtureFinalize,
      nextStepLimit: 3,
      selections: changeSelections(),
      playbookOrder: order,
      playbookNote: (note) => {
        seen.push(note)
      },
    })
    const snapshot = buildSourceSnapshot()
    const document = collector(snapshot, reportOptions('fleet'))
    // No fleet source yet: the registry headings stand empty, and the seam
    // runs vacuous over them; the one note still fires for the report.
    expect(document.sections.map((entry) => entry.id)).toEqual([
      'fleet/agents',
      'fleet/devices',
      'fleet/nodes',
      'fleet/workers',
      'planFormat',
    ])
    for (const entry of document.sections)
      if (entry.id !== 'planFormat')
        for (const found of entry.rows)
          expect(playbookRowReportFlags(found)).toEqual({ needsUser: false, failing: false })
    expect(document.needsYou.rows).toHaveLength(0)
    expect(seen).toHaveLength(1)
  })

  it('generates the playbook kind failures-first from a real journal', async () => {
    const { workspaceFolder, agentDataFolder } = scratchFolders('m116w-report-engine-')
    writeOrderJournal({ agentDataFolder, workspaceFolder }, [
      orderModuleRecord(),
      orderVerification('pass', 'aaa'),
      orderVerification('fail', 'zzz'),
      orderDesign('impossible', 'design-a'),
      orderDesign('pending', 'design-b'),
    ])
    const notes: PlaybookWhyNote[] = []
    const engine = createReportingServices({
      workspaceRoot: workspaceFolder,
      storageRoot: path.join(agentDataFolder, 'reports'),
      l10n: { table: EN, locale: 'en' },
      generatorVersion: 'test',
      keepHistory: false,
      enabledAgents: [],
      playbook: createPlaybookReportReader({ agentDataFolder, workspaceRoot: workspaceFolder }),
      playbookOrder: createPlaybookReportOrder({ agentDataFolder, workspaceRoot: workspaceFolder }),
      playbookNote: (note) => {
        notes.push(note)
      },
    })
    const result = await engine.generate?.({
      kind: 'playbook',
      scope: 'fixture',
      full: true,
      network: false,
      failOn: [],
      asOf: '2026-10-22T00:00:00.000Z',
    })
    expect(result?.status).toBe('generated')
    if (result?.status !== 'generated') throw new Error('The playbook report must generate')
    const drills = result.document.sections.find((entry) => entry.id === 'playbook/drills')
    expect(drills?.rows.map((entry) => entry.cells['name'])).toEqual([
      { type: 'text', value: 'zzz' },
      { type: 'text', value: 'aaa' },
    ])
    const decisions = result.document.sections.find((entry) => entry.id === 'playbook/decisions')
    expect(decisions?.rows.map((entry) => entry.cells['outcome'])).toEqual([
      { type: 'text', value: 'pending' },
      { type: 'text', value: 'impossible' },
    ])
    expect(notes).toHaveLength(1)
  })
})
