// The keybindings report kind end to end (M113 C-M113-5, D93.4): the
// installed manifest's editor bindings plus the panel's gestures and ACP's
// static local commands, with conflicts flagged. The real-manifest cases pin
// the shipped defaults; a new default binding or clash fails here on purpose.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { REPORT_SECTION_ROWS } from '../../src/shared/constants'
import { reportSectionSchema, type ReportSection } from '../../src/shared/reportSchema'
import { LocalSourceError } from '../../src/core/reporting/sources/local'
import {
  ACP_COMMAND_NAMES,
  keybindingsFacts,
  keybindingsSource,
} from '../../src/core/reporting/sources/keybindings'
import { collectKeybindingSections } from '../../src/core/reporting/collect/keybindings'
import { keybindingsManifestReader } from '../../src/runtime/reporting/reportInputs'
import { createReportingEngine } from '../../src/runtime/reporting/engine'
import { reportWorkspaceKey } from '../../src/core/reporting/sources/local'
import { REPORT_AS_OF } from './helpers/reporting/runtime'
import { availableSource, buildSourceSnapshot, reportOptions } from './helpers/reporting/snapshot'
import { REPORT_FIXTURE_AS_OF } from './helpers/reporting/snapshot'
import { fixtureCollector } from './helpers/reporting/collect'
import { referenceKeyboardActions } from '../../src/shared/keybindings'
import manifest from '../../package.json'

// Report storage's own-process identity probe and Git metadata are bounded OS
// commands; the governed admission is proved by spawnGovernance, and here the
// fixture command stands in, as in reportEngine.test.ts.
vi.mock('../../src/core/resources/launcher', async (original) => {
  const { withFixtureCommand } = await import('./helpers/resources/fixtureLaunch')
  return withFixtureCommand(await original())
})

const context = () => ({
  asOf: REPORT_FIXTURE_AS_OF,
  workspaceKey: 'fixture',
  options: reportOptions('keybindings'),
  signal: new AbortController().signal,
})

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function readManifestError(reader: () => unknown): unknown {
  try {
    reader()
  } catch (error) {
    return error
  }
  throw new Error('Expected the manifest read to fail')
}

function cells(section: ReportSection, command: string, scope: string) {
  return section.rows
    .filter(
      (entry) =>
        entry.cells['command']?.type === 'text' &&
        entry.cells['command'].value === command &&
        entry.cells['scope']?.type === 'text' &&
        entry.cells['scope'].value === scope,
    )
    .map((entry) => entry.cells['shortcut'])
}

/** Editor scopes carry the platform plus the binding's `when`, when it has one. */
function editorCells(section: ReportSection, command: string, platform: string) {
  return section.rows
    .filter(
      (entry) =>
        entry.cells['command']?.type === 'text' &&
        entry.cells['command'].value === command &&
        entry.cells['scope']?.type === 'text' &&
        (entry.cells['scope'].value === `editor/${platform}` ||
          entry.cells['scope'].value.startsWith(`editor/${platform} (`)),
    )
    .map((entry) => entry.cells['shortcut'])
}

describe('keybindings report facts', () => {
  it('lists every installed editor binding on every platform with its scope', async () => {
    const result = await keybindingsSource(() => manifest).read(context())
    expect(result.record.status).toBe('ok')
    const sections = result.data ?? []
    expect(sections.map((section) => section.id)).toEqual([
      'keybindings/keybindings',
      'keybindings/conflicts',
    ])
    for (const section of sections) expect(() => reportSectionSchema.parse(section)).not.toThrow()
    const bindings = sections[0]!
    const declared = manifest.contributes.keybindings.length
    expect(declared).toBeGreaterThan(0)
    for (const entry of manifest.contributes.keybindings) {
      expect(editorCells(bindings, entry.command, 'linux')).toHaveLength(1)
      expect(editorCells(bindings, entry.command, 'macos')).toHaveLength(1)
      expect(editorCells(bindings, entry.command, 'windows')).toHaveLength(1)
    }
    // Spot checks against the manifest's own chords, per platform.
    expect(cells(bindings, 'museSpark.focusInput', 'editor/linux')).toEqual([
      { type: 'text', value: 'ctrl+escape' },
    ])
    expect(cells(bindings, 'museSpark.focusInput', 'editor/macos')).toEqual([
      { type: 'text', value: 'cmd+escape' },
    ])
    expect(cells(bindings, 'museSpark.focusInput', 'editor/windows')).toEqual([
      { type: 'text', value: 'ctrl+alt+escape' },
    ])
    // The panel's gestures and ACP's static locals ride the same section.
    expect(
      bindings.rows.some(
        (entry) =>
          entry.cells['command']?.type === 'text' &&
          entry.cells['command'].value === 'composer.send' &&
          entry.cells['scope']?.type === 'text' &&
          entry.cells['scope'].value === 'panel',
      ),
    ).toBe(true)
    expect(
      bindings.rows.filter(
        (entry) => entry.cells['scope']?.type === 'text' && entry.cells['scope'].value === 'acp',
      ),
    ).toHaveLength(ACP_COMMAND_NAMES.length)
    expect(cells(bindings, 'report', 'acp')).toEqual([{ type: 'text', value: '/report' }])
    // The shipped defaults are conflict-free; a new default clash fails here
    // on purpose so its section and reason are reviewed.
    expect(sections[1]!.rows).toEqual([])
  })

  it('lists built-in targets and refuses empty or misshapen bindings', async () => {
    const base = {
      contributes: {
        commands: [{ command: 'museSpark.focusInput' }],
        keybindings: [
          { command: 'museSpark.focusInput', key: 'ctrl+escape' },
          { command: 'editor.action.inlineSuggest.trigger', key: 'alt+\\' },
        ],
      },
    }
    const valid = await keybindingsSource(() => base).read(context())
    expect(valid.record.status).toBe('ok')
    // Two bindings on three platforms, every panel gesture, every ACP local.
    expect(valid.data?.[0]?.rows).toHaveLength(
      2 * 3 + referenceKeyboardActions().length + ACP_COMMAND_NAMES.length,
    )
    expect(valid.data?.[1]?.rows).toEqual([])
    expect(cells(valid.data![0]!, 'editor.action.inlineSuggest.trigger', 'editor/linux')).toEqual([
      { type: 'text', value: 'alt+\\' },
    ])
    for (const broken of [
      {},
      { contributes: {} },
      { contributes: { commands: [], keybindings: [{ command: 'x', key: 42 }] } },
      { contributes: { commands: [], keybindings: 'nope' } },
      {
        contributes: {
          commands: [{ command: 'museSpark.focusInput' }],
          keybindings: [{ command: 'museSpark.focusInput', key: '' }],
        },
      },
      {
        contributes: {
          commands: [{ command: 'museSpark.focusInput' }],
          keybindings: [{ key: 'ctrl+escape' }],
        },
      },
    ]) {
      const result = await keybindingsSource(() => broken).read(context())
      expect(result.record.status).toBe('unavailable')
      expect(result.data).toBeNull()
    }
  })

  it('flags same-chord same-when editor bindings and nothing else', () => {
    const editor = [
      { command: 'a.first', key: 'Ctrl+K' },
      { command: 'b.second', key: 'ctrl+k' },
      { command: 'c.scoped', key: 'ctrl+k', when: 'editorTextFocus' },
      { command: 'd.other', key: 'ctrl+k', when: 'terminalFocus' },
    ]
    // The same clash on all three platforms is one row per platform.
    const [conflicts] = collectKeybindingSections({ editor, panel: [], acp: [] }).slice(1)
    expect(conflicts!.rows).toHaveLength(3)
    for (const entry of conflicts!.rows) {
      expect(entry.cells['shortcut']).toEqual({ type: 'text', value: 'Ctrl+K' })
      expect(entry.cells['command']).toEqual({
        type: 'textList',
        value: ['a.first', 'b.second'],
      })
    }
    expect(
      conflicts!.rows
        .map((entry) => entry.cells['scope'])
        .filter((scope, index, all) => all.indexOf(scope) === index),
    ).toHaveLength(3)
    // Different `when` clauses shadow by design; other platforms never collide.
    const scoped = collectKeybindingSections({
      editor: [
        { command: 'a.first', key: 'ctrl+k', when: 'editorTextFocus' },
        { command: 'd.other', key: 'ctrl+k', when: 'terminalFocus' },
      ],
      panel: [],
      acp: [],
    })
    expect(scoped[1]!.rows).toEqual([])
  })

  it('is order-independent and deduplicates repeated facts', () => {
    const facts = keybindingsFacts(manifest)
    const forward = collectKeybindingSections(facts)
    const reversed = collectKeybindingSections({
      editor: facts.editor.toReversed(),
      panel: facts.panel.toReversed(),
      acp: facts.acp.toReversed(),
    })
    expect(reversed).toEqual(forward)
    const doubled = collectKeybindingSections({
      editor: [...facts.editor, ...facts.editor],
      panel: [...facts.panel, ...facts.panel],
      acp: [...facts.acp, ...facts.acp],
    })
    expect(doubled).toEqual(forward)
  })

  it('pins the ACP table to the static locals /help lists', () => {
    const region = EN.referenceAcp.split('local ', 2)[1]!.split(' plus installed', 2)[0]!
    const listed = new Set<string>()
    for (const chunk of region.split(/, | and /u)) listed.add(chunk.replace(/^\//u, ''))
    expect(new Set(ACP_COMMAND_NAMES)).toEqual(listed)
  })

  it('collects real sections through the shared forward with row caps', async () => {
    const result = await keybindingsSource(() => manifest).read(context())
    const report = fixtureCollector(
      buildSourceSnapshot({ keybindings: availableSource('keybindings', result.data!) }),
      reportOptions('keybindings'),
    )
    const bindings = report.sections.find((section) => section.id === 'keybindings/keybindings')!
    expect(bindings.rows).toHaveLength(REPORT_SECTION_ROWS)
    expect(bindings.omittedRows).toBeGreaterThan(0)
    const full = fixtureCollector(
      buildSourceSnapshot({ keybindings: availableSource('keybindings', result.data!) }),
      reportOptions('keybindings', { full: true }),
    )
    const fullBindings = full.sections.find((section) => section.id === 'keybindings/keybindings')!
    expect(fullBindings.omittedRows).toBe(0)
    expect(fullBindings.rows.length).toBe(bindings.rows.length + bindings.omittedRows)
    expect(full.sections.find((section) => section.id === 'keybindings/conflicts')).toBeDefined()
  })
})

describe('keybindings manifest reader', () => {
  it('reads the installed file and reports a missing or broken one', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'keybindings-manifest-'))
    roots.push(root)
    const file = path.join(root, 'package.json')
    await writeFile(file, JSON.stringify({ contributes: { commands: [], keybindings: [] } }))
    expect(keybindingsManifestReader(file)()).toEqual({
      contributes: { commands: [], keybindings: [] },
    })
    // The reader throws synchronously; the source port maps the codes.
    expect(
      readManifestError(keybindingsManifestReader(path.join(root, 'absent.json'))),
    ).toMatchObject({
      isLocalSourceError: true,
      code: 'missing',
    })
    await writeFile(file, '{ not json')
    expect(readManifestError(keybindingsManifestReader(file))).toMatchObject({
      isLocalSourceError: true,
      code: 'invalid',
    })
    const missing = await keybindingsSource(() => {
      throw new LocalSourceError('missing')
    }).read(context())
    expect(missing).toMatchObject({
      record: { status: 'unavailable', reason: EN.reportSourceReasons.missing },
      data: null,
    })
  })
})

async function engineWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'keybindings-engine-'))
  roots.push(root)
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { quality: 'npm test' } }),
  )
  await writeFile(
    path.join(root, 'CHANGELOG.md'),
    '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- A local change.\n',
  )
  return root
}
describe('keybindings engine binding', () => {
  const options = {
    kind: 'keybindings' as const,
    asOf: REPORT_AS_OF,
    scope: '',
    full: false,
    network: false,
    failOn: [],
  }
  it('generates the kind from the passed install manifest in every host', async () => {
    const root = await engineWorkspace()
    const workspaceKey = reportWorkspaceKey(root, process.platform)
    const engine = createReportingEngine({
      workspaceRoot: root,
      workspaceKey,
      storageRoot: path.join(root, 'data'),
      l10n: { table: EN, locale: 'en' },
      generatorVersion: '0.0.0-test',
      keepHistory: false,
      enabledAgents: [],
      keybindings: () => manifest,
    })
    const result = await engine.reports.run({ workspaceKey, options })
    expect(result.status).toBe('generated')
    if (result.status !== 'generated') throw new Error(JSON.stringify(result))
    expect(result.document.sources.find(({ id }) => id === 'keybindings')?.status).toBe('ok')
    const bindings = result.document.sections.find(
      (section) => section.id === 'keybindings/keybindings',
    )!
    expect(
      bindings.rows.some(
        (entry) =>
          entry.cells['command']?.type === 'text' &&
          entry.cells['command'].value === 'museSpark.focusInput',
      ),
    ).toBe(true)
  })
  it('leaves the kind unbound without the install manifest', async () => {
    const root = await engineWorkspace()
    const workspaceKey = reportWorkspaceKey(root, process.platform)
    const engine = createReportingEngine({
      workspaceRoot: root,
      workspaceKey,
      storageRoot: path.join(root, 'data'),
      l10n: { table: EN, locale: 'en' },
      generatorVersion: '0.0.0-test',
      keepHistory: false,
      enabledAgents: [],
    })
    const result = await engine.reports.run({ workspaceKey, options })
    expect(result.status).toBe('generated')
    if (result.status !== 'generated') throw new Error(JSON.stringify(result))
    expect(result.document.sources.find(({ id }) => id === 'keybindings')?.status).toBe(
      'unavailable',
    )
  })
})
